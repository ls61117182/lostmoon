import { RNG } from './Dice';
import {
  approximateDirection,
  axialToOffset,
  directionTo,
  hexDistance,
  neighbor,
  offsetToAxial,
} from './HexGrid';
import type { CustomMissionPackage } from './CustomMissionStore';
import type { TurnEndEffectType, TurnEndEventRow } from './TurnEndEventDB';
import { isFootKind } from './types';
import type {
  Axial,
  Direction,
  MissionData,
  MissionObjective,
  Offset,
  TileDef,
  TruckPathEntry,
  UnitKind,
  UnitPlacement,
} from './types';

export type RandomMissionTheater = 'europe' | 'pacific';
export interface RandomMissionGenerationOptions {
  pacificBattleType?: 'landing' | 'inland';
}

export const RANDOM_MISSION_GENERATOR_VERSION = '20';
export const RANDOM_MISSION_TRANSIENT_IDS: Record<RandomMissionTheater, string> = {
  europe: 'generated_random_europe',
  pacific: 'generated_random_pacific',
};

const COLS = 8;
const ROWS = 6;
const START: Offset = { col: 0, row: 3 };
const EVAC: Offset = { col: 7, row: 2 };
const ACTIVE_ROW_RANGES: ReadonlyArray<readonly [number, number]> = [
  [2, 6], [1, 6], [1, 7], [0, 6], [1, 6], [1, 5],
];

interface GeneratedLayout {
  tiles: Array<Array<TileDef | null>>;
  roadPath: Offset[];
  roadExitDirs: [Direction, Direction] | null;
}

interface ObjectiveRoll {
  objective: MissionObjective;
  kind: 'destroy_all' | 'target_evac' | 'direct_evac' | 'truck';
  targetKind?: UnitKind;
}

interface EnemyBudget {
  min: number;
  max: number;
}

interface WeightedKind {
  kind: UnitKind;
  weight: number;
  threat: number;
}

function key(o: Offset): string {
  return `${o.col},${o.row}`;
}

function cloneOffset(o: Offset): Offset {
  return { col: o.col, row: o.row };
}

function activeOffsets(): Offset[] {
  const out: Offset[] = [];
  for (let row = 0; row < ROWS; row++) {
    const [minCol, maxCol] = ACTIVE_ROW_RANGES[row]!;
    for (let col = minCol; col <= maxCol; col++) out.push({ col, row });
  }
  return out;
}

const ACTIVE = activeOffsets();
const ACTIVE_KEYS = new Set(ACTIVE.map(key));
const BOUNDARY_OFFSETS = ACTIVE.filter(isBoundary);

function isActive(o: Offset): boolean {
  return ACTIVE_KEYS.has(key(o));
}

function offsetNeighbor(o: Offset, dir: Direction): Offset {
  return axialToOffset(neighbor(offsetToAxial(o), dir));
}

function neighborsOf(o: Offset): Array<{ pos: Offset; dir: Direction }> {
  const out: Array<{ pos: Offset; dir: Direction }> = [];
  for (let d = 0; d < 6; d++) {
    const dir = d as Direction;
    const pos = offsetNeighbor(o, dir);
    if (isActive(pos)) out.push({ pos, dir });
  }
  return out;
}

function isBoundary(o: Offset): boolean {
  for (let d = 0; d < 6; d++) if (!isActive(offsetNeighbor(o, d as Direction))) return true;
  return false;
}

function outsideDirection(o: Offset, avoid?: Direction): Direction | null {
  for (let d = 0; d < 6; d++) {
    const dir = d as Direction;
    if (dir === avoid) continue;
    if (!isActive(offsetNeighbor(o, dir))) return dir;
  }
  return null;
}

