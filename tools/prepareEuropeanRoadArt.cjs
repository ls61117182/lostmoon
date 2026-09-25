// Export textured European road surfaces as 13 rotationally unique transparent sprites per season.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets/resources/textures/terrain/european_roads');
const PREVIEW_OUT = path.join(ROOT, 'source_art/terrain/european_roads');
const W = 222, H = 256, S = 3;
const HALF = 128 * 0.18;
const EDGE = 1.8;
// Let active road mouths extend beyond diagonal hex edges. This covers the
// baked tile border after Cocos rotates and bilinearly samples the sprite.
const MOUTH_BLEED = 5;
const TURN_RADIUS = 43;
const JUNCTION_BLEND = 30;
const DIRECTIONS = ['E', 'SE', 'SW', 'W', 'NW', 'NE'];
const EDGES = [[222, 128], [166.5, 224], [55.5, 224], [0, 128], [55.5, 32], [166.5, 32]];
const VERTICES = [[111, 0], [222, 64], [222, 192], [111, 256], [0, 192], [0, 64]];
const RAYS = EDGES.map(([x, y]) => {
  const d = Math.hypot(x - 111, y - 128);
  return [(x - 111) / d, (y - 128) / d];
});
const STYLES = {
  summer: {
    source: path.join(ROOT, 'assets/resources/textures/terrain/terrain_road.png'),
    fill: [226, 216, 194],
    outline: [79, 68, 53],
  },
  winter: {
    source: path.join(ROOT, 'assets/resources/textures/terrain/terrain_road_snow.png'),
    fill: [216, 218, 213],
    outline: [93, 99, 98],
  },
};

const flags = mask => Array.from({ length: 6 }, (_, i) => (mask >> i) & 1).join('');
const file = (season, mask) => `european_road_surface_${season}_${flags(mask)}_v1.png`;
const rotateMask = (mask, clockwiseSteps) => {
  const steps = ((clockwiseSteps % 6) + 6) % 6;
  const normalized = mask & 63;
  return steps ? ((normalized << steps) | (normalized >> (6 - steps))) & 63 : normalized;
};
const canonicalTransform = mask => {
  let canonicalMask = mask & 63;
  let rotationSteps = 0;
  for (let steps = 1; steps < 6; steps++) {
    const candidate = rotateMask(mask, -steps);
    if (candidate < canonicalMask) {
      canonicalMask = candidate;
      rotationSteps = steps;
    }
  }
  return { canonicalMask, rotationSteps, rotationDegrees: rotationSteps === 0 ? 0 : -rotationSteps * 60 };
};
const CANONICAL_MASKS = [...new Set(Array.from({ length: 63 }, (_, i) =>
  canonicalTransform(i + 1).canonicalMask))].sort((a, b) => a - b);

function stableUuid(key) {
  const hex = crypto.createHash('sha256').update(`sherman:${key}`).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function ensureDirectoryMeta() {
  const output = `${OUT}.meta`;
  if (fs.existsSync(output)) return;
  fs.writeFileSync(output, JSON.stringify({
    ver: '1.2.0', importer: 'directory', imported: true,
    uuid: stableUuid('european_roads_directory'), files: [], subMetas: {}, userData: {},
  }, null, 2) + '\n');
}

function imageMetaFor(filename) {
  const output = path.join(OUT, `${filename}.meta`);
  if (fs.existsSync(output)) return;
  const template = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'assets/resources/textures/terrain/terrain_road.png.meta'), 'utf8'));
  const uuid = stableUuid(filename);
  const name = path.basename(filename, '.png');
  const meta = JSON.parse(JSON.stringify(template).replaceAll(template.uuid, uuid).replaceAll('terrain_road', name));
  const frame = meta.subMetas.f9941.userData;
  frame.trimType = 'none';
  frame.packable = false;
  fs.writeFileSync(output, JSON.stringify(meta, null, 2) + '\n');
}

function jsonMetaFor(filename) {
  const output = path.join(OUT, `${filename}.meta`);
  if (fs.existsSync(output)) return;
  fs.writeFileSync(output, JSON.stringify({
    ver: '2.0.1', importer: 'json', imported: true,
    uuid: stableUuid(filename), files: ['.json'], subMetas: {}, userData: {},
  }, null, 2) + '\n');
}

function hexInset(x, y) {
  let result = Infinity;
  for (let i = 0; i < 6; i++) {
    const [ax, ay] = VERTICES[i], [bx, by] = VERTICES[(i + 1) % 6];
    result = Math.min(result, ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / Math.hypot(bx - ax, by - ay));
  }
  return result;
}

