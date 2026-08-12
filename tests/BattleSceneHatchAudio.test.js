const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const gameAudio = fs.readFileSync(path.join(root, 'assets/scripts/audio/GameAudio.ts'), 'utf8');
const battleScene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');

assert.match(gameAudio, /commanderHatchOpen:\s*'audio\/hatch_open'/);
assert.match(gameAudio, /commanderHatchClose:\s*'audio\/hatch_close'/);
assert.match(
  gameAudio,
  /export function playCommanderHatch\(open: boolean\)[\s\S]*?open \? AudioKeys\.commanderHatchOpen : AudioKeys\.commanderHatchClose/,
);

const toggleHatch = battleScene.match(/private tryToggleHatch\(\)[\s\S]*?private enterPhaseIfChoose/);
assert.ok(toggleHatch, 'player hatch toggle handler should exist');
assert.match(toggleHatch[0], /s\.hatchOpen = !s\.hatchOpen;\s*playCommanderHatch\(s\.hatchOpen\);/);

const closeWithDoubles = battleScene.match(/private tryCloseHatchWithDoubles[\s\S]*?private findDoublesPartner/);
assert.ok(closeWithDoubles, 'doubles hatch-close handler should exist');
assert.match(closeWithDoubles[0], /s\.hatchOpen = false;\s*playCommanderHatch\(false\);/);

const updateAiHatch = battleScene.match(/private updateNonPlayerTankCommanderHatch[\s\S]*?\n  }/);
assert.ok(updateAiHatch, 'non-player hatch update handler should exist');
assert.match(
  updateAiHatch[0],
  /if \(unit\.crew\?\.commander === false\) return;/,
  'a dead non-player commander must preserve the existing hatch state without playing audio',
);
assert.match(updateAiHatch[0], /unit\.hatchOpen = nextOpen;[\s\S]*?playCommanderHatch\(nextOpen\);/);
assert.doesNotMatch(updateAiHatch[0], /isUnitVisible|isHexVisible/, 'fog must not suppress enemy hatch audio');

const commanderDeath = battleScene.match(/if \(slot !== null && s\.crew\)[\s\S]*?neutralizeUncrewedTank\(s\);/);
assert.ok(commanderDeath, 'commander death handler should exist');
assert.doesNotMatch(commanderDeath[0], /playCommanderHatch/, 'crew death must not play hatch-close audio');

for (const file of ['hatch_open.mp3', 'hatch_close.mp3']) {
  assert.ok(fs.existsSync(path.join(root, 'assets/resources/audio', file)), `${file} should be imported`);
}

console.log('BattleScene hatch audio tests passed');
