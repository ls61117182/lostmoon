const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');

async function main() {
  const assets = [
    ...[1, 2, 3].map(index => ({ name: `AmericanInfantry0${index}_seated_olive`, directory: 'source_art/infantry/american/seated-20261024-v4-palette' })),
    ...['Infantry', 'JapaneseInfantry'].flatMap(prefix => [1, 2, 3].map(index => ({ name: `${prefix}0${index}_seated`, directory: 'source_art/infantry/seated-20261031-all' }))),
  ];
  for (const { name, directory } of assets) {
    const source = path.join(root, directory, `${name}.png`);
    const target = path.join(root, 'assets/resources/textures/units', `${name}.png`);
    const { width, height, hasAlpha } = await sharp(source).metadata();
    if (!hasAlpha) throw new Error(`${source} must have alpha`);
    fs.copyFileSync(source, target);
    const metaPath = `${target}.meta`;
    const template = fs.existsSync(metaPath) ? metaPath : path.join(root, 'assets/resources/textures/units/AmericanInfantry01.png.meta');
    let meta = JSON.parse(fs.readFileSync(template, 'utf8'));
    const uuid = fs.existsSync(metaPath) ? meta.uuid : crypto.randomUUID();
    meta = JSON.parse(JSON.stringify(meta).replaceAll(meta.uuid, uuid));
    for (const sub of Object.values(meta.subMetas)) {
      sub.displayName = name;
      // Average large color blocks when reducing; retain pixel edges when enlarged.
      if (sub.importer === 'texture') Object.assign(sub.userData, { minfilter: 'linear', magfilter: 'nearest' });
      if (sub.importer === 'sprite-frame') {
        // Keep the original canvas: the seat anchor is measured at its hips.
        Object.assign(sub.userData, { trimType: 'none', trimX: 0, trimY: 0, offsetX: 0, offsetY: 0,
          width, height, rawWidth: width, rawHeight: height, packable: false });
        sub.userData.vertices = {
          rawPosition: [-width/2,-height/2,0,width/2,-height/2,0,-width/2,height/2,0,width/2,height/2,0],
          indexes: [0,1,2,2,1,3], uv: [0,height,width,height,0,0,width,0],
          nuv: [0,0,1,0,0,1,1,1], minPos: [-width/2,-height/2,0], maxPos: [width/2,height/2,0],
        };
      }
    }
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    console.log(`${name}: ${width}x${height}, untrimmed`);
  }
  for (const file of ['core/TankRiding', 'view/TankRiderVisual', 'view/TankRiderRenderer']) {
    const metaPath = path.join(root, 'assets/scripts', `${file}.ts.meta`);
    if (!fs.existsSync(metaPath)) fs.writeFileSync(metaPath, JSON.stringify({
      ver: '4.0.24', importer: 'typescript', imported: true, uuid: crypto.randomUUID(), files: [], subMetas: {}, userData: {},
    }, null, 2) + '\n');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
