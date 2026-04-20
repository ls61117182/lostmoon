/**
 * 战斗结算 —— 纯函数，不依赖 Cocos，可直接 Jest 测。
 *
 * MVP 简化（相对手册的差异，以后补）：
 *   - 命中公式只算 "体型 + 距离 + 树篱 + 建筑"，忽略烟雾/隐蔽
 *   - 命中 = 直接进伤害进度：未起火 → 起火（damaged=true）；已起火 → 摧毁（destroyed=true）。
 *     完全跳过手册的"穿甲 vs 装甲"判定，避免低穿甲攻方"打中也无效"的卡死局面。
 *     装甲面仍会算并写进 AttackReport，仅用于战报展示与未来恢复严格规则。
 *   - 不处理对子（doubles）特殊事件
 *   - 不校验乘员存活（假设炮手总是可用）
 */

import { RNG } from './Dice';
import { HexMap, approximateDirection, hexDistance, rotateDirection } from './HexGrid';
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
  if (!map.hasLineOfSight(attacker.pos, target.pos)) return { ok: false, reason: '无视线' };
  return { ok: true };
}

/** 命中所需 = 体型 + 距离 + 树篱数 + 建筑格 (+1) */
export function hitThreshold(ctx: AttackContext): number {
  const { attacker, target, map } = ctx;
  const dist = hexDistance(attacker.pos, target.pos);
  const hedges = map.countHedgesAlong(attacker.pos, target.pos);
  const targetTile = map.get(target.pos);
  const inBuilding = targetTile?.terrain === 'building' ? 1 : 0;
  return target.stats.size + dist + hedges + inBuilding;
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
 * 结算攻击。若命中且穿甲，会就地修改 target.damaged/destroyed。
 * 调用方只需根据 AttackReport 做 UI 反馈即可。
 */
export function resolveAttack(ctx: AttackContext, rng: RNG): AttackReport {
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

  // MVP：任何命中都推进伤害进度
  // first-hit → 起火（damaged=true），second-hit → 摧毁（destroyed=true）
  let statusChange: HitStatusChange;
  if (target.damaged) {
    target.destroyed = true;
    statusChange = 'destroyed';
  } else {
    target.damaged = true;
    statusChange = 'damaged';
  }

  return {
    dice: [d1, d2], roll, threshold,
    hit: true,
    armorFace: face,
    armor,
    penetration: pen,
    statusChange,
  };
}
