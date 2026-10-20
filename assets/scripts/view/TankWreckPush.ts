/** Visual collision geometry in hex-radius units, independent of camera/board size. */
export interface WreckPoint { x: number; y: number }
export interface WreckBody extends WreckPoint {
  id: string;
  angle: number;
  halfLength: number;
  halfWidth: number;
}
export type WreckPolygon = readonly WreckPoint[];

export const WRECK_PUSH_STEP = 0.025;
export const WRECK_PUSH_SPEED_SCALE = 0.3;
const MAX_CHAIN = 4;
const EPS = 1e-7;

/** Nearest visual hex; the unit's rules position remains unchanged. */
export function wreckVisualHex(pos: { q: number; r: number }, pose: WreckPoint): { q: number; r: number } {
  const qf = pos.q + pose.x / Math.sqrt(3) + pose.y / 3;
  const rf = pos.r - pose.y * 2 / 3;
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

export function wreckBodyPolygon(body: WreckBody): WreckPoint[] {
  const ux = Math.cos(body.angle), uy = Math.sin(body.angle);
  return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([f, r]) => ({
    x: body.x + f * body.halfLength * ux - r * body.halfWidth * uy,
    y: body.y + f * body.halfLength * uy + r * body.halfWidth * ux,
  }));
}

/** Minimum translation that separates convex polygon A from B (SAT). */
export function wreckPolygonContact(a: WreckPolygon, b: WreckPolygon): WreckPoint | null {
  if (Math.max(...a.map(p => p.x)) <= Math.min(...b.map(p => p.x)) + EPS
    || Math.max(...b.map(p => p.x)) <= Math.min(...a.map(p => p.x)) + EPS
    || Math.max(...a.map(p => p.y)) <= Math.min(...b.map(p => p.y)) + EPS
    || Math.max(...b.map(p => p.y)) <= Math.min(...a.map(p => p.y)) + EPS) return null;
  let depth = Infinity;
  let result: WreckPoint | null = null;
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    if (length < EPS) continue;
    const nx = -(q.y - p.y) / length, ny = (q.x - p.x) / length;
    const ap = a.map(v => v.x * nx + v.y * ny);
    const bp = b.map(v => v.x * nx + v.y * ny);
    const positive = Math.max(...bp) - Math.min(...ap);
    const negative = Math.max(...ap) - Math.min(...bp);
    if (positive <= EPS || negative <= EPS) return null;
    const d = Math.min(positive, negative);
    if (d < depth) {
      depth = d;
      const sign = positive < negative ? 1 : -1;
      result = { x: nx * d * sign, y: ny * d * sign };
    }
  }
  return result;
}

function penetration(a: WreckPolygon, b: WreckPolygon): number {
  const contact = wreckPolygonContact(a, b);
  return contact ? Math.hypot(contact.x, contact.y) : 0;
}

/** A jam still creates resistance; reversing away from contact does not. */
export function tankWreckPushContact(wreck: WreckBody, mover: WreckBody, travel: WreckPoint): WreckPoint | null {
  const contact = wreckPolygonContact(wreckBodyPolygon(wreck), wreckBodyPolygon(mover));
  if (!contact || contact.x * travel.x + contact.y * travel.y < -EPS) return null;
  return contact;
}

/**
 * Only wrecks are mutable. Live tanks stay fixed; intact/damaged city buildings
 * are hard obstacles. No board bounds or other terrain enter this solver.
 * A bounded chain and soft tank/wreck contacts let a jam overlap without
 * interrupting the grid movement that has already been accepted by the rules.
 */
