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

assert.strictEqual(
  (source.match(/turretFacingAfterHullTurn\(from, this\.anim\.turnFrom!, this\.anim\.turnTo!\)/g) || []).length,
  2,
  'both Sherman and non-Sherman turn renderers must preserve turret-to-hull relative heading',
);
assert.strictEqual(
  (source.match(/t:\s*this\.hullTurnRenderedAngularProgress\([\s\S]{0,120}?this\.anim\.turnFrom![\s\S]{0,80}?this\.anim\.turnTo![\s\S]{0,80}?this\.anim\.t/g) || []).length,
  2,
  'both Sherman and non-Sherman turrets must use the hull rendered-angle progress during turns',
);
assert.match(
  source,
  /private hullTurnRenderedAngularProgress[\s\S]*?facingBlendScreenVec\(pos, hullFrom, hullTo, tRaw\)[\s\S]*?signedAngle\(start, current\) \/ total/,
  'synchronized turret turns must derive progress from the hull angle actually rendered this frame',
);
assert.doesNotMatch(
  source,
  /finishedUnit\.turretFacing\s*=\s*finishedUnit\.facing/,
  'a completed hull turn must not recenter the turret',
);

console.log('BattleScene turret visual heading movement tests passed');
