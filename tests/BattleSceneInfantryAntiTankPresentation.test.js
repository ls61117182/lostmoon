const assert = require('assert');
const fs = require('fs');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const gameAudio = fs.readFileSync('assets/scripts/audio/GameAudio.ts', 'utf8');

assert(fs.existsSync('assets/resources/audio/infantry_anti_tank_fire.mp3'),
  'infantry anti-tank launcher audio asset should exist');
assert.match(gameAudio, /infantryAntiTankFire:\s*'audio\/infantry_anti_tank_fire'/);

const fireCue = battleScene.match(/private\s+playAttackFireCue\s*\([\s\S]*?\n  }\n\n/);
assert(fireCue, 'playAttackFireCue() should be found');
assert.match(
  fireCue[0],
  /isFootUnit\(attacker\)[\s\S]*?attacker\.kind\s*!==\s*'officer'[\s\S]*?isTankUnit\(target\)[\s\S]*?setInfantryVisualFacing\(attacker, target\.pos\)[\s\S]*?redraw\(\)[\s\S]*?spawnInfantryRocketTrace\(attacker, target, report\)[\s\S]*?playInfantryAntiTankFire\(\)[\s\S]*?return/,
  'infantry should face the tank before using the dedicated rocket presentation',
);
assert(
  fireCue[0].indexOf('this.setInfantryVisualFacing(attacker, target.pos)')
    < fireCue[0].indexOf('spawnInfantryRocketTrace(attacker, target, report)'),
  'the squad facing must update before the rocket is spawned',
);

const spawn = battleScene.match(/private\s+spawnInfantryRocketTrace\s*\([\s\S]*?\n  }\n\n/);
assert(spawn, 'spawnInfantryRocketTrace() should be found');
assert.match(spawn[0], /const\s+shooterOffset\s*=\s*offsets\[seed\s*%\s*offsets\.length\]/);
assert.match(spawn[0], /new Node\('InfantryRocketTrace'\)/);
assert.doesNotMatch(spawn[0], /offsets\.map|spawnInfantryBulletVolley|setInfantryVisualFacing/);
assert.match(spawn[0], /Math\.hypot\(dx, dy\)\s*<=\s*1/,
  'same-hex infantry/tank attacks should have a fallback aiming vector');
assert.match(spawn[0], /'miss'[\s\S]*?'penetration'[\s\S]*?'ricochet'/);

const draw = battleScene.match(/private\s+drawInfantryRocketTrace\s*\([\s\S]*?\n  }\n\n/);
assert(draw, 'drawInfantryRocketTrace() should be found');
assert.match(draw[0], /tubeBackX[\s\S]*?trace\.startX/);
assert.match(draw[0], /tubeBackX\s*-\s*trace\.ux\s*\*\s*back/,
  'backblast should be drawn opposite the flight direction');
assert.match(draw[0], /smokeCount\s*=\s*9/);
assert.match(draw[0], /trace\.mode\s*===\s*'miss'/);
assert.match(draw[0], /trace\.mode\s*===\s*'ricochet'/);
assert.match(draw[0], /trace\.mode\s*===\s*'penetration'/);

assert.match(battleScene, /private\s+infantryRocketTraces:\s*InfantryRocketTrace\[\]/);
assert.match(battleScene, /advanceInfantryRocketTraces\(dt\)/);
assert.match(battleScene, /clearInfantryRocketTraces\(\)/);
assert.match(gameAudio, /export function playInfantryAntiTankFire\(\)[\s\S]*?AudioKeys\.infantryAntiTankFire/);
assert.match(
  battleScene,
  /private\s+playMachineGunFireCue[\s\S]*?isFootUnit\(attacker\)[\s\S]*?isTankUnit\(target\)[\s\S]*?setInfantryVisualFacing\(attacker, target\.pos\)[\s\S]*?redraw\(\)[\s\S]*?spawnInfantryRocketTrace/,
  'legacy AI/PvP paths should face the squad and then use one infantry rocket against tanks',
);

console.log('BattleScene infantry anti-tank presentation tests passed');
