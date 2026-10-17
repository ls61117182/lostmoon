export const ROCKY_HIGHLAND_VARIANT_COUNT = 6;
export const ROCKY_HIGHLAND_SPRITE_PATHS = Array.from({ length: ROCKY_HIGHLAND_VARIANT_COUNT },
  (_, index) => `textures/terrain/rocky_highland_${String(index + 1).padStart(2, '0')}/spriteFrame`);

type TerrainCell = { terrain: string; pos: { q: number; r: number } };
const NEIGHBORS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
export const rockyCellKey = (pos: TerrainCell['pos']): string => `${pos.q},${pos.r}`;

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  }
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return value >>> 0;
}

/** Cosmetic randomness is independent of combat dice and stable across saves.
 * Row order leaves at most three already assigned hex neighbors, so six images
 * always allow a different image from every adjacent rocky cell. Prefer the
 * least-used available image; seeded tie breaks avoid a visible colour pattern. */
export function assignRockyHighlandVariants(tiles: readonly TerrainCell[], seed: string): Map<string, number> {
  const cells = tiles.filter(tile => tile.terrain === 'rocky')
    .slice().sort((a, b) => a.pos.r - b.pos.r || a.pos.q - b.pos.q);
  const result = new Map<string, number>();
  const counts = Array(ROCKY_HIGHLAND_VARIANT_COUNT).fill(0) as number[];
  for (const { pos } of cells) {
    const key = rockyCellKey(pos);
    const excluded = new Set(NEIGHBORS.map(([dq, dr]) =>
      result.get(rockyCellKey({ q: pos.q + dq, r: pos.r + dr }))));
    let best = -1, bestTie = Infinity;
    for (let variant = 0; variant < ROCKY_HIGHLAND_VARIANT_COUNT; variant++) {
      if (excluded.has(variant)) continue;
      const tie = hash(`${seed}|${key}|${variant}`);
      if (best < 0 || counts[variant] < counts[best] || (counts[variant] === counts[best] && tie < bestTie)) {
        best = variant;
        bestTie = tie;
      }
    }
    result.set(key, best);
    counts[best]++;
  }
  return result;
}
