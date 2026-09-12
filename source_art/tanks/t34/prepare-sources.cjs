// Register selected colorized layers to the 4x user blueprint coordinate scale.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const dir = __dirname;
async function keyed(name) {
  const { data, info } = await sharp(path.join(dir, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const o = (y * info.width + x) * 4;
    if (data[o + 1] > data[o] + 18 && data[o + 1] > data[o + 2] + 18) data.fill(0, o, o + 4);
    if (data[o + 3] >= 32) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  console.log(name, { left, top, width: right - left + 1, height: bottom - top + 1 });
  return sharp(data, { raw: info }).extract({ left, top, width: right - left + 1, height: bottom - top + 1 });
}
(async () => {
  await (await keyed('hull-colorized.png')).resize({ width: 1388 }).png().toFile(path.join(dir, 'hull-selected.png'));
  // Body width 756 generated px corresponds to 476 blueprint px. Uniform scale
  // restores the turret body, mantlet and barrel thickness together.
  const turret = await (await keyed('turret-colorized.png')).resize({ width: 885 }).png().toBuffer();
  const tm = await sharp(turret).metadata();
  // Generation shortened only the plain shaft. Insert 99 px at its straight
  // middle section to recover the blueprint barrel length without stretching
  // the turret body, mantlet, muzzle collar or barrel thickness.
  const at = 140, extra = 99;
  const left = await sharp(turret).extract({ left: 0, top: 0, width: at, height: tm.height }).png().toBuffer();
  const shaft = await sharp(turret).extract({ left: at, top: 0, width: 1, height: tm.height }).resize(extra, tm.height, { fit: 'fill' }).png().toBuffer();
  const right = await sharp(turret).extract({ left: at, top: 0, width: tm.width - at, height: tm.height }).png().toBuffer();
  await sharp({ create: { width: tm.width + extra, height: tm.height, channels: 4, background: '#00000000' } }).composite([
    { input: left, left: 0, top: 0 }, { input: shaft, left: at, top: 0 }, { input: right, left: at + extra, top: 0 },
  ]).png().toFile(path.join(dir, 'turret-selected.png'));
  // Keep both layers in the same Soviet green family already approved on T-34/85.
  for (const name of ['hull-selected.png', 'turret-selected.png']) {
    const file = path.join(dir, name);
    const layer = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < layer.data.length; i += 4) {
      if (!layer.data[i + 3]) continue;
      const r = layer.data[i], g = layer.data[i + 1], b = layer.data[i + 2];
      const high = Math.max(r, g, b), low = Math.min(r, g, b);
      const weight = Math.min(1, (high - low) / 20) * Math.max(0, Math.min(1, (high - 25) / 30));
      layer.data[i] = Math.round(r * (1 - 0.09 * weight));
    }
    await sharp(layer.data, { raw: layer.info }).png().toFile(file);
  }
  if (fs.existsSync(path.join(dir, 'destroyed-colorized.png'))) {
    const hull = await sharp(path.join(dir, 'hull-selected.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const damaged = await (await keyed('destroyed-colorized.png')).resize(hull.info.width, hull.info.height, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
    const { width, height } = hull.info;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let boundary = false;
      for (let dy = -6; dy <= 6 && !boundary; dy++) for (let dx = -6; dx <= 6; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height || hull.data[(yy * width + xx) * 4 + 3] < 32) { boundary = true; break; }
      }
      if (boundary || damaged[o + 3] < 32) hull.data.copy(damaged, o, o, o + 3);
      damaged[o + 3] = hull.data[o + 3];
    }
    await sharp(damaged, { raw: hull.info }).png().toFile(path.join(dir, 'destroyed-from-hull.png'));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
