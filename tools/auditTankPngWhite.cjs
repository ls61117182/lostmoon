/**
 * 审计坦克 PNG 中「近白不透明」像素占比，追加写入仓库根目录 debug-061460.log（NDJSON）。
 * 用法：node tools/auditTankPngWhite.cjs
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const LOG = path.join(ROOT, 'debug-061460.log');
const UNITS = path.join(ROOT, 'assets', 'resources', 'textures', 'units');

async function auditFile(label, absPath) {
  const { data, info } = await sharp(absPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  let nearWhiteOpaque = 0;
  let transparent = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const o = i * ch;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const a = ch >= 4 ? data[o + 3] : 255;
    if (a < 16) transparent++;
    // 与游戏里「白底贴纸」一致：偏白且仍不透明
    if (a > 200 && r >= 235 && g >= 235 && b >= 235) nearWhiteOpaque++;
  }
  return {
    label,
    path: path.relative(ROOT, absPath),
    w,
    h,
    channels: ch,
    pctTransparent: ((transparent / n) * 100).toFixed(2),
    pctNearWhiteOpaque: ((nearWhiteOpaque / n) * 100).toFixed(2),
  };
}

async function main() {
  const sh = path.join(UNITS, 'sherman_top.png');
  const p4 = path.join(UNITS, 'panzer4_top.png');
  const lines = [];
  for (const p of [sh, p4]) {
    if (!fs.existsSync(p)) continue;
    const d = await auditFile(path.basename(p), p);
    const row = {
      sessionId: '061460',
      hypothesisId: 'H1-white-pixels',
      runId: 'audit',
      location: 'tools/auditTankPngWhite.cjs',
      message: 'PNG near-white opaque ratio',
      data: d,
      timestamp: Date.now(),
    };
    lines.push(JSON.stringify(row));
  }
  fs.appendFileSync(LOG, lines.join('\n') + '\n', 'utf8');
  console.log('Wrote', LOG);
  lines.forEach((l) => console.log(l));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
