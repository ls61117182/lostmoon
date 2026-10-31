export interface MachineGunBurstPoint {
  x: number;
  y: number;
}

/** Source PNG coordinates: X grows right, Y grows down; tank art faces left. */
export interface MachineGunSpriteTransform {
  originX: number;
  originY: number;
  anchorX: number;
  anchorY: number;
  scaleX: number;
  scaleY: number;
  ux: number;
  uy: number;
}

export function machineGunSpritePoint(
  spriteX: number, spriteY: number, t: MachineGunSpriteTransform,
): MachineGunBurstPoint {
  const x = (spriteX - t.anchorX) * t.scaleX;
  const y = (t.anchorY - spriteY) * t.scaleY;
  return { x: t.originX - x * t.ux + y * t.uy, y: t.originY - x * t.uy - y * t.ux };
}

export function machineGunSpriteCoordinates(
  point: MachineGunBurstPoint, t: MachineGunSpriteTransform,
): MachineGunBurstPoint {
  const dx = point.x - t.originX;
  const dy = point.y - t.originY;
  return {
    x: t.anchorX - (dx * t.ux + dy * t.uy) / t.scaleX,
    y: t.anchorY - (dx * t.uy - dy * t.ux) / t.scaleY,
  };
}

/** A zero pair keeps legacy assets usable until their firing port is calibrated. */
export function isMachineGunMuzzleConfigured(spriteX: number, spriteY: number): boolean {
  return spriteX !== 0 || spriteY !== 0;
}

/** Fallback for uncalibrated ports and generic/anti-aircraft MG fire. */
export const MACHINE_GUN_MUZZLE_FORWARD_HEXES = 0.52;

export function machineGunBurstStartPoint(
  center: MachineGunBurstPoint,
  ux: number,
  uy: number,
  hexSize: number,
): MachineGunBurstPoint {
  const dist = Math.max(12, hexSize * MACHINE_GUN_MUZZLE_FORWARD_HEXES);
  return {
    x: center.x + ux * dist,
    y: center.y + uy * dist,
  };
}

/** Prevent a tracer's long tail from visually extending behind its muzzle. */
export function clampMachineGunTracerTail(desiredTail: number, distanceFromMuzzle: number): number {
  return Math.max(0, Math.min(desiredTail, distanceFromMuzzle));
}
