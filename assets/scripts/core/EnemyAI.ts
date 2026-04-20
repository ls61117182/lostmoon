/**
 * 德军坦克 AI —— 纯 TypeScript，不依赖 Cocos。
 *
 * 对应 GDD §3.7：
 *   - 每辆德坦在自己回合开始时按"起始格地形 / 是否受损"决定掷骰数：
 *       公路 4 骰 / 田地 4 骰 / 泥地 3 骰 / 受损（不论地形）2 骰
 *   - 每一颗骰子再按列表映射到一个行动（A>B 表示先尝试 A，A 做不了才做 B）
 *   - 多辆敌坦的行动顺序：距谢尔曼最近 → 最远；同距随机
 *
 * 转向规则（3 条优先级）：
 *   1. 谢尔曼在"正前直线" + 正前一格可通行 → 不转向
 *   2. 谢尔曼在"正后直线" + 正后一格可通行 → 朝"转向后正前可通行"的一侧转 1 步
 *   3. 否则 → 朝"approximateDirection(enemy→sherman)"最近的一侧转 1 步
 *
 * 本文件只做纯决策，不触碰 Unit 状态；具体执行（动画 / 攻击 / 消耗骰子）放在
 * BattleScene 里，配合 update() 驱动。
 */

import { RNG } from './Dice';
import {
  HexMap,
  approximateDirection,
  directionTo,
  hexDistance,
  neighbor,
  neighbors,
  rotateDirection,
} from './HexGrid';
import { terrainMoveCost } from './MoveCost';
import { Axial, Direction, TerrainType, Unit } from './types';

// ---------- 行动分类 ----------

/** 单颗 AI 骰能产出的具体行动 */
export type EnemyAction =
  | 'shoot'    // 射击：朝谢尔曼开火
  | 'turn'     // 转向 1 步（60°）
  | 'advance'  // 前进 1 格
  | 'reverse'  // 后退 1 格
  | 'smoke'    // 施放烟雾（自身 smoked=true）
  | 'repair'   // 修复（清掉 damaged 状态）
  | 'none';    // 空骰：无事发生

/** 一颗骰子对应的"A>B"规则；没有 fallback 就单纯 A */
export interface AIActionEntry {
  primary: EnemyAction;
  fallback?: EnemyAction;
}

/** AI 表的行键：地形或"受损" */
export type AIColumn = 'road' | 'field' | 'mud' | 'damaged';

/** AI 表：列 → (1..6) → 行动 */
export type AIActionTable = Record<AIColumn, Record<number, AIActionEntry>>;

/** 不同列对应的掷骰数 */
export const AI_DICE_COUNT: Record<AIColumn, number> = {
  road: 4,
  field: 4,
  mud: 3,
  damaged: 2,
};

/**
 * GDD §3.7 示意 AI 表。按任务配置化后这张表会被各关自己的表覆盖。
 *
 * 注：表里每颗骰都保留"A>B"的降级候选；
 * shoot/repair 等没有明显降级候选的条目就写单一动作。
 */
export const DEFAULT_AI_TABLE: AIActionTable = {
  road: {
    1: { primary: 'shoot',   fallback: 'turn' },
    2: { primary: 'advance', fallback: 'shoot' },
    3: { primary: 'advance', fallback: 'turn' },
    4: { primary: 'turn' },
    5: { primary: 'advance', fallback: 'shoot' },
    6: { primary: 'advance', fallback: 'turn' },
  },
  field: {
    1: { primary: 'shoot',   fallback: 'turn' },
    2: { primary: 'turn' },
    3: { primary: 'advance', fallback: 'turn' },
    4: { primary: 'advance', fallback: 'turn' },
    5: { primary: 'advance', fallback: 'turn' },
    6: { primary: 'advance', fallback: 'reverse' },
  },
  mud: {
    1: { primary: 'shoot' },
    2: { primary: 'turn' },
    3: { primary: 'advance', fallback: 'turn' },
    4: { primary: 'turn' },
    5: { primary: 'advance', fallback: 'shoot' },
    6: { primary: 'advance', fallback: 'smoke' },
  },
  damaged: {
    1: { primary: 'repair' },
    2: { primary: 'turn' },
    3: { primary: 'advance', fallback: 'turn' },
    4: { primary: 'turn' },
    5: { primary: 'shoot' },
    6: { primary: 'smoke' },
  },
};

