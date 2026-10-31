import { ROAD_CANONICAL_MASKS, roadSpriteTransform } from './UrbanTerrain';

/** Art configuration only; connections do not constrain weapons or movement. */
export type FortificationArtKind = 'trench' | 'gun_pit';
export interface FortificationArtConfig {
  kind: FortificationArtKind;
  /** Same character order as road rd: E, SE, SW, W, NW, NE. */
  connections: string;
}

export const FORTIFICATION_ART_SIZE = { width: 222, height: 256 } as const;
export const FORTIFICATION_ART_DIRECTIONS = ['E', 'SE', 'SW', 'W', 'NW', 'NE'] as const;
export const FORTIFICATION_ART_MASKS: readonly number[] = [0, ...ROAD_CANONICAL_MASKS];

export function validateFortificationArtConfig(config: FortificationArtConfig): void {
  if (!config || (config.kind !== 'trench' && config.kind !== 'gun_pit')) {
    throw new Error('Fortification art kind must be trench or gun_pit');
  }
  if (typeof config.connections !== 'string' || !/^[01]{6}$/.test(config.connections)) {
    throw new Error('Fortification connections must be six 0/1 characters (E, SE, SW, W, NW, NE)');
  }
}

/** Reuse the road rotation mapping, including its Cocos clockwise/CCW convention. */
export function fortificationArtTransform(config: FortificationArtConfig) {
  validateFortificationArtConfig(config);
  const transform = roadSpriteTransform([...config.connections].map(bit => bit === '1'));
  const canonicalFlags = transform?.canonicalFlags ?? '000000';
  const stem = `${config.kind}_${canonicalFlags}_v1`;
  return {
    canonicalMask: transform?.canonicalMask ?? 0,
    canonicalFlags,
    rotationSteps: transform?.rotationSteps ?? 0,
    rotationDegrees: transform?.rotationDegrees ?? 0,
    surface: `textures/terrain/fortifications/${stem}/spriteFrame`,
    foreground: `textures/terrain/fortifications/${stem}_rim/spriteFrame`,
  };
}
