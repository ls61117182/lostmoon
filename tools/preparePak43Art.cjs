#!/usr/bin/env node
'use strict';

// Approved Pak 43/41: proportions calibrated to the plan before uniform export.
// Local wreck work preserves the corrected normal art's canvas and geometry.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const { normalizePak43Geometry, previewPak43Proportions } = require('./normalizePak43Geometry.cjs');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'source_art/tanks/pak43');
const output = path.join(root, 'assets/resources/textures/units');
const W = 200, H = 80, DENSITY = 10;
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

async function preview(calibration) {
  const plates = [];
  for (const [name, x] of [['pak43_top', 20], ['pak43_top_destroyed', 680]]) {
    const input = path.join(output, `${name}.png`);
    plates.push({ input: await sharp(input).resize(W * 3, H * 3, { kernel: 'nearest' }).toBuffer(), left: x, top: 46 });
    plates.push({ input: await sharp(input).resize(115, 46).toBuffer(), left: x, top: 350 });
    plates.push({ input: await sharp(input).toBuffer(), left: x + 180, top: 330 });
  }
  const labels = `<svg width="1320" height="440"><g fill="#ebe9dc" font-family="sans-serif" font-size="20">
    <text x="20" y="28">Pak 43/41 — plan-calibrated proportions / 3×</text><text x="680" y="28">Destroyed / same corrected geometry</text>
    <text x="20" y="320">Battle size</text><text x="200" y="315">200px texture</text>
    <text x="680" y="320">Battle size</text><text x="860" y="315">200px texture</text></g></svg>`;
  await sharp({ create: { width: 1320, height: 440, channels: 4, background: '#414938' } })
    .composite([...plates, { input: Buffer.from(labels) }]).png().toFile(path.join(source, 'preview.png'));

  // All directions rotate the COMPLETE deployed carriage, like Pak 38.
  const gun = fs.readFileSync(path.join(output, 'pak43_top.png')).toString('base64');
  let rotations = '';
  const pivot = { x: calibration.output.axle.x * 1.2, y: calibration.output.axle.y * 1.2 };
  for (let i = 0; i < 12; i++) {
    const x = (i % 4) * 300, y = Math.floor(i / 4) * 300;
    rotations += `<g transform="translate(${x + 150 - pivot.x} ${y + 150 - pivot.y}) rotate(${i * 30} ${pivot.x} ${pivot.y})">
      <image href="data:image/png;base64,${gun}" width="240" height="96"/></g>`;
  }
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#414938"/>${rotations}</svg>`))
    .png().toFile(path.join(source, 'rotation-preview.png'));
}

