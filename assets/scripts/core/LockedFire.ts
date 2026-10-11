import { isHostile, isTankUnit, Unit } from './types';

/** One bonus attack; a subsequent main-gun hit establishes a fresh lock. */
export function lockedFireModifier(attacker: Unit, target: Unit, enabled = false): number {
  return enabled && !attacker.destroyed && !target.destroyed
    && isTankUnit(attacker) && isTankUnit(target) && isHostile(attacker, target)
    && attacker.lockedFireTargetId === target.id ? -2 : 0;
}

export function clearLockedFire(unit: Unit): void {
  unit.lockedFireTargetId = undefined;
}

/** Called only for the primary target, never for HE collateral blast checks. */
export function finishLockedFireAttack(
  attacker: Unit, target: Unit, hit: boolean, enabled: boolean,
  weapon: 'main' | 'mg' | 'smoke' = 'main',
): void {
  if (!enabled || !isTankUnit(attacker)) return;
  clearLockedFire(attacker);
  if (weapon === 'main' && hit && !target.destroyed
    && isTankUnit(target) && isHostile(attacker, target)) {
    attacker.lockedFireTargetId = target.id;
  }
}
