export const RAIN_VISUAL_SLOT_COUNT = 56;

export type RainVisualPhase = 'idle' | 'fall' | 'splash';

export interface RainVisualSample {
  phase: RainVisualPhase;
  impactX: number;
  impactY: number;
  headX: number;
  headY: number;
  streakLength: number;
  slant: number;
  alpha: number;
  fallDistance: number;
  fallSpeed: number;
  splashRadius: number;
  splashRayLength: number;
  splashRayCount: number;
  splashRotation: number;
}

const UINT32_RANGE = 0x100000000;
const TAU = Math.PI * 2;

function hash01(slot: number, cycle: number, channel: number): number {
  let value = Math.imul((slot + 1) ^ 0x9e3779b9, 0x85ebca6b);
  value ^= Math.imul(cycle + 0x7f4a7c15, 0xc2b2ae35);
  value ^= Math.imul(channel + 1, 0x27d4eb2d);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / UINT32_RANGE;
}

function lerp(min: number, max: number, amount: number): number {
  return min + (max - min) * amount;
}

export function sampleRainVisual(
  slot: number,
  time: number,
  width: number,
  height: number,
  out: RainVisualSample,
): void {
  const safeSlot = Math.max(0, Math.floor(slot));
  const safeTime = Math.max(0, time);
  const period = lerp(0.55, 0.90, hash01(safeSlot, 0, 0));
  const phaseOffset = period * hash01(safeSlot, 0, 1);
  const elapsed = safeTime + phaseOffset;
  const cycle = Math.floor(elapsed / period);
  const cycleTime = elapsed - cycle * period;

  const fallDistance = lerp(50, 90, hash01(safeSlot, cycle, 2));
  const fallSpeed = lerp(700, 1000, hash01(safeSlot, cycle, 3));
  const fallDuration = fallDistance / fallSpeed;
  const splashDuration = lerp(0.12, 0.18, hash01(safeSlot, cycle, 4));
  const slant = lerp(0.02, 0.06, hash01(safeSlot, cycle, 5));
  const inset = 8;
  const impactWidth = Math.max(0, width - inset * 2);
  const impactHeight = Math.max(0, height - inset * 2);
  const impactX = (hash01(safeSlot, cycle, 6) - 0.5) * impactWidth;
  const impactY = (hash01(safeSlot, cycle, 7) - 0.5) * impactHeight;
  const streakLength = lerp(12, 22, hash01(safeSlot, cycle, 8));
  const baseAlpha = Math.round(lerp(118, 176, hash01(safeSlot, cycle, 9)));

  out.impactX = impactX;
  out.impactY = impactY;
  out.headX = impactX;
  out.headY = impactY;
  out.streakLength = streakLength;
  out.slant = slant;
  out.alpha = 0;
  out.fallDistance = fallDistance;
  out.fallSpeed = fallSpeed;
  out.splashRadius = 0;
  out.splashRayLength = 0;
  out.splashRayCount = 2 + Math.floor(hash01(safeSlot, cycle, 10) * 2);
  out.splashRotation = hash01(safeSlot, cycle, 11) * TAU;

  if (cycleTime < fallDuration) {
    const progress = cycleTime / fallDuration;
    const remaining = 1 - progress;
    out.phase = 'fall';
    out.headX = impactX + fallDistance * slant * remaining;
    out.headY = impactY + fallDistance * remaining;
    out.alpha = baseAlpha;
    return;
  }

  if (cycleTime < fallDuration + splashDuration) {
    const progress = (cycleTime - fallDuration) / splashDuration;
    const eased = 1 - (1 - progress) * (1 - progress);
    out.phase = 'splash';
    out.alpha = Math.round(baseAlpha * (1 - progress));
    out.splashRadius = lerp(1.5, 6, eased);
    out.splashRayLength = Math.sin(progress * Math.PI) * lerp(3, 6, hash01(safeSlot, cycle, 12));
    return;
  }

  out.phase = 'idle';
}
