export interface MachineGunBurstPoint {
  x: number;
  y: number;
}

/** Keep every tank's MG tracers visually anchored near the front edge of its turret. */
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
