export interface MachineGunBurstEndpoint {
  lateralOffset: number;
  shotIndex: number;
}

export function orderMachineGunBurstEndpointsByLateralOffset<T extends MachineGunBurstEndpoint>(
  endpoints: readonly T[],
): T[] {
  return [...endpoints].sort((a, b) =>
    b.lateralOffset - a.lateralOffset || a.shotIndex - b.shotIndex,
  );
}
