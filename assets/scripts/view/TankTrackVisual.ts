export type TankTrackStyle = 'strong' | 'normal' | 'shallow' | 'faint' | 'none';

export const TANK_TRACK_STYLE_ORDER: readonly Exclude<TankTrackStyle, 'none'>[] = [
  'strong',
  'normal',
  'shallow',
  'faint',
];

/** Existing marks retain 50% of their current alpha at each completed turn. */
export const TANK_TRACK_ALPHA_RETAIN_PER_TURN = 0.50;

export function tankTrackAlphaAfterTurns(baseAlpha: number, fadeSteps: number): number {
  const turns = Math.max(0, Math.floor(fadeSteps));
  return Math.max(0, Math.min(255, Math.round(baseAlpha * Math.pow(TANK_TRACK_ALPHA_RETAIN_PER_TURN, turns))));
}

/** Bridge decks are checked before their water base so they retain a faint hard-surface mark. */
export function tankTrackStyleForTerrain(
  terrain: string | undefined,
  hasBridge: boolean,
): TankTrackStyle {
  if (hasBridge) return 'faint';
  switch (terrain) {
    case 'mud':
      return 'strong';
    case 'field':
    case 'trees':
      return 'normal';
    case 'clear':
      return 'shallow';
    case 'road':
    case 'urban_road':
    case 'airstrip':
      return 'faint';
    case 'urban_ground':
      return 'shallow';
    case 'urban_rubble':
      return 'strong';
    case 'water':
    case 'deep_water':
    case 'beach':
    case 'forest':
    case 'rocky':
    case 'urban_indestructible':
    case 'urban_destructible':
    default:
      return 'none';
  }
}

/** Match the hull renderer: fit the trimmed top view inside a hex-relative square. */
export function renderedTankBodyWidth(
  hexSize: number,
  trimLength: number,
  trimWidth: number,
  fitScale: number,
  aspectRatioMul = 1,
): number {
  const fit = hexSize * 1.8 * fitScale;
  const scale = fit / (Math.max(trimLength, trimWidth) || 1);
  const aspectCorrection = Math.sqrt(Math.max(1e-6, aspectRatioMul));
  return trimWidth * scale / aspectCorrection;
}

/** Match the renderer's longitudinal aspect correction as well as its fit scale. */
export function renderedTankBodyLength(
  hexSize: number,
  trimLength: number,
  trimWidth: number,
  fitScale: number,
  aspectRatioMul = 1,
): number {
  const fit = hexSize * 1.8 * fitScale;
  const scale = fit / (Math.max(trimLength, trimWidth) || 1);
  const aspectCorrection = Math.sqrt(Math.max(1e-6, aspectRatioMul));
  return trimLength * scale * aspectCorrection;
}

/** Put each track centre close to the corresponding outer edge of the rendered hull. */
export function tankTrackHalfGap(bodyWidth: number): number {
  return Math.max(0, bodyWidth * 0.38);
}

/** Quantized widths retain Graphics batching while reading as tracks instead of hairlines. */
export function tankTrackLineWidth(bodyWidth: number): number {
  const calculated = Math.round(bodyWidth * 0.20 * 2) / 2;
  return Math.max(4, Math.min(10, calculated));
}

/** Identify one ground position regardless of traversal direction or tank identity. */
export function tankTrackEdgeKey(
  fromQ: number,
  fromR: number,
  toQ: number,
  toR: number,
): string {
  const from = `${fromQ},${fromR}`;
  const to = `${toQ},${toR}`;
  return from <= to ? `${from}|${to}` : `${to}|${from}`;
}

/** Legacy per-tank traversal identity, retained for callers that need movement history. */
export function tankTrackTraversalKey(
  unitId: string,
  fromQ: number,
  fromR: number,
  toQ: number,
  toR: number,
): string {
  return `${unitId}:${tankTrackEdgeKey(fromQ, fromR, toQ, toR)}`;
}

/** Only opposite axial vectors form one straight run through a shared hex. */
export function tankTrackEdgesContinueStraight(
  vertexQ: number,
  vertexR: number,
  firstOtherQ: number,
  firstOtherR: number,
  secondOtherQ: number,
  secondOtherR: number,
): boolean {
  return firstOtherQ - vertexQ === -(secondOtherQ - vertexQ)
    && firstOtherR - vertexR === -(secondOtherR - vertexR);
}

