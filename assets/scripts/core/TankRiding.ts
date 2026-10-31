import { isAbandonedTank, isFootUnit, isSameSide, isTankUnit, type Unit } from './types';

export function isRidingInfantry(unit: Unit): boolean {
  return isFootUnit(unit) && unit.kind !== 'officer';
}

/** One infantry squad occupies one tank's exterior seats. */
export function tankRiders(tank: Unit, units: readonly Unit[]): Unit[] {
  return units.filter(unit => !unit.destroyed && unit.mountedOnUnitId === tank.id);
}

/** Destruction kills the carried squad instead of evacuating it into the hex. */
export function destroyTankRiders(tank: Unit, units: readonly Unit[]): Unit[] {
  if (!isTankUnit(tank) || !tank.destroyed) return [];
  const casualties = tankRiders(tank, units);
  for (const infantry of casualties) {
    infantry.pos = { ...tank.pos };
    infantry.destroyed = true;
    infantry.mountedOnUnitId = undefined;
    infantry.mountedDoubleSide = undefined;
  }
  return casualties;
}

function canCarryInfantry(tank: Unit): boolean {
  return isTankUnit(tank) && !tank.destroyed && !isAbandonedTank(tank)
    && (tank.fireLevel ?? 0) === 0;
}

export function canMountTank(infantry: Unit, tank: Unit, units: readonly Unit[]): boolean {
  return isRidingInfantry(infantry) && !infantry.destroyed
    && !infantry.suppressed && !infantry.attachedToATGunId && !infantry.mountedOnUnitId
    && canCarryInfantry(tank) && isSameSide(infantry, tank) && infantry.faction === tank.faction
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

/** Other live infantry already occupy the landing hex, regardless of their side. */
export function canDismountTank(infantry: Unit, units: readonly Unit[]): boolean {
  if (!isRidingInfantry(infantry) || infantry.destroyed || !infantry.mountedOnUnitId) return false;
  const tank = units.find(unit => unit.id === infantry.mountedOnUnitId);
  if (!tank || tank.destroyed) return false;
  return !units.some(unit => unit.id !== infantry.id && !unit.destroyed && isFootUnit(unit)
    && unit.pos.q === tank.pos.q && unit.pos.r === tank.pos.r);
}

/** Voluntary dismount requires a free infantry slot in the carrier's hex. */
export function dismountTank(infantry: Unit, units: readonly Unit[]): boolean {
  if (!canDismountTank(infantry, units)) return false;
  const tank = units.find(unit => unit.id === infantry.mountedOnUnitId);
  if (tank) infantry.pos = { ...tank.pos };
  infantry.mountedOnUnitId = undefined;
  infantry.mountedDoubleSide = undefined;
  return true;
}

/** Called only when a real forward/reverse move starts, before its position changes. */
export function autoMountTankForMove(tank: Unit, units: readonly Unit[]): Unit | null {
  const infantry = units.find(unit => canMountTank(unit, tank, units));
  return infantry && mountTank(infantry, tank, units) ? infantry : null;
}

export function dismountTankRiders(tank: Unit, units: readonly Unit[]): Unit[] {
  destroyTankRiders(tank, units);
  return tankRiders(tank, units).filter(infantry => dismountTank(infantry, units));
}

/** Resolve one entire attack first, then try each affected carrier once. */
export function dismountRidersAfterAttack(targets: readonly Unit[], units: readonly Unit[]): Unit[] {
  const carrierIds = new Set(targets.map(target => isTankUnit(target) ? target.id : target.mountedOnUnitId).filter(Boolean));
  return units.filter(unit => carrierIds.has(unit.id)).flatMap(tank => dismountTankRiders(tank, units));
}

/** A MG action has one target; riders screen the same-side, same-faction ground squad. */
export function mountedMachineGunTarget(target: Unit, units: readonly Unit[]): Unit {
  if (target.mountedOnUnitId) return target;
  return units.find(unit => !unit.destroyed && isRidingInfantry(unit) && !!unit.mountedOnUnitId
    && isSameSide(unit, target) && unit.faction === target.faction
    && unit.pos.q === target.pos.q && unit.pos.r === target.pos.r) ?? target;
}

/** Reconcile after movement, combat and loading, including invalid/stale saved links. */
export function syncTankRiders(units: readonly Unit[]): void {
  // Do this before invalid links are cleared, including save/PVP reconciliation.
  for (const tank of units) if (tank.destroyed) destroyTankRiders(tank, units);
  const byId = new Map(units.map(unit => [unit.id, unit]));
  const occupied = new Set<string>();
  for (const infantry of units) {
    if (!infantry.mountedOnUnitId) { infantry.mountedDoubleSide = undefined; continue; }
    const tank = byId.get(infantry.mountedOnUnitId);
    if (tank) infantry.pos = { ...tank.pos };
    if (infantry.destroyed || !isRidingInfantry(infantry) || infantry.attachedToATGunId
      || !tank || !canCarryInfantry(tank) || !isSameSide(infantry, tank) || infantry.faction !== tank.faction
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
