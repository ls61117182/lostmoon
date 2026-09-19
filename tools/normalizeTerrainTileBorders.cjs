const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const TERRAIN_DIR = path.join(ROOT, 'assets', 'resources', 'textures', 'terrain');
const TILE_FILES = [
  'terrain_field.png', 'terrain_mud.png', 'terrain_road.png', 'terrain_forest.png', 'terrain_water.png',
  'terrain_field_snow.png', 'terrain_mud_snow.png', 'terrain_road_snow.png',
  'terrain_forest_snow.png', 'terrain_water_snow.png',
  'pacific_sand.png', 'pacific_track.png', 'pacific_rocks.png', 'pacific_trees.png', 'pacific_water.png',
];

const OLD_BORDER_INSET = 8.5;
const CITY_BORDER_INSET = 1.2;
const CITY_BORDER_RGB = [109, 110, 99];

function hexGeometry(width, height) {
  const vertices = [
    [width / 2, 0], [width, height * 0.25], [width, height * 0.75],
    [width / 2, height], [0, height * 0.75], [0, height * 0.25],
  ];
  const edges = vertices.map(([ax, ay], index) => {
    const [bx, by] = vertices[(index + 1) % vertices.length];
    const length = Math.hypot(bx - ax, by - ay);
    return { ax, ay, bx, by, length };
  });
  const inset = (x, y) => Math.min(...edges.map(({ ax, ay, bx, by, length }) =>
    ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / length));
  return { inset };
}

async function normalizeTile(file) {
  const filePath = path.join(TERRAIN_DIR, file);
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const source = Buffer.from(data);
  const output = Buffer.from(data);
  const { inset } = hexGeometry(info.width, info.height);
  const centerX = info.width / 2;
  const centerY = info.height / 2;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * 4;
      if (source[offset + 3] === 0) continue;
      const edgeInset = inset(x + 0.5, y + 0.5);
      if (edgeInset < 0 || edgeInset >= OLD_BORDER_INSET) continue;

      if (edgeInset < CITY_BORDER_INSET) {
        output[offset] = CITY_BORDER_RGB[0];
        output[offset + 1] = CITY_BORDER_RGB[1];
        output[offset + 2] = CITY_BORDER_RGB[2];
        output[offset + 3] = 255;
        continue;
      }

      // Extend the existing surface texture over the removed bevel by sampling
      // farther inward on the same center ray. No pixels outside this border band change.
      const dx = centerX - (x + 0.5);
      const dy = centerY - (y + 0.5);
      const distance = Math.hypot(dx, dy) || 1;
      const step = OLD_BORDER_INSET - edgeInset + 1;
      const sampleX = Math.max(0, Math.min(info.width - 1, Math.round(x + dx / distance * step)));
      const sampleY = Math.max(0, Math.min(info.height - 1, Math.round(y + dy / distance * step)));
      const sampleOffset = (sampleY * info.width + sampleX) * 4;
      output[offset] = source[sampleOffset];
      output[offset + 1] = source[sampleOffset + 1];
      output[offset + 2] = source[sampleOffset + 2];
      output[offset + 3] = 255;
    }
  }

  await sharp(output, { raw: info }).png().toFile(filePath);
  return file;
}

async function main() {
  for (const file of TILE_FILES) console.log(await normalizeTile(file));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = { CITY_BORDER_INSET, CITY_BORDER_RGB, OLD_BORDER_INSET, TILE_FILES, hexGeometry };