// ---------- 列 & 骰子 ----------

/** 敌坦所处格子 / 状态 → AI 列 */
export function aiColumnFor(enemy: Unit, terrain: TerrainType): AIColumn {
  if (enemy.damaged) return 'damaged';
  switch (terrain) {
    case 'road': return 'road';
    case 'mud':  return 'mud';
    // 林地 / 建筑 / 水域坦克不能进，理论上走不到；兜底按"田地"处理
    default:     return 'field';
  }
}

/** 用给定 RNG 掷 N 颗 d6，返回长度为 N 的点数数组（1..6） */
export function rollAIDice(rng: RNG, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(rng.d6());
  return out;
}

/** 查表：骰面 → 行动条目 */
export function actionFor(table: AIActionTable, col: AIColumn, pip: number): AIActionEntry {
  const row = table[col];
  return row?.[pip] ?? { primary: 'none' };
}

// ---------- 排序：最近 → 最远 ----------

/**
 * 按"距谢尔曼最近 → 最远"排序敌方活单位；同距随机。
 *
 * 同距随机用 rng 抽值打乱，保持回合内确定性（同一 seed 下结果可复现）。
 */
export function selectEnemyOrder(
  enemies: Unit[],
  sherman: Unit,
  rng: RNG,
): Unit[] {
  const alive = enemies.filter(e => !e.destroyed);
  const withKey = alive.map(e => ({
    e,
    dist: hexDistance(e.pos, sherman.pos),
    // 同距 tiebreak：RNG 抽一次
    tie: rng.d6() * 6 + rng.d6(),
  }));
  withKey.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    return a.tie - b.tie;
  });
  return withKey.map(x => x.e);
}

// ---------- 转向决策 ----------

export type TurnDecision = 'stay' | 'cw' | 'ccw';

/**
 * 三条优先级：见文件头注释。返回 'stay' / 'cw' / 'ccw'，调用方据此旋转 1 步（60°）。
 *
 * @param enemy     当前敌坦
 * @param sherman   谢尔曼
 * @param map       地图
 * @param occupied  其他已占格（不含 enemy 自身），用于判定"正前可通行"是否被堵
 */
export function decideEnemyTurn(
  enemy: Unit,
  sherman: Unit,
  map: HexMap,
  occupied: Set<string>,
): TurnDecision {
  const facing = enemy.facing;
  if (facing === null) return 'cw'; // 无朝向兜底：随便转一下

  const canEnterFront = (d: Direction) => {
    const p = neighbor(enemy.pos, d);
    if (!map.canTankEnter(p)) return false;
    if (occupied.has(`${p.q},${p.r}`)) return false;
    return true;
  };

  // 规则 1：谢尔曼在正前直线 + 正前可通行 → 不转
  const straightDir = directionTo(enemy.pos, sherman.pos);
  if (straightDir === facing && canEnterFront(facing)) {
    return 'stay';
  }

  // 规则 2：谢尔曼在正后直线 + 正后可通行 → 朝"旋转后正前可通行"一侧转 1 步
  const rear = rotateDirection(facing, 3);
  if (straightDir === rear && canEnterFront(rear)) {
    // 尝试 CW / CCW 一步旋转，看谁的新正前可通行 → 优先那边
    const cwFront   = rotateDirection(facing, 1);
    const ccwFront  = rotateDirection(facing, 5);
    const cwOk  = canEnterFront(cwFront);
    const ccwOk = canEnterFront(ccwFront);
    if (cwOk && !ccwOk) return 'cw';
    if (!cwOk && ccwOk) return 'ccw';
    // 两边都行 / 都不行：选"更朝向谢尔曼"那边
    return pickShortestTurnTowards(facing, sherman.pos, enemy.pos);
  }

  // 规则 3：朝 approximateDirection 方向最短旋转一步
  return pickShortestTurnTowards(facing, sherman.pos, enemy.pos);
}

