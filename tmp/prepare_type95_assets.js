const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const root = process.cwd();
const unitsDir = path.join(root, 'assets', 'resources', 'textures', 'units');

const assets = [
  { name: 'type95_top_hull', source: 'output/imagegen/type95_hull_no_turret.png', bbox: [31, 21, 1705, 879], template: 'type97_top_hull.png.meta' },
  { name: 'type95_top_turret', source: 'output/imagegen/type95_turret_v2.png', bbox: [67, 86, 1393, 809], template: 'type97_top_turret.png.meta' },
  { name: 'type95_top_destroyed', source: 'output/imagegen/type95_destroyed.png', bbox: [36, 25, 1720, 879], template: 'type97_top_destroyed.png.meta' },
];

function replaceStrings(value, oldUuid, newUuid, oldName, newName) {
  if (typeof value === 'string') return value.replaceAll(oldUuid, newUuid).replaceAll(oldName, newName);
  if (Array.isArray(value)) return value.map(v => replaceStrings(v, oldUuid, newUuid, oldName, newName));
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) value[key] = replaceStrings(value[key], oldUuid, newUuid, oldName, newName);
  }
  return value;
}

(async () => {
  for (const asset of assets) {
    const [left, top, right, bottom] = asset.bbox;
    const width = right - left;
    const height = bottom - top;
    const dest = path.join(unitsDir, `${asset.name}.png`);
    await sharp(path.join(root, asset.source)).extract({ left, top, width, height }).png().toFile(dest);

    const templatePath = path.join(unitsDir, asset.template);
    const meta = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    const oldUuid = meta.uuid;
    const oldName = meta.subMetas.f9941.displayName;
    const uuid = crypto.randomUUID();
    replaceStrings(meta, oldUuid, uuid, oldName, asset.name);

    const frame = meta.subMetas.f9941.userData;
    frame.offsetX = 0;
    frame.offsetY = 0;
    frame.trimX = 0;
    frame.trimY = 0;
    frame.width = width;
    frame.height = height;
    frame.rawWidth = width;
    frame.rawHeight = height;
    frame.trimType = 'none';
    frame.vertices.rawPosition = [-width / 2, -height / 2, 0, width / 2, -height / 2, 0, -width / 2, height / 2, 0, width / 2, height / 2, 0];
    frame.vertices.uv = [0, height, width, height, 0, 0, width, 0];
    frame.vertices.nuv = [0, 0, 1, 0, 0, 1, 1, 1];
    frame.vertices.minPos = [-width / 2, -height / 2, 0];
    frame.vertices.maxPos = [width / 2, height / 2, 0];
    meta.userData.fixAlphaTransparencyArtifacts = true;
    fs.writeFileSync(`${dest}.meta`, `${JSON.stringify(meta, null, 2)}\n`);
    console.log(`${asset.name}: ${width}x${height} ${uuid}`);
  }
})().catch(err => { console.error(err); process.exit(1); });
