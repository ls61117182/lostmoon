/**
 * 战斗结算 —— 纯函数，不依赖 Cocos，可直接 Jest 测。
 *
 * MVP 简化（相对手册的差异，以后补）：
 *   - 命中公式只算 "体型 + 距离 + 树篱 + 建筑"，忽略烟雾/隐蔽
 *   - 流程（§3.4 三段式）：
 *       ① 2d6 命中检定（阈值 = 体型 + 距离 + 树篱 + 建筑 + …）
 *       ② 命中后再掷 2d6 穿甲检定（2d6 ≥ 装甲 - 穿甲 才击穿；未击穿 = 跳弹，命中无效）
 *       ③ 击穿后再掷 1d6 伤害检定（§3.4 Step 3 的伤害结果表）：
 *            主角： 1=摧毁 / 2,3,4=着火 +1 / 5=炮塔受损 / 6=痛痪
 *            其他坦克： 1–4=受损（已受损→摧毁） / 5,6=摧毁
 *          → 对应效果写回 target 的 destroyed/damaged/fireLevel/turretDamaged/paralyzed
 *   - 主角伤害检定不产生"阵亡检定"结果；命中成功且命中判定对子会处理开舱主角车长阵亡风险
 *   - 不校验乘员存活（假设炮手总是可用）
 */

import { RNG } from './Dice';
import { ATTACK_DIRECTION_RULES } from './AttackDirectionDB';
import type { ArmorFace, AttackDirectionRule, DamageCheckType } from './AttackDirectionDB';
import { DAMAGE_TABLE } from './DamageTableDB';
import type { DamageTableCrewRole, DamageTableEffect, DamageTargetClass } from './DamageTableDB';
import {
  approximateDirection,
  approximateFireDirection,
  directionTo,
  fireDirectionStep,
  fireDirectionTo,
  HexMap,
  hexDistance,
  hexLine,
  isDiagonalFireDirection,
  rotateDirection,
} from './HexGrid';
import { diagonalGunnerRuleDirectionForVisibleHex } from './FogOfWar';
import { markAmbushTargeted } from './Ambush';
import { Axial, battleSideIdOf, CrewSlot, FireDirection, isAntiTankGunUnit, isControlledATGun, isFootUnit, isHeavyArtilleryUnit, isHostile, isPlayerControlled, isSameSide, isTankUnit, neutralizeUncrewedTank, ShellType, ShermanCrew, Theater, Unit, UnitKind, WeatherType } from './types';
import { weatherHitThresholdModifier } from './Weather';
import { unitLevelHitThresholdModifier } from './UnitLevel';

export type { ArmorFace, DamageCheckType } from './AttackDirectionDB';

/** 本次攻击对目标状态的粗粒度改动：无变化 / 受损系列 / 直接摧毁。
 *  保留给存档和旧 UI 分支；精细效果见 AttackReport.damageEffect。 */
export type HitStatusChange = 'none' | 'damaged' | 'destroyed';

/**
 * §3.4 Step 3 伤害表的具体结果。
 *   - 'destroyed'   目标直接摧毁（主角 1；其他坦克 5,6；其他坦克已受损时 1-4）
 *   - 'damaged'     受损（其他坦克首次受伤；下次击穿直接摧毁）
 *   - 'fire'        着火 / 着火程度 +1（主角 3,4）
 *   - 'turret'      炮塔受损：不能用主炮射击（主角 5）
 *   - 'paralyzed'   痛痪：不能前进/后退/转向（主角 6）
 *   - 'crewCheck'   阵亡检定：再掷 1d6 映射乘员 1-5（仅数据表显式配置的乘员伤害）
 */
export type DamageEffect =
  | 'destroyed'
  | 'damaged'
  | 'fire'
  | 'turret'
  | 'paralyzed'
  | 'radio'
  | 'crewCheck';

export interface DamageEffectStep {
  effect: DamageEffect;
  crewPriority?: CrewSlot[];
  crewSlot?: CrewSlot | null;
}

/**
 * §3.2 注释 + §3.4 Step 3 注释的"阵亡检定"结果。
 *   - die ∈ 1..6  本次乘员阵亡检定掷出的 1d6 点数
 *   - slot        实际阵亡的乘员编号：1–5 点直接映射；6 点只有在车长打开舱盖时 = 1（车长阵亡），
 *                 否则 slot = null（虚惊一场，无人死亡）
 *   - rerolled    是否发生过"已死乘员重抛"（§3.2 注释的规则：已死乘员不再吃伤，需重抛）
 */
export interface CrewDeathResult {
  die: number;
  slot: CrewSlot | null;
  rerolled: boolean;
}

export interface AttackReport {
  dice: [number, number];
  hitDiceCount?: number;
  hitBonus?: number;
  roll: number;
  threshold: number;
  hit: boolean;
  /** 攻击发生时锁定的基础命中分解，避免 UI 受结算后的状态变化影响。 */
  hitBreakdown?: HitBreakdown;
  /** UI 命中详情中的具名修正；每个实际因素单独一项。 */
  hitModifiers?: HitThresholdModifierDetail[];
  /** 命中分段：以下字段仅在 hit=true 时有值 */
  armorFace?: ArmorFace;
  armor?: number;
  /** 本次实际计入总装甲的炮盾附加值；UI 用它把基础装甲与炮盾分行展示。 */
  gunMantletArmor?: number;
  penetration?: number;
  /** Locked effective-range calculation used by the penetration detail panel. */
  penetrationBreakdown?: EffectivePenetrationBreakdown;
  /** 穿甲检定分段：仅在 hit=true 时有值 */
  penDie?: number;          // 击穿掷骰总和（2d6）
  penDice?: number[];       // 击穿掷骰明细（2 颗）
  penThreshold?: number;    // 击穿所需 = armor - penetration（≤0 必穿，≥7 不可击穿）
  penetrated?: boolean;     // 是否击穿装甲；未击穿 = 命中无效
  /** 硬核过穿：穿甲结果比所需点数高 6 点以上，且目标属于车辆。 */
  overpenetrated?: boolean;
  /** 被过穿原位取消的起火 / 击毁结果；不会因此顺延到伤害表下一组。 */
  overpenetrationSuppressedEffects?: DamageEffect[];
  /** 伤害检定分段：仅在 hit && penetrated 时有值 */
  damageDie?: number;       // 1d6 伤害表掷骰
  damageEffect?: DamageEffect;
  /** Direction-specific damage table selected by the incoming-fire angle. */
  damageCheckType?: DamageCheckType;
  damageEffects?: DamageEffectStep[];
  /** 展示用预掷伤害骰：只有本攻击类型可能需要伤害检定时有值；前置判定失败时仍显示为无效。 */
  stagedDamageDie?: number;
  stagedDamageEffect?: DamageEffect;
  stagedDamageEffects?: DamageEffectStep[];
  stagedCrewCheck?: CrewDeathResult;
  /** 阵亡检定分段：仅在 damageEffect === 'crewCheck' 时有值。 */
  crewCheck?: CrewDeathResult;
  /** Matching hit dice kill the commander of any open-hatch tank on a successful hit. */
  commanderKilledByHitDoubles?: boolean;
  /** The hit doubles triggered, but a per-segment campaign shield absorbed the commander hit. */
  commanderShieldBlocked?: boolean;
  /** Infantry small-arms fire resolves on the hit roll without an armour check. */
  smallArms?: boolean;
  /** 本次伤害是否按主角受伤表结算；用于 applyAttack 区分同型号队友。 */
  protagonistTarget?: boolean;
  statusChange: HitStatusChange;
}

export interface AttackContext {
  attacker: Unit;
  target: Unit;
  map: HexMap;
  theater?: Theater;
  units?: readonly Unit[];
  /** HexMap.keyOf(pos) entries containing active smoke screens. */
  smokeHexes?: ReadonlySet<string>;
  /** Fixed mission weather. Rain makes attacks harder to hit. */
  weather?: WeatherType;
  /** 玩家直接控制的主角单位；未传时为兼容旧调用，仍以 kind==='sherman' 兜底。 */
  protagonist?: Unit;
  /** Action-specific modifier applied to the final hit threshold; precision fire uses -2. */
  hitThresholdModifier?: number;
  /** 与 hitThresholdModifier 对应的逐项展示明细；不重复参与数值计算。 */
  hitThresholdModifiers?: HitThresholdModifierDetail[];
  /** Hardcore rule: penetration decays beyond the attacker's configured effective range. */
  effectiveRangePenetration?: boolean;
  /** Hardcore rule: turreted main guns may use the six halfway firing rays. */
  expandedTurretDirections?: boolean;
  /** Hardcore rule: Step 3 damage-table selection may depend on incoming-fire direction. */
  directionalDamageCheck?: boolean;
  /** Hardcore rule: a turreted tank may add its gun-mantlet armor in the turret's +/-30 degree arc. */
  gunMantletArmor?: boolean;
  /** Hardcore rule: Step 3 target class may come from units.csv. */
  unitDamageTargetClass?: boolean;
  /** Hardcore rule: excessive tank main-gun penetration may overpenetrate vehicle targets. */
  overpenetration?: boolean;
  /** Hardcore rule: a controlled AT gun exposes its three-man operator group to MG fire. */
  atGunCrewTargets?: boolean;
  /** Hardcore rule: tank MG attacks must identify the hull or coaxial weapon being used. */
  hardcoreTankMachineGuns?: boolean;
  /** Weapon selected for this tank MG attack. */
  tankMachineGun?: TankMachineGun;
  /** The intact turret will reach the target direction before coaxial or combined MG fire. */
  tankMachineGunWillTraverse?: boolean;
  /** Hardcore rule: infantry may attack an enemy tank sharing its hex. */
  sameHexInfantryTankAttack?: boolean;
  /** Hardcore rule: a tank main gun may target ordinary infantry with HE. */
  mainGunSuppressesInfantry?: boolean;
  /** Hardcore main-gun ammunition, loaded by players or selected automatically by AI. */
  shellType?: ShellType;
  /** 命中等级规则区分主炮/步兵武器与机枪；缺省按主炮/普通攻击处理。 */
  attackKind?: 'main' | 'mg';
}

