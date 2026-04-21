/**
 * 战斗结算 —— 纯函数，不依赖 Cocos，可直接 Jest 测。
 *
 * MVP 简化（相对手册的差异，以后补）：
 *   - 命中公式只算 "体型 + 距离 + 树篱 + 建筑"，忽略烟雾/隐蔽
 *   - 流程（§3.4 三段式）：
 *       ① 2d6 命中检定（阈值 = 体型 + 距离 + 树篱 + 建筑 + …）
 *       ② 命中后再掷 1d6 穿甲检定（d6 ≥ 装甲 - 穿甲 才击穿；未击穿 = 跳弹，命中无效）
 *       ③ 击穿后再掷 1d6 伤害检定（§3.4 Step 3 的伤害结果表）：
 *            谢尔曼： 1=摧毁 / 2=阵亡检定 / 3,4=着火 +1 / 5=炮塔受损 / 6=痛痪
 *            德军坦克： 1–4=受损（已受损→摧毁） / 5,6=摧毁
 *          → 对应效果写回 target 的 destroyed/damaged/fireLevel/turretDamaged/paralyzed
 *   - "阵亡检定"（d6=2，谢尔曼）未实装乘员抽签；MVP 简化等价于着火 +1，并打日志说明
 *   - 不处理对子（doubles）特殊事件
 *   - 不校验乘员存活（假设炮手总是可用）
 */

import { RNG } from './Dice';
import { HexMap, approximateDirection, directionTo, hexDistance, rotateDirection } from './HexGrid';
import { Axial, CrewSlot, ShermanCrew, Unit } from './types';

export type ArmorFace = 'front' | 'frontSide' | 'rearSide' | 'rear';

/** 本次攻击对目标状态的粗粒度改动：无变化 / 受损系列 / 直接摧毁。
 *  保留给存档和旧 UI 分支；精细效果见 AttackReport.damageEffect。 */
export type HitStatusChange = 'none' | 'damaged' | 'destroyed';

/**
 * §3.4 Step 3 伤害表的具体结果。
 *   - 'destroyed'   目标直接摧毁（谢 1；德 5,6；德 已受损时 1-4）
 *   - 'damaged'     受损（德军首次受伤；MVP 语义 = "起火状态"，下次击穿直接摧毁）
 *   - 'fire'        着火 / 着火程度 +1（谢尔曼 3,4）
 *   - 'turret'      炮塔受损：不能用主炮射击（谢尔曼 5）
 *   - 'paralyzed'   痛痪：不能前进/后退/转向（谢尔曼 6）
 *   - 'crewCheck'   阵亡检定：再掷 1d6 映射乘员 1-5（谢尔曼 2）。MVP 未实装乘员抽签，
 *                   视觉上等同 'fire' +1，保留该枚举值以便以后补
 */
export type DamageEffect =
  | 'destroyed'
  | 'damaged'
  | 'fire'
  | 'turret'
  | 'paralyzed'
  | 'crewCheck';

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
  /** 伤害检定分段：仅在 hit && penetrated 时有值 */
  damageDie?: number;       // 1d6 伤害表掷骰
  damageEffect?: DamageEffect;
  /** 阵亡检定分段：仅在 damageEffect === 'crewCheck' 时有值（目前只会在谢尔曼身上发生） */
  crewCheck?: CrewDeathResult;
  statusChange: HitStatusChange;
}

export interface AttackContext {
  attacker: Unit;
  target: Unit;
  map: HexMap;
}

/**
 * canAttack 返回的 reason 为 i18n key（由 UI 层用 t(reason) 翻译），
 * 保持 core 层和文案无关，避免双语循环依赖。
 */
export type AttackDenyReason =
  | 'attack.reason.selfFire'
  | 'attack.reason.destroyedTarget'
  | 'attack.reason.overlap'
  | 'attack.reason.notStraight'
  | 'attack.reason.blocked'
  | 'attack.reason.turretDamaged';

export function canAttack(ctx: AttackContext): { ok: boolean; reason?: AttackDenyReason } {
  const { attacker, target, map } = ctx;
  if (target === attacker) return { ok: false, reason: 'attack.reason.selfFire' };
  if (target.destroyed) return { ok: false, reason: 'attack.reason.destroyedTarget' };
  // §3.5 炮塔受损：主炮无法旋转 / 开火（MG 仍然可以，但本函数只用于主炮攻击路径）
  if (attacker.turretDamaged) return { ok: false, reason: 'attack.reason.turretDamaged' };
  if (hexDistance(attacker.pos, target.pos) === 0) return { ok: false, reason: 'attack.reason.overlap' };
  // 射角限制：只能朝 6 条轴向直线射击。directionTo 只在 from→to 落在某条六向射线上才返回
  // 方向编号，否则返回 null——非 null 即表示"同线"。
  if (directionTo(attacker.pos, target.pos) === null) return { ok: false, reason: 'attack.reason.notStraight' };
  if (!map.hasLineOfSight(attacker.pos, target.pos)) return { ok: false, reason: 'attack.reason.blocked' };
  return { ok: true };
}

