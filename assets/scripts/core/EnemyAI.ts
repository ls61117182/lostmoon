/**
 * 德军坦克 AI —— 纯 TypeScript，不依赖 Cocos。
 *
 * 对应 GDD §3.7：
 *   - 每辆德坦在自己回合开始时按"起始格地形 / 是否受损"决定掷骰数：
 *       公路 4 骰 / 田地 4 骰 / 泥地 3 骰 / 受损（不论地形）2 骰
 *   - 每一颗骰子再按列表映射到一个行动（A>B 表示先尝试 A，A 做不了才做 B）
 *   - 多辆敌坦的行动顺序：距谢尔曼最近 → 最远；同距随机
 *
 * 转向规则（4 条优先级）：
 *   1. 谢尔曼在"正前直线" + 正前一格可通行 → 不转向
 *   2. 谢尔曼在"正前直线" + 正前一格不可通行 → 随机转向左右可通行的一侧
 *   3. 谢尔曼在"正后直线" + 正后一格可通行 → 朝"转向后正前可通行"的一侧转 1 步
 *   4. 否则 → 朝"approximateDirection(enemy→sherman)"最近的一侧转 1 步
 *
 * 本文件只做纯决策，不触碰 Unit 状态；具体执行（动画 / 攻击 / 消耗骰子）放在
 * BattleScene 里，配合 update() 驱动。
 */

import { RNG } from './Dice';
import {
  AI_DICE_COUNT,
  AIActionEntry,
  AIActionTable,
  AIColumn,
  DEFAULT_AI_TABLE,
  EnemyAction,
} from './EnemyAIDB';
import {
  HexMap,
  approximateDirection,
  directionTo,
  hexDistance,
  neighbor,
  neighbors,
  rotateDirection,
} from './HexGrid';
import { tileMoveCost } from './MoveCost';
import { Axial, Direction, isFootUnit, TerrainType, tileForbidsSmokeOrConcealment, Unit } from './types';

// ---------- 行动分类 ----------

/**
 * AI 行动 / 列 / 骰数 / 默认表 —— 全部从 `EnemyAIDB` 再导出，数据源是
 * `data/enemy_ai_table.csv` + `data/enemy_ai_dice.csv`，由 `tools/buildEnemyAIDB.js`
 * 生成。本文件不再写任何骰面→动作的硬编码。
 */
export { AI_DICE_COUNT, DEFAULT_AI_TABLE };
export type { AIActionEntry, AIActionTable, AIColumn, EnemyAction };

// ---------- 列 & 骰子 ----------

/**
 * 敌坦所处格子 / 状态 → AI 列。
 *
 * GDD §3.2「按公路触发」一并视桥梁为公路 → 调用方应传 `effectiveDiceTerrain(tile)`
 * 而非 `tile.terrain`，让水域+桥梁折算成 'road'，确保站在桥上的敌坦走公路 AI 列。
 */