export function pushTankWrecks(
  wrecks: WreckBody[], mover: WreckBody, travel: WreckPoint,
  liveTanks: readonly WreckBody[], buildings: readonly WreckPolygon[],
): void {
  const speed = Math.hypot(travel.x, travel.y);
  if (speed < EPS) return;
  const fixed = liveTanks.map(wreckBodyPolygon);
  const visited = new Set<string>();

  const push = (wreck: WreckBody, source: WreckBody, direction: WreckPoint, depth: number) => {
    if (visited.has(wreck.id) || depth > MAX_CHAIN) return;
    const original = { ...wreck };
    const shape = wreckBodyPolygon(wreck);
    const sourceShape = wreckBodyPolygon(source);
    const contact = tankWreckPushContact(wreck, source, direction);
    if (!contact) return;
    visited.add(wreck.id);
    const distance = Math.min(Math.hypot(contact.x, contact.y) + 0.001, speed * 2);
    const contactLength = Math.hypot(contact.x, contact.y);
    const desired = { x: contact.x / contactLength * distance, y: contact.y / contactLength * distance };
    const forward = { x: direction.x / Math.hypot(direction.x, direction.y), y: direction.y / Math.hypot(direction.x, direction.y) };
    // Stable side preference breaks perfectly centered contacts without frame noise.
    const side = [...wreck.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 2 ? 1 : -1;
    const tangent = { x: -forward.y * side, y: forward.x * side };
    const candidates: WreckPoint[] = [desired];
    for (const sign of [1, -1]) {
      candidates.push({ x: tangent.x * distance * sign, y: tangent.y * distance * sign });
      candidates.push({
        x: (forward.x * 0.5 + tangent.x * sign * 0.866) * distance,
        y: (forward.y * 0.5 + tangent.y * sign * 0.866) * distance,
      });
    }
    // Follow the actual surface tangent of an angled hull or city wall.
    const proposed = wreckBodyPolygon({ ...wreck, x: wreck.x + desired.x, y: wreck.y + desired.y });
    for (const obstacle of [...fixed, ...buildings]) {
      const hit = wreckPolygonContact(proposed, obstacle);
      if (!hit) continue;
      const n = Math.hypot(hit.x, hit.y);
      for (const sign of [side, -side]) candidates.push({ x: -hit.y / n * distance * sign, y: hit.x / n * distance * sign });
    }
    const initialBuildingDepths = buildings.map(building => penetration(shape, building));
    const legal = (body: WreckBody) => {
      const polygon = wreckBodyPolygon(body);
      // Existing asset overhangs may escape a building, but never move deeper.
      return buildings.every((building, i) => penetration(polygon, building) <= initialBuildingDepths[i] + EPS);
    };
    const score = (body: WreckBody) => {
      const polygon = wreckBodyPolygon(body);
      let cost = penetration(polygon, sourceShape) ** 2 * 16;
      for (const obstacle of fixed) cost += penetration(polygon, obstacle) ** 2 * 100;
      for (const other of wrecks) if (other !== wreck) cost += penetration(polygon, wreckBodyPolygon(other)) ** 2 * 0.5;
      return cost;
    };
    let best = original;
    let bestScore = score(original);
    for (const delta of candidates) {
      const candidate = { ...original, x: original.x + delta.x, y: original.y + delta.y };
      if (!legal(candidate) || !legal({ ...original, x: original.x + delta.x * 0.5, y: original.y + delta.y * 0.5 })) continue;
      // Tiny motion preference permits sustained side-sliding along a blocked
      // face, even before a corner has cleared the contacting tank.
      const cost = score(candidate) - distance * 0.002
        + ((delta.x - desired.x) ** 2 + (delta.y - desired.y) ** 2) * 0.01;
      if (cost < bestScore - EPS) { best = candidate; bestScore = cost; }
    }
    wreck.x = best.x;
    wreck.y = best.y;
    const dx = wreck.x - original.x, dy = wreck.y - original.y;
    if (Math.hypot(dx, dy) < EPS) return;
    const torque = ((original.x - source.x) * dy - (original.y - source.y) * dx)
      / Math.max(0.1, wreck.halfLength ** 2 + wreck.halfWidth ** 2);
    const rotated = { ...wreck, angle: wreck.angle + Math.max(-0.012, Math.min(0.012, torque * 0.12)) };
    if (legal(rotated) && score(rotated) <= score(wreck) + 0.0001) wreck.angle = rotated.angle;
    for (const other of wrecks) if (other !== wreck) push(other, wreck, { x: dx, y: dy }, depth + 1);
  };
  for (const wreck of wrecks) push(wreck, mover, travel, 0);
}
