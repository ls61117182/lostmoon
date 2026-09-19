const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const urban = path.join(root, 'assets/resources/textures/terrain/urban');
const imageTemplate = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/textures/terrain/terrain_road.png.meta'), 'utf8'));
const stableUuid = key => {
  const h = crypto.createHash('sha256').update(`sherman-urban:${key}`).digest('hex').slice(0, 32);
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20)}`;
};
async function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { await walk(full); continue; }
    if (!entry.name.endsWith('.png') || fs.existsSync(full + '.meta')) continue;
    const rel = path.relative(root, full).replaceAll('\\', '/');
    const name = path.basename(entry.name, '.png');
    const uuid = stableUuid(rel);
    const meta = JSON.parse(JSON.stringify(imageTemplate).replaceAll(imageTemplate.uuid, uuid).replaceAll('terrain_road', name));
    const dimensions = await sharp(full).metadata();
    const frame = meta.subMetas.f9941.userData;
    frame.width = frame.rawWidth = dimensions.width;
    frame.height = frame.rawHeight = dimensions.height;
    frame.trimX = frame.trimY = 0;
    frame.trimType = 'none';
    frame.packable = false;
    frame.vertices.rawPosition = [-dimensions.width/2,-dimensions.height/2,0, dimensions.width/2,-dimensions.height/2,0, -dimensions.width/2,dimensions.height/2,0, dimensions.width/2,dimensions.height/2,0];
    frame.vertices.uv = [0,dimensions.height, dimensions.width,dimensions.height, 0,0, dimensions.width,0];
    frame.vertices.maxPos = [dimensions.width/2,dimensions.height/2,0];
    frame.vertices.minPos = [-dimensions.width/2,-dimensions.height/2,0];
    fs.writeFileSync(full + '.meta', JSON.stringify(meta, null, 2) + '\n');
  }
}
function ensureDirectoryMeta(dir) {
  if (fs.existsSync(dir + '.meta')) return;
  const rel = path.relative(root, dir).replaceAll('\\', '/');
  fs.writeFileSync(dir + '.meta', JSON.stringify({
    ver: '1.2.0', importer: 'directory', imported: true, uuid: stableUuid(rel), files: [], subMetas: {}, userData: {},
  }, null, 2) + '\n');
}
(async () => {
  ensureDirectoryMeta(urban);
  ensureDirectoryMeta(path.join(urban, 'roads'));
  await walk(urban);
  const script = path.join(root, 'assets/scripts/core/UrbanTerrain.ts');
  if (!fs.existsSync(script + '.meta')) {
    fs.writeFileSync(script + '.meta', JSON.stringify({
      ver: '4.0.24', importer: 'typescript', imported: true,
      uuid: stableUuid('assets/scripts/core/UrbanTerrain.ts'), files: [], subMetas: {}, userData: {},
    }, null, 2) + '\n');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
