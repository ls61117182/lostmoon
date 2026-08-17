import { isFootUnit, isTankUnit, Unit } from './types';

/**
 * Pick the unit a main-gun hex click represents. A vehicle/gun in a hex shields
 * co-located infantry from being selected for suppression. Input order remains
 * the tie-breaker when a hex contains multiple targets of the same category.
 */
export function selectMainGunTargetsByHex(targets: readonly Unit[]): Unit[] {
  const selected = new Map<string, Unit>();
  for (const target of targets) {
    if (target.destroyed) continue;
    const key = `${target.pos.q},${target.pos.r}`;
    const current = selected.get(key);
    if (!current || (isFootUnit(current) && !isFootUnit(target))) {
      selected.set(key, target);
    }
  }
  return Array.from(selected.values());
}

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
