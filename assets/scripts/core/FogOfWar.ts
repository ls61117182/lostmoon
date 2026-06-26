import { axialAdd, HexMap, axialEquals, axialToPixel, fireDirectionTo, fireDirectionVector, hexDistance, isDiagonalFireDirection, neighbor } from './HexGrid';
import { getGameModeConfig, GameMode } from './GameMode';
import { Axial, DEFAULT_VISION_RANGE, Direction, FireDirection, isTankUnit, Unit } from './types';

const GEOMETRY_HEX_SIZE = 1;
const INTERSECTION_EPSILON = 1e-9;

interface Point {
  x: number;
  y: number;
}

/** Fog is a game-mode rule, independent from mission authoring data. */
export function fogOfWarEnabled(mode: GameMode): boolean {
  return getGameModeConfig(mode).fogOfWar;
}

/** Grid ranges are non-negative integers; old missions/units default to 4. */
export function currentVisionRange(unit: Unit): number {
  const raw = unit.visionRange ?? unit.stats.visionRange;
  return typeof raw === 'number' && Number.isFinite(raw)
    ? Math.max(0, Math.floor(raw))
    : DEFAULT_VISION_RANGE;
}

/** Runtime source of truth for the map coordinates visible to one unit. */
export function computeUnitVisibleHexes(map: HexMap, unit: Unit): Set<string> {
  const visible = new Set<string>();
  const add = (p: Axial) => {
    if (map.has(p)) visible.add(HexMap.keyOf(p));
  };

  add(unit.pos);
  // Old tests/saves predate the config field; vehicle behavior remains turreted by default.
  const visionType = unit.stats.visionType ?? 'turreted';
  const commanderAlive = unit.crew?.commander !== false;
  const openHatch = commanderAlive && unit.hatchOpen === true;
  const visionRange = currentVisionRange(unit);

  if (openHatch) {
    for (const tile of map.all()) {
      if (hexDistance(unit.pos, tile.pos) > visionRange) continue;
      if (hasDirectionalFogLineOfSight(map, unit.pos, tile.pos)) add(tile.pos);
    }
  }

  if (visionType === 'infantry') {
    for (const tile of map.all()) {
      if (hexDistance(unit.pos, tile.pos) <= 2 && hasFogLineOfSight(map, unit.pos, tile.pos)) add(tile.pos);
    }
    return visible;
  }

  // Turreted vehicles see all adjacent hexes plus a ray along the turret.
  // Fixed guns only see the ray along the unit's hull facing.
  const sightFacing = visionType === 'turreted'
    ? (unit.turretFacing ?? unit.facing)
    : unit.facing;
  if (sightFacing !== null) {
    if (!openHatch && visionType === 'turreted') {
      for (let direction = 0; direction < 6; direction++) {
        add(neighbor(unit.pos, direction as Direction));
      }
    }
    const rayVector = fireDirectionVector(sightFacing as FireDirection);
    const fireDirection = sightFacing as FireDirection;
    const diagonalRay = isDiagonalFireDirection(fireDirection);
    let p = axialAdd(unit.pos, rayVector);
    while (hexDistance(unit.pos, p) <= visionRange && map.has(p)) {
      if (diagonalRay) {
        if (!map.hasDiagonalLineOfSight(unit.pos, p, fireDirection)) break;
      }
      add(p);
      const tile = map.get(p)!;
      if (map.lineOfSightBlockedByTile(tile)) break;
      p = axialAdd(p, rayVector);
    }
  }

  return visible;
}

export function hasRadioReceive(unit: Unit): boolean {
  if (unit.destroyed || unit.stats.hasRadio === false || unit.radioDamaged === true) return false;
  return isTankUnit(unit) ? unit.crew?.coDriver !== false : true;
}

export function hasRadioTransmit(unit: Unit): boolean {
  if (unit.destroyed || unit.stats.hasRadio === false || unit.radioDamaged === true) return false;
  return isTankUnit(unit) ? unit.crew?.commander !== false : true;
}

export function computeRadioSharedVisibleHexes(
  map: HexMap,
  receiver: Unit,
  friendlies: readonly Unit[] = [],
): Set<string> {
  const visible = computeUnitVisibleHexes(map, receiver);
  if (!hasRadioReceive(receiver)) return visible;
  for (const friendly of friendlies) {
    if (friendly === receiver || friendly.faction !== receiver.faction || !hasRadioTransmit(friendly)) continue;
    for (const key of computeUnitVisibleHexes(map, friendly)) visible.add(key);
  }
  return visible;
}

