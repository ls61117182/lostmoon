const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'source_art/terrain/urban-redraw-20261005');
const target = path.join(root, 'assets/resources/textures/terrain/urban');
async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  const entries = manifest.images.filter(e => ['church', 'town_hall', 'civic_dome', 'rowhouses_l'].includes(e.key));
  const names = { church: 'Church', town_hall: 'Town hall', civic_dome: 'Civic dome' };
  const layers = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i], x = i % 3 * 320, y = Math.floor(i / 3) * 380;
    const floor = await sharp(path.join(target, 'roads/urban_road_tile_base_v1.png')).png().toBuffer();
    const sprite = await sharp(path.join(root, entry.runtimeFile)).resize(300, 346).png().toBuffer();
    layers.push({ input: floor, left: x + 49, top: y + 45 });
    layers.push({ input: sprite, left: x + 10, top: y });
    const title = names[entry.key] || ('Residential / ' + entry.state);
    const label = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="30"><text x="160" y="21" text-anchor="middle" fill="#eee9d9" font-family="sans-serif" font-size="16">' + title + '</text></svg>');
    layers.push({ input: label, left: x, top: y + 346 });
  }
  await sharp({ create: { width: 960, height: 760, channels: 4, background: '#59614e' } }).composite(layers).png().toFile(path.join(source, 'identity-preview.png'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
