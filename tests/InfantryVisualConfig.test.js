const fs = require('fs');
const assert = require('assert');
const { execFileSync } = require('child_process');

const node = process.execPath;
execFileSync(node, ['tools/buildInfantryVisualDB.js'], { stdio: 'inherit' });

const csv = fs.readFileSync('data/infantry_visuals.csv', 'utf8');
const generated = fs.readFileSync('assets/scripts/core/InfantryVisualDB.ts', 'utf8');
const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

for (const kind of ['infantry', 'german_infantry', 'soviet_infantry', 'japanese_infantry', 'american_infantry']) {
  assert.match(csv, new RegExp(`^${kind},`, 'm'), `${kind} should have a three-soldier visual row`);
  assert.match(generated, new RegExp(`\\s${kind}: \\{ soldiers:`), `${kind} should be emitted into the generated visual DB`);
}
assert.match(csv, /sprite1Path,sprite1Scale,sprite2Path,sprite2Scale,sprite3Path,sprite3Scale/);
assert.match(generated, /scale: number/);
assert(battleScene.includes('INFANTRY_VISUAL_KINDS'), 'BattleScene should load all infantry from the visual DB');
assert(battleScene.includes('spriteFit * infantryVisuals.scales[i]'), 'BattleScene should use each configured soldier scale');

console.log('Infantry visual configuration test passed');