function shuffled<T>(values: ReadonlyArray<T>, rng: RNG): T[] {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.intRange(0, i);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function weightedPick<T extends { weight: number }>(values: ReadonlyArray<T>, rng: RNG): T {
  const total = values.reduce((sum, value) => sum + Math.max(0, value.weight), 0);
  let roll = rng.next() * total;
  for (const value of values) {
    roll -= Math.max(0, value.weight);
    if (roll < 0) return value;
  }
  return values[values.length - 1]!;
}

function blankTiles(filler: TileDef['t']): Array<Array<TileDef | null>> {
  const tiles: Array<Array<TileDef | null>> = [];
  for (let row = 0; row < ROWS; row++) {
    const line: Array<TileDef | null> = [];
    for (let col = 0; col < COLS; col++) line.push(isActive({ col, row }) ? { t: filler } : null);
    tiles.push(line);
  }
  return tiles;
}

function tileAt(tiles: Array<Array<TileDef | null>>, o: Offset): TileDef | null {
  return tiles[o.row]?.[o.col] ?? null;
}

function setTerrain(tiles: Array<Array<TileDef | null>>, positions: Iterable<Offset>, terrain: TileDef['t']): void {
  for (const pos of positions) {
    const tile = tileAt(tiles, pos);
    if (tile) tile.t = terrain;
  }
}

function growRegion(
  candidates: ReadonlyArray<Offset>,
  count: number,
  rng: RNG,
  preferredStarts: ReadonlyArray<Offset> = [],
): Offset[] | null {
  if (count === 0) return [];
  const candidateKeys = new Set(candidates.map(key));
  if (candidateKeys.size < count) return null;
  const starts = preferredStarts.filter(p => candidateKeys.has(key(p)));
  const start = starts.length > 0 ? rng.pick(starts) : rng.pick(candidates);
  const selected: Offset[] = [cloneOffset(start)];
  const selectedKeys = new Set([key(start)]);
  while (selected.length < count) {
    const frontier: Offset[] = [];
    const seen = new Set<string>();
    for (const pos of selected) {
      for (const { pos: next } of neighborsOf(pos)) {
        const k = key(next);
        if (!candidateKeys.has(k) || selectedKeys.has(k) || seen.has(k)) continue;
        seen.add(k);
        frontier.push(next);
      }
    }
    if (frontier.length === 0) return null;
    const next = rng.pick(frontier);
    selected.push(cloneOffset(next));
    selectedKeys.add(key(next));
  }
  return selected;
}

function pickRandomTerrain(
  candidates: ReadonlyArray<Offset>,
  count: number,
  rng: RNG,
): Offset[] | null {
  if (count === 0) return [];
  if (candidates.length < count) return null;
  return shuffled(candidates, rng).slice(0, count).map(cloneOffset);
}

function pickSparseForest(
  candidates: ReadonlyArray<Offset>,
  count: number,
  rng: RNG,
  target?: Offset,
  awayFrom?: Offset,
): Offset[] | null {
  if (count === 0) return [];
  if (candidates.length < count) return null;
  const targetAxial = target ? offsetToAxial(target) : null;
  const awayAxial = awayFrom ? offsetToAxial(awayFrom) : null;
  const priority = (pos: Offset): number => {
    if (!targetAxial || !awayAxial) return 0;
    const axial = offsetToAxial(pos);
    return (hexDistance(axial, targetAxial) - hexDistance(axial, awayAxial)) * 10
      + hexDistance(axial, targetAxial);
  };
  let best: Offset[] | null = null;
  let bestSideBalance = Number.NEGATIVE_INFINITY;
  for (let attempt = 0; attempt < 300; attempt++) {
    const ordered = shuffled(candidates, rng).sort((a, b) => priority(a) - priority(b));
    const selected: Offset[] = [];
    const selectedKeys = new Set<string>();
    for (const pos of ordered) {
      const adjacentSelected = neighborsOf(pos).filter(item => selectedKeys.has(key(item.pos)));
      if (adjacentSelected.length > 1) continue;
      if (adjacentSelected.length === 1) {
        const partner = adjacentSelected[0]!.pos;
        if (neighborsOf(partner).some(item => selectedKeys.has(key(item.pos)))) continue;
      }
      selected.push(cloneOffset(pos));
      selectedKeys.add(key(pos));
      if (selected.length === count) {
        if (!targetAxial || !awayAxial) return selected;
        const sideBalance = selected.reduce((sum, selectedPos) => {
          const axial = offsetToAxial(selectedPos);
          const targetDistance = hexDistance(axial, targetAxial);
          const awayDistance = hexDistance(axial, awayAxial);
          return sum + (targetDistance < awayDistance ? 1 : (awayDistance < targetDistance ? -1 : 0));
        }, 0);
        if (sideBalance > bestSideBalance) {
          bestSideBalance = sideBalance;
          best = selected;
        }
        break;
      }
    }
  }
  return best;
}

function growRegionToward(
  candidates: ReadonlyArray<Offset>,
  count: number,
  rng: RNG,
  target: Offset,
  awayFrom: Offset,
): Offset[] | null {
  if (count === 0) return [];
  const candidateKeys = new Set(candidates.map(key));
  if (candidateKeys.size < count) return null;
  const targetAxial = offsetToAxial(target);
  const awayAxial = offsetToAxial(awayFrom);
  const priority = (pos: Offset): number => {
    const axial = offsetToAxial(pos);
    return (hexDistance(axial, targetAxial) - hexDistance(axial, awayAxial)) * 10
      + hexDistance(axial, targetAxial);
  };
  const rankedStarts = shuffled(candidates, rng).sort((a, b) => priority(a) - priority(b));
  const selected: Offset[] = [cloneOffset(rankedStarts[0]!)];
  const selectedKeys = new Set([key(selected[0]!)]);
  while (selected.length < count) {
    const frontier: Offset[] = [];
    const seen = new Set<string>();
    for (const pos of selected) {
      for (const { pos: next } of neighborsOf(pos)) {
        const nextKey = key(next);
        if (!candidateKeys.has(nextKey) || selectedKeys.has(nextKey) || seen.has(nextKey)) continue;
        seen.add(nextKey);
        frontier.push(next);
      }
    }
    if (frontier.length === 0) return null;
    const next = shuffled(frontier, rng).sort((a, b) => priority(a) - priority(b))[0]!;
    selected.push(cloneOffset(next));
    selectedKeys.add(key(next));
  }
  return selected;
}

function findExactBoundaryPath(
  candidates: ReadonlyArray<Offset>,
  length: number,
  rng: RNG,
  requiredKey?: string,
  straightAtRequired = false,
  forbiddenEndpointKeys: ReadonlySet<string> = new Set(),
): Offset[] | null {
  if (length < 2) return null;
  const allowed = new Set(candidates.map(key));
  const starts = shuffled(
    candidates.filter(p => isBoundary(p) && !forbiddenEndpointKeys.has(key(p))),
    rng,
  );
  let visits = 0;
  const maxVisits = 120000;

  const dfs = (path: Offset[], used: Set<string>): Offset[] | null => {
    if (++visits > maxVisits) return null;
    const current = path[path.length - 1]!;
    if (path.length === length) {
      if (!isBoundary(current) || forbiddenEndpointKeys.has(key(current))) return null;
      if (requiredKey && !used.has(requiredKey)) return null;
      return path.slice();
    }

    let candidatesNext = neighborsOf(current)
      .map(n => n.pos)
      .filter(next => allowed.has(key(next)) && !used.has(key(next)));

    if (straightAtRequired && requiredKey && key(current) === requiredKey && path.length >= 2) {
      const prev = path[path.length - 2]!;
      const incoming = directionTo(offsetToAxial(current), offsetToAxial(prev));
      if (incoming === null) return null;
      const requiredExit = ((incoming + 3) % 6) as Direction;
      candidatesNext = candidatesNext.filter(next =>
        directionTo(offsetToAxial(current), offsetToAxial(next)) === requiredExit,
      );
    }

    for (const next of shuffled(candidatesNext, rng)) {
      const nextKey = key(next);
      if (straightAtRequired && requiredKey && nextKey === requiredKey && path.length >= 2) {
        const prev = path[path.length - 2]!;
        const enter = directionTo(offsetToAxial(next), offsetToAxial(current));
        const prevToCurrent = directionTo(offsetToAxial(current), offsetToAxial(prev));
        if (enter === null || prevToCurrent === null || enter !== prevToCurrent) continue;
      }
      used.add(nextKey);
      path.push(next);
      const result = dfs(path, used);
      if (result) return result;
      path.pop();
      used.delete(nextKey);
    }
    return null;
  };

  for (const start of starts) {
    visits = 0;
    const result = dfs([start], new Set([key(start)]));
    if (result) return result;
  }
  return null;
}

function findSmoothRoadPath(
  candidates: ReadonlyArray<Offset>,
  start: Offset,
  end: Offset,
  rng: RNG,
  requiredStraightKey?: string,
  exactCellCount?: number,
): Offset[] | null {
  const allowed = new Set(candidates.map(key));
  if (!allowed.has(key(start)) || !allowed.has(key(end))) return null;
  const directDistance = hexDistance(offsetToAxial(start), offsetToAxial(end));
  const maxLength = exactCellCount ?? Math.min(ACTIVE.length, directDistance + 6);
  if (exactCellCount !== undefined && (exactCellCount < 2 || directDistance + 1 > exactCellCount)) return null;
  let visits = 0;
  const maxVisits = 120000;

  const dfs = (path: Offset[], used: Set<string>): Offset[] | null => {
    if (++visits > maxVisits) return null;
    const current = path[path.length - 1]!;
    const stepsUsed = path.length - 1;
    const remaining = hexDistance(offsetToAxial(current), offsetToAxial(end));
    if (path.length > maxLength || stepsUsed + remaining + 1 > maxLength) return null;
    if (key(current) === key(end)) {
      if (path.length < 2 || (requiredStraightKey && !used.has(requiredStraightKey))) return null;
      if (exactCellCount !== undefined && path.length !== exactCellCount) return null;
      const lastHeading = directionTo(offsetToAxial(path[path.length - 2]!), offsetToAxial(current));
      if (lastHeading === null || isActive(offsetNeighbor(current, lastHeading))) return null;
      return path.slice();
    }

    const previousHeading = path.length >= 2
      ? directionTo(offsetToAxial(path[path.length - 2]!), offsetToAxial(current))
      : null;
    const nextSteps = neighborsOf(current)
      .filter(({ pos, dir }) => {
        if (!allowed.has(key(pos)) || used.has(key(pos))) return false;
        if (previousHeading !== null) {
          const turn = (dir - previousHeading + 6) % 6;
          if (turn !== 0 && turn !== 1 && turn !== 5) return false;
          if (requiredStraightKey === key(current) && turn !== 0) return false;
        } else {
          const outsideDir = ((dir + 3) % 6) as Direction;
          if (isActive(offsetNeighbor(current, outsideDir))) return false;
        }
        return true;
      })
      .map(step => {
        const distance = hexDistance(offsetToAxial(step.pos), offsetToAxial(end));
        const turn = previousHeading === null ? 0 : (step.dir - previousHeading + 6) % 6;
        const turnCost = turn === 0 ? 0 : 0.35;
        return { ...step, score: distance + turnCost + rng.next() * 0.7 };
      })
      .sort((a, b) => a.score - b.score);

    for (const { pos: next } of nextSteps) {
      used.add(key(next));
      path.push(next);
      const result = dfs(path, used);
      if (result) return result;
      path.pop();
      used.delete(key(next));
    }
    return null;
  };

  return dfs([cloneOffset(start)], new Set([key(start)]));
}

function roadFlags(directions: ReadonlyArray<Direction>): string {
  const flags = ['0', '0', '0', '0', '0', '0'];
  for (const direction of directions) flags[direction] = '1';
  return flags.join('');
}

function applyLinearFeature(
  tiles: Array<Array<TileDef | null>>,
  path: Offset[],
  terrain: 'r' | 'a',
): [Direction, Direction] | null {
  if (path.length < 2) return null;
  const firstInside = directionTo(offsetToAxial(path[0]!), offsetToAxial(path[1]!));
  const lastInside = directionTo(offsetToAxial(path[path.length - 1]!), offsetToAxial(path[path.length - 2]!));
  if (firstInside === null || lastInside === null) return null;
  const straightFirstOutside = ((firstInside + 3) % 6) as Direction;
  const straightLastOutside = ((lastInside + 3) % 6) as Direction;
  const firstOutside = terrain === 'r'
    ? (!isActive(offsetNeighbor(path[0]!, straightFirstOutside)) ? straightFirstOutside : null)
    : outsideDirection(path[0]!, firstInside);
  const lastOutside = terrain === 'r'
    ? (!isActive(offsetNeighbor(path[path.length - 1]!, straightLastOutside)) ? straightLastOutside : null)
    : outsideDirection(path[path.length - 1]!, lastInside);
  if (firstOutside === null || lastOutside === null) return null;

  for (let i = 0; i < path.length; i++) {
    const pos = path[i]!;
    const tile = tileAt(tiles, pos);
    if (!tile) return null;
    const dirs: Direction[] = [];
    if (i > 0) {
      const d = directionTo(offsetToAxial(pos), offsetToAxial(path[i - 1]!));
      if (d !== null) dirs.push(d);
    } else dirs.push(firstOutside);
    if (i < path.length - 1) {
      const d = directionTo(offsetToAxial(pos), offsetToAxial(path[i + 1]!));
      if (d !== null) dirs.push(d);
    } else dirs.push(lastOutside);
    if (terrain === 'r' && tile.t === 'w') {
      if (dirs.length !== 2 || ((dirs[0]! + 3) % 6) !== dirs[1]) return null;
      tile.br = [dirs[0]!, dirs[1]!];
    } else {
      tile.t = terrain;
    }
    tile.rd = roadFlags(dirs);
  }
  return [firstOutside, lastOutside];
}

function findTankPath(tiles: Array<Array<TileDef | null>>, from: Offset, to: Offset): Offset[] | null {
  const passable = (o: Offset): boolean => {
    const tile = tileAt(tiles, o);
    if (!tile) return false;
    if (tile.t === 'F' || tile.t === 'H' || tile.t === 'dw') return false;
    if (tile.t === 'w') return !!tile.br;
    return true;
  };
  const canCross = (a: Offset, b: Offset): boolean => {
    if (!passable(b)) return false;
    const dirAB = directionTo(offsetToAxial(a), offsetToAxial(b));
    const dirBA = directionTo(offsetToAxial(b), offsetToAxial(a));
    if (dirAB === null || dirBA === null) return false;
    const ta = tileAt(tiles, a);
    const tb = tileAt(tiles, b);
    if (ta?.br && !ta.br.includes(dirAB)) return false;
    if (tb?.br && !tb.br.includes(dirBA)) return false;
    if (ta?.bw?.[dirAB] === '1' || tb?.bw?.[dirBA] === '1') return false;
    return true;
  };

  const queue: Offset[] = [from];
  const parent = new Map<string, string | null>([[key(from), null]]);
  const byKey = new Map(ACTIVE.map(p => [key(p), p]));
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!;
    if (key(current) === key(to)) break;
    for (const { pos: next } of neighborsOf(current)) {
      const k = key(next);
      if (parent.has(k) || !canCross(current, next)) continue;
      parent.set(k, key(current));
      queue.push(next);
    }
  }
  if (!parent.has(key(to))) return null;
  const out: Offset[] = [];
  let cursor: string | null = key(to);
  while (cursor) {
    out.push(cloneOffset(byKey.get(cursor)!));
    cursor = parent.get(cursor) ?? null;
  }
  return out.reverse();
}

