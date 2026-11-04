import type { HexMap } from './HexGrid';
import type { Unit } from './types';
import { isTwoHexUnit, unitOccupiedHexes, unitOccupiesHex, unitRearHex } from './UnitFootprint';

export function canDeployTwoHexUnit(map: HexMap, unit: Unit, units: readonly Unit[]): boolean {
  if (!isTwoHexUnit(unit)) return true;
  const hexes = unitOccupiedHexes(unit);
  return hexes.every(pos => map.canTankEnter(pos, unit.faction) && !map.get(pos)?.displayOnly
    && !units.some(other => other.id !== unit.id && !other.destroyed && !other.mountedOnUnitId
      && !other.attachedToATGunId && unitOccupiesHex(other, pos)))
    && map.canTankCrossEdge(unitRearHex(unit), unit.pos, { faction: unit.faction });
}

/** Legacy one-cell starts are adapted to the nearest complete, legal footprint. */
export function fitTwoHexDeployment(map: HexMap, unit: Unit, units: readonly Unit[]): void {
  if (!isTwoHexUnit(unit) || canDeployTwoHexUnit(map, unit, units)) return;
  const from = unit.pos;
  const distance = (p: typeof from) => (Math.abs(p.q-from.q)+Math.abs(p.r-from.r)+Math.abs(p.q+p.r-from.q-from.r))/2;
  const candidates = map.all().filter(tile => map.sameRegion(from, tile.pos))
    .sort((a,b) => distance(a.pos)-distance(b.pos) || a.pos.r-b.pos.r || a.pos.q-b.pos.q);
  for (const tile of candidates) {
    const candidate = { ...unit, pos: tile.pos };
    if (!canDeployTwoHexUnit(map, candidate, units)) continue;
    unit.pos = { ...tile.pos };
    return;
  }
  throw new Error(`No legal two-hex deployment for ${unit.id} (${unit.kind})`);
}