export function aiColumnFor(enemy: Unit, terrain: TerrainType): AIColumn {
  switch (enemy.kind) {
    case 'type95': return 'type95';
    case 'type97': return 'type97';
    case 'at_gun': return 'at_gun';
    case 'japanese_infantry': return 'japanese_infantry';
    case 'heavy_artillery': return 'heavy_artillery';
  }
  if (enemy.damaged) return 'damaged';
  switch (terrain) {
    case 'road': return 'road';
    case 'mud':  return 'mud';
    // 林地 / 水域坦克不能进，理论上走不到；兜底按"田地"处理
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
  return selectAIOrder(enemies, [sherman], sherman, rng);
}

export function isTankAITarget(u: Unit): boolean {
  return !u.destroyed && !isFootUnit(u) && u.kind !== 'truck';
}

export function currentTargetFor(
  actor: Unit,
  candidates: Unit[],
  playerUnit: Unit,
  rng: RNG,
): Unit | null {
  const hostile = candidates.filter(u => u.faction !== actor.faction && isTankAITarget(u));
  if (hostile.length === 0) return null;
  let bestDist = Infinity;
  const tied: Unit[] = [];
  for (const u of hostile) {
    const d = hexDistance(actor.pos, u.pos);
    if (d < bestDist) {
      bestDist = d;
      tied.length = 0;
      tied.push(u);
    } else if (d === bestDist) {
      tied.push(u);
    }
  }
  const playerTied = tied.find(u => u === playerUnit);
  if (playerTied) return playerTied;
  return tied.length === 1 ? tied[0] : tied[rng.intRange(0, tied.length - 1)];
}

export function selectAIOrder(
  actors: Unit[],
  potentialTargets: Unit[],
  playerUnit: Unit,
  rng: RNG,
): Unit[] {
  const alive = actors.filter(e => !e.destroyed && !isFootUnit(e) && e.kind !== 'truck');
  const withKey = alive.map(e => ({
    e,
    target: currentTargetFor(e, potentialTargets, playerUnit, rng),
    // 同距 tiebreak：RNG 抽一次
    tie: rng.d6() * 6 + rng.d6(),
  })).filter((x): x is { e: Unit; target: Unit; tie: number } => !!x.target);
  withKey.sort((a, b) => {
    const ad = hexDistance(a.e.pos, a.target.pos);
    const bd = hexDistance(b.e.pos, b.target.pos);
    if (ad !== bd) return ad - bd;
    return a.tie - b.tie;
  });
  return withKey.map(x => x.e);
}

// ---------- 转向决策 ----------

export type TurnDecision = 'stay' | 'cw' | 'ccw';

/**
 * 四条优先级：见文件头注释。返回 'stay' / 'cw' / 'ccw'，调用方据此旋转 1 步（60°）。
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
  rng?: RNG,
): TurnDecision {
  const facing = enemy.facing;
  if (facing === null) return 'cw'; // 无朝向兜底：随便转一下

  const canEnterFront = (d: Direction) => {
    const p = neighbor(enemy.pos, d);
    // 桥梁边向（GDD §3.2）：通过 canTankCrossEdge 同时校验「水域+桥梁可入」与「方向落在桥端」。
    if (!map.canTankCrossEdge(enemy.pos, p, { ignoreBreakwater: enemy.faction === 'japanese' })) return false;
    if (occupied.has(`${p.q},${p.r}`)) return false;
    return true;
  };

  // 规则 2 / 3 共用：尝试 CW / CCW 一步旋转，挑"新正前可通行"那侧；都行时可随机；都不行 → 朝谢尔曼最短转。
  const pickTurnToOpenFront = (randomTie = false): TurnDecision => {
    const cwFront  = rotateDirection(facing, 1);
    const ccwFront = rotateDirection(facing, 5);
    const cwOk  = canEnterFront(cwFront);
    const ccwOk = canEnterFront(ccwFront);
    if (cwOk && !ccwOk) return 'cw';
    if (!cwOk && ccwOk) return 'ccw';
    if (cwOk && ccwOk) return randomTie && rng ? (rng.d6() <= 3 ? 'cw' : 'ccw') : 'cw';
    if (randomTie && rng) return rng.d6() <= 3 ? 'cw' : 'ccw';
    return pickShortestTurnTowards(facing, sherman.pos, enemy.pos);
  };

  const straightDir = directionTo(enemy.pos, sherman.pos);

  // 规则 1/2：严格正对谢尔曼时，正前可通行才 stay；正前被挡则转向左右可通行的一侧。
  if (straightDir === facing) {
    return canEnterFront(facing) ? 'stay' : pickTurnToOpenFront(true);
  }

  // 规则 3：谢尔曼在正后直线 + 正后可通行 → 朝"旋转后正前可通行"一侧转 1 步
  const rear = rotateDirection(facing, 3);
  if (straightDir === rear && canEnterFront(rear)) {
    return pickTurnToOpenFront();
  }

  // 规则 4：朝 approximateDirection 方向最短旋转一步
  return pickShortestTurnTowards(facing, sherman.pos, enemy.pos);
}

/** 辅助：朝 target 最短方向旋 1 步；仅严格正对时返回 stay，近似正对时仍会实际转向。 */
function pickShortestTurnTowards(
  facing: Direction,
  target: Axial,
  from: Axial,
): TurnDecision {
  const exact = directionTo(from, target);
  if (exact === facing) return 'stay';
  const want = exact ?? approximateDirection(from, target);
  const diff = ((want - facing) + 6) % 6;
  if (diff === 0) return pickCloserTurnSide(facing, target, from);
  return diff <= 3 ? 'cw' : 'ccw';
}

/** 目标落在当前朝向扇区内但不允许原地不动时，比较转后两侧哪边更接近目标。 */
function pickCloserTurnSide(
  facing: Direction,
  target: Axial,
  from: Axial,
): TurnDecision {
  const cwFront = neighbor(from, rotateDirection(facing, 1));
  const ccwFront = neighbor(from, rotateDirection(facing, 5));
  const cwDist = hexDistance(cwFront, target);
  const ccwDist = hexDistance(ccwFront, target);
  return cwDist <= ccwDist ? 'cw' : 'ccw';
}

// ---------- 可执行性判定 ----------

/**
 * 给定一个行动，判断敌坦当前能不能执行。
 *
 * 注：`turn` 与 `smoke`、`repair` 几乎总能执行；`conceal` 在已隐蔽时不可重复；真正会"做不了"的主要是射击（无视线）
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
  const currentTile = map.get(enemy.pos);
  switch (action) {
    case 'none':   return false;
    case 'shoot':  return enemy.facing !== null; // 有朝向就算可试；真正的视线/装甲合法性 BattleScene 里用 canAttack 再确认
    case 'turn':   return true;
    case 'smoke':  return !enemy.smoked && !tileForbidsSmokeOrConcealment(currentTile);
    case 'repair': return !!enemy.damaged;
    case 'conceal': return !enemy.hidden && !tileForbidsSmokeOrConcealment(currentTile);
    case 'shoot_adjacent': return enemy.facing !== null && hexDistance(enemy.pos, sherman.pos) === 1;
    case 'infantry_move':
      return enemy.kind === 'japanese_infantry';
    case 'advance_to_building': {
      if (enemy.paralyzed) return false;
      if (enemy.facing === null) return false;
      const to = neighbor(enemy.pos, enemy.facing);
      if (!map.canTankCrossEdge(enemy.pos, to, { ignoreBreakwater: enemy.faction === 'japanese' })) return false;
      if (occupied.has(`${to.q},${to.r}`)) return false;
      const tile = map.get(to);
      return !!tile?.hasBuilding;
    }
    case 'hull_down':
      return !enemy.hidden && !tileForbidsSmokeOrConcealment(currentTile);
    case 'advance':
    case 'reverse': {
      if (enemy.paralyzed) return false;
      if (enemy.facing === null) return false;
      const dir = action === 'advance'
        ? enemy.facing
        : rotateDirection(enemy.facing, 3);
      const to = neighbor(enemy.pos, dir);
      // 桥梁边向（GDD §3.2）：水域+桥梁可入需 dir 落在 br 端；非桥梁场景 canTankCrossEdge 行为退化为 canTankEnter。
      if (!map.canTankCrossEdge(enemy.pos, to, { ignoreBreakwater: enemy.faction === 'japanese' })) return false;
      if (occupied.has(`${to.q},${to.r}`)) return false;
      // 终点格的移动成本不看上限（AI 回合没有"移动力"概念），只要能进就算可执行
      const tile = map.get(to);
      if (!tile) return false;
      void tileMoveCost(tile); // 保留 import，方便未来把"骰点数 = 移动力"接进来；桥梁通过 tileMoveCost 自动等效公路
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
    if (!map.canTankCrossEdge(enemy.pos, n, { ignoreBreakwater: enemy.faction === 'japanese' })) continue;
    if (occupied.has(`${n.q},${n.r}`)) continue;
    const tile = map.get(n);
    if (!tile) continue;
    const cost = tileMoveCost(tile);
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
