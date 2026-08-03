import { axialAdd, HexMap, axialEquals, axialToPixel, fireDirectionStep, fireDirectionTo, fireDirectionVector, hexDistance, isDiagonalFireDirection, neighbor } from './HexGrid';
import { getGameModeConfig, GameMode } from './GameMode';
import { Axial, DEFAULT_GUNNER_VISION_RANGE, DEFAULT_INTERIOR_VISION_RANGE, DEFAULT_VISION_RANGE, Direction, FireDirection, isAbandonedATGun, isAttachedATGunCrew, isControlledATGun, isFootUnit, isFriendlyFaction, isTankUnit, Unit, WeatherType } from './types';
import { weatherVisionRange } from './Weather';

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
export function currentVisionRange(unit: Unit, weather?: WeatherType): number {
  const raw = unit.visionRange ?? unit.stats.visionRange;
  const baseRange = typeof raw === 'number' && Number.isFinite(raw)
    ? Math.max(0, Math.floor(raw))
    : DEFAULT_VISION_RANGE;
  return weatherVisionRange(unit, baseRange, weather);
}

/** Gunner sight is deliberately separate from commander and interior vision. */
export function currentGunnerVisionRange(unit: Unit): number {
  return normalizedVisionRange(
    unit.gunnerVisionRange ?? unit.stats.gunnerVisionRange,
    DEFAULT_GUNNER_VISION_RANGE,
  );
}

/** Closed-hatch interior sight is deliberately separate from gunner sight. */
export function currentInteriorVisionRange(unit: Unit): number {
  return normalizedVisionRange(
    unit.interiorVisionRange ?? unit.stats.interiorVisionRange,
    DEFAULT_INTERIOR_VISION_RANGE,
  );
}

function normalizedVisionRange(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw)
    ? Math.max(0, Math.floor(raw))
    : fallback;
}

/**
 * Whether a target is within the observer's own direct aiming range. Tanks use
 * the gunner's independent sight; non-tanks retain their legacy vision range.
 */
export function isWithinOwnVisionRange(observer: Unit, target: Unit, weather?: WeatherType): boolean {
  const range = isTankUnit(observer)
    ? currentGunnerVisionRange(observer)
    : currentVisionRange(observer, weather);
  return hexDistance(observer.pos, target.pos) <= range;
}

