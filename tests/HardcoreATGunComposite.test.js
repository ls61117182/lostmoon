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
assert.match(combat, /size: ctx\.target\.atGunCrewTargetSize \?\? 0/, 'MG threshold should use the controlling infantry target size');
assert.match(combat, /mgHitThreshold[\s\S]*?\+ \(atGunCrewTarget \? 1 : 0\)/, 'MG threshold should add one for AT-gun protection');
assert.match(combat, /if \(isControlledATGun\(target\)\)[\s\S]*?target\.atGunCrewAlive = false[\s\S]*?target\.faction = 'neutral'/, 'MG hits should abandon the gun instead of destroying it');

assert.match(fog, /isAbandonedATGun\(unit\) \|\| isAttachedATGunCrew\(unit\)[\s\S]*?return visible/, 'abandoned guns and attached crews should provide no independent vision');
assert.match(fog, /isControlledATGun\(unit\) \? 'infantry'/, 'controlled guns should use infantry vision geometry');
assert.match(objective, /!e\.destroyed && !isAbandonedATGun\(e\)/, 'neutral guns should be excluded from live enemy counts');
assert.match(scene, /enemy\.faction !== 'japanese' \|\| isAbandonedATGun\(enemy\) \|\| isAttachedATGunCrew\(enemy\)/, 'neutral guns and folded-in infantry should not provide US casualty dice');
assert.match(scene, /if \(isAttachedATGunCrew\(u\) \|\| isAbandonedATGun\(u\)\) return(?: false)?;/, 'abandoned guns should not display map name labels');

assert.match(scene, /private killATGunCrew\(gun: Unit\)[\s\S]*?const crewOffsets = this\.atGunCrewFormationOffsets\(gun\)[\s\S]*?spawnInfantryBloodDecalsAt\([^,]+, true, crewOffsets\)[\s\S]*?gun\.faction = 'neutral'/, 'crew deaths should leave blood at the three visible operator positions and neutralize the intact gun');
assert.match(scene, /private applyMainGunAttackResult[\s\S]*?hadATGunCrew && target\.destroyed[\s\S]*?this\.releaseATGunCrew\(target\)[\s\S]*?applyInfantrySuppression\(survivingCrew\)/, 'main-gun destruction should release and suppress the surviving AT-gun crew');
assert.doesNotMatch(scene.match(/private applyMainGunAttackResult[\s\S]*?\n  }\n\n/)?.[0] ?? '', /killATGunCrew/, 'main-gun destruction must not kill AT-gun operators');
assert.match(scene, /private inheritReleasedATGunCrewFacing[\s\S]*?currentTurretFacingFor\(gun[\s\S]*?fireDirectionVector\(ruleFacing\)[\s\S]*?infantry\.facing = infantryVisualDirection/,
  'released infantry should inherit the AT gun current rules-facing direction');
assert.match(scene, /private inheritReleasedATGunCrewFacing[\s\S]*?currentEnemyTurretLerp\(gun\)[\s\S]*?infantryVisualAngleOverride\.set/,
  'released infantry should retain the AT gun exact rendered heading');
assert.match(scene, /private setInfantryVisualFacing[\s\S]*?infantryVisualAngleOverride\.delete\(unit\.id\)/,
  'the inherited heading should yield when infantry later moves or attacks');
assert.match(scene, /private applyMachineGunAttackResult[\s\S]*?target\.kind === 'at_gun'[\s\S]*?target\.destroyed = false;[\s\S]*?this\.destroyWreckVisualIds\.delete\(target\.id\);[\s\S]*?this\.killATGunCrew\(target\);[\s\S]*?return;/, 'MG crew kills should explicitly preserve an intact gun and remove any premature wreck visual');
assert.match(scene, /private applyDiceShowDestroyedVisual[\s\S]*?show\.mg[\s\S]*?target\?\.kind === 'at_gun'[\s\S]*?target\.atGunCrewAlive === true\) return;/, 'MG dice presentation must not preview a controlled AT gun as destroyed');
assert.match(scene, /private captureAbandonedATGunsAt[\s\S]*?gun\.faction = infantry\.faction[\s\S]*?infantry\.attachedToATGunId = gun\.id[\s\S]*?rehomeCapturedATGun\(gun\)/, 'entering infantry should take control and transfer the gun to its side');
assert.match(scene, /if \(isControlledATGun\(u\)\) this\.drawATGunCrewMaybeAnim\(u\)/, 'all modes should render three operator infantry on controlled guns');
assert.match(scene, /\{ forward: this\.hexSize \* 0\.47, side: -this\.hexSize \* 0\.43 \}[\s\S]*?\{ forward: this\.hexSize \* 0\.82, side: 0 \}[\s\S]*?\{ forward: this\.hexSize \* 0\.47, side: this\.hexSize \* 0\.43 \}/, 'AT-gun crew should occupy the reference image side of the gun in an upper-right, far-right, lower-right triangle');
assert.match(scene, /const forwardShift = this\.hexSize \* 0\.25;[\s\S]*?forward \* crewSide \+ forwardShift/, 'the complete AT-gun crew formation should retain its tuned forward offset');
assert.match(scene, /private atGunCrewFormationOffsets[\s\S]*?facingLerp\?: DirectionLerp[\s\S]*?this\.topDownForwardVec\(gun, origin, facingLerp\)/, 'AT-gun crew formation should use the same interpolated facing basis as the gun');
assert.match(scene, /private drawATGunCrewMaybeAnim\(gun: Unit\)[\s\S]*?this\.anim\.kind === 'turn'[\s\S]*?this\.atGunCrewFormationOffsets\(gun, facingLerp\)[\s\S]*?this\.topDownForwardVec\(gun, c, facingLerp\)[\s\S]*?drawInfantry\([^;]+visualAngle\)/, 'live crew positions and sprite angles should share the gun turn interpolation');

for (const field of ['atGunCrewAlive', 'atGunCrewKind', 'atGunCrewTargetSize', 'atGunCrewGeneration', 'atGunControllerUnitId', 'attachedToATGunId']) {
  assert(save.includes(`${field}:`), `save snapshots should capture ${field}`);
}

console.log('Hardcore AT-gun composite tests passed');
