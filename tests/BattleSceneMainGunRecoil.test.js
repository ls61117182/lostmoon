const assert = require('assert');
const fs = require('fs');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert.match(
  battleScene,
  /from '\.\/MainGunRecoil'/,
  'BattleScene should import the pure main-gun recoil model',
);
assert.match(
  battleScene,
  /private\s+mainGunRecoils\s*=\s*new Map<string, MainGunRecoilState>\(\)/,
  'BattleScene should own presentation-only recoil state keyed by unit ID',
);

const fireCue = battleScene.match(/private\s+playAttackFireCue\s*\([\s\S]*?\n  }\n\n/);
assert(fireCue, 'playAttackFireCue() should be found');
assert.match(fireCue[0], /if \(mg\)[\s\S]*?return;/, 'MG fire should return before cannon recoil');
assert(
  fireCue[0].indexOf('this.startMainGunRecoil(attacker, target)') > fireCue[0].indexOf('if (mg)'),
  'main-gun recoil should start only after the MG branch returns',
);

assert.match(
  battleScene,
  /private\s+startMainGunRecoil\s*\(attacker:\s*Unit \| null,\s*target:\s*Unit \| null\)/,
  'BattleScene should classify and start recoil from attacker/target geometry',
);
assert.match(
  battleScene,
  /private\s+advanceMainGunRecoils\s*\(dt:\s*number\)[\s\S]*?mainGunRecoils\.delete/,
  'completed recoil state should be removed',
);
assert.match(
  battleScene,
  /update\(dt:\s*number\)[\s\S]*?if \(this\.mainGunRecoils\.size > 0\) this\.advanceMainGunRecoils\(dt\)/,
  'the update loop should advance active recoil',
);
assert.match(
  battleScene,
  /applyTopDownTankSprite\([\s\S]*?mainGunRecoilOffsetFor\(u, 'whole'\)[\s\S]*?node\.setPosition\(c\.x \+ ox \+ recoil\.x, c\.y \+ oy \+ recoil\.y, 0\)/,
  'eligible fixed-gun top sprites should move as a whole',
);
assert.match(
  battleScene,
  /applySplitTankTurretSprite\([\s\S]*?mainGunRecoilOffsetFor\(u, 'turret'\)[\s\S]*?baseX \+ pivotLocalX \* cos - pivotLocalY \* sin \+ recoil\.x/,
  'split-turret recoil should be composed into turret placement only',
);
assert.match(
  battleScene,
  /const fallbackRecoil = this\.mainGunRecoilOffsetFor\(u, 'whole'\)[\s\S]*?c\.x \+= fallbackRecoil\.x;[\s\S]*?c\.y \+= fallbackRecoil\.y;/,
  'vector fallback vehicles such as Type 95 should move as a whole',
);
assert.match(
  battleScene,
  /private\s+loadAndDraw\s*\([^)]*\)[\s\S]*?mainGunRecoils\.clear\(\)/,
  'mission reload should clear presentation-only recoil state',
);

console.log('BattleScene main-gun recoil integration test passed');