/** Player vision includes each living ally's occupied hex, but never the ally's own vision area. */
export function computePlayerVisibleHexes(
  map: HexMap,
  sherman: Unit,
  allies: readonly Unit[] = [],
  radioVisionSharing = false,
): Set<string> {
  const visible = radioVisionSharing
    ? computeRadioSharedVisibleHexes(map, sherman, allies)
    : computeUnitVisibleHexes(map, sherman);
  for (const ally of allies) {
    if (!ally.destroyed && map.has(ally.pos)) visible.add(HexMap.keyOf(ally.pos));
  }
  return visible;
}

export function isUnitInVision(
  map: HexMap,
  observer: Unit,
  target: Unit,
  friendlies: readonly Unit[] = [],
  radioVisionSharing = false,
): boolean {
  const visible = radioVisionSharing
    ? computeRadioSharedVisibleHexes(map, observer, friendlies)
    : computeUnitVisibleHexes(map, observer);
  return visible.has(HexMap.keyOf(target.pos));
}

/**
 * Fog LoS uses rendered geometry, not a rounded hex path: the segment joining
 * observer and target centers is blocked when it intersects an intermediate
 * blocking hex. The endpoints themselves never block their own visibility.
 */
export function hasFogLineOfSight(map: HexMap, from: Axial, to: Axial): boolean {
  if (axialEquals(from, to)) return true;
  const a = axialToPixel(from, GEOMETRY_HEX_SIZE);
  const b = axialToPixel(to, GEOMETRY_HEX_SIZE);
  for (const tile of map.all()) {
    if (axialEquals(tile.pos, from) || axialEquals(tile.pos, to)) continue;
    if (!map.lineOfSightBlockedByTile(tile)) continue;
    const center = axialToPixel(tile.pos, GEOMETRY_HEX_SIZE);
    if (segmentIntersectsPointyHex(a, b, center, GEOMETRY_HEX_SIZE)) return false;
  }
  return true;
}

function hasDirectionalFogLineOfSight(map: HexMap, from: Axial, to: Axial): boolean {
  const fireDirection = fireDirectionTo(from, to);
  if (fireDirection !== null && isDiagonalFireDirection(fireDirection)) {
    return map.hasDiagonalLineOfSight(from, to, fireDirection);
  }
  return hasFogLineOfSight(map, from, to);
}

function segmentIntersectsPointyHex(a: Point, b: Point, center: Point, size: number): boolean {
  const vertices: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (-30 + i * 60) * Math.PI / 180;
    vertices.push({
      x: center.x + size * Math.cos(angle),
      y: center.y + size * Math.sin(angle),
    });
  }
  if (pointInConvexPolygon(a, vertices) || pointInConvexPolygon(b, vertices)) return true;
  for (let i = 0; i < vertices.length; i++) {
    if (segmentsIntersect(a, b, vertices[i], vertices[(i + 1) % vertices.length])) return true;
  }
  return false;
}

function pointInConvexPolygon(p: Point, vertices: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const cross = crossProduct(a, b, p);
    if (Math.abs(cross) <= INTERSECTION_EPSILON) continue;
    const current = Math.sign(cross);
    if (sign !== 0 && current !== sign) return false;
    sign = current;
  }
  return true;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = crossProduct(a, b, c);
  const abD = crossProduct(a, b, d);
  const cdA = crossProduct(c, d, a);
  const cdB = crossProduct(c, d, b);
  if (((abC > INTERSECTION_EPSILON && abD < -INTERSECTION_EPSILON)
      || (abC < -INTERSECTION_EPSILON && abD > INTERSECTION_EPSILON))
      && ((cdA > INTERSECTION_EPSILON && cdB < -INTERSECTION_EPSILON)
      || (cdA < -INTERSECTION_EPSILON && cdB > INTERSECTION_EPSILON))) {
    return true;
  }
  return (Math.abs(abC) <= INTERSECTION_EPSILON && pointOnSegment(c, a, b))
    || (Math.abs(abD) <= INTERSECTION_EPSILON && pointOnSegment(d, a, b))
    || (Math.abs(cdA) <= INTERSECTION_EPSILON && pointOnSegment(a, c, d))
    || (Math.abs(cdB) <= INTERSECTION_EPSILON && pointOnSegment(b, c, d));
}

function crossProduct(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function pointOnSegment(p: Point, a: Point, b: Point): boolean {
  return p.x >= Math.min(a.x, b.x) - INTERSECTION_EPSILON
    && p.x <= Math.max(a.x, b.x) + INTERSECTION_EPSILON
    && p.y >= Math.min(a.y, b.y) - INTERSECTION_EPSILON
    && p.y <= Math.max(a.y, b.y) + INTERSECTION_EPSILON;
}
