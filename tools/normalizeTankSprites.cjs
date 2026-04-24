/**
 * 裁去单位俯视图四周空白（透明或近白底），再统一为相同像素画布（contain 居中）。
 * 与谢尔曼相同：边界泛洪去浅底 + 近白漂白 + bbox，最后所有车同一 W×H。
 * 用法（仓库根目录）：npm install && node tools/normalizeTankSprites.cjs
 * 完成后请在 Cocos Creator 中对改动的 PNG 各执行一次「重新导入资源」以刷新 .meta。
 */
const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('请先安装 sharp：npm install sharp --save-dev');
  process.exit(1);
}

const UNITS = path.join(__dirname, '..', 'assets', 'resources', 'textures', 'units');
/** 统一画布长边至少如此像素（不足则整体放大） */
const MIN_LONG_EDGE = 400;

/** 参与统一尺寸的 PNG 基名（不含扩展名） */
const SPRITE_BASES = [
  'sherman_top',
  'panzer4_top',
  'panzer3_top',
  'tiger_top',
  'truck_top',
];

function lum(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
function sat(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function removeEdgeConnectedLightBackground(buf, w, h, channels) {
  const n = w * h;
  const cand = new Uint8Array(n);
  const marked = new Uint8Array(n);
  const L0 = 218;
  const S0 = 55;
  const A0 = 40;
  for (let i = 0; i < n; i++) {
    const o = i * channels;
    const r = buf[o];
    const g = buf[o + 1];
    const b = buf[o + 2];
    const a = channels >= 4 ? buf[o + 3] : 255;
    cand[i] = a > A0 && lum(r, g, b) > L0 && sat(r, g, b) < S0 ? 1 : 0;
  }
  const q = [];
  const push = (idx) => {
    if (idx < 0 || idx >= n || marked[idx] || !cand[idx]) return;
    marked[idx] = 1;
    q.push(idx);
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + (w - 1));
  }
  while (q.length) {
    const i = q.pop();
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  let sumL = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    if (!marked[i]) continue;
    const o = i * channels;
    sumL += lum(buf[o], buf[o + 1], buf[o + 2]);
    cnt++;
  }
  if (cnt > n * 0.92) return;
  const meanL = cnt ? sumL / cnt : 0;
  if (meanL < 232) return;
  for (let i = 0; i < n; i++) {
    if (!marked[i]) continue;
    const o = i * channels;
    buf[o] = 0;
    buf[o + 1] = 0;
    buf[o + 2] = 0;
    buf[o + 3] = 0;
  }
}

function bleachNearWhite(buf, w, h, channels) {
  for (let i = 0; i < w * h; i++) {
    const o = i * channels;
    const r = buf[o];
    const g = buf[o + 1];
    const b = buf[o + 2];
    const a = channels >= 4 ? buf[o + 3] : 255;
    if (a < 32) continue;
    if (r >= 228 && g >= 228 && b >= 228 && a > 180) {
      buf[o] = 0;
      buf[o + 1] = 0;
      buf[o + 2] = 0;
      buf[o + 3] = 0;
    }
  }
}

function bboxContent(buf, w, h, channels) {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      const a = buf[i + 3];
      const transparent = a < 24;
      const nearWhite = r >= 252 && g >= 252 && b >= 252 && a > 230;
      const isBg = transparent || nearWhite;
      if (!isBg) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return null;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  if (width < 4 || height < 4) return null;
  return { left: minX, top: minY, width, height };
}

async function preprocessRaw(absPath) {
  const { data, info } = await sharp(absPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  const copy = Buffer.from(data);
  removeEdgeConnectedLightBackground(copy, w, h, ch);
  bleachNearWhite(copy, w, h, ch);
  return sharp(copy, { raw: { width: w, height: h, channels: ch } }).ensureAlpha();
}

async function trimSmart(absPath) {
  const base = await preprocessRaw(absPath);
  const { data, info } = await base.clone().raw().toBuffer({ resolveWithObject: true });
  const box = bboxContent(data, info.width, info.height, info.channels);
  let p = base;
  if (box) {
    p = p.extract(box);
  } else {
    try {
      p = base.trim({ threshold: 12 });
    } catch {
      return base.png();
    }
  }
  return p.png();
}

async function main() {
  const paths = [];
  for (const base of SPRITE_BASES) {
    const p = path.join(UNITS, `${base}.png`);
    if (!fs.existsSync(p)) {
      console.error('缺少文件:', p);
      process.exit(1);
    }
    paths.push({ base, abs: p });
  }

  const buffers = [];
  for (const { base, abs } of paths) {
    const buf = await trimSmart(abs).then((x) => x.toBuffer());
    buffers.push({ base, buf });
  }

  let W = 0;
  let H = 0;
  for (const { buf } of buffers) {
    const m = await sharp(buf).metadata();
    W = Math.max(W, m.width || 0);
    H = Math.max(H, m.height || 0);
  }
  const long = Math.max(W, H);
  if (long > 0 && long < MIN_LONG_EDGE) {
    const s = MIN_LONG_EDGE / long;
    W = Math.max(1, Math.round(W * s));
    H = Math.max(1, Math.round(H * s));
  }

  const bg = { r: 0, g: 0, b: 0, alpha: 0 };
  for (const { base, buf } of buffers) {
    const outTmp = path.join(UNITS, `${base}.png.__tmp__`);
    await sharp(buf)
      .resize(W, H, { fit: 'contain', position: 'centre', background: bg })
      .png()
      .toFile(outTmp);
    fs.renameSync(outTmp, path.join(UNITS, `${base}.png`));
  }

  console.log(`已输出统一尺寸: ${W} x ${H}（透明底 + contain 居中）`);
  console.log('请在 Cocos Creator 资源管理器中对上述 PNG →「重新导入资源」。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
