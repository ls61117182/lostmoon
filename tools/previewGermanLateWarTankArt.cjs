'use strict';
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText, file);
const root = path.resolve(__dirname, '..');
const { GERMAN_LATE_WAR_VISUAL_KINDS, lateWarTankVisualAssetConfigOf } = require('../assets/scripts/core/TankCamouflage.ts');
const { tankVisualConfigOf, splitTankVisualConfigOf, splitTankGeometryConfigOf, SPLIT_TANK_KINDS, tankVisualAssetConfigOf } = require('../assets/scripts/core/TankVisualDB.ts');
const { t } = require('../assets/scripts/core/Lang.ts');
const out = path.join(root, 'source_art/tanks/german-late-war');
const file = p => path.join(root, 'assets/resources', p.replace('/spriteFrame', '.png'));
async function runtimeTop(kind, lateWar) {
  const paths = lateWar ? lateWarTankVisualAssetConfigOf(kind) : tankVisualAssetConfigOf(kind);
  const hexR = 56;
  if (!SPLIT_TANK_KINDS.includes(kind)) {
    const width = Math.round(hexR * 1.8 * tankVisualConfigOf(kind).fitScale);
    return sharp(file(paths.topSpritePath)).resize({ width, height: width, fit: 'inside' }).png().toBuffer();
  }
  const cfg = splitTankVisualConfigOf(kind), geo = splitTankGeometryConfigOf(kind);
  const scale = hexR * 1.8 * cfg.hullFitScale / Math.max(geo.topTrim.w, geo.topTrim.h);
  const turretScale = scale * cfg.turretScale;
  const hw = Math.round(geo.topTrim.w * scale), hh = Math.round(geo.topTrim.h * scale);
  const tw = Math.round(geo.turretTrim.w * turretScale), th = Math.round(geo.turretTrim.h * turretScale);
  const tx = Math.round(geo.pivot.bodyX * scale - geo.pivot.spriteX * turretScale - cfg.turretOffsetForward * hexR * Math.sqrt(3));
  const ty = Math.round(geo.pivot.bodyY * scale - geo.pivot.spriteY * turretScale + cfg.turretOffsetRight * hexR * Math.sqrt(3));
  const left = Math.min(0, tx), top = Math.min(0, ty);
  const width = Math.max(hw, tx + tw) - left, height = Math.max(hh, ty + th) - top;
  const hull = await sharp(file(paths.hullSpritePath)).resize(hw, hh).png().toBuffer();
  const turret = await sharp(file(paths.turretSpritePath)).resize(tw, th).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([
    { input: hull, left: -left, top: -top }, { input: turret, left: tx - left, top: ty - top },
  ]).png().toBuffer();
}
async function main() {
  fs.mkdirSync(path.join(out, 'runtime-size'), { recursive: true });
  const W = 1920, H = 1600, layers = [];
  const text = (x, y, s, size = 20, color = '#e5e5da') => `<text x="${x}" y="${y}" font-family="Microsoft YaHei,Arial,sans-serif" font-size="${size}" fill="${color}">${s}</text>`;
  let svg = `<svg width="${W}" height="${H}"><rect width="100%" height="100%" fill="#20282d"/>`;
  svg += text(35, 48, '德军后期三色迷彩 · 全部 16 个车型', 32);
  svg += text(35, 83, '每格：正常 / 击毁放大预览；右下为地图尺度（hexR=56）合成。原德军灰资源保持不变。', 20, '#afbec5');
  for (let i = 0; i < GERMAN_LATE_WAR_VISUAL_KINDS.length; i++) {
    const kind = GERMAN_LATE_WAR_VISUAL_KINDS[i], x = 20 + i % 4 * 475, y = 110 + Math.floor(i / 4) * 360;
    svg += `<rect x="${x}" y="${y}" width="460" height="345" rx="8" fill="#354047" stroke="#56646c"/>`;
    svg += text(x + 16, y + 29, t(`unit.name.${kind}`), 23);
    svg += text(x + 16, y + 54, kind, 15, '#acbbc0');
    const normal = await runtimeTop(kind, true);
    await fs.promises.writeFile(path.join(out, 'runtime-size', `${kind}.png`), normal);
    const n = await sharp(normal).metadata();
    const large = await sharp(normal).resize(n.width * 3, n.height * 3, { kernel: 'nearest' }).resize({ width: 415, height: 132, fit: 'inside', kernel: 'nearest' }).png().toBuffer();
    const lm = await sharp(large).metadata();
    layers.push({ input: large, left: Math.round(x + (460 - lm.width) / 2), top: Math.round(y + 65 + (132 - lm.height) / 2) });
    const wreckFile = file(lateWarTankVisualAssetConfigOf(kind).destroyedSpritePath);
    const wreck = await sharp(wreckFile).resize({ width: 290, height: 112, fit: 'inside', kernel: 'nearest' }).png().toBuffer();
    const wm = await sharp(wreck).metadata();
    layers.push({ input: wreck, left: Math.round(x + 18 + (285 - wm.width) / 2), top: Math.round(y + 203 + (112 - wm.height) / 2) });
    layers.push({ input: normal, left: x + 310, top: y + 258 });
    svg += text(x + 18, y + 331, '击毁', 16, '#aebcc1');
    svg += text(x + 310, y + 331, '地图尺寸', 16, '#aebcc1');
  }
  svg += text(35, 1583, '默认：德军灰  |  关卡 germanTankCamouflage: "late_war" → 全关德军坦克切换为后期配色', 20, '#c7c9af');
  svg += '</svg>';
  await sharp(Buffer.from(svg)).composite(layers).png().toFile(path.join(out, 'all-tanks-preview.png'));
  console.log(path.join(out, 'all-tanks-preview.png'));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
