import type { Direction, TileDef } from './types';
import { axialToOffset, neighbor, offsetToAxial } from './HexGrid';

export type NormandyEditorBrush = 'steel' | 'crater' | 'wire_intact' | 'wire_damaged' | 'seawall' | 'erase';
export type EditorTileGrid = Array<Array<TileDef | null>>;
const water = (tile: TileDef | null | undefined) => !!tile && ['w', 'dw', 'B', 'esw'].includes(tile.t);
function writeFlag(tile: TileDef, field: 'wire' | 'sw', dir: number, state: number): void {
  const valid = field === 'wire' ? /^[012]{6}$/ : /^[01]{6}$/;
  const chars = (valid.test(tile[field] ?? '') ? tile[field]! : '000000').split('');
  chars[dir] = String(state);
  const flags = chars.join('');
  if (flags === '000000') delete tile[field]; else tile[field] = flags;
}

export function normandyEditorEdgeState(grid: EditorTileGrid, row: number, col: number, dir: number, field: 'wire' | 'sw', parity: 0 | 1 = 0): number {
  const other = axialToOffset(neighbor(offsetToAxial({ row, col }, parity), dir as Direction), parity);
  const a = Number(grid[row]?.[col]?.[field]?.[dir] ?? 0), b = Number(grid[other.row]?.[other.col]?.[field]?.[(dir + 3) % 6] ?? 0);
  return a === 1 || b === 1 ? 1 : field === 'wire' && (a === 2 || b === 2) ? 2 : 0;
}

/** Keep an existing opposite-side representation in sync with the edited edge. */
export function setNormandyEditorEdge(grid: EditorTileGrid, row: number, col: number, dir: number, field: 'wire' | 'sw', state: number, parity: 0 | 1 = 0): boolean {
  if (!Number.isInteger(dir) || dir < 0 || dir > 5 || !Number.isInteger(state) || state < 0 || state > (field === 'wire' ? 2 : 1)) return false;
  const tile = grid[row]?.[col];
  if (!tile || water(tile)) return false;
  writeFlag(tile, field, dir, state);
  const other = axialToOffset(neighbor(offsetToAxial({ row, col }, parity), dir as Direction), parity);
  const adjacent = grid[other.row]?.[other.col], back = (dir + 3) % 6;
  if (adjacent && Number(adjacent[field]?.[back] ?? 0) > 0) writeFlag(adjacent, field, back, state);
  return true;
}

/** Apply the brush to authoring data; never discard starts, units or other edges. */
export function applyNormandyEditorBrush(grid: EditorTileGrid, row: number, col: number, brush: NormandyEditorBrush, dir = 0, parity: 0 | 1 = 0): boolean {
  if (!Number.isInteger(row) || !Number.isInteger(col) || !grid[row] || col < 0 || col >= grid[row].length || !Number.isInteger(dir) || dir < 0 || dir > 5) return false;
  const existing = grid[row][col];
  if (brush === 'erase') {
    if (!existing) return false;
    delete existing.sh; delete existing.cr;
    // Include opposite-side-only flags, so erasing the visible edge really removes it.
    for (let edge = 0; edge < 6; edge++) {
      if (!water(existing)) {
        setNormandyEditorEdge(grid, row, col, edge, 'wire', 0, parity);
        setNormandyEditorEdge(grid, row, col, edge, 'sw', 0, parity);
      }
    }
    delete existing.wire; delete existing.sw;
    return true;
  }
  if (brush === 'steel' || brush === 'crater') {
    const tile: TileDef = { ...(existing ?? {}), t: 'eb' };
    // Beach overlays need sand; road/bridge direction data belongs to the old base.
    delete tile.br; delete tile.rd;
    if (brush === 'steel') tile.sh = 1; else tile.cr = 1;
    grid[row][col] = tile;
    return true;
  }
  if (water(existing)) return false;
  if (!existing) grid[row][col] = { t: 'eb' };
  return setNormandyEditorEdge(grid, row, col, dir, brush === 'seawall' ? 'sw' : 'wire', brush === 'wire_damaged' ? 2 : 1, parity);
}
