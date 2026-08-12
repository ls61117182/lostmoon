const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const TERRAIN_DIR = path.join(ROOT, 'assets', 'resources', 'textures', 'terrain');
const SNOW_SOURCE = path.join(ROOT, 'tools', 'assets', 'winter_snow_texture.png');

const TERRAIN_VARIANTS = [
  ['terrain_field.png', 'terrain_field_snow.png', 0.76],
  ['terrain_mud.png', 'terrain_mud_snow.png', 0.92],
  ['terrain_road.png', 'terrain_road_snow.png', 0.62],
  ['terrain_forest.png', 'terrain_forest_snow.png', 0.84],
  ['terrain_water.png', 'terrain_water_snow.png', 0.60],
];

const TREE_VARIANTS = [1, 2, 3, 4].map((index) => [
  `tree_${String(index).padStart(2, '0')}.png`,
  `tree_${String(index).padStart(2, '0')}_snow.png`,
]);

function stableUuid(name) {
  const hex = crypto.createHash('sha256').update(`sherman-winter-terrain:${name}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function readRgba(file) {
  return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function writeVariantMeta(sourceName, outputName) {
  const sourceMetaPath = path.join(TERRAIN_DIR, `${sourceName}.meta`);
  const outputMetaPath = path.join(TERRAIN_DIR, `${outputName}.meta`);
  const meta = JSON.parse(fs.readFileSync(sourceMetaPath, 'utf8'));
  const oldUuid = meta.uuid;
  const uuid = stableUuid(outputName);
  const displayName = path.basename(outputName, '.png');
  const serialized = JSON.stringify(meta, null, 2)
    .replaceAll(oldUuid, uuid)
    .replaceAll(path.basename(sourceName, '.png'), displayName);
  fs.writeFileSync(outputMetaPath, `${serialized}\n`);
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** A few broad, irregular holes in an otherwise continuous snow blanket. */
function mudExposureAt(x, y, width, height) {
  const nx = x / width;
  const ny = y / height;
  const patches = [
    { x: 0.34, y: 0.38, rx: 0.115, ry: 0.095 },
    { x: 0.65, y: 0.61, rx: 0.145, ry: 0.105 },
    { x: 0.46, y: 0.76, rx: 0.085, ry: 0.060 },
  ];
  let exposure = 0;
  for (let index = 0; index < patches.length; index++) {
    const patch = patches[index];
    const warpX = nx + Math.sin(ny * 29 + index * 2.3) * 0.010;
    const warpY = ny + Math.sin(nx * 25 - index * 1.7) * 0.008;
    const dx = (warpX - patch.x) / patch.rx;
    const dy = (warpY - patch.y) / patch.ry;
    const distance = Math.sqrt(dx * dx + dy * dy);
    exposure = Math.max(exposure, 1 - smoothstep(0.68, 1.08, distance));
  }
  return exposure;
}

async function generateTerrain(sourceName, outputName, baseCoverage, snowRaw) {
  const sourcePath = path.join(TERRAIN_DIR, sourceName);
  const outputPath = path.join(TERRAIN_DIR, outputName);
  const { data, info } = await readRgba(sourcePath);
  const snow = await sharp(snowRaw.data, { raw: snowRaw.info })
    .resize(info.width, info.height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const out = Buffer.alloc(data.length);

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    const a = data[i + 3];
    const pixelIndex = i / 4;
    const x = pixelIndex % info.width;
    const y = Math.floor(pixelIndex / info.width);
    const brightness = (r + g + b) / 3;
    const border = a > 0 && brightness < 82;
    const textureLuma = (snow[i] + snow[i + 1] + snow[i + 2]) / (3 * 255);
    let coverage = border ? 0.10 : baseCoverage + (textureLuma - 0.90) * 0.16;
    if (sourceName.includes('mud')) {
      coverage -= mudExposureAt(x, y, info.width, info.height) * 0.72;
    }
    if (sourceName.includes('forest')) {
      // Winter forest floor keeps occasional woody debris but removes every green hue.
      const brownLuma = Math.max(0, Math.min(1, brightness / 255));
      r = Math.round(58 + brownLuma * 70);
      g = Math.round(46 + brownLuma * 58);
      b = Math.round(38 + brownLuma * 46);
    }
    if (sourceName.includes('water')) coverage += (b - r) / 255 * 0.10;
    coverage = Math.max(0.08, Math.min(0.96, coverage));
    out[i] = Math.round(r * (1 - coverage) + snow[i] * coverage);
    out[i + 1] = Math.round(g * (1 - coverage) + snow[i + 1] * coverage);
    out[i + 2] = Math.round(b * (1 - coverage) + snow[i + 2] * coverage);
    out[i + 3] = a;
  }

  await sharp(out, { raw: info }).png().toFile(outputPath);
  await writeVariantMeta(sourceName, outputName);
}

async function generateTree(sourceName, outputName) {
  const sourcePath = path.join(TERRAIN_DIR, sourceName);
  const outputPath = path.join(TERRAIN_DIR, outputName);
  const { data, info } = await readRgba(sourcePath);
  const out = Buffer.from(data);
  const variant = Number(sourceName.match(/(\d+)/)?.[1] ?? 1);
  const frostBranches = [];
  const centerX = 0.5 + (variant - 2.5) * 0.006;
  const centerY = 0.5 + ((variant * 7) % 3 - 1) * 0.008;
  const primaryCount = 10;
  for (let branch = 0; branch < primaryCount; branch++) {
    let angle = branch * Math.PI * 2 / primaryCount
      + variant * 0.31
      + (((branch * 17 + variant * 13) % 11) - 5) * 0.025;
    let ax = centerX;
    let ay = centerY;
    for (let depth = 0; depth < 4; depth++) {
      const length = 0.078 + ((branch * 19 + depth * 23 + variant * 7) % 28) / 1000;
      angle += (((branch * 29 + depth * 11 + variant * 5) % 9) - 4) * 0.035;
      const bx = ax + Math.cos(angle) * length;
      const by = ay + Math.sin(angle) * length;
      frostBranches.push({ ax, ay, bx, by, width: 0.018 - depth * 0.0015 });
      if (depth > 0) {
        const side = branch % 2 === depth % 2 ? 1 : -1;
        const sideAngle = angle + side * (0.62 + ((branch + depth + variant) % 4) * 0.08);
        const sideLength = 0.052 + ((branch * 13 + depth * 17 + variant) % 24) / 1000;
        frostBranches.push({
          ax,
          ay,
          bx: ax + Math.cos(sideAngle) * sideLength,
          by: ay + Math.sin(sideAngle) * sideLength,
          width: 0.012,
        });
      }
      ax = bx;
      ay = by;
    }
  }
  // Several offset twig crowns break up the central radial pattern. When the
  // sprites overlap in a forest these crowns merge into dense hoarfrost; when
  // used along a hedge their brown gaps keep the line of shrubs readable.
  for (let crown = 0; crown < 14; crown++) {
    const crownAngle = crown * 2.399963 + variant * 0.57;
    const crownRing = 0.07 + ((crown * 31 + variant * 19) % 24) / 100;
    const cx = centerX + Math.cos(crownAngle) * crownRing;
    const cy = centerY + Math.sin(crownAngle) * crownRing;
    const spokeCount = 5 + (crown + variant) % 2;
    for (let spoke = 0; spoke < spokeCount; spoke++) {
      const angle = crownAngle * 0.37 + spoke * Math.PI * 2 / spokeCount
        + (((crown * 13 + spoke * 7 + variant) % 9) - 4) * 0.045;
      const length = 0.052 + ((crown * 17 + spoke * 11 + variant * 5) % 30) / 1000;
      frostBranches.push({
        ax: cx,
        ay: cy,
        bx: cx + Math.cos(angle) * length,
        by: cy + Math.sin(angle) * length,
        width: 0.016,
      });
    }
  }
  const distanceToBranch = (px, py, branch) => {
    const vx = branch.bx - branch.ax;
    const vy = branch.by - branch.ay;
    const length2 = vx * vx + vy * vy;
    const t = length2 === 0 ? 0 : Math.max(0, Math.min(1,
      ((px - branch.ax) * vx + (py - branch.ay) * vy) / length2));
    return Math.hypot(px - (branch.ax + vx * t), py - (branch.ay + vy * t));
  };
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (data[i + 3] === 0) continue;
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const t = Math.max(0, Math.min(1, (brightness - 30) / 145));
      // Preserve the original rounded canopy silhouette and internal blob shading,
      // changing only its hue from green to dormant winter brown.
      let r = 48 + t * 100;
      let g = 36 + t * 78;
      let b = 28 + t * 58;
      // Hoarfrost follows fine branches in every direction. The original round
      // canopy edge stays intact, avoiding an exaggerated thorny silhouette.
      let snowMask = 0;
      const px = x / info.width;
      const py = y / info.height;
      for (const branch of frostBranches) {
        const distance = distanceToBranch(px, py, branch) / branch.width;
        snowMask = Math.max(snowMask, 1 - smoothstep(0.35, 1.18, distance));
      }
      if (snowMask > 0) {
        const amount = snowMask * (0.70 + Math.max(0, brightness - 90) / 700);
        r = r * (1 - amount) + 214 * amount;
        g = g * (1 - amount) + 225 * amount;
        b = b * (1 - amount) + 230 * amount;
      }
      out[i] = Math.round(r);
      out[i + 1] = Math.round(g);
      out[i + 2] = Math.round(b);
      out[i + 3] = data[i + 3];
    }
  }
  await sharp(out, { raw: info }).png().toFile(outputPath);
  await writeVariantMeta(sourceName, outputName);
}

async function main() {
  if (!fs.existsSync(SNOW_SOURCE)) throw new Error(`Missing snow texture source: ${SNOW_SOURCE}`);
  const snowRaw = await readRgba(SNOW_SOURCE);
  for (const [source, output, coverage] of TERRAIN_VARIANTS) {
    await generateTerrain(source, output, coverage, snowRaw);
  }
  for (const [source, output] of TREE_VARIANTS) {
    await generateTree(source, output);
  }
  console.log(`Generated ${TERRAIN_VARIANTS.length + TREE_VARIANTS.length} winter terrain assets.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
