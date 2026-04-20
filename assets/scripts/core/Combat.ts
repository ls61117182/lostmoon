/**
 * 战斗结算 —— 纯函数，不依赖 Cocos，可直接 Jest 测。
 *
 * MVP 简化（相对手册的差异，以后补）：
 *   - 命中公式只算 "体型 + 距离 + 树篱 + 建筑"，忽略烟雾/隐蔽
 *   - 流程：① 2d6 命中检定 → ② 命中后再掷 1d6 穿甲检定（d6 ≥ 装甲 - 穿甲 才造成伤害）。
 *     未击穿 = 命中无效，不推进 damaged/destroyed；击穿 → 未起火变起火、起火变摧毁。
 *     不实装手册 Step 3 的"伤害结果表（炮塔受损 / 痛痪 / 着火程度）"，统一收敛到二段式起火→摧毁。
 *   - 不处理对子（doubles）特殊事件
 *   - 不校验乘员存活（假设炮手总是可用）
 */

import { RNG } from './Dice';
import { HexMap, approximateDirection, directionTo, hexDistance, rotateDirection } from './HexGrid';
import { Axial, Unit } from './types';

export type ArmorFace = 'front' | 'frontSide' | 'rearSide' | 'rear';

/** 本次攻击对目标状态的改动：无变化 / 首次穿甲受损 / 补刀摧毁 */
export type HitStatusChange = 'none' | 'damaged' | 'destroyed';

export interface AttackReport {
  dice: [number, number];
  roll: number;
  threshold: number;
  hit: boolean;
  /** 命中分段：以下字段仅在 hit=true 时有值 */
  armorFace?: ArmorFace;
  armor?: number;
  penetration?: number;
  /** 穿甲检定分段：仅在 hit=true 时有值 */
  penDie?: number;          // 1d6 击穿掷骰
  penThreshold?: number;    // 击穿所需 = armor - penetration（≤0 必穿，≥7 不可击穿）
  penetrated?: boolean;     // 是否击穿装甲；未击穿 = 命中无效
  statusChange: HitStatusChange;
}

export interface AttackContext {
  attacker: Unit;
  target: Unit;
  map: HexMap;
}

export function canAttack(ctx: AttackContext): { ok: boolean; reason?: string } {
  const { attacker, target, map } = ctx;
  if (target === attacker) return { ok: false, reason: '不能攻击自己' };
  if (target.destroyed) return { ok: false, reason: '目标已被摧毁' };
  if (hexDistance(attacker.pos, target.pos) === 0) return { ok: false, reason: '目标重叠' };
  // 射角限制：只能朝 6 条轴向直线射击。directionTo 只在 from→to 落在某条六向射线上才返回
  // 方向编号，否则返回 null——非 null 即表示"同线"。
  if (directionTo(attacker.pos, target.pos) === null) return { ok: false, reason: '非六向直线' };
  if (!map.hasLineOfSight(attacker.pos, target.pos)) return { ok: false, reason: '无视线' };
  return { ok: true };
}

/** 命中所需 = 体型 + 距离 + 树篱数 + 建筑格 (+1) */
export function hitThreshold(ctx: AttackContext): number {
  const b = hitBreakdown(ctx);
  return b.threshold;
}

/** 命中阈值的逐项分解，用于 UI"为什么需要 N"展示。 */
export interface HitBreakdown {
  size: number;
  distance: number;
  hedges: number;
  building: number;     // 0 或 1
  threshold: number;    // = size + distance + hedges + building
}

export function hitBreakdown(ctx: AttackContext): HitBreakdown {
  const { attacker, target, map } = ctx;
  const distance = hexDistance(attacker.pos, target.pos);
  const hedges = map.countHedgesAlong(attacker.pos, target.pos);
  const targetTile = map.get(target.pos);
  const building = targetTile?.terrain === 'building' ? 1 : 0;
  const size = target.stats.size;
  return { size, distance, hedges, building, threshold: size + distance + hedges + building };
}

/** 2d6 ≥ N 的概率（N 在 [0..14] 内取值；越界自动夹到 1 或 0）。 */
export const HIT_PROB_2D6_GE: ReadonlyArray<number> = [
  /* 0 */ 1.000, 1.000,
  /* 2 */ 36 / 36, 35 / 36, 33 / 36, 30 / 36, 26 / 36, 21 / 36,
  /* 8 */ 15 / 36, 10 / 36,  6 / 36,  3 / 36,  1 / 36,
  /* 13 */ 0, 0,
];
export function probHit2d6(threshold: number): number {
  const i = Math.max(0, Math.min(HIT_PROB_2D6_GE.length - 1, threshold));
  return HIT_PROB_2D6_GE[i];
}

/** 1d6 ≥ N 的概率：N≤1 必中；N≥7 必不中；其余 = (7-N)/6。 */
export function probDie1d6(threshold: number): number {
  if (threshold <= 1) return 1;
  if (threshold >= 7) return 0;
  return (7 - threshold) / 6;
}

