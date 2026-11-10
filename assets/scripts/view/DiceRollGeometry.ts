/** Presentation-only cube projection. No engine state or gameplay RNG is used. */
export interface DicePoint { x: number; y: number }
/** Keep the same small corner treatment while rolling and at rest. */
export const DICE_CORNER_RATIO = 0.16;
type Vector = [number, number, number];
interface Face {
  pip: number;
  normal: Vector;
  u: Vector;
  v: Vector;
}
export interface ProjectedDiceFace {
  pip: number;
  corners: DicePoint[];
  pips: DicePoint[][];
  shade: number;
  depth: number;
}
export interface RoundedDiceProjection {
  outline: DicePoint[];
  surface: Array<{ corners: DicePoint[]; shade: number; depth: number }>;
  faces: ProjectedDiceFace[];
}

// A single, fixed die: opposite faces always add up to seven.
const FACES: Face[] = [
  { pip: 1, normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { pip: 6, normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  { pip: 3, normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { pip: 4, normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { pip: 2, normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { pip: 5, normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
];
const SPOTS: number[][][] = [
  [], [[0, 0]], [[-1, 1], [1, -1]], [[-1, 1], [0, 0], [1, -1]],
  [[-1, 1], [1, 1], [-1, -1], [1, -1]],
  [[-1, 1], [1, 1], [0, 0], [-1, -1], [1, -1]],
  [[-1, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [1, -1]],
];
const DOT_RING = Array.from({ length: 16 }, (_, i) => {
  const angle = i * Math.PI / 8;
  return [Math.cos(angle) * 0.13, Math.sin(angle) * 0.13];
});
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const shade = (normal: Vector) => Math.max(0.48, Math.min(1.08,
  0.62 + 0.38 * normal[2] + 0.12 * (normal[1] - normal[0])));

/** One closed rounded box, with shared vertices along every face/edge/corner. */
const ROUNDED_MESH = (() => {
  const radius = DICE_CORNER_RATIO * 2, core = 1 - radius;
  const grid = [-1, -core - radius * .7, -core - radius * .3, -core,
    core, core + radius * .3, core + radius * .7, 1];
  const vertices: Vector[] = [];
  const indices = new Map<string, number>();
  const patches: Array<{ corners: number[]; normal: Vector }> = [];
  for (const face of FACES) {
    const rows = grid.map(v => grid.map(u => {
      const cube = face.normal.map((n, i) => n + face.u[i] * u + face.v[i] * v) as Vector;
      const center = cube.map(n => Math.max(-core, Math.min(core, n))) as Vector;
      const delta = cube.map((n, i) => n - center[i]) as Vector;
      const length = Math.hypot(...delta);
      const point = center.map((n, i) => n + delta[i] / length * radius) as Vector;
      const key = point.map(n => n.toFixed(8)).join(',');
      if (!indices.has(key)) { indices.set(key, vertices.length); vertices.push(point); }
      return indices.get(key)!;
    }));
    for (let y = 0; y < grid.length - 1; y++) {
      for (let x = 0; x < grid.length - 1; x++) {
        const corners = [rows[y][x], rows[y][x + 1], rows[y + 1][x + 1], rows[y + 1][x]];
        const middle = corners.reduce((sum, index) => sum.map((n, i) => n + vertices[index][i] / 4) as Vector, [0, 0, 0] as Vector);
        const normal = middle.map(n => n - Math.max(-core, Math.min(core, n))) as Vector;
        const length = Math.hypot(...normal);
        patches.push({ corners, normal: normal.map(n => n / length) as Vector });
      }
    }
  }
  return { vertices, patches };
})();

function convexOutline(points: DicePoint[]): DicePoint[] {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: DicePoint, b: DicePoint, c: DicePoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (list: DicePoint[]) => {
    const result: DicePoint[] = [];
    for (const point of list) {
      while (result.length >= 2 && cross(result[result.length - 2], result[result.length - 1], point) <= 1e-10) result.pop();
      result.push(point);
    }
    return result.slice(0, -1);
  };
  return half(sorted).concat(half(sorted.slice().reverse()));
}

function outlineArea(points: DicePoint[]): number {
  return Math.abs(points.reduce((area, point, i) => {
    const next = points[(i + 1) % points.length];
    return area + point.x * next.y - point.y * next.x;
  }, 0)) / 2;
}
const RESTING_OUTLINE_AREA = outlineArea(convexOutline(ROUNDED_MESH.vertices.map(([x, y]) => ({ x, y }))));

/**
 * Roll freely around multiple axes, then ease into the requested front face.
 * Apparent size is normalized by projected area below; tray layouts leave room
 * for the wider silhouettes and gather the dice only after they stop rolling.
 */
function diceProjection(finalPip: number, progress: number, size: number, variant: number) {
  const pip = Math.max(1, Math.min(6, Math.floor(finalPip) || 1));
  const target = FACES.find(face => face.pip === pip)!;
  const p = Math.max(0, Math.min(1, progress));
  const seed = Math.abs(Math.floor(variant));
  const remaining = Math.pow(1 - p, 3);
  const direction = seed % 2 ? -1 : 1;
  const ax = direction * (Math.PI * 2 * (1.1 + seed % 3 * .17) + .45) * remaining;
  const ay = (Math.PI * 2 * (.8 + seed % 4 * .11) + .7) * remaining;
  const az = direction * (.5 + seed % 5 * .13) * remaining;
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const cy = Math.cos(ay), sy = Math.sin(ay);
  const cz = Math.cos(az), sz = Math.sin(az);
  const rotate = (point: Vector): Vector => {
    const x = dot(point, target.u), y = dot(point, target.v), z = dot(point, target.normal);
    const y1 = y * cx - z * sx, z1 = y * sx + z * cx;
    const x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
    return [x2 * cz - y1 * sz, x2 * sz + y1 * cz, z2];
  };
  return { rotate, scale: Math.max(0, size) / 2 };
}

function projectFaces({ rotate, scale }: ReturnType<typeof diceProjection>): ProjectedDiceFace[] {
  const result: ProjectedDiceFace[] = [];
  for (const face of FACES) {
    const normal = rotate(face.normal);
    if (normal[2] <= 0.00001) continue;
    const axisU = rotate(face.u), axisV = rotate(face.v);
    const project = (u: number, v: number): DicePoint => ({
      x: (normal[0] + axisU[0] * u + axisV[0] * v) * scale,
      y: (normal[1] + axisU[1] * u + axisV[1] * v) * scale,
    });
    result.push({
      pip: face.pip,
      corners: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => project(u, v)),
      pips: SPOTS[face.pip].map(([u, v]) => DOT_RING.map(([dx, dy]) => project(u * 0.48 + dx, v * 0.48 + dy))),
      shade: shade(normal),
      depth: normal[2],
    });
  }
  return result.sort((a, b) => a.depth - b.depth);
}

/** Project the rounded box surface, silhouette and face-attached dots together. */
export function projectRoundedDie(finalPip: number, progress: number, size: number, variant = 0): RoundedDiceProjection {
  const projection = diceProjection(finalPip, progress, size, variant);
  const { rotate, scale } = projection;
  const points = ROUNDED_MESH.vertices.map(point => {
    const rotated = rotate(point);
    return { x: rotated[0] * scale, y: rotated[1] * scale, z: rotated[2] };
  });
  const outline = convexOutline(points);
  const area = outlineArea(outline);
  // Match the resting silhouette's area instead of shrinking every orientation
  // into a square. Apply one uniform factor to the body and dots, preserving 3D
  // proportions and the fixed center. Outline points share the mesh vertices.
  const compensation = area > 0 ? Math.sqrt(RESTING_OUTLINE_AREA * scale * scale / area) : 1;
  for (const point of points) { point.x *= compensation; point.y *= compensation; }
  projection.scale *= compensation;
  const surface: RoundedDiceProjection['surface'] = [];
  for (const patch of ROUNDED_MESH.patches) {
    const normal = rotate(patch.normal);
    if (normal[2] <= .00001) continue;
    const corners = patch.corners.map(index => points[index]);
    surface.push({ corners, shade: shade(normal), depth: corners.reduce((sum, point) => sum + point.z / 4, 0) });
  }
  return {
    outline,
    surface: surface.sort((a, b) => a.depth - b.depth),
    faces: projectFaces(projection),
  };
}

const RESTING_BODIES = new Map<number, RoundedDiceProjection>();
export function restingRoundedDie(size: number): RoundedDiceProjection {
  if (!RESTING_BODIES.has(size)) RESTING_BODIES.set(size, projectRoundedDie(1, 1, size));
  return RESTING_BODIES.get(size)!;
}
