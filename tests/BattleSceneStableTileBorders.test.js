const assert = require('assert');
const fs = require('fs');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert.match(
  battleScene,
  /private terrainSpriteBatchReady = false;/,
  'terrain sprites should have an explicit batch-ready gate',
);
assert.match(
  battleScene,
  /private redraw\(\) \{[\s\S]*?if \(!this\.terrainSpriteBatchReady\) return;/,
  'the first map redraw should wait for the complete terrain sprite batch',
);
assert.match(
  battleScene,
  /this\.pendingTerrainSpriteLoads = Object\.keys\(terrainPaths\)\.length\s*\+ Object\.keys\(winterTerrainPaths\)\.length[\s\S]*?;/,
  'summer and winter terrain requests should settle as one batch',
);
assert.match(
  battleScene,
  /Shared edges are invisible;[\s\S]*?if \(n\) continue;/,
  'shared tile edges must be skipped entirely',
);
assert.match(
  battleScene,
  /const EFFECTIVE_BATTLEFIELD_BOUNDARY_COLOR = new Color\(245, 225, 150, 255\);/,
  'the battlefield boundary should be opaque so round caps cannot accumulate alpha',
);
console.log('stable battle tile border tests passed');
