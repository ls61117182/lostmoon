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
