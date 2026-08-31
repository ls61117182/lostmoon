import { axialAdd, HexMap, axialEquals, axialToPixel, diagonalFlankFireDirectionTo, fireDirectionStep, fireDirectionTo, fireDirectionVector, hexDistance, isDiagonalFireDirection, neighbor } from './HexGrid';
import { CAMPAIGN_UPGRADE_BY_ID } from './CampaignUpgradeDB';
import { getGameModeConfig, GameMode } from './GameMode';
import { Axial, DEFAULT_GUNNER_VISION_RANGE, DEFAULT_INTERIOR_VISION_RANGE, DEFAULT_VISION_RANGE, Direction, FireDirection, isAbandonedATGun, isAttachedATGunCrew, isControlledATGun, isFootUnit, isHeavyArtilleryUnit, isSameSide, isTankUnit, Unit, WeatherType } from './types';
import { weatherVisionRange } from './Weather';

const GEOMETRY_HEX_SIZE = 1;
const INTERSECTION_EPSILON = 1e-9;
export const HEAVY_ARTILLERY_VISION_RANGE = 4;

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
  const range = normalizedVisionRange(
    unit.interiorVisionRange ?? unit.stats.interiorVisionRange,
    DEFAULT_INTERIOR_VISION_RANGE,
  );
  const commanderCupolaDisabled = unit.crew?.commander === false
    && unit.campaignUpgradeIds?.includes('commander_cupola');
  return commanderCupolaDisabled
    ? Math.max(0, range - CAMPAIGN_UPGRADE_BY_ID.commander_cupola.interiorVisionBonus)
    : range;
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
export function computeUnitVisibleHexes(
  map: HexMap,
  unit: Unit,
  weather?: WeatherType,
  smokeHexes?: ReadonlySet<string>,
): Set<string> {
  const visible = new Set<string>();
  if (isAbandonedATGun(unit) || isAttachedATGunCrew(unit)) return visible;
  const add = (p: Axial) => {
    if (map.has(p)) visible.add(HexMap.keyOf(p));
  };

  add(unit.pos);
  // In hardcore mode smoke behaves like a building/forest LoS blocker: its
  // own hex remains visible, but it blocks hexes behind it. A unit standing in
  // smoke keeps every one of its own sight types, capped to range 1; unrestricted
  // friendly radio sight is merged separately by computeRadioSharedVisibleHexes.
  const ownVisionRange = (range: number) => smokeHexes?.has(HexMap.keyOf(unit.pos))
    ? Math.min(range, 1)
    : range;
  const heavyArtillery = isHeavyArtilleryUnit(unit);
  // Old tests/saves predate the config field; vehicle behavior remains turreted by default.
  const visionType = heavyArtillery
    ? 'fixed'
    : isControlledATGun(unit) ? 'infantry' : (unit.stats.visionType ?? 'turreted');
  const commanderAlive = unit.crew?.commander !== false;
  const openHatch = !heavyArtillery && commanderAlive && unit.hatchOpen === true;
  const commanderVisionRange = ownVisionRange(heavyArtillery
    ? HEAVY_ARTILLERY_VISION_RANGE
    : currentVisionRange(unit, weather));

  if (openHatch) {
    for (const tile of map.all()) {
      if (hexDistance(unit.pos, tile.pos) > commanderVisionRange) continue;
      if (hasDirectionalFogLineOfSight(map, unit.pos, tile.pos, smokeHexes)) add(tile.pos);
    }
  }

  if (visionType === 'infantry') {
    const infantryRange = ownVisionRange(isControlledATGun(unit) ? commanderVisionRange : 2);
    for (const tile of map.all()) {
      if (hexDistance(unit.pos, tile.pos) <= infantryRange
        && hasFogLineOfSight(map, unit.pos, tile.pos, smokeHexes)) add(tile.pos);
    }
    return visible;
  }

  // Tanks (including fixed-gun tank destroyers and assault guns) always add
  // gunner sight. Closed hatches also add independent interior sight.
  // Other fixed-gun units (AT guns, artillery, trucks) keep their legacy ray.
  const tank = isTankUnit(unit);
  if (tank && !openHatch) {
    const interiorVisionRange = ownVisionRange(currentInteriorVisionRange(unit));
    for (const tile of map.all()) {
      if (hexDistance(unit.pos, tile.pos) <= interiorVisionRange
        && hasFogLineOfSight(map, unit.pos, tile.pos, smokeHexes)) add(tile.pos);
    }
  }

  // Turreted vehicles use their turret direction; fixed guns use hull direction.
  const sightFacing = visionType === 'turreted'
    ? (unit.turretFacing ?? unit.facing)
    : unit.facing;
  if (sightFacing !== null) {
    const gunnerVisionRange = tank ? currentGunnerVisionRange(unit) : commanderVisionRange;
    const limitedGunnerVisionRange = ownVisionRange(gunnerVisionRange);
    const rayVector = fireDirectionVector(sightFacing as FireDirection);
    const fireDirection = sightFacing as FireDirection;
    const diagonalRay = isDiagonalFireDirection(fireDirection);
    if (tank && !openHatch && diagonalRay) {
      addClosedTankDiagonalGunnerVision(map, unit, fireDirection, limitedGunnerVisionRange, add, smokeHexes);
      return visible;
    }
    let p = axialAdd(unit.pos, rayVector);
    while (hexDistance(unit.pos, p) <= limitedGunnerVisionRange && map.has(p)) {
      if (diagonalRay) {
        if (!map.hasDiagonalLineOfSight(unit.pos, p, fireDirection, smokeHexes)) break;
      }
      const tile = map.get(p)!;
      add(p);
      if (smokeHexes?.has(HexMap.keyOf(p)) || map.lineOfSightBlockedByTile(tile)) break;
      p = axialAdd(p, rayVector);
    }
  }

  return visible;
}

