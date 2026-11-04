const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = __dirname;
const out = path.join(root, 'sprites');
const roles = [
  { key: 'gunner', name: 'GermanMG01_gunner', label: '01  主射手 · 架设重机枪', bounds: [252, 102, 641, 1154] },
  { key: 'loader', name: 'GermanMG02_loader', label: '02  副射手 · 供弹', bounds: [278, 276, 674, 672] },
  { key: 'bearer', name: 'GermanMG03_ammo', label: '03  弹药手 · 搬运', bounds: [308, 197, 605, 742] },
];
const background = { r: 0, g: 0, b: 0, alpha: 0 };
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><style>text{font-family:'Microsoft YaHei',sans-serif;fill:#e2dfbf}.muted{fill:#abb299}</style>${body}</svg>`);
async function canvas(w, h, layers, color = background) {
  return sharp({ create: { width: w, height: h, channels: 4, background: color } }).composite(layers).png().toBuffer();
}
async function fit(input, width, height) {
  return sharp(input).resize(width, height, { fit: 'inside', kernel: 'nearest' }).png().toBuffer();
}
async function run() {
  await fs.mkdir(out, { recursive: true });
  for (const role of roles) {
    const [left, top, width, height] = role.bounds;
    const targetWidth = Math.round(width * 0.3), targetHeight = Math.round(height * 0.3);
    role.file = path.join(out, `${role.name}.png`);
    // Technical export only: crop transparent margin, apply the same scale to all
    // three figures, and preserve the generated RGBA without repainting.
    await sharp(path.join(root, `${role.key}-generated.png`))
      .extract({ left, top, width, height })
      .resize(targetWidth, targetHeight, { kernel: 'nearest' })
      .extend({ top: 8, bottom: 8, left: 8, right: 8, background })
      .png().toFile(role.file);
    role.width = targetWidth + 16;
    role.height = targetHeight + 16;
  }
  const placements = [
    { role: roles[2], left: 361, top: 97 },
    { role: roles[0], left: 220, top: 160 },
    { role: roles[1], left: 85, top: 188 },
  ];
  const squad = await canvas(560, 560, placements.map(p => ({ input: p.role.file, left: p.left, top: p.top })));
  await fs.writeFile(path.join(out, 'GermanMG_squad_deployed.png'), squad);
  const small = await sharp(squad).resize(72, 72, { kernel: 'nearest' }).png().toBuffer();
  await fs.writeFile(path.join(out, 'GermanMG_squad_deployed_72.png'), small);

  const layers = [];
  const labels = [];
  labels.push('<rect width="1280" height="930" fill="#20281f"/>');
  labels.push('<text x="28" y="42" font-size="28" font-weight="bold">德国机枪班组 · 美术设计 V1</text>');
  labels.push('<text class="muted" x="28" y="73" font-size="16">沿用现有步兵：严格俯视 / 灰蓝军服 / 灰绿钢盔 / 粗黑轮廓　　武器朝向：下</text>');
  for (let i = 0; i < roles.length; i++) {
    const x = 28 + i * 416;
    labels.push(`<rect x="${x}" y="94" width="392" height="348" rx="10" fill="#363f30"/><text x="${x + 18}" y="128" font-size="19">${roles[i].label}</text>`);
    const pic = await sharp(roles[i].file).resize(Math.round(roles[i].width * 0.75), Math.round(roles[i].height * 0.75), { kernel: 'nearest' }).png().toBuffer();
    const meta = await sharp(pic).metadata();
    layers.push({ input: pic, left: x + Math.round((392 - meta.width) / 2), top: 148 });
  }
  labels.push('<rect x="28" y="466" width="580" height="430" rx="10" fill="#8d9567"/><text x="46" y="499" font-size="19" style="fill:#20281f">架设编组 · 72 px 的 5 倍观察</text>');
  layers.push({ input: await sharp(small).resize(360, 360, { kernel: 'nearest' }).png().toBuffer(), left: 130, top: 520 });
  labels.push('<rect x="632" y="466" width="620" height="430" rx="10" fill="#363f30"/><text x="650" y="499" font-size="19">实际尺寸检查 · 不同底色</text>');
  for (const [x, color, title] of [[665, '#8d9567', '草地'], [858, '#b2b3a1', '冬季'], [1051, '#53584b', '暗地表']]) {
    labels.push(`<rect x="${x}" y="525" width="165" height="125" rx="6" fill="${color}"/><text x="${x + 60}" y="674" font-size="15">${title}</text>`);
    layers.push({ input: small, left: x + 46, top: 548 });
  }
  labels.push('<text class="muted" x="652" y="720" font-size="17">与现有步兵比较（统一人物头盔尺度）</text>');
  for (let i = 0; i < 3; i++) {
    const pic = await fit(path.join(root, '../../../assets/resources/textures/units', `Infantry0${i + 1}.png`), 25, 25);
    layers.push({ input: pic, left: 690 + i * 33, top: 754 });
  }
  layers.push({ input: small, left: 940, top: 736 });
  labels.push('<text class="muted" x="682" y="828" font-size="15">原步兵</text><text class="muted" x="924" y="828" font-size="15">重机枪班组</text>');
  labels.push('<text class="muted" x="652" y="871" font-size="15">辨识重点：长枪身 + 展开支架 + 供弹动作 + 双弹药箱</text>');
  await sharp(svg(1280, 930, labels.join(''))).composite(layers).png().toFile(path.join(root, 'design-preview.png'));

  const directions = [];
  const directionLabels = ['下', '右下', '右上', '上', '左上', '左下'];
  let directionSvg = '<rect width="960" height="410" fill="#8d9567"/><text x="24" y="34" font-size="21" style="fill:#20281f">六方向旋转检查 · 同一透明编组旋转</text>';
  for (let i = 0; i < 6; i++) {
    const rotated = await sharp(squad).resize(102, 102, { kernel: 'nearest' }).rotate(-60 * i, { background }).png().toBuffer();
    const rotatedMeta = await sharp(rotated).metadata();
    const pic = await canvas(144, 144, [{ input: rotated, left: Math.floor((144 - rotatedMeta.width) / 2), top: Math.floor((144 - rotatedMeta.height) / 2) }]);
    const x = 18 + (i % 3) * 316, y = 52 + Math.floor(i / 3) * 174;
    directions.push({ input: pic, left: x + 75, top: y });
    directionSvg += `<text x="${x + 226}" y="${y + 80}" font-size="17" style="fill:#20281f">${directionLabels[i]}</text>`;
  }
  await sharp(svg(960, 410, directionSvg)).composite(directions).png().toFile(path.join(root, 'six-direction-preview.png'));
  const manifest = {
    version: 1, forward: 'down', camera: 'strict top-down orthographic', transparent: true,
    status: 'art-design; not wired to gameplay',
    sprites: roles.map(r => ({ name: r.name, file: `sprites/${r.name}.png`, width: r.width, height: r.height, suggestedScale: Number((0.6 * Math.max(r.width, r.height) / Math.max(roles[1].width, roles[1].height)).toFixed(3)) })),
    composition: { file: 'sprites/GermanMG_squad_deployed.png', width: 560, height: 560, previewPixels: 72, members: placements.map(p => ({ name: p.role.name, left: p.left, top: p.top })) },
  };
  await fs.writeFile(path.join(root, 'asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