function shapeFor(mask) {
  const dirs = RAYS.filter((_, d) => mask & (1 << d));
  const pairs = [];
  for (let a = 0; a < dirs.length; a++) for (let b = a + 1; b < dirs.length; b++) {
    if (dirs[a][0] * dirs[b][0] + dirs[a][1] * dirs[b][1] > -.99) pairs.push([a, b]);
  }
  let turn = null;
  if (dirs.length === 2 && pairs.length) {
    const [u, v] = dirs;
    const angle = Math.acos(u[0] * v[0] + u[1] * v[1]);
    const tangent = TURN_RADIUS / Math.tan(angle / 2);
    const bisectorLength = Math.hypot(u[0] + v[0], u[1] + v[1]);
    const centerOffset = TURN_RADIUS / Math.sin(angle / 2);
    const cx = (u[0] + v[0]) / bisectorLength * centerOffset;
    const cy = (u[1] + v[1]) / bisectorLength * centerOffset;
    const start = Math.atan2(tangent * u[1] - cy, tangent * u[0] - cx);
    const end = Math.atan2(tangent * v[1] - cy, tangent * v[0] - cx);
    turn = { tangent, cx, cy, start, sweep: Math.atan2(Math.sin(end - start), Math.cos(end - start)) };
  }
  return (x, y) => {
    x -= 111; y -= 128;
    if (turn) {
      const { tangent, cx, cy, start, sweep } = turn;
      let distance = Infinity;
      for (const [ux, uy] of dirs) {
        const dot = x * ux + y * uy - tangent;
        distance = Math.min(distance, dot >= 0 ? Math.abs(x * uy - y * ux) : Math.hypot(x - tangent * ux, y - tangent * uy));
      }
      const relative = Math.atan2(Math.sin(Math.atan2(y - cy, x - cx) - start), Math.cos(Math.atan2(y - cy, x - cx) - start));
      if (relative * Math.sign(sweep) >= 0 && Math.abs(relative) <= Math.abs(sweep)) {
        distance = Math.min(distance, Math.abs(Math.hypot(x - cx, y - cy) - TURN_RADIUS));
      }
      return distance;
    }
    const distances = dirs.map(([ux, uy]) => x * ux + y * uy >= 0 ? Math.abs(x * uy - y * ux) : Math.hypot(x, y));
    let result = Math.min(...distances);
    if (dirs.length === 1) return Math.min(result, Math.hypot(x, y) - HALF * .6);
    for (const [a, b] of pairs) {
      if (x * dirs[a][0] + y * dirs[a][1] < 0 || x * dirs[b][0] + y * dirs[b][1] < 0) continue;
      const blend = Math.max(0, 1 - Math.abs(distances[a] - distances[b]) / JUNCTION_BLEND);
      result = Math.min(result, Math.min(distances[a], distances[b]) - JUNCTION_BLEND * blend * blend / 4);
    }
    return result;
  };
}

async function sourceTexture(style) {
  // Sample only the interior of the base tile. Its outer pixels contain the
  // hex border, which would otherwise be baked into every road mouth as a seam.
  const { data } = await sharp(style.source)
    .extract({ left: 64, top: 64, width: 94, height: 128 })
    .removeAlpha()
    .resize(W * S, H * S, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < data.length; i += 3) sum += data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114;
  return { data, mean: sum / (data.length / 3) };
}

async function renderSurface(mask, style, texture) {
  const data = Buffer.alloc(W * H * S * S * 4);
  const distanceAt = shapeFor(mask);
  for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) {
    const px = (x + .5) / S, py = (y + .5) / S;
    const inset = hexInset(px, py);
    if (inset < -MOUTH_BLEED) continue;
    const distance = distanceAt(px, py);
    if (distance > HALF + EDGE) continue;
    const index = y * W * S + x;
    const out = index * 4;
    if (distance > HALF) {
      for (let c = 0; c < 3; c++) data[out + c] = style.outline[c];
    } else {
      // Mirrored periods match both hex-grid translations. Fade material
      // variation near the hex edge so adjacent road mouths have identical RGB.
      const tx = Math.min(W * S - 1, Math.floor((1 - Math.abs(2 * ((px / (W / 2)) % 1) - 1)) * (W * S - 1)));
      const ty = Math.min(H * S - 1, Math.floor((1 - Math.abs(2 * ((py / (H * .75)) % 1) - 1)) * (H * S - 1)));
      const sample = (ty * W * S + tx) * 3;
      const luminance = texture.data[sample] * .299 + texture.data[sample + 1] * .587 + texture.data[sample + 2] * .114;
      const edgeFade = Math.max(0, Math.min(1, inset / 10));
      const detail = Math.max(-18, Math.min(18, (luminance - texture.mean) * .72)) * edgeFade;
      for (let c = 0; c < 3; c++) data[out + c] = Math.max(0, Math.min(255, Math.round(style.fill[c] + detail)));
    }
    data[out + 3] = 255;
  }
  return sharp(data, { raw: { width: W * S, height: H * S, channels: 4 } }).resize(W, H).png().toBuffer();
}

