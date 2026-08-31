import { getAllUnitKinds, getUnitStats } from './UnitDB';
import { isTankKind } from './types';
import type { MissionData, UnitKind } from './types';

/** The first-run and invalid-data fallback used by both the menu and battle scene. */
export const DEFAULT_PLAYER_TANK_KIND: UnitKind = 'sherman';

/** Keep the menu list data-driven so newly registered tanks become selectable automatically. */
export function selectablePlayerTankKinds(): UnitKind[] {
  return getAllUnitKinds().filter(isTankKind);
}

export function normalizeSelectedPlayerTankKind(kind: unknown): UnitKind {
  return typeof kind === 'string' && isTankKind(kind as UnitKind)
    ? kind as UnitKind
    : DEFAULT_PLAYER_TANK_KIND;
}

/**
 * Create a mission view using the globally selected protagonist tank.
 *
 * Position, facing, crew state and all scenario-specific player placement fields
 * stay intact. National faction follows the selected vehicle, while MissionLoader
 * independently assigns the local player side/controller at runtime.
 */
export function missionWithSelectedPlayerTank(data: MissionData, selectedKind: unknown): MissionData {
  const source = data.playerTank ?? data.sherman;
  if (!source) return data;

  const kind = normalizeSelectedPlayerTankKind(selectedKind);
  const playerTank = {
    ...source,
    kind,
    faction: getUnitStats(kind, data.theater ?? 'europe').faction,
  };
  return {
    ...data,
    playerTank,
    // Preserve the compatibility alias expected by existing mission/save code.
    sherman: playerTank,
  };
}