async function main() {
  const { image: corrected, calibration } = await normalizePak43Geometry();
  const intact = await sharp(corrected).ensureAlpha().resize(W * DENSITY, H * DENSITY).png().toBuffer();
  await sharp(intact).toFile(path.join(source, 'pak4341-deployed-finished.png'));

  // User-authorized local wreck work after imagegen rejected the wreck edit.
  // Both long trails and wheel locations remain pixel-identical to normal art.
  const mask = svg(`<path d="M87 0H200V80H87V43L90 41L86.5 39L89 37L87 34Z" fill="white"/>
    <path d="M117 23L128 21L130 26L125 28L127 31L120 34L116 32L119 29L115 28Z" fill="black"/>
    <path d="M116 49L120 46L125 48L123 51L129 53L126 58L116 56Z" fill="black"/>
    <path d="M132 34L144 33V43L131 44L133 41L129 39L133 37Z" fill="black"/>`);
  const broken = await sharp(intact).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  // Large, localized soot shapes follow the existing carriage alpha. Preserve
  // the original paint on the outer trails and wheels instead of tinting all art.
  const scorch = await sharp(svg(`<g stroke-linejoin="round">
    <path d="M103 30L109 27L116 27L121 30L130 32L135 37L130 45L123 46L118 51L110 48L105 43L101 38Z" fill="#262821" fill-opacity=".92"/>
    <path d="M111 27L117 25L124 25L128 28L124 32L116 35L111 33Z M110 44L119 45L126 49L123 53L116 51L111 49Z" fill="#34372b" fill-opacity=".85"/>
    <path d="M127 29L140 24L145 24L141 28L131 33Z M127 47L140 51L144 55L137 53L129 52Z" fill="#393c2e" fill-opacity=".75"/>
  </g>`)).composite([{ input: broken, blend: 'dest-in' }]).png().toBuffer();
  const damage = svg(`<g stroke-linejoin="round">
    <!-- Torn upper shield: a broad missing section with one folded lip. -->
    <path d="M116 26L119 28L116 31L120 33L125 30L123 29L120 30L121 27Z" fill="#686b55" stroke="#25281e" stroke-width=".85"/>
    <path d="M116 26L119 28L116 31L120 33L125 30" fill="none" stroke="#b2af91" stroke-width=".65"/>
    <!-- Lower shield is peeled outwards; its torn edge stays conspicuous. -->
    <path d="M111 46L116 47L119 50L116 53L120 56L115 55L111 51Z" fill="#5e624c" stroke="#22271e" stroke-width=".9"/>
    <path d="M116 47L119 50L116 53L120 56" fill="none" stroke="#b5b096" stroke-width=".7"/>
    <!-- Ruptured breech and a displaced mechanical block, with heavy outlines. -->
    <path d="M113 35L119 33L125 35L129 34L132 37L129 39L132 42L126 44L121 42L115 43L111 39Z" fill="#171d18" stroke="#101610" stroke-width=".9"/>
    <path d="M114 35L119 36L120 40L116 41L113 39Z" fill="#64674f" stroke="#292e22" stroke-width=".7"/>
    <path d="M122 35L126 36L125 39L129 41L124 42L121 39Z" fill="#484d3a" stroke="#191f17" stroke-width=".7"/>
    <path d="M130 43L136 44L135 49L129 47Z" fill="#676a53" stroke="#20271c" stroke-width="1"/>
    <path d="M130 43L133 45L136 44M133 45L132 48" fill="none" stroke="#aaa78c" stroke-width=".6"/>
    <path d="M129 35L132 37L129 39L132 42L128 43" fill="none" stroke="#aaa58c" stroke-width=".8"/>
    <!-- Short ragged barrel stump with dark exposed bore. -->
    <path d="M87 34L89 37L86.5 39L90 41L87 43" fill="none" stroke="#b5b095" stroke-width=".9"/>
    <path d="M88.7 36L91 36L91 41L89 40L90 38Z" fill="#1c221a"/>
    <path d="M101 36L104 37L106 40L103 41L100 40Z" fill="#22271d"/>
  </g>`);
  const image = `<image href="data:image/png;base64,${intact.toString('base64')}" width="200" height="80"/>`;
  const debris = svg(`<defs><clipPath id="barrel"><path d="M25 34H82V42H25Z"/></clipPath>
    <clipPath id="muzzle"><path d="M2 34H20V42H2Z"/></clipPath></defs>
    <g transform="translate(0 15) rotate(-13 54 38)"><g clip-path="url(#barrel)">${image}</g>
      <path d="M81 35L79 37L82 39L80 41M26 36L28 38L26 40" fill="none" stroke="#b5b095" stroke-width=".65"/></g>
    <g transform="translate(8 26) rotate(18 11 38)"><g clip-path="url(#muzzle)">${image}</g></g>`);
  const wreck = await sharp(broken).composite([{ input: scorch }, { input: damage }, { input: debris }]).png().toBuffer();
  await sharp(wreck).toFile(path.join(source, 'pak4341-destroyed-finished.png'));
  for (const [name, input] of [['pak43_top', intact], ['pak43_top_destroyed', wreck]]) {
    await sharp(input).resize(W, H, { kernel: 'lanczos3' }).png().toFile(path.join(output, `${name}.png`));
    writeMeta(name);
  }
  const csv = path.join(root, 'data/tank_visuals.csv');
  const csvText = fs.readFileSync(csv, 'utf8');
  const lines = csvText.split(/\r?\n/), headers = lines[0].replace(/^\uFEFF/, '').split(',');
  const rowIndex = lines.findIndex(line => line.startsWith('pak43,'));
  if (rowIndex < 0) throw new Error('missing pak43 visual row');
  const row = lines[rowIndex].split(',');
  const offsets = { forward: (calibration.output.axle.x - W / 2) * 1.8 / (W * Math.sqrt(3)),
    right: (calibration.output.axle.y - H / 2) * 1.8 / (W * Math.sqrt(3)) };
  const updates = { muzzleSpriteX: calibration.output.muzzle.x, muzzleSpriteY: calibration.output.muzzle.y,
    offsetForward: offsets.forward, offsetRight: offsets.right };
  for (const [field, value] of Object.entries(updates)) row[headers.indexOf(field)] = String(Number(value.toFixed(6)));
  row[headers.indexOf('notes')] = 'Pak 43/41 V-spread firing position; wheel-normalized plan geometry; barrel reach 3.698 wheel diameters and trail length 2.354; shared corrected 200x80 canvas; whole-gun aiming';
  lines[rowIndex] = row.join(',');
  const updatedCsv = lines.join('\r\n');
  if (updatedCsv !== csvText) fs.writeFileSync(csv, updatedCsv);
  await preview(calibration);
  await previewPak43Proportions();
  console.log('Pak 43/41: calibrated to approved plan; normal/wreck 200x80; V-spread trails retained.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
