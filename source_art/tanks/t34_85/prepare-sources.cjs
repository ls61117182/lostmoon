// Normalize the selected colorized layers to the blueprint's common source scale.
// Run from the repository root, then run tank:prepare -- --kind t34_85.
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
    if (data[o + 3] >= 32) {
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  return sharp(data, { raw: info }).extract({ left, top, width: right - left + 1, height: bottom - top + 1 });
}
(async () => {
  // Both widths are measured in the same 4x blueprint plan coordinates.
  for (const [role, width] of [['hull', 942], ['turret', 934]]) {
    await (await keyed(`${role}-colorized.png`)).resize({ width }).png().toFile(path.join(dir, `${role}-selected.png`));
  }
  const hull = await sharp(path.join(dir, 'hull-selected.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const damaged = await (await keyed('destroyed-colorized.png')).resize(hull.info.width, hull.info.height, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const { width, height } = hull.info;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 4;
    // Retain the original hull boundary and alpha exactly; damage changes interior color only.
    let boundary = false;
    for (let dy = -6; dy <= 6 && !boundary; dy++) for (let dx = -6; dx <= 6; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height || hull.data[(yy * width + xx) * 4 + 3] < 32) { boundary = true; break; }
    }
    if (boundary || damaged[o + 3] < 32) hull.data.copy(damaged, o, o, o + 3);
    damaged[o + 3] = hull.data[o + 3];
  }
  await sharp(damaged, { raw: hull.info }).png().toFile(path.join(dir, 'destroyed-from-hull.png'));
  // User-approved geometry stays untouched. Transfer only the green palette from
  // soviet-green-palette-reference.png (paint median RGB 68,82,51 vs 87,82,53).
  // Always start from original colorized inputs above so repeated runs are stable.
  for (const name of ['hull-selected.png', 'turret-selected.png', 'destroyed-from-hull.png']) {
    const file = path.join(dir, name);
    const layer = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < layer.data.length; i += 4) {
      if (!layer.data[i + 3]) continue;
      const r = layer.data[i], g = layer.data[i + 1], b = layer.data[i + 2];
      const high = Math.max(r, g, b), low = Math.min(r, g, b);
      // Preserve neutral black linework, soot and bare metal; taper through shadows.
      const weight = Math.min(1, (high - low) / 20) * Math.max(0, Math.min(1, (high - 25) / 30));
      layer.data[i] = Math.round(r * (1 + (68 / 87 - 1) * weight));
      layer.data[i + 2] = Math.round(b * (1 + (51 / 53 - 1) * weight));
    }
    await sharp(layer.data, { raw: layer.info }).png().toFile(file);
  }
  console.log(`T-34/85 sources ready; hull and destroyed ${width}x${height}, identical alpha.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
