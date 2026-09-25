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

export interface UrbanRoadSpriteTransform {
  mask: number;
  canonicalMask: number;
  canonicalFlags: string;
  rotationSteps: number;
  rotationDegrees: number;
}

export function rotateUrbanRoadMask(mask: number, clockwiseSteps: number): number {
  const steps = ((clockwiseSteps % 6) + 6) % 6;
  const normalized = mask & 0x3f;
  if (steps === 0) return normalized;
  return ((normalized << steps) | (normalized >> (6 - steps))) & 0x3f;
}

export function urbanRoadMask(roads: readonly boolean[]): number {
  let mask = 0;
  for (let index = 0; index < 6; index++) if (roads[index]) mask |= 1 << index;
  return mask;
}

/** Collapse six rotational variants to one sprite and return the runtime rotation. */
export function urbanRoadSpriteTransform(roads: readonly boolean[]): UrbanRoadSpriteTransform | null {
  const mask = urbanRoadMask(roads);
  if (mask === 0) return null;
  let canonicalMask = mask;
  let rotationSteps = 0;
  for (let steps = 1; steps < 6; steps++) {
    const candidate = rotateUrbanRoadMask(mask, -steps);
    if (candidate < canonicalMask) {
      canonicalMask = candidate;
      rotationSteps = steps;
    }
  }
  return {
    mask,
    canonicalMask,
    canonicalFlags: Array.from({ length: 6 }, (_, index) =>
      canonicalMask & (1 << index) ? '1' : '0').join(''),
    rotationSteps,
    // Direction indices run clockwise (E, SE, SW, W, NW, NE), while Cocos Z rotation is CCW.
    rotationDegrees: rotationSteps === 0 ? 0 : -rotationSteps * 60,
  };
}

export const URBAN_ROAD_CANONICAL_MASKS: readonly number[] = Array.from(
  new Set(Array.from({ length: 63 }, (_, index) => {
    const mask = index + 1;
    return urbanRoadSpriteTransform(Array.from({ length: 6 }, (_, bit) => !!(mask & (1 << bit))))!.canonicalMask;
  })),
).sort((a, b) => a - b);

// European and city roads share the same six-direction encoding and rotational
// reduction. Keep generic aliases so both renderers use one tested mapping.
export type RoadSpriteTransform = UrbanRoadSpriteTransform;
export const ROAD_CANONICAL_MASKS = URBAN_ROAD_CANONICAL_MASKS;
export const roadSpriteTransform = urbanRoadSpriteTransform;

const EUROPEAN_ROAD_RAYS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0.5, -Math.sqrt(3) / 2], [-0.5, -Math.sqrt(3) / 2],
  [-1, 0], [-0.5, Math.sqrt(3) / 2], [0.5, Math.sqrt(3) / 2],
];
const EUROPEAN_ROAD_HALF_WIDTH = 0.18;
const EUROPEAN_ROAD_TURN_RADIUS = 43 / 128;
const EUROPEAN_ROAD_JUNCTION_BLEND = 30 / 128;

/**
 * Distance from a point to the exact centerline used by the prebuilt European
 * road art. Coordinates are local Cocos coordinates measured in hex radii.
 */
export function europeanRoadCenterlineDistance(
  roads: readonly boolean[], x: number, y: number,
): number {
  const dirs = EUROPEAN_ROAD_RAYS.filter((_, direction) => roads[direction]);
  if (dirs.length === 0) return Number.POSITIVE_INFINITY;
  const pairs: Array<[number, number]> = [];
  for (let a = 0; a < dirs.length; a++) for (let b = a + 1; b < dirs.length; b++) {
    if (dirs[a][0] * dirs[b][0] + dirs[a][1] * dirs[b][1] > -.99) pairs.push([a, b]);
  }

  if (dirs.length === 2 && pairs.length > 0) {
    const [u, v] = dirs;
    const angle = Math.acos(u[0] * v[0] + u[1] * v[1]);
    const tangent = EUROPEAN_ROAD_TURN_RADIUS / Math.tan(angle / 2);
    const bisectorLength = Math.hypot(u[0] + v[0], u[1] + v[1]);
    const centerOffset = EUROPEAN_ROAD_TURN_RADIUS / Math.sin(angle / 2);
    const cx = (u[0] + v[0]) / bisectorLength * centerOffset;
    const cy = (u[1] + v[1]) / bisectorLength * centerOffset;
    const start = Math.atan2(tangent * u[1] - cy, tangent * u[0] - cx);
    const end = Math.atan2(tangent * v[1] - cy, tangent * v[0] - cx);
    const sweep = Math.atan2(Math.sin(end - start), Math.cos(end - start));
    let distance = Number.POSITIVE_INFINITY;
    for (const [ux, uy] of dirs) {
      const dot = x * ux + y * uy - tangent;
      distance = Math.min(distance,
        dot >= 0 ? Math.abs(x * uy - y * ux) : Math.hypot(x - tangent * ux, y - tangent * uy));
    }
    const relative = Math.atan2(
      Math.sin(Math.atan2(y - cy, x - cx) - start),
      Math.cos(Math.atan2(y - cy, x - cx) - start),
    );
    if (relative * Math.sign(sweep) >= 0 && Math.abs(relative) <= Math.abs(sweep)) {
      distance = Math.min(distance, Math.abs(Math.hypot(x - cx, y - cy) - EUROPEAN_ROAD_TURN_RADIUS));
    }
    return distance;
  }

  const distances = dirs.map(([ux, uy]) =>
    x * ux + y * uy >= 0 ? Math.abs(x * uy - y * ux) : Math.hypot(x, y));
  let result = Math.min(...distances);
  if (dirs.length === 1) {
    return Math.min(result, Math.hypot(x, y) - EUROPEAN_ROAD_HALF_WIDTH * .6);
  }
  for (const [a, b] of pairs) {
    if (x * dirs[a][0] + y * dirs[a][1] < 0 || x * dirs[b][0] + y * dirs[b][1] < 0) continue;
    const blend = Math.max(0,
      1 - Math.abs(distances[a] - distances[b]) / EUROPEAN_ROAD_JUNCTION_BLEND);
    result = Math.min(result,
      Math.min(distances[a], distances[b]) - EUROPEAN_ROAD_JUNCTION_BLEND * blend * blend / 4);
  }
  return result;
}

/** Positive outside the rendered road edge, negative on the road surface. */
export function europeanRoadSurfaceClearance(
  roads: readonly boolean[], x: number, y: number,
): number {
  return europeanRoadCenterlineDistance(roads, x, y) - EUROPEAN_ROAD_HALF_WIDTH;
}

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
