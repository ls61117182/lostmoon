// Register simplified art to the approved runtime geometry without changing alpha,
// pivots, hatch scale or footprint. Run before tank:prepare for t34 and t34_85.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { chooseParsedRows, decodeTable } = require('./csvSmart');
const root = path.resolve(__dirname, '..');
const rows = chooseParsedRows(decodeTable(path.join(root, 'source_art/tanks/t34/simplified/before-tank_visuals.csv')).text, []).rows;
const headers = rows[0];
function bounds(data, width, height) {
  let l = width, t = height, r = -1, b = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] >= 32) {
    l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x); b = Math.max(b, y);
  }
  if (r < l) throw Error('No foreground');
  return { left: l, top: t, width: r - l + 1, height: b - t + 1 };
}
async function register(kind, role, reference, directory = 'simplified') {
  const dir = path.join(root, 'source_art/tanks', kind, directory);
  const old = await sharp(path.join(dir, reference)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const target = bounds(old.data, old.info.width, old.info.height);
  const gen = await sharp(path.join(dir, `${role}-generated.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < gen.data.length; i += 4) {
    if (gen.data[i + 1] > gen.data[i] + 35 && gen.data[i + 1] > gen.data[i + 2] + 35) gen.data.fill(0, i, i + 4);
  }
  const box = bounds(gen.data, gen.info.width, gen.info.height);
  // Resample paint into the locked destination silhouette. This never changes
  // the approved alpha geometry or scales hull/turret independently at runtime.
  const hires = await sharp(gen.data, { raw: gen.info }).extract(box)
    .resize(target.width * 3, target.height * 3, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = hires.info;
  const source = Buffer.from(hires.data);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    let darkest = 256;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = (yy * w + xx) * 4;
      if (source[j + 3] > 200) darkest = Math.min(darkest, Math.max(source[j], source[j + 1], source[j + 2]));
    }
    if (darkest < 45 && source[o + 3] > 32) for (let c = 0; c < 3; c++) hires.data[o + c] = Math.min(source[o + c], Math.round(darkest + (source[o + c] - darkest) * 0.25));
  }
  const small = await sharp(hires.data, { raw: hires.info }).resize(target.width, target.height).ensureAlpha().raw().toBuffer();
  // Extend nearest foreground color across tiny registration gaps; never bring
  // back old textured detail or green-screen pixels at the locked outer edge.
  const queue = [], seen = new Uint8Array(target.width * target.height);
  for (let i = 0; i < seen.length; i++) if (small[i * 4 + 3] > 100) { seen[i] = 1; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const p = queue[q], x = p % target.width, y = Math.floor(p / target.width);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const xx = x + dx, yy = y + dy, n = yy * target.width + xx;
      if (xx < 0 || yy < 0 || xx >= target.width || yy >= target.height || seen[n]) continue;
      small.copy(small, n * 4, p * 4, p * 4 + 3); seen[n] = 1; queue.push(n);
    }
  }
  const result = Buffer.alloc(old.data.length);
  for (let y = 0; y < old.info.height; y++) for (let x = 0; x < old.info.width; x++) {
    const o = (y * old.info.width + x) * 4;
    result[o + 3] = old.data[o + 3];
    if (!old.data[o + 3]) continue;
    const xx = Math.max(0, Math.min(target.width - 1, x - target.left));
    const yy = Math.max(0, Math.min(target.height - 1, y - target.top));
    small.copy(result, o, (yy * target.width + xx) * 4, (yy * target.width + xx) * 4 + 3);
    const max = Math.max(result[o], result[o + 1], result[o + 2]);
    const min = Math.min(result[o], result[o + 1], result[o + 2]);
    const weight = Math.min(1, (max - min) / 20) * Math.max(0, Math.min(1, (max - 25) / 30));
    result[o] = Math.round(result[o] * (1 - (kind === 't34' ? 0.18 : 0.06) * weight));
    let edge = false;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= old.info.width || ny >= old.info.height || old.data[(ny * old.info.width + nx) * 4 + 3] < 32) edge = true;
    }
    if (edge) { result[o] = 22; result[o + 1] = 28; result[o + 2] = 18; }
  }
  await sharp(result, { raw: old.info }).png().toFile(path.join(dir, `${role}-source.png`));
  return target;
}
module.exports = { register };
if (require.main === module) (async () => {
  for (const kind of ['t34', 't34_85']) {
    const hull = await register(kind, 'hull', 'before-top_hull.png');
    const turret = await register(kind, 'turret', 'before-top_turret.png');
    await register(kind, 'destroyed', 'before-top_hull.png');
    const row = rows.find(r => r[0] === kind);
    const n = name => Number(row[headers.indexOf(name)]);
    const manifest = {
      $schema: './tank-art-manifest.schema.json', schemaVersion: 1, kind,
      notes: 'Simplified bold-line Soviet-green art. Locked approved pixel geometry and alpha; coarse local wreck damage. High-resolution selected edits and registration script retained.',
      inputs: Object.fromEntries(['hull', 'turret', 'destroyed'].map(role => [role, { path: `source_art/tanks/${kind}/simplified/${role}-source.png`, background: 'alpha' }])),
      processing: { alphaThreshold: 32, commonScale: 1, outlinePixels: 0,
        hullPadding: [hull.left, hull.top, n('topTrimW') - hull.left - hull.width, n('topTrimH') - hull.top - hull.height],
        turretPadding: [turret.left, turret.top, n('turretTrimW') - turret.left - turret.width, n('turretTrimH') - turret.top - turret.height] },
      sourceGeometry: { hullPivot: [n('turretPivotX'), n('turretPivotY')], turretPivot: [n('turretSpritePivotX'), n('turretSpritePivotY')], muzzle: [n('muzzleSpriteX'), n('muzzleSpriteY')], commanderHatch: [n('commanderHatchSpriteX'), n('commanderHatchSpriteY')] },
    };
    fs.writeFileSync(path.join(root, 'data/tank_art', `${kind}.json`), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`${kind}: registered simplified sources with original alpha and configured pivots.`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
