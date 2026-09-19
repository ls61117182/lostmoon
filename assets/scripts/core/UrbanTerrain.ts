import type { Tile } from './types';

export type UrbanIndestructibleVariant =
  | 'apartment' | 'factory' | 'office_l' | 'warehouse'
  | 'market' | 'theater' | 'post_office' | 'waterworks';
export type UrbanDestructibleVariant = 'rowhouses_l' | 'courtyard' | 'workshop' | 'block';

export const URBAN_INDESTRUCTIBLE_VARIANTS: readonly UrbanIndestructibleVariant[] = [
  'apartment', 'factory', 'office_l', 'warehouse',
  'market', 'theater', 'post_office', 'waterworks',
];
export const URBAN_DESTRUCTIBLE_VARIANTS: readonly UrbanDestructibleVariant[] = [
  'rowhouses_l', 'courtyard', 'workshop', 'block',
];

function seedFor(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

function shuffled<T>(items: readonly T[], seedText: string): T[] {
  const out = [...items];
  let state = seedFor(seedText);
  const next = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** 每轮先洗牌并完整使用一次式样池；数量超过池大小后才开始下一轮重复。 */
export function createUrbanVariantAllocator(missionId: string) {
  let indestructibleIndex = 0;
  let destructibleIndex = 0;
  let indestructibleCycle = 0;
  let destructibleCycle = 0;
  let indestructiblePool = shuffled(URBAN_INDESTRUCTIBLE_VARIANTS, `${missionId}:ui:0`);
  let destructiblePool = shuffled(URBAN_DESTRUCTIBLE_VARIANTS, `${missionId}:ud:0`);
  let previousIndestructible: UrbanIndestructibleVariant | undefined;
  let previousDestructible: UrbanDestructibleVariant | undefined;
  return {
    nextIndestructible(): UrbanIndestructibleVariant {
      if (indestructibleIndex >= indestructiblePool.length) {
        indestructibleIndex = 0;
        indestructiblePool = shuffled(URBAN_INDESTRUCTIBLE_VARIANTS, `${missionId}:ui:${++indestructibleCycle}`);
        if (indestructiblePool[0] === previousIndestructible && indestructiblePool.length > 1) {
          [indestructiblePool[0], indestructiblePool[1]] = [indestructiblePool[1]!, indestructiblePool[0]!];
        }
      }
      return previousIndestructible = indestructiblePool[indestructibleIndex++]!;
    },
    nextDestructible(): UrbanDestructibleVariant {
      if (destructibleIndex >= destructiblePool.length) {
        destructibleIndex = 0;
        destructiblePool = shuffled(URBAN_DESTRUCTIBLE_VARIANTS, `${missionId}:ud:${++destructibleCycle}`);
        if (destructiblePool[0] === previousDestructible && destructiblePool.length > 1) {
          [destructiblePool[0], destructiblePool[1]] = [destructiblePool[1]!, destructiblePool[0]!];
        }
      }
      return previousDestructible = destructiblePool[destructibleIndex++]!;
    },
  };
}

export function urbanBuildingState(tile: Tile): 'intact' | 'damaged' | 'rubble' | null {
  if (tile.urbanKind === 'indestructible') return 'intact';
  if (tile.urbanKind !== 'destructible') return null;
  if ((tile.urbanStructure ?? 2) <= 0 || tile.terrain === 'urban_rubble') return 'rubble';
  return (tile.urbanStructure ?? 2) === 1 ? 'damaged' : 'intact';
}

/** HE 威力 1-2 造成 1 点；3-4 造成 2 点。其它值钳制到最近档。 */
export function urbanStructureDamage(highExplosivePower: number): number {
  if (highExplosivePower <= 0) return 0;
  return highExplosivePower <= 2 ? 1 : 2;
}

export function applyUrbanStructureDamage(tile: Tile, highExplosivePower: number): number {
  if (tile.urbanKind !== 'destructible' || tile.terrain === 'urban_rubble') return 0;
  const damage = urbanStructureDamage(highExplosivePower);
  const before = Math.max(0, Math.min(2, tile.urbanStructure ?? 2));
  tile.urbanStructure = Math.max(0, before - damage);
  if (tile.urbanStructure === 0) tile.terrain = 'urban_rubble';
  return before - tile.urbanStructure;
}

export function urbanBuildingSpritePath(tile: Tile): string | null {
  const variant = tile.urbanVariant;
  const state = urbanBuildingState(tile);
  if (!variant || !state) return null;
  if (tile.urbanKind === 'indestructible') {
    return `textures/terrain/urban/urban_dense_indestructible_${variant}_v1/spriteFrame`;
  }
  if (variant === 'block') {
    if (state === 'intact') return 'textures/terrain/urban/urban_dense_destructible_intact_topdown_v2/spriteFrame';
    if (state === 'damaged') return 'textures/terrain/urban/urban_dense_destructible_damaged_topdown_v2/spriteFrame';
    return 'textures/terrain/urban/urban_dense_destructible_block_rubble_v1/spriteFrame';
  }
  return `textures/terrain/urban/urban_dense_destructible_${variant}_${state}_v1/spriteFrame`;
}

/**
 * Compact destructible-building drawings need a little more of the hex than the
 * tall row-house group. Keep one scale per variant so damage-state changes do
 * not make a building visibly jump in size.
 */
export function urbanBuildingSpriteScale(tile: Tile): number {
  if (tile.urbanKind !== 'destructible') return 1;
  switch (tile.urbanVariant) {
    case 'courtyard': return 1.12;
    case 'workshop': return 1.14;
    case 'block': return 1.08;
    default: return 1;
  }
}
