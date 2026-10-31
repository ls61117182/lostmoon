import type { Faction, UnitKind } from '../core/types';
import type { InfantryVisualKind } from '../core/InfantryVisualDB';

/** Hull artwork faces left; +X is the rear deck. Keep heads behind the turret's rear edge.
 * Seats use the hull's displayed, unscaled local dimensions.
 */
export const TANK_RIDER_SEATS = [
  { x: 0.24, y: 0.46, angle: 180 },
  { x: 0.38, y: 0.46, angle: 180 },
  { x: 0.365, y: -0.46, angle: 0 },
] as const;

/** Hull faces left, so its right side is local +Y. Mirror seats and outward leg directions. */
export function tankRiderSeats(doubleSide: 'left' | 'right' = 'right') {
  return TANK_RIDER_SEATS.map(seat => doubleSide === 'right' ? seat
    : { x: seat.x, y: -seat.y, angle: (seat.angle + 180) % 360 });
}

/** RGB gains calibrated against the original standing sprites at a 24px bounding size.
 * Broad highlights in simplified art otherwise average much brighter after minification.
 * Keep alpha unchanged; each weapon variant uses its own source reference.
 */
export const TANK_RIDER_COLORS = [
  { r: 139, g: 131, b: 134 },
  { r: 160, g: 154, b: 157 },
  { r: 163, g: 157, b: 157 },
] as const;

/** Anchor at the hips, using the untrimmed seated sprite canvas. */
export const TANK_RIDER_HIP_ANCHOR = { x: 0.5, y: 0.39 };
export const TANK_RIDER_WIDTH_TO_HULL = 0.289;
/** Pull each rider toward the hull center by 5% of its displayed image height. */
export const TANK_RIDER_INWARD_OFFSET_TO_HEIGHT = 0.05;
export const AMERICAN_SEATED_SPRITE_PATHS = [
  'textures/units/AmericanInfantry01_seated_olive/spriteFrame',
  'textures/units/AmericanInfantry02_seated_olive/spriteFrame',
  'textures/units/AmericanInfantry03_seated_olive/spriteFrame',
] as const;

const EUROPEAN_SEATED = {
  paths: [1, 2, 3].map(i => `textures/units/Infantry0${i}_seated/spriteFrame`),
  colors: [{ r: 153, g: 153, b: 148 }, { r: 143, g: 145, b: 141 }, { r: 176, g: 178, b: 159 }],
};
export const SEATED_INFANTRY_VISUALS: Record<InfantryVisualKind, {
  paths: readonly string[]; colors: readonly { r: number; g: number; b: number }[];
}> = {
  infantry: EUROPEAN_SEATED,
  german_infantry: EUROPEAN_SEATED,
  soviet_infantry: EUROPEAN_SEATED,
  japanese_infantry: {
    paths: [1, 2, 3].map(i => `textures/units/JapaneseInfantry0${i}_seated/spriteFrame`),
    colors: [{ r: 173, g: 172, b: 173 }, { r: 164, g: 167, b: 177 }, { r: 173, g: 172, b: 173 }],
  },
  american_infantry: { paths: AMERICAN_SEATED_SPRITE_PATHS, colors: TANK_RIDER_COLORS },
};

export function seatedInfantryVisualOf(kind: UnitKind) {
  return SEATED_INFANTRY_VISUALS[kind as InfantryVisualKind] ?? SEATED_INFANTRY_VISUALS.american_infantry;
}

export function seatedInfantryKindForFaction(faction: Faction): InfantryVisualKind {
  return faction === 'german' ? 'german_infantry' : faction === 'soviet' ? 'soviet_infantry'
    : faction === 'japanese' ? 'japanese_infantry' : 'american_infantry';
}
