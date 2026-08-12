const assert = require('assert');
const fs = require('fs');

const combat = fs.readFileSync('assets/scripts/core/Combat.ts', 'utf8');
const suppression = fs.readFileSync('assets/scripts/core/Suppression.ts', 'utf8');
const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const saveLoad = fs.readFileSync('assets/scripts/core/SaveLoad.ts', 'utf8');
const langCsv = fs.readFileSync('data/lang.csv', 'utf8');
const langDb = fs.readFileSync('assets/scripts/core/LangDB.ts', 'utf8');

assert.match(combat, /mainGunSuppressesInfantry\?: boolean/);
assert.match(combat, /ctx\.mainGunSuppressesInfantry === true[\s\S]*?isTankUnit\(attacker\)[\s\S]*?isFootUnit\(target\)/);
assert.match(combat, /target\.kind !== 'officer'/);
assert.match(suppression, /target\.suppressed = true/);
assert.match(suppression, /unit\.suppressed = false/);

assert.match(battleScene, /isMainGunSuppressionAttack\(\s*sherman, target, GameSession\.gameMode === 'hardcore'/);
assert.match(battleScene, /mainGunSuppressesInfantry: suppressionAttack/);
assert.match(battleScene, /playHighExplosiveSuppressionCue\(sherman, target\)/);
assert.match(battleScene, /playHighExplosiveSuppressionCue[\s\S]*?spawnProjectileTrace\(/,
  'HE suppression should reuse the armor-piercing projectile flight');
assert.match(battleScene, /onPenetrationImpact: \(x, y\) => this\.spawnHighExplosiveBlast\(x, y, seed\)/);
assert.match(battleScene, /private drawHighExplosiveBlast\(/);
assert.doesNotMatch(battleScene, /spawnHighExplosiveShell|interface HighExplosiveShell/,
  'HE must not keep a separate projectile-flight implementation');
assert.match(battleScene, /private drawSuppressionMarks\([\s\S]*?infantrySquadOffsets[\s\S]*?INFANTRY_SPRITES_PER_UNIT/);
assert.match(battleScene, /private drawSuppressionExclamation\([\s\S]*?roundRect[\s\S]*?circle/,
  'suppression marks should use a crisp vector stem and dot instead of a font glyph');
assert.match(battleScene, /SUPPRESSION_MARK_POOL = 48/);
assert.match(battleScene, /const weaponPriority = isTankUnit\(actor\) && tankSuppression \? 1 : 0/,
  'AI main guns should prefer tank targets over infantry suppression');
assert.match(battleScene, /if \(isTankUnit\(enemy\) && this\.selectAIMGTarget\(enemy, false\)\)[\s\S]*?return this\.tryAIMGAttack\(enemy\)/,
  'non-player tanks should use an in-range MG infantry target before the main gun');
assert.match(battleScene, /isMainGunSuppressionAttack\(sherman, e,[\s\S]*?spawnSuppressionPreviewLabel/,
  'selecting a suppressible infantry target should show a suppression label in its hex');
assert.match(battleScene, /l\.string = t\('preview\.suppress'\)/);
assert.match(langCsv, /^preview\.suppress,压制,SUPPRESS$/m,
  'the suppression preview localization must live in the CSV source of truth');
assert.match(langDb, /'preview\.suppress': \{ zh: "压制", en: "SUPPRESS" \}/);
assert.match(battleScene, /usePhaseDice\(\[gunDieIdx\]\)/,
  'suppression should consume one main-gun action die without spending a precision pair');
assert.match(battleScene, /applyInfantrySuppression\(target\)/);
assert.match(battleScene, /consumeInfantrySuppression\(enemy\)/);
assert.match(battleScene, /this\.enemyIndex\+\+[\s\S]*?this\.beginCurrentEnemyTurn\(\)/,
  'a suppressed infantry action should advance to the next actor');
assert.doesNotMatch(battleScene.match(/if \(suppressionAttack\) \{[\s\S]*?\n    \}/)?.[0] ?? '', /rollAttack/,
  'the deterministic suppression branch must not roll attack dice');

assert.match(saveLoad, /suppressed\?: boolean/);
assert.match(saveLoad, /suppressed: u\.suppressed/);
assert.match(saveLoad, /live\.suppressed = s\.suppressed \?\? false/);

console.log('Main-gun suppression test passed');
