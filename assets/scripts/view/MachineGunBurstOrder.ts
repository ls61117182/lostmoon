export interface MachineGunBurstEndpoint {
  x: number;
  y: number;
  shotIndex: number;
}

export function orderMachineGunBurstEndpointsClockwise<T extends MachineGunBurstEndpoint>(
  endpoints: readonly T[],
  centerX: number,
  centerY: number,
): T[] {
  return [...endpoints].sort((a, b) => {
    const angleDelta = Math.atan2(b.y - centerY, b.x - centerX)
      - Math.atan2(a.y - centerY, a.x - centerX);
    return Math.abs(angleDelta) > 1e-12 ? angleDelta : a.shotIndex - b.shotIndex;
  });
}