async function renderBridge(season, roadSurface) {
  const width = W * S, height = H * S;
  const data = Buffer.alloc(width * height * 4);
  const bridgeHalf = 128 * .26;
  const railOffset = bridgeHalf + 128 * .055;
  const wood = season === 'winter' ? [188, 205, 214] : [128, 92, 58];
  const outline = [76, 61, 42];
  const rail = [72, 50, 32];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = (x + .5) / S, py = (y + .5) / S;
    const across = Math.abs(py - H / 2);
    const out = (y * width + x) * 4;
    let color = null;
    let alpha = 255;
    if (across <= bridgeHalf) {
      const grain = season === 'winter'
        ? Math.round(Math.sin(px * .18 + py * .07) * 3)
        : Math.round(Math.sin(px * .17 + py * .11) * 7 + Math.sin(px * .051) * 4);
      color = wood.map(value => Math.max(0, Math.min(255, value + grain)));
      if (Math.abs(across - bridgeHalf) < 1.4) color = outline;
      const plankStep = W / 6;
      const nearestPlank = Math.abs(px / plankStep - Math.round(px / plankStep)) * plankStep;
      if (nearestPlank < .65 && across > HALF + EDGE + 1) {
        color = outline;
        alpha = 170;
      }
    }
    if (Math.abs(across - railOffset) < 1.25) {
      color = rail;
      alpha = 255;
    }
    if (!color) continue;
    for (let c = 0; c < 3; c++) data[out + c] = color[c];
    data[out + 3] = alpha;
  }
  const deck = await sharp(data, { raw: { width, height, channels: 4 } }).resize(W, H).png().toBuffer();
  return sharp(deck).composite([{ input: roadSurface }]).png().toBuffer();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PREVIEW_OUT, { recursive: true });
  ensureDirectoryMeta();
  const rendered = { summer: new Map(), winter: new Map() };
  for (const [season, style] of Object.entries(STYLES)) {
    const texture = await sourceTexture(style);
    for (const mask of CANONICAL_MASKS) {
      const png = await renderSurface(mask, style, texture);
      const filename = file(season, mask);
      await fs.promises.writeFile(path.join(OUT, filename), png);
      imageMetaFor(filename);
      rendered[season].set(mask, png);
    }
    const bridgeFilename = `european_bridge_surface_${season}_v1.png`;
    const bridgePng = await renderBridge(season, rendered[season].get(9));
    await fs.promises.writeFile(path.join(OUT, bridgeFilename), bridgePng);
    imageMetaFor(bridgeFilename);
  }

  const variants = Array.from({ length: 64 }, (_, mask) => {
    const transform = mask ? canonicalTransform(mask) : null;
    return {
      rd: flags(mask), directions: DIRECTIONS.filter((_, i) => mask & (1 << i)),
      canonicalRd: transform ? flags(transform.canonicalMask) : null,
      rotationSteps: transform?.rotationSteps ?? 0,
      rotationDegrees: transform?.rotationDegrees ?? 0,
      summer: transform ? file('summer', transform.canonicalMask) : null,
      winter: transform ? file('winter', transform.canonicalMask) : null,
    };
  });
  const manifestName = 'european_road_manifest.json';
  fs.writeFileSync(path.join(OUT, manifestName), JSON.stringify({
    size: [W, H], pivot: [.5, .5], directionOrder: DIRECTIONS,
    roadHalfWidth: HALF, edgeWidth: EDGE, mouthBleed: MOUTH_BLEED, endpointRadius: HALF * 1.6,
    turnCenterlineRadius: TURN_RADIUS, junctionBlend: JUNCTION_BLEND,
    canonicalSurfaceCountPerSeason: CANONICAL_MASKS.length,
    seasons: Object.keys(STYLES),
    bridge: {
      shapeCountPerSeason: 1,
      canonicalEnds: ['E', 'W'],
      summer: 'european_bridge_surface_summer_v1.png',
      winter: 'european_bridge_surface_winter_v1.png',
      note: 'Straight bridge only; rotate the E-W sprite by 0, -60, or -120 degrees at runtime.',
    },
    note: '63 direction masks reuse 13 canonical transparent surfaces per season and rotate them at runtime.',
    variants,
  }, null, 2) + '\n');
  jsonMetaFor(manifestName);

  const cells = [];
  for (let i = 0; i < CANONICAL_MASKS.length; i++) {
    const mask = CANONICAL_MASKS[i];
    for (let row = 0; row < 2; row++) {
      const season = row ? 'winter' : 'summer';
      const left = 18 + i * 118;
      const top = 18 + row * 166;
      const surface = await sharp(rendered[season].get(mask)).resize(111, 128).png().toBuffer();
      cells.push({ input: await sharp(STYLES[season].source).resize(111, 128).composite([{ input: surface }]).png().toBuffer(), left, top });
      cells.push({ input: Buffer.from(`<svg width="111" height="24"><text x="55" y="17" font-family="sans-serif" font-size="13" fill="#eee" text-anchor="middle">${flags(mask)}</text></svg>`), left, top: top + 130 });
    }
  }
  await sharp({ create: { width: 1570, height: 356, channels: 4, background: '#404842' } }).composite(cells).png().toFile(path.join(PREVIEW_OUT, 'european_roads_canonical_preview.png'));
  console.log(`Exported ${CANONICAL_MASKS.length} summer + ${CANONICAL_MASKS.length} winter European road surfaces.`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { flags, rotateMask, canonicalTransform, CANONICAL_MASKS, shapeFor, HALF, EDGE, MOUTH_BLEED, TURN_RADIUS, EDGES, RAYS };
