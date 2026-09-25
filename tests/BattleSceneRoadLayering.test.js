const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

test('city road surfaces render after ordinary road surfaces', () => {
  const passLoop = source.match(/for \(const urbanRoadPass of \[false, true\]\) \{[\s\S]*?\n    \}/);
  assert.ok(passLoop, 'road rendering must use an explicit ordinary-then-city pass order');
  assert.match(passLoop[0], /\(t\.terrain === 'urban_road'\) !== urbanRoadPass/);
  assert.match(passLoop[0], /drawTerrainSpriteFrame\([\s\S]*?ROAD_SURFACE_OVERLAP_SCALE, frame, transform\.rotationDegrees/);
  assert.match(passLoop[0], /drawTerrainSpriteFrame\([\s\S]*?ROAD_SURFACE_OVERLAP_SCALE, info\.frame, info\.rotationDegrees/);
});
