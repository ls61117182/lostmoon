// Export generated artwork without repainting it; preserve the generated alpha.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const root = path.resolve(__dirname, '../../..');
const target = path.join(root, 'assets/resources/textures/terrain/pacific_rocks.png');

async function main() {
  const source = path.join(__dirname, 'rocky-highland-simple-v6-master.png');
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    // Ignore nearly invisible alpha=1 specks when measuring the artwork bounds.
    if (data[(y * info.width + x) * 4 + 3] <= 1) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  assert(right > left && bottom > top, 'Generated source must have nonempty alpha');
  left = Math.max(0, left - 2); top = Math.max(0, top - 2);
  right = Math.min(info.width - 1, right + 2); bottom = Math.min(info.height - 1, bottom + 2);
  const sprite = await sharp(source)
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    // The new source is authored as a blunt-cornered hex seen straight from above.
    // Fit that hex to the cell with only a 2 px transparent sampling margin.
    .resize(218, 252, { fit: 'fill', kernel: 'lanczos3' })
    .extend({ left: 2, right: 2, top: 2, bottom: 2, background: '#00000000' })
    .png().toBuffer();
  await sharp(sprite).toFile(target);
  await sharp(sprite).toFile(path.join(__dirname, 'rocky-highland-222x256.png'));

  const old = path.join(__dirname, 'before-simple-v6-222x256.png');
  const grass = path.join(root, 'assets/resources/textures/terrain/terrain_field.png');
  const items = [];
  const text = (x, y, s, size = 18) => `<text x="${x}" y="${y}" fill="#ece7dc" font-family="Arial,sans-serif" font-size="${size}">${s}</text>`;
  const labels = [text(32, 34, 'ROCKY HIGHLAND / 2026-10-16', 22), text(48, 76, 'Previous'), text(318, 76, 'Simplified cliff faces'), text(604, 76, '64 px'), text(770, 76, 'Adjacent hexes')];
  const hex = (x, y, w, h, fill) => `<polygon points="${x+w/2},${y} ${x+w},${y+h/4} ${x+w},${y+3*h/4} ${x+w/2},${y+h} ${x},${y+3*h/4} ${x},${y+h/4}" fill="${fill}" stroke="#514f40" stroke-width="1"/>`;
  let board = '';
  for (const x of [40, 310]) board += hex(x, 98, 222, 256, '#b8b393');
  const add = async (input, left, top, width, height) => items.push({ input: await sharp(input).resize(width, height).png().toBuffer(), left, top });
  await add(old, 40, 98, 222, 256);
  await add(sprite, 310, 98, 222, 256);
  board += hex(605, 116, 56, 64, '#b8b393');
  await add(sprite, 605, 116, 56, 64);
  labels.push(text(598, 213, '128 px', 16));
  board += hex(580, 228, 111, 128, '#b8b393');
  await add(sprite, 580, 228, 111, 128);
  // Pointy-top tiling, with touching rocky cells and grass around them.
  const tw = 92, th = 106;
  for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) {
    const x = 756 + q * tw + (r % 2) * tw/2;
    const y = Math.round(96 + r * th * .75);
    board += hex(x, y, tw, th, '#b8b393');
    await add(grass, x, y, tw, th);
    if ((r === 1 && q < 2) || (r === 0 && q === 1)) await add(sprite, x, y, tw, th);
  }
  labels.push(text(40, 399, 'Fewer larger cliff masses / clear height / softened hex corners / top-down', 18));
  const backdrop = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="430"><rect width="1100" height="430" fill="#302f2b"/>${board}${labels.join('')}</svg>`);
  await sharp(backdrop).composite(items).png().toFile(path.join(__dirname, 'review.png'));

  const output = await sharp(target).metadata();
  assert.equal(output.width, 222); assert.equal(output.height, 256); assert(output.hasAlpha);
  const meta = JSON.parse(fs.readFileSync(`${target}.meta`, 'utf8'));
  assert.equal(meta.subMetas.f9941.userData.rawWidth, output.width);
  assert.equal(meta.subMetas.f9941.userData.rawHeight, output.height);
  assert(fs.readFileSync(`${target}.meta`).equals(fs.readFileSync(path.join(__dirname, 'previous-pacific_rocks.png.meta'))), 'Cocos UUID and import settings must remain unchanged');
  const { data: rgba } = await sharp(target).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const pixel of [0, 221, 222 * 255, 222 * 256 - 1]) assert.equal(rgba[pixel * 4 + 3], 0);
  console.log('Verified: 222x256 RGBA; transparent corners; unchanged Cocos metadata.');
  console.log(target);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
