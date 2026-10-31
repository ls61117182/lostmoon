#!/usr/bin/env node
'use strict';

// Approved Pak 43/41: one complete deployed split-trail sprite. The generated
// normal art is uniformly scaled; local wreck work preserves that same canvas.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'source_art/tanks/pak43');
const output = path.join(root, 'assets/resources/textures/units');
const W = 200, H = 67, DENSITY = 10;
const svg = body => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W * DENSITY}" height="${H * DENSITY}" viewBox="0 0 ${W} ${H}">${body}</svg>`);

function writeMeta(name) {
  const file = path.join(output, `${name}.png.meta`);
  let meta = JSON.parse(fs.readFileSync(fs.existsSync(file) ? file : path.join(output, 'pak38_top.png.meta'), 'utf8'));
  if (!fs.existsSync(file)) meta = JSON.parse(JSON.stringify(meta).replaceAll(meta.uuid, randomUUID()).replaceAll('pak38_top', name));
  const frame = meta.subMetas.f9941.userData, hw = W / 2, hh = H / 2;
  Object.assign(frame, { width: W, height: H, rawWidth: W, rawHeight: H, trimX: 0, trimY: 0, offsetX: 0, offsetY: 0, trimType: 'none' });
  frame.vertices = { rawPosition: [-hw,-hh,0,hw,-hh,0,-hw,hh,0,hw,hh,0], indexes: [0,1,2,2,1,3],
    uv: [0,H,W,H,0,0,W,0], nuv: [0,0,1,0,0,1,1,1], minPos: [-hw,-hh,0], maxPos: [hw,hh,0] };
  fs.writeFileSync(file, JSON.stringify(meta, null, 2) + '\n');
}

async function preview() {
  const plates = [];
  for (const [name, x] of [['pak43_top', 20], ['pak43_top_destroyed', 680]]) {
    const input = path.join(output, `${name}.png`);
    plates.push({ input: await sharp(input).resize(W * 3, H * 3, { kernel: 'nearest' }).toBuffer(), left: x, top: 46 });
    plates.push({ input: await sharp(input).resize(115, 39).toBuffer(), left: x, top: 305 });
    plates.push({ input: await sharp(input).toBuffer(), left: x + 180, top: 290 });
  }
  const labels = `<svg width="1320" height="380"><g fill="#ebe9dc" font-family="sans-serif" font-size="20">
    <text x="20" y="28">Pak 43/41 — V-spread firing position / 3×</text><text x="680" y="28">Destroyed / same deployed stance</text>
    <text x="20" y="285">Battle size</text><text x="200" y="280">200px texture</text>
    <text x="680" y="285">Battle size</text><text x="860" y="280">200px texture</text></g></svg>`;
  await sharp({ create: { width: 1320, height: 380, channels: 4, background: '#414938' } })
    .composite([...plates, { input: Buffer.from(labels) }]).png().toFile(path.join(source, 'preview.png'));

  // All directions rotate the COMPLETE deployed carriage, like Pak 38.
  const gun = fs.readFileSync(path.join(output, 'pak43_top.png')).toString('base64');
  let rotations = '';
  for (let i = 0; i < 12; i++) {
    const x = (i % 4) * 300, y = Math.floor(i / 4) * 300;
    rotations += `<g transform="translate(${x + 30} ${y + 109.8}) rotate(${i * 30} 120 40.2)">
      <image href="data:image/png;base64,${gun}" width="240" height="80.4"/></g>`;
  }
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#414938"/>${rotations}</svg>`))
    .png().toFile(path.join(source, 'rotation-preview.png'));
}

async function main() {
  // Preserve the generated proportions. The 3:1 source uniformly scales to
  // 2000x667; the final three rows only pad the shared master canvas.
  const resized = await sharp(path.join(source, 'pak4341-deployed-generated.png')).ensureAlpha()
    .resize({ width: W * DENSITY }).png().toBuffer();
  const info = await sharp(resized).metadata();
  if (info.height > H * DENSITY) throw new Error('source aspect ratio changed; recalibrate rather than stretch the gun');
  const intact = await sharp(resized).extend({ top: 0, bottom: H * DENSITY - info.height, left: 0, right: 0,
    background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp(intact).toFile(path.join(source, 'pak4341-deployed-finished.png'));

  // User-authorized local wreck work after imagegen rejected the wreck edit.
  // Both long trails and wheel locations remain pixel-identical to normal art.
  const mask = svg(`<path d="M59 0H200V67H59V36L61 35L58.5 33L61 31L59 30Z" fill="white"/>
    <path d="M121 20L122 22L119 24L120 27L115 29L112 28L118 21Z" fill="black"/>`);
  const broken = await sharp(intact).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const damage = svg(`<g stroke-linejoin="round">
    <path d="M121 21L122 23L120 24L121 27L116 30L112 28L113 27L116 28L119 26L118 24Z" fill="#424534" stroke="#24291d" stroke-width=".7"/>
    <path d="M120 23L119 24L120 26L116 29L113 28" fill="none" stroke="#bab594" stroke-width=".7"/>
    <path d="M111 41L116 40L121 43L122 47L117 49L112 47Z" fill="#494b39"/>
    <path d="M113 42L117 42L119 44L118 47L114 47L112 45Z" fill="#20251c" stroke="#272b20" stroke-width=".6"/>
    <path d="M113 42L117 41.5L119 44M112 45L114 47L118 47" fill="none" stroke="#b3ae8d" stroke-width=".6"/>
    <path d="M118 47L123 48M114 42L110 39" fill="none" stroke="#292d20" stroke-width=".65"/>
    <path d="M59 31L61 32L59 33L61 35L59 36" fill="none" stroke="#c3bfa0" stroke-width=".8"/>
  </g>`);
  const image = `<image href="data:image/png;base64,${intact.toString('base64')}" width="200" height="67"/>`;
  const debris = svg(`<defs><clipPath id="barrel"><path d="M5 29H48V36H5Z"/></clipPath></defs>
    <g transform="translate(9 19) rotate(-10 26 33)"><g clip-path="url(#barrel)">${image}</g></g>`);
  const wreck = await sharp(broken).composite([{ input: damage }, { input: debris }]).png().toBuffer();
  await sharp(wreck).toFile(path.join(source, 'pak4341-destroyed-finished.png'));
  for (const [name, input] of [['pak43_top', intact], ['pak43_top_destroyed', wreck]]) {
    await sharp(input).resize(W, H, { kernel: 'lanczos3' }).png().toFile(path.join(output, `${name}.png`));
    writeMeta(name);
  }
  await preview();
  console.log('Pak 43/41: prepared normal/wreck 200x67 sprites with both trails deployed in a V.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
