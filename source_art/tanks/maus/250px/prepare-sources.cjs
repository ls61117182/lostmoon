#!/usr/bin/env node
'use strict';

const path = require('node:path');
const sharp = require('sharp');

const DIR = __dirname;
const ALPHA_THRESHOLD = 32;
const HULL_WIDTH = 250;
const HULL_CANVAS_HEIGHT = 95;

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

async function normalizeUniform(input, output, crop, scale) {
  const width = Math.round(crop.width * scale);
  const height = Math.round(crop.height * scale);
  let pipeline = sharp(input).extract(crop)
    .resize(width, height, { kernel: sharp.kernel.lanczos3 });
  {
    const verticalMargin = HULL_CANVAS_HEIGHT - height;
    if (verticalMargin < 0) throw new Error('source exceeds canvas height: ' + height);
    pipeline = pipeline.extend({
      top: Math.floor(verticalMargin / 2),
      bottom: Math.ceil(verticalMargin / 2),
      left: 0,
      right: 0,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }
  await pipeline.ensureAlpha().png().toFile(output);
  return { width, height };
}

async function main() {
  const hull = path.join(DIR, 'hull-round-generated.png');
  const wreck = path.join(DIR, 'destroyed-round-generated.png');
  const hullCrop = await bounds(hull);
  const scale = HULL_WIDTH / hullCrop.width;
  const hullSize = await normalizeUniform(hull, path.join(DIR, 'hull-source.png'), hullCrop, scale);
  const wreckPath = path.join(DIR, 'destroyed-source.png');
  await normalizeUniform(wreck, wreckPath, hullCrop, scale);

  // Damage affects RGB only; the wreck retains the exact normal-hull silhouette.
  const hullRaw = await sharp(path.join(DIR, 'hull-source.png')).raw().toBuffer();
  const wreckRaw = await sharp(wreckPath).raw().toBuffer();
  for (let offset = 0; offset < hullRaw.length; offset += 4) {
    wreckRaw[offset + 3] = hullRaw[offset + 3];
    if (wreckRaw[offset + 3] < 8) wreckRaw.fill(0, offset, offset + 4);
  }
  await sharp(wreckRaw, { raw: { width: HULL_WIDTH, height: HULL_CANVAS_HEIGHT, channels: 4 } })
    .png().toFile(path.join(DIR, 'destroyed-aligned.png'));
  console.log('Uniform Maus hull scale=' + scale.toFixed(6) + ' content=' + HULL_WIDTH + 'x' + hullSize.height + ' in ' + HULL_WIDTH + 'x' + HULL_CANVAS_HEIGHT + ' canvas');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
