import { isFootUnit, isTankUnit, Unit } from './types';

/** Only ordinary infantry squads can be pinned by a hardcore tank main gun. */
export function isMainGunSuppressionAttack(attacker: Unit, target: Unit, hardcore: boolean): boolean {
  return hardcore
    && isTankUnit(attacker)
    && isFootUnit(target)
    && target.kind !== 'officer'
    && !target.destroyed;
}

/** Suppression is deterministic and replaces damage; repeated hits do not stack extra lost actions. */
export function applyInfantrySuppression(target: Unit): boolean {
  if (!isFootUnit(target) || target.kind === 'officer' || target.destroyed) return false;
  target.suppressed = true;
  return true;
}

/** Called exactly when the infantry's next action begins. */
export function consumeInfantrySuppression(unit: Unit): boolean {
  if (!unit.suppressed) return false;
  unit.suppressed = false;
  return true;
}
