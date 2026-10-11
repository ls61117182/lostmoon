// Render the same damage drawing functions against real tank art for visual review.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
class Color {
  constructor(r, g, b, a = 255) { Object.assign(this, { r, g, b, a }); }
}
const color = c => `rgba(${c.r},${c.g},${c.b},${c.a / 255})`;
class Graphics {
  constructor() { this.elements = []; this.d = ''; this.finished = false; }
  moveTo(x, y) { if (this.finished) this.d = ''; this.finished = false; this.d += `M${x},${y}`; }
  lineTo(x, y) { this.d += `L${x},${y}`; }
  close() { this.d += 'Z'; }
  roundRect(x, y, w, h) { this.d = `M${x},${y}h${w}v${h}h${-w}Z`; this.finished = false; }
  fill() { this.elements.push(`<path d="${this.d}" fill="${color(this.fillColor)}"/>`); this.finished = true; }
  stroke() { this.elements.push(`<path d="${this.d}" fill="none" stroke="${color(this.strokeColor)}" stroke-width="${this.lineWidth}" stroke-linejoin="round"/>`); this.finished = true; }
}
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts/view/TankDamageVisual.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject, require: () => ({ Color }) });

async function main() {
  const outDir = path.join(root, 'source_art/tanks/damage-preview');
  fs.mkdirSync(outDir, { recursive: true });
  const image = name => `data:image/png;base64,${fs.readFileSync(path.join(root, 'assets/resources/textures/units', `${name}.png`)).toString('base64')}`;
  const csv = fs.readFileSync(path.join(root, 'data/tank_visuals.csv'), 'utf8').trim().split(/\r?\n/);
  const headers = csv[0].split(',');
  const cfg = kind => Object.fromEntries(csv.find(line => line.startsWith(`${kind},`)).split(',').map((v, i) => [headers[i], v]));
  const kinds = ['sherman', 'panzer4', 'tiger'];
  const labels = ['正常', '瘫痪：左侧履带', '炮塔受损：局部焦黑', '同时受损：右侧履带'];
  let body = '<rect width="960" height="650" fill="#b3b69b"/>';
  body += '<text x="30" y="34" font-size="21" fill="#252d25">通用部件损伤 · 实际坦克素材预览</text>';
  for (let column = 0; column < 4; column++) body += `<text x="${120 + column * 235}" y="72" text-anchor="middle" font-size="16" fill="#252d25">${labels[column]}</text>`;
  for (let row = 0; row < kinds.length; row++) {
    const kind = kinds[row], c = cfg(kind);
    // A representative hex radius; no separate scaling of the hull and turret.
    const scale = 75 * 1.8 * Number(c.hullFitScale) / Math.max(Number(c.topTrimW), Number(c.topTrimH));
    const length = Number(c.topTrimW) * scale, width = Number(c.topTrimH) * scale;
    const turretScale = scale * Number(c.turretScale);
    const turretW = Number(c.turretTrimW) * turretScale, turretH = Number(c.turretTrimH) * turretScale;
    const pivotX = (Number(c.turretPivotX) - Number(c.topTrimX) - Number(c.topTrimW) / 2) * scale;
    const pivotY = (Number(c.topTrimH) / 2 + Number(c.topTrimY) - Number(c.turretPivotY)) * scale;
    const turretF = Number(c.turretOffsetForward) * 75 * Math.sqrt(3);
    const turretR = Number(c.turretOffsetRight) * 75 * Math.sqrt(3);
    const anchorX = (Number(c.turretSpritePivotX) - Number(c.turretTrimX)) * turretScale + turretF;
    const anchorY = (Number(c.turretSpritePivotY) - Number(c.turretTrimY)) * turretScale + turretR;
    const radius = Math.max(3, turretH * 0.25);
    const position = 1 / 3 + row / 6;
    const leftTrack = new Graphics(), rightTrack = new Graphics();
    exportsObject.drawSlippedTankTrack(leftTrack, length, width, 1, position, 'left');
    exportsObject.drawSlippedTankTrack(rightTrack, length, width, 1, position, 'right');
    const scorch = new Graphics(); exportsObject.drawTurretScorch(scorch, radius);
    const y = 135 + row * 185;
    body += `<text x="25" y="${y - 32}" font-size="14" fill="#252d25">${kind} · 前 ${['1/3', '1/2', '2/3'][row]}</text>`;
    for (let column = 0; column < 4; column++) {
      const x = 120 + column * 235;
      let tank = '';
      if (column === 1 || column === 3) tank += `<g transform="scale(1,-1)">${(column === 1 ? leftTrack : rightTrack).elements.join('')}</g>`;
      tank += `<image href="${image(`${kind}_top_hull`)}" x="${-length / 2}" y="${-width / 2}" width="${length}" height="${width}"/>`;
      tank += `<image href="${image(`${kind}_top_turret`)}" x="${pivotX - anchorX}" y="${-pivotY - anchorY}" width="${turretW}" height="${turretH}"/>`;
      if (column >= 2) tank += `<g transform="translate(${pivotX - radius * 0.75 - turretF},${-pivotY - radius * 0.15 - turretR}) scale(1,-1)">${scorch.elements.join('')}</g>`;
      body += `<g transform="translate(${x},${y})">${tank}</g>`;
      // Enlarged comparison is a nearest-neighbour copy of the same small render.
      const tile = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="82"><g transform="translate(90,41)">${tank}</g></svg>`)).png().toBuffer();
      const enlarged = await sharp(tile).resize(360, 164, { kernel: 'nearest' }).png().toBuffer();
      body += `<image href="data:image/png;base64,${enlarged.toString('base64')}" x="${x - 108}" y="${y + 38}" width="216" height="98.4"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="650" font-family="Microsoft YaHei, sans-serif">${body}</svg>`;
  const output = path.join(outDir, 'damage-comparison.png');
  await sharp(Buffer.from(svg)).png().toFile(output);
  console.log(output);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
