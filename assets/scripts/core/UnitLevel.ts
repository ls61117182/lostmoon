import { isFootUnit, isTankUnit } from './types';
import type { CrewLevels, ShermanCrew, Unit, UnitLevel } from './types';

export const DEFAULT_UNIT_LEVEL: UnitLevel = 'recruit';

/** JSON、旧存档及外部关卡统一从这里归一化，非法值安全回退为新兵。 */
export function normalizeUnitLevel(value: unknown): UnitLevel {
  return value === 'veteran' || value === 'elite' ? value : DEFAULT_UNIT_LEVEL;
}

export function uniformCrewLevels(level: UnitLevel): CrewLevels {
  return {
    commander: level,
    loader: level,
    gunner: level,
    driver: level,
    coDriver: level,
  };
}

/** 玩家乘员配置允许只填写部分槽位；未填写或非法值均按新兵处理。 */
export function normalizePlayerCrewLevels(value?: Partial<CrewLevels>): CrewLevels {
  return {
    commander: normalizeUnitLevel(value?.commander),
    loader: normalizeUnitLevel(value?.loader),
    gunner: normalizeUnitLevel(value?.gunner),
    driver: normalizeUnitLevel(value?.driver),
    coDriver: normalizeUnitLevel(value?.coDriver),
  };
}

/** 单位对外表现的有效等级；反坦克炮显示并使用操炮步兵等级。 */
export function unitLevelOf(unit: Pick<Unit, 'kind' | 'unitLevel' | 'atGunCrewLevel'>): UnitLevel {
  return unit.kind === 'at_gun'
    ? normalizeUnitLevel(unit.atGunCrewLevel)
    : normalizeUnitLevel(unit.unitLevel);
}

/**
 * 统一的乘员等级读取入口。
 * - 玩家坦克：读取每名乘员的独立等级；
 * - 非玩家坦克：所有乘员即时继承单位等级；
 * - 未来骰子等岗位效果应调用本函数，不直接读取字段。
 */
export function crewLevelFor(
  unit: Pick<Unit, 'kind' | 'unitLevel' | 'atGunCrewLevel' | 'crewLevels'>,
  slot: keyof ShermanCrew,
): UnitLevel {
  if (unit.crewLevels) {
    return normalizeUnitLevel(unit.crewLevels?.[slot]);
  }
  return unitLevelOf(unit);
}

export interface RankedDiceBonus {
  attack: number;
  move: number;
  misc: number;
}

/** 非玩家坦克的分类骰加成。玩家坦克通过独立乘员系统结算，不读取本表。 */
export function nonPlayerTankDiceBonus(unit: Unit): RankedDiceBonus {
  if (!isTankUnit(unit) || unit.crewLevels) return { attack: 0, move: 0, misc: 0 };
  switch (unitLevelOf(unit)) {
    case 'veteran': return { attack: 1, move: 1, misc: 0 };
    case 'elite': return { attack: 2, move: 1, misc: 1 };
    default: return { attack: 0, move: 0, misc: 0 };
  }
}

/** 反坦克炮的行动骰加成，等级来自操炮步兵。 */
export function atGunActionDiceBonus(unit: Unit): number {
  if (unit.kind !== 'at_gun') return 0;
  const level = unitLevelOf(unit);
  return level === 'elite' ? 2 : level === 'veteran' ? 1 : 0;
}

/** 硬核步兵每回合的动作规则：老兵第二次只能移动，王牌第二次可攻击或移动。 */
export function infantryTurnActions(unit: Unit): readonly ('attack_or_move' | 'move')[] {
  if (!isFootUnit(unit)) return [];
  switch (unitLevelOf(unit)) {
    case 'veteran': return ['attack_or_move', 'move'];
    case 'elite': return ['attack_or_move', 'attack_or_move'];
    default: return ['attack_or_move'];
  }
}

export type RankedAttackKind = 'main' | 'mg';

/** 等级带来的命中所需点数修正；负数更易命中，正数更难命中。 */
export function unitLevelHitThresholdModifier(
  attacker: Unit,
  target: Unit,
  attackKind: RankedAttackKind = 'main',
): number {
  let modifier = 0;

  // 非玩家老兵/王牌坦克：只有主炮攻击坦克时获得 -1。
  if (attackKind === 'main' && isTankUnit(attacker) && !attacker.crewLevels && isTankUnit(target)) {
    const level = unitLevelOf(attacker);
    if (level === 'veteran' || level === 'elite') modifier -= 1;
  }

  // 操炮步兵为老兵/王牌时，反坦克炮攻击坦克获得 -1。
  if (attackKind === 'main' && attacker.kind === 'at_gun' && isTankUnit(target)) {
    const level = unitLevelOf(attacker);
    if (level === 'veteran' || level === 'elite') modifier -= 1;
  }

  // 老兵/王牌步兵攻击坦克或步兵：命中所需点数 +1。
  if (isFootUnit(attacker) && (isTankUnit(target) || isFootUnit(target))) {
    const level = unitLevelOf(attacker);
    if (level === 'veteran' || level === 'elite') modifier += 1;
  }

  // 王牌坦克被坦克或步兵攻击、王牌步兵被坦克或步兵攻击：+1。
  if ((isTankUnit(attacker) || isFootUnit(attacker))
    && (isTankUnit(target) || isFootUnit(target))
    && unitLevelOf(target) === 'elite') {
    const eliteTank = isTankUnit(target) && !target.crewLevels;
    const eliteInfantry = isFootUnit(target);
    if (eliteTank || eliteInfantry) modifier += 1;
  }

  return modifier;
}