/**
 * 攻击方向相对目标车体朝向的夹角 → 装甲面。
 * diff=0 正面；diff=±1 前侧；diff=±2 后侧；diff=3 后方。
 */
export function armorFaceFrom(target: Unit, attackerPos: Axial): ArmorFace {
  if (target.facing === null) return 'front'; // 无朝向单位按正面吃伤
  const attackDir = approximateDirection(target.pos, attackerPos);
  const diff = rotateDirection(attackDir, -target.facing);
  if (diff === 0) return 'front';
  if (diff === 1 || diff === 5) return 'frontSide';
  if (diff === 2 || diff === 4) return 'rearSide';
  return 'rear';
}

export function armorValue(target: Unit, face: ArmorFace): number {
  switch (face) {
    case 'front':     return target.stats.armorFront;
    case 'frontSide': return target.stats.armorFrontSide;
    case 'rearSide':  return target.stats.armorRearSide;
    case 'rear':      return target.stats.armorRear;
  }
}

/**
 * 纯掷骰 + 计算结果（不修改 target）。返回的 report 描述"如果应用，会发生什么"。
 * 拆分出来是为了让 UI 先播掷骰动画，等动画结束再调用 applyAttack 真正落实伤害，
 * 这样玩家能看清楚每颗骰子点数与命中阈值，再看到目标变色。
 */
export function rollAttack(ctx: AttackContext, rng: RNG): AttackReport {
  const { attacker, target } = ctx;
  const d1 = rng.d6();
  const d2 = rng.d6();
  const roll = d1 + d2;
  const threshold = hitThreshold(ctx);
  const hit = roll >= threshold;

  if (!hit) {
    return { dice: [d1, d2], roll, threshold, hit: false, statusChange: 'none' };
  }

  const face = armorFaceFrom(target, attacker.pos);
  const armor = armorValue(target, face);
  const pen = attacker.stats.penetration;

  // 第二段：穿甲检定。手册规则：d6 ≥ 装甲 - 穿甲 才造成伤害。
  // 阈值可能 ≤0（必穿）或 ≥7（不可能击穿，但仍掷骰让玩家看到结果）。
  const penDie = rng.d6();
  const penThreshold = armor - pen;
  const penetrated = penDie >= penThreshold;

  // 仅在击穿时推进伤害进度（first-hit → 起火，second-hit → 摧毁）
  const statusChange: HitStatusChange = !penetrated
    ? 'none'
    : target.damaged
      ? 'destroyed'
      : 'damaged';

  return {
    dice: [d1, d2], roll, threshold,
    hit: true,
    armorFace: face,
    armor,
    penetration: pen,
    penDie,
    penThreshold,
    penetrated,
    statusChange,
  };
}

/** 把 rollAttack 得出的 report 真正写入 target（触发起火 / 摧毁）。未命中或未击穿都不变更。 */
export function applyAttack(target: Unit, report: AttackReport): void {
  if (!report.hit) return;
  if (!report.penetrated) return;
  if (report.statusChange === 'destroyed') {
    target.destroyed = true;
  } else if (report.statusChange === 'damaged') {
    target.damaged = true;
  }
}

/** 一步到位：掷骰 + 写入。无需动画时（如自动测试）使用。 */
export function resolveAttack(ctx: AttackContext, rng: RNG): AttackReport {
  const report = rollAttack(ctx, rng);
  applyAttack(ctx.target, report);
  return report;
}

// ---------- 不掷骰的"预演" ----------

export interface AttackPreview {
  /** 命中阶段分解 */
  hit: HitBreakdown & { probability: number };
  /** 穿甲阶段分解（即便玩家掷不到也展示，让玩家学会规则） */
  pen: {
    armorFace: ArmorFace;
    armor: number;
    penetration: number;
    threshold: number;       // = armor - penetration（≤0 必穿，≥7 不可击穿）
    probability: number;
  };
  /** 命中且击穿的联合概率（命中概率 × 穿甲概率） */
  jointProbability: number;
}

/**
 * 不掷骰的攻击预演：把"为什么需要 N"以结构化形式给出，UI 可以照着展开。
 * 假设 attacker 当前朝向 / target 当前位置 / 当前地形，所以面板里的数字 = 真实开火时的数字。
 */
export function previewAttack(ctx: AttackContext): AttackPreview {
  const hb = hitBreakdown(ctx);
  const hitProb = probHit2d6(hb.threshold);

  const face = armorFaceFrom(ctx.target, ctx.attacker.pos);
  const armor = armorValue(ctx.target, face);
  const pen = ctx.attacker.stats.penetration;
  const penThreshold = armor - pen;
  const penProb = probDie1d6(penThreshold);

  return {
    hit: { ...hb, probability: hitProb },
    pen: { armorFace: face, armor, penetration: pen, threshold: penThreshold, probability: penProb },
    jointProbability: hitProb * penProb,
  };
}
