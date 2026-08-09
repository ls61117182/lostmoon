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

/**
 * Fire/smoke intensity rendered above a unit.
 * Newly destroyed tanks always use the existing level-1 effect for the rest
 * of the current turn; older wrecks and destroyed non-tanks render no fire.
 */
export function visualFireEffectLevel(
  unit: Unit,
  playerUnitId?: string,
  destroyedThisTurn = false,
): number {
  if (unit.destroyed) return destroyedThisTurn && isTankUnit(unit) ? 1 : 0;
  return visualDamageSmokeLevel(unit, playerUnitId);
}
