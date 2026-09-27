const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '../../..');
const dir = path.join(root, 'assets/resources/textures/units');
const kinds = [
  'sherman', 'sherman76', 'sherman_jumbo', 'm26_pershing',
  't34', 't34_85', 'kv1', 'is2', 'su152',
  'tiger', 'tigerking', 'maus', 'panther',
  'panzer4', 'stug3', 'panzer3', 'panzer3_m',
  'type97', 'type95', 'type4',
];
const cellW = 480;
const cellH = 185;

async function main() {
  const layers = [];
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    const stem = ['su152', 'stug3'].includes(kind) ? `${kind}_top` : `${kind}_top_turret`;
    const file = path.join(dir, `${stem}.png`);
    const png = await sharp(file).resize(450, 140, {
      fit: 'inside', kernel: 'nearest', withoutEnlargement: false,
    }).png().toBuffer();
    const { width, height } = await sharp(png).metadata();
    const col = i % 4;
    const row = Math.floor(i / 4);
    layers.push({ input: png,
      left: col * cellW + Math.round((cellW - width) / 2),
      top: row * cellH + Math.round((140 - height) / 2) });
    const label = Buffer.from(`<svg width="480" height="35"><text x="12" y="24" font-family="Arial" font-size="19" fill="#111">${kind}</text></svg>`);
    layers.push({ input: label, left: col * cellW, top: row * cellH + 145 });
  }
  await sharp({ create: { width: cellW * 4, height: cellH * 5,
    channels: 4, background: '#ffffffff' } })
    .composite(layers).png()
    .toFile(path.join(__dirname, 'other-tank-muzzles.png'));

  const candidates = [
    'sherman76', 'sherman_jumbo', 'm26_pershing', 't34_85',
    'tiger', 'tigerking', 'maus', 'panther',
    'panzer4', 'stug3', 'panzer3_m', 'type4',
  ];
  const details = [];
  for (let i = 0; i < candidates.length; i++) {
    const kind = candidates[i];
    const stem = kind === 'stug3' ? `${kind}_top` : `${kind}_top_turret`;
    const file = path.join(dir, `${stem}.png`);
    const meta = await sharp(file).metadata();
    const cropW = Math.max(12, Math.min(meta.width, Math.ceil(meta.width * 0.28)));
    const cropH = Math.max(12, Math.min(meta.height, Math.ceil(meta.height * 0.65)));
    const cropY = Math.floor((meta.height - cropH) / 2);
    const png = await sharp(file).extract({ left: 0, top: cropY,
      width: cropW, height: cropH })
      .flatten({ background: '#ffffff' })
      .resize(460, 160, { fit: 'inside', kernel: 'nearest' }).png().toBuffer();
    const { width, height } = await sharp(png).metadata();
    const col = i % 3;
    const row = Math.floor(i / 3);
    details.push({ input: png,
      left: col * 500 + Math.floor((500 - width) / 2),
      top: row * 210 + Math.floor((160 - height) / 2) });
    const label = Buffer.from(`<svg width="500" height="35"><text x="12" y="24" font-family="Arial" font-size="19" fill="#111">${kind}</text></svg>`);
    details.push({ input: label, left: col * 500, top: row * 210 + 165 });
  }
  await sharp({ create: { width: 1500, height: 840, channels: 4,
    background: '#ffffffff' } }).composite(details).png()
    .toFile(path.join(__dirname, 'other-tank-muzzle-details.png'));

  const findings = [];
  for (let i = 0; i < 3; i++) {
    const kind = ['panther', 'panzer4', 'stug3'][i];
    const file = path.join(dir, `${kind}_top${kind === 'stug3' ? '' : '_turret'}.png`);
    const meta = await sharp(file).metadata();
    const width = Math.min(meta.width, Math.ceil(meta.width * 0.22));
    const height = Math.min(meta.height, Math.ceil(meta.height * 0.5));
    const crop = await sharp(file).extract({ left: 0,
      top: Math.floor((meta.height - height) / 2), width, height })
      .flatten({ background: '#ffffff' })
      .resize(width * 12, height * 12, { kernel: 'nearest' })
      .png().toBuffer();
    const scaled = await sharp(crop).resize(570, 260, { fit: 'inside',
      kernel: 'nearest' }).png().toBuffer();
    const finalSize = await sharp(scaled).metadata();
    findings.push({ input: scaled, left: i * 600 + Math.floor((600 - finalSize.width) / 2),
      top: Math.floor((260 - finalSize.height) / 2) });
    const label = Buffer.from(`<svg width="600" height="35"><text x="12" y="24" font-family="Arial" font-size="20" fill="#111">${kind}</text></svg>`);
    findings.push({ input: label, left: i * 600, top: 268 });
  }
  await sharp({ create: { width: 1800, height: 310, channels: 4,
    background: '#ffffffff' } }).composite(findings).png()
    .toFile(path.join(__dirname, 'other-tank-muzzle-findings.png'));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