function tankReachableShare(tiles: Array<Array<TileDef | null>>, from: Offset): number {
  const isPassable = (pos: Offset) => {
    const tile = tileAt(tiles, pos);
    if (!tile || ['F', 'H', 'dw'].includes(tile.t)) return false;
    return tile.t !== 'w' || !!tile.br;
  };
  const passableCount = ACTIVE.filter(isPassable).length;
  if (passableCount === 0 || !isPassable(from)) return 0;
  const queue: Offset[] = [from];
  const seen = new Set([key(from)]);
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!;
    const currentTile = tileAt(tiles, current)!;
    for (const { pos: next, dir } of neighborsOf(current)) {
      const nextKey = key(next);
      if (seen.has(nextKey) || !isPassable(next)) continue;
      const reverse = ((dir + 3) % 6) as Direction;
      const nextTile = tileAt(tiles, next)!;
      if (currentTile.br && !currentTile.br.includes(dir)) continue;
      if (nextTile.br && !nextTile.br.includes(reverse)) continue;
      if (currentTile.bw?.[dir] === '1' || nextTile.bw?.[reverse] === '1') continue;
      seen.add(nextKey);
      queue.push(next);
    }
  }
  return seen.size / passableCount;
}

function sampleEuropeCounts(rng: RNG): { water: number; forest: number; mud: number } {
  for (let i = 0; i < 500; i++) {
    const counts = {
      water: rng.intRange(0, 8),
      forest: rng.intRange(0, 6),
      mud: rng.intRange(1, 13),
    };
    const spaceBeforeRoad = 36 - counts.water - counts.forest - counts.mud;
    if (spaceBeforeRoad >= 16) return counts;
  }
  throw new Error('unable to sample European terrain counts');
}