/** Runtime source of truth for the map coordinates visible to one unit. */
export function computeUnitVisibleHexes(map: HexMap, unit: Unit, weather?: WeatherType): Set<string> {
  const visible = new Set<string>();
  if (isAbandonedATGun(unit) || isAttachedATGunCrew(unit)) return visible;
  const add = (p: Axial) => {
    if (map.has(p)) visible.add(HexMap.keyOf(p));
  };

  add(unit.pos);
  // Old tests/saves predate the config field; vehicle behavior remains turreted by default.
  const visionType = isControlledATGun(unit) ? 'infantry' : (unit.stats.visionType ?? 'turreted');
  const commanderAlive = unit.crew?.commander !== false;
  const openHatch = commanderAlive && unit.hatchOpen === true;
  const commanderVisionRange = currentVisionRange(unit, weather);

  if (openHatch) {
    for (const tile of map.all()) {
      if (hexDistance(unit.pos, tile.pos) > commanderVisionRange) continue;
      if (hasDirectionalFogLineOfSight(map, unit.pos, tile.pos)) add(tile.pos);
    }
  }

  if (visionType === 'infantry') {
    const infantryRange = isControlledATGun(unit) ? commanderVisionRange : 2;
    for (const tile of map.all()) {
      if (hexDistance(unit.pos, tile.pos) <= infantryRange && hasFogLineOfSight(map, unit.pos, tile.pos)) add(tile.pos);
    }
    return visible;
  }

  // Tanks (including fixed-gun tank destroyers and assault guns) always add
  // gunner sight. Closed hatches also add independent interior sight.
  // Other fixed-gun units (AT guns, artillery, trucks) keep their legacy ray.
  const tank = isTankUnit(unit);
  if (tank && !openHatch) {
    const interiorVisionRange = currentInteriorVisionRange(unit);
    for (const tile of map.all()) {
      if (hexDistance(unit.pos, tile.pos) <= interiorVisionRange
        && hasFogLineOfSight(map, unit.pos, tile.pos)) add(tile.pos);
    }
  }

  // Turreted vehicles use their turret direction; fixed guns use hull direction.
  const sightFacing = visionType === 'turreted'
    ? (unit.turretFacing ?? unit.facing)
    : unit.facing;
  if (sightFacing !== null) {
    const gunnerVisionRange = tank ? currentGunnerVisionRange(unit) : commanderVisionRange;
    const rayVector = fireDirectionVector(sightFacing as FireDirection);
    const fireDirection = sightFacing as FireDirection;
    const diagonalRay = isDiagonalFireDirection(fireDirection);
    if (tank && !openHatch && diagonalRay) {
      addClosedTankDiagonalGunnerVision(map, unit, fireDirection, gunnerVisionRange, add);
      return visible;
    }
    let p = axialAdd(unit.pos, rayVector);
    while (hexDistance(unit.pos, p) <= gunnerVisionRange && map.has(p)) {
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

/**
 * Return the current halfway turret direction when `target` is one of the
 * selected, visible flank hexes added by closed-hatch gunner sight.
 */
export function diagonalGunnerRuleDirectionForVisibleHex(
  map: HexMap,
  unit: Unit,
  target: Axial,
): FireDirection | null {
  const openHatch = unit.crew?.commander !== false && unit.hatchOpen === true;
  if (!isTankUnit(unit) || openHatch || unit.stats.visionType !== 'turreted') return null;
  const direction = unit.turretFacing ?? unit.facing;
  if (direction === null || !isDiagonalFireDirection(direction as FireDirection)) return null;
  if (fireDirectionTo(unit.pos, target) === direction) return null;
  let found = false;
  addClosedTankDiagonalGunnerVision(
    map,
    unit,
    direction as FireDirection,
    currentGunnerVisionRange(unit),
    (pos) => { if (map.has(pos) && axialEquals(pos, target)) found = true; },
  );
  return found ? direction as FireDirection : null;
}

/**
 * When manually rotating onto a halfway ray, let a reachable clicked flank hex
 * choose which contiguous side is shown. The target endpoint may itself block
 * vision; only blockers earlier on the clicked path invalidate the preference.
 */
export function diagonalGunnerClickPreference(
  map: HexMap,
  unit: Unit,
  fireDirection: FireDirection,
  target: Axial,
): Direction | null {
  if (!isDiagonalFireDirection(fireDirection)) return null;
  const diagonalIndex = fireDirection - 6;
  const a = diagonalIndex as Direction;
  const b = ((diagonalIndex + 1) % 6) as Direction;
  const rayVector = fireDirectionVector(fireDirection);
  const range = currentGunnerVisionRange(unit);
  let aOpen = true;
  let bOpen = true;
  let current = unit.pos;

  for (let oddDistance = 1; oddDistance <= range; oddDistance += 2) {
    const aPos = neighbor(current, a);
    const bPos = neighbor(current, b);
    const clickedSide = axialEquals(target, aPos) ? a : axialEquals(target, bPos) ? b : null;
    if (clickedSide !== null) {
      const clickedPathOpen = clickedSide === a ? aOpen : bOpen;
      return clickedPathOpen && map.has(target) ? clickedSide : null;
    }

    if (diagonalFlankBlocked(map, aPos)) aOpen = false;
    if (diagonalFlankBlocked(map, bPos)) bOpen = false;

    const evenDistance = oddDistance + 1;
    if (evenDistance > range || (!aOpen && !bOpen)) return null;
    const center = axialAdd(current, rayVector);
    const centerTile = map.get(center);
    if (!centerTile || map.lineOfSightBlockedByTile(centerTile)) return null;
    current = center;
  }
  return null;
}

/**
 * A halfway gunner ray has two alternating, contiguous paths around it. Only
 * one path contributes odd-distance hexes. Earlier flank pairs have priority;
 * when they match, the next pair is inspected. Even-distance center hexes stay
 * visible while at least one complete flank path remains unobstructed.
 */
function addClosedTankDiagonalGunnerVision(
  map: HexMap,
  unit: Unit,
  fireDirection: FireDirection,
  range: number,
  add: (pos: Axial) => void,
): void {
  const diagonalIndex = fireDirection - 6;
  const a = diagonalIndex as Direction;
  const b = ((diagonalIndex + 1) % 6) as Direction;
  const rayVector = fireDirectionVector(fireDirection);
  const chosen = chooseDiagonalGunnerSide(map, unit, fireDirection, range, a, b, rayVector);
  let aOpen = true;
  let bOpen = true;
  let current = unit.pos;

  for (let oddDistance = 1; oddDistance <= range; oddDistance += 2) {
    const aPos = neighbor(current, a);
    const bPos = neighbor(current, b);
    const chosenOpen = chosen === a ? aOpen : bOpen;
    if (chosenOpen) add(chosen === a ? aPos : bPos);

    if (diagonalFlankBlocked(map, aPos)) aOpen = false;
    if (diagonalFlankBlocked(map, bPos)) bOpen = false;

    const evenDistance = oddDistance + 1;
    if (evenDistance > range || (!aOpen && !bOpen)) break;
    const center = axialAdd(current, rayVector);
    if (!map.has(center)) break;
    add(center);
    const centerTile = map.get(center)!;
    if (map.lineOfSightBlockedByTile(centerTile)) break;
    current = center;
  }
}

function chooseDiagonalGunnerSide(
  map: HexMap,
  unit: Unit,
  fireDirection: FireDirection,
  range: number,
  a: Direction,
  b: Direction,
  rayVector: Axial,
): Direction {
  const clickedPreference = unit.diagonalGunnerSidePreference;
  if (clickedPreference === a || clickedPreference === b) return clickedPreference;

  let current = unit.pos;
  for (let oddDistance = 1; oddDistance <= range; oddDistance += 2) {
    const aBlocked = diagonalFlankBlocked(map, neighbor(current, a));
    const bBlocked = diagonalFlankBlocked(map, neighbor(current, b));
    if (aBlocked !== bBlocked) return aBlocked ? b : a;
    if (aBlocked) break;

    const evenDistance = oddDistance + 1;
    if (evenDistance > range) break;
    const center = axialAdd(current, rayVector);
    const centerTile = map.get(center);
    if (!centerTile || map.lineOfSightBlockedByTile(centerTile)) break;
    current = center;
  }

  const previous = unit.previousTurretFacing ?? unit.facing ?? fireDirection;
  return clockStepDistance(fireDirectionStep(previous), fireDirectionStep(a))
    <= clockStepDistance(fireDirectionStep(previous), fireDirectionStep(b)) ? a : b;
}

function diagonalFlankBlocked(map: HexMap, pos: Axial): boolean {
  const tile = map.get(pos);
  return !tile || map.lineOfSightBlockedByTile(tile);
}

function clockStepDistance(a: number, b: number): number {
  const delta = Math.abs(a - b) % 12;
  return Math.min(delta, 12 - delta);
}

export function hasRadioReceive(unit: Unit): boolean {
  if (unit.destroyed || unit.stats.hasRadio === false || unit.radioDamaged === true) return false;
  return true;
}

export function hasRadioTransmit(unit: Unit): boolean {
  if (unit.destroyed || unit.stats.hasRadio === false || unit.radioDamaged === true) return false;
  return isTankUnit(unit) ? unit.crew?.commander !== false : true;
}

function shareVisionFaction(a: Unit, b: Unit): boolean {
  return a.faction === b.faction
    || (isFriendlyFaction(a.faction) && isFriendlyFaction(b.faction));
}

export function computeRadioSharedVisibleHexes(
  map: HexMap,
  receiver: Unit,
  friendlies: readonly Unit[] = [],
  weather?: WeatherType,
): Set<string> {
  const visible = computeUnitVisibleHexes(map, receiver, weather);
  if (hasRadioReceive(receiver)) {
    for (const friendly of friendlies) {
      if (friendly === receiver || !shareVisionFaction(friendly, receiver) || !hasRadioTransmit(friendly)) continue;
      for (const key of computeUnitVisibleHexes(map, friendly, weather)) visible.add(key);
    }
  }
  // Non-radio infantry can brief only the tank occupying the same hex. Their
  // sight is merged directly here, never treated as a radio transmission, so
  // another tank cannot relay it through its intact radio.
  if (isTankUnit(receiver)) {
    for (const friendly of friendlies) {
      if (friendly === receiver
        || friendly.destroyed
        || !isFootUnit(friendly)
        || friendly.stats.hasRadio !== false
        || !shareVisionFaction(friendly, receiver)
        || !axialEquals(friendly.pos, receiver.pos)) continue;
      for (const key of computeUnitVisibleHexes(map, friendly, weather)) visible.add(key);
    }
  }
  return visible;
}

/** Player vision includes each living ally's occupied hex, but never the ally's own vision area. */
export function computePlayerVisibleHexes(
  map: HexMap,
  sherman: Unit,
  allies: readonly Unit[] = [],
  radioVisionSharing = false,
  weather?: WeatherType,
): Set<string> {
  const visible = radioVisionSharing
    ? computeRadioSharedVisibleHexes(map, sherman, allies, weather)
    : computeUnitVisibleHexes(map, sherman, weather);
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
  weather?: WeatherType,
): boolean {
  const visible = radioVisionSharing
    ? computeRadioSharedVisibleHexes(map, observer, friendlies, weather)
    : computeUnitVisibleHexes(map, observer, weather);
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
