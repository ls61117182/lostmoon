'use strict';
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const units = path.join(root, 'assets/resources/textures/units');
const output = path.join(root, 'source_art/tanks/panzer3_n/preview-comparison-3x.png');
const width = 1080;
const height = 756;
const entries = [
  ['M', 'panzer3_m_no_schurzen_top.png', 48, 78],
  ['N', 'panzer3_n_top.png', 588, 78],
  ['M + Schurzen', 'panzer3_m_top.png', 48, 470],
  ['N + Schurzen', 'panzer3_n_schurzen_top.png', 588, 470],
];

async function main() {
  const layers = [];
  for (const [label, filename, left, top] of entries) {
    const input = path.join(units, filename);
    const metadata = await sharp(input).metadata();
    layers.push({ input: await sharp(input).resize(metadata.width * 3, metadata.height * 3, { kernel: 'nearest' }).png().toBuffer(), left, top });
    const caption = `<svg width="520" height="70"><text x="0" y="44" font-family="Arial" font-size="40" fill="#f1f2e8">${label}</text></svg>`;
    layers.push({ input: Buffer.from(caption), left, top: top - 66 });
  }
  await sharp({ create: { width, height, channels: 4, background: '#535f44' } }).composite(layers).png().toFile(output);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
