const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');

async function main() {
  const assets = [
    ...[1, 2, 3].map(index => ({ name: `AmericanInfantry0${index}_seated_olive`, directory: 'source_art/infantry/american/seated-20261024-v4-palette' })),
    ...['Infantry', 'JapaneseInfantry'].flatMap(prefix => [1, 2, 3].map(index => ({ name: `${prefix}0${index}_seated`, directory: 'source_art/infantry/seated-20261031-all' }))),
    ...[1, 2, 3].map(index => ({ name: `SovietInfantry0${index}_seated`, directory: 'source_art/infantry/soviet-seated-20261102-v1' })),
    ...[1, 2, 3].map(index => ({ name: `SovietInfantry0${index}`, directory: 'source_art/infantry/soviet-20261102-v2', trim: true })),
  ];
  for (const { name, directory, trim = false } of assets) {
    const source = path.join(root, directory, `${name}.png`);
    const target = path.join(root, 'assets/resources/textures/units', `${name}.png`);
    const { width, height, hasAlpha } = await sharp(source).metadata();
    if (!hasAlpha) throw new Error(`${source} must have alpha`);
    let x = 0, y = 0, w = width, h = height;
    if (trim) {
      // Standing figures use their visible bounds for the battlefield's fit size.
      const pixels = await sharp(source).ensureAlpha().raw().toBuffer();
      let left = width, top = height, right = -1, bottom = -1;
      for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
        if (pixels[(py * width + px) * 4 + 3] <= 8) continue;
        left = Math.min(left, px); top = Math.min(top, py);
        right = Math.max(right, px); bottom = Math.max(bottom, py);
      }
      if (right < left) throw new Error(`${source} is empty`);
      x = left; y = top; w = right - left + 1; h = bottom - top + 1;
    }
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
        // Seated figures retain the full canvas because the hip anchor is authored there.
        Object.assign(sub.userData, { trimType: trim ? 'auto' : 'none', trimThreshold: trim ? 8 : 1,
          trimX: x, trimY: y, offsetX: x + w/2 - width/2, offsetY: height/2 - y - h/2,
          width: w, height: h, rawWidth: width, rawHeight: height, packable: false });
        sub.userData.vertices = {
          rawPosition: [-w/2,-h/2,0,w/2,-h/2,0,-w/2,h/2,0,w/2,h/2,0],
          indexes: [0,1,2,2,1,3], uv: [x,y+h,x+w,y+h,x,y,x+w,y],
          nuv: [x/width,1-(y+h)/height,(x+w)/width,1-(y+h)/height,x/width,1-y/height,(x+w)/width,1-y/height],
          minPos: [-w/2,-h/2,0], maxPos: [w/2,h/2,0],
        };
      }
    }
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    console.log(`${name}: ${width}x${height}, ${trim ? `bounds ${w}x${h}` : 'untrimmed'}`);
  }
  for (const file of ['core/TankRiding', 'view/TankRiderVisual', 'view/TankRiderRenderer']) {
    const metaPath = path.join(root, 'assets/scripts', `${file}.ts.meta`);
    if (!fs.existsSync(metaPath)) fs.writeFileSync(metaPath, JSON.stringify({
      ver: '4.0.24', importer: 'typescript', imported: true, uuid: crypto.randomUUID(), files: [], subMetas: {}, userData: {},
    }, null, 2) + '\n');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
