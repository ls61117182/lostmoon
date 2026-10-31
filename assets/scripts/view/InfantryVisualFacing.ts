import type { Axial, Direction } from '../core/types';
import { approximateDirection, axialToPixel, directionTo, HEX_DIRECTIONS } from '../core/HexGrid';
import type { WreckBody } from './TankWreckPush';

type SquadOffset = { ox: number; oy: number };

export interface InfantryFootprint {
  halfWidth: number;
  halfHeight: number;
  /** Radians; null means each soldier faces the shared hex centre. */
  angle: number | null;
}

/** Map-local bridge deck, in hex-radius units; excludes the water beside it. */
export interface InfantryStandingArea {
  angle: number;
  halfLength: number;
  halfWidth: number;
}

export function infantryBridgeStandingArea(ends: readonly Direction[]): InfantryStandingArea {
  const axis = axialToPixel(HEX_DIRECTIONS[ends[0]], 1);
  // The ground raster paints the deck at 0.205 hex radii on each side.
  // This is also safely inside the wider legacy/vector bridge deck.
  return { angle: Math.atan2(-axis.y, axis.x), halfLength: Math.sqrt(3) / 2, halfWidth: 0.205 };
}

interface FormationShape {
  x: number; y: number; ux: number; uy: number;
  halfLength: number; halfWidth: number; radius?: number;
}

function shapeExtent(shape: FormationShape, nx: number, ny: number): number {
  return shape.radius ?? (Math.abs(nx * shape.ux + ny * shape.uy) * shape.halfLength
    + Math.abs(-nx * shape.uy + ny * shape.ux) * shape.halfWidth);
}

function shapeCorners(shape: FormationShape): Array<{ x: number; y: number }> {
  return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([f, s]) => ({
    x: shape.x + f * shape.halfLength * shape.ux - s * shape.halfWidth * shape.uy,
    y: shape.y + f * shape.halfLength * shape.uy + s * shape.halfWidth * shape.ux,
  }));
}

/** Signed rectangle separation; positive hull gaps use the actual nearest edges. */
function shapeDistance(a: FormationShape, b: FormationShape, exactGap = false): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  if (a.radius !== undefined && b.radius !== undefined) return Math.hypot(dx, dy) - a.radius - b.radius;
  if (a.radius !== undefined || b.radius !== undefined) {
    const circle = a.radius !== undefined ? a : b, box = circle === a ? b : a;
    const x = circle.x - box.x, y = circle.y - box.y;
    const f = Math.abs(x * box.ux + y * box.uy) - box.halfLength;
    const s = Math.abs(-x * box.uy + y * box.ux) - box.halfWidth;
    return Math.hypot(Math.max(0, f), Math.max(0, s)) + Math.min(0, Math.max(f, s)) - circle.radius!;
  }
  let separation = -Infinity;
  for (const [nx, ny] of [[a.ux, a.uy], [-a.uy, a.ux], [b.ux, b.uy], [-b.uy, b.ux]]) {
    separation = Math.max(separation, Math.abs(dx * nx + dy * ny) - shapeExtent(a, nx, ny) - shapeExtent(b, nx, ny));
  }
  if (separation <= 0 || !exactGap) return separation;
  const ac = shapeCorners(a), bc = shapeCorners(b);
  let distanceSq = Infinity;
  for (const [points, edges] of [[ac, bc], [bc, ac]]) for (const p of points) {
    for (let i = 0; i < 4; i++) {
      const from = edges[i], to = edges[(i + 1) % 4];
      const ex = to.x - from.x, ey = to.y - from.y;
      const t = Math.max(0, Math.min(1, ((p.x - from.x) * ex + (p.y - from.y) * ey) / (ex * ex + ey * ey || 1)));
      distanceSq = Math.min(distanceSq, (p.x - from.x - t * ex) ** 2 + (p.y - from.y - t * ey) ** 2);
    }
  }
  return Math.sqrt(distanceSq);
}

