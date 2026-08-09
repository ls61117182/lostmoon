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

export function unitLevelOf(unit: Pick<Unit, 'unitLevel'>): UnitLevel {
  return normalizeUnitLevel(unit.unitLevel);
}

/**
 * 统一的乘员等级读取入口。
 * - 玩家坦克：读取每名乘员的独立等级；
 * - 非玩家坦克：所有乘员即时继承单位等级；
 * - 未来骰子等岗位效果应调用本函数，不直接读取字段。
 */
export function crewLevelFor(
  unit: Pick<Unit, 'unitLevel' | 'crewLevels'>,
  slot: keyof ShermanCrew,
): UnitLevel {
  if (unit.crewLevels) {
    return normalizeUnitLevel(unit.crewLevels?.[slot]);
  }
  return unitLevelOf(unit);
}
