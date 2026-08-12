const assert = require('assert');
const fs = require('fs');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const gameAudio = fs.readFileSync('assets/scripts/audio/GameAudio.ts', 'utf8');

assert(fs.existsSync('assets/resources/audio/infantry_attack.mp3'), 'infantry attack audio asset should exist');
assert.match(gameAudio, /infantryAttack:\s*'audio\/infantry_attack'/);
assert.match(gameAudio, /export function playInfantryAttack\(\)[\s\S]*?AudioKeys\.infantryAttack/);

const fireCue = battleScene.match(/private\s+playAttackFireCue\s*\([\s\S]*?\n  }\n\n/);
assert(fireCue, 'playAttackFireCue() should be found');
assert.match(
  fireCue[0],
  /isFootUnit\(attacker\)[\s\S]*?attacker\.kind\s*!==\s*'officer'[\s\S]*?isFootUnit\(target\)[\s\S]*?spawnInfantryBulletVolley\(attacker, target\)[\s\S]*?playInfantryAttack\(\)/,
  'foot-unit attacks against foot units should use the dedicated volley and sound',
);

const volley = battleScene.match(/private\s+spawnInfantryBulletVolley\s*\([\s\S]*?\n  }\n\n/);
assert(volley, 'spawnInfantryBulletVolley() should be found');
assert.match(volley[0], /infantrySquadOffsets\(this\.hexSize/);
assert.match(volley[0], /startX:\s*a\.x\s*\+\s*offset\.ox/);
assert.match(volley[0], /targetX:\s*b\.x\s*\+\s*offset\.ox/);
assert.match(volley[0], /startY:\s*a\.y\s*\+\s*offset\.oy/);
assert.match(volley[0], /targetY:\s*b\.y\s*\+\s*offset\.oy/);

assert.match(
  battleScene,
  /private\s+playMachineGunFireCue[\s\S]*?isFootUnit\(attacker\)[\s\S]*?attacker\.kind\s*!==\s*'officer'[\s\S]*?isFootUnit\(target\)[\s\S]*?playInfantryAttack\(\)/,
  'MG-style AI/PVP paths should also specialize infantry-on-infantry presentation',
);

console.log('BattleScene infantry attack presentation tests passed');
