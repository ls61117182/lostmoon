import { axialAdd, HexMap, axialEquals, axialToPixel, fireDirectionVector, hexDistance, isDiagonalFireDirection, neighbor } from './HexGrid';
import { getGameModeConfig, GameMode } from './GameMode';
import { Axial, DEFAULT_VISION_RANGE, Direction, FireDirection, Unit } from './types';

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
      if (hasFogLineOfSight(map, unit.pos, tile.pos)) add(tile.pos);
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
    const diagonalRay = isDiagonalFireDirection(sightFacing as FireDirection);
    let p = axialAdd(unit.pos, rayVector);
    while (hexDistance(unit.pos, p) <= visionRange && map.has(p)) {
      if (diagonalRay && !hasFogLineOfSight(map, unit.pos, p)) break;
      add(p);
      const tile = map.get(p)!;
      if (map.lineOfSightBlockedByTile(tile)) break;
      p = axialAdd(p, rayVector);
    }
  }

  return visible;
}

/** Player vision includes each living ally's occupied hex, but never the ally's own vision area. */
export function computePlayerVisibleHexes(
  map: HexMap,
  sherman: Unit,
  allies: readonly Unit[] = [],
): Set<string> {
  const visible = computeUnitVisibleHexes(map, sherman);
  for (const ally of allies) {
    if (!ally.destroyed && map.has(ally.pos)) visible.add(HexMap.keyOf(ally.pos));
  }
  return visible;
}

export function isUnitInVision(map: HexMap, observer: Unit, target: Unit): boolean {
  return computeUnitVisibleHexes(map, observer).has(HexMap.keyOf(target.pos));
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
