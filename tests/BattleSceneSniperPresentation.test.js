const assert = require('assert');
const fs = require('fs');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const eventApply = fs.readFileSync('assets/scripts/core/TurnEndEventApply.ts', 'utf8');
const gameAudio = fs.readFileSync('assets/scripts/audio/GameAudio.ts', 'utf8');

assert(fs.existsSync('assets/resources/audio/sniper_fire.mp3'), 'sniper sound should be imported');
assert.match(gameAudio, /sniperFire:\s*'audio\/sniper_fire'/);
assert.match(gameAudio, /export function playSniperFire\(\)[\s\S]*?AudioKeys\.sniperFire/);

assert.match(
  eventApply,
  /function\s+findShermanLosInfantry[\s\S]*?return e;/,
  'sniper preparation should retain the concrete infantry unit with line of sight',
);
assert.match(
  eventApply,
  /case 'sniper':[\s\S]*?sniperAttackerId:\s*willKill\s*\?\s*sniper\?\.id\s*:\s*undefined[\s\S]*?sniperWillKill:\s*willKill/,
  'only a sniper event that can kill should expose its attacker to the presentation layer',
);

const spawn = battleScene.match(/private\s+spawnSniperBulletTrace\s*\([\s\S]*?\n  }\n\n/);
assert(spawn, 'spawnSniperBulletTrace() should be found');
assert.match(spawn[0], /infantrySquadOffsets\(this\.hexSize/);
assert.match(spawn[0], /shooterIndex/);
assert.match(spawn[0], /new Node\('SniperBulletTrace'\)/);

assert.match(
  battleScene,
  /ui\.effectType\s*===\s*'sniper'\s*&&\s*ui\.sniperWillKill\s*&&\s*ui\.sniperAttackerId[\s\S]*?playTurnEndSniperShot\(attacker, this\.mission\.sherman,\s*\(\)\s*=>/,
  'the shot should play only after a qualifying sniper event is revealed',
);
assert.match(
  battleScene,
  /private\s+playTurnEndSniperShot[\s\S]*?spawnSniperBulletTrace\(attacker, target, onImpact\)[\s\S]*?playSniperFire\(\)/,
  'the single bullet and supplied sound should start together',
);
assert.match(battleScene, /ui\.root\.active\s*=\s*false[\s\S]*?ui\.stage\s*=\s*'pause_for_sniper'/);
assert.match(
  battleScene,
  /if\s*\(!trace\.impacted\s*&&\s*p\s*>=\s*0\.68\)[\s\S]*?trace\.onImpact\(\)/,
  'the commander death callback should run exactly when the bullet reaches its impact phase',
);
assert.match(
  battleScene,
  /ui\.apply\(\);[\s\S]*?ui\.effectApplied\s*=\s*true;[\s\S]*?refreshStatusPanel\(\)[\s\S]*?redraw\(\)/,
  'sniper impact should apply the death and redraw the commander presentation immediately',
);
assert.match(
  battleScene,
  /const applyFn\s*=\s*ui\.effectApplied\s*\?\s*\(\)\s*=>\s*\{\}\s*:\s*ui\.apply/,
  'confirmation should not apply an already-resolved sniper event twice',
);

console.log('BattleScene sniper presentation tests passed');
