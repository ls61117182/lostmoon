// Export generated city art using a shared registration for each damage sequence.
// Trim transparent margins only; keep every visible pixel inside the hex.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'source_art/terrain/urban-redraw-20261005');
const TARGET = path.join(ROOT, 'assets/resources/textures/terrain/urban');
const BACKUP = path.join(SOURCE, 'before');
const W = 222, H = 256;
function backup(file) {
  const saved = path.join(BACKUP, path.relative(TARGET, file));
  if (fs.existsSync(file) && !fs.existsSync(saved)) {
    fs.mkdirSync(path.dirname(saved), { recursive: true });
    fs.copyFileSync(file, saved);
  }
}
function filename(e) {
  if (e.kind === 'indestructible') return `urban_dense_indestructible_${e.key}_v1.png`;
  if (e.key === 'block' && e.state !== 'rubble') return `urban_dense_destructible_${e.state}_topdown_v2.png`;
  return `urban_dense_destructible_${e.key}_${e.state}_v1.png`;
}
async function registration(files) {
  const original = await sharp(files[0]).metadata();
  const width = original.width, height = original.height, states = [];
  let left = width, right = 0, top = height, bottom = 0;
  for (const file of files) {
    const data = await sharp(file).resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
    states.push(data);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!data[(y * width + x) * 4 + 3]) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  const margin = 4;
  const slope = H / (2 * W);
  const bounds = { xmin: Infinity, xmax: -Infinity, umin: Infinity, umax: -Infinity, vmin: Infinity, vmax: -Infinity };
  for (const data of states) for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    if (!data[(y * width + x) * 4 + 3]) continue;
    const px = x + .5, u = y + .5 + slope * px, v = y + .5 - slope * px;
    bounds.xmin = Math.min(bounds.xmin, px); bounds.xmax = Math.max(bounds.xmax, px);
    bounds.umin = Math.min(bounds.umin, u); bounds.umax = Math.max(bounds.umax, u);
    bounds.vmin = Math.min(bounds.vmin, v); bounds.vmax = Math.max(bounds.vmax, v);
  }
  // Maximize scale AND placement. Six linear half-plane constraints form a
  // three-variable linear program (scale, x translation, y translation).
  // Its optimum lies at a vertex; enumerate the 20 possible face triples.
  const A = W / 2 - margin, B = H / 2 - margin;
  const faces = [[bounds.xmax, 1, 0, A], [-bounds.xmin, -1, 0, A],
    [bounds.umax, slope, 1, B], [-bounds.umin, -slope, -1, B],
    [bounds.vmax, -slope, 1, B], [-bounds.vmin, slope, -1, B]];
  let best;
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 5; b++) for (let c = b + 1; c < 6; c++) {
    const rows = [faces[a].slice(), faces[b].slice(), faces[c].slice()];
    let singular = false;
    for (let col = 0; col < 3; col++) {
      let pivot = col;
      for (let row = col + 1; row < 3; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
      if (Math.abs(rows[pivot][col]) < 1e-9) { singular = true; break; }
      [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
      const divisor = rows[col][col];
      for (let k = col; k < 4; k++) rows[col][k] /= divisor;
      for (let row = 0; row < 3; row++) if (row !== col) {
        const factor = rows[row][col];
        for (let k = col; k < 4; k++) rows[row][k] -= factor * rows[col][k];
      }
    }
    if (singular) continue;
    const candidate = rows.map(row => row[3]);
    if (candidate[0] <= 0 || faces.some(face => face[0] * candidate[0] + face[1] * candidate[1] + face[2] * candidate[2] > face[3] + 1e-6)) continue;
    if (!best || candidate[0] > best[0]) best = candidate;
  }
  if (!best) throw new Error('Cannot register city silhouette');
  return { sourceWidth: width, sourceHeight: height, left, top, width: right - left + 1, height: bottom - top + 1,
    scale: best[0], offsetX: W / 2 + best[1] + left * best[0], offsetY: H / 2 + best[2] + top * best[0], margin, states: files.length };
}
async function exportSprite(file, plan) {
  const width = Math.max(1, Math.round(plan.width * plan.scale));
  const height = Math.max(1, Math.round(plan.height * plan.scale));
  const normalized = await sharp(file).resize(plan.sourceWidth, plan.sourceHeight, { fit: 'fill' }).png().toBuffer();
  const sprite = await sharp(normalized)
    .extract({ left: plan.left, top: plan.top, width: plan.width, height: plan.height })
    .resize(width, height).png().toBuffer();
  if (width > W || height > H) throw new Error('Registered sprite does not fit its canvas');
  const left = Math.round(plan.offsetX), top = Math.round(plan.offsetY);
  if (left < 0 || top < 0 || left + width > W || top + height > H) throw new Error('Canvas would clip the registered silhouette');
  return sharp({ create: { width: W, height: H, channels: 4, background: '#00000000' } })
    .composite([{ input: sprite, left, top }])
    .png().toBuffer();
}
async function save(file, data) {
  backup(file); backup(file + '.meta');
  await writeRetry(file, data);
}
async function writeRetry(file, data) {
  // Creator can briefly hold a texture while its asset watcher imports it.
  for (let attempt = 0; ; attempt++) {
    try { fs.writeFileSync(file, data); break; }
    catch (error) {
      if (attempt >= 15 || !['UNKNOWN', 'EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
}
async function surfaces(manifest) {
  const { CANONICAL_MASKS, shapeFor, hexInset, HALF, CURB, flags } = require('./prepareUrbanRoadArt.cjs');
  const S = 3, sw = W * S, sh = H * S;
  const paving = await sharp(manifest.paving.path).resize(sw, sh).removeAlpha().raw().toBuffer();
  const asphalt = await sharp(manifest.asphalt.path).resize(sw, sh).removeAlpha().raw().toBuffer();
  const base = Buffer.alloc(sw * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = y * sw + x;
    base[i * 4 + 3] = hexInset((x + .5) / S, (y + .5) / S) >= 0 ? 255 : 0;
    for (let c = 0; c < 3; c++) base[i * 4 + c] = paving[i * 3 + c];
  }
  const encode = data => sharp(data, { raw: { width: sw, height: sh, channels: 4 } }).resize(W, H).png().toBuffer();
  const floor = await encode(base);
  for (const name of ['urban_floor_base_v1.png', 'urban_road_base_v1.png', 'roads/urban_road_tile_base_v1.png']) await save(path.join(TARGET, name), floor);
  for (const mask of CANONICAL_MASKS) {
    const distance = shapeFor(mask), data = Buffer.alloc(sw * sh * 4);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const px = (x + .5) / S, py = (y + .5) / S, i = y * sw + x;
      if (hexInset(px, py) < 0) continue;
      const d = distance(px, py) - HALF;
      if (d > CURB) continue;
      const tx = Math.min(sw - 1, Math.floor((1 - Math.abs(2 * ((px / (W / 2)) % 1) - 1)) * (sw - 1)));
      const ty = Math.min(sh - 1, Math.floor((1 - Math.abs(2 * ((py / (H * .75)) % 1) - 1)) * (sh - 1)));
      const sample = (ty * sw + tx) * 3;
      const color = d <= 0 ? null : d < .9 ? [64, 65, 58] : d < CURB - .7 ? [146, 144, 125] : [83, 86, 75];
      for (let c = 0; c < 3; c++) data[i * 4 + c] = color ? color[c] : asphalt[sample + c];
      data[i * 4 + 3] = 255;
    }
    await save(path.join(TARGET, `roads/urban_road_surface_${flags(mask)}_v1.png`), await encode(data));
  }
  // Update the actual terrain material consumed by CPU/GPU terrain rendering.
  const materialFile = path.join(ROOT, 'assets/resources/textures/terrain/redesign_v3/materials.json');
  const materialBackup = path.join(BACKUP, 'materials.json');
  if (!fs.existsSync(materialBackup)) fs.copyFileSync(materialFile, materialBackup);
  const bundle = JSON.parse(fs.readFileSync(materialFile, 'utf8'));
  for (const m of [bundle, bundle.europeanSummer, bundle.europeanWinter]) {
    if (!m?.materials?.paving) continue;
    const old = m.materials.paving;
    const rgb = await sharp(manifest.paving.path).resize(old.width, old.height).removeAlpha().raw().toBuffer();
    m.materials.paving = { width: old.width, height: old.height, rgb: rgb.toString('base64') };
  }
  await writeRetry(materialFile, JSON.stringify(bundle) + '\n');
  for (const key of ['paving', 'asphalt']) {
    const local = path.join(SOURCE, `${key}-material.png`);
    if (path.resolve(manifest[key].path) !== local) fs.copyFileSync(manifest[key].path, local);
  }
}
async function neighbourhood(manifest) {
  const ts = require('typescript');
  const load = (file, deps = {}) => {
    const m = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(path.join(ROOT, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    new Function('module', 'exports', 'require', code)(m, m.exports, name => deps[name]);
    return m.exports;
  };
  const urban = load('assets/scripts/core/UrbanTerrain.ts');
  const { TerrainGroundRaster } = load('assets/scripts/view/TerrainGroundRaster.ts', { '../core/UrbanTerrain': urban });
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/resources/textures/terrain/redesign_v3/materials.json'), 'utf8'));
  const tiles = [], sprites = [], radius = 48, ox = -58, oy = -56;
  let next = 0;
  for (let r = 0; r < 7; r++) for (let c = 0; c < 8; c++) {
    const pos = { q: c - Math.floor(r / 2), r };
    const x = Math.sqrt(3) * radius * (pos.q + r / 2), y = radius * 1.5 * r;
    const urbanCell = r > 0 && r < 6 && c > 0 && c < 7;
    const road = r === 3 || c === 4;
    const tile = { pos, terrain: urbanCell || road ? 'urban_ground' : 'field' };
    const cx = Math.round(x - ox + 1), cy = Math.round(y - oy + 1);
    if (road) {
      tile.terrain = 'urban_road';
      let mask = 0;
      const offsets = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
      for (let d = 0; d < 6; d++) {
        const nr = r + offsets[d][1], nc = pos.q + offsets[d][0] + Math.floor(nr / 2);
        if (nr >= 0 && nr < 7 && nc >= 0 && nc < 8 && (nr === 3 || nc === 4)) mask |= 1 << d;
      }
      const transform = urban.urbanRoadSpriteTransform(Array.from({ length: 6 }, (_, d) => !!(mask & (1 << d))));
      const roadImage = await sharp(path.join(TARGET, `roads/urban_road_surface_${transform.canonicalFlags}_v1.png`)).resize(83, 96).rotate(-transform.rotationDegrees, { background: '#00000000' }).png().toBuffer();
      const rm = await sharp(roadImage).metadata();
      sprites.push({ input: roadImage, left: cx - Math.floor(rm.width / 2), top: cy - Math.floor(rm.height / 2) });
    } else if (urbanCell && next < manifest.images.length) {
      const e = manifest.images[next++];
      tile.terrain = e.kind === 'indestructible' ? 'urban_indestructible' : e.state === 'rubble' ? 'urban_rubble' : 'urban_destructible';
      tile.urbanKind = e.kind;
      const scale = urban.urbanBuildingSpriteScale(tile);
      const bw = Math.round(83 * scale), bh = Math.round(96 * scale);
      sprites.push({ input: await sharp(path.join(TARGET, filename(e))).resize(bw, bh).png().toBuffer(), left: cx - Math.floor(bw / 2), top: cy - Math.floor(bh / 2) });
    } else if ((c === 0 || c === 7) && r % 2 === 0) {
      sprites.push({ input: await sharp(path.join(ROOT, 'assets/resources/textures/terrain/tree_01.png')).resize(76, 76).png().toBuffer(), left: cx - 38, top: cy - 38 });
    }
    tiles.push(tile);
  }
  const engine = new TerrainGroundRaster(bundle.europeanSummer);
  const chunk = engine.renderChunk(tiles, false, ox, oy, 724, 546);
  await sharp(Buffer.from(chunk.pixels), { raw: { width: chunk.textureWidth, height: chunk.textureHeight, channels: 4 } })
    .flatten({ background: '#4b5341' }).composite(sprites).png().toFile(path.join(SOURCE, 'neighbourhood-preview.png'));
}
async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(SOURCE, 'manifest.json'), 'utf8'));
  const expected = [
    ...['apartment', 'factory', 'office_l', 'warehouse', 'market', 'theater', 'post_office', 'waterworks', 'church', 'town_hall', 'civic_dome'].map(key => `indestructible:${key}:intact`),
    ...['rowhouses_l', 'courtyard', 'workshop', 'block'].flatMap(key => ['intact', 'damaged', 'rubble'].map(state => `destructible:${key}:${state}`)),
  ];
  const actual = manifest.images.map(e => `${e.kind}:${e.key}:${e.state}`);
  if (actual.length !== expected.length || expected.some(key => actual.filter(x => x === key).length !== 1)) throw new Error('Incomplete city art manifest');
  for (const e of [...manifest.images, manifest.paving, manifest.asphalt]) {
    if (!e?.path || !fs.existsSync(e.path)) throw new Error(`Missing generated image: ${e?.path}`);
  }
  const plans = {}, files = [], report = [];
  fs.mkdirSync(path.join(SOURCE, 'generated'), { recursive: true });
  fs.mkdirSync(BACKUP, { recursive: true });
  if (!process.argv.includes('--buildings-only')) await surfaces(manifest);
  for (const e of manifest.images) {
    const raw = path.join(SOURCE, 'generated', `${e.kind}_${e.key}_${e.state}.png`);
    if (!fs.existsSync(raw)) fs.copyFileSync(e.path, raw);
  }
  for (const e of manifest.images.filter(e => e.state === 'intact')) {
    const states = [e, ...manifest.images.filter(other => other.key === e.key && other.state !== 'intact')];
    plans[e.key] = await registration(states.map(state => path.join(SOURCE, 'generated', `${state.kind}_${state.key}_${state.state}.png`)));
  }
  for (const e of manifest.images) {
    const raw = path.join(SOURCE, 'generated', `${e.kind}_${e.key}_${e.state}.png`);
    const data = await exportSprite(raw, plans[e.key]);
    const name = filename(e), file = path.join(TARGET, name);
    await save(file, data); files.push(name);
    fs.mkdirSync(path.join(SOURCE, 'exports'), { recursive: true });
    fs.writeFileSync(path.join(SOURCE, 'exports', name), data);
    const { data: pixels } = await sharp(data).raw().toBuffer({ resolveWithObject: true });
    let opaque = 0, outside = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = pixels[(y * W + x) * 4 + 3];
      if (a > 32) {
        opaque++;
      }
      if (a && (Math.abs(x + .5 - W / 2) > W / 2 || Math.abs(y + .5 - H / 2) + Math.abs(x + .5 - W / 2) * H / (2 * W) > H / 2)) outside++;
    }
    if (outside > 0) throw new Error(`Sprite escapes its hex: ${name}`);
    const stats = await sharp(data).stats();
    if (stats.channels[3].min !== 0 || stats.channels[3].max !== 255) throw new Error(`Invalid transparency: ${name}`);
    report.push({ file: name, dimensions: [W, H], coverage: +(opaque / (W * H * .75)).toFixed(3), outsideHexPixels: outside, visiblePixelsDiscarded: 0, registration: plans[e.key] });
  }
  // Keep legacy/fallback sprite names visually consistent with runtime variants.
  const aliases = {
    'urban_dense_indestructible.png': 'urban_dense_indestructible_apartment_v1.png',
    'urban_dense_indestructible_topdown_v2.png': 'urban_dense_indestructible_apartment_v1.png',
    'urban_dense_destructible_intact.png': 'urban_dense_destructible_intact_topdown_v2.png',
    'urban_dense_destructible_damaged.png': 'urban_dense_destructible_damaged_topdown_v2.png',
    'urban_dense_rubble.png': 'urban_dense_destructible_block_rubble_v1.png',
    'urban_dense_rubble_topdown_v2.png': 'urban_dense_destructible_block_rubble_v1.png',
  };
  for (const [name, source] of Object.entries(aliases)) await save(path.join(TARGET, name), fs.readFileSync(path.join(TARGET, source)));
  const { CANONICAL_MASKS, EDGES, RAYS, flags } = require('./prepareUrbanRoadArt.cjs');
  let mouths = 0;
  for (const mask of CANONICAL_MASKS) {
    const { data, info } = await sharp(path.join(TARGET, `roads/urban_road_surface_${flags(mask)}_v1.png`)).raw().toBuffer({ resolveWithObject: true });
    if (info.width !== W || info.height !== H || info.channels !== 4) throw new Error('Invalid road image dimensions');
    for (let d = 0; d < 6; d++) {
      const x = Math.max(0, Math.min(W - 1, Math.floor(EDGES[d][0] - RAYS[d][0] * 3)));
      const y = Math.max(0, Math.min(H - 1, Math.floor(EDGES[d][1] - RAYS[d][1] * 3)));
      if ((data[(y * W + x) * 4 + 3] > 200) !== !!(mask & (1 << d))) throw new Error(`Incorrect road mouth ${mask}/${d}`);
      mouths++;
    }
  }
  for (const name of [...files, ...Object.keys(aliases)]) {
    const meta = path.join(TARGET, name + '.meta'), original = path.join(BACKUP, name + '.meta');
    if (!fs.readFileSync(meta).equals(fs.readFileSync(original))) throw new Error(`Cocos metadata changed: ${name}`);
  }
  const floor = path.join(TARGET, 'roads/urban_road_tile_base_v1.png');
  const panels = [];
  for (let i = 0; i < files.length; i++) {
    const sprite = await sharp(floor).composite([{ input: path.join(TARGET, files[i]) }]).png().toBuffer();
    panels.push({ input: sprite, left: 16 + (i % 4) * 238, top: 16 + Math.floor(i / 4) * 288 });
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="222" height="24"><text x="111" y="16" text-anchor="middle" fill="#e7e4d7" font-family="sans-serif" font-size="11">${manifest.images[i].key} / ${manifest.images[i].state}</text></svg>`);
    panels.push({ input: label, left: 16 + (i % 4) * 238, top: 274 + Math.floor(i / 4) * 288 });
  }
  await sharp({ create: { width: 968, height: 16 + Math.ceil(files.length / 4) * 288, channels: 4, background: '#59614e' } }).composite(panels).png().toFile(path.join(SOURCE, 'city-preview.png'));
  await neighbourhood(manifest);
  fs.writeFileSync(path.join(SOURCE, 'validation.json'), JSON.stringify({ images: report, aliases, verifiedRoadMouths: mouths, uuidPolicy: 'Existing .meta unchanged; byte comparison passed', tool: 'built-in image_gen' }, null, 2) + '\n');
  for (const e of manifest.images) {
    e.generatedPath ??= e.path;
    e.path = path.join(SOURCE, 'generated', `${e.kind}_${e.key}_${e.state}.png`).replaceAll('\\', '/');
    e.runtimeFile = `assets/resources/textures/terrain/urban/${filename(e)}`;
  }
  for (const key of ['paving', 'asphalt']) {
    manifest[key].generatedPath ??= manifest[key].path;
    manifest[key].path = path.join(SOURCE, `${key}-material.png`).replaceAll('\\', '/');
  }
  manifest.registration = 'Fit the union of every damage state inside the hex with a 4px margin; preserve complete visible silhouettes without hex clipping';
  fs.writeFileSync(path.join(SOURCE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(report.map(({ file, coverage, outsideHexPixels }) => ({ file, coverage, outsideHexPixels })), null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
