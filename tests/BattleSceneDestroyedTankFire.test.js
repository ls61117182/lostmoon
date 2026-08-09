const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'),
  'utf8',
);

assert.match(
  source,
  /visualFireEffectLevel\(\s*u,\s*this\.mission\?\.sherman\.id,\s*this\.destroyWreckVisualIds\.has\(u\.id\)/,
  'the fire effect should use the current-turn destroyed-unit marker',
);
assert.match(
  source,
  /const fireTarget = this\.fireEffectLevel\(unit\) > 0 \? 1 : 0/,
  'newly destroyed tanks should remain eligible for the existing fire effect',
);
assert.match(
  source,
  /private clearDestroyWreckVisuals\(\): void \{[\s\S]*?this\.destroyWreckVisualIds\.clear\(\);[\s\S]*?if \(visual\.unit\.destroyed\) this\.unitEffectVisuals\.delete\(id\);[\s\S]*?\n  \}/,
  'starting the next turn should remove destroyed-tank fire visuals immediately',
);

console.log('BattleScene destroyed-tank fire tests passed');
