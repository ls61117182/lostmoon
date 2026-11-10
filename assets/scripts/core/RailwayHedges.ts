import type { TileDef } from './types';

type EdgeTile = Pick<TileDef, 'h' | 'rl'>;
type Grid<T extends EdgeTile = TileDef> = Array<Array<T | null>>;

/** Offset coordinates; independent of the renderer and usable by the file-save service. */
function adjacent(row: number, col: number, dir: number, parity: 0 | 1) {
  const odd = (row + parity) & 1;
  const offsets = [[0,1],[1,odd],[1,odd-1],[0,-1],[-1,odd-1],[-1,odd]];
  return { row: row + offsets[dir][0], col: col + offsets[dir][1] };
}

export function railwayCrossesEditorEdge<T extends EdgeTile>(grid: Grid<T>, row: number, col: number,
  dir: number, parity: 0 | 1 = 0): boolean {
  const next = adjacent(row, col, dir, parity);
  return grid[row]?.[col]?.rl?.[dir] === '1'
    || grid[next.row]?.[next.col]?.rl?.[(dir + 3) % 6] === '1';
}

function removeHedge(tile: EdgeTile | null | undefined, dir: number): number {
  if (tile?.h?.[dir] !== '1') return 0;
  const bits = [...tile.h]; bits[dir] = '0';
  const next = bits.join('');
  if (next === '000000') delete tile.h; else tile.h = next;
  return 1;
}

/** Remove both representations of the same physical edge, including neighbour-only hedges. */
export function clearRailwayEdgeHedges<T extends EdgeTile>(grid: Grid<T>, row: number, col: number,
  dir: number, parity: 0 | 1 = 0): number {
  const next = adjacent(row, col, dir, parity);
  return removeHedge(grid[row]?.[col], dir) + removeHedge(grid[next.row]?.[next.col], (dir + 3) % 6);
}

export function setEditorRailwaySafeHedge(grid: Grid, row: number, col: number, dir: number,
  enabled: boolean, parity: 0 | 1 = 0): boolean {
  const tile = grid[row]?.[col];
  if (!tile || (enabled && railwayCrossesEditorEdge(grid, row, col, dir, parity))) return false;
  const bits = [...(tile.h ?? '000000')]; bits[dir] = enabled ? '1' : '0';
  const flags = bits.join('');
  if (flags === '000000') delete tile.h; else tile.h = flags;
  return true;
}

/** Save-time repair also handles imported maps, one-sided rails, holes and shifted row parity. */
export function removeRailwayHedgeConflicts<T extends EdgeTile>(grid: Grid<T>, parity: 0 | 1 = 0): number {
  let removed = 0;
  for (let row = 0; row < grid.length; row++) for (let col = 0; col < grid[row].length; col++) {
    const tile = grid[row][col];
    if (!tile?.h) continue;
    for (let dir = 0; dir < 6; dir++) if (tile.h?.[dir] === '1' && railwayCrossesEditorEdge(grid, row, col, dir, parity)) {
      removed += clearRailwayEdgeHedges(grid, row, col, dir, parity);
    }
  }
  return removed;
}

/** Preserve the caller's draft and all unrelated authoring fields while normalizing a saved copy. */
export function railwaySafeTiles<T extends EdgeTile>(tiles: Grid<T>, parity: 0 | 1 = 0): Grid<T> {
  const copy = tiles.map(row => row.map(tile => tile ? { ...tile } : tile));
  removeRailwayHedgeConflicts(copy, parity);
  return copy;
}
