const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'),
  'utf8',
);

assert.match(
  source,
  /if\s*\(finishedUnit\.turretVisualTarget\)\s*\{[\s\S]*?q:\s*finishedUnit\.turretVisualTarget\.q\s*\+\s*\(anim\.toQ\s*-\s*anim\.fromQ\)[\s\S]*?r:\s*finishedUnit\.turretVisualTarget\.r\s*\+\s*\(anim\.toR\s*-\s*anim\.fromR\)/,
  'movement completion must translate the visual target with the unit so its heading stays unchanged',
);

const moveTurretLerps = [...source.matchAll(
  /if\s*\(this\.anim\.kind\s*===\s*'move'\)\s*\{[\s\S]{0,500}?toVisualTarget:\s*u\.turretVisualTarget/g,
)];
assert.strictEqual(
  moveTurretLerps.length,
  2,
  'both Sherman and non-Sherman movement renderers must preserve the current visual turret target',
);

console.log('BattleScene turret visual heading movement tests passed');
