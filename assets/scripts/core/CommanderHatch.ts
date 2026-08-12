import { GameMode } from './GameMode';
import { isTankUnit, Unit } from './types';

export type CommanderHatchVisualState = 'hidden' | 'occupied' | 'empty';

/**
 * Visual-only hatch state. An open hatch remains visible after the commander
 * dies, but uses the empty-hatch sprite instead of the occupied commander art.
 */
export function commanderHatchVisualState(unit: Unit): CommanderHatchVisualState {
  if (unit.destroyed || !isTankUnit(unit) || unit.hatchOpen !== true) return 'hidden';
  return unit.crew?.commander === false ? 'empty' : 'occupied';
}

/**
 * Hardcore AI tank hatch rule. Only the protagonist may be controlled by the
 * player, so every other living tank decides its hatch state at action start.
 * An existing open hatch on a destroyed tank or a tank whose commander is
 * dead does not reserve the faction's living commander slot.
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
    && other.crew?.commander !== false
    && other.hatchOpen === true,
  );
}
