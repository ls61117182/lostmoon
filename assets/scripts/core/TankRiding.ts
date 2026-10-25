import { isAbandonedTank, isSameSide, isTankUnit, type Unit } from './types';

/** One three-person American squad occupies one tank's exterior seats. */
export function tankRiders(tank: Unit, units: readonly Unit[]): Unit[] {
  return units.filter(unit => !unit.destroyed && unit.mountedOnUnitId === tank.id);
}

function canCarryInfantry(tank: Unit): boolean {
  return isTankUnit(tank) && !tank.destroyed && !isAbandonedTank(tank)
    && (tank.fireLevel ?? 0) === 0;
}

export function canMountTank(infantry: Unit, tank: Unit, units: readonly Unit[]): boolean {
  return infantry.kind === 'american_infantry' && !infantry.destroyed
    && !infantry.suppressed && !infantry.attachedToATGunId && !infantry.mountedOnUnitId
    && canCarryInfantry(tank) && isSameSide(infantry, tank)
    && infantry.pos.q === tank.pos.q && infantry.pos.r === tank.pos.r
    && tankRiders(tank, units).length === 0;
}

export function mountTank(infantry: Unit, tank: Unit, units: readonly Unit[], random = Math.random): boolean {
  if (!canMountTank(infantry, tank, units)) return false;
  infantry.mountedOnUnitId = tank.id;
  // Presentation randomness is sampled only on boarding, independently of combat dice.
  infantry.mountedDoubleSide = random() < 0.5 ? 'left' : 'right';
  infantry.pos = { ...tank.pos };
  infantry.hidden = false;
  infantry.ambushReadyThisTurn = false;
  infantry.lockedFireTargetId = undefined;
  return true;
}

/** Dismount into the carrier's hex; the existing shared-hex formation takes over. */
export function dismountTank(infantry: Unit, units: readonly Unit[]): boolean {
  if (!infantry.mountedOnUnitId) return false;
  const tank = units.find(unit => unit.id === infantry.mountedOnUnitId);
  if (tank) infantry.pos = { ...tank.pos };
  infantry.mountedOnUnitId = undefined;
  infantry.mountedDoubleSide = undefined;
  return true;
}

/** Reconcile after movement, combat and loading, including invalid/stale saved links. */
export function syncTankRiders(units: readonly Unit[]): void {
  const byId = new Map(units.map(unit => [unit.id, unit]));
  const occupied = new Set<string>();
  for (const infantry of units) {
    if (!infantry.mountedOnUnitId) { infantry.mountedDoubleSide = undefined; continue; }
    const tank = byId.get(infantry.mountedOnUnitId);
    if (tank) infantry.pos = { ...tank.pos };
    if (infantry.destroyed || infantry.kind !== 'american_infantry' || infantry.attachedToATGunId
      || !tank || !canCarryInfantry(tank) || !isSameSide(infantry, tank)
      || occupied.has(tank.id)) {
      infantry.mountedOnUnitId = undefined;
      infantry.mountedDoubleSide = undefined;
    } else {
      occupied.add(tank.id);
      // Old saves lack the side. A stable ID hash also keeps both PVP peers in agreement.
      if (infantry.mountedDoubleSide !== 'left' && infantry.mountedDoubleSide !== 'right') {
        let hash = 0;
        for (const c of `${tank.id}:${infantry.id}`) hash = ((hash * 31) + c.charCodeAt(0)) | 0;
        infantry.mountedDoubleSide = (hash & 1) === 0 ? 'left' : 'right';
      }
    }
  }
}
