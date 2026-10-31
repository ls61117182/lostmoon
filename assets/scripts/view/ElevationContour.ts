import { elevationEdges, elevationSurfaceTint, slopeDepth, tileHeight, type ElevationEdge } from '../core/Elevation';
import type { Tile } from '../core/types';
import { decodeBase64 } from './TerrainGroundRaster';

/** Canonical map coordinates, Y down. Rounded contours keep ground, normals and material continuous. */
export const ELEVATION_RADIUS = 48;
export const ELEVATION_CHUNK = 256;
interface Point { x: number; y: number; }
export interface ContourSegment {
  a: Point; b: Point; na: Point; nb: Point;
  rockA: number; rockB: number; depthA: number; depthB: number;
  high: number; low: number;
}
export interface RubbleArtwork { size: number; rgba: string; normals: string; }
export interface ElevationMaterialData { version: number; rock: { width: number; height: number; rgb: string }; stones?: RubbleArtwork[]; }
export interface ElevationChunk { x: number; y: number; size: number; pixels: Uint8Array; }
const SQ = Math.sqrt(3), R = ELEVATION_RADIUS;
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function smooth(a: number, b: number, x: number): number { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); }
const point = (a: Point, b: Point, t: number): Point => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) });
function normal(t: Point): Point { const d = Math.hypot(t.x, t.y) || 1; return { x: t.y / d, y: -t.x / d }; }
const vertexKey = (p: Point) => `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)}`;

/** Each ordinary two-edge corner is one quadratic curve, with a shared tangent at both ends.
 * Three-height junctions keep their physical endpoint rather than rounding unrelated terraces together. */
export function elevationContour(tiles: readonly Tile[]): ContourSegment[] {
  const edges = elevationEdges([...tiles].sort((a, b) => a.pos.r - b.pos.r || a.pos.q - b.pos.q));
  const lines = edges.map(edge => {
    const theta = edge.direction * Math.PI / 3, n = { x: Math.cos(theta), y: Math.sin(theta) };
    const t = { x: -n.y, y: n.x };
    const c = { x: SQ * (edge.high.pos.q + edge.high.pos.r / 2) + n.x * SQ / 2,
      y: edge.high.pos.r * 1.5 + n.y * SQ / 2 };
    return { edge, n, a: { x: c.x - .5 * t.x, y: c.y - .5 * t.y }, b: { x: c.x + .5 * t.x, y: c.y + .5 * t.y } };
  });
  const at = new Map<string, number[]>();
  lines.forEach((line, i) => { for (const p of [line.a, line.b]) { const key = vertexKey(p); const list = at.get(key) ?? []; list.push(i); at.set(key, list); } });
  const compatible = (a: ElevationEdge, b: ElevationEdge) => tileHeight(a.high) === tileHeight(b.high) && tileHeight(a.low) === tileHeight(b.low);
  const next = lines.map((line, i) => {
    const list = at.get(vertexKey(line.b))!;
    if (list.length !== 2) return -1;
    const j = list.find(j => j !== i)!;
    return vertexKey(lines[j].a) === vertexKey(line.b) && compatible(line.edge, lines[j].edge) ? j : -1;
  });
  const previous = lines.map(() => -1); next.forEach((j, i) => { if (j >= 0) previous[j] = i; });
  const result: ContourSegment[] = [], trim = .27;
  lines.forEach((line, i) => {
    const edge = line.edge, a = point(line.a, line.b, previous[i] >= 0 ? trim : 0), b = point(line.a, line.b, next[i] >= 0 ? 1 - trim : 1);
    const rock = edge.blocked ? 1 : 0, depth = slopeDepth(edge.difference);
    const common = { high: tileHeight(edge.high), low: tileHeight(edge.low) };
    result.push({ a, b, na: line.n, nb: line.n, rockA: rock, rockB: rock, depthA: depth, depthB: depth, ...common });
    const j = next[i]; if (j < 0) return;
    const other = lines[j], c = point(other.a, other.b, trim), rockB = other.edge.blocked ? 1 : 0, depthB = slopeDepth(other.edge.difference);
    // Subdivide only the small corner; straight parts remain exact line segments.
    for (let k = 0; k < 12; k++) {
      const sample = (u: number) => {
        const p = point(point(b, line.b, u), point(line.b, c, u), u);
        const tangent = { x: (line.b.x - b.x) * (1 - u) + (c.x - line.b.x) * u,
          y: (line.b.y - b.y) * (1 - u) + (c.y - line.b.y) * u };
        return { p, n: normal(tangent) };
      };
      const u = k / 12, v = (k + 1) / 12, sa = sample(u), sb = sample(v);
      result.push({ a: sa.p, b: sb.p, na: sa.n, nb: sb.n,
        rockA: mix(rock, rockB, smooth(0, 1, u)), rockB: mix(rock, rockB, smooth(0, 1, v)),
        depthA: mix(depth, depthB, u), depthB: mix(depth, depthB, v), ...common });
    }
  });
  return result;
}

