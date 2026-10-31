#!/usr/bin/env node
'use strict';

// Deterministic finishing of the generated raster, authorized local layer work,
// shared-scale composition, previews, and Cocos sprite-frame metadata.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'source_art/tanks/pak43');
const output = path.join(root, 'assets/resources/textures/units');
const W = 200, H = 133, DENSITY = 10;
const svg = body => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W * DENSITY}" height="${H * DENSITY}" viewBox="0 0 ${W} ${H}">${body}</svg>`);

function carriage() {
  // Dimensions follow the deployed cruciform plan, with the bearing at 133,66.5.
  // The front/rear bogies are detached in this firing configuration.
  return `<g stroke="#24271e" stroke-width="1.05" stroke-linejoin="round">
    <path d="M130 61L72 62L70 65L72 70L130 71Z" fill="#73765b"/>
    <path d="M139 62L191 63L194 66.5L190 70L139 71Z" fill="#73765b"/>
    <path d="M129.5 61L130 19L133 16L136 19L136.5 61Z" fill="#808167"/>
    <path d="M129.5 72L130 113L133 117L136 113L136.5 72Z" fill="#808167"/>
    <path d="M73 63H124M142 64H187M132 22V55M132 77V110" stroke="#b0ae8d" stroke-width="1.15"/>
    <path d="M76 68H124M143 69H188M135 24V55M135 77V110" stroke="#50543f" stroke-width=".7"/>
    <path d="M65 61L72 59L77 62L77 71L72 74L65 72Z" fill="#85856a"/>
    <path d="M190 61L196 62L199 66.5L196 72L190 73L188 70L188 63Z" fill="#85856a"/>
    <path d="M127 18L127 13L130 10L136 10L139 13L139 18L136 21H130Z" fill="#85856a"/>
    <path d="M127 114L130 111H136L139 114V120L136 123H130L127 120Z" fill="#85856a"/>
    <path d="M67 63L73 62M191 63L195 64M130 12H136M130 115H136" stroke="#c0bda1" stroke-width="1.1"/>
    <path d="M69 59V74M195 61V73M126 15H140M126 118H140" stroke="#3c4031" stroke-width="1.3"/>
    <g fill="#b2b094"><circle cx="70" cy="66.5" r="1.7"/><circle cx="193" cy="66.5" r="1.7"/>
      <circle cx="133" cy="15.5" r="1.7"/><circle cx="133" cy="117.5" r="1.7"/></g>
    <circle cx="133" cy="66.5" r="9.1" fill="#61664e"/>
    <circle cx="133" cy="66.5" r="6.3" fill="#898970"/>
    <circle cx="133" cy="66.5" r="3.6" fill="#424736"/>
    <path d="M127 61L129 59M137 59L139 61M127 72L129 74M137 74L139 72" stroke="#b6b399" stroke-width="1.2"/>
  </g>`;
}

async function writeMeta(name) {
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
    plates.push({ input: await sharp(input).resize(W * 3, H * 3, { kernel: 'nearest' }).toBuffer(), left: x, top: 42 });
    // Actual battlefield display at the standard 64px hex radius: 115px long.
    plates.push({ input: await sharp(input).resize(115, 76).toBuffer(), left: x, top: 485 });
    plates.push({ input: await sharp(input).toBuffer(), left: x + 180, top: 465 });
  }
  const labels = `<svg width="1320" height="590"><g fill="#ebe9dc" font-family="sans-serif" font-size="20">
    <text x="20" y="28">Pak 43 — intact / 3× pixels</text><text x="680" y="28">Destroyed / 3× pixels</text>
    <text x="20" y="465">Battle size</text><text x="200" y="455">200px texture</text>
    <text x="680" y="465">Battle size</text><text x="860" y="455">200px texture</text></g></svg>`;
  await sharp({ create: { width: 1320, height: 620, channels: 4, background: '#414938' } })
    .composite([...plates, { input: Buffer.from(labels) }]).png().toFile(path.join(source, 'preview.png'));

  // Full circle of aim with a stationary carriage and a pivoted gun.
  const base = await sharp(path.join(output, 'pak43_top_hull.png')).resize(240, 160).toBuffer();
  const gun = fs.readFileSync(path.join(output, 'pak43_top_turret.png')).toString('base64');
  let rotations = '';
  for (let i = 0; i < 12; i++) {
    const x = (i % 4) * 360, y = Math.floor(i / 4) * 360;
    const base64 = base.toString('base64');
    rotations += `<g transform="translate(${x + 20.4} ${y + 100})"><image href="data:image/png;base64,${base64}" width="240" height="160"/>
      <g transform="rotate(${i * 30} 159.6 80)"><image href="data:image/png;base64,${gun}" width="240" height="160"/></g>
      <circle cx="159.6" cy="80" r="1.5" fill="#f0cb65"/></g>`;
  }
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1080"><rect width="1440" height="1080" fill="#414938"/>${rotations}</svg>`))
    .png().toFile(path.join(source, 'rotation-preview.png'));
}