function generateEuropeLayout(rng: RNG, exactRoadCellCount?: number): GeneratedLayout {
  const counts = sampleEuropeCounts(rng);
  const tiles = blankTiles('f');
  const reserved = new Set([key(START), key(EVAC)]);
  let water: Offset[] = [];
  let river = false;
  if (counts.water > 0) {
    const waterCandidates = ACTIVE.filter(p => !reserved.has(key(p)));
    if (counts.water >= 4 && rng.next() < 0.45) {
      water = findExactBoundaryPath(waterCandidates, counts.water, rng, undefined, false, reserved) ?? [];
      river = water.length === counts.water;
    }
    if (water.length !== counts.water) {
      water = growRegion(waterCandidates, counts.water, rng) ?? [];
      river = false;
    }
    if (water.length !== counts.water) throw new Error('unable to place European water');
    setTerrain(tiles, water, 'w');
  }

  const waterKeys = new Set(water.map(key));
  const roadCandidates = ACTIVE.filter(p => !waterKeys.has(key(p)));
  let bridge: Offset | undefined;
  if (river && water.length >= 4 && rng.next() < 0.65) {
    const bridgeCandidates = water.filter(pos => {
      for (let d = 0; d < 3; d++) {
        const a = offsetNeighbor(pos, d as Direction);
        const b = offsetNeighbor(pos, (d + 3) as Direction);
        if (isActive(a) && isActive(b) && !waterKeys.has(key(a)) && !waterKeys.has(key(b))) return true;
      }
      return false;
    });
    if (bridgeCandidates.length > 0) bridge = rng.pick(bridgeCandidates);
  }

  const roadEndpoints = roadCandidates.filter(pos => isBoundary(pos) && !reserved.has(key(pos)));
  if (roadEndpoints.length < 2) throw new Error('not enough European road endpoints');
  const roadStart = rng.pick(roadEndpoints);
  const distantEndpoints = roadEndpoints.filter(pos =>
    key(pos) !== key(roadStart)
    && hexDistance(offsetToAxial(roadStart), offsetToAxial(pos)) >= 4
    && (exactRoadCellCount === undefined
      || hexDistance(offsetToAxial(roadStart), offsetToAxial(pos)) + 1 <= exactRoadCellCount),
  );
  if (distantEndpoints.length === 0) throw new Error('no distant European road endpoint');
  const roadEnd = rng.pick(distantEndpoints);

  let roadPath: Offset[] | null = bridge
    ? findSmoothRoadPath([...roadCandidates, bridge], roadStart, roadEnd, rng, key(bridge), exactRoadCellCount)
    : null;
  if (!roadPath) {
    bridge = undefined;
    roadPath = findSmoothRoadPath(roadCandidates, roadStart, roadEnd, rng, undefined, exactRoadCellCount);
  }
  if (!roadPath) throw new Error('unable to create European road');
  const roadCellCount = roadPath.filter(pos => !waterKeys.has(key(pos))).length;
  const fieldCount = 36 - water.length - roadCellCount - counts.forest - counts.mud;
  if (fieldCount < 12 || fieldCount > 26) throw new Error('European field count outside observed range');
  const roadExitDirs = applyLinearFeature(tiles, roadPath, 'r');
  if (!roadExitDirs) throw new Error('unable to encode European road');

  const protectedPath = findTankPath(tiles, START, EVAC);
  if (!protectedPath) throw new Error('water/road layout disconnected player route');
  const protectedKeys = new Set(protectedPath.map(key));
  const occupied = new Set([...waterKeys, ...roadPath.filter(p => key(p) !== key(bridge ?? { col: -1, row: -1 })).map(key)]);

  const forestCandidates = ACTIVE.filter(p => !occupied.has(key(p)) && !protectedKeys.has(key(p)) && !reserved.has(key(p)));
  const forest = pickSparseForest(forestCandidates, counts.forest, rng) ?? [];
  if (forest.length !== counts.forest) throw new Error('unable to place forest');
  setTerrain(tiles, forest, 'F');
  for (const p of forest) occupied.add(key(p));

  const mudCandidates = ACTIVE.filter(p => !occupied.has(key(p)) && !reserved.has(key(p)));
  const mud = pickRandomTerrain(mudCandidates, counts.mud, rng) ?? [];
  if (mud.length !== counts.mud) throw new Error('unable to place mud');
  setTerrain(tiles, mud, 'm');

  placeBuildings(tiles, rng, rng.intRange(3, 6), new Set(['r', 'm', 'f']));
  placeHedges(tiles, rng, rng.intRange(1, 20));
  return { tiles, roadPath, roadExitDirs };
}

function samplePacificCounts(rng: RNG, forcedBattleType?: 'landing' | 'inland'): {
  battleType: 'landing' | 'inland'; hasAirstrip: boolean; beach: number; trees: number; rocky: number;
} {
  const battleType = forcedBattleType ?? rng.pick(['landing', 'inland'] as const);
  const hasAirstrip = rng.next() < 0.4;
  for (let i = 0; i < 500; i++) {
    const counts = {
      battleType,
      hasAirstrip,
      beach: battleType === 'landing' ? rng.intRange(5, 13) : 0,
      trees: rng.intRange(5, 15),
      rocky: rng.intRange(0, 5),
    };
    const spaceBeforeAirstrip = 36 - counts.beach - counts.trees - counts.rocky;
    if (spaceBeforeAirstrip >= 15) return counts;
  }
  throw new Error('unable to sample Pacific terrain counts');
}

function buildStraightSegment(start: Offset, direction: Direction, distance: number): Offset[] | null {
  const out: Offset[] = [cloneOffset(start)];
  let current = start;
  for (let i = 0; i < distance; i++) {
    current = offsetNeighbor(current, direction);
    if (!isActive(current)) return null;
    out.push(cloneOffset(current));
  }
  return out;
}

function airstripCandidates(blocked: ReadonlySet<string>): Offset[][] {
  const out: Offset[][] = [];
  const seen = new Set<string>();
  for (const start of ACTIVE) {
    if (blocked.has(key(start))) continue;
    for (let d = 0; d < 6; d++) {
      for (let distance = 2; distance < 8; distance++) {
        const segment = buildStraightSegment(start, d as Direction, distance);
        if (!segment || segment.some(pos => blocked.has(key(pos)))) break;
        const segmentKey = segment.map(key).sort().join('|');
        if (seen.has(segmentKey)) continue;
        seen.add(segmentKey);
        out.push(segment);
      }
    }
  }
  return out;
}