/** 辅助：朝 target 最短方向旋 1 步（已正对则返回 'stay'） */
function pickShortestTurnTowards(
  facing: Direction,
  target: Axial,
  from: Axial,
): TurnDecision {
  const want = approximateDirection(from, target);
  if (want === facing) return 'stay';
  // diff ∈ 1..5；0 已在上面返回
  const diff = ((want - facing) + 6) % 6;
  if (diff === 0) return 'stay';
  return diff <= 3 ? 'cw' : 'ccw';
}

// ---------- 可执行性判定 ----------

/**
 * 给定一个行动，判断敌坦当前能不能执行。
 *
 * 注：`turn` 与 `smoke`、`repair` 几乎总能执行；真正会"做不了"的主要是射击（无视线）
 * 与前进/后退（正前/正后被堵）。
 */
export function canExecuteAction(
  enemy: Unit,
  action: EnemyAction,
  sherman: Unit,
  map: HexMap,
  occupied: Set<string>,
): boolean {
  if (enemy.destroyed) return false;
  switch (action) {
    case 'none':   return false;
    case 'shoot':  return enemy.facing !== null; // 有朝向就算可试；真正的视线/装甲合法性 BattleScene 里用 canAttack 再确认
    case 'turn':   return true;
    case 'smoke':  return !enemy.smoked;
    case 'repair': return !!enemy.damaged;
    case 'advance':
    case 'reverse': {
      if (enemy.paralyzed) return false;
      if (enemy.facing === null) return false;
      const dir = action === 'advance'
        ? enemy.facing
        : rotateDirection(enemy.facing, 3);
      const to = neighbor(enemy.pos, dir);
      if (!map.canTankEnter(to)) return false;
      if (occupied.has(`${to.q},${to.r}`)) return false;
      // 终点格的移动成本不看上限（AI 回合没有"移动力"概念），只要能进就算可执行
      const tile = map.get(to);
      if (!tile) return false;
      void terrainMoveCost(tile.terrain); // 保留 import，方便未来把"骰点数 = 移动力"接进来
      return true;
    }
  }
}

// ---------- 旧 API：保留兼容，但不再被主流程使用 ----------

export interface EnemyMoveDecision {
  to: Axial;
  cost: number;
}

/**
 * @deprecated 旧版"贪心一格"移动；新 AI 走骰子驱动，这里仅为向后兼容保留。
 */
export function decideEnemyMove(
  enemy: Unit,
  sherman: Unit,
  map: HexMap,
  otherUnits: Unit[],
  budget: number,
): EnemyMoveDecision | null {
  const currentDist = hexDistance(enemy.pos, sherman.pos);
  const occupied = new Set<string>();
  for (const u of otherUnits) occupied.add(`${u.pos.q},${u.pos.r}`);
  occupied.add(`${sherman.pos.q},${sherman.pos.r}`);

  let best: Axial | null = null;
  let bestDist = currentDist;
  let bestCost = Infinity;

  for (const n of neighbors(enemy.pos)) {
    if (!map.canTankEnter(n)) continue;
    if (occupied.has(`${n.q},${n.r}`)) continue;
    const tile = map.get(n);
    if (!tile) continue;
    const cost = terrainMoveCost(tile.terrain);
    if (cost > budget) continue;
    const d = hexDistance(n, sherman.pos);
    if (d >= currentDist) continue;

    if (d < bestDist || (d === bestDist && cost < bestCost)) {
      best = n;
      bestDist = d;
      bestCost = cost;
    }
  }

  return best ? { to: best, cost: bestCost } : null;
}
