import type { Axial, Direction, Tile, TileDef } from './types';

export const SLOPE_DIRECTIONS = ['E', 'SE', 'SW', 'W', 'NW', 'NE'] as const;
/** Third-version sprite geometry, retained for offline comparisons. Live scenery uses ElevationContour. */
export const SLOPE_ART = { width: 384, height: 256, center: 128, anchorY: 0.5, widthScale: 2, heightScale: 4 / 3,
  slopeDepth: 114, cliffDepth: 82 } as const;
const STEPS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const;
export const tileHeight = (tile: { height?: number } | null | undefined): number => tile?.height ?? 0;
/** A continuous terrace value supports the relief even when rain/fog reduces contrast. */
export function elevationSurfaceTint(height: number): { value: number; alpha: number } | null {
  return height === 0 ? null : { value: height > 0 ? 255 : 0,
    alpha: Math.min(52, (height > 0 ? 34 : 32) + Math.log2(Math.max(1, Math.abs(height))) * 5) };
}

export function validateElevation(tile: Pick<TileDef, 'height' | 'cliff'>): void {
  if (tile.height !== undefined && (typeof tile.height !== 'number' || !Number.isFinite(tile.height))) {
    throw new Error('height must be a finite number (default 0; negative heights are allowed)');
  }
  if (tile.cliff !== undefined && (typeof tile.cliff !== 'string' || !/^[01]{6}$/.test(tile.cliff))) {
    throw new Error('cliff must contain six 0/1 edge flags (E, SE, SW, W, NW, NE)');
  }
}

export function isCliffEdge(a: Tile | undefined, b: Tile | undefined, dir: number): boolean {
  return !!a && !!b && tileHeight(a) !== tileHeight(b)
    && (!!a.cliffs?.[dir] || !!b.cliffs?.[(dir + 3) % 6]);
}

export interface ElevationEdge {
  high: Tile;
  low: Tile;
  /** From the higher cell towards the lower cell, independent of which side holds the cliff flag. */
  direction: Direction;
  difference: number;
  blocked: boolean;
}

/** Emit each shared border once, from its higher side; map holes have no implicit height. */
export function elevationEdges(tiles: readonly Tile[]): ElevationEdge[] {
  const key = (p: Axial) => `${p.q},${p.r}`;
  const lookup = new Map(tiles.map(tile => [key(tile.pos), tile]));
  const result: ElevationEdge[] = [];
  for (const high of tiles) for (let direction = 0; direction < 6; direction++) {
    const step = STEPS[direction];
    const low = lookup.get(key({ q: high.pos.q + step[0], r: high.pos.r + step[1] }));
    if (!low || tileHeight(high) <= tileHeight(low)) continue;
    result.push({ high, low, direction: direction as Direction,
      difference: tileHeight(high) - tileHeight(low), blocked: isCliffEdge(high, low, direction) });
  }
  return result;
}

/** Height changes change the width of the slope, never the grid or the unit positions. */
export function slopeDepth(difference: number): number {
  return Math.min(1.7, 1 + Math.log2(Math.max(1, Math.abs(difference))) * 0.22);
}

/** Every direction and each supported camera orientation has its own baked lighting. */
export function slopeSpritePath(direction: number, blocked: boolean, cameraRotation = 0): string {
  return `textures/terrain/elevation/${blocked ? 'cliff' : 'slope'}_${SLOPE_DIRECTIONS[direction].toLowerCase()}_c${cameraRotation === 90 ? 90 : 0}_v1/spriteFrame`;
}
export const SLOPE_SPRITE_PATHS = [0, 90].flatMap(camera => [false, true].flatMap(blocked =>
  SLOPE_DIRECTIONS.map((_, direction) => slopeSpritePath(direction, blocked, camera))));

/** Local artwork: tangent X, downhill -Y; the shared border bisects the slope face. */
export function slopePlacement(edge: ElevationEdge, size: number) {
  const a = -edge.direction * Math.PI / 3;
  const distance = size * Math.sqrt(3) / 2;
  return { x: Math.cos(a) * distance, y: Math.sin(a) * distance,
    angle: 90 - edge.direction * 60, width: size * SLOPE_ART.widthScale,
    height: size * SLOPE_ART.heightScale * slopeDepth(edge.difference) };
}

