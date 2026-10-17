const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const ts = require('typescript');
const { PACK, LIVE, MATERIALS, digest, jsonDigest, safe } = require('./switchEuropeanTerrainArt.cjs');
const MATERIAL_IDS = ['grass', 'mud', 'soil', 'water', 'deep_water', 'timber', 'road_surface', 'forest_floor'];
function writeJSON(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); }
function list(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? list(path.join(dir, e.name), prefix + e.name + '/') : [prefix + e.name]);
}
function targets() {
  const pngs = ['field', 'forest', 'mud', 'road', 'water', 'deep_water'].map(t => 'terrain_' + t + '.png');
  for (let i = 1; i <= 4; i++) pngs.push(`redesign_v3/europe_tree_0${i}.png`);
  for (const name of fs.readdirSync(path.join(LIVE, 'european_roads'))) {
    if (/^european_(road_surface_summer_[01]{6}_v[123]|bridge_surface_summer_v1)\.png$/.test(name)) pngs.push('european_roads/' + name);
  }
  return pngs.flatMap(p => [p, p + '.meta']);
}
function init() {
  const dir = path.join(PACK, 'classic');
  if (fs.existsSync(path.join(dir, 'manifest.json'))) throw Error('Classic backup already exists; refusing to replace it.');
  const bundle = JSON.parse(fs.readFileSync(MATERIALS, 'utf8'));
  const files = targets().map(relative => {
    const bytes = fs.readFileSync(safe(LIVE, relative)), target = safe(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    return { path: relative, sha256: digest(bytes) };
  });
  fs.copyFileSync(MATERIALS, path.join(dir, 'materials.snapshot.json'));
  writeJSON(path.join(dir, 'summer.json'), bundle.europeanSummer);
  writeJSON(path.join(dir, 'manifest.json'), { version: 'classic', summerSha256: jsonDigest(bundle.europeanSummer), files });
  writeJSON(path.join(PACK, 'baseline.json'), {
    materialsSnapshotSha256: digest(fs.readFileSync(MATERIALS)),
    baseSha256: jsonDigest(bundle.materials), winterSha256: jsonDigest(bundle.europeanWinter),
    files: list(LIVE).filter(p => p !== 'redesign_v3/materials.json').map(p => ({ path: p, sha256: digest(fs.readFileSync(safe(LIVE, p))) })),
  });
  fs.mkdirSync(path.join(PACK, 'sources'), { recursive: true });
  console.log(`Classic backup saved and checksummed: ${files.length} files.`);
}
function loadRaster() {
  function load(file, deps = {}) {
    const m = { exports: {} };
    new Function('module', 'exports', 'require', ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(m, m.exports, n => {
      if (!(n in deps)) throw Error('Unexpected dependency: ' + n); return deps[n];
    }); return m.exports;
  }
  return load('assets/scripts/view/TerrainGroundRaster.ts', { '../core/UrbanTerrain': load('assets/scripts/core/UrbanTerrain.ts') });
}
async function build() {
  const old = JSON.parse(fs.readFileSync(path.join(PACK, 'classic/summer.json'), 'utf8'));
  const summer = structuredClone(old), dir = path.join(PACK, 'detailed');
  fs.mkdirSync(dir, { recursive: true });
  for (const id of MATERIAL_IDS) {
    const rgb = await sharp(path.join(PACK, 'sources', id + '.png')).resize(384, 384).removeAlpha().toColourspace('srgb').raw().toBuffer();
    summer.materials[id] = { width: 384, height: 384, rgb: rgb.toString('base64') };
  }
  // The shared base and winter bundle are deliberately not rebuilt.
  const { TerrainGroundRaster, europeanCountryRoadDistance } = loadRaster(), engine = new TerrainGroundRaster(summer);
  async function png(relative, input, w = 222, h = 256) {
    const dest = safe(dir, relative); fs.mkdirSync(path.dirname(dest), { recursive: true });
    await sharp(input).resize(w, h, { fit: 'contain', background: '#00000000' }).png().toFile(dest);
  }
  async function groundPNG(a) {
    return sharp(a.pixels, { raw: { width: a.textureWidth, height: a.textureHeight, channels: 4 } }).extract({ left: 1, top: 1, width: a.textureWidth - 2, height: a.textureHeight - 2 }).png().toBuffer();
  }
  for (const terrain of ['field', 'forest', 'mud', 'road', 'water', 'deep_water']) {
    await png('terrain_' + terrain + '.png', await groundPNG(engine.renderChunk([{ pos: { q: 0, r: 0 }, terrain }], false, -42, -48, 84, 96, 2)));
  }
  for (let i = 1; i <= 4; i++) {
    const file = path.join(PACK, 'sources', `tree_0${i}.png`), meta = await sharp(file).metadata();
    if (!meta.hasAlpha) throw Error('Tree source must have true transparency: ' + file);
    await png(`redesign_v3/europe_tree_0${i}.png`, await sharp(file).trim().png().toBuffer(), 256, 256);
  }
  const classicManifest = JSON.parse(fs.readFileSync(path.join(PACK, 'classic/manifest.json'), 'utf8'));
  for (const entry of classicManifest.files) {
    const match = entry.path.match(/european_road_surface_summer_([01]{6})_v(\d)\.png$/); if (!match) continue;
    const variant = Number(match[2]) - 1, roads = [...match[1]].map(c => c === '1');
    const a = engine.renderChunk([{ pos: { q: 0, r: 0 }, terrain: 'road', roads }], false, -42, -48, 84, 96, 2, variant);
    for (let y = 0; y < a.textureHeight; y++) for (let x = 0; x < a.textureWidth; x++) {
      const gx = -42 + (x - 1 + .5) / 2, gy = -48 + (y - 1 + .5) / 2;
      const d = europeanCountryRoadDistance(roads, gx / 48, -gy / 48, variant) * 48;
      a.pixels[(y * a.textureWidth + x) * 4 + 3] = Math.round(a.pixels[(y * a.textureWidth + x) * 4 + 3] * Math.max(0, Math.min(1, (48 * .40 - d) / 2)));
    }
    await png(entry.path, await groundPNG(a));
  }
  const bridge = engine.renderChunk([{ pos: { q: 0, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] }], false, -42, -48, 84, 96, 2);
  for (let y = 0; y < bridge.textureHeight; y++) for (let x = 0; x < bridge.textureWidth; x++) {
    if (Math.abs(-48 + (y - 1 + .5) / 2) > 48 * (.205 + .028)) bridge.pixels[(y * bridge.textureWidth + x) * 4 + 3] = 0;
  }
  await png('european_roads/european_bridge_surface_summer_v1.png', await groundPNG(bridge));
  for (const entry of classicManifest.files.filter(e => e.path.endsWith('.meta'))) {
    const dest = safe(dir, entry.path); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(safe(path.join(PACK, 'classic'), entry.path), dest);
  }
  writeJSON(path.join(dir, 'summer.json'), summer);
  writeJSON(path.join(dir, 'manifest.json'), { version: 'detailed', summerSha256: jsonDigest(summer), files: classicManifest.files.map(e => ({ path: e.path, sha256: digest(fs.readFileSync(safe(dir, e.path))) })) });
  console.log('Detailed European summer pack built; live resources have not been changed.');
}
if (require.main === module) {
  Promise.resolve().then(() => process.argv[2] === 'init' ? init() : process.argv[2] === 'build' ? build() : Promise.reject(Error('Use init or build'))).catch(e => { console.error(e); process.exitCode = 1; });
}
module.exports = { loadRaster, MATERIAL_IDS };