export type TankMachineGun = 'hull' | 'coaxial' | 'both';

export interface TankMachineGunSelection {
  weapon: TankMachineGun;
  /** Whether an intact turret should turn toward the target before firing. */
  rotateTurret: boolean;
}

/** Select the fixed hull MG, turret coaxial MG, or both under hardcore rules. */
export function selectTankMachineGun(
  attacker: Unit,
  targetDirection: FireDirection,
  turretCanReachTarget: boolean,
): TankMachineGunSelection | null {
  if (!isTankUnit(attacker) || attacker.facing === null) return null;
  // Casemate tanks have no independently traversable turret weapon. Keep both
  // their hull-mounted and superstructure-mounted MG fire on the hull's single
  // forward ray in every rules mode.
  if (attacker.stats.visionType === 'fixed' && targetDirection !== attacker.facing) return null;
  const turretFacing = (attacker.turretFacing ?? attacker.facing) as FireDirection;
  const hullMachineGunOperational = attacker.crew?.coDriver !== false;
  // A forward target uses both guns only when the intact turret is already
  // aligned or can finish aligning during this action. Otherwise the hull MG
  // may fire alone while an intact turret still attempts its partial traverse.
  if (hullMachineGunOperational && targetDirection === attacker.facing) {
    if (!attacker.turretDamaged && (turretFacing === targetDirection || turretCanReachTarget)) {
      return {
        weapon: 'both',
        rotateTurret: turretFacing !== targetDirection,
      };
    }
    return {
      weapon: 'hull',
      rotateTurret: !attacker.turretDamaged && turretFacing !== targetDirection,
    };
  }
  if (turretFacing === targetDirection) return { weapon: 'coaxial', rotateTurret: false };
  if (attacker.turretDamaged || !turretCanReachTarget) return null;
  return { weapon: 'coaxial', rotateTurret: true };
}

export interface HitThresholdModifierDetail {
  labelKey: string;
  value: number;
}

/** Rules-facing firing direction. Flank targets retain the current halfway turret direction. */
export function attackFireDirection(ctx: AttackContext): FireDirection | null {
  const { attacker, target, map } = ctx;
  if (ctx.expandedTurretDirections && attacker.stats.visionType === 'turreted') {
    const flankDirection = diagonalGunnerRuleDirectionForVisibleHex(
      map, attacker, target.pos, ctx.weather, ctx.smokeHexes,
    );
    if (flankDirection !== null) return flankDirection;
    return fireDirectionTo(attacker.pos, target.pos);
  }
  return directionTo(attacker.pos, target.pos);
}

/**
 * Smoke rules follow the active hardcore capability flags. Some MG and turn-end
 * call sites carry a narrower hardcore context than main-gun attacks, so no
 * single capability flag is a sufficient mode discriminator on its own.
 */
function usesHardcoreSmokeRules(ctx: AttackContext): boolean {
  return ctx.expandedTurretDirections === true
    || ctx.hardcoreTankMachineGuns === true
    || ctx.sameHexInfantryTankAttack === true;
}

/** Smoke blocks firing rays only in hardcore mode; classic smoke is a hit modifier only. */
function firingRaySmokeHexes(ctx: AttackContext): ReadonlySet<string> | undefined {
  return usesHardcoreSmokeRules(ctx) ? ctx.smokeHexes : undefined;
}

function unitIsInSmoke(ctx: AttackContext, unit: Unit): boolean {
  return ctx.smokeHexes?.has(HexMap.keyOf(unit.pos)) === true || unit.smoked === true;
}

/** 本次攻击使用的临时穿甲值，不修改单位基础属性。 */
export interface EffectivePenetrationBreakdown {
  basePenetration: number;
  effectiveRange: number;
  distance: number;
  rangePenalty: number;
  penetration: number;
  penetrationBonus?: number;
  effectiveRangeBonus?: number;
}

export function effectivePenetrationBreakdown(attacker: Unit, target: Unit, enabled = false): EffectivePenetrationBreakdown {
  const basePenetration = attacker.stats.penetration;
  const effectiveRange = attacker.stats.effectiveRange;
  const distance = hexDistance(attacker.pos, target.pos);
  const rangePenalty = enabled ? Math.max(0, distance - effectiveRange) : 0;
  return {
    basePenetration,
    effectiveRange,
    distance,
    rangePenalty,
    penetration: Math.max(0, basePenetration - rangePenalty),
  };
}

export function effectivePenetration(attacker: Unit, target: Unit, enabled = false): number {
  return effectivePenetrationBreakdown(attacker, target, enabled).penetration;
}

export const HVAP_PENETRATION_BONUS = 2;
export const HVAP_EFFECTIVE_RANGE_BONUS = 2;

/** HVAP follows AP rules with its penetration and effective-range bonuses applied before range falloff. */
export function attackEffectivePenetrationBreakdown(ctx: AttackContext): EffectivePenetrationBreakdown {
  const hvap = ctx.shellType === 'hvap';
  const basePenetration = ctx.attacker.stats.penetration;
  const penetrationBonus = hvap ? HVAP_PENETRATION_BONUS : 0;
  const baseEffectiveRange = ctx.attacker.stats.effectiveRange;
  const effectiveRangeBonus = hvap ? HVAP_EFFECTIVE_RANGE_BONUS : 0;
  const effectiveRange = baseEffectiveRange + effectiveRangeBonus;
  const distance = hexDistance(ctx.attacker.pos, ctx.target.pos);
  const rangePenalty = ctx.effectiveRangePenetration ? Math.max(0, distance - effectiveRange) : 0;
  return {
    basePenetration,
    effectiveRange: baseEffectiveRange,
    distance,
    rangePenalty,
    penetration: Math.max(0, basePenetration + penetrationBonus - rangePenalty),
    penetrationBonus,
    effectiveRangeBonus,
  };
}

export function attackEffectivePenetration(ctx: AttackContext): number {
  return attackEffectivePenetrationBreakdown(ctx).penetration;
}

const PACIFIC_UNIT_KINDS: ReadonlySet<UnitKind> = new Set<UnitKind>([
  'type95',
  'type97',
  'type4',
  'at_gun',
  'japanese_infantry',
  'heavy_artillery',
]);

function isPacificCombat(ctx: AttackContext): boolean {
  return ctx.theater === 'pacific'
    || PACIFIC_UNIT_KINDS.has(ctx.attacker.kind)
    || PACIFIC_UNIT_KINDS.has(ctx.target.kind);
}

function hitDoublesKillOpenHatchCommander(ctx: AttackContext, d1: number, d2: number): boolean {
  return isHostile(ctx.attacker, ctx.target)
    && isTankUnit(ctx.target)
    && d1 === d2
    && !!ctx.target.hatchOpen
    && !!ctx.target.crew?.commander;
}

/**
 * canAttack 返回的 reason 为 i18n key（由 UI 层用 t(reason) 翻译），
 * 保持 core 层和文案无关，避免双语循环依赖。
 */
export type AttackDenyReason =
  | 'attack.reason.selfFire'
  | 'attack.reason.destroyedTarget'
  | 'attack.reason.gunVsInfantry'
  | 'attack.reason.overlap'
  | 'attack.reason.notStraight'
  | 'attack.reason.fixedGunFacing'
  | 'attack.reason.blocked'
  | 'attack.reason.outOfRange'
  | 'attack.reason.turretDamaged'
  | 'attack.reason.camouflageNet';

function isForwardOnlyGun(unit: Unit): boolean {
  // A controlled hardcore AT gun is represented as turreted only while its
  // dedicated AI evaluates/executes whole-mount 12-direction fire. Ordinary
  // AT guns and artillery retain the legacy six-direction fixed-gun rule.
  return unit.stats.visionType === 'fixed'
    || (isAntiTankGunUnit(unit) && unit.stats.visionType !== 'turreted')
    || unit.kind === 'heavy_artillery';
}

