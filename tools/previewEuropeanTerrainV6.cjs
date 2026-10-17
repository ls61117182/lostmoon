// Deterministic comparison using the project's ground compositor and canopy sizes.
const fs = require('node:fs'), path = require('node:path'), sharp = require('sharp');
const { PACK, LIVE } = require('./switchEuropeanTerrainArt.cjs');
const { loadRaster, MATERIAL_IDS } = require('./buildEuropeanTerrainV6.cjs');
const layout = [[0,.64,.78],[-.47,.35,.84],[.47,.35,.80],[-.58,-.16,.85],[0,.12,.90],[.58,-.16,.82],[-.32,-.54,.85],[.32,-.54,.82],[0,-.10,.79]];
const W = 800, H = 550, scale = 1.15, PW = 920, PH = 633;
const tiles = [];
for (let r = 0; r < 7; r++) for (let c = 0; c < 9; c++) {
  const water = r === 3 || (r === 2 && c < 2) || (r === 4 && c > 6);
  const forest = !water && ((r < 2 && c > 5) || (r > 4 && c < 2) || (r === 1 && c === 3) || (r === 5 && c === 5));
  const road = c === 4;
  tiles.push({ pos: { q: c - Math.floor(r / 2), r }, terrain: water ? 'water' : forest ? 'forest' : (c === 1 && r === 1) || (c === 6 && r === 5) ? 'mud' : road ? 'road' : 'field',
    ...(road && !water ? { roads: [false, true, false, false, true, false] } : {}),
    ...(road && water ? { bridgeEnds: [1, 4] } : {}), hasBuilding: road && [1, 5].includes(r), hedge: !water && ((c === 2 && r >= 4) || (c === 7 && r < 2)) });
}
const pos = t => ({ x: (Math.sqrt(3) * 48 * (t.pos.q + t.pos.r / 2) + 48) * scale, y: (72 * t.pos.r + 52) * scale });
async function map(version) {
  const dir = path.join(PACK, version), summer = JSON.parse(fs.readFileSync(path.join(dir, 'summer.json'), 'utf8'));
  const engine = new (loadRaster().TerrainGroundRaster)(summer), a = engine.renderChunk(tiles, false, -48, -52, W, H, 1);
  const ground = await sharp(a.pixels, { raw: { width: a.textureWidth, height: a.textureHeight, channels: 4 } }).extract({ left: 1, top: 1, width: W, height: H }).resize(PW, PH).png().toBuffer();
  const layers = [];
  async function tree(t, dx, dy, side, index) {
    const size = Math.round(side * scale), input = await sharp(path.join(dir, `redesign_v3/europe_tree_0${index % 4 + 1}.png`)).resize(size, size).png().toBuffer(), p = pos(t);
    const left = Math.round(p.x + dx * scale - size / 2), top = Math.round(p.y + dy * scale - size / 2);
    if (left >= 0 && top >= 0 && left + size <= PW && top + size <= PH) layers.push({ input, left, top });
  }
  for (const t of tiles) {
    if (t.terrain === 'forest') for (let i = 0; i < layout.length; i++) {
      const [dx, dy, s] = layout[i]; await tree(t, dx * 48, -dy * 48, 48 * s * .82, Math.abs(t.pos.q * 92811 + t.pos.r * 6899) + i);
    }
    if (t.hedge) for (let i = 0; i < 6; i++) await tree(t, -33 + i * 13, -21, 21 + i % 3, i + t.pos.r);
    if (t.hasBuilding) {
      const p = pos(t);
      for (let i = 0; i < 5; i++) {
        const input = await sharp(path.join(LIVE, `redesign_v3/rural_roof_0${i % 4 + 1}.png`)).resize(33, 23).rotate(i * 29, { background: '#00000000' }).png().toBuffer(), m = await sharp(input).metadata();
        layers.push({ input, left: Math.round(p.x + (i % 2 ? 27 : -34) - m.width / 2), top: Math.round(p.y + (i - 2) * 17 - m.height / 2) });
      }
    }
  }
  const result = await sharp({ create: { width: PW, height: PH, channels: 4, background: '#263024' } }).composite([{ input: ground }, ...layers]).png().toBuffer();
  await sharp(result).toFile(path.join(PACK, version + '-map.png')); return result;
}
async function main() {
  const old = await map('classic'), detailed = await map('detailed');
  const header = Buffer.from(`<svg width="1880" height="115"><rect width="1880" height="115" fill="#eee8d9"/><g fill="#303c2f" font-family="Microsoft YaHei,sans-serif"><text x="22" y="40" font-size="28">欧洲夏季地形 · 原版 / 细节重绘版 V6</text><text x="22" y="70" font-size="16">同一地图、同一缩放和渲染规格；地面材质 384×384，树冠 256×256。预览采用项目地面合成器，未叠加战争迷雾。</text><text x="22" y="103" font-size="20">原版 V5</text><text x="962" y="103" font-size="20">新版 V6 · 细纹理 / 树冠明暗 / 清晰边缘</text></g></svg>`);
  await sharp({ create: { width: 1880, height: 760, channels: 4, background: '#eee8d9' } }).composite([{ input: header, left: 0, top: 0 }, { input: old, left: 10, top: 115 }, { input: detailed, left: 950, top: 115 }]).png().toFile(path.join(PACK, 'comparison.png'));
  const sheet = [], headers = Buffer.from('<svg width="1260" height="85"><rect width="1260" height="85" fill="#eee8d9"/><text x="24" y="38" font-size="25" font-family="Microsoft YaHei" fill="#303c2f">V6 材质与树冠 · 项目实际像素规格</text><text x="24" y="65" font-size="16" font-family="Microsoft YaHei" fill="#303c2f">地面 384×384 原尺寸；下排树冠 256×256，并附 40px 游戏尺寸预览。</text></svg>');
  sheet.push({ input: headers, top: 0, left: 0 });
  const s = JSON.parse(fs.readFileSync(path.join(PACK, 'detailed/summer.json'), 'utf8'));
  for (let i = 0; i < MATERIAL_IDS.length; i++) {
    const id = MATERIAL_IDS[i], m = s.materials[id], left = 24 + i % 3 * 412, top = 105 + Math.floor(i / 3) * 414;
    const input = await sharp(Buffer.from(m.rgb, 'base64'), { raw: { width: m.width, height: m.height, channels: 3 } }).png().toBuffer();
    sheet.push({ input, left, top });
    sheet.push({ input: Buffer.from(`<svg width="384" height="25"><text x="0" y="18" font-size="16" font-family="sans-serif" fill="#303c2f">${id} · 384×384</text></svg>`), left, top: top + 385 });
  }
  for (let i = 0; i < 4; i++) {
    const source = path.join(PACK, `detailed/redesign_v3/europe_tree_0${i + 1}.png`), left = 22 + i * 310;
    sheet.push({ input: await sharp(source).png().toBuffer(), left, top: 1360 });
    sheet.push({ input: await sharp(source).resize(40, 40).png().toBuffer(), left: left + 108, top: 1630 });
  }
  await sharp({ create: { width: 1260, height: 1690, channels: 4, background: '#eee8d9' } }).composite(sheet).png().toFile(path.join(PACK, 'asset-sheet.png'));
  console.log('Saved comparison.png, classic-map.png, detailed-map.png and asset-sheet.png');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
