import type { Axial, CrewSlot, Direction, Unit } from './types';

const vectors: readonly Axial[] = [
  { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
  { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
];
const anchors = new WeakMap<Unit, Axial>();
const hitHexes = new WeakMap<Unit, Axial>();
export function selectedUnitHitHex(unit: Unit): Axial | undefined { return hitHexes.get(unit); }
/** Target views retain live state writes while carrying a selected hit hex through UI callbacks. */
export function unitHitView(unit: Unit, pos: Axial): Unit {
  if (!isTwoHexUnit(unit)) return unit;
  const view = new Proxy(unit, {
    get: (target, key, receiver) => key === 'pos' ? pos : Reflect.get(target, key, receiver),
    set: (target, key, value) => key === 'pos' ? false : Reflect.set(target, key, value),
  });
  anchors.set(view, unitFrontHex(unit));
  hitHexes.set(view, pos);
  return view;
}
export const sameHex = (a: Axial, b: Axial): boolean => a.q === b.q && a.r === b.r;
const step = (p: Axial, d: number): Axial => {
  const v = vectors[(d + 6) % 6];
  return { q: p.q + v.q, r: p.r + v.r };
};

export function isTwoHexUnit(unit: Unit): boolean { return unit.stats?.footprintLength === 2; }
export function unitFrontHex(unit: Unit): Axial { return anchors.get(unit) ?? unit.pos; }
export function unitRearHex(unit: Unit): Axial {
  return isTwoHexUnit(unit) ? step(unitFrontHex(unit), (unit.facing ?? 0) + 3) : unitFrontHex(unit);
}
export function unitOccupiedHexes(unit: Unit): Axial[] {
  return isTwoHexUnit(unit) ? [unitFrontHex(unit), unitRearHex(unit)] : [unitFrontHex(unit)];
}
export function unitOccupiesHex(unit: Unit, hex: Axial): boolean {
  return unitOccupiedHexes(unit).some(p => sameHex(p, hex));
}
export function unitCellAt(unit: Unit, hex: Axial): 'front' | 'rear' {
  return isTwoHexUnit(unit) && sameHex(unitRearHex(unit), hex) ? 'rear' : 'front';
}
export function unitTurretHex(unit: Unit): Axial {
  return isTwoHexUnit(unit) && unit.stats.turretCell === 'rear' ? unitRearHex(unit) : unitFrontHex(unit);
}
/** A read-only geometry view; the physical footprint remains anchored at the original front. */
export function unitAtHex(unit: Unit, pos: Axial): Unit {
  const view = { ...unit, pos };
  anchors.set(view, unitFrontHex(unit));
  return view;
}
export function unitCenterHex(unit: Unit): Axial {
  const f = unitFrontHex(unit), r = unitRearHex(unit);
  return { q: (f.q + r.q) / 2, r: (f.r + r.r) / 2 };
}
export function crewSlotCell(unit: Unit, slot: CrewSlot): 'front' | 'rear' {
  return slot === 4 || slot === 5 ? 'front' : (unit.stats.turretCell ?? 'front');
}
export function canHitCrewAt(unit: Unit, slot: CrewSlot, hex: Axial): boolean {
  return !isTwoHexUnit(unit) || crewSlotCell(unit, slot) === unitCellAt(unit, hex);
}

export interface UnitMovePlan {
  pos: Axial;
  facing: Direction;
  entryFrom: Axial;
  entryTo: Axial;
}
/** Only the leading end enters new terrain; the other end follows its own occupied hex. */
export function planUnitMove(unit: Unit, action: 'advance' | 'reverse' | 'cw' | 'ccw'): UnitMovePlan {
  const oldFacing = unit.facing ?? 0;
  const turn = action === 'cw' || action === 'ccw';
  const facing = (turn ? (oldFacing + (action === 'cw' ? 1 : 5)) % 6 : oldFacing) as Direction;
  const reverse = action === 'reverse';
  const entryFrom = reverse ? unitRearHex(unit) : unitFrontHex(unit);
  const entryTo = step(entryFrom, reverse ? oldFacing + 3 : facing);
  const pos = turn && !isTwoHexUnit(unit) ? unit.pos
    : reverse && isTwoHexUnit(unit) ? unitRearHex(unit) : entryTo;
  return { pos, facing, entryFrom, entryTo };
}

export function footprintDistance(a: Unit, b: Unit): number {
  const distance = (p: Axial, q: Axial) => (Math.abs(p.q-q.q) + Math.abs(p.r-q.r) + Math.abs(p.q+p.r-q.q-q.r)) / 2;
  return Math.min(...unitOccupiedHexes(a).flatMap(p => unitOccupiedHexes(b).map(q => distance(p,q))));
}

export function unitMoveEntry(unit: Unit, from: Axial, to: Axial): { from: Axial; to: Axial } {
  if (isTwoHexUnit(unit) && sameHex(from, unitFrontHex(unit))
    && sameHex(to, step(from, (unit.facing ?? 0) + 3))) {
    return { from: to, to: step(to, (unit.facing ?? 0) + 3) };
  }
  return { from, to };
}
