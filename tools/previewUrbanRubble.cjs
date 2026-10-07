const fs = require('node:fs'), path = require('node:path'), sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'source_art/terrain/urban-redraw-20261005');
const target = path.join(root, 'assets/resources/textures/terrain/urban');
async function main() {
  const panels = [], keys = ['rowhouses_l', 'courtyard', 'workshop', 'block'];
  const floor = await sharp(path.join(target, 'roads/urban_road_tile_base_v1.png')).resize(148, 171).png().toBuffer();
  for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
    const name = `urban_dense_destructible_${keys[col]}_rubble_v1.png`;
    const file = row ? path.join(target, name) : path.join(source, 'before-natural-rubble/runtime', name);
    const panel = await sharp({ create: { width: 240, height: 290, channels: 4, background: '#59614e' } }).composite([
      { input: floor, left: 46, top: 51 },
      { input: await sharp(file).resize(222, 256).png().toBuffer(), left: 9, top: 8 },
      { input: Buffer.from(`<svg width="240" height="24"><text x="120" y="17" text-anchor="middle" fill="#f1ecdb" font-size="13" font-family="sans-serif">${row ? 'AFTER' : 'BEFORE'} / ${keys[col]}</text></svg>`), left: 0, top: 264 },
    ]).png().toBuffer();
    panels.push({ input: panel, left: col * 240, top: row * 290 });
  }
  await sharp({ create: { width: 960, height: 580, channels: 4, background: '#59614e' } }).composite(panels).png().toFile(path.join(source, 'rubble-comparison.png'));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
