import { RNG } from './Dice';
import { HexMap, hexDistance, neighbor, neighbors } from './HexGrid';
import type { Axial, Direction, TileDef } from './types';

export interface RegionalTerrainCell { pos: Axial; tile: TileDef; region: number; }
type Step = { to: Axial; bridge?: Axial; direction: Direction };
const key = HexMap.keyOf;

/** Build roads and water on the complete map, before assigning per-region tile arrays. */
export function generateMultiRegionTerrain(raw: Map<string, RegionalTerrainCell>, centers: Axial[], rng: RNG): () => void {
  const cells = Array.from(raw.values());
  const patch = (terrain: TileDef['t'], size: number) => {
    let frontier = [rng.pick(cells).pos];
    const visited = new Set<string>();
    while (frontier.length && visited.size < size) {
      const index = rng.intRange(0, frontier.length - 1), pos = frontier.splice(index, 1)[0];
      if (visited.has(key(pos))) continue;
      visited.add(key(pos)); raw.get(key(pos))!.tile = { t: terrain };
      frontier.push(...neighbors(pos).filter(next => raw.has(key(next)) && !visited.has(key(next))));
    }
  };
  for (let i = 0; i < centers.length * 2; i++) patch('F', rng.intRange(2, 4));
  for (let i = 0; i < centers.length * 2; i++) patch('m', rng.intRange(3, 6));

  let water = new Set<string>();
  const steps = (pos: Axial, existingBridgesOnly = false): Step[] => {
    const out: Step[] = [];
    for (let i = 0; i < 6; i++) {
      const direction = i as Direction, adjacent = neighbor(pos, direction);
      if (!raw.has(key(adjacent))) continue;
      if (!water.has(key(adjacent))) { out.push({ to: adjacent, direction }); continue; }
      const exit = neighbor(adjacent, direction), bridge = raw.get(key(adjacent))!.tile.br;
      if (!raw.has(key(exit)) || water.has(key(exit))) continue;
      if (bridge && !bridge.includes(direction)) continue;
      if (existingBridgesOnly && !bridge) continue;
      out.push({ to: exit, bridge: adjacent, direction });
    }
    return out;
  };
  const reachable = (start: Axial, bridgesOnly = false, avoidForest = false) => {
    const seen = new Set([key(start)]), queue = [start];
    for (let i = 0; i < queue.length; i++) for (const step of steps(queue[i], bridgesOnly)) {
      if (avoidForest && raw.get(key(step.to))!.tile.t === 'F') continue;
      if (!seen.has(key(step.to))) { seen.add(key(step.to)); queue.push(step.to); }
    }
    return seen;
  };

  // A random axial direction and offset give a continuous, one-cell-wide river.
  // Reject boundary fragments and cuts that cannot be bridged legally.
  const rivers: RegionalTerrainCell[][] = [];
  for (const projection of [(p: Axial) => p.q, (p: Axial) => p.r, (p: Axial) => p.q + p.r]) {
    const lines = new Map<number, RegionalTerrainCell[]>();
    for (const cell of cells) {
      const line = projection(cell.pos);
      if (!lines.has(line)) lines.set(line, []);
      lines.get(line)!.push(cell);
    }
    for (const line of lines.values()) {
      const remaining = new Set(line.map(cell => key(cell.pos)));
      while (remaining.size) {
        const first = raw.get(remaining.values().next().value!)!, component = [first];
        remaining.delete(key(first.pos));
        for (let i = 0; i < component.length; i++) for (const pos of neighbors(component[i].pos)) {
          if (remaining.delete(key(pos))) component.push(raw.get(key(pos))!);
        }
        if (component.length >= 5 && new Set(component.map(cell => cell.region)).size >= 2) rivers.push(component);
      }
    }
  }
  let crossings: Array<{ cell: RegionalTerrainCell; direction: Direction }> = [];
  while (rivers.length) {
    const river = rivers.splice(rng.intRange(0, rivers.length - 1), 1)[0];
    water = new Set(river.map(cell => key(cell.pos)));
    crossings = river.flatMap(cell => [0, 1, 2].filter(direction => {
      const a = neighbor(cell.pos, direction as Direction), b = neighbor(cell.pos, (direction + 3) as Direction);
      return raw.has(key(a)) && raw.has(key(b)) && !water.has(key(a)) && !water.has(key(b));
    }).map(direction => ({ cell, direction: direction as Direction })));
    const land = cells.filter(cell => !water.has(key(cell.pos)));
    if (crossings.length && reachable(land[0].pos).size === land.length) break;
    crossings = [];
  }
  if (!crossings.length) throw new Error('No continuous bridgeable river');
  for (const cell of cells) if (water.has(key(cell.pos))) cell.tile = { t: 'w' };
  const crossing = rng.pick(crossings);
  crossing.cell.tile.br = [crossing.direction, (crossing.direction + 3) as Direction];

  const road = new Set<string>();
  const costs = new Map(cells.map(cell => [key(cell.pos), 1 + rng.next() * 3]));
  const addRoad = (pos: Axial) => {
    const cell = raw.get(key(pos))!;
    if (cell.tile.t !== 'w') cell.tile.t = 'r';
    road.add(key(pos));
  };
  const connect = (target: Axial) => {
    const distances = new Map<string, number>(), previous = new Map<string, { from: Axial; step: Step }>();
    const open = new Set<string>();
    for (const source of road) if (!water.has(source)) { distances.set(source, 0); open.add(source); }
    while (open.size) {
      let current = '', best = Infinity;
      for (const candidate of open) if (distances.get(candidate)! < best) { current = candidate; best = distances.get(candidate)!; }
      open.delete(current);
      if (current === key(target)) break;
      for (const step of steps(raw.get(current)!.pos)) {
        const next = key(step.to), cost = best + (road.has(next) ? .25 : costs.get(next)!) + (step.bridge ? .5 : 0);
        if (cost >= (distances.get(next) ?? Infinity)) continue;
        distances.set(next, cost); previous.set(next, { from: raw.get(current)!.pos, step }); open.add(next);
      }
    }
    if (!distances.has(key(target))) throw new Error('Unable to connect regional roads');
    let current = key(target);
    addRoad(target);
    while (previous.has(current)) {
      const { from, step } = previous.get(current)!;
      if (step.bridge) {
        raw.get(key(step.bridge))!.tile.br = [step.direction, ((step.direction + 3) % 6) as Direction];
        addRoad(step.bridge);
      }
      addRoad(from); current = key(from);
    }
  };
  const land = cells.filter(cell => !water.has(key(cell.pos)));
  addRoad(neighbor(crossing.cell.pos, crossing.direction));
  connect(neighbor(crossing.cell.pos, (crossing.direction + 3) as Direction));
  const anchors = centers.map((center, region) => land.filter(cell => cell.region === region)
    .sort((a, b) => hexDistance(a.pos, center) - hexDistance(b.pos, center))[0].pos);
  const boundary = land.filter(cell => neighbors(cell.pos).some(pos => !raw.has(key(pos))));
  const entrance = rng.pick(boundary).pos;
  const exit = boundary.slice().sort((a, b) => hexDistance(b.pos, entrance) - hexDistance(a.pos, entrance))[0].pos;
  for (const target of [...anchors, entrance, exit]) connect(target);
  // Narrow edge cuts can create extra banks. Connect every traversable cell, not just regional centers.
  const connectLand = () => {
    let seen = reachable(anchors[0], true, true);
    for (const cell of land) if (cell.tile.t !== 'F' && !seen.has(key(cell.pos))) {
      connect(cell.pos); seen = reachable(anchors[0], true, true);
    }
  };
  connectLand();

  for (let region = 0; region < centers.length; region++) {
    const candidates = land.filter(cell => cell.region === region && cell.tile.t !== 'F')
      .map(cell => ({ cell, score: rng.next() + (cell.tile.t === 'r' ? 1 : 0) }))
      .sort((a, b) => b.score - a.score);
    for (const { cell } of candidates.slice(0, rng.intRange(3, 5))) cell.tile.bd = 1;
  }
  // Deployment can clear a forest cell. The caller reruns this after placing units.
  return connectLand;
}