function placeAirstripSegments(
  tiles: Array<Array<TileDef | null>>,
  blocked: Set<string>,
  rng: RNG,
  segmentCount: number,
): Offset[] {
  const placed: Offset[] = [];
  for (let index = 0; index < segmentCount; index++) {
    const candidates = airstripCandidates(blocked);
    if (candidates.length === 0) {
      if (index === 0) throw new Error('unable to place an airstrip segment');
      break;
    }
    const segment = rng.pick(candidates);
    const direction = directionTo(offsetToAxial(segment[0]!), offsetToAxial(segment[1]!));
    if (direction === null) throw new Error('invalid airstrip direction');
    const flags = roadFlags([direction, ((direction + 3) % 6) as Direction]);
    for (const pos of segment) {
      const tile = tileAt(tiles, pos)!;
      tile.t = 'a';
      tile.rd = flags;
      blocked.add(key(pos));
      placed.push(cloneOffset(pos));
    }
  }
  return placed;
}

function pickNonAdjacent(
  candidates: ReadonlyArray<Offset>,
  count: number,
  rng: RNG,
): Offset[] | null {
  if (count === 0) return [];
  const chosen: Offset[] = [];
  for (const pos of shuffled(candidates, rng)) {
    if (chosen.some(other => hexDistance(offsetToAxial(pos), offsetToAxial(other)) <= 1)) continue;
    chosen.push(cloneOffset(pos));
    if (chosen.length === count) return chosen;
  }
  return null;
}

function generatePacificLayout(rng: RNG, forcedBattleType?: 'landing' | 'inland'): GeneratedLayout {
  const counts = samplePacificCounts(rng, forcedBattleType);
  const tiles = blankTiles('c');
  const reserved = new Set([key(START), key(EVAC)]);
  const beachCandidates = ACTIVE.filter(p => key(p) !== key(EVAC));
  const beach = growRegionToward(beachCandidates, counts.beach, rng, START, EVAC) ?? [];
  if (beach.length !== counts.beach) throw new Error('unable to place beach');
  setTerrain(tiles, beach, 'B');
  const occupied = new Set(beach.map(key));

  let airstripPath: Offset[] = [];
  if (counts.hasAirstrip) {
    for (const reservedKey of reserved) occupied.add(reservedKey);
    airstripPath = placeAirstripSegments(tiles, occupied, rng, rng.next() < 0.3 ? 2 : 1);
    for (const reservedKey of reserved) occupied.delete(reservedKey);
  }

  const clearCount = 36 - beach.length - airstripPath.length - counts.trees - counts.rocky;
  if (clearCount < 12 || clearCount > 23) throw new Error('Pacific clear count outside observed range');

  const preliminaryPath = findTankPath(tiles, START, EVAC);
  if (!preliminaryPath) throw new Error('Pacific coastline disconnected player route');
  const protectedKeys = new Set(preliminaryPath.map(key));

  const treeCandidates = ACTIVE.filter(p => !occupied.has(key(p)) && !reserved.has(key(p)));
  const trees = growRegionToward(treeCandidates, counts.trees, rng, EVAC, START) ?? [];
  if (trees.length !== counts.trees) throw new Error('unable to place Pacific trees');
  setTerrain(tiles, trees, 'T');
  for (const pos of trees) occupied.add(key(pos));

  const rockyCandidates = ACTIVE.filter(p => !occupied.has(key(p)) && !reserved.has(key(p)) && !protectedKeys.has(key(p)));
  const rocky = pickNonAdjacent(rockyCandidates, counts.rocky, rng) ?? [];
  if (rocky.length !== counts.rocky) throw new Error('unable to place rocky high ground');
  setTerrain(tiles, rocky, 'H');

  placeBuildings(tiles, rng, rng.intRange(4, 7), new Set(['c']));
  return { tiles, roadPath: airstripPath, roadExitDirs: null };
}

function placeBuildings(
  tiles: Array<Array<TileDef | null>>,
  rng: RNG,
  count: number,
  allowed: ReadonlySet<string>,
): void {
  const candidates = shuffled(ACTIVE.filter(pos => {
    if (key(pos) === key(START) || key(pos) === key(EVAC)) return false;
    const tile = tileAt(tiles, pos);
    return !!tile && allowed.has(tile.t) && !tile.br;
  }), rng);
  if (candidates.length < count) throw new Error('not enough building cells');
  const remaining = candidates.slice();
  const terrainWeights: Record<string, number> = { r: 53, m: 29, f: 18, c: 1 };
  for (let placed = 0; placed < count; placed++) {
    const weighted = remaining.map(pos => ({ pos, weight: terrainWeights[tileAt(tiles, pos)!.t] ?? 1 }));
    const chosen = weightedPick(weighted, rng).pos;
    tileAt(tiles, chosen)!.bd = 1;
    remaining.splice(remaining.findIndex(pos => key(pos) === key(chosen)), 1);
  }
}

function placeHedges(tiles: Array<Array<TileDef | null>>, rng: RNG, count: number): void {
  const edges: Array<{ pos: Offset; dir: Direction }> = [];
  const seen = new Set<string>();
  for (const pos of ACTIVE) {
    const tile = tileAt(tiles, pos);
      if (!tile || tile.t === 'w' || tile.t === 'F' || tile.t === 'r') continue;
    for (const { pos: next, dir } of neighborsOf(pos)) {
      if ([key(START), key(EVAC)].includes(key(pos)) || [key(START), key(EVAC)].includes(key(next))) continue;
      const other = tileAt(tiles, next);
      if (!other || other.t === 'w' || other.t === 'F' || other.t === 'r') continue;
      const edgeKey = [key(pos), key(next)].sort().join('|');
      if (seen.has(edgeKey)) continue;
      seen.add(edgeKey);
      edges.push({ pos, dir });
    }
  }
  for (const edge of shuffled(edges, rng).slice(0, count)) {
    const tile = tileAt(tiles, edge.pos)!;
    const chars = (tile.h ?? '000000').split('');
    chars[edge.dir] = '1';
    tile.h = chars.join('');
  }
}

function rollObjective(theater: RandomMissionTheater, rng: RNG): ObjectiveRoll {
  const roll = rng.intRange(1, 100);
  if (theater === 'europe') {
    if (roll <= 40) return { kind: 'destroy_all', objective: { type: 'destroy_all_enemies' } };
    if (roll <= 60) {
      return {
        kind: 'target_evac',
        objective: { type: 'destroy_kind_evac', evacAt: cloneOffset(EVAC), evacExitDir: 0 },
      };
    }
    if (roll <= 90) {
      return { kind: 'direct_evac', objective: { type: 'destroy_kind_evac', evacAt: cloneOffset(EVAC), evacExitDir: 0 } };
    }
    return { kind: 'truck', objective: { type: 'destroy_truck' } };
  }
  if (roll <= 45) return { kind: 'destroy_all', objective: { type: 'destroy_all_enemies' } };
  if (roll <= 65) {
    return {
      kind: 'target_evac',
      objective: { type: 'destroy_kind_evac', evacAt: cloneOffset(EVAC), evacExitDir: 0 },
    };
  }
  return { kind: 'direct_evac', objective: { type: 'destroy_kind_evac', evacAt: cloneOffset(EVAC), evacExitDir: 0 } };
}