/** 命中所需 = 体型 + 距离 + 树篱数 + 建筑格 + 烟雾 + 隐蔽 */
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
  smoke: number;        // 0 或 1 —— 目标处于烟雾掩护中（§3.5）
  concealed: number;    // 0 或 2 —— 目标隐蔽（§3.5）
  threshold: number;    // = size + distance + hedges + building + smoke + concealed
}

export function hitBreakdown(ctx: AttackContext): HitBreakdown {
  const { attacker, target, map } = ctx;
  const distance = hexDistance(attacker.pos, target.pos);
  const hedges = map.countHedgesAlong(attacker.pos, target.pos);
  const targetTile = map.get(target.pos);
  const building = targetTile?.terrain === 'building' ? 1 : 0;
  const size = target.stats.size;
  // §3.5 状态系统：烟雾掩护 +1；隐蔽 +2。两者都作用在目标身上（被打者的难命中度）。
  const smoke = target.smoked ? 1 : 0;
  const concealed = target.hidden ? 2 : 0;
  return {
    size, distance, hedges, building, smoke, concealed,
    threshold: size + distance + hedges + building + smoke + concealed,
  };
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

  if (!penetrated) {
    return {
      dice: [d1, d2], roll, threshold,
      hit: true,
      armorFace: face, armor, penetration: pen,
      penDie, penThreshold, penetrated,
      statusChange: 'none',
    };
  }

  // 第三段：伤害检定（§3.4 Step 3）
  const damageDie = rng.d6();
  const damageEffect = resolveDamageEffect(target, damageDie);
  const statusChange: HitStatusChange = damageEffect === 'destroyed' ? 'destroyed' : 'damaged';

  // 阵亡检定：只对谢尔曼（crewCheck）再掷一次，决定哪位乘员死
  let crewCheck: CrewDeathResult | undefined;
  if (damageEffect === 'crewCheck') {
    crewCheck = resolveCrewCheck(target, rng);
  }

  return {
    dice: [d1, d2], roll, threshold,
    hit: true,
    armorFace: face, armor, penetration: pen,
    penDie, penThreshold, penetrated,
    damageDie, damageEffect,
    crewCheck,
    statusChange,
  };
}

/**
 * §3.4 Step 3 伤害结果表。两条路线（谢尔曼 / 德军坦克）；
 * 步兵等单位按"德军坦克"路线处理（MVP 下不会成为被击穿的目标）。
 */
export function resolveDamageEffect(target: Unit, die: number): DamageEffect {
  const isSherman = target.kind === 'sherman';
  if (isSherman) {
    switch (die) {
      case 1: return 'destroyed';
      case 2: return 'crewCheck';
      case 3:
      case 4: return 'fire';
      case 5: return 'turret';
      case 6:
      default: return 'paralyzed';
    }
  }
  // 德军坦克：5/6 直接摧毁；1-4 受损，已受损则升级为摧毁
  if (die >= 5) return 'destroyed';
  return target.damaged ? 'destroyed' : 'damaged';
}

/**
 * §3.2 + §3.4 的"谢尔曼阵亡检定"。
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

/**
 * 把 rollAttack 得出的 report 真正写入 target。
 * 未命中 / 未击穿 → 不改任何字段（跳弹）。
 * 击穿 → 按 §3.4 Step 3 的 damageEffect 映射到具体状态位。
 *
 * 注：damaged 在本项目语义上代表"受损 / 起火中"的综合标志，任何非摧毁的有效击穿
 * 都会置 true，使谢尔曼的状态面板与地图外观能立刻反应"我被打中了"。更细分的字段
 * （fireLevel/turretDamaged/paralyzed）各自独立累积，便于文档化的 §3.5 状态系统实装。
 */
export function applyAttack(target: Unit, report: AttackReport): void {
  if (!report.hit) return;
  if (!report.penetrated) return;
  const effect = report.damageEffect;
  // 历史分支（未带 damageEffect 的旧 report）：按 statusChange 走二段式
  if (!effect) {
    if (report.statusChange === 'destroyed') target.destroyed = true;
    else if (report.statusChange === 'damaged') target.damaged = true;
    return;
  }
  switch (effect) {
    case 'destroyed':
      target.destroyed = true;
      break;
    case 'damaged':
      target.damaged = true;
      break;
    case 'fire':
      target.damaged = true;
      target.fireLevel = (target.fireLevel ?? 0) + 1;
      break;
    case 'turret':
      target.damaged = true;
      target.turretDamaged = true;
      break;
    case 'paralyzed':
      target.damaged = true;
      target.paralyzed = true;
      break;
    case 'crewCheck':
      // §3.4 Step 3 d6=2：再掷 1d6 决定哪位乘员阵亡。crewCheck.slot === null 表示虚惊。
      // 受伤状态仍然算作"被击穿"，因此 damaged=true；但不增加 fireLevel。
      target.damaged = true;
      if (report.crewCheck && report.crewCheck.slot !== null && target.crew) {
        killCrewSlot(target.crew, report.crewCheck.slot);
      }
      break;
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