/** Infantry attacks are limited to an adjacent hex, including anti-tank attacks. */
export function infantryAttackRange(_target: Unit): number {
  return 1;
}

export function canAttack(ctx: AttackContext): { ok: boolean; reason?: AttackDenyReason } {
  const { attacker, target, map } = ctx;
  if (target === attacker) return { ok: false, reason: 'attack.reason.selfFire' };
  if (target.destroyed) return { ok: false, reason: 'attack.reason.destroyedTarget' };
  const infantryAttack = isFootUnit(attacker);
  const suppressionAttack = ctx.mainGunSuppressesInfantry === true
    && ctx.shellType === 'he'
    && isTankUnit(attacker)
    && isFootUnit(target)
    && target.kind !== 'officer';
  if (isFootUnit(target) && !infantryAttack) {
    if (!suppressionAttack) return { ok: false, reason: 'attack.reason.gunVsInfantry' };
  }
  // §3.5 炮塔受损：主炮无法旋转 / 开火（MG 仍然可以，但本函数只用于主炮攻击路径）
  if (attacker.turretDamaged) return { ok: false, reason: 'attack.reason.turretDamaged' };
  const sameHexInfantryTankAttack = isSameHexInfantryTankAttack(ctx);
  const distance = hexDistance(attacker.pos, target.pos);
  if (target.hidden
    && target.campaignHiddenLongRangeUntargetable === true
    && isHostile(attacker, target)
    && distance > 2) {
    return { ok: false, reason: 'attack.reason.camouflageNet' };
  }
  if (distance === 0 && !sameHexInfantryTankAttack) {
    return { ok: false, reason: 'attack.reason.overlap' };
  }
  // A same-hex infantry attack has no firing ray to validate. Its hit and
  // penetration calculations still use the normal breakdown, where distance is 0.
  if (sameHexInfantryTankAttack) return { ok: true };
  const raySmokeHexes = firingRaySmokeHexes(ctx);
  // Infantry weapons, including anti-tank launchers, are adjacent-hex attacks.
  if (infantryAttack) {
    const range = infantryAttackRange(target);
    if (distance > range) return { ok: false, reason: 'attack.reason.outOfRange' };
    return map.hasLineOfSight(attacker.pos, target.pos, raySmokeHexes)
      ? { ok: true }
      : { ok: false, reason: 'attack.reason.blocked' };
  }
  // 经典模式沿用六条轴向射线；硬核模式的炮塔主炮另可使用六条夹角射线。
  const flankDirection = ctx.expandedTurretDirections && attacker.stats.visionType === 'turreted'
    ? diagonalGunnerRuleDirectionForVisibleHex(map, attacker, target.pos, ctx.weather, raySmokeHexes)
    : null;
  const fireDir = flankDirection ?? attackFireDirection(ctx);
  if (fireDir === null) return { ok: false, reason: 'attack.reason.notStraight' };
  if (isForwardOnlyGun(attacker) && attacker.facing !== fireDir) {
    return { ok: false, reason: 'attack.reason.fixedGunFacing' };
  }
  const hasSight = flankDirection !== null || (ctx.expandedTurretDirections
    && attacker.stats.visionType === 'turreted'
    && isDiagonalFireDirection(fireDir)
    ? map.hasDiagonalLineOfSight(attacker.pos, target.pos, fireDir, raySmokeHexes)
    : map.hasLineOfSight(attacker.pos, target.pos, raySmokeHexes));
  if (!hasSight) return { ok: false, reason: 'attack.reason.blocked' };
  return { ok: true };
}

/** 命中所需 = 体型 + 距离 + 树篱数 + 建筑格 + 烟雾 + 隐蔽 */
export interface HitBreakdownOptions {
  includeRearArc?: boolean;
  frontArcModifier?: number;
}

export function hitThreshold(ctx: AttackContext, opts: HitBreakdownOptions = {}): number {
  const b = hitBreakdown(ctx, opts);
  return b.threshold;
}

/** 命中阈值的逐项分解，用于 UI"为什么需要 N"展示。 */
export interface HitBreakdown {
  size: number;
  distance: number;
  /**
   * 路径上的树篱数（每个 +1）；**紧挨攻击者的那一段树篱不计**——
   * 即攻击者格 → 第一邻格之间的树篱（无论编码在攻击者格指向邻格、还是编码在邻格指向攻击者格）一律免计。
   * 详见 `HexMap.countHedgesAlong` 的实现注释与 GDD §3.4 Step 1。
   */
  hedges: number;
  building: number;     // 0 或 1
  smoke: number;        // 经典：目标在烟中 +1；硬核：攻击者或目标在烟中 +2
  concealed: number;    // 0 或 2 —— 目标隐蔽（§3.5）
  threshold: number;    // base modifiers + theater/arc modifiers + actionModifier
  trees?: number;
  rearArc?: number;
  frontArc?: number;
  actionModifier?: number;
  weather?: number;
  unitLevel?: number;
}

export function hitBreakdown(ctx: AttackContext, opts: HitBreakdownOptions = {}): HitBreakdown {
  const { attacker, target, map } = ctx;
  const distance = hexDistance(attacker.pos, target.pos);
  const hedges = map.countHedgesAlong(attacker.pos, target.pos);
  const targetTile = map.get(target.pos);
  const building = targetTile?.hasBuilding ? 1 : 0;
  const size = target.stats.size;
  const smoke = usesHardcoreSmokeRules(ctx)
    ? (unitIsInSmoke(ctx, attacker) || unitIsInSmoke(ctx, target) ? 2 : 0)
    : (unitIsInSmoke(ctx, target) ? 1 : 0);
  const concealed = target.hidden && !isInfantryAttacker(attacker) ? 2 : 0;
  const pacific = isPacificCombat(ctx);
  const trees = pacific ? countPacificTreesAlong(ctx) : 0;
  const includeRearArc = opts.includeRearArc ?? true;
  const rearArc = includeRearArc && pacific && isTankUnit(attacker)
    && attacker.facing !== null && isTargetInRearArc(attacker, target) ? 1 : 0;
  const frontArcModifier = opts.frontArcModifier ?? 0;
  const actionModifier = ctx.hitThresholdModifier ?? 0;
  const weather = weatherHitThresholdModifier(ctx.weather);
  const unitLevel = unitLevelHitThresholdModifier(attacker, target, ctx.attackKind ?? 'main');
  return {
    size, distance, hedges, building, smoke, concealed, trees, rearArc, frontArc: frontArcModifier, actionModifier, weather, unitLevel,
    threshold: size + distance + hedges + building + smoke + concealed + trees + rearArc
      + frontArcModifier + actionModifier + weather + unitLevel,
  };
}

function countPacificTreesAlong(ctx: AttackContext): number {
  const path = hexLine(ctx.attacker.pos, ctx.target.pos);
  let n = 0;
  for (let i = 1; i < path.length; i++) {
    if (ctx.map.get(path[i])?.terrain === 'trees') n++;
  }
  return n;
}

function isTargetInRearArc(attacker: Unit, target: Unit): boolean {
  if (attacker.facing === null) return false;
  const bearing = directionTo(attacker.pos, target.pos) ?? approximateDirection(attacker.pos, target.pos);
  const diff = rotateDirection(bearing, -attacker.facing);
  return diff === 2 || diff === 3 || diff === 4;
}

function isTargetInFrontArc(attacker: Unit, target: Unit): boolean {
  if (attacker.facing === null) return false;
  const bearing = directionTo(attacker.pos, target.pos) ?? approximateDirection(attacker.pos, target.pos);
  return bearing === attacker.facing;
}

