import { isTankUnit, Unit } from './types';

export function visualDamageSmokeLevel(unit: Unit, playerUnitId?: string): number {
  const fireLevel = Math.max(unit.fireLevel ?? 0, 0);
  const damagedNonPlayerTankLevel = playerUnitId !== undefined
    && unit.id !== playerUnitId
    && isTankUnit(unit)
    && unit.damaged
    ? 2
    : 0;
  return Math.max(fireLevel, damagedNonPlayerTankLevel);
}
