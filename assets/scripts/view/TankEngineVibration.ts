import type { UnitKind } from '../core/types';

export interface TankEngineVibrationSample {
  x: number;
  y: number;
  angleDeg: number;
}

const STILL: TankEngineVibrationSample = Object.freeze({ x: 0, y: 0, angleDeg: 0 });

export const TANK_ENGINE_VIBRATION_FREQUENCY_HZ = 4.75;
/** Keep the implementation wired in while shipping the effect disabled by default. */
export const TANK_ENGINE_VIBRATION_DEFAULT_ENABLED = false;

/** Engine-powered mobile ground units. Towed guns and foot units are intentionally absent. */
export function unitKindHasEngineVibration(kind: UnitKind): boolean {
  return kind === 'sherman'
    || kind === 'sherman76'
    || kind === 't34'
    || kind === 'tiger'
    || kind === 'tigerking'
    || kind === 'maus'
    || kind === 'panther'
    || kind === 'panzer4'
    || kind === 'stug3'
    || kind === 'panzer3'
    || kind === 'type95'
    || kind === 'type97'
    || kind === 'type4'
    || kind === 'truck';
}

/** Stable per-unit phase prevents every vehicle on the map vibrating in lockstep. */
export function tankEngineVibrationPhaseOffset(unitId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < unitId.length; i++) {
    hash ^= unitId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

/**
 * Presentation-only idle engine vibration for a 90-degree top-down tank.
 * The stronger motion runs across the hull, with a smaller fore/aft pulse.
 */
export function tankEngineVibrationSample(
  elapsedSeconds: number,
  bodyAngleDeg: number,
  active: boolean,
  amplitudePx = 1.15,
  frequencyHz = TANK_ENGINE_VIBRATION_FREQUENCY_HZ,
  phaseOffsetCycles = 0,
): TankEngineVibrationSample {
  if (!active || amplitudePx <= 0 || frequencyHz <= 0) return STILL;

  const phase = (Math.max(0, elapsedSeconds) * frequencyHz + phaseOffsetCycles) * Math.PI * 2;
  const lateral = amplitudePx * (
    Math.sin(phase) * 0.78
    + Math.sin(phase * 1.73 + 0.7) * 0.22
  );
  const longitudinal = amplitudePx * 0.22 * Math.sin(phase * 0.51 + 1.1);
  const angleDeg = 0.11 * (
    Math.sin(phase + 0.35) * 0.8
    + Math.sin(phase * 1.37) * 0.2
  );

  const bodyRad = bodyAngleDeg * Math.PI / 180;
  const forwardX = Math.cos(bodyRad);
  const forwardY = Math.sin(bodyRad);
  const rightX = forwardY;
  const rightY = -forwardX;
  return {
    x: forwardX * longitudinal + rightX * lateral,
    y: forwardY * longitudinal + rightY * lateral,
    angleDeg,
  };
}
