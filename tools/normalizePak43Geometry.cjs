#!/usr/bin/env node
'use strict';

// Geometric correction against the user-approved plan. All dimensions are in
// the native 1500px plan space, using wheel diameter as the common scale.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'source_art/tanks/pak43');
const reference = {
  wheelDiameter: 215, axle: { x: 816, y: 207 }, muzzle: { x: 21, y: 207 },
  wheelCentersY: [35, 379], wheelTreadWidth: 52,
  trails: [
    { hinge: { x: 903, y: 138 }, spade: { x: 1409, y: 136 } },
    { hinge: { x: 903, y: 276 }, spade: { x: 1409, y: 279 } },
  ],
};
const generated = {
  wheelDiameter: 263, axle: { x: 1113, y: 355 }, muzzle: { x: 60, y: 355 },
  wheels: [
    { crop: { left: 970, top: 135, width: 285, height: 75 }, centerY: 174.5, treadWidth: 55 },
    { crop: { left: 970, top: 505, width: 285, height: 80 }, centerY: 540.5, treadWidth: 51 },
  ],
  trails: [
    { hinge: { x: 1225, y: 292 }, spade: { x: 1969, y: 84 } },
    { hinge: { x: 1225, y: 439 }, spade: { x: 1982, y: 638 } },
  ],
};
const canvas = { width: 1500, height: 600, yOffset: 80 };
// Fit the illustrated wheel inner edges to the carriage, rather than leaving
// the wheel crops at the ends of artificially extended support assemblies.
// Keep the plan's measured centers above separate from this art-fit placement.
const wheelLayout = { centersY: [47, 367], insetFromPrevious: 12 };
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const s = reference.wheelDiameter / generated.wheelDiameter;
const tx = reference.axle.x - generated.axle.x * s;
const ty = reference.axle.y - generated.axle.y * s;
const removeBarrel = generated.axle.x - generated.muzzle.x - (reference.axle.x - reference.muzzle.x) / s;
const cutX = 300; // Plain straight tube: muzzle brake and stepped sleeves stay intact.
const xml = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);

function legPolygon(leg, rootStart = -30) {
  const a = angle(leg.hinge, leg.spade), c = Math.cos(a), n = Math.sin(a);
  // A narrow root avoids cutting the overlapping gun shield and breech. The
  // outer region includes beam-mounted boxes, brace rods, spade, and handles.
  return [[rootStart,-27],[180,-27],[180,-110],[1000,-110],[1000,110],[180,110],[180,27],[rootStart,27]]
    .map(([x, y]) => `${leg.hinge.x + x * c - y * n},${leg.hinge.y + x * n + y * c}`).join(' ');
}

