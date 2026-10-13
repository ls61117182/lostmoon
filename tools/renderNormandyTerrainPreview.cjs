// Preview the actual native Graphics drawing routines outside Cocos.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
class Color {
  constructor(r, g, b, a = 255) { Object.assign(this, { r, g, b, a }); }
  svg() { return `rgba(${this.r},${this.g},${this.b},${this.a / 255})`; }
}
class Graphics {
  constructor() { this.items = []; this.path = ''; this.lineWidth = 1; }
  moveTo(x, y) { this.path += `M${x} ${y} `; }
  lineTo(x, y) { this.path += `L${x} ${y} `; }
  close() { this.path += 'Z '; }
  circle(x, y, r) { this.path += `M${x-r} ${y} a${r} ${r} 0 1 0 ${r*2} 0 a${r} ${r} 0 1 0 ${-r*2} 0 `; }
  rect(x, y, w, h) { this.path += `M${x} ${y} h${w} v${h} h${-w} Z `; }
  fill() { this.items.push(`<path d="${this.path}" fill="${this.fillColor.svg()}"/>`); this.path = ''; }
  stroke() { this.items.push(`<path d="${this.path}" fill="none" stroke="${this.strokeColor.svg()}" stroke-width="${this.lineWidth}"/>`); this.path = ''; }
}
function load(file, deps) {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(m, m.exports, name => deps[name]);
  return m.exports;
}
const art = load(path.join(root, 'assets/scripts/view/BeachTerrainVisual.ts'), { cc: { Color, Graphics } });
const urban = load(path.join(root, 'assets/scripts/core/UrbanTerrain.ts'), {});
const rasterModule = load(path.join(root, 'assets/scripts/view/TerrainGroundRaster.ts'), { '../core/UrbanTerrain': urban });
const bundle = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/textures/terrain/redesign_v3/materials.json'), 'utf8'));
const raster = new rasterModule.TerrainGroundRaster(bundle.europeanSummer ?? bundle);
const sand = raster.getGpuMaterials().europe_sand;
async function main() {
  const texture = await sharp(Buffer.from(sand.pixels), { raw: { width: sand.width, height: sand.height, channels: 3 } }).png().toBuffer();
  const image = `data:image/png;base64,${texture.toString('base64')}`;
  const panels = [
    { label: '沙滩（欧洲）', rule: '开阔地效果 · 坦克不能隐蔽' },
    { label: '完好铁丝网', rule: '沿格边 · 坦克正常移动碾坏', wire: 1 },
    { label: '损坏铁丝网', rule: '断开压平 · 没有规则效果', wire: 2 },
    { label: '钢制拒马', rule: '每格三个 · 坦克进入立即瘫痪', steel: true },
    { label: '弹坑', rule: '泥地效果 · 步兵掩护 +1', crater: true },
    { label: '混凝土海堤', rule: '仅显示顶面 · 沿用防波堤规则', wall: true },
  ];
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="760"><rect width="1080" height="760" fill="#eee8d9"/><defs><pattern id="sand" width="384" height="384" patternUnits="userSpaceOnUse"><image href="'+image+'" width="384" height="384"/></pattern></defs><g font-family="Microsoft YaHei, sans-serif" fill="#393d35"><text x="40" y="48" font-size="27">诺曼底地形 · 实际绘制代码预览</text><text x="40" y="77" font-size="16">垂直顶视 / 无侧面透视 / 沙地与附加物分层</text>';
  panels.forEach((p, index) => {
    const x = 190 + index % 3 * 350, y = 222 + Math.floor(index / 3) * 320, radius = 103;
    const g = new Graphics();
    const points = Array.from({ length: 6 }, (_, i) => { const a = (-30 + i * 60) * Math.PI / 180; return [Math.cos(a) * radius, Math.sin(a) * radius]; });
    const polygon = points.map(a => a.join(',')).join(' ');
    svg += `<g transform="translate(${x} ${y}) scale(1 -1)"><polygon points="${polygon}" fill="url(#sand)" stroke="#928b72" stroke-width="1.5"/>`;
    art.drawBeachOverlays(g, 0, 0, radius, !!p.crater, !!p.steel);
    if (p.wire || p.wall) for (const edge of [0, 2, 4]) {
      const a = points[edge], b = points[(edge + 1) % 6];
      art.drawBeachEdge(g, ...a, ...b, radius, p.wall ? 'seawall' : 'wire', p.wire ?? 1);
    }
    svg += g.items.join('') + `</g><text x="${x}" y="${y+145}" text-anchor="middle" font-size="23">${p.label}</text><text x="${x}" y="${y+175}" text-anchor="middle" font-size="15">${p.rule}</text>`;
  });
  svg += '</g></svg>';
  const output = path.join(root, 'source_art/terrain/normandy-concept-20261013');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'runtime-topdown-preview.svg'), svg);
  await sharp(Buffer.from(svg)).png().toFile(path.join(output, 'runtime-topdown-preview.png'));
  console.log('Saved runtime-topdown-preview.svg and .png');
}
module.exports = { Color, Graphics, art, raster };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