function enemyBudget(_theater: RandomMissionTheater, _objective: ObjectiveRoll): EnemyBudget {
  return { min: 10, max: 12 };
}

function threatForKind(theater: RandomMissionTheater, kind: UnitKind): number {
  const europe: Partial<Record<UnitKind, number>> = {
    infantry: 1, panzer3: 2, panzer4: 3, tiger: 5,
  };
  const pacific: Partial<Record<UnitKind, number>> = {
    japanese_infantry: 1, type95: 2, type97: 3, at_gun: 3, heavy_artillery: 4,
  };
  return (theater === 'europe' ? europe[kind] : pacific[kind]) ?? 0;
}

function selectHighValueTarget(
  theater: RandomMissionTheater,
  objective: ObjectiveRoll,
  enemies: ReadonlyArray<UnitPlacement>,
  rng: RNG,
): void {
  if (objective.kind !== 'target_evac') return;
  const counts = new Map<UnitKind, number>();
  for (const enemy of enemies) counts.set(enemy.kind, (counts.get(enemy.kind) ?? 0) + 1);
  const kinds = [...counts.keys()].filter(kind => threatForKind(theater, kind) > 0);
  if (kinds.length === 0) throw new Error('target evacuation mission has no valuable enemy target');
  const maxSingleThreat = Math.max(...kinds.map(kind => threatForKind(theater, kind)));
  const maxAggregateThreat = Math.max(...kinds.map(kind => threatForKind(theater, kind) * counts.get(kind)!));
  const eligible = kinds.filter(kind =>
    threatForKind(theater, kind) === maxSingleThreat
    || threatForKind(theater, kind) * counts.get(kind)! === maxAggregateThreat,
  );
  const targetKind = rng.pick(eligible);
  objective.targetKind = targetKind;
  objective.objective = {
    type: 'destroy_kind_evac',
    kind: targetKind,
    evacAt: cloneOffset(EVAC),
    evacExitDir: 0,
  };
}

function buildEnemyRoster(theater: RandomMissionTheater, objective: ObjectiveRoll, rng: RNG): UnitPlacement[] {
  const budget = enemyBudget(theater, objective);
  const pool: WeightedKind[] = theater === 'europe'
    ? [
      { kind: 'infantry', weight: 5, threat: 1 },
      { kind: 'panzer3', weight: 4, threat: 2 },
      { kind: 'panzer4', weight: 4, threat: 3 },
      { kind: 'tiger', weight: 1, threat: 5 },
    ]
    : [
      { kind: 'japanese_infantry', weight: 4, threat: 1 },
      { kind: 'type95', weight: 4, threat: 2 },
      { kind: 'type97', weight: 4, threat: 3 },
      { kind: 'at_gun', weight: 4, threat: 3 },
      { kind: 'heavy_artillery', weight: 3, threat: 4 },
    ];
  const threatOf = (kind: UnitKind) => pool.find(entry => entry.kind === kind)?.threat ?? 0;
  const minCount = theater === 'europe' ? 2 : 3;
  const maxCount = theater === 'europe' ? 8 : 6;

  for (let attempt = 0; attempt < 1000; attempt++) {
    const defenderCount = objective.kind === 'truck' ? rng.intRange(2, 5) : rng.intRange(minCount, maxCount);
    const kinds: UnitKind[] = [];
    if (objective.targetKind) kinds.push(objective.targetKind);
    while (kinds.length < defenderCount) kinds.push(weightedPick(pool, rng).kind);
    const threat = kinds.reduce((sum, kind) => sum + threatOf(kind), 0);
    if (threat < budget.min || threat > budget.max) continue;
    if (kinds.filter(isFootKind).length > 6 || kinds.filter(kind => !isFootKind(kind)).length > 6) continue;
    const count = (kind: UnitKind) => kinds.filter(value => value === kind).length;
    if (theater === 'europe') {
      if (count('tiger') > 1 || count('panzer4') > 3 || count('infantry') > 6) continue;
      if (objective.targetKind !== 'infantry'
        && !kinds.some(kind => kind === 'panzer3' || kind === 'panzer4' || kind === 'tiger')) continue;
    } else {
      if (count('heavy_artillery') > 2 || count('at_gun') > 3 || count('japanese_infantry') > 3) continue;
      if (!kinds.some(kind => kind !== 'japanese_infantry')) continue;
    }
    const faction = theater === 'europe' ? 'german' : 'japanese';
    return kinds.map(kind => ({ kind, faction }));
  }
  throw new Error('unable to build enemy roster within budget');
}

function hasTankEnterableTerrain(tile: TileDef | null): boolean {
  return !!tile && !['F', 'w', 'dw', 'H', 'B'].includes(tile.t);
}

function distanceToBoundary(pos: Offset): number {
  return Math.min(...BOUNDARY_OFFSETS.map(boundary =>
    hexDistance(offsetToAxial(pos), offsetToAxial(boundary)),
  ));
}

function ridTerrainPriority(tile: TileDef | null): number {
  if (tile?.bd === 1) return 0;
  if (tile?.t === 'F') return 1;
  return 2;
}