async function normalizePak43Geometry() {
  const input = fs.readFileSync(path.join(dir, 'pak4341-deployed-generated.png'));
  const image = `<image href="data:image/png;base64,${input.toString('base64')}" width="2172" height="724"/>`;
  const polygons = generated.trails.map(legPolygon);
  const defs = `<defs>
    <clipPath id="bodyBounds"><rect width="1455" height="724"/></clipPath>
    <clipPath id="frontTube"><rect width="${cutX}" height="724"/></clipPath>
    <clipPath id="restTube"><rect x="${cutX + removeBarrel}" width="2172" height="724"/></clipPath>
    <mask id="bodyMask" maskUnits="userSpaceOnUse" x="0" y="0" width="2172" height="724">
      <rect width="2172" height="724" fill="white"/>
      ${generated.trails.map(leg => `<polygon points="${legPolygon(leg, 25)}" fill="black"/>`).join('')}
      ${generated.wheels.map(w => `<rect x="${w.crop.left}" y="${w.crop.top}" width="${w.crop.width}" height="${w.crop.height}" fill="black"/>`).join('')}
      <rect x="1175" y="322" width="280" height="88" fill="white"/>
    </mask>
    ${polygons.map((points, i) => `<clipPath id="leg${i}"><polygon points="${points}"/></clipPath>`).join('')}
  </defs>`;

  let artwork = '';
  const calibrationLegs = [];
  for (let i = 0; i < generated.trails.length; i++) {
    const old = generated.trails[i], ref = reference.trails[i];
    const a = angle(old.hinge, old.spade), degrees = a * 180 / Math.PI;
    const oldLength = distance(old.hinge, old.spade), newLength = distance(ref.hinge, ref.spade) / s;
    const delta = oldLength - newLength, cap = oldLength - 100;
    const beamScale = (cap - delta) / cap;
    const local = `<g transform="rotate(${-degrees}) translate(${-old.hinge.x} ${-old.hinge.y})"><g clip-path="url(#leg${i})">${image}</g></g>`;
    // Shorten only the box beam along its axis; the terminal spade and handles
    // retain their size. Keep the already-approved V deployment angles.
    artwork += `<defs><clipPath id="beam${i}"><rect x="-100" y="-200" width="${cap + 100}" height="400"/></clipPath>
      <clipPath id="cap${i}"><rect x="${cap}" y="-200" width="500" height="400"/></clipPath></defs>
      <g transform="translate(${ref.hinge.x} ${ref.hinge.y + canvas.yOffset}) rotate(${degrees}) scale(${s})">
        <g transform="scale(${beamScale} 1)"><g clip-path="url(#beam${i})">${local}</g></g>
        <g transform="translate(${-delta} 0)"><g clip-path="url(#cap${i})">${local}</g></g>
      </g>`;
    calibrationLegs.push({ referenceLength: distance(ref.hinge, ref.spade), generatedLength: oldLength,
      originalLengthInWheelDiameters: oldLength / generated.wheelDiameter,
      correctedLengthInWheelDiameters: distance(ref.hinge, ref.spade) / reference.wheelDiameter,
      beamScale, spadeScale: 1, deploymentDegrees: degrees });
  }

  // Compact bearing housings join the inset wheels to the unchanged carriage.
  // Retract the earlier extended supports along with the wheel crops.
  const bridges = [];
  for (const bridge of [
    { crop: { left: 1025, top: 204, width: 190, height: 85 }, y: 184, height: 105 },
    { crop: { left: 1025, top: 426, width: 190, height: 90 }, y: 426, height: 109 },
  ]) {
    const part = await sharp(input).extract(bridge.crop).png().toBuffer();
    bridges.push(`<image href="data:image/png;base64,${part.toString('base64')}" x="${bridge.crop.left}" y="${bridge.y}" width="${bridge.crop.width}" height="${bridge.height}" preserveAspectRatio="none"/>`);
  }
  artwork += `<g transform="translate(${tx} ${ty + canvas.yOffset}) scale(${s})">${bridges.join('')}
    <g clip-path="url(#bodyBounds)"><g mask="url(#bodyMask)">
      <g clip-path="url(#restTube)">${image}</g>
      <g transform="translate(${removeBarrel} 0)"><g clip-path="url(#frontTube)">${image}</g></g>
    </g></g></g>`;
  for (let i = 0; i < generated.wheels.length; i++) {
    const wheel = generated.wheels[i];
    const crop = await sharp(input).extract(wheel.crop).png().toBuffer();
    const yScale = reference.wheelTreadWidth / (wheel.treadWidth * s);
    const height = wheel.crop.height * s * yScale, width = wheel.crop.width * s;
    const x = tx + wheel.crop.left * s;
    const y = wheelLayout.centersY[i] + canvas.yOffset - (wheel.centerY - wheel.crop.top) * s * yScale;
    artwork += `<image href="data:image/png;base64,${crop.toString('base64')}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="none"/>`;
  }
  const result = await sharp(xml(canvas.width, canvas.height, defs + artwork)).png().toBuffer();
  await sharp(result).toFile(path.join(dir, 'pak4341-proportions-corrected.png'));
  const calibration = { reference, generated, canvas, wheelLayout, commonScale: s, straightTubeRemovedSourcePixels: removeBarrel,
    originalBarrelReachInWheelDiameters: (generated.axle.x - generated.muzzle.x) / generated.wheelDiameter,
    correctedBarrelReachInWheelDiameters: (reference.axle.x - reference.muzzle.x) / reference.wheelDiameter,
    trails: calibrationLegs, output: { width: 200, height: 80,
      muzzle: { x: reference.muzzle.x / 7.5, y: (reference.muzzle.y + canvas.yOffset) / 7.5 },
      axle: { x: reference.axle.x / 7.5, y: (reference.axle.y + canvas.yOffset) / 7.5 } } };
  fs.writeFileSync(path.join(dir, 'geometry-calibration.json'), JSON.stringify(calibration, null, 2) + '\n');
  return { image: result, calibration };
}

async function previewPak43Proportions() {
  const diameter = 95, centerX = 500, plates = [];
  const rows = [
    { file: 'reference-pak4341-top-travel.png', wheel: reference.wheelDiameter, axle: reference.axle, centerY: 155 },
    { file: 'pak4341-deployed-generated.png', wheel: generated.wheelDiameter, axle: generated.axle, centerY: 430 },
    { file: 'pak4341-proportions-corrected.png', wheel: reference.wheelDiameter,
      axle: { x: reference.axle.x, y: reference.axle.y + canvas.yOffset }, centerY: 760 },
  ];
  for (const row of rows) {
    const file = path.join(dir, row.file), meta = await sharp(file).metadata(), scale = diameter / row.wheel;
    plates.push({ input: await sharp(file).resize({ width: Math.round(meta.width * scale) }).toBuffer(),
      left: Math.round(centerX - row.axle.x * scale), top: Math.round(row.centerY - row.axle.y * scale) });
  }
  const muzzleGuideX = centerX - (reference.axle.x - reference.muzzle.x) * diameter / reference.wheelDiameter;
  const overlay = `<svg width="1000" height="950"><g font-family="sans-serif" fill="#e9e8dc" font-size="20">
    <text x="24" y="29">SAME WHEEL DIAMETER (95px) — compare physical proportions</text>
    <text x="24" y="60">Reference: approved B plan / transport trails</text>
    <text x="24" y="300">Previous: barrel reach 4.00 D / trails 2.94–2.98 D</text>
    <text x="24" y="605">Corrected: barrel reach 3.70 D / trails 2.35 D / V retained</text></g>
    <g stroke="#71b2a4" stroke-opacity=".65" stroke-dasharray="5 6" fill="none">
      <path d="M500 70V915"/><path d="M${muzzleGuideX} 70V915"/></g></svg>`;
  await sharp({ create: { width: 1000, height: 950, channels: 4, background: '#414938' } })
    .composite([...plates, { input: Buffer.from(overlay) }]).png().toFile(path.join(dir, 'proportion-comparison.png'));
}

module.exports = { normalizePak43Geometry, previewPak43Proportions };
if (require.main === module) normalizePak43Geometry().then(({ calibration }) => console.log(JSON.stringify(calibration, null, 2)))
  .catch(error => { console.error(error); process.exitCode = 1; });