/** Hulls and soldier radii are relative to the squad centre, in hex-radius units. */
export function infantryOffsetsAvoidingHulls(
  hexSize: number,
  offsets: readonly SquadOffset[],
  hulls: readonly WreckBody[],
  soldierRadii: readonly number[],
  footprints?: readonly InfantryFootprint[],
  standingArea?: InfantryStandingArea,
): SquadOffset[] {
  if (hulls.length === 0 && !standingArea) return offsets.map(p => ({ ...p }));
  const bodies = hulls.map(body => ({ ...body, ux: Math.cos(body.angle), uy: Math.sin(body.angle) }));
  const area = standingArea && { ...standingArea, ux: Math.cos(standingArea.angle), uy: Math.sin(standingArea.angle) };
  const gap = 1.5 / hexSize;
  type Candidate = FormationShape & { cost: number };
  const choices = offsets.map((offset, index) => {
    const radius = soldierRadii[index] ?? 0.22;
    const origin = { x: offset.ox / hexSize, y: offset.oy / hexSize };
    const footprint = footprints?.[index];
    const shapeAt = (x: number, y: number): FormationShape => {
      const angle = footprint?.angle ?? (Math.atan2(-y, -x) + Math.PI / 2);
      return { x, y, ux: Math.cos(angle), uy: Math.sin(angle),
        halfLength: footprint?.halfWidth ?? 0, halfWidth: footprint?.halfHeight ?? 0,
        radius: footprint ? undefined : radius };
    };
    const insideHex = (shape: FormationShape): boolean => {
      if (![[1, 0], [0.5, Math.sqrt(3) / 2], [-0.5, Math.sqrt(3) / 2]]
        .every(([nx, ny]) => Math.abs(shape.x * nx + shape.y * ny) + shapeExtent(shape, nx, ny) <= Math.sqrt(3) / 2 + 1e-8)) return false;
      if (!area) return true;
      const forward = shape.x * area.ux + shape.y * area.uy;
      const side = -shape.x * area.uy + shape.y * area.ux;
      // Keep the whole sprite on the deck where it fits. A very wide sprite
      // stays on the centreline rather than pushing the soldier into water.
      return Math.abs(forward) <= Math.max(0, area.halfLength - shapeExtent(shape, area.ux, area.uy)) + 1e-8
        && Math.abs(side) <= Math.max(0, area.halfWidth - shapeExtent(shape, -area.uy, area.ux)) + 1e-8;
    };
    const score = (shape: FormationShape): number => {
      let overlap = 0, nearest = Infinity;
      for (const body of bodies) {
        const distance = shapeDistance(shape, body, true);
        overlap += Math.max(0, gap - distance) ** 2;
        nearest = Math.min(nearest, distance);
      }
      // Keep the actual sprite edge about 1–2 px from the hull, rather than
      // preserving a distant triangle or a large circumscribed-circle margin.
      return overlap * (area ? 100 : 10000) + (bodies.length ? Math.max(0, nearest - gap) ** 2 * 1000 : 0)
        + ((shape.x - origin.x) ** 2 + (shape.y - origin.y) ** 2) * 0.1;
    };
    const candidates: Candidate[] = [], seen = new Set<string>();
    const add = (x: number, y: number) => {
      const shape = shapeAt(x, y), key = `${x.toFixed(6)},${y.toFixed(6)}`;
      if (!insideHex(shape) || seen.has(key)) return;
      seen.add(key);
      candidates.push({ ...shape, cost: score(shape) });
    };
    add(origin.x, origin.y);
    if (area) {
      const projectToDeck = (x: number, y: number) => {
        for (let iteration = 0; iteration < 6; iteration++) {
          const shape = shapeAt(x, y);
          const forwardLimit = Math.max(0, area.halfLength - shapeExtent(shape, area.ux, area.uy));
          const sideLimit = Math.max(0, area.halfWidth - shapeExtent(shape, -area.uy, area.ux));
          const forward = Math.max(-forwardLimit, Math.min(forwardLimit, x * area.ux + y * area.uy));
          const side = Math.max(-sideLimit, Math.min(sideLimit, -x * area.uy + y * area.ux));
          x = forward * area.ux - side * area.uy;
          y = forward * area.uy + side * area.ux;
        }
        add(x, y);
      };
      projectToDeck(origin.x, origin.y);
      // Sample the narrow deck itself, including its centre beneath the tank.
      // Hull overlap remains allowed; leaving the deck is never a candidate.
      for (let f = -8; f <= 8; f++) for (let s = -2; s <= 2; s++) {
        const forward = area.halfLength * f / 8, side = area.halfWidth * s / 2;
        projectToDeck(forward * area.ux - side * area.uy, forward * area.uy + side * area.ux);
      }
    }
    // Search a bounded, deterministic set. Even oversized/multiple tanks cannot
    // push a soldier out of its own hex; choose the least overlap if it is full.
    for (let step = 0; step < 72; step++) {
      const angle = step * Math.PI / 36;
      const x = Math.cos(angle), y = Math.sin(angle);
      const shape = shapeAt(x, y);
      let limit = Infinity;
      for (const [nx, ny] of [[1, 0], [0.5, Math.sqrt(3) / 2], [-0.5, Math.sqrt(3) / 2]]) {
        limit = Math.min(limit, (Math.sqrt(3) / 2 - shapeExtent(shape, nx, ny)) / Math.max(1e-8, Math.abs(x * nx + y * ny)));
      }
      for (const ring of [0.46, 0.58, limit]) {
        const r = Math.min(ring, limit);
        add(x * r, y * r);
      }
      // Add precise hull-contact candidates, so proximity is not limited by
      // five-degree ring samples. Iterate for soldiers that face inward.
      for (const body of bodies) {
        let distance = Math.hypot(body.halfLength, body.halfWidth) + radius;
        for (let iteration = 0; iteration < 4; iteration++) {
          const soldier = shapeAt(body.x + x * distance, body.y + y * distance);
          const forward = Math.abs(x * body.ux + y * body.uy), side = Math.abs(-x * body.uy + y * body.ux);
          distance = Math.min((body.halfLength + shapeExtent(soldier, body.ux, body.uy) + gap) / Math.max(1e-8, forward),
            (body.halfWidth + shapeExtent(soldier, -body.uy, body.ux) + gap) / Math.max(1e-8, side));
        }
        add(body.x + x * distance, body.y + y * distance);
      }
    }
    return candidates.sort((a, b) => a.cost - b.cost).slice(0, 48);
  });
  // Search all three together: a greedy first placement can block the only
  // safe space for the larger third sprite. Sorted costs bound this search.
  let bestCost = Infinity, best: Candidate[] = [];
  const placed: Candidate[] = [];
  const search = (index: number, cost: number) => {
    if (index === choices.length) { bestCost = cost; best = placed.slice(); return; }
    for (const candidate of choices[index]) {
      let nextCost = cost + candidate.cost;
      if (nextCost >= bestCost) break;
      for (const other of placed) {
        nextCost += 10000 * Math.max(0, 0.8 / hexSize - shapeDistance(candidate, other)) ** 2;
      }
      if (nextCost >= bestCost) continue;
      placed.push(candidate);
      search(index + 1, nextCost);
      placed.pop();
    }
  };
  search(0, 0);
  return best.map(p => ({ ox: p.x * hexSize, oy: p.y * hexSize }));
}

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

/** Returns the wide formation when a squad shares its hex with a live unit or tank wreck. */
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
