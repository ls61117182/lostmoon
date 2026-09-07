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
  /this\.pendingTerrainSpriteLoads = Object\.keys\(terrainPaths\)\.length\s*\+ Object\.keys\(winterTerrainPaths\)\.length;/,
  'summer and winter terrain requests should settle as one batch',
);
assert.match(
  battleScene,
  /if \(spriteBackedTileKeys\.has\(`\$\{t\.pos\.q\},\$\{t\.pos\.r\}`\)\) continue;\s*if \(t\.terrain === 'deep_water'\)/,
  'sprite-backed terrain should keep its own baked border without a Graphics overlay',
);
assert.match(
  battleScene,
  /if \(n && \(\s*tile\.pos\.q > n\.pos\.q \|\| \(tile\.pos\.q === n\.pos\.q && tile\.pos\.r > n\.pos\.r\)/,
  'shared tile edges should have one stable coordinate owner',
);
assert.match(
  battleScene,
  /const EFFECTIVE_BATTLEFIELD_BOUNDARY_COLOR = new Color\(245, 225, 150, 255\);/,
  'the battlefield boundary should be opaque so round caps cannot accumulate alpha',
);
console.log('stable battle tile border tests passed');
