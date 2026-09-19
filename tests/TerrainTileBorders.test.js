const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { test } = require('node:test');
const sharp = require('sharp');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const normalizer = fs.readFileSync('tools/normalizeTerrainTileBorders.cjs', 'utf8');
const terrainFiles = [
  'terrain_field.png', 'terrain_mud.png', 'terrain_road.png', 'terrain_forest.png', 'terrain_water.png',
  'terrain_field_snow.png', 'terrain_mud_snow.png', 'terrain_road_snow.png',
  'terrain_forest_snow.png', 'terrain_water_snow.png',
  'pacific_sand.png', 'pacific_track.png', 'pacific_rocks.png', 'pacific_trees.png', 'pacific_water.png',
];

function hexInset(x, y, width, height) {
  const vertices = [
    [width / 2, 0], [width, height * 0.25], [width, height * 0.75],
    [width / 2, height], [0, height * 0.75], [0, height * 0.25],
  ];
  let result = Infinity;
  for (let index = 0; index < vertices.length; index++) {
    const [ax, ay] = vertices[index];
    const [bx, by] = vertices[(index + 1) % vertices.length];
    result = Math.min(result,
      ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / Math.hypot(bx - ax, by - ay));
  }
  return result;
}

test('terrain border normalization matches the city paving edge style', () => {
  assert.match(normalizer, /const OLD_BORDER_INSET = 8\.5;/);
  assert.match(normalizer, /const CITY_BORDER_INSET = 1\.2;/);
  assert.match(normalizer, /const CITY_BORDER_RGB = \[109, 110, 99\];/);
  assert.match(battleScene, /const TILE_BORDER\s*= new Color\(109, 110,\s+99, 255\);/);
  assert.match(battleScene, /const TILE_BORDER_WIDTH\s*= 1;/);
});

test('only border pixels change from the checked-in terrain artwork', async () => {
  for (const file of terrainFiles) {
    const assetPath = `assets/resources/textures/terrain/${file}`;
    const originalPng = execFileSync('git', ['show', `HEAD:${assetPath}`]);
    const original = await sharp(originalPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const current = await sharp(assetPath)
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual(current.info, original.info, `${file} metadata changed`);
    for (let y = 0; y < current.info.height; y++) {
      for (let x = 0; x < current.info.width; x++) {
        if (hexInset(x + 0.5, y + 0.5, current.info.width, current.info.height) < 8.5) continue;
        const offset = (y * current.info.width + x) * 4;
        assert.equal(current.data.readUInt32BE(offset), original.data.readUInt32BE(offset),
          `${file} changed an interior pixel at ${x},${y}`);
      }
    }
  }
});
