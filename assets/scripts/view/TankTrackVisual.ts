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
    case 'airstrip':
      return 'faint';
    case 'water':
    case 'deep_water':
    case 'beach':
    case 'forest':
    case 'rocky':
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

/** Only opposite axial vectors form a straight continuation through a shared hex centre. */
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

/** Return the hull-swept portion reached at a normalized movement progress. */
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
  const startDistance = extendFrom ? -halfBodyLength : 0;
  const reachedLeadingEdge = length * p + halfBodyLength;
  const endDistance = extendTo
    ? reachedLeadingEdge
    : Math.min(length, reachedLeadingEdge);
  return {
    fromX: fromX + ux * startDistance,
    fromY: fromY + uy * startDistance,
    toX: fromX + ux * endDistance,
    toY: fromY + uy * endDistance,
  };
}

/**
 * Expand a centre-to-centre move to the full ground area swept by the hull.
 * The start is the initial trailing edge and the end is the final leading edge.
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
