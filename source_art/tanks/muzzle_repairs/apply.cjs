#!/usr/bin/env node
'use strict';

// Transfer only the corrected muzzle-brake paint into the original artwork.
// The image generator supplies the new metal shading; everything outside the
// small masks below remains byte-for-byte identical at the pixel level.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '../../..');
const file = (name) => path.join(root, name);
const local = (name) => path.join(__dirname, name);

async function raw(p) {
  return sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function save(p, data, info) {
  await sharp(data, { raw: info }).png().toFile(`${p}.new`);
  fs.renameSync(`${p}.new`, p);
}

function remember(p) {
  const before = local(`before-${path.basename(p)}`);
  if (!fs.existsSync(before)) fs.copyFileSync(p, before);
  return before;
}

function copyPatch(target, donor, x, y, donorX, donorY, fillAlpha = false) {
  const a = (y * target.info.width + x) * 4;
  const b = (donorY * donor.info.width + donorX) * 4;
  if (donor.data[b + 3] < 32) return;
  // A near-white donor pixel is background, never part of the tank's steel.
  if (donor.data[b] > 225 && donor.data[b + 1] > 225 && donor.data[b + 2] > 225) return;
  if (!fillAlpha && target.data[a + 3] < 32) return;
  for (let c = 0; c < 3; c++) target.data[a + c] = donor.data[b + c];
  if (fillAlpha) target.data[a + 3] = 255;
}

async function main() {
  // Panzer IV: remove two top-facing dark panels on the high-resolution source.
  const panzerPath = file('source_art/tanks/panzer4g/turret-selected.png');
  const panzer = await raw(remember(panzerPath));
  const panzerDonor = await sharp(local('panzer4-corrected-generated.png'))
    .resize(160, 145, { fit: 'fill' }).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  for (const [x0, x1, y0, y1] of [[15, 42, 200, 238], [51, 80, 198, 237]]) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      copyPatch(panzer, panzerDonor, x, y, x, y - 145);
    }
  }
  await save(panzerPath, panzer.data, panzer.info);

  // StuG III: close only the enclosed top holes and their dark inset rims.
  const stugSourcePath = file('source_art/tanks/stug3g/top-selected.png');
  const stugSource = await raw(remember(stugSourcePath));
  const stugDonor = await sharp(local('stug3-corrected-generated.png'))
    .resize(190, 160, { fit: 'fill' }).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const holes = [[43, 63, 484, 508], [96, 101, 489, 502], [112, 114, 494, 497]];
  for (const [x0, x1, y0, y1] of [[39, 67, 480, 512], [93, 104, 486, 505], [109, 117, 491, 500]]) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const enclosed = holes.some(([a, b, c, d]) => x >= a && x <= b && y >= c && y <= d);
      copyPatch(stugSource, stugDonor, x, y, x, y - 420,
        enclosed && stugSource.data[(y * stugSource.info.width + x) * 4 + 3] < 64);
    }
  }
  await save(stugSourcePath, stugSource.data, stugSource.info);

  // Panther: the only surviving source is the game sprite. Repaint its 2x3px
  // opening and a narrow dark surround on both the turret and assembled top.
  const pantherDonor = await sharp(local('panther-corrected-generated.png'))
    .resize(45, 30, { fit: 'fill' }).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  for (const [asset, yOffset] of [
    ['panther_top_turret.png', 0], ['panther_top.png', 17],
  ]) {
    const p = file(`assets/resources/textures/units/${asset}`);
    const sprite = await raw(remember(p));
    for (let y = 49; y <= 55; y++) for (let x = 3; x <= 9; x++) {
      const fill = x >= 4 && x <= 6 && y >= 51 && y <= 53;
      copyPatch(sprite, pantherDonor, x, y + yOffset, x, y - 38, fill);
    }
    await save(p, sprite.data, sprite.info);
  }

  // The StuG uses one fixed top sprite. Patch only its 3x2px enclosed hole and
  // the immediately adjacent dark rim; the rest of the 183x87 PNG is untouched.
  const stugPath = file('assets/resources/textures/units/stug3_top.png');
  const stug = await raw(remember(stugPath));
  for (let y = 37; y <= 40; y++) for (let x = 2; x <= 5; x++) {
    const o = (y * stug.info.width + x) * 4;
    const donorX = 8;
    const donorY = Math.min(39, Math.max(38, y));
    const d = (donorY * stug.info.width + donorX) * 4;
    for (let c = 0; c < 3; c++) stug.data[o + c] = stug.data[d + c];
    stug.data[o + 3] = 255;
  }
  await save(stugPath, stug.data, stug.info);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
