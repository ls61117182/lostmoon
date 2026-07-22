import { GameMode } from './GameMode';
import { isTankUnit, Unit } from './types';

/**
 * Hardcore AI tank hatch rule. Only the protagonist may be controlled by the
 * player, so every other living tank decides its hatch state at action start.
 * An existing open hatch on a destroyed tank does not reserve the faction's
 * commander slot.
 */
export function shouldNonPlayerTankOpenCommanderHatch(
  unit: Unit,
  allUnits: readonly Unit[],
  protagonist: Unit,
  mode: GameMode,
): boolean {
  if (mode !== 'hardcore' || unit === protagonist || unit.destroyed || !isTankUnit(unit)
    || unit.crew?.commander === false) {
    return false;
  }

  if ((unit.fireLevel ?? 0) > 0) return true;

  return !allUnits.some(other =>
    other !== unit
    && !other.destroyed
    && other.faction === unit.faction
    && isTankUnit(other)
    && other.hatchOpen === true,
  );
}
