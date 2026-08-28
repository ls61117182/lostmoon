const assert = require('assert');
const fs = require('fs');

const types = fs.readFileSync('assets/scripts/core/types.ts', 'utf8');
const combat = fs.readFileSync('assets/scripts/core/Combat.ts', 'utf8');
const fog = fs.readFileSync('assets/scripts/core/FogOfWar.ts', 'utf8');
const loader = fs.readFileSync('assets/scripts/core/MissionLoader.ts', 'utf8');
const objective = fs.readFileSync('assets/scripts/core/Objective.ts', 'utf8');
const save = fs.readFileSync('assets/scripts/core/SaveLoad.ts', 'utf8');
const turnEnd = fs.readFileSync('assets/scripts/core/TurnEndEventApply.ts', 'utf8');
const scene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert.match(types, /Faction = [^;]*'neutral'/, 'runtime factions should support neutral abandoned guns');
assert.match(types, /atGunCrewAlive\?: boolean/, 'AT guns should persist an independent crew survival state');
assert.match(loader, /isAntiTankGunKind\(u\.kind\)[\s\S]*?u\.atGunCrewAlive = true[\s\S]*?u\.atGunCrewKind = crewKind[\s\S]*?u\.atGunCrewTargetSize = crewStats\.size/, 'scenario AT guns should start with faction infantry crews');
assert.match(loader, /function attachScenarioATGunCrews[\s\S]*?id: `\$\{gun\.id\}:scenario_crew`[\s\S]*?unitLevel: normalizeUnitLevel\(gun\.atGunCrewLevel\)[\s\S]*?crewSkills: gun\.crewSkills[\s\S]*?attachedToATGunId: gun\.id[\s\S]*?gun\.atGunControllerUnitId = crew\.id[\s\S]*?units\.push\(crew\)/,
  'scenario AT guns should create and attach a real same-faction infantry controller');

assert.match(combat, /atGunCrewTargets\?: boolean/, 'MG legality should explicitly opt into hardcore AT-gun crew targets');
assert.match(combat, /size: ctx\.target\.atGunCrewTargetSize \?\? 0/, 'MG threshold should use the controlling infantry target size');
assert.match(combat, /function isWithinThirtyDegreeArc[\s\S]*?Math\.min\(delta, 12 - delta\) <= 1/, 'mantlets and shields should share the twelve-direction +/-30-degree arc');
assert.match(combat, /function atGunShieldModifier[\s\S]*?incomingFireDirectionStepFor\(ctx\)[\s\S]*?isWithinThirtyDegreeArc\(incomingStep, shieldFacing\) \? 1 : 0/, 'AT-gun shield should use the tank-mantlet incoming direction and add one within +/-30 degrees');
assert.match(combat, /mgHitThreshold[\s\S]*?\+ atGunShieldModifier\(ctx\)/, 'MG threshold should include the directional AT-gun shield modifier');
assert.match(combat, /if \(isControlledATGun\(target\)\)[\s\S]*?target\.atGunCrewAlive = false[\s\S]*?target\.faction = 'neutral'/, 'MG hits should abandon the gun instead of destroying it');

assert.match(fog, /isAbandonedATGun\(unit\) \|\| isAttachedATGunCrew\(unit\)[\s\S]*?return visible/, 'abandoned guns and attached crews should provide no independent vision');
assert.match(fog, /isControlledATGun\(unit\) \? 'infantry'/, 'controlled guns should use infantry vision geometry');
assert.match(objective, /!e\.destroyed[\s\S]*?&& !isAbandonedATGun\(e\)/, 'neutral guns should be excluded from live enemy counts');
assert.match(objective, /liveEnemyCount[\s\S]*?!isAttachedATGunCrew\(e\)/,
  'attached scenario crews should count only through their composite gun until released');
assert.match(turnEnd, /findShermanLosInfantry[\s\S]*?isAttachedATGunCrew\(e\)/,
  'attached scenario crews should not act as independent turn-end snipers');
assert.match(turnEnd, /hasInfantryAdjacentToSherman[\s\S]*?!isAttachedATGunCrew\(e\)/,
  'attached scenario crews should not independently trigger adjacent infantry fire');
