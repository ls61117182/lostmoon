const assert = require('assert');
const fs = require('fs');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

const coLocationHelper = battleScene.match(
  /private\s+infantrySharesHexWithOtherUnit\s*\(u:\s*Unit\):\s*boolean\s*\{[\s\S]*?\n  \}/,
);
assert(coLocationHelper, 'BattleScene should detect other units sharing an infantry hex');
assert(
  !coLocationHelper[0].includes('isFootUnit(o)'),
  'foot units and officers should trigger the same wide infantry formation as vehicles',
);
assert.match(
  battleScene,
  /const\s+coLocateOtherUnit\s*=\s*this\.infantrySharesHexWithOtherUnit\(u\);[\s\S]*?infantrySquadOffsets\(this\.hexSize,\s*coLocateOtherUnit\)/,
  'live infantry sprites should use the wide formation whenever another unit shares their hex',
);

console.log('BattleScene infantry co-location formation test passed');