export function elevationFingerprint(tiles: readonly Tile[], camera: number): string {
  return `${camera === 90 ? 90 : 0}|` + tiles.map(t => `${t.pos.q},${t.pos.r}:${tileHeight(t)}:${t.cliffs?.map(Number).join('') ?? ''}`).sort().join('|');
}
function axialAt(x: number, y: number): string {
  const r = y / 1.5, q = x / SQ - r / 2;
  let a = Math.round(q), b = Math.round(r), c = Math.round(-q - r);
  const da = Math.abs(a - q), db = Math.abs(b - r), dc = Math.abs(c + q + r);
  if (da > db && da > dc) a = -b - c; else if (db > dc) b = -a - c;
  return `${a},${b}`;
}
function noise(x: number, y: number): number {
  return Math.sin(x * .115 + y * .072) * .55 + Math.sin(x * .211 - y * .137) * .25 + Math.sin(x * .47 + y * .31) * .20;
}
/** Stable world-space scatter, independent of camera, map enumeration and chunk borders. */
function random(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
interface StonePixels { size: number; rgba: Uint8Array; normals: Uint8Array; }

/** One immutable overlay per chunk. Each pixel samples a single continuous contour field;
 * there are no separate edge rectangles or alpha-composited joints. Zoom/pan reuse the output. */
export class ElevationContourRaster {
  private rock: Uint8Array;
  private stones: StonePixels[];
  constructor(private material: ElevationMaterialData) {
    this.rock = decodeBase64(material.rock.rgb);
    this.stones = (material.stones ?? []).map(s => ({ size: s.size, rgba: decodeBase64(s.rgba), normals: decodeBase64(s.normals) }));
  }
  plans(tiles: readonly Tile[]): Array<{ x: number; y: number }> {
    const keys = new Set<string>(), add = (x: number, y: number) => keys.add(`${x},${y}`);
    for (const tile of tiles) {
      if (tileHeight(tile) === 0) continue;
      const x = SQ * R * (tile.pos.q + tile.pos.r / 2), y = R * 1.5 * tile.pos.r;
      // Includes the lower half of the widest allowed slope plus a one-pixel gutter.
      for (let row = Math.floor((y - 1.7 * R) / ELEVATION_CHUNK); row <= Math.floor((y + 1.7 * R) / ELEVATION_CHUNK); row++)
        for (let col = Math.floor((x - 1.7 * R) / ELEVATION_CHUNK); col <= Math.floor((x + 1.7 * R) / ELEVATION_CHUNK); col++) add(col * ELEVATION_CHUNK, row * ELEVATION_CHUNK);
    }
    return [...keys].sort().map(key => { const [x, y] = key.split(',').map(Number); return { x, y }; });
  }
  render(tiles: readonly Tile[], segments: readonly ContourSegment[], x: number, y: number, size = ELEVATION_CHUNK, camera = 0): ElevationChunk {
    const output = { x, y, size }, padding = this.stones.length ? 22 : 0;
    // Include rocks whose centres lie outside this chunk, then crop the working halo.
    // Otherwise a boulder or its shadow could disappear at a texture boundary.
    x -= padding; y -= padding; size += padding * 2;
    // Matching world sample positions in the gutter make adjacent chunk filtering seamless.
    const width = size + 2, count = width * width, pixels = new Uint8Array(count * 4);
    const distance = new Float32Array(count).fill(Infinity), signed = new Float32Array(count), nx = new Float32Array(count), ny = new Float32Array(count);
    const rock = new Float32Array(count), depth = new Float32Array(count), high = new Float32Array(count), low = new Float32Array(count), valid = new Uint8Array(count);
    for (const segment of segments) {
      const a = { x: segment.a.x * R, y: segment.a.y * R }, b = { x: segment.b.x * R, y: segment.b.y * R };
      const reach = .67 * R * Math.max(segment.depthA, segment.depthB), dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - reach - x + 1)), x1 = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + reach - x + 1));
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - reach - y + 1)), y1 = Math.min(width - 1, Math.ceil(Math.max(a.y, b.y) + reach - y + 1));
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        const gx = x + px - .5, gy = y + py - .5, u = clamp(((gx - a.x) * dx + (gy - a.y) * dy) / (length2 || 1));
        const ox = gx - a.x - dx * u, oy = gy - a.y - dy * u, d2 = ox * ox + oy * oy, index = py * width + px;
        if (d2 >= distance[index]) continue;
        distance[index] = d2;
        const n = point(segment.na, segment.nb, u), len = Math.hypot(n.x, n.y);
        nx[index] = n.x / len; ny[index] = n.y / len;
        signed[index] = (ox * n.x + oy * n.y >= 0 ? 1 : -1) * Math.sqrt(d2);
        rock[index] = mix(segment.rockA, segment.rockB, u); depth[index] = mix(segment.depthA, segment.depthB, u);
        high[index] = segment.high; low[index] = segment.low;
      }
    }
    const lookup = new Map(tiles.map(t => [`${t.pos.q},${t.pos.r}`, tileHeight(t)]));
    const rotation = camera === 90 ? Math.PI / 2 : 0;
    // Same screen-space sun as ObjectShadowRenderer, transformed into Y-down map coordinates.
    const lx = (-Math.cos(rotation) + Math.sin(rotation)) / Math.SQRT2, ly = -(Math.sin(rotation) + Math.cos(rotation)) / Math.SQRT2;
    const mw = this.material.rock.width, mh = this.material.rock.height;
    const reflected = (v: number, length: number) => { const n = ((Math.floor(v) % (length * 2)) + length * 2) % (length * 2); return n < length ? n : length * 2 - n - 1; };
    for (let py = 0; py < width; py++) for (let px = 0; px < width; px++) {
      const gx = x + px - .5, gy = y + py - .5, index = py * width + px, at = index * 4;
      let height = lookup.get(axialAt(gx / R, gy / R)); if (height === undefined) continue;
      valid[index] = 1;
      const k = rock[index], half = mix(.30, .215, k) * R * depth[index];
      const d = signed[index] + noise(gx, gy) * mix(.9, 1.5, k), u = clamp((d + half) / (2 * half || 1));
      const tint = elevationSurfaceTint(height);
      let cr = tint?.value ?? 0, cg = cr, cb = cr, alpha = (tint?.alpha ?? 0) / 255;
      if (distance[index] < Infinity) {
        const blend = smooth(-half, half, d), a = elevationSurfaceTint(high[index]), b = elevationSurfaceTint(low[index]);
        const aa = (a?.alpha ?? 0) / 255 * (1 - blend), ab = (b?.alpha ?? 0) / 255 * blend;
        alpha = aa + ab; cr = cg = cb = alpha > 0 ? ((a?.value ?? 0) * aa + (b?.value ?? 0) * ab) / alpha : 0;
      }
      const over = (r: number, g: number, b: number, a: number) => {
        const out = a + alpha * (1 - a); if (out <= 0) return;
        cr = (r * a + cr * alpha * (1 - a)) / out; cg = (g * a + cg * alpha * (1 - a)) / out; cb = (b * a + cb * alpha * (1 - a)) / out; alpha = out;
      };
      if (distance[index] < Infinity && Math.abs(d) < half + 14) {
        const face = smooth(-half - mix(5, 1.5, k), -half + mix(4, 1.5, k), d)
          * (1 - smooth(half - 2, half + mix(7, 2.5, k), d));
        const facing = lx * nx[index] + ly * ny[index];
        const shoulder = Math.exp(-Math.pow((d + half * .83) / mix(6, 3.5, k), 2));
        const foot = Math.exp(-Math.pow((d - half * .85) / mix(6.5, 4.5, k), 2));
        // Shade the actual ground through transparent light/shadow; do not paste another grass patch.
        const lighting = 1 + facing * .38 * Math.sin(Math.PI * u) + shoulder * .15 - foot * (.23 + .08 * Math.max(0, -facing));
        if (lighting < 1) over(0, 0, 0, clamp(1 - lighting) * face);
        else over(255, 250, 216, clamp((lighting - 1) * .55) * face);
        const rockAmount = k * face * smooth(-half - 1, -half + 3, d);
        if (rockAmount > .001) {
          // One world-space rock field crosses every old hex edge and every rounded corner.
          const tx = reflected(gx * 1.4, mw), ty = reflected(gy * 1.4, mh), t = (ty * mw + tx) * 3;
          const light = clamp(.94 + facing * .22 + shoulder * .07 - foot * .12, .5, 1.2);
          // Broken earth remains between independent stones, rather than one solid rock ribbon.
          over(this.rock[t] * light, this.rock[t + 1] * light, this.rock[t + 2] * light,
            rockAmount * (this.stones.length ? .32 : 1));
        }
        const cast = Math.exp(-Math.pow((d - half - 2) / (4 + 4 * Math.max(0, -facing)), 2));
        over(0, 0, 0, cast * mix(.09, .23, k) * (.35 + .65 * Math.max(0, -facing)));
      }
      pixels[at] = Math.round(clamp(cr, 0, 255)); pixels[at + 1] = Math.round(clamp(cg, 0, 255)); pixels[at + 2] = Math.round(clamp(cb, 0, 255)); pixels[at + 3] = Math.round(alpha * 255);
    }
    if (this.stones.length) this.rubble(pixels, width, x, y, valid, distance, signed, nx, ny, rock, depth, lx, ly);
    if (!padding) return { ...output, pixels };
    const cropped = new Uint8Array((output.size + 2) ** 2 * 4), rowBytes = (output.size + 2) * 4;
    for (let row = 0; row < output.size + 2; row++) cropped.set(pixels.subarray(((row + padding) * width + padding) * 4,
      ((row + padding) * width + padding) * 4 + rowBytes), row * rowBytes);
    return { ...output, pixels: cropped };
  }

  private rubble(pixels: Uint8Array, width: number, x: number, y: number, valid: Uint8Array,
    distance: Float32Array, signed: Float32Array, nx: Float32Array, ny: Float32Array,
    rock: Float32Array, depth: Float32Array, lx: number, ly: number): void {
    const stones: Array<{ x: number; y: number; radius: number; angle: number; art: StonePixels; facing: number; opacity: number }> = [];
    for (const small of [false, true]) {
      const step = small ? 3.6 : 6.5, seed = small ? 41 : 19;
      for (let cy = Math.floor(y / step); cy <= Math.ceil((y + width) / step); cy++)
        for (let cx = Math.floor(x / step); cx <= Math.ceil((x + width) / step); cx++) {
          const gx = (cx + .12 + random(cx, cy, seed) * .76) * step, gy = (cy + .12 + random(cx, cy, seed + 1) * .76) * step;
          const px = Math.round(gx - x + .5), py = Math.round(gy - y + .5);
          if (px < 0 || px >= width || py < 0 || py >= width) continue;
          const at = py * width + px, k = rock[at]; if (!valid[at] || k < .02 || distance[at] === Infinity) continue;
          const half = mix(.30, .215, k) * R * depth[at], d = (signed[at] + noise(gx, gy) * 1.5) / half;
          const probability = small ? .38 * smooth(-.8, .2, d) * (1 - smooth(.95, 2.0, d))
            : .82 * smooth(-1.2, -.75, d) * (1 - smooth(.65, 1.25, d));
          if (random(cx, cy, seed + 2) > probability * k) continue;
          stones.push({ x: gx, y: gy, radius: small ? .65 + Math.pow(random(cx, cy, seed + 3), 2) * 1.6
            : 2.4 + Math.pow(random(cx, cy, seed + 3), 1.5) * 3.7,
            angle: random(cx, cy, seed + 4) * Math.PI * 2,
            art: this.stones[Math.floor(random(cx, cy, seed + 5) * this.stones.length)],
            facing: lx * nx[at] + ly * ny[at], opacity: smooth(0, .5, k) });
        }
    }
    // Stable compositing order also applies when a stone crosses two texture chunks.
    stones.sort((a, b) => a.y - b.y || a.x - b.x);
    const paint = (px: number, py: number, r: number, g: number, b: number, a: number) => {
      if (px < 0 || px >= width || py < 0 || py >= width || a <= .001) return;
      const at = py * width + px; if (!valid[at]) return;
      const i = at * 4, old = pixels[i + 3] / 255, out = a + old * (1 - a);
      pixels[i] = Math.round((clamp(r, 0, 255) * a + pixels[i] * old * (1 - a)) / out);
      pixels[i + 1] = Math.round((clamp(g, 0, 255) * a + pixels[i + 1] * old * (1 - a)) / out);
      pixels[i + 2] = Math.round((clamp(b, 0, 255) * a + pixels[i + 2] * old * (1 - a)) / out); pixels[i + 3] = Math.round(out * 255);
    };
    for (const stone of stones) {
      const c = Math.cos(stone.angle), s = Math.sin(stone.angle), art = stone.art, scale = art.size / (stone.radius * 2);
      const sample = (gx: number, gy: number) => {
        const dx = gx - stone.x, dy = gy - stone.y;
        const u = (dx * c + dy * s) * scale + (art.size - 1) / 2, v = (-dx * s + dy * c) * scale + (art.size - 1) / 2;
        if (u < 0 || v < 0 || u >= art.size - 1 || v >= art.size - 1) return null;
        const ix = Math.floor(u), iy = Math.floor(v), fu = u - ix, fv = v - iy;
        let alpha = 0, r = 0, g = 0, b = 0, normalX = 0, normalY = 0;
        for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) {
          const t = (iy + oy) * art.size + ix + ox, a = art.rgba[t * 4 + 3] / 255 * (ox ? fu : 1 - fu) * (oy ? fv : 1 - fv);
          alpha += a; r += art.rgba[t * 4] * a; g += art.rgba[t * 4 + 1] * a; b += art.rgba[t * 4 + 2] * a;
          normalX += (art.normals[t * 2] - 128) / 127 * a; normalY += (art.normals[t * 2 + 1] - 128) / 127 * a;
        }
        if (alpha < .001) return null;
        return { alpha, r: r / alpha, g: g / alpha, b: b / alpha, nx: normalX / alpha, ny: normalY / alpha };
      };
      // Contact and cast shadows follow the screen-space sun, never a rotated prelit stamp.
      const reach = Math.max(.65, stone.radius * .58), shadowX = -lx * reach, shadowY = -ly * reach;
      const draw = (shadow: boolean) => {
        const sx = shadow ? shadowX : 0, sy = shadow ? shadowY : 0, radius = stone.radius + .5;
        for (let py = Math.floor(stone.y + sy - radius - y + .5); py <= Math.ceil(stone.y + sy + radius - y + .5); py++)
          for (let px = Math.floor(stone.x + sx - radius - x + .5); px <= Math.ceil(stone.x + sx + radius - x + .5); px++) {
            const t = sample(x + px - .5 - sx, y + py - .5 - sy); if (!t) continue;
            if (shadow) { paint(px, py, 30, 29, 24, t.alpha * .38 * stone.opacity); continue; }
            const normalX = t.nx * c - t.ny * s, normalY = t.nx * s + t.ny * c, normalZ = Math.sqrt(Math.max(0, 1 - t.nx * t.nx - t.ny * t.ny));
            const light = clamp((.70 + .48 * (lx * normalX * .65 + ly * normalY * .65 + normalZ * .76)) * (.94 + .10 * stone.facing), .4, 1.22);
            paint(px, py, t.r * light, t.g * light, t.b * light, t.alpha * stone.opacity);
          }
      };
      draw(true); draw(false);
    }
  }
}