export interface TankTrackSweptSegment {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface TankTrackPoint {
  x: number;
  y: number;
}

export interface TankTrackRenderedSegment {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  lineWidth: number;
}

/**
 * Return the portions of a new centreline that do not overlap existing crossing strokes.
 * Parallel runs are handled by movement-segment joining; endpoint contacts remain connected.
 */
export function tankTrackVisibleIntervals(
  segment: TankTrackRenderedSegment,
  drawn: readonly TankTrackRenderedSegment[],
): Array<{ from: number; to: number }> {
  const dx = segment.toX - segment.fromX;
  const dy = segment.toY - segment.fromY;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return [];
  const blocked: Array<{ from: number; to: number }> = [];
  for (const prior of drawn) {
    const px = prior.toX - prior.fromX;
    const py = prior.toY - prior.fromY;
    const priorLength = Math.hypot(px, py);
    if (priorLength < 0.001) continue;
    const denominator = dx * py - dy * px;
    if (Math.abs(denominator) < 1e-6) continue;
    const rx = prior.fromX - segment.fromX;
    const ry = prior.fromY - segment.fromY;
    const t = (rx * py - ry * px) / denominator;
    const u = (rx * dy - ry * dx) / denominator;
    // Shared endpoints are intentional joins, not crossings that need clipping.
    if (t <= 1e-4 || t >= 1 - 1e-4 || u <= 1e-4 || u >= 1 - 1e-4) continue;
    const sine = Math.abs(denominator) / (length * priorLength);
    const halfGapDistance = (segment.lineWidth + prior.lineWidth) * 0.5
      / Math.max(0.2, sine);
    const halfGapT = halfGapDistance / length;
    blocked.push({
      from: Math.max(0, t - halfGapT),
      to: Math.min(1, t + halfGapT),
    });
  }
  if (blocked.length === 0) return [{ from: 0, to: 1 }];
  blocked.sort((a, b) => a.from - b.from);
  const visible: Array<{ from: number; to: number }> = [];
  let cursor = 0;
  for (const interval of blocked) {
    if (interval.from > cursor) visible.push({ from: cursor, to: interval.from });
    cursor = Math.max(cursor, interval.to);
  }
  if (cursor < 1) visible.push({ from: cursor, to: 1 });
  return visible.filter(interval => interval.to - interval.from > 1e-4);
}

/** Keep pivot marks under the hull instead of tracing its outer corner radius. */
export const TANK_TRACK_TURN_INSET_SCALE = 0.90;

/** Trace four inset front/rear track points while a tank pivots around its hex centre. */
export function tankTrackTurnArcPoints(
  centerX: number,
  centerY: number,
  halfBodyLength: number,
  halfGap: number,
  fromAngle: number,
  toAngle: number,
  progress: number,
): TankTrackPoint[][] {
  let angleDelta = toAngle - fromAngle;
  while (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
  while (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
  const completedDelta = angleDelta * Math.max(0, Math.min(1, progress));
  const sampleCount = Math.max(1, Math.ceil(Math.abs(completedDelta) / (Math.PI / 36)));
  const insetHalfLength = halfBodyLength * TANK_TRACK_TURN_INSET_SCALE;
  const insetHalfGap = halfGap * TANK_TRACK_TURN_INSET_SCALE;
  const endpoints: readonly [number, number][] = [
    [insetHalfLength, insetHalfGap],
    [insetHalfLength, -insetHalfGap],
    [-insetHalfLength, insetHalfGap],
    [-insetHalfLength, -insetHalfGap],
  ];
  return endpoints.map(([forward, right]) => {
    const points: TankTrackPoint[] = [];
    for (let i = 0; i <= sampleCount; i++) {
      const angle = fromAngle + completedDelta * (i / sampleCount);
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      points.push({
        x: centerX + ux * forward - uy * right,
        y: centerY + uy * forward + ux * right,
      });
    }
    return points;
  });
}

/**
 * Cover the full hull swept along the movement direction.
 * Forward: initial rear to animated front. Reverse: initial front to animated rear.
 */
export function tankTrackProgressSegment(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  halfBodyLength: number,
  progress: number,
  extendFrom = true,
  extendTo = true,
): TankTrackSweptSegment {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return { fromX, fromY, toX, toY };
  const ux = dx / length;
  const uy = dy / length;
  const p = Math.max(0, Math.min(1, progress));
  // When a newer straight segment owns the shared hull footprint, trim the
  // older endpoint to that newer segment's rear edge instead of the hex centre.
  const startDistance = extendFrom ? -halfBodyLength : halfBodyLength;
  const reachedLeadingEdge = length * p + halfBodyLength;
  const endDistance = extendTo
    ? reachedLeadingEdge
    : Math.min(Math.max(0, length - halfBodyLength), reachedLeadingEdge);
  return {
    fromX: fromX + ux * startDistance,
    fromY: fromY + uy * startDistance,
    toX: fromX + ux * endDistance,
    toY: fromY + uy * endDistance,
  };
}

/**
 * Expand a centre-to-centre move by half a hull at both ends.
 * The destination retains a full hull-length footprint after the tank moves or turns.
 */
export function tankTrackSweptSegment(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  halfBodyLength: number,
  extendFrom = true,
  extendTo = true,
): TankTrackSweptSegment {
  return tankTrackProgressSegment(
    fromX,
    fromY,
    toX,
    toY,
    halfBodyLength,
    1,
    extendFrom,
    extendTo,
  );
}
