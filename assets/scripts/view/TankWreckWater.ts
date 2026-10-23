import type { WreckWaterState } from '../core/types';
import type { WreckBody, WreckPoint } from './TankWreckPush';

export const WRECK_SINK_THRESHOLD = 1 / 3;
export const WRECK_SINK_DURATION = 1;
export const WRECK_RIPPLE_DURATION = 2.2;

export interface WreckWaterSample {
  fraction: number;
  contact: WreckPoint;
  waterCenter: WreckPoint;
  cells: WreckPoint[];
}

/** Equal-area 6x3 samples of the actual rotated hull, excluding bridge tiles. */
export function sampleWreckWater(
  body: WreckBody, waterAt: (point: WreckPoint) => WreckPoint | null,
): WreckWaterSample {
  const ux = Math.cos(body.angle), uy = Math.sin(body.angle);
  let count = 0, x = 0, y = 0, centerX = 0, centerY = 0;
  const cells = new Map<string, WreckPoint>();
  for (let col = 0; col < 6; col++) for (let row = 0; row < 3; row++) {
    const forward = ((col + 0.5) / 6 * 2 - 1) * body.halfLength;
    const right = ((row + 0.5) / 3 * 2 - 1) * body.halfWidth;
    const point = { x: body.x + forward * ux - right * uy, y: body.y + forward * uy + right * ux };
    const water = waterAt(point);
    if (!water) continue;
    count++;
    x += point.x; y += point.y;
    centerX += water.x; centerY += water.y;
    cells.set(`${water.x},${water.y}`, water);
  }
  return {
    fraction: count / 18,
    contact: count ? { x: x / count, y: y / count } : { x: body.x, y: body.y },
    waterCenter: count ? { x: centerX / count, y: centerY / count } : { x: body.x, y: body.y },
    cells: [...cells.values()],
  };
}

export function startWreckWater(
  body: WreckBody, pose: WreckPoint & { angle: number }, origin: WreckPoint, sample: WreckWaterSample,
): WreckWaterState | undefined {
  if (sample.fraction <= 0) return undefined;
  const state: WreckWaterState = {
    fraction: sample.fraction,
    contactX: sample.contact.x - origin.x,
    contactY: sample.contact.y - origin.y,
  };
  if (sample.fraction >= WRECK_SINK_THRESHOLD) {
    const dx = sample.waterCenter.x - body.x, dy = sample.waterCenter.y - body.y;
    const distance = Math.hypot(dx, dy);
    const slide = Math.min(0.65, distance);
    const side = [...body.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 2 ? 1 : -1;
    state.sink = {
      elapsed: 0,
      rippleElapsed: 0,
      startX: pose.x, startY: pose.y, startAngle: pose.angle,
      slideX: distance > 1e-6 ? dx / distance * slide : 0,
      slideY: distance > 1e-6 ? dy / distance * slide : 0,
      turn: side * 0.14,
    };
  }
  return state;
}

/** Absolute interpolation avoids drift and preserves progress across save/load. */
export function advanceWreckSinking(state: WreckWaterState, dt: number): (WreckPoint & { angle: number }) | null {
  const sink = state.sink;
  if (!sink) return null;
  sink.rippleElapsed = Math.min(WRECK_RIPPLE_DURATION,
    (sink.rippleElapsed ?? sink.elapsed) + Math.max(0, dt));
  // Continue the water clock without forcing another full scene redraw once
  // the hull has disappeared. The effects Graphics animate independently.
  if (sink.elapsed >= WRECK_SINK_DURATION) return null;
  sink.elapsed = Math.min(WRECK_SINK_DURATION, sink.elapsed + Math.max(0, dt));
  const t = sink.elapsed / WRECK_SINK_DURATION;
  const k = t * t * (3 - 2 * t);
  return { x: sink.startX + sink.slideX * k, y: sink.startY + sink.slideY * k, angle: sink.startAngle + sink.turn * k };
}

export interface WreckWaterRippleRing {
  radius: number;
  alpha: number;
  width: number;
}

/** Two widely spaced pulses on sinking; one slow pulse while grounded. */
export function wreckWaterRippleRings(state: WreckWaterState, time: number, hexSize: number): WreckWaterRippleRing[] {
  const sink = state.sink;
  const age = sink ? (sink.rippleElapsed ?? sink.elapsed) : 0;
  if (sink && age >= WRECK_RIPPLE_DURATION) return [];
  const rings: WreckWaterRippleRing[] = [];
  for (let ring = 0; ring < (sink ? 2 : 1); ring++) {
    const delay = ring * 0.55;
    if (sink && age < delay) continue;
    const phase = sink ? Math.min(1, (age - delay) / (WRECK_RIPPLE_DURATION - 0.55))
      : ((time % 2.6) + 2.6) % 2.6 / 2.6;
    if (phase >= 1) continue;
    const fade = Math.pow(1 - phase, 0.65);
    rings.push({
      radius: hexSize * (0.16 + phase * 0.60),
      alpha: Math.round((sink ? 210 : 120) * fade),
      width: Math.max(1.25, hexSize * 0.018),
    });
  }
  return rings;
}

export function wreckWaterAppearance(state: WreckWaterState | undefined): { scale: number; alpha: number; shade: number } {
  const t = Math.min(1, (state?.sink?.elapsed ?? 0) / WRECK_SINK_DURATION);
  return { scale: 1 - 0.35 * t, alpha: 1 - t, shade: Math.round(255 - 145 * t) };
}
