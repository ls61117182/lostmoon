import type { Axial, Direction } from '../core/types';
import { approximateDirection, axialToPixel, directionTo, HEX_DIRECTIONS } from '../core/HexGrid';

export function infantryVisualDirection(from: Axial, to: Axial): Direction | null {
  const exact = directionTo(from, to);
  if (exact !== null) return exact;
  if (from.q === to.q && from.r === to.r) return null;
  return approximateDirection(from, to);
}

export function infantrySpriteAngle(direction: Direction): number {
  const projected = axialToPixel(HEX_DIRECTIONS[direction], 1);
  const screenHeading = Math.atan2(-projected.y, projected.x) * 180 / Math.PI;
  let angle = screenHeading + 90;
  while (angle > 180) angle -= 360;
  while (angle <= -180) angle += 360;
  return Math.round(angle * 1_000_000) / 1_000_000;
}

/** Returns the wide formation when a squad shares its hex with any live unit. */
export function infantrySquadOffsets(hexSize: number, coLocateOtherUnit: boolean): Array<{ ox: number; oy: number }> {
  const teamRadius = hexSize * 0.5;
  const ringR = coLocateOtherUnit ? hexSize * 0.58 : teamRadius * 0.546;
  const sin60 = Math.sqrt(3) / 2;
  return [
    { ox: 0, oy: ringR },
    { ox: ringR * sin60, oy: -ringR * 0.5 },
    { ox: -ringR * sin60, oy: -ringR * 0.5 },
  ];
}