async function main() {
  const draft = path.join(source, 'gun-draft-generated.png');
  // Discard fixed longitudinal support beams included in the generation.
  // Preserve the generated gun, asymmetric shield, and compact breech.
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2115" height="743">
    <g fill="white"><path d="M0 348H1110V418H0Z"/>
      <path d="M1090 300H1500V475H1090Z"/><path d="M1145 90H1605V675H1145Z"/>
      <path d="M1590 338H1735V428H1590Z"/><path d="M1580 432H1665V590H1580Z"/></g></svg>`);
  const clean = await sharp(draft).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const scale = 129 / (1510 - 35);
  const tx = 133 - 1510 * scale, ty = 66.5 - 383 * scale;
  const png = clean.toString('base64');
  const upperSvg = `<image href="data:image/png;base64,${png}" x="${tx}" y="${ty}" width="${2115 * scale}" height="${743 * scale}"/>
    <path d="M${tx + 1735 * scale} ${ty + 345 * scale}v${77 * scale}" stroke="#25281e" stroke-width=".8"/>`;
  const base = await sharp(svg(carriage())).png().toBuffer();
  const upper = await sharp(svg(upperSvg)).png().toBuffer();
  await sharp(base).toFile(path.join(source, 'base-finished.png'));
  await sharp(upper).toFile(path.join(source, 'gun-finished.png'));
  const intact = await sharp(base).composite([{ input: upper }]).png().toBuffer();
  await sharp(intact).toFile(path.join(source, 'top-finished.png'));

  // Keep the canvas and all base geometry fixed. A large missing barrel section
  // and two local torn shield patches distinguish the wreck at battle scale.
  const damageMask = svg(`<path d="M84 0H200V133H84V69L87 68L84 66L87 64L84 62Z" fill="white"/>
    <path d="M113 42L117 46L120 44L123 49L128 46L133 50V36H113Z" fill="black"/>`);
  const brokenUpper = await sharp(upper).composite([{ input: damageMask, blend: 'dest-in' }]).png().toBuffer();
  const damage = svg(`<g stroke-linejoin="round">
    <path d="M113 43L117 47L120 45L123 50L128 47L133 51L133 54L127 51L123 54L119 49L116 51L111 47Z" fill="#4b4d3b" stroke="#24271f" stroke-width=".9"/>
    <path d="M113 44L117 48L120 46L123 51M128 48L132 51" fill="none" stroke="#bbb797" stroke-width="1"/>
    <path d="M112 75L117 71L123 73L127 78L124 84L117 87L111 82Z" fill="#45483a"/>
    <path d="M115 76L119 74L122 76L125 79L121 83L117 84L113 80Z" fill="#1f241d" stroke="#24271e" stroke-width="1.2"/>
    <path d="M116 76L119 75L122 77M114 80L117 84L121 83" fill="none" stroke="#aaa78a" stroke-width=".9"/>
    <path d="M125 78L132 74L129 69M119 84L118 89M113 78L109 75" fill="none" stroke="#292d22" stroke-width="1"/>
    <path d="M85 64L88 65L86 66.5L88 68L85 69" fill="none" stroke="#c6c0a2" stroke-width="1.1"/>
  </g>`);
  // The detached original muzzle and tube remain in the original source scale.
  const debris = svg(`<defs><clipPath id="tube"><path d="M3 62H53V71H3Z"/></clipPath></defs>
    <g transform="translate(15 47) rotate(-12 28 66.5)" clip-path="url(#tube)">${upperSvg}</g>`);
  const wreck = await sharp(base).composite([{ input: brokenUpper }, { input: damage }, { input: debris }]).png().toBuffer();
  await sharp(wreck).toFile(path.join(source, 'destroyed-finished.png'));
  for (const [name, input] of [['pak43_top_hull', base], ['pak43_top_turret', upper], ['pak43_top_destroyed', wreck]]) {
    await sharp(input).resize(W, H, { kernel: 'lanczos3' }).png().toFile(path.join(output, `${name}.png`));
    await writeMeta(name);
  }
  // Composite the actual final-resolution layers, avoiding independent resampling.
  await sharp(path.join(output, 'pak43_top_hull.png')).composite([{ input: path.join(output, 'pak43_top_turret.png') }])
    .png().toFile(path.join(output, 'pak43_top.png'));
  await writeMeta('pak43_top');
  await preview();
  console.log('Pak 43: prepared four shared-canvas 200x133 sprites, metadata, and previews.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