function placeSpawnMarkers(
  tiles: Array<Array<TileDef | null>>,
  rng: RNG,
  extraReserved: ReadonlySet<string>,
): void {
  const startAxial = offsetToAxial(START);
  const baseCandidates = ACTIVE.filter(pos =>
    !extraReserved.has(key(pos))
    && key(pos) !== key(START)
    && key(pos) !== key(EVAC),
  );
  const eidCandidates = shuffled(baseCandidates.filter(pos =>
    hasTankEnterableTerrain(tileAt(tiles, pos))
    && hexDistance(offsetToAxial(pos), startAxial) >= 4
  ), rng)
    .sort((a, b) => {
      const buildingA = tileAt(tiles, a)?.bd === 1 ? 1 : 0;
      const buildingB = tileAt(tiles, b)?.bd === 1 ? 1 : 0;
      return buildingA - buildingB
        || hexDistance(offsetToAxial(a), startAxial) - hexDistance(offsetToAxial(b), startAxial);
    });
  if (eidCandidates.length < 6) throw new Error('not enough eid marker cells');
  const eids = eidCandidates.slice(0, 6);
  const used = new Set(eids.map(key));
  const ridCandidates = shuffled(baseCandidates.filter(pos => {
    const tile = tileAt(tiles, pos);
    const enterable = !!tile && !['w', 'dw', 'H', 'B'].includes(tile.t);
    return enterable && !used.has(key(pos)) && hexDistance(offsetToAxial(pos), startAxial) >= 3;
  }), rng).sort((a, b) => {
    return ridTerrainPriority(tileAt(tiles, a)) - ridTerrainPriority(tileAt(tiles, b))
      || distanceToBoundary(a) - distanceToBoundary(b);
  });
  if (ridCandidates.length < 6) throw new Error('not enough rid marker cells');
  const rids = ridCandidates.slice(0, 6);
  for (let i = 0; i < eids.length; i++) {
    const tile = tileAt(tiles, eids[i]!)!;
    tile.eid = i + 1;
    const base = approximateDirection(offsetToAxial(eids[i]!), startAxial);
    tile.ef = rng.next() < 0.3 ? ((base + (rng.next() < 0.5 ? 5 : 1)) % 6) : base;
  }
  for (let i = 0; i < rids.length; i++) {
    const tile = tileAt(tiles, rids[i]!)!;
    tile.rid = i + 1;
    const base = approximateDirection(offsetToAxial(rids[i]!), startAxial);
    tile.rf = rng.next() < 0.3 ? ((base + (rng.next() < 0.5 ? 5 : 1)) % 6) : base;
  }
}

function gunFacingForPosition(pos: Offset, rng: RNG): Direction {
  if (rng.next() < 2 / 3) return 3;
  return pos.row < ROWS / 2 ? 2 : 4;
}

function heavyArtilleryLineClear(
  tiles: Array<Array<TileDef | null>>,
  pos: Offset,
  facing: Direction,
): boolean {
  let current = offsetNeighbor(pos, facing);
  while (isActive(current)) {
    const tile = tileAt(tiles, current);
    if (!tile || tile.t === 'H' || tile.bd === 1) return false;
    current = offsetNeighbor(current, facing);
  }
  return true;
}

function liesOnForwardRay(from: Offset, facing: Direction, target: Offset): boolean {
  let current = offsetNeighbor(from, facing);
  while (isActive(current)) {
    if (key(current) === key(target)) return true;
    current = offsetNeighbor(current, facing);
  }
  return false;
}

function bindPacificGunPlacements(
  enemies: UnitPlacement[],
  tiles: Array<Array<TileDef | null>>,
  rng: RNG,
): void {
  const guns = enemies.filter(enemy => enemy.kind === 'at_gun');
  const artillery = enemies.filter(enemy => enemy.kind === 'heavy_artillery');
  if (guns.length === 0 && artillery.length === 0) return;
  const available = shuffled(ACTIVE.filter(pos => tileAt(tiles, pos)?.rid !== undefined), rng)
    .sort((a, b) => ridTerrainPriority(tileAt(tiles, a)) - ridTerrainPriority(tileAt(tiles, b))
      || distanceToBoundary(a) - distanceToBoundary(b));
  if (available.length < guns.length + artillery.length) throw new Error('not enough rid positions for gun placements');
  const placedArtillery: Array<{ pos: Offset; facing: Direction }> = [];

  for (const unit of artillery) {
    const useDirectionThree = rng.next() < 2 / 3;
    const candidateIndex = available.findIndex(pos => {
      const facing = (useDirectionThree ? 3 : (pos.row < ROWS / 2 ? 2 : 4)) as Direction;
      return heavyArtilleryLineClear(tiles, pos, facing)
        && placedArtillery.every(placed =>
          !liesOnForwardRay(pos, facing, placed.pos)
          && !liesOnForwardRay(placed.pos, placed.facing, pos),
        );
    });
    if (candidateIndex < 0) throw new Error('no heavy artillery position has a clear firing line');
    const pos = available.splice(candidateIndex, 1)[0]!;
    unit.at = cloneOffset(pos);
    unit.facing = (useDirectionThree ? 3 : (pos.row < ROWS / 2 ? 2 : 4)) as Direction;
    placedArtillery.push({ pos: cloneOffset(pos), facing: unit.facing });
  }

  for (let index = 0; index < guns.length; index++) {
    const pos = available.shift();
    if (!pos) throw new Error('not enough rid positions for AT gun crews');
    const facing = gunFacingForPosition(pos, rng);
    guns[index]!.at = cloneOffset(pos);
    guns[index]!.facing = facing;
  }

  const remainingRidIds = available
    .map(pos => tileAt(tiles, pos)?.rid)
    .filter((rid): rid is number => rid !== undefined);
  const unplacedInfantry = enemies.filter(enemy => enemy.kind === 'japanese_infantry' && !enemy.at);
  if (remainingRidIds.length < unplacedInfantry.length) {
    throw new Error('not enough unoccupied rid positions for Japanese infantry');
  }
  for (const infantry of unplacedInfantry) infantry.startRids = remainingRidIds.slice();
}

const EVENT_TEMPLATES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[2, 3], [4, 4], [5, 6], [7, 8], [9, 9], [10, 10], [11, 12]],
  [[2, 4], [5, 5], [6, 6], [7, 9], [10, 10], [11, 12]],
  [[2, 3], [4, 5], [6, 6], [7, 8], [9, 10], [11, 12]],
];

function buildTurnEndEvents(
  missionId: string,
  theater: RandomMissionTheater,
  objective: ObjectiveRoll,
  enemies: ReadonlyArray<UnitPlacement>,
  rng: RNG,
): TurnEndEventRow[] {
  const ranges = rng.pick(EVENT_TEMPLATES);
  const hasInfantry = enemies.some(enemy => enemy.kind === 'infantry' || enemy.kind === 'japanese_infantry');
  let effects: TurnEndEffectType[];
  if (theater === 'europe') {
    const tankSpawn: TurnEndEffectType = objective.targetKind === 'panzer3' ? 'panzer4_spawn' : 'panzer3_spawn';
    const reinforcement = objective.kind === 'destroy_all' ? 'none' : tankSpawn;
    const central: TurnEndEffectType = objective.kind === 'truck'
      ? 'german_truck_move'
      : (hasInfantry ? 'adjacent_infantry_fire' : 'none');
    effects = ranges.length === 7
      ? ['sniper', 'mechanical_failure', objective.kind === 'destroy_all' ? 'road_mine' : 'infantry_spawn', central, 'commander_extra', 'stuka', reinforcement]
      : ['road_mine', 'sniper', 'mechanical_failure', central, 'commander_extra', reinforcement];
  } else {
    const tankSpawn: TurnEndEffectType = objective.targetKind === 'type95' ? 'type97_spawn' : 'type95_spawn';
    const reinforcement = objective.kind === 'destroy_all' ? 'none' : tankSpawn;
    const central: TurnEndEffectType = hasInfantry ? 'heavy_mortar' : 'none';
    effects = ranges.length === 7
      ? ['clear_mine', 'mechanical_failure', 'sniper', central, 'infantry_spawn', 'commander_extra', reinforcement]
      : ['clear_mine', 'sniper', 'mechanical_failure', central, 'commander_extra', reinforcement];
  }

  if (objective.kind === 'destroy_all') {
    effects = effects.map(effect => effect.endsWith('_spawn') ? 'none' : effect);
  }
  if (objective.targetKind) {
    const forbidden: Partial<Record<UnitKind, TurnEndEffectType>> = {
      infantry: 'infantry_spawn', panzer3: 'panzer3_spawn', panzer4: 'panzer4_spawn', tiger: 'tiger_spawn',
      japanese_infantry: 'infantry_spawn', type95: 'type95_spawn', type97: 'type97_spawn',
    };
    const forbiddenEffect = forbidden[objective.targetKind];
    if (forbiddenEffect) effects = effects.map(effect => effect === forbiddenEffect ? 'none' : effect);
  }

  const rows = ranges.map((range, index) => {
    const effectType = effects[index] ?? 'none';
    return {
      missionId,
      sumMin: range[0],
      sumMax: range[1],
      diceCount: 2,
      effectType,
      ...(effectType.endsWith('_spawn') ? { reinforcementSide: 'enemy' as const } : {}),
    };
  });
  enforceEventThreatBudget(rows, theater, enemies);
  return rows;
}

