import type { Offset } from './types';

export const STANDARD_MAP_COLS = 8;
export const STANDARD_MAP_ROWS = 6;
export const STANDARD_MAP_ROW_RANGES: ReadonlyArray<readonly [number, number]> = [
  [2, 6], [1, 6], [1, 7], [0, 6], [1, 6], [1, 5],
];

export function standardMapOffsets(): Offset[] {
  return STANDARD_MAP_ROW_RANGES.flatMap(([first, last], row) =>
    Array.from({ length: last - first + 1 }, (_, i) => ({ col: first + i, row })));
}
