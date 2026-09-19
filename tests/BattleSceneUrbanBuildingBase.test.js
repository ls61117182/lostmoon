const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const cityRoadBase = 'textures/terrain/urban/roads/urban_road_tile_base_v1/spriteFrame';

for (const terrain of ['urban_indestructible', 'urban_destructible', 'urban_rubble']) {
  assert.match(source, new RegExp(`${terrain}: '${cityRoadBase.replaceAll('/', '\\/')}'`),
    `${terrain} must use the same tile base as urban roads`);
}
assert.match(source,
  /drawUrbanBuildingSpriteFrame\(c\.x, c\.y, this\.hexSize, frame, urbanBuildingSpriteScale\(t\)\)/,
  'battle-map building sprites must use their per-variant scale');
assert.match(source,
  /const scale = urbanBuildingSpriteScale\(tile\);\s*ut\.setContentSize\(hexR \* Math\.sqrt\(3\) \* scale, hexR \* 2 \* scale\)/,
  'tile information previews must use the same per-variant scale');

console.log('BattleScene urban building base and scale tests passed');
