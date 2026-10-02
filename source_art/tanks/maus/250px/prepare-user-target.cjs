#!/usr/bin/env node
'use strict';

// Prepare split game layers from the user's raster and a localized gun edit.
const path = require('node:path');
const sharp = require('sharp');

const dir = __dirname;
const source = path.join(dir, 'user-target-top.png');
const gunRedraw = path.join(dir, 'user-target-gun-redraw.png');
const cleanHullGenerated = path.join(dir, 'user-target-clean-hull-generated.png');
const destroyedGenerated = path.join(dir, 'user-target-destroyed-generated.png');
const crop = { left: 272, top: 33, width: 480, height: 1457 };
const outputWidth = 416; // 250 px of visible hull, with one uniform scale.
const canvasHeight = 137;
const innerHullLeft = 173;
const innerHullWidth = 243;
const maskSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536">
  <rect fill="white" x="470" y="30" width="85" height="680"/>
  <rect fill="white" x="550" y="450" width="62" height="360"/>
  <path fill="white" d="M 465 680 L 608 680 L 608 817 L 612 880
    L 645 918 L 645 1446 L 379 1446 L 379 918 L 420 880
    L 420 818 L 465 818 Z"/>
</svg>`);

async function orientAndScale(data, width, height, file) {
  const cropped = await sharp(data, { raw: { width, height, channels: 4 } })
    .extract(crop).png().toBuffer();
  await sharp(cropped).rotate(270).resize({ width: outputWidth, kernel: sharp.kernel.lanczos3 })
    .png().toFile(path.join(dir, file));
}

async function main() {
  const { data: base, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const edited = await sharp(gunRedraw).ensureAlpha().raw().toBuffer();
  const original = Buffer.from(base);
  // Take only the new 75 mm cannon and beige gun assembly from the edit.
  // The surrounding hull and roof continue to use the user's exact pixels.
  for (let y = 450; y < 885; y++) {
    for (let x = 416; x < 612; x++) {
      const i = (y * info.width + x) * 4;
      edited.copy(original, i, i, i + 4);
    }
  }
  // The two roof hatches are armored surfaces, not exposed gray metal.
  // Retain their circular outlines and luminance while matching the hull tan.
  for (const centerX of [449, 575]) {
    const centerY = 1255;
    for (let y = centerY - 70; y <= centerY + 70; y++) {
      for (let x = centerX - 70; x <= centerX + 70; x++) {
        if ((x - centerX) ** 2 + (y - centerY) ** 2 > 70 ** 2) continue;
        const i = (y * info.width + x) * 4;
        const r = original[i], g = original[i + 1], b = original[i + 2];
        if (original[i + 3] < 32 || Math.max(r, g, b) - Math.min(r, g, b) > 34) continue;
        const light = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (light < 75) continue;
        original[i] = Math.min(255, Math.round(light * 1.12));
        original[i + 1] = Math.min(255, Math.round(light * 1.02));
        original[i + 2] = Math.min(255, Math.round(light * 0.68));
      }
    }
  }
  await sharp(original, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png().toFile(path.join(dir, 'user-target-revised-top.png'));
  const { data: mask } = await sharp(maskSvg).greyscale().raw().toBuffer({ resolveWithObject: true });
  const hull = Buffer.from(original);
  const turret = Buffer.from(original);

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const pixel = y * info.width + x;
      const i = pixel * 4;
      const visible = original[i + 3] >= 32;
      const onTurret = mask[pixel] >= 128;
      if (!visible) {
        hull.fill(0, i, i + 4);
        turret.fill(0, i, i + 4);
      } else if (onTurret) {
        // The user's pixels become the rotating turret. Fill the hidden deck
        // beneath it so the hull stays solid when the turret turns.
        turret[i + 3] = 255;
        if (y >= 650) {
          hull[i] = 208; hull[i + 1] = 187; hull[i + 2] = 116; hull[i + 3] = 255;
        } else {
          hull.fill(0, i, i + 4);
        }
      } else {
        turret.fill(0, i, i + 4);
      }
    }
  }

  await orientAndScale(hull, info.width, info.height, 'user-target-hull-source.png');
  await orientAndScale(turret, info.width, info.height, 'user-target-turret-source.png');
  const hullPath = path.join(dir, 'user-target-hull-source.png');
  const cleanCrop = await sharp(cleanHullGenerated)
    .extract({ left: 130, top: 15, width: 764, height: 1360 }).png().toBuffer();
  const cleanOriented = await sharp(cleanCrop).rotate(270)
    .resize({ width: innerHullWidth, kernel: sharp.kernel.lanczos3 }).png().toBuffer();
  const cleanInfo = await sharp(cleanOriented).metadata();
  const cleanCanvas = await sharp({
    create: { width: outputWidth, height: canvasHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: cleanOriented, left: innerHullLeft, top: Math.floor((canvasHeight - cleanInfo.height) / 2) }])
    .raw().toBuffer();
  const maskCrop = await sharp(maskSvg).extract(crop).png().toBuffer();
  const maskOriented = await sharp(maskCrop).rotate(270)
    .resize({ width: outputWidth, kernel: sharp.kernel.nearest }).ensureAlpha().raw().toBuffer();
  const hullOriented = await sharp(hullPath).raw().toBuffer();
  for (let i = 0; i < hullOriented.length; i += 4) {
    if (maskOriented[i + 3] < 128 || hullOriented[i + 3] < 32 || cleanCanvas[i + 3] < 32) continue;
    hullOriented[i] = cleanCanvas[i];
    hullOriented[i + 1] = cleanCanvas[i + 1];
    hullOriented[i + 2] = cleanCanvas[i + 2];
  }
  // The roof hatches rotate with the turret. Remove their duplicate shapes
  // from the hidden deck so they do not remain behind when the turret turns.
  for (const centerY of [50, 86]) {
    const centerX = 349;
    for (let y = centerY - 22; y <= centerY + 22; y++) {
      for (let x = centerX - 22; x <= centerX + 22; x++) {
        if ((x - centerX) ** 2 + (y - centerY) ** 2 > 22 ** 2) continue;
        const i = (y * outputWidth + x) * 4;
        if (hullOriented[i + 3] < 32) continue;
        hullOriented[i] = 226;
        hullOriented[i + 1] = 205;
        hullOriented[i + 2] = 133;
      }
    }
  }
  await sharp(hullOriented, { raw: { width: outputWidth, height: canvasHeight, channels: 4 } })
    .png().toFile(hullPath);
  const wreckCrop = await sharp(destroyedGenerated)
    .extract({ left: 149, top: 77, width: 726, height: 1300 }).png().toBuffer();
  const wreckOriented = await sharp(wreckCrop).rotate(270)
    .resize({ width: innerHullWidth, kernel: sharp.kernel.lanczos3 }).png().toBuffer();
  const wreckInfo = await sharp(wreckOriented).metadata();
  const wreckCanvas = await sharp({
    create: { width: outputWidth, height: canvasHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: wreckOriented, left: innerHullLeft, top: Math.floor((canvasHeight - wreckInfo.height) / 2) }])
    .raw().toBuffer();
  const destroyed = Buffer.from(wreckCanvas);
  for (let i = 0; i < destroyed.length; i += 4) {
    const alpha = hullOriented[i + 3];
    if (alpha < 32) {
      destroyed.fill(0, i, i + 4);
      continue;
    }
    if (wreckCanvas[i + 3] < 32) {
      destroyed[i] = Math.round(hullOriented[i] * 0.7);
      destroyed[i + 1] = Math.round(hullOriented[i + 1] * 0.7);
      destroyed[i + 2] = Math.round(hullOriented[i + 2] * 0.7);
    }
    destroyed[i + 3] = alpha;
  }
  await sharp(destroyed, { raw: { width: outputWidth, height: canvasHeight, channels: 4 } })
    .png().toFile(path.join(dir, 'user-target-destroyed-source.png'));
  console.log('Prepared direct raster layers from user-target-top.png');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
