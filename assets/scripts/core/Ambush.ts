import type { GameMode } from './GameMode';
import type { Axial, CrewSkillId, ShermanCrew, Unit } from './types';
import { crewRoleAlive, isHostile, isTankUnit, resolvedLoadedShell } from './types';

/** 只有存活乘员携带的技能才对车组生效。 */
export function hasLivingCrewSkill(
  unit: Pick<Unit, 'crew' | 'crewSkills'>,
  skill: CrewSkillId,
): boolean {
  if (!unit.crewSkills) return false;
  for (const slot of Object.keys(unit.crewSkills) as Array<keyof ShermanCrew>) {
    if (unit.crew?.[slot] === false) continue;
    if (unit.crewSkills[slot]?.includes(skill)) return true;
  }
  return false;
}

/** An explicit loaded-gun stance is available only to an operational tank. */
export function canEnterAmbush(unit: Unit, mode: GameMode, automaticLoaded = false): boolean {
  // AI tanks use automatic main-gun ammunition; the player uses the loaded shell.
  const shell = resolvedLoadedShell(unit);
  return mode === 'hardcore' && !unit.destroyed && isTankUnit(unit)
    && !unit.turretDamaged && crewRoleAlive(unit, 'gunner')
    && (shell === 'ap' || shell === 'he' || (automaticLoaded && shell === null));
}

export function enterAmbush(
  unit: Unit, mode: GameMode, automaticLoaded = false, peers: readonly Unit[] = [],
): boolean {
  if (!canEnterAmbush(unit, mode, automaticLoaded)) return false;
  unit.ambushEnteredOrder = 1 + peers.reduce(
    (highest, peer) => Math.max(highest, peer.ambushEnteredOrder ?? 0), 0,
  );
  unit.ambushReadyThisTurn = true;
  return true;
}

/** The stance expires when the unit's next action begins. */
export function beginAmbushTurn(unit: Unit, _mode: GameMode): void {
  unit.ambushReadyThisTurn = false;
}

/** Ending the action leaves an established ambush ready through the opponent's turn. */
export function endAmbushTurn(_unit: Unit, _obscuredBySmoke = false): void {}

/** Being targeted alone does not cancel the stance. */
export function markAmbushTargeted(_unit: Unit): void {}

/** Hull movement, firing, and turret damage cancel the stance. */
export function markAmbushAction(unit: Unit): void {
  unit.ambushReadyThisTurn = false;
}

export function isInAmbushSight(
  position: Axial, visible: ReadonlySet<string>, keyOf: (hex: Axial) => string,
): boolean {
  return visible.has(keyOf(position));
}

export function orderedAmbushers(units: readonly Unit[], mover: Unit): Unit[] {
  if (mover.destroyed) return [];
  return units.filter(unit => unit !== mover && unit.ambushReadyThisTurn && isHostile(unit, mover))
    .sort((a, b) => (a.ambushEnteredOrder ?? 0) - (b.ambushEnteredOrder ?? 0));
}

export type AmbushAttackKind = 'main_gun' | 'machine_gun';

/** Reaction fire uses the ordinary hit roll. */
export function ambushHitThresholdModifier(
  _unit: Unit,
  _mode: GameMode,
  _attackKind: AmbushAttackKind = 'main_gun',
): number {
  return 0;
}

/** There are no ambush hit modifiers to show in the preview. */
export function ambushHitThresholdModifierDetails(
  _unit: Unit,
  _mode: GameMode,
  _attackKind: AmbushAttackKind = 'main_gun',
): Array<{ labelKey: string; value: number }> {
  return [];
}