function isInfantryAttacker(attacker: Unit): boolean {
  return isFootUnit(attacker);
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

function isProtagonistTarget(ctx: AttackContext): boolean {
  return ctx.protagonist ? ctx.target === ctx.protagonist : isPlayerControlled(ctx.target);
}

/**
 * 攻击方向相对目标车体朝向的夹角 → 装甲面。
 * diff=0 正面；diff=±1 前侧；diff=±2 后侧；diff=3 后方。
 *
 *  bearing 取「从目标格心指向攻击者格心」的离散六向，与 §3.3「方向圈」及主炮 `canAttack`
 *  的共线判定一致：同射线时优先 `directionTo`，避免仅用 `approximateDirection` 与真实轴线
 *  在个别格对上出现偏差。
 */
export function incomingAngleFrom(target: Unit, attackerPos: Axial): number {
  if (target.facing === null) return 0;
  const bearing = fireDirectionTo(target.pos, attackerPos)
    ?? approximateFireDirection(target.pos, attackerPos);
  const facingStep = target.facing * 2;
  const diff = (fireDirectionStep(bearing) - facingStep + 12) % 12;
  const clockwiseAngle = diff * 30;
  return clockwiseAngle <= 180 ? clockwiseAngle : clockwiseAngle - 360;
}

export function attackDirectionRuleFrom(target: Unit, attackerPos: Axial): AttackDirectionRule {
  const angle = incomingAngleFrom(target, attackerPos);
  return ATTACK_DIRECTION_RULES[angle] ?? ATTACK_DIRECTION_RULES[0];
}

export function attackDirectionRuleFromFireDirection(target: Unit, fireDirection: FireDirection): AttackDirectionRule {
  if (target.facing === null) return ATTACK_DIRECTION_RULES[0];
  const incomingStep = (fireDirectionStep(fireDirection) + 6) % 12;
  const diff = (incomingStep - target.facing * 2 + 12) % 12;
  const clockwiseAngle = diff * 30;
  const angle = clockwiseAngle <= 180 ? clockwiseAngle : clockwiseAngle - 360;
  return ATTACK_DIRECTION_RULES[angle] ?? ATTACK_DIRECTION_RULES[0];
}

function isSameHexInfantryTankAttack(ctx: AttackContext): boolean {
  return ctx.sameHexInfantryTankAttack === true
    && isFootUnit(ctx.attacker)
    && isTankUnit(ctx.target)
    && isHostile(ctx.attacker, ctx.target)
    && hexDistance(ctx.attacker.pos, ctx.target.pos) === 0;
}

function attackDirectionRuleFor(ctx: AttackContext): AttackDirectionRule {
  // Infantry sharing a tank's hex attacks it from its vulnerable rear.
  if (isSameHexInfantryTankAttack(ctx)) return ATTACK_DIRECTION_RULES[180];
  const flankDirection = ctx.expandedTurretDirections
    ? diagonalGunnerRuleDirectionForVisibleHex(ctx.map, ctx.attacker, ctx.target.pos, ctx.weather)
    : null;
  return flankDirection !== null
    ? attackDirectionRuleFromFireDirection(ctx.target, flankDirection)
    : attackDirectionRuleFrom(ctx.target, ctx.attacker.pos);
}

export function armorFaceFrom(target: Unit, attackerPos: Axial): ArmorFace {
  return attackDirectionRuleFrom(target, attackerPos).armorFace;
}

export function damageCheckTypeFrom(target: Unit, attackerPos: Axial): DamageCheckType {
  return attackDirectionRuleFrom(target, attackerPos).damageCheckType;
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
 * Resolve the incoming shot direction on the same 12-step compass used by
 * hardcore turrets. The selected red/blue flank hexes beside a halfway ray
 * deliberately inherit that ray, so both sides of (for example) a 90-degree
 * shot are treated as exactly 90 degrees rather than being rounded apart.
 */
function incomingFireDirectionStepFor(ctx: AttackContext): number | null {
  if (hexDistance(ctx.attacker.pos, ctx.target.pos) === 0) return null;
  const flankDirection = ctx.expandedTurretDirections
    ? diagonalGunnerRuleDirectionForVisibleHex(ctx.map, ctx.attacker, ctx.target.pos, ctx.weather, ctx.smokeHexes)
    : null;
  const outgoing = flankDirection
    ?? fireDirectionTo(ctx.attacker.pos, ctx.target.pos)
    ?? approximateFireDirection(ctx.attacker.pos, ctx.target.pos);
  return (fireDirectionStep(outgoing) + 6) % 12;
}

export function gunMantletArmorBonus(ctx: AttackContext): number {
  const { target } = ctx;
  const bonus = target.stats.gunMantletArmor ?? 0;
  if (!ctx.gunMantletArmor
    || bonus <= 0
    || !isTankUnit(target)
    || target.stats.visionType !== 'turreted') return 0;
  const incomingStep = incomingFireDirectionStepFor(ctx);
  const turretFacing = target.turretFacing ?? target.facing;
  if (incomingStep === null || turretFacing === null) return 0;
  return isWithinThirtyDegreeArc(incomingStep, turretFacing) ? bonus : 0;
}

/** Both tank mantlets and AT-gun shields protect the facing ray and its two adjacent 30-degree rays. */
function isWithinThirtyDegreeArc(incomingStep: number, facing: FireDirection): boolean {
  const delta = Math.abs(incomingStep - fireDirectionStep(facing));
  return Math.min(delta, 12 - delta) <= 1;
}

export function effectiveArmorValue(ctx: AttackContext, face: ArmorFace): number {
  return armorValue(ctx.target, face) + gunMantletArmorBonus(ctx);
}

export type HighExplosiveOutcome =
  | 'none'
  | 'paralyzed'
  | 'suppressed'
  | 'destroyed'
  | 'fire_suppressed';

export type NonPlayerTankWeapon = ShellType | 'mg';

/** Hardcore non-player tanks choose a weapon automatically from target class and range. */
export function nonPlayerTankWeaponForTarget(target: Unit, distance: number): NonPlayerTankWeapon {
  const ordinaryInfantry = isFootUnit(target) && target.kind !== 'officer';
  if (ordinaryInfantry || isAntiTankGunUnit(target)) return distance <= 1 ? 'mg' : 'he';
  if (target.kind === 'truck') return 'he';
  // Tanks/assault guns and heavy-artillery bunkers are AP targets.
  return 'ap';
}

/** A standalone HE report: normal hit first, then target-specific blast resolution. */
export interface HighExplosiveReport {
  dice: [number, number];
  roll: number;
  threshold: number;
  hit: boolean;
  /** Ordinary infantry is automatically hit by HE and skips the normal hit roll. */
  automaticHit?: boolean;
  hitBreakdown: HitBreakdown;
  hitModifiers?: HitThresholdModifierDetail[];
  armorFace?: ArmorFace;
  armor?: number;
  highExplosivePower: number;
  effectDice?: number[];
  effectRoll?: number;
  effectThreshold?: number;
  fireThreshold?: number;
  infantryInCover?: boolean;
  outcome: HighExplosiveOutcome;
  commanderKilledByHitDoubles?: boolean;
  commanderShieldBlocked?: boolean;
}

/** Buildings, woods and a friendly tank in the same hex improve infantry's HE survival. */
export function infantryHasHighExplosiveCover(ctx: AttackContext): boolean {
  const tile = ctx.map.get(ctx.target.pos);
  if (tile?.hasBuilding || tile?.terrain === 'forest' || tile?.terrain === 'trees') return true;
  return ctx.units?.some(unit => unit !== ctx.target
    && !unit.destroyed
    && isSameSide(unit, ctx.target)
    && isTankUnit(unit)
    && unit.pos.q === ctx.target.pos.q
    && unit.pos.r === ctx.target.pos.r) === true;
}

export function rollHighExplosiveInfantryOutcome(
  inCover: boolean,
  rng: RNG,
): { die: number; threshold: number; outcome: 'destroyed' | 'suppressed' } {
  const die = rng.d6();
  const threshold = inCover ? 6 : 5;
  return { die, threshold, outcome: die >= threshold ? 'destroyed' : 'suppressed' };
}

/** Resolve hardcore HE without any AP penetration, range falloff or damage-table roll. */
export function rollHighExplosiveAttack(ctx: AttackContext, rng: RNG): HighExplosiveReport {
  const { attacker, target } = ctx;
  const lockedHitBreakdown = hitBreakdown(ctx);
  const automaticHit = isFootUnit(target) && target.kind !== 'officer';
  const d1 = automaticHit ? 0 : rng.d6();
  const d2 = automaticHit ? 0 : rng.d6();
  const roll = automaticHit ? 0 : d1 + d2;
  const threshold = automaticHit ? 0 : lockedHitBreakdown.threshold;
  const hit = automaticHit || roll >= threshold;
  const hitModifiers = ctx.hitThresholdModifiers?.filter(item => item.value !== 0).map(item => ({ ...item }));
  const power = attacker.stats.highExplosivePower ?? 0;
  const base: HighExplosiveReport = {
    dice: [d1, d2], roll, threshold, hit, automaticHit, hitBreakdown: lockedHitBreakdown,
    hitModifiers, highExplosivePower: power, outcome: 'none',
  };
  if (hit) {
    const commanderDeathTriggered = !automaticHit && hitDoublesKillOpenHatchCommander(ctx, d1, d2);
    base.commanderShieldBlocked = commanderDeathTriggered && target.campaignCommanderShieldAvailable === true;
    base.commanderKilledByHitDoubles = commanderDeathTriggered && !base.commanderShieldBlocked;
  }
  // Tank HE pre-rolls its blast dice for presentation even on a miss. The
  // outcome remains none and is never applied unless the hit check succeeded.
  if (!hit && !isTankUnit(target)) return base;

  if (isFootUnit(target)) {
    const infantryInCover = infantryHasHighExplosiveCover(ctx);
    const infantryEffect = rollHighExplosiveInfantryOutcome(infantryInCover, rng);
    const effectRoll = infantryEffect.die;
    const effectThreshold = infantryEffect.threshold;
    return {
      ...base, infantryInCover, effectDice: [effectRoll], effectRoll, effectThreshold,
      outcome: infantryEffect.outcome,
    };
  }
  if (target.kind === 'truck' || isAntiTankGunUnit(target)) {
    return { ...base, outcome: 'destroyed' };
  }

  const directionRule = attackDirectionRuleFor(ctx);
  const armorFace = directionRule.armorFace;
  const armor = effectiveArmorValue(ctx, armorFace);
  if (isHeavyArtilleryUnit(target)) {
    if ((target.fireLevel ?? 0) > 0) {
      return { ...base, armorFace, armor, outcome: 'suppressed' };
    }
    const effectDice = [rng.d6(), rng.d6()];
    const effectRoll = effectDice[0] + effectDice[1];
    const effectThreshold = armor - power - 2;
    const fireThreshold = armor - power;
    const outcome: HighExplosiveOutcome = effectRoll >= fireThreshold
      ? 'fire_suppressed'
      : effectRoll >= effectThreshold ? 'suppressed' : 'none';
    return { ...base, armorFace, armor, effectDice, effectRoll, effectThreshold, fireThreshold, outcome };
  }
  if (isTankUnit(target)) {
    const effectDice = [rng.d6(), rng.d6()];
    const effectRoll = effectDice[0] + effectDice[1];
    const effectThreshold = armor - power;
    return {
      ...base, armorFace, armor, effectDice, effectRoll, effectThreshold,
      outcome: hit && effectRoll >= effectThreshold ? 'paralyzed' : 'none',
    };
  }
  return { ...base, outcome: 'destroyed' };
}

export function applyHighExplosiveAttack(target: Unit, report: HighExplosiveReport): void {
  markAmbushTargeted(target);
  if (!report.hit) return;
  if (report.commanderShieldBlocked && target.campaignCommanderShieldAvailable === true) {
    target.campaignCommanderShieldAvailable = false;
  }
  if (report.commanderKilledByHitDoubles && target.crew?.commander) target.crew.commander = false;
  switch (report.outcome) {
    case 'destroyed': target.destroyed = true; break;
    case 'paralyzed':
      if (target.campaignParalyzedProtectionAvailable === true) {
        target.campaignParalyzedProtectionAvailable = false;
      } else {
        target.paralyzed = true;
      }
      break;
    case 'suppressed': target.suppressed = true; break;
    case 'fire_suppressed':
      target.suppressed = true;
      target.fireLevel = Math.max(1, target.fireLevel ?? 0);
      break;
    case 'none': break;
  }
  neutralizeUncrewedTank(target);
}

function damageTargetClassFor(target: Unit, protagonistTarget: boolean, useConfiguredClass = false): DamageTargetClass | null {
  if (protagonistTarget) return 'protagonist';
  if (useConfiguredClass && target.stats.damageTargetClass) return target.stats.damageTargetClass as DamageTargetClass;
  if (!isTankUnit(target)) return null;
  return battleSideIdOf(target) === 'player' ? 'us_tank' : 'german_tank';
}

function crewRoleSlot(role: DamageTableCrewRole): CrewSlot {
  switch (role) {
    case 'commander': return 1;
    case 'loader': return 2;
    case 'gunner': return 3;
    case 'driver': return 4;
    case 'coDriver': return 5;
  }
}

function isEffectApplicable(target: Unit, effect: DamageTableEffect): boolean {
  switch (effect.kind) {
    case 'destroyed':
    case 'fire':
      return true;
    case 'turret':
      return !target.turretDamaged;
    case 'paralyzed':
      return !target.paralyzed;
    case 'radio':
      return target.stats.hasRadio !== false && target.radioDamaged !== true;
    case 'crew':
      return !!effect.crew?.some(role => !target.crew || isCrewAlive(target.crew, crewRoleSlot(role)));
  }
}

function damageEffectStepFrom(target: Unit, effect: DamageTableEffect): DamageEffectStep {
  return {
    effect: effect.kind === 'crew' ? 'crewCheck' : effect.kind,
    ...(effect.kind === 'crew'
      ? (() => {
        const crewPriority = (effect.crew ?? []).map(crewRoleSlot);
        return { crewPriority, crewSlot: firstAliveCrewSlot(target, crewPriority) };
      })()
      : {}),
  };
}

function isDamageEffectSuppressed(target: Unit, effect: DamageEffect): boolean {
  return (effect === 'destroyed' && target.ignoreDestroyedDamage === true)
    || (effect === 'crewCheck' && target.ignoreCrewCheckDamage === true);
}

function resolveDamageTableEffects(
  target: Unit,
  targetClass: DamageTargetClass,
  damageCheckType: DamageCheckType,
  die: number,
): DamageEffectStep[] {
  const entry = DAMAGE_TABLE[targetClass][damageCheckType][die];
  for (const group of entry.groups) {
    const applicable = group.filter(effect => isEffectApplicable(target, effect));
    // A protected result is cancelled in-place: do not fall through to a later
    // group, because wet racks / spall liners explicitly do not reroll or seek
    // the next executable damage action.
    if (applicable.length > 0) {
      return applicable
        .map(effect => damageEffectStepFrom(target, effect))
        .filter(step => !isDamageEffectSuppressed(target, step.effect));
    }
  }
  return [];
}

function primaryDamageEffect(effects: readonly DamageEffectStep[]): DamageEffect | undefined {
  const priority: DamageEffect[] = ['destroyed', 'crewCheck', 'turret', 'paralyzed', 'radio', 'fire', 'damaged'];
  for (const effect of priority) {
    if (effects.some(step => step.effect === effect)) return effect;
  }
  return effects[0]?.effect;
}

function isOverpenetrationVehicleTarget(target: Unit): boolean {
  return !isFootUnit(target)
    && !isAntiTankGunUnit(target)
    && target.kind !== 'heavy_artillery'
    && target.kind !== 'german_heavy_artillery';
}

function isOverpenetrationSuppressedEffect(effect: DamageEffect): boolean {
  return effect === 'fire' || effect === 'destroyed';
}

/**
 * 纯掷骰 + 计算结果（不修改 target）。返回的 report 描述"如果应用，会发生什么"。
 * 拆分出来是为了让 UI 先播掷骰动画，等动画结束再调用 applyAttack 真正落实伤害，
 * 这样玩家能看清楚每颗骰子点数与命中阈值，再看到目标变色。
 */
export function rollAttack(ctx: AttackContext, rng: RNG): AttackReport {
  const { attacker, target } = ctx;
  const pacific = isPacificCombat(ctx);
  const protagonistTarget = isProtagonistTarget(ctx);
  const d1 = rng.d6();
  const d2 = rng.d6();
  const roll = d1 + d2;
  const infantryVsATGunCrew = isFootUnit(attacker) && isControlledATGun(target);
  const lockedHitBreakdown = infantryVsATGunCrew
    ? hitBreakdown({
        ...ctx,
        target: {
          ...target,
          stats: {
            ...target.stats,
            size: target.atGunCrewTargetSize ?? 0,
          },
        },
      })
    : hitBreakdown(ctx);
  const threshold = lockedHitBreakdown.threshold;
  const hit = roll >= threshold;
  const hitModifiers = ctx.hitThresholdModifiers?.filter(item => item.value !== 0).map(item => ({ ...item }));
  const commanderDeathTriggered = hit && hitDoublesKillOpenHatchCommander(ctx, d1, d2);
  const commanderShieldBlocked = commanderDeathTriggered && target.campaignCommanderShieldAvailable === true;
  const commanderKilledByHitDoubles = commanderDeathTriggered && !commanderShieldBlocked;

  // A crewed AT gun is a small-arms target for attacking infantry. Resolve
  // the exposed operators exactly like infantry instead of testing the rifle
  // round against the gun carriage's armour.
  if (infantryVsATGunCrew) {
    return {
      dice: [d1, d2], roll, threshold, hit, hitBreakdown: lockedHitBreakdown, hitModifiers,
      penetrated: hit,
      damageEffect: hit ? 'destroyed' : undefined,
      damageEffects: hit ? [{ effect: 'destroyed' }] : [],
      commanderKilledByHitDoubles: false,
      commanderShieldBlocked: false,
      protagonistTarget,
      smallArms: true,
      statusChange: hit ? 'destroyed' : 'none',
    };
  }

  // Small-arms fire between foot units is settled by the hit roll alone.
  // A hit destroys the target immediately, so no penetration dice are rolled
  // or included in the report shown to the player.
  if (isFootUnit(attacker) && isFootUnit(target)) {
    return {
      dice: [d1, d2], roll, threshold, hit, hitBreakdown: lockedHitBreakdown, hitModifiers,
      penetrated: hit,
      damageEffect: hit ? 'destroyed' : undefined,
      damageEffects: hit ? [{ effect: 'destroyed' }] : [],
      commanderKilledByHitDoubles: false,
      commanderShieldBlocked: false,
      protagonistTarget,
      smallArms: true,
      statusChange: hit ? 'destroyed' : 'none',
    };
  }

  const directionRule = attackDirectionRuleFor(ctx);
  const face = directionRule.armorFace;
  const damageCheckType = ctx.directionalDamageCheck ? directionRule.damageCheckType : undefined;
  const damageTable = damageCheckType ?? 'front';
  const targetClass = damageCheckType ? damageTargetClassFor(target, protagonistTarget, ctx.unitDamageTargetClass) : null;
  const gunMantletArmor = gunMantletArmorBonus(ctx);
  const armor = armorValue(target, face) + gunMantletArmor;
  const penetrationBreakdown = attackEffectivePenetrationBreakdown(ctx);
  const pen = penetrationBreakdown.penetration;

  // 第二段：穿甲检定。Europe / Pacific 统一使用 2d6。
  const penDice = [rng.d6(), rng.d6()];
  const penDie = penDice.reduce((a, b) => a + b, 0);
  const penThreshold = armor - pen;
  const penetrated = penDie >= penThreshold;
  const overpenetrated = penetrated
    && ctx.overpenetration === true
    && ctx.attackKind !== 'mg'
    && isTankUnit(attacker)
    && isOverpenetrationVehicleTarget(target)
    && penDie - penThreshold > 6;
  const directDestroyOnBurningTank = !!damageCheckType
    && !!targetClass
    && !protagonistTarget
    && (target.fireLevel ?? 0) > 0;
  const directDestroyByTargetClass = targetClass === 'destroyed';
  const damagePossible = !directDestroyByTargetClass
    && !directDestroyOnBurningTank
    && (!!targetClass || !(pacific && !protagonistTarget));
  const stagedDamageDie = damagePossible ? rng.d6() : undefined;
  const rawStagedDamageEffects = stagedDamageDie !== undefined && targetClass
    ? resolveDamageTableEffects(target, targetClass, damageTable, stagedDamageDie)
    : undefined;
  const rawStagedDamageEffect = rawStagedDamageEffects
    ? primaryDamageEffect(rawStagedDamageEffects)
    : (stagedDamageDie !== undefined
      ? (pacific && protagonistTarget
        ? resolvePacificShermanDamageEffect(stagedDamageDie, damageTable)
        : resolveDamageEffect(target, stagedDamageDie, protagonistTarget, damageTable))
      : undefined);
  const overpenetrationSuppressedEffects: DamageEffect[] = overpenetrated
    ? Array.from(new Set([
      ...(rawStagedDamageEffects ?? []).map(step => step.effect),
      ...(rawStagedDamageEffect ? [rawStagedDamageEffect] : []),
      ...((directDestroyByTargetClass || directDestroyOnBurningTank) ? ['destroyed' as DamageEffect] : []),
    ].filter(isOverpenetrationSuppressedEffect)))
    : [];
  const stagedDamageEffects = rawStagedDamageEffects?.filter(
    step => !(overpenetrated && isOverpenetrationSuppressedEffect(step.effect)),
  );
  const filteredStagedDamageEffect = stagedDamageEffects
    ? primaryDamageEffect(stagedDamageEffects)
    : (rawStagedDamageEffect && overpenetrated && isOverpenetrationSuppressedEffect(rawStagedDamageEffect)
      ? undefined
      : rawStagedDamageEffect);
  const stagedDamageEffect = filteredStagedDamageEffect && isDamageEffectSuppressed(target, filteredStagedDamageEffect)
    ? undefined
    : filteredStagedDamageEffect;
  const tableCrewCheck = stagedDamageEffects?.some(step => step.effect === 'crewCheck' && !!step.crewPriority?.length) ?? false;
  const legacyCrewCheck = protagonistTarget && damagePossible && stagedDamageEffect === 'crewCheck' && !tableCrewCheck;
  let stagedCrewCheck: CrewDeathResult | undefined;
  if (legacyCrewCheck) {
    const crewTarget = commanderKilledByHitDoubles && target.crew
      ? { ...target, crew: { ...target.crew, commander: false } }
      : target;
    stagedCrewCheck = resolveCrewCheck(crewTarget, rng);
  }

  if (!hit) {
    return {
      dice: [d1, d2], roll, threshold, hit: false, hitBreakdown: lockedHitBreakdown, hitModifiers,
      armorFace: face, armor, gunMantletArmor, penetration: pen, penetrationBreakdown,
      damageCheckType,
      penDie, penDice, penThreshold, penetrated, overpenetrated, overpenetrationSuppressedEffects,
      stagedDamageDie, stagedDamageEffect, stagedDamageEffects, stagedCrewCheck,
      commanderKilledByHitDoubles: false,
      commanderShieldBlocked: false,
      protagonistTarget,
      statusChange: 'none',
    };
  }

  if (!penetrated) {
    return {
      dice: [d1, d2], roll, threshold, hitBreakdown: lockedHitBreakdown, hitModifiers,
      hit: true,
      armorFace: face, armor, gunMantletArmor, penetration: pen, penetrationBreakdown,
      damageCheckType,
      penDie, penDice, penThreshold, penetrated, overpenetrated, overpenetrationSuppressedEffects,
      stagedDamageDie, stagedDamageEffect, stagedDamageEffects, stagedCrewCheck,
      commanderKilledByHitDoubles,
      commanderShieldBlocked,
      protagonistTarget,
      statusChange: 'none',
    };
  }

  if (directDestroyByTargetClass || directDestroyOnBurningTank || (pacific && !protagonistTarget && !targetClass)) {
    if (overpenetrated || isDamageEffectSuppressed(target, 'destroyed')) {
      return {
        dice: [d1, d2], roll, threshold, hitBreakdown: lockedHitBreakdown, hitModifiers,
        hit: true,
        armorFace: face, armor, gunMantletArmor, penetration: pen, penetrationBreakdown,
        damageCheckType,
        penDie, penDice, penThreshold, penetrated, overpenetrated, overpenetrationSuppressedEffects,
        damageEffects: [],
        stagedDamageDie, stagedDamageEffect, stagedDamageEffects, stagedCrewCheck,
        commanderKilledByHitDoubles,
        commanderShieldBlocked,
        protagonistTarget,
        statusChange: 'none',
      };
    }
    return {
      dice: [d1, d2], roll, threshold, hitBreakdown: lockedHitBreakdown, hitModifiers,
      hit: true,
      armorFace: face, armor, gunMantletArmor, penetration: pen, penetrationBreakdown,
      damageCheckType,
      penDie, penDice, penThreshold, penetrated, overpenetrated, overpenetrationSuppressedEffects,
      damageEffect: 'destroyed',
      damageEffects: [{ effect: 'destroyed' }],
      stagedDamageDie, stagedDamageEffect, stagedDamageEffects, stagedCrewCheck,
      commanderKilledByHitDoubles,
      commanderShieldBlocked,
      protagonistTarget,
      statusChange: 'destroyed',
    };
  }

  // 第三段：伤害检定（§3.4 Step 3；Pacific 主角使用 M4 Damage 表）
  const damageDie = stagedDamageDie!;
  const damageEffect = stagedDamageEffect;
  const damageEffects = stagedDamageEffects ?? (damageEffect ? [{ effect: damageEffect }] : []);
  if (!damageEffect && damageEffects.length === 0) {
    return {
      dice: [d1, d2], roll, threshold, hitBreakdown: lockedHitBreakdown, hitModifiers,
      hit: true,
      armorFace: face, armor, gunMantletArmor, penetration: pen, penetrationBreakdown,
      damageCheckType,
      penDie, penDice, penThreshold, penetrated, overpenetrated, overpenetrationSuppressedEffects,
      damageDie, damageEffects,
      stagedDamageDie, stagedDamageEffect, stagedDamageEffects, stagedCrewCheck,
      commanderKilledByHitDoubles,
      commanderShieldBlocked,
      protagonistTarget,
      statusChange: 'none',
    };
  }
  const statusChange: HitStatusChange = damageEffect === 'destroyed' ? 'destroyed' : 'damaged';

  // 兼容旧式 crewCheck：需要时才携带乘员检定结果。
  const crewCheck = damageEffect === 'crewCheck' ? stagedCrewCheck : undefined;

  return {
    dice: [d1, d2], roll, threshold, hitBreakdown: lockedHitBreakdown, hitModifiers,
    hit: true,
    armorFace: face, armor, gunMantletArmor, penetration: pen, penetrationBreakdown,
    damageCheckType,
    penDie, penDice, penThreshold, penetrated, overpenetrated, overpenetrationSuppressedEffects,
    damageDie, damageEffect, damageEffects,
    stagedDamageDie, stagedDamageEffect, stagedDamageEffects, stagedCrewCheck,
    crewCheck,
    commanderKilledByHitDoubles,
    commanderShieldBlocked,
    protagonistTarget,
    statusChange,
  };
}

export function resolvePacificShermanDamageEffect(die: number, damageCheckType: DamageCheckType = 'front'): DamageEffect {
  switch (damageCheckType) {
    case 'front':
    case 'right':
    case 'left':
    case 'rear':
      return resolvePacificShermanDamageEffectByDie(die);
  }
}

/**
 * §3.4 Step 3 伤害结果表。两条路线（主角 / 其他坦克）；
 * 步兵等单位按"其他坦克"路线处理（MVP 下不会成为被击穿的目标）。
 */
export function resolveDamageEffect(
  target: Unit,
  die: number,
  protagonistTarget = isPlayerControlled(target),
  damageCheckType: DamageCheckType = 'front',
): DamageEffect {
  if (protagonistTarget) {
    switch (damageCheckType) {
      case 'front':
      case 'right':
      case 'left':
      case 'rear':
        return resolveShermanDamageEffectByDie(die);
    }
  }
  // 其他坦克：5/6 直接摧毁；1-4 受损，已受损则升级为摧毁
  if (die >= 5) return 'destroyed';
  return target.damaged ? 'destroyed' : 'damaged';
}

function resolveShermanDamageEffectByDie(die: number): DamageEffect {
  switch (die) {
    case 1: return 'destroyed';
    case 2: return 'fire';
    case 3:
    case 4: return 'fire';
    case 5: return 'turret';
    case 6:
    default: return 'paralyzed';
  }
}

function resolvePacificShermanDamageEffectByDie(die: number): DamageEffect {
  switch (die) {
    case 1: return 'fire';
    case 2:
    case 3:
    case 4: return 'fire';
    case 5: return 'turret';
    default: return 'paralyzed';
  }
}

/**
 * §3.2 + §3.4 的"乘员阵亡检定"。
 *
 * 规则：
 *   - 1d6 = 1..5 → 直接映射到 1=车长 / 2=装填手 / 3=炮手 / 4=驾驶员 / 5=副驾驶
 *   - 1d6 = 6     → 仅在车长"打开舱盖"时 → 车长阵亡；否则视为虚惊（无人阵亡）
 *   - 已死乘员需重新掷骰（§3.2 脚注）：若映射到的乘员已死亡，则重抛。
 *     兜底：最多重抛 N 次，若全员皆死则返回 slot=null（虚惊），避免死循环。
 *
 * 返回 CrewDeathResult；调用方在 applyAttack 里真正把对应 crew 字段置 false。
 */
export function resolveCrewCheck(target: Unit, rng: RNG): CrewDeathResult {
  const crew = target.crew;
  let rerolled = false;
  const MAX_REROLL = 12;
  for (let i = 0; i < MAX_REROLL; i++) {
    const die = rng.d6();
    const slot = mapCrewDie(die, !!target.hatchOpen);
    if (slot === null) {
      // 舱盖关闭时的 6 = 虚惊，规则上不再重抛：直接返回
      return { die, slot: null, rerolled };
    }
    // 有具体乘员编号：若已死，按脚注重抛；否则接受结果
    if (!crew || isCrewAlive(crew, slot)) {
      return { die, slot, rerolled };
    }
    rerolled = true;
  }
  // 全员已死的极端情况（或连 MAX_REROLL 次都滚到死人）：当作虚惊返回
  return { die: 0, slot: null, rerolled };
}

/** 1d6 → 乘员编号；舱盖开的 6 = 车长；舱盖关的 6 = null（虚惊） */
export function mapCrewDie(die: number, hatchOpen: boolean): CrewSlot | null {
  if (die >= 1 && die <= 5) return die as CrewSlot;
  if (die === 6) return hatchOpen ? 1 : null;
  return null;
}

export function isCrewAlive(crew: ShermanCrew, slot: CrewSlot): boolean {
  switch (slot) {
    case 1: return crew.commander;
    case 2: return crew.loader;
    case 3: return crew.gunner;
    case 4: return crew.driver;
    case 5: return crew.coDriver;
  }
}

/** 将 crew 字典里对应 slot 的字段置 false（仅在该乘员当前存活时生效）。 */
export function killCrewSlot(crew: ShermanCrew, slot: CrewSlot): void {
  switch (slot) {
    case 1: crew.commander = false; break;
    case 2: crew.loader = false;    break;
    case 3: crew.gunner = false;    break;
    case 4: crew.driver = false;    break;
    case 5: crew.coDriver = false;  break;
  }
}

function firstAliveCrewSlot(target: Unit, priority: readonly CrewSlot[] | undefined): CrewSlot | null {
  if (!priority || priority.length === 0) return null;
  for (const slot of priority) {
    if (!target.crew || isCrewAlive(target.crew, slot)) return slot;
  }
  return null;
}

function applyDamageEffectStep(target: Unit, step: DamageEffectStep, protagonistTarget: boolean): void {
  switch (step.effect) {
    case 'destroyed':
      target.destroyed = true;
      break;
    case 'damaged':
      if (!protagonistTarget) target.damaged = true;
      break;
    case 'fire':
      target.fireLevel = (target.fireLevel ?? 0) + 1;
      break;
    case 'turret':
      target.turretDamaged = true;
      break;
    case 'paralyzed':
      if (target.campaignParalyzedProtectionAvailable === true) {
        target.campaignParalyzedProtectionAvailable = false;
      } else {
        target.paralyzed = true;
      }
      break;
    case 'radio':
      target.radioDamaged = true;
      break;
    case 'crewCheck': {
      if (step.crewPriority?.length) {
        const slot = step.crewSlot ?? firstAliveCrewSlot(target, step.crewPriority);
        if (slot !== null && target.crew) {
          killCrewSlot(target.crew, slot);
        }
      }
      break;
    }
  }
}

/**
 * 把 rollAttack 得出的 report 真正写入 target。
 * 未命中 / 未击穿 → 不改任何字段（跳弹）。
 * 击穿 → 按 §3.4 Step 3 的 damageEffect 映射到具体状态位。
 *
 * 注：`damaged` 主要用于其他坦克「首次受伤」；主角不写入该位，
 * 着火用 fireLevel，炮塔 / 瘫痪 / 乘员等有独立字段。
 */
export function applyAttack(target: Unit, report: AttackReport): void {
  markAmbushTargeted(target);
  if (report.smallArms && isControlledATGun(target)) {
    if (report.hit) {
      target.atGunCrewAlive = false;
      target.faction = 'neutral';
    }
    return;
  }
  if (report.hit && report.commanderShieldBlocked && target.campaignCommanderShieldAvailable === true) {
    target.campaignCommanderShieldAvailable = false;
  }
  if (report.hit && report.commanderKilledByHitDoubles && target.crew?.commander) {
    target.crew.commander = false;
  }
  if (!report.hit) {
    neutralizeUncrewedTank(target);
    return;
  }
  if (!report.penetrated) {
    neutralizeUncrewedTank(target);
    return;
  }
  const effect = report.damageEffect;
  const protagonistTarget = report.protagonistTarget ?? isPlayerControlled(target);
  const markHullDamaged = !protagonistTarget;
  if (report.damageEffects?.length) {
    for (const step of report.damageEffects) {
      if (step.effect === 'crewCheck' && !step.crewPriority?.length) {
        if (report.crewCheck && report.crewCheck.slot !== null && target.crew) {
          killCrewSlot(target.crew, report.crewCheck.slot);
        }
        continue;
      }
      applyDamageEffectStep(target, step, protagonistTarget);
    }
    neutralizeUncrewedTank(target);
    return;
  }
  // 历史分支（未带 damageEffect 的旧 report）：按 statusChange 走二段式
  if (!effect) {
    if (report.statusChange === 'destroyed') target.destroyed = true;
    else if (report.statusChange === 'damaged' && markHullDamaged) target.damaged = true;
    neutralizeUncrewedTank(target);
    return;
  }
  switch (effect) {
    case 'destroyed':
      target.destroyed = true;
      break;
    case 'damaged':
      if (markHullDamaged) target.damaged = true;
      break;
    case 'fire':
      if (markHullDamaged) target.damaged = true;
      target.fireLevel = (target.fireLevel ?? 0) + 1;
      break;
    case 'turret':
      if (markHullDamaged) target.damaged = true;
      target.turretDamaged = true;
      break;
    case 'paralyzed':
      if (markHullDamaged) target.damaged = true;
      if (target.campaignParalyzedProtectionAvailable === true) {
        target.campaignParalyzedProtectionAvailable = false;
      } else {
        target.paralyzed = true;
      }
      break;
    case 'crewCheck':
      // §3.4 Step 3 d6=2：再掷 1d6 决定哪位乘员阵亡。crewCheck.slot === null 表示虚惊。
      if (markHullDamaged) target.damaged = true;
      if (report.crewCheck && report.crewCheck.slot !== null && target.crew) {
        killCrewSlot(target.crew, report.crewCheck.slot);
      }
      break;
  }
  neutralizeUncrewedTank(target);
}

/** 一步到位：掷骰 + 写入。无需动画时（如自动测试）使用。 */
export function resolveAttack(ctx: AttackContext, rng: RNG): AttackReport {
  const report = rollAttack(ctx, rng);
  applyAttack(ctx.target, report);
  return report;
}

// ---------- 机枪（MG）攻击 ----------
//
// §3.6 行动表 B 列 3/4 + C 列 2：机枪射击步兵。
// 乘员门控在 BattleScene.selectMGDie：B 列机枪不因乘员阵亡禁用；C 列副驾驶机枪需副驾驶存活。
// 相对主炮攻击的差异：
//   - 目标仅限机枪步兵目标（欧洲徒步类 / Pacific 日本步兵），且必须在 2 格内的同一直线可视范围内
//   - 单段 1d6 检定：点数 ≥ 命中公式 = 命中；命中即直接击毙（徒步单位无装甲）
//   - 吃距离 / 树篱 / 建筑 / 烟雾 / 隐蔽修正；硬核坦克仅两挺机枪齐射时命中所需 -1
//   - 不消耗 `loaded`、不受 `turretDamaged` 限制（机枪与主炮独立）
//
// canMGAttack 返回的 reason 同样是 i18n key，由 UI 层翻译。

/** 旧版机枪固定阈值；保留导出以兼容外部引用。 */
export const MG_HIT_THRESHOLD = 7;

/** 所有坦克机枪的最大射程（格）。 */
export const MG_MAX_RANGE = 1;

export type MGDenyReason =
  | 'attack.reason.selfFire'
  | 'attack.reason.destroyedTarget'
  | 'attack.reason.mgRange'
  | 'attack.reason.notStraight'
  | 'attack.reason.blocked'
  | 'attack.reason.notInfantry'
  | 'attack.reason.mgDirection';

function sameHex(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

function tankCoordinationBonus(unit: Unit): number {
  return Math.max(0, unit.stats.infantryTankCoordination ?? 0);
}

function mgTankCoordinationModifier(ctx: AttackContext): number {
  if (!isFootUnit(ctx.target)) return 0;
  const units = ctx.units;
  if (!units) return 0;
  let bonus = 0;
  for (const u of units) {
    if (u === ctx.target || u.destroyed || !sameHex(u.pos, ctx.target.pos)) continue;
    bonus = Math.max(bonus, tankCoordinationBonus(u));
  }
  return bonus;
}

export function canMGAttack(ctx: AttackContext): { ok: boolean; reason?: MGDenyReason } {
  const { attacker, target, map } = ctx;
  if (target === attacker) return { ok: false, reason: 'attack.reason.selfFire' };
  if (target.destroyed) return { ok: false, reason: 'attack.reason.destroyedTarget' };
  const atGunCrewTarget = ctx.atGunCrewTargets === true && isControlledATGun(target);
  if (!isFootUnit(target) && !atGunCrewTarget) return { ok: false, reason: 'attack.reason.notInfantry' };
  const distance = hexDistance(attacker.pos, target.pos);
  if (distance === 0 || distance > MG_MAX_RANGE) return { ok: false, reason: 'attack.reason.mgRange' };
  const raySmokeHexes = firingRaySmokeHexes(ctx);
  const flankDirection = ctx.expandedTurretDirections
    ? diagonalGunnerRuleDirectionForVisibleHex(map, attacker, target.pos, ctx.weather, raySmokeHexes)
    : null;
  const fireDir = flankDirection ?? attackFireDirection(ctx);
  if (fireDir === null) return { ok: false, reason: 'attack.reason.notStraight' };
  if (isTankUnit(attacker)
    && attacker.stats.visionType === 'fixed'
    && attacker.facing !== fireDir) {
    return { ok: false, reason: 'attack.reason.mgDirection' };
  }
  if (ctx.hardcoreTankMachineGuns && isTankUnit(attacker)) {
    const turretFacing = (attacker.turretFacing ?? attacker.facing) as FireDirection | null;
    const hullMachineGunOperational = attacker.crew?.coDriver !== false;
    if (!ctx.tankMachineGun
      || (ctx.tankMachineGun === 'hull'
        && (!hullMachineGunOperational || fireDir !== attacker.facing))
      || (ctx.tankMachineGun === 'coaxial'
        && fireDir !== turretFacing
        && (attacker.turretDamaged || !ctx.tankMachineGunWillTraverse))
      || (ctx.tankMachineGun === 'both'
        && (!hullMachineGunOperational
          || attacker.turretDamaged
          || fireDir !== attacker.facing
          || (fireDir !== turretFacing && !ctx.tankMachineGunWillTraverse)))) {
      return { ok: false, reason: 'attack.reason.mgDirection' };
    }
  }
  const hasSight = flankDirection !== null || (ctx.expandedTurretDirections && isDiagonalFireDirection(fireDir)
    ? map.hasDiagonalLineOfSight(attacker.pos, target.pos, fireDir, raySmokeHexes)
    : map.hasLineOfSight(attacker.pos, target.pos, raySmokeHexes));
  if (!hasSight) return { ok: false, reason: 'attack.reason.blocked' };
  return { ok: true };
}

export interface MGReport {
  dice: [number, number];
  hitDiceCount: number;
  hitBonus: number;
  roll: number;
  threshold: number;
  hit: boolean;
  hitBreakdown?: HitBreakdown;
  hitModifiers?: HitThresholdModifierDetail[];
}

export function mgHitThreshold(ctx: AttackContext): number {
  const base = mgHitBreakdown(ctx);
  return base.threshold
    + mgTankCoordinationModifier(ctx)
    + atGunShieldModifier(ctx);
}

/** A controlled AT gun's shield uses the same +/-30-degree protection arc as a tank gun mantlet. */
function atGunShieldModifier(ctx: AttackContext): number {
  if (ctx.atGunCrewTargets !== true || !isControlledATGun(ctx.target)) return 0;
  const shieldFacing = ctx.target.turretFacing ?? ctx.target.facing;
  if (shieldFacing === null) return 0;
  const incomingStep = incomingFireDirectionStepFor(ctx);
  return incomingStep !== null && isWithinThirtyDegreeArc(incomingStep, shieldFacing) ? 1 : 0;
}

export function mgHitBreakdown(ctx: AttackContext): HitBreakdown {
  const frontArcModifier = ctx.hardcoreTankMachineGuns && isTankUnit(ctx.attacker)
    ? (ctx.tankMachineGun === 'both' ? -1 : 0)
    : (isTargetInFrontArc(ctx.attacker, ctx.target) ? -1 : 0);
  const atGunCrewTarget = ctx.atGunCrewTargets === true && isControlledATGun(ctx.target);
  const hitContext = atGunCrewTarget
    ? {
        ...ctx,
        target: {
          ...ctx.target,
          stats: {
            ...ctx.target.stats,
            size: ctx.target.atGunCrewTargetSize ?? 0,
          },
        },
      }
    : ctx;
  return hitBreakdown({ ...hitContext, attackKind: 'mg' }, { includeRearArc: false, frontArcModifier });
}

export function rollMGAttack(ctx: AttackContext, rng: RNG): MGReport {
  const d1 = rng.d6();
  const roll = d1;
  const threshold = mgHitThreshold(ctx);
  return {
    dice: [d1, 0], hitDiceCount: 1, hitBonus: 0, roll, threshold, hit: roll >= threshold,
    hitBreakdown: mgHitBreakdown(ctx),
    hitModifiers: mgHitThresholdModifierDetails(ctx),
  };
}

export function mgHitThresholdModifierDetails(ctx: AttackContext): HitThresholdModifierDetail[] {
  const details = ctx.hitThresholdModifiers?.filter(item => item.value !== 0).map(item => ({ ...item })) ?? [];
  const coordination = mgTankCoordinationModifier(ctx);
  const atGunShield = atGunShieldModifier(ctx);
  if (coordination) details.push({ labelKey: 'dice.rule.infantryTankCoordination', value: coordination });
  if (atGunShield) details.push({ labelKey: 'dice.rule.atGunCrewTarget', value: atGunShield });
  return details;
}

export function maxMGHitRoll(ctx: AttackContext): number {
  return 6;
}

/** 写入机枪攻击结果：命中 = 目标直接击毙。 */
export function applyMGAttack(target: Unit, report: Pick<MGReport, 'hit'>): void {
  markAmbushTargeted(target);
  if (!report.hit) return;
  if (isControlledATGun(target)) {
    target.atGunCrewAlive = false;
    target.faction = 'neutral';
    return;
  }
  target.destroyed = true;
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

  const directionRule = attackDirectionRuleFor(ctx);
  const face = directionRule.armorFace;
  const armor = effectiveArmorValue(ctx, face);
  const pen = attackEffectivePenetration(ctx);
  const penThreshold = armor - pen;
  const penProb = probHit2d6(penThreshold);

  return {
    hit: { ...hb, probability: hitProb },
    pen: { armorFace: face, armor, penetration: pen, threshold: penThreshold, probability: penProb },
    jointProbability: hitProb * penProb,
  };
}
