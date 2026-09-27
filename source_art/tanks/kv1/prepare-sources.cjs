#!/usr/bin/env node
'use strict';

// Match the measured three-view silhouette on a common 1774x887 canvas:
// reference hull 577x284 (2.03:1), reference turret+gun 340x169 (2.01:1).
// The initial hull was too narrow. Correct its outline independently, while
// keeping the turret's original aspect ratio under uniform scaling.
const path = require('path');
const sharp = require('sharp');

const here = __dirname;
const file = (name) => path.join(here, `${name}.png`);
const W = 1774;
const H = 887;
const TURRET_SCALE = 0.91;
const TURRET_PIVOT = [1050, 465];

async function visibleBounds(imagePath) {
  const { data, info } = await sharp(imagePath).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] < 32) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error(`no visible pixels: ${imagePath}`);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function damageWeight(x, y, cx, cy, rx, ry) {
  const distance = Math.hypot((x - cx) / rx, (y - cy) / ry);
  if (distance <= 0.78) return 1;
  if (distance >= 1) return 0;
  const t = (1 - distance) / 0.22;
  return t * t * (3 - 2 * t);
}

async function main() {
  const turret = await sharp(file('turret-generated')).ensureAlpha().raw().toBuffer();
  const barrel = await sharp(file('turret-generated'))
    .extract({ left: 205, top: 438, width: 340, height: 64 })
    .resize(180, 64, { fit: 'fill' }).png().toBuffer();
  for (let y = 415; y < 525; y++) {
    for (let x = 0; x < 545; x++) turret.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 4);
  }
  const rearMg = await sharp(file('turret-rear-mg-generated'))
    .extract({ left: 1376, top: 435, width: 160, height: 70 })
    .resize(105, 70, { fit: 'fill' }).png().toBuffer();
  const withGuns = await sharp(turret, { raw: { width: W, height: H, channels: 4 } })
    .composite([
      { input: barrel, left: 365, top: 438 },
      { input: rearMg, left: 1376, top: 435 },
    ]).png().toBuffer();
  const turretScaled = await sharp(withGuns)
    .resize(Math.round(W * TURRET_SCALE), Math.round(H * TURRET_SCALE),
      { fit: 'fill' }).png().toBuffer();
  await sharp({ create: { width: W, height: H, channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: turretScaled,
      left: Math.round(TURRET_PIVOT[0] * (1 - TURRET_SCALE)),
      top: Math.round(TURRET_PIVOT[1] * (1 - TURRET_SCALE)) }])
    .png().toFile(file('turret-selected'));

  const hull = await sharp(file('hull-generated'))
    .resize(W, 1019, { fit: 'fill' })
    .extract({ left: 0, top: 66, width: W, height: H })
    .png().toBuffer();
  await sharp(hull).png().toFile(file('hull-selected'));
  const selectedHull = await sharp(hull).ensureAlpha().raw().toBuffer();
  const generatedWreck = await sharp(file('destroyed-from-current-hull-generated'))
    .resize(W, H, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const selectedWreck = Buffer.from(selectedHull);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (selectedHull[o + 3] === 0) continue;
      const weight = Math.max(
        damageWeight(x, y, 900, 445, 315, 250),
        damageWeight(x, y, 1210, 305, 150, 100),
      );
      if (!weight) continue;
      for (let c = 0; c < 3; c++) {
        selectedWreck[o + c] = Math.round(
          selectedHull[o + c] * (1 - weight) + generatedWreck[o + c] * weight,
        );
      }
    }
  }
  await sharp(selectedWreck, { raw: { width: W, height: H, channels: 4 } })
    .png().toFile(file('destroyed-selected'));
  const selectedHullBounds = await visibleBounds(file('hull-selected'));
  const selectedWreckBounds = await visibleBounds(file('destroyed-selected'));
  if (JSON.stringify(selectedHullBounds) !== JSON.stringify(selectedWreckBounds)) {
    throw new Error('destroyed art must have the same visible bounds as the hull');
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
