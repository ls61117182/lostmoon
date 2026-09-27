#!/usr/bin/env node
'use strict';

// Register the independently generated layers to one overhead geometry.
// All coordinates below refer to the 1774x887 generated source canvases.
const path = require('path');
const sharp = require('sharp');

const dir = __dirname;
const W = 2000;
const H = 887;
const source = (name) => path.join(dir, `${name}.png`);

async function placed(input, left, top, output) {
  await sharp({ create: { width: W, height: H, channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: source(input), left, top }])
    .png().toFile(source(output));
}

function damageWeight(x, y, cx, cy, rx, ry) {
  const distance = Math.hypot((x - cx) / rx, (y - cy) / ry);
  if (distance <= 0.82) return 1;
  if (distance >= 1) return 0;
  const t = (1 - distance) / 0.18;
  return t * t * (3 - 2 * t);
}

async function main() {
  await placed('hull-generated', 200, 0, 'hull-selected');
  // The corrected turret excludes the stationary outer ring strips. Bring its
  // hatch and mantlet back to the original source coordinates before splitting.
  const correctedTurret = await sharp(source('turret-correction-generated'))
    .resize(1668, 834, { fit: 'fill' }).png().toBuffer();
  const registeredTurret = await sharp({ create: { width: 1774, height: H,
    channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: correctedTurret, left: 80, top: 47 }])
    .png().toBuffer();
  const alignedTurret = await sharp(registeredTurret)
    .extract({ left: 175, top: 0, width: 1599, height: H }).png().toBuffer();
  await sharp({ create: { width: W, height: H, channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: alignedTurret, left: 0, top: 0 }])
    .png().toFile(source('turret-selected'));

  const hull = await sharp(source('hull-selected')).raw().toBuffer();
  const wreck = await sharp(source('destroyed-generated')).ensureAlpha().raw().toBuffer();
  const result = Buffer.from(hull);
  // Damage alone is transferred; original hull silhouette and untouched paint stay exact.
  for (let y = 0; y < H; y++) for (let x = 200; x < 1974; x++) {
    const o = (y * W + x) * 4;
    if (!hull[o + 3]) continue;
    const wx = x - 200;
    const wo = (y * 1774 + wx) * 4;
    const weight = Math.max(
      damageWeight(wx, y, 920, 445, 305, 235),
      damageWeight(wx, y, 1240, 270, 125, 90),
    );
    if (!weight) continue;
    for (let c = 0; c < 3; c++) {
      result[o + c] = Math.round(hull[o + c] * (1 - weight) + wreck[wo + c] * weight);
    }
  }
  await sharp(result, { raw: { width: W, height: H, channels: 4 } })
    .png().toFile(source('destroyed-selected'));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