export interface ElevationJoin {
  edge: ElevationEdge;
  neighbors: Array<{ edge: ElevationEdge; rowU: [number, number, number, number]; rowV: [number, number, number, number] }>;
}
/** One hex vertex has at most three physical edges; each segment therefore has at most four neighbors. */
export function elevationJoins(edges: readonly ElevationEdge[]): ElevationJoin[] {
  const geometry = edges.map(edge => {
    const theta = edge.direction * Math.PI / 3, n = { x: Math.cos(theta), y: -Math.sin(theta) }, t = { x: Math.sin(theta), y: Math.cos(theta) };
    const c = { x: Math.sqrt(3) * (edge.high.pos.q + edge.high.pos.r / 2) + n.x * Math.sqrt(3) / 2,
      y: -edge.high.pos.r * 1.5 + n.y * Math.sqrt(3) / 2 };
    return { c, n, t, h: SLOPE_ART.heightScale * slopeDepth(edge.difference) };
  });
  const vertices = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.round(x * 100000)},${Math.round(y * 100000)}`;
  const ends = geometry.map((g, i) => [-1, 1].map(sign => {
    const k = key(g.c.x + sign * .5 * g.t.x, g.c.y + sign * .5 * g.t.y);
    const at = vertices.get(k) ?? []; at.push(i); vertices.set(k, at); return k;
  }));
  const dot = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x * b.x + a.y * b.y;
  return edges.map((edge, i) => {
    const g = geometry[i], indices = [...new Set(ends[i].flatMap(k => vertices.get(k)!))].filter(j => j !== i);
    return { edge, neighbors: indices.map(j => {
      const b = geometry[j], offset = { x: g.c.x - b.c.x, y: g.c.y - b.c.y };
      const ux = dot(g.t, b.t), uy = dot(g.n, b.t) * g.h / SLOPE_ART.widthScale;
      const vx = dot(g.t, b.n) * SLOPE_ART.widthScale / b.h, vy = dot(g.n, b.n) * g.h / b.h;
      return { edge: edges[j], rowU: [ux, uy, .5 + dot(offset, b.t) / SLOPE_ART.widthScale - .5 * (ux + uy), b.h] as [number, number, number, number],
        rowV: [vx, vy, .5 + dot(offset, b.n) / b.h - .5 * (vx + vy), edges[j].direction] as [number, number, number, number] };
    }) };
  });
}

type EditorGrid = Array<Array<TileDef | null>>;
/** Only height/edge data is needed for the editor's shared slope renderer. */
export function editorElevationTiles(grid: EditorGrid, parity: 0 | 1 = 0): Tile[] {
  const result: Tile[] = [];
  grid.forEach((row, r) => row.forEach((tile, col) => {
    if (!tile) return;
    result.push({ pos: { q: col - ((r + parity - ((r + parity) & 1)) >> 1), r }, terrain: 'clear',
      height: tileHeight(tile), cliffs: tile.cliff?.split('').map(bit => bit === '1') as Tile['cliffs'] });
  }));
  return result;
}
function editorNeighbor(row: number, col: number, dir: number, parity: 0 | 1) {
  const step = STEPS[dir], r = row + step[1];
  const q = col - ((row + parity - ((row + parity) & 1)) >> 1) + step[0];
  return { row: r, col: q + ((r + parity - ((r + parity) & 1)) >> 1) };
}
export function editorCliffState(grid: EditorGrid, row: number, col: number, dir: number, parity: 0 | 1 = 0): boolean {
  const n = editorNeighbor(row, col, dir, parity);
  return grid[row]?.[col]?.cliff?.[dir] === '1' || grid[n.row]?.[n.col]?.cliff?.[(dir + 3) % 6] === '1';
}
export function setEditorCliff(grid: EditorGrid, row: number, col: number, dir: number, blocked: boolean, parity: 0 | 1 = 0): boolean {
  if (!Number.isInteger(dir) || dir < 0 || dir > 5 || !grid[row]?.[col]) return false;
  const write = (tile: TileDef, direction: number) => {
    const flags = (tile.cliff ?? '000000').split(''); flags[direction] = blocked ? '1' : '0';
    if (flags.some(bit => bit === '1')) tile.cliff = flags.join(''); else delete tile.cliff;
  };
  write(grid[row][col]!, dir);
  const n = editorNeighbor(row, col, dir, parity), adjacent = grid[n.row]?.[n.col], back = (dir + 3) % 6;
  if (adjacent?.cliff?.[back] === '1') write(adjacent, back);
  return true;
}