function enforceEventThreatBudget(
  rows: TurnEndEventRow[],
  theater: RandomMissionTheater,
  enemies: ReadonlyArray<UnitPlacement>,
): void {
  const unitThreat: Partial<Record<UnitKind, number>> = theater === 'europe'
    ? { infantry: 1, panzer3: 2, panzer4: 3, tiger: 5, truck: 0 }
    : { japanese_infantry: 1, type95: 2, type97: 3, at_gun: 3, heavy_artillery: 4 };
  const spawnThreat: Partial<Record<TurnEndEffectType, number>> = theater === 'europe'
    ? { infantry_spawn: 1, panzer3_spawn: 2, panzer4_spawn: 3, tiger_spawn: 5 }
    : { infantry_spawn: 1, type95_spawn: 2, type97_spawn: 3 };
  const sumWays = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
  const initial = enemies.reduce((sum, enemy) => sum + (unitThreat[enemy.kind] ?? 0), 0);
  const expected = () => rows.reduce((sum, row) => {
    const threat = spawnThreat[row.effectType] ?? 0;
    let ways = 0;
    for (let value = row.sumMin; value <= row.sumMax; value++) ways += sumWays[value] ?? 0;
    return sum + 6 * (ways / 36) * threat;
  }, 0);
  const cap = theater === 'europe' ? 16 : 17;
  while (initial + expected() > cap) {
    const spawnRows = rows
      .filter(row => (spawnThreat[row.effectType] ?? 0) > 0)
      .sort((a, b) => (spawnThreat[b.effectType] ?? 0) - (spawnThreat[a.effectType] ?? 0));
    if (spawnRows.length === 0) break;
    spawnRows[0]!.effectType = 'none';
    delete spawnRows[0]!.reinforcementSide;
  }
}

function buildTruckPath(layout: GeneratedLayout): TruckPathEntry[] {
  if (!layout.roadExitDirs || layout.roadPath.length < 2) throw new Error('truck mission requires a complete road');
  return layout.roadPath.map((pos, index) => ({
    col: pos.col,
    row: pos.row,
    ...(index === layout.roadPath.length - 1 ? { exitDir: layout.roadExitDirs![1] } : {}),
  }));
}

function generateAttempt(
  theater: RandomMissionTheater,
  seed: number,
  options: RandomMissionGenerationOptions,
): CustomMissionPackage {
  const rng = new RNG(seed);
  const objectiveRoll = rollObjective(theater, rng);
  const layout = theater === 'europe'
    ? generateEuropeLayout(rng, objectiveRoll.kind === 'truck' ? 8 : undefined)
    : generatePacificLayout(rng, options.pacificBattleType);
  const enemies = buildEnemyRoster(theater, objectiveRoll, rng);
  selectHighValueTarget(theater, objectiveRoll, enemies, rng);
  let truckPath: TruckPathEntry[] | undefined;
  const markerReserved = new Set<string>();
  if (objectiveRoll.kind === 'truck') {
    truckPath = buildTruckPath(layout);
    const truckStart = cloneOffset(truckPath[0]!);
    markerReserved.add(key(truckStart));
    enemies.unshift({ kind: 'truck', faction: 'german', at: truckStart });
  }
  const missionId = `random_${theater}_${seed >>> 0}`;
  const turnEndEvents = buildTurnEndEvents(missionId, theater, objectiveRoll, enemies, rng);
  if (!findTankPath(layout.tiles, START, EVAC)) throw new Error('final terrain disconnected player route');
  if (tankReachableShare(layout.tiles, START) < 1) throw new Error('not all passable tiles are player-connected');
  placeSpawnMarkers(layout.tiles, rng, markerReserved);
  bindPacificGunPlacements(enemies, layout.tiles, rng);

  const mission: MissionData = {
    id: missionId,
    name: theater === 'europe' ? `随机关卡（欧洲）#${seed >>> 0}` : `随机关卡（太平洋）#${seed >>> 0}`,
    description: `由随机关卡生成器 v${RANDOM_MISSION_GENERATOR_VERSION} 生成；seed=${seed >>> 0}`,
    theater,
    cols: COLS,
    rows: ROWS,
    enemyStartByDice: true,
    tiles: layout.tiles,
    sherman: { kind: 'sherman', faction: 'usa', at: cloneOffset(START), facing: 0 },
    enemies,
    objective: objectiveRoll.objective,
    ...(theater === 'pacific' ? { usCasualtyLimit: 10 } : {}),
    actionTableId: theater === 'pacific' ? 'pacific_b4' : 'standard',
    aiTableId: theater === 'pacific' ? 'pacific_b4' : 'standard',
    eventTableId: missionId,
    ...(truckPath ? { truckPath } : {}),
  };
  return {
    schemaVersion: 1,
    editorVersion: `random-${RANDOM_MISSION_GENERATOR_VERSION}`,
    savedAt: Date.now(),
    source: 'developer',
    mission,
    turnEndEvents,
    editor: { notes: `generatorVersion=${RANDOM_MISSION_GENERATOR_VERSION};seed=${seed >>> 0}`, tags: ['random', theater] },
  };
}

export function generateRandomMissionPackage(
  theater: RandomMissionTheater,
  seed: number = Date.now(),
  options: RandomMissionGenerationOptions = {},
): CustomMissionPackage {
  const normalizedSeed = (seed >>> 0) || 1;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return generateAttempt(theater, (normalizedSeed + attempt) >>> 0 || 1, options);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`随机关卡生成失败（${theater}, seed=${normalizedSeed}）：${String(lastError)}`);
}
