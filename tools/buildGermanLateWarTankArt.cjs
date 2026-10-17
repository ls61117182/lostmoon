'use strict';

// Apply the approved ImageGen paint map to the existing source pixels. Geometry,
// alpha, linework and source shading remain authoritative; grey files are read only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { decodeTable, chooseParsedRows, withoutLocalizedDescriptionRow } = require('./csvSmart');
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'source_art/tanks/german-late-war');
const UNITS = path.join(ROOT, 'assets/resources/textures/units');
const DEST = path.join(UNITS, 'late_war');
const PALETTE = [[182, 161, 109], [98, 109, 67], [128, 86, 70]];
const lum = (p, i) => p[i] * .2126 + p[i + 1] * .7152 + p[i + 2] * .0722;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const reflect = n => { const v = ((n % 2) + 2) % 2; return v > 1 ? 2 - v : v; };
function records(file) {
  const rows = withoutLocalizedDescriptionRow(chooseParsedRows(decodeTable(path.join(ROOT, file)).text).rows);
  const headers = rows[0].map(s => s.replace(/^\uFEFF/, '').trim());
  return rows.slice(1).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
}
function freshMeta(source, dest) {
  const original = JSON.parse(fs.readFileSync(source, 'utf8'));
  const uuid = fs.existsSync(dest) ? JSON.parse(fs.readFileSync(dest, 'utf8')).uuid : crypto.randomUUID();
  fs.writeFileSync(dest, JSON.stringify(JSON.parse(JSON.stringify(original).split(original.uuid).join(uuid)), null, 2) + '\n');
}
async function raw(file) {
  return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
function alphaHash(image) {
  return sha(Buffer.from(Array.from({ length: image.info.width * image.info.height }, (_, i) => image.data[i * 4 + 3])));
}
// Locate the hull in the existing flattened top sprite. Existing legacy top
// canvases use different margins; do not resize them or regenerate their shapes.
function hullOffset(top, hull) {
  let best = { x: 0, y: 0, score: -Infinity };
  for (let y = 0; y <= top.info.height - hull.info.height; y++) {
    for (let x = 0; x <= top.info.width - hull.info.width; x++) {
      let score = 0;
      for (let hy = 1; hy < hull.info.height; hy += 3) {
        for (let hx = 1; hx < hull.info.width; hx += 3) {
          const a = (hy * hull.info.width + hx) * 4;
          if (hull.data[a + 3] < 220) continue;
          const b = ((hy + y) * top.info.width + hx + x) * 4;
          const error = Math.abs(hull.data[a] - top.data[b]) + Math.abs(hull.data[a + 1] - top.data[b + 1]) + Math.abs(hull.data[a + 2] - top.data[b + 2]);
          score += top.data[b + 3] > 220 ? (error < 4 ? 3 : -Math.min(3, error / 80)) : -4;
        }
      }
      if (score > best.score) best = { x, y, score };
    }
  }
  return best;
}
async function main() {
  fs.mkdirSync(DEST, { recursive: true });
  const folderMeta = `${DEST}.meta`;
  if (!fs.existsSync(folderMeta)) fs.writeFileSync(folderMeta, JSON.stringify({ ver: '1.2.0', importer: 'directory', imported: true, uuid: crypto.randomUUID(), files: [], subMetas: {}, userData: {} }, null, 2) + '\n');
  const unitRows = records('data/units.csv');
  const german = new Set(unitRows.filter(r => r.faction === 'german' && r.damageTargetClass === 'german_tank').map(r => r.unitKind));
  const models = records('data/tank_visuals.csv').filter(r => german.has(r.kind));
  const master = await raw(path.join(SOURCE, 'camouflage-master.png'));
  const colourAt = (x, y, seed) => {
    let u = x, v = y;
    if (seed & 1) u = 1 - u;
    if (seed & 2) v = 1 - v;
    if (seed & 4) [u, v] = [v, u];
    const mx = Math.min(master.info.width - 1, Math.floor(reflect(u * .92 + (seed % 5) * .025) * master.info.width));
    const my = Math.min(master.info.height - 1, Math.floor(reflect(v * .92 + (seed % 3) * .03) * master.info.height));
    const index = (my * master.info.width + mx) * 4;
    let best = 0, distance = Infinity;
    PALETTE.forEach((c, k) => {
      const d = c.reduce((s, n, j) => s + (n - master.data[index + j]) ** 2, 0);
      if (d < distance) { best = k; distance = d; }
    });
    return PALETTE[best];
  };
  const report = { version: 1, scheme: 'late_war', palette: PALETTE, paintMasterSha256: sha(fs.readFileSync(path.join(SOURCE, 'camouflage-master.png'))), models: [] };
  for (const row of models) {
    const kind = row.kind, seed = [...kind].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 0);
    const files = [];
    for (const role of ['top', 'hull', 'turret', 'destroyed']) {
      const resource = row[`${role}SpritePath`];
      if (!resource) continue;
      const name = resource.split('/').at(-2) + '.png';
      files.push({ role, name, image: await raw(path.join(UNITS, name)) });
    }
    const top = files.find(f => f.role === 'top').image;
    const hull = (files.find(f => f.role === 'hull') ?? files.find(f => f.role === 'top')).image;
    const offset = row.hullSpritePath ? hullOffset(top, hull) : { x: 0, y: 0 };
    const values = files.filter(f => row.hullSpritePath ? f.role === 'hull' || f.role === 'turret' : f.role === 'top')
      .flatMap(f => Array.from({ length: f.image.data.length / 4 }, (_, p) => f.image.data[p * 4 + 3] > 220 ? lum(f.image.data, p * 4) : 0)).filter(l => l > 65).sort((a, b) => a - b);
    const mid = values[Math.floor(values.length * .55)] || 106;
    const model = { kind, sourceMid: mid, flattenedHullOffset: offset, files: [] };
    for (const { role, name, image } of files) {
      const source = path.join(UNITS, name), dest = path.join(DEST, name), pixels = Buffer.from(image.data);
      const greyHash = sha(fs.readFileSync(source)), greyMetaHash = sha(fs.readFileSync(`${source}.meta`));
      for (let y = 0; y < image.info.height; y++) {
        for (let x = 0; x < image.info.width; x++) {
          const i = (y * image.info.width + x) * 4;
          if (!pixels[i + 3]) continue;
          let hx = x, hy = y;
          if (role === 'top') { hx -= offset.x; hy -= offset.y; }
          if (role === 'turret') {
            hx = +row.turretPivotX + (x - +row.turretSpritePivotX) * +row.turretScale;
            hy = +row.turretPivotY + (y - +row.turretSpritePivotY) * +row.turretScale;
          }
          const colour = colourAt(hx / hull.info.width, hy / hull.info.height, seed);
          const light = lum(image.data, i), weight = clamp((light - 34) / 32, 0, 1);
          const shade = clamp(Math.pow(light / mid, 1.08), .18, 1.5);
          for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(clamp(image.data[i + c] * (1 - weight) + colour[c] * shade * weight, 0, 255));
        }
      }
      await sharp(pixels, { raw: image.info }).png().toFile(dest);
      freshMeta(`${source}.meta`, `${dest}.meta`);
      const output = await raw(dest);
      if (alphaHash(output) !== alphaHash(image)) throw Error(`${name}: alpha changed`);
      if (sha(fs.readFileSync(source)) !== greyHash || sha(fs.readFileSync(`${source}.meta`)) !== greyMetaHash) throw Error(`${name}: grey resource changed`);
      model.files.push({ role, name, width: image.info.width, height: image.info.height, greySha256: greyHash, greyMetaSha256: greyMetaHash, alphaSha256: alphaHash(image), lateWarSha256: sha(fs.readFileSync(dest)) });
    }
    report.models.push(model);
  }
  fs.writeFileSync(path.join(SOURCE, 'asset-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Built ${models.length} German tank skins, ${report.models.reduce((s, m) => s + m.files.length, 0)} PNGs; original grey assets untouched; alpha and dimensions preserved.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
