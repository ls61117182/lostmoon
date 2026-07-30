const assert = require('assert');
const fs = require('fs');

const types = fs.readFileSync('assets/scripts/core/types.ts', 'utf8');
const combat = fs.readFileSync('assets/scripts/core/Combat.ts', 'utf8');
const fog = fs.readFileSync('assets/scripts/core/FogOfWar.ts', 'utf8');
const loader = fs.readFileSync('assets/scripts/core/MissionLoader.ts', 'utf8');
const objective = fs.readFileSync('assets/scripts/core/Objective.ts', 'utf8');
const save = fs.readFileSync('assets/scripts/core/SaveLoad.ts', 'utf8');
const scene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert.match(types, /Faction = [^;]*'neutral'/, 'runtime factions should support neutral abandoned guns');
assert.match(types, /atGunCrewAlive\?: boolean/, 'AT guns should persist an independent crew survival state');
assert.match(loader, /u\.kind === 'at_gun'[\s\S]*?u\.atGunCrewAlive = true[\s\S]*?u\.atGunCrewKind = crewKind[\s\S]*?u\.atGunCrewTargetSize = crewStats\.size/, 'scenario AT guns should start with faction infantry crews');

assert.match(combat, /atGunCrewTargets\?: boolean/, 'MG legality should explicitly opt into hardcore AT-gun crew targets');
assert.match(combat, /atGunCrewTargetSize \?\? 0[\s\S]*?\+ \(atGunCrewTarget \? 1 : 0\)/, 'MG threshold should use infantry target size and then add one for gun armor');
assert.match(combat, /if \(isControlledATGun\(target\)\)[\s\S]*?target\.atGunCrewAlive = false[\s\S]*?target\.faction = 'neutral'/, 'MG hits should abandon the gun instead of destroying it');

assert.match(fog, /isAbandonedATGun\(unit\) \|\| isAttachedATGunCrew\(unit\)[\s\S]*?return visible/, 'abandoned guns and attached crews should provide no independent vision');
assert.match(fog, /isControlledATGun\(unit\) \? 'infantry'/, 'controlled guns should use infantry vision geometry');
assert.match(objective, /!e\.destroyed && !isAbandonedATGun\(e\)/, 'neutral guns should be excluded from live enemy counts');
assert.match(scene, /enemy\.faction !== 'japanese' \|\| isAbandonedATGun\(enemy\) \|\| isAttachedATGunCrew\(enemy\)/, 'neutral guns and folded-in infantry should not provide US casualty dice');
assert.match(scene, /if \(isAttachedATGunCrew\(u\) \|\| isAbandonedATGun\(u\)\) return;/, 'abandoned guns should not display map name labels');

assert.match(scene, /private killATGunCrew\(gun: Unit\)[\s\S]*?const crewOffsets = this\.atGunCrewFormationOffsets\(gun\)[\s\S]*?spawnInfantryBloodDecalsAt\([^,]+, true, crewOffsets\)[\s\S]*?gun\.faction = 'neutral'/, 'crew deaths should leave blood at the three visible operator positions and neutralize the intact gun');
assert.match(scene, /private applyMainGunAttackResult[\s\S]*?target\.destroyed\) this\.killATGunCrew\(target\)/, 'main-gun destruction should also kill the AT-gun crew');
assert.match(scene, /private applyMachineGunAttackResult[\s\S]*?target\.kind === 'at_gun'[\s\S]*?target\.destroyed = false;[\s\S]*?this\.destroyWreckVisualIds\.delete\(target\.id\);[\s\S]*?this\.killATGunCrew\(target\);[\s\S]*?return;/, 'MG crew kills should explicitly preserve an intact gun and remove any premature wreck visual');
assert.match(scene, /private applyDiceShowDestroyedVisual[\s\S]*?show\.mg[\s\S]*?target\?\.kind === 'at_gun'[\s\S]*?target\.atGunCrewAlive === true\) return;/, 'MG dice presentation must not preview a controlled AT gun as destroyed');
assert.match(scene, /private captureAbandonedATGunsAt[\s\S]*?gun\.faction = infantry\.faction[\s\S]*?infantry\.attachedToATGunId = gun\.id[\s\S]*?rehomeCapturedATGun\(gun\)/, 'entering infantry should take control and transfer the gun to its side');
assert.match(scene, /GameSession\.gameMode === 'hardcore' && isControlledATGun\(u\)[\s\S]*?drawATGunCrewMaybeAnim\(u\)/, 'hardcore rendering should add three operator infantry to controlled guns');
assert.match(scene, /\{ forward: this\.hexSize \* 0\.47, side: -this\.hexSize \* 0\.43 \}[\s\S]*?\{ forward: this\.hexSize \* 0\.82, side: 0 \}[\s\S]*?\{ forward: this\.hexSize \* 0\.47, side: this\.hexSize \* 0\.43 \}/, 'AT-gun crew should occupy the reference image side of the gun in an upper-right, far-right, lower-right triangle');
assert.match(scene, /const forwardShift = this\.hexSize \* 0\.15;[\s\S]*?forward \* crewSide \+ forwardShift/, 'the complete AT-gun crew formation should sit 15% of a hex farther forward');
assert.match(scene, /private drawATGunCrewMaybeAnim\(gun: Unit\)[\s\S]*?this\.atGunCrewFormationOffsets\(gun\)/, 'live crew rendering and crew blood decals should share one formation');

for (const field of ['atGunCrewAlive', 'atGunCrewKind', 'atGunCrewTargetSize', 'atGunCrewGeneration', 'atGunControllerUnitId', 'attachedToATGunId']) {
  assert(save.includes(`${field}:`), `save snapshots should capture ${field}`);
}

console.log('Hardcore AT-gun composite tests passed');
