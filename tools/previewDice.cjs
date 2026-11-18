// Render the production dice methods to SVG/PNG without launching Cocos.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const sharp = require('sharp');
const sceneMethods = require('../tests/helpers/BattleSceneMethods.cjs');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'source_art/ui/dice-field-equipment-20261118');
class Color {
  constructor(r, g, b, a = 255) { Object.assign(this, { r, g, b, a }); }
}
const source = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');
const names = ['DIE_FACE_FILL', 'DIE_FACE_USED_FILL', 'DIE_FACE_BORDER', 'DIE_FACE_SELECTED',
  'DIE_FACE_TEXT', 'DIE_FACE_TEXT_USED', 'AI_ATTACK_DIE_FILL', 'AI_MOVE_DIE_FILL', 'AI_MISC_DIE_FILL'];
const declarations = names.map(name => source.match(new RegExp(`const ${name}\\s*=.*?;`))[0]).join('\n');
const colors = vm.runInNewContext(`${declarations}\n({${names.join(',')}})`, { Color });
const geometry = { exports: {} };
new Function('module', 'exports', ts.transpileModule(
  fs.readFileSync(path.join(root, 'assets/scripts/view/DiceRollGeometry.ts'), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText)(geometry, geometry.exports);
const Scene = sceneMethods(['drawDieBody', 'drawRoundedDieBody', 'drawDiePips', 'drawInsetDiePip', 'drawRollingDie'], {
  Color, ...geometry.exports,
});
const scene = new Scene();
const n = value => Number(value.toFixed(3));
const ink = color => `rgba(${color.r},${color.g},${color.b},${color.a / 255})`;
class SVGGraphics {
  constructor() { this.parts = []; this.commands = []; }
  moveTo(x, y) { this.commands.push(`M${n(x)} ${n(y)}`); }
  lineTo(x, y) { this.commands.push(`L${n(x)} ${n(y)}`); }
  close() { this.commands.push('Z'); }
  fill() { this.parts.push(`<path d="${this.commands.join(' ')}" fill="${ink(this.fillColor)}"/>`); this.commands = []; }
  stroke() { this.parts.push(`<path d="${this.commands.join(' ')}" fill="none" stroke="${ink(this.strokeColor)}" stroke-width="${this.lineWidth}" stroke-linejoin="round"/>`); this.commands = []; }
}
function die(x, y, size, pip, fill, used = false, selected = false, progress = 1) {
  const g = new SVGGraphics();
  const border = selected ? colors.DIE_FACE_SELECTED : colors.DIE_FACE_BORDER;
  const pipColor = used ? colors.DIE_FACE_TEXT_USED : colors.DIE_FACE_TEXT;
  if (progress < 1) scene.drawRollingDie(g, size, pip, progress, pip, fill, border, pipColor);
  else {
    scene.drawDieBody(g, size, size, { fill: used ? colors.DIE_FACE_USED_FILL : fill, border, lineWidth: selected ? 4 : 2, shadow: !used });
    scene.drawDiePips(g, pip, size, pipColor);
  }
  return `<g transform="translate(${x} ${y}) scale(1 -1)">${g.parts.join('')}</g>`;
}
function text(x, y, value, size = 17, color = '#dcd5bd', anchor = 'middle') {
  return `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" text-anchor="${anchor}" font-family="Microsoft YaHei, sans-serif">${value}</text>`;
}
async function main() {
  fs.mkdirSync(out, { recursive: true });
  const parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="960" height="400" viewBox="0 0 960 400">',
    '<rect width="960" height="400" fill="#101714"/>',
    text(42, 38, '二战野战器材 · 骰子外观', 23, '#e9dfc4', 'start'),
    text(42, 66, '橄榄绿烤漆 / 攻击　　蓝灰钢色 / 移动　　旧黄铜色 / 杂项', 14, '#99a18e', 'start')];
  const fills = Array(5).fill(colors.AI_ATTACK_DIE_FILL).concat(colors.AI_MOVE_DIE_FILL, colors.DIE_FACE_USED_FILL, colors.DIE_FACE_USED_FILL);
  const labels = ['装填', '机枪', '机枪', '机枪', '主炮', '转向', '已用', '已用'];
  [1, 3, 4, 4, 5, 2, 5, 6].forEach((pip, i) => {
    const x = 112 + i * 105;
    parts.push(die(x, 130, 76, pip, fills[i], i >= 6));
    parts.push(text(x, 196, labels[i], 21, i >= 6 ? '#89917f' : '#e5dcc0'));
  });
  parts.push('<path d="M42 226H918" stroke="#303a30"/>', text(42, 257, '原尺寸与状态', 14, '#99a18e', 'start'));
  const states = [
    ['通用', colors.DIE_FACE_FILL, 6, false, false, 1],
    ['攻击', colors.AI_ATTACK_DIE_FILL, 3, false, false, 1],
    ['移动', colors.AI_MOVE_DIE_FILL, 2, false, false, 1],
    ['杂项', colors.AI_MISC_DIE_FILL, 4, false, false, 1],
    ['选中', colors.AI_ATTACK_DIE_FILL, 5, false, true, 1],
    ['已用', colors.DIE_FACE_USED_FILL, 5, true, false, 1],
    ['掷骰中', colors.AI_MOVE_DIE_FILL, 3, false, false, .3],
    ['掷骰中', colors.AI_ATTACK_DIE_FILL, 5, false, false, .5],
  ];
  states.forEach(([label, fill, pip, used, selected, progress], i) => {
    const x = 112 + i * 105;
    parts.push(die(x, 309, 58, pip, fill, used, selected, progress), text(x, 367, label, 15));
  });
  parts.push('</svg>');
  const svg = parts.join('\n');
  fs.writeFileSync(path.join(out, 'preview.svg'), svg);
  await sharp(Buffer.from(svg)).png().toFile(path.join(out, 'preview.png'));
  console.log(path.join(out, 'preview.png'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