assert.match(turnEnd, /const infs = mission\.enemies\.filter\([\s\S]*?!isAttachedATGunCrew\(e\)/,
  'attached scenario crews should not independently join adjacent infantry volleys');
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
assert.match(scene, /private applyMachineGunAttackResult[\s\S]*?isAntiTankGunUnit\(target\)[\s\S]*?target\.destroyed = false;[\s\S]*?this\.destroyWreckVisualIds\.delete\(target\.id\);[\s\S]*?this\.killATGunCrew\(target\);[\s\S]*?return;/, 'MG crew kills should explicitly preserve an intact gun and remove any premature wreck visual');
assert.match(scene, /private applyDiceShowDestroyedVisual[\s\S]*?show\.mg[\s\S]*?isAntiTankGunUnit\(target\)[\s\S]*?target\.atGunCrewAlive === true\) return;/, 'MG dice presentation must not preview a controlled AT gun as destroyed');
assert.match(scene, /private captureAbandonedATGunsAt[\s\S]*?gun\.faction = infantry\.faction[\s\S]*?infantry\.attachedToATGunId = gun\.id[\s\S]*?rehomeCapturedATGun\(gun\)/, 'entering infantry should take control and transfer the gun to its side');
assert.match(scene, /private rollHighExplosiveCollateralResults[\s\S]*?!isAttachedATGunCrew\(unit\)/,
  'attached AT-gun crews should be part of the composite gun and receive no separate HE roll');
assert.match(scene, /private releaseATGunCrew[\s\S]*?let infantry = this\.atGunController\(gun\)[\s\S]*?if \(infantry\)[\s\S]*?infantry\.attachedToATGunId = undefined[\s\S]*?else \{[\s\S]*?this\.atGunCrewProxy\(gun\)/,
  'destroying a captured gun should release its original controller before falling back to a generated scenario crew');
assert.doesNotMatch(
  scene.match(/private releaseATGunCrew[\s\S]*?\n  }/)?.[0] ?? '',
  /infantry\.(?:faction|unitLevel|crewSkills)\s*=/,
  'releasing a captured gun crew must preserve the controller faction, level, and skills',
);
assert.match(scene, /if \(isControlledATGun\(u\)\) this\.drawATGunCrewMaybeAnim\(u\)/, 'all modes should render three operator infantry on controlled guns');
assert.match(scene, /\{ forward: this\.hexSize \* 0\.47, side: -this\.hexSize \* 0\.43 \}[\s\S]*?\{ forward: this\.hexSize \* 0\.82, side: 0 \}[\s\S]*?\{ forward: this\.hexSize \* 0\.47, side: this\.hexSize \* 0\.43 \}/, 'AT-gun crew should occupy the reference image side of the gun in an upper-right, far-right, lower-right triangle');
assert.match(scene, /const forwardShift = this\.hexSize \* 0\.25;[\s\S]*?forward \* crewSide \+ forwardShift/, 'the complete AT-gun crew formation should retain its tuned forward offset');
assert.match(scene, /private atGunCrewFormationOffsets[\s\S]*?facingLerp\?: DirectionLerp[\s\S]*?this\.topDownForwardVec\(gun, origin, facingLerp\)/, 'AT-gun crew formation should use the same interpolated facing basis as the gun');
assert.match(scene, /private drawATGunCrewMaybeAnim\(gun: Unit\)[\s\S]*?this\.anim\.kind === 'turn'[\s\S]*?this\.atGunCrewFormationOffsets\(gun, facingLerp\)[\s\S]*?this\.topDownForwardVec\(gun, c, facingLerp\)[\s\S]*?drawInfantry\([^;]+visualAngle\)/, 'live crew positions and sprite angles should share the gun turn interpolation');

for (const field of ['atGunCrewAlive', 'atGunCrewKind', 'atGunCrewTargetSize', 'atGunCrewGeneration', 'atGunControllerUnitId', 'attachedToATGunId']) {
  assert(save.includes(`${field}:`), `save snapshots should capture ${field}`);
}

console.log('Hardcore AT-gun composite tests passed');