/**
 * Return the current halfway turret direction when `target` is on the selected
 * flank path. Hatch state changes how sight is acquired, not which currently
 * aimed flank hexes may be attacked.
 */
export function diagonalGunnerRuleDirectionForVisibleHex(
  map: HexMap,
  unit: Unit,
  target: Axial,
  weather?: WeatherType,
  smokeHexes?: ReadonlySet<string>,
): FireDirection | null {
  const controlledATGun = isControlledATGun(unit);
  if ((!isTankUnit(unit) && !controlledATGun) || unit.stats.visionType !== 'turreted') return null;
  // Every adjacent hex lies on one of the six true hex axes. It is also the
  // first side cell of two halfway-ray paths geometrically, but attacks at
  // distance one must use the exact 60-degree axis bearing. Otherwise a
  // closed-hatch turret already facing a halfway ray can incorrectly keep (for
  // example) a 90-degree rules/visual facing while firing into a 60-degree
  // neighboring hex.
  if (hexDistance(unit.pos, target) === 1) return null;
  if (controlledATGun) {
    // AT guns acquire targets through their infantry crew (including shared
    // friendly vision), so only the firing path—not the gun's own sight
    // range—limits a halfway-direction shot.
    const direction = diagonalFlankFireDirectionTo(unit.pos, target);
    if (direction === null) return null;
    return diagonalGunnerClickPreference(
      map,
      unit,
      direction,
      target,
      smokeHexes,
      hexDistance(unit.pos, target),
    ) !== null ? direction : null;
  }
  const openHatch = unit.crew?.commander !== false && unit.hatchOpen === true;
  if (openHatch) {
    // Commander sight can reveal either flank without a prior recon turn. Let
    // the target choose the halfway direction, just as an axis target rotates
    // the turret automatically before firing.
    const direction = diagonalFlankFireDirectionTo(unit.pos, target);
    if (direction === null) return null;
    if (hexDistance(unit.pos, target) > currentVisionRange(unit, weather)
      || !hasDirectionalFogLineOfSight(map, unit.pos, target, smokeHexes)) return null;
    return diagonalGunnerClickPreference(map, unit, direction, target, smokeHexes) !== null
      ? direction
      : null;
  }
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
    smokeHexes,
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
  smokeHexes?: ReadonlySet<string>,
  maxRange = currentGunnerVisionRange(unit),
): Direction | null {
  if (!isDiagonalFireDirection(fireDirection)) return null;
  const diagonalIndex = fireDirection - 6;
  const a = diagonalIndex as Direction;
  const b = ((diagonalIndex + 1) % 6) as Direction;
  const rayVector = fireDirectionVector(fireDirection);
  const range = Math.max(0, Math.floor(maxRange));
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

    if (diagonalFlankBlocked(map, aPos, smokeHexes)) aOpen = false;
    if (diagonalFlankBlocked(map, bPos, smokeHexes)) bOpen = false;

    const evenDistance = oddDistance + 1;
    if (evenDistance > range || (!aOpen && !bOpen)) return null;
    const center = axialAdd(current, rayVector);
    const centerTile = map.get(center);
    if (!centerTile || smokeHexes?.has(HexMap.keyOf(center)) || map.lineOfSightBlockedByTile(centerTile)) return null;
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
  smokeHexes?: ReadonlySet<string>,
): void {
  const diagonalIndex = fireDirection - 6;
  const a = diagonalIndex as Direction;
  const b = ((diagonalIndex + 1) % 6) as Direction;
  const rayVector = fireDirectionVector(fireDirection);
  const chosen = chooseDiagonalGunnerSide(map, unit, fireDirection, range, a, b, rayVector, smokeHexes);
  let aOpen = true;
  let bOpen = true;
  let current = unit.pos;

  for (let oddDistance = 1; oddDistance <= range; oddDistance += 2) {
    const aPos = neighbor(current, a);
    const bPos = neighbor(current, b);
    const chosenOpen = chosen === a ? aOpen : bOpen;
    const chosenPos = chosen === a ? aPos : bPos;
    if (chosenOpen) add(chosenPos);

    if (diagonalFlankBlocked(map, aPos, smokeHexes)) aOpen = false;
    if (diagonalFlankBlocked(map, bPos, smokeHexes)) bOpen = false;

    const evenDistance = oddDistance + 1;
    if (evenDistance > range || (!aOpen && !bOpen)) break;
    const center = axialAdd(current, rayVector);
    if (!map.has(center)) break;
    const centerTile = map.get(center)!;
    add(center);
    if (smokeHexes?.has(HexMap.keyOf(center)) || map.lineOfSightBlockedByTile(centerTile)) break;
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
  smokeHexes?: ReadonlySet<string>,
): Direction {
  const clickedPreference = unit.diagonalGunnerSidePreference;
  if (clickedPreference === a || clickedPreference === b) return clickedPreference;

  let current = unit.pos;
  for (let oddDistance = 1; oddDistance <= range; oddDistance += 2) {
    const aBlocked = diagonalFlankBlocked(map, neighbor(current, a), smokeHexes);
    const bBlocked = diagonalFlankBlocked(map, neighbor(current, b), smokeHexes);
    if (aBlocked !== bBlocked) return aBlocked ? b : a;
    if (aBlocked) break;

    const evenDistance = oddDistance + 1;
    if (evenDistance > range) break;
    const center = axialAdd(current, rayVector);
    const centerTile = map.get(center);
    if (!centerTile || smokeHexes?.has(HexMap.keyOf(center)) || map.lineOfSightBlockedByTile(centerTile)) break;
    current = center;
  }

  const previous = unit.previousTurretFacing ?? unit.facing ?? fireDirection;
  return clockStepDistance(fireDirectionStep(previous), fireDirectionStep(a))
    <= clockStepDistance(fireDirectionStep(previous), fireDirectionStep(b)) ? a : b;
}

/**
 * Revalidate an explicitly selected halfway-ray flank after the observer moves.
 * Keep the old flank when both paths are equivalent, but switch when the old
 * path is the first one newly cut off and the opposite path can still continue.
 */
export function reconcileDiagonalGunnerSideAfterMove(
  map: HexMap,
  unit: Unit,
  smokeHexes?: ReadonlySet<string>,
): void {
  const fireDirection = unit.turretFacing ?? unit.facing;
  const preferred = unit.diagonalGunnerSidePreference;
  if (fireDirection === null || preferred === undefined
    || !isDiagonalFireDirection(fireDirection as FireDirection)) return;

  const diagonalIndex = (fireDirection as FireDirection) - 6;
  const a = diagonalIndex as Direction;
  const b = ((diagonalIndex + 1) % 6) as Direction;
  if (preferred !== a && preferred !== b) return;

  const range = currentGunnerVisionRange(unit);
  const rayVector = fireDirectionVector(fireDirection as FireDirection);
  let current = unit.pos;
  for (let oddDistance = 1; oddDistance <= range; oddDistance += 2) {
    const aBlocked = diagonalFlankBlocked(map, neighbor(current, a), smokeHexes);
    const bBlocked = diagonalFlankBlocked(map, neighbor(current, b), smokeHexes);
    if (aBlocked !== bBlocked) {
      const preferredBlocked = preferred === a ? aBlocked : bBlocked;
      if (preferredBlocked) unit.diagonalGunnerSidePreference = preferred === a ? b : a;
      return;
    }
    // Equal obstruction means neither side offers a continuity advantage.
    if (aBlocked) return;

    const evenDistance = oddDistance + 1;
    if (evenDistance > range) return;
    const center = axialAdd(current, rayVector);
    const centerTile = map.get(center);
    if (!centerTile || smokeHexes?.has(HexMap.keyOf(center))
      || map.lineOfSightBlockedByTile(centerTile)) return;
    current = center;
  }
}

function diagonalFlankBlocked(map: HexMap, pos: Axial, smokeHexes?: ReadonlySet<string>): boolean {
  const tile = map.get(pos);
  return !tile || smokeHexes?.has(HexMap.keyOf(pos)) === true || map.lineOfSightBlockedByTile(tile);
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
  return isSameSide(a, b);
}

export function computeRadioSharedVisibleHexes(
  map: HexMap,
  receiver: Unit,
  friendlies: readonly Unit[] = [],
  weather?: WeatherType,
  smokeHexes?: ReadonlySet<string>,
): Set<string> {
  const visible = computeUnitVisibleHexes(map, receiver, weather, smokeHexes);
  // Fixed heavy artillery never acquires off-axis targets from friendly radio.
  if (isHeavyArtilleryUnit(receiver)) return visible;
  if (hasRadioReceive(receiver)) {
    for (const friendly of friendlies) {
      if (friendly === receiver || !shareVisionFaction(friendly, receiver) || !hasRadioTransmit(friendly)) continue;
      for (const key of computeUnitVisibleHexes(map, friendly, weather, smokeHexes)) {
        // A friendly inside smoke directly knows only its own occupied hex.
        // That local awareness is valid radio intelligence for teammates, even
        // though nobody outside the smoke could reveal the hex by direct sight.
        visible.add(key);
      }
    }
  }
  // Non-radio infantry can brief only the tank occupying the same hex. Their
  // sight is merged directly here, never treated as a radio transmission, so
  // another tank cannot relay it through its intact radio.
  if (isTankUnit(receiver)) {
    const receiverInSmoke = smokeHexes?.has(HexMap.keyOf(receiver.pos)) === true;
    for (const friendly of friendlies) {
      if (friendly === receiver
        || friendly.destroyed
        || !isFootUnit(friendly)
        || friendly.stats.hasRadio !== false
        || !shareVisionFaction(friendly, receiver)
        || !axialEquals(friendly.pos, receiver.pos)) continue;
      for (const key of computeUnitVisibleHexes(map, friendly, weather, smokeHexes)) {
        const [q, r] = key.split(',').map(Number);
        const pos = { q, r };
        if (!smokeHexes?.has(key)
          && (!receiverInSmoke || hexDistance(receiver.pos, pos) <= 1)) visible.add(key);
      }
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
  smokeHexes?: ReadonlySet<string>,
): Set<string> {
  const visible = radioVisionSharing
    ? computeRadioSharedVisibleHexes(map, sherman, allies, weather, smokeHexes)
    : computeUnitVisibleHexes(map, sherman, weather, smokeHexes);
  for (const ally of allies) {
    const key = HexMap.keyOf(ally.pos);
    if (!ally.destroyed && map.has(ally.pos) && !smokeHexes?.has(key)) visible.add(key);
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
  smokeHexes?: ReadonlySet<string>,
): boolean {
  const visible = radioVisionSharing
    ? computeRadioSharedVisibleHexes(map, observer, friendlies, weather, smokeHexes)
    : computeUnitVisibleHexes(map, observer, weather, smokeHexes);
  return visible.has(HexMap.keyOf(target.pos));
}

/**
 * Fog LoS uses rendered geometry, not a rounded hex path: the segment joining
 * observer and target centers is blocked when it intersects an intermediate
 * blocking hex. The endpoints themselves never block their own visibility.
 */
export function hasFogLineOfSight(
  map: HexMap,
  from: Axial,
  to: Axial,
  smokeHexes?: ReadonlySet<string>,
): boolean {
  if (axialEquals(from, to)) return true;
  const a = axialToPixel(from, GEOMETRY_HEX_SIZE);
  const b = axialToPixel(to, GEOMETRY_HEX_SIZE);
  for (const tile of map.all()) {
    if (axialEquals(tile.pos, from) || axialEquals(tile.pos, to)) continue;
    if (!map.lineOfSightBlockedByTile(tile) && !smokeHexes?.has(HexMap.keyOf(tile.pos))) continue;
    const center = axialToPixel(tile.pos, GEOMETRY_HEX_SIZE);
    if (segmentIntersectsPointyHex(a, b, center, GEOMETRY_HEX_SIZE)) return false;
  }
  return true;
}

function hasDirectionalFogLineOfSight(
  map: HexMap,
  from: Axial,
  to: Axial,
  smokeHexes?: ReadonlySet<string>,
): boolean {
  const fireDirection = fireDirectionTo(from, to);
  if (fireDirection !== null && isDiagonalFireDirection(fireDirection)) {
    return map.hasDiagonalLineOfSight(from, to, fireDirection, smokeHexes);
  }
  return hasFogLineOfSight(map, from, to, smokeHexes);
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
