const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { PACK, LIVE, MATERIALS, ART_VERSIONS, readPack, digest, jsonDigest, safe } = require('../tools/switchEuropeanTerrainArt.cjs');
const { loadRaster, MATERIAL_IDS } = require('../tools/buildEuropeanTerrainV6.cjs');
async function main() {
  const classic = readPack('classic'), detailed = readPack('detailed');
  assert.equal(classic.files.length, 100); assert.equal(detailed.files.length, 100);
  const baseline = JSON.parse(fs.readFileSync(path.join(PACK, 'baseline.json'), 'utf8'));
  const bundle = JSON.parse(fs.readFileSync(MATERIALS, 'utf8'));
  assert.equal(jsonDigest(bundle.materials), baseline.baseSha256, 'base/Pacific/urban materials preserved');
  assert.equal(jsonDigest(bundle.europeanWinter), baseline.winterSha256, 'winter materials preserved');
  const changed = new Set(classic.files.map(f => f.path));
  let preserved = 0;
  for (const file of baseline.files) if (!changed.has(file.path)) {
    assert.equal(digest(fs.readFileSync(safe(LIVE, file.path))), file.sha256, file.path + ' remains unchanged'); preserved++;
  }
  const active = ART_VERSIONS.filter(v=>fs.existsSync(path.join(PACK,v,'manifest.json'))).map(readPack).find(p => p.manifest.summerSha256 === jsonDigest(bundle.europeanSummer));
  assert(active, 'current summer is one of the two preserved versions');
  for (const entry of active.files) assert.equal(digest(fs.readFileSync(safe(LIVE, entry.path))), entry.sha256, 'active ground and tree versions agree: ' + entry.path);
  for (const id of MATERIAL_IDS) {
    const m = detailed.summer.materials[id]; assert.equal(m.width, 384); assert.equal(m.height, 384);
    assert.equal(Buffer.from(m.rgb, 'base64').length, 384 * 384 * 3);
  }
  for (const entry of detailed.files.filter(e => e.path.endsWith('.meta'))) {
    assert.equal(entry.sha256, classic.manifest.files.find(f => f.path === entry.path).sha256, 'UUID/import metadata retained');
  }
  for (let i = 1; i <= 4; i++) {
    const file = path.join(PACK, `detailed/redesign_v3/europe_tree_0${i}.png`), m = await sharp(file).metadata();
    assert.equal(m.width, 256); assert.equal(m.height, 256); assert(m.hasAlpha);
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 0, 'tree corner transparent');
    let visible = 0, clear = 0;
    for (let j = 3; j < data.length; j += info.channels) { if (data[j] > 200) visible++; if (data[j] === 0) clear++; }
    assert(visible > 20000 && clear > 3000, 'canopy occupies the sprite without a solid background');
  }
  const engine = new (loadRaster().TerrainGroundRaster)(detailed.summer), tiles = [];
  for (let r = -2; r < 5; r++) for (let q = -2; q < 6; q++) tiles.push({ pos: { q, r }, terrain: q === 0 ? 'water' : q === 1 ? 'mud' : q === 2 ? 'forest' : 'field', ...(r === 1 ? { roads: [true,false,false,true,false,false] } : {}) });
  let maximum = 0;
  for (const resolution of [1, 2]) for (const horizontal of [true, false]) {
    const a = engine.renderChunk(tiles, false, 0, 0, 128, 128, resolution), b = engine.renderChunk(tiles, false, horizontal ? 128 : 0, horizontal ? 0 : 128, 128, 128, resolution);
    for (let p = 0; p < a.textureWidth; p++) for (let s = 0; s < 2; s++) for (let k = 0; k < 4; k++) {
      const from = horizontal ? (p * a.textureWidth + 128 * resolution + s) * 4 + k : ((128 * resolution + s) * a.textureWidth + p) * 4 + k;
      const to = horizontal ? (p * b.textureWidth + s) * 4 + k : (s * b.textureWidth + p) * 4 + k;
      maximum = Math.max(maximum, Math.abs(a.pixels[from] - b.pixels[to]));
    }
  }
  assert(maximum <= 1, 'detailed materials, water and roads remain continuous across chunk seams');
  console.log(`European art versions: both packs valid, ${preserved} unrelated files preserved, UUIDs and alpha valid; maximum seam error ${maximum}.`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
