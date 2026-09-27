#!/usr/bin/env node
'use strict';

const path = require('node:path');
const sharp = require('sharp');

const DIR = __dirname;
const ALPHA_THRESHOLD = 32;

async function bounds(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] < ALPHA_THRESHOLD) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error(`${file} is empty`);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function normalize(input, output, crop, width, height, rotate = false) {
  let pipeline = sharp(input).extract(crop);
  if (rotate) pipeline = pipeline.rotate(180);
  await pipeline.resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha().png().toFile(output);
}

async function main() {
  const hull = path.join(DIR, 'hull-generated.png');
  const turret = path.join(DIR, 'turret-generated.png');
  const wreck = path.join(DIR, 'destroyed-generated.png');
  const hullCrop = await bounds(hull);
  await normalize(hull, path.join(DIR, 'hull-source.png'), hullCrop, 250, 95);
  await normalize(turret, path.join(DIR, 'turret-source.png'), await bounds(turret), 240, 85, true);
  const wreckPath = path.join(DIR, 'destroyed-source.png');
  await normalize(wreck, wreckPath, hullCrop, 250, 95);

  // The wreck must use the precise surviving hull silhouette and canvas.
  const hullRaw = await sharp(path.join(DIR, 'hull-source.png')).raw().toBuffer();
  const wreckRaw = await sharp(wreckPath).raw().toBuffer();
  for (let offset = 0; offset < hullRaw.length; offset += 4) {
    wreckRaw[offset + 3] = hullRaw[offset + 3];
    if (wreckRaw[offset + 3] < 8) wreckRaw.fill(0, offset, offset + 4);
  }
  await sharp(wreckRaw, { raw: { width: 250, height: 95, channels: 4 } }).png().toFile(path.join(DIR, 'destroyed-aligned.png'));
  console.log('Prepared Maus source layers: hull 250x95, turret 240x85, wreck 250x95');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
