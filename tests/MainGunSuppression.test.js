const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  }).outputText;
  module._compile(output, filename);
};

const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const {
  applyHighExplosiveAttack,
  canAttack,
  nonPlayerTankWeaponForTarget,
  rollAttack,
  rollHighExplosiveAttack,
} = require('../assets/scripts/core/Combat.ts');
const {
  applyInfantrySuppression,
  consumeInfantryTurnSuppression,
  isMainGunSuppressionAttack,
  selectMainGunTargetsByHex,
} = require('../assets/scripts/core/Suppression.ts');
const { isMainGunLoaded, resolvedLoadedShell } = require('../assets/scripts/core/types.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { infantryTurnActions } = require('../assets/scripts/core/UnitLevel.ts');
const battleSceneSource = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

const map = new HexMap(8, 8);
for (let q = 0; q < 8; q++) for (let r = 0; r < 8; r++) map.set({ pos: { q, r }, terrain: 'field' });
const make = (kind, faction, q, r, facing = 3) => ({
  id: `${kind}-${q}-${r}`, kind, faction, pos: { q, r }, facing, turretFacing: facing,
  stats: getUnitStats(kind), atGunCrewAlive: kind === 'at_gun',
});
const sherman = make('sherman', 'usa', 0, 0, 0);
const infantry = make('german_infantry', 'german', 2, 0, null);
const officer = make('officer', 'german', 2, 0, null);

assert.strictEqual(resolvedLoadedShell({ loaded: false, loadedShell: 'ap' }), 'ap');
assert.strictEqual(isMainGunLoaded({ loaded: false, loadedShell: 'ap' }, true), true,
  'hardcore AP chamber state must not be mistaken for an unloaded rotation action');
assert.strictEqual(isMainGunLoaded({ loaded: true, loadedShell: null }, true), false,
  'an explicit empty hardcore chamber must override the legacy loaded boolean');
assert.strictEqual(isMainGunLoaded({ loaded: true, loadedShell: undefined }, true), true,
  'legacy loaded saves migrate to AP when no shell field exists');

assert.strictEqual(isMainGunSuppressionAttack(sherman, infantry, true, 'ap'), false);
assert.strictEqual(isMainGunSuppressionAttack(sherman, infantry, true, 'he'), true);
assert.strictEqual(isMainGunSuppressionAttack(sherman, officer, true, 'he'), false);
assert.strictEqual(canAttack({ attacker: sherman, target: infantry, map, mainGunSuppressesInfantry: true, shellType: 'ap' }).ok, false);
assert.strictEqual(canAttack({ attacker: sherman, target: infantry, map, mainGunSuppressesInfantry: true, shellType: 'he' }).ok, true);
assert.strictEqual(canAttack({
  attacker: sherman, target: infantry, map, mainGunSuppressesInfantry: true, shellType: 'he', precisionFire: true,
}).reason, 'attack.reason.precisionInvalidTarget');
assert.strictEqual(canAttack({
  attacker: sherman, target: make('at_gun', 'german', 2, 0), map, shellType: 'he', precisionFire: true,
}).reason, 'attack.reason.precisionInvalidTarget');
assert.strictEqual(canAttack({
  attacker: sherman, target: make('at_gun', 'german', 2, 0), map, shellType: 'ap', precisionFire: true,
}).ok, true, 'AP precision fire must allow an anti-tank gun target');

const veteranInfantry = { ...infantry, id: 'veteran-infantry', unitLevel: 'veteran', suppressed: false };
assert.strictEqual(infantryTurnActions(veteranInfantry).length, 2,
  'the regression fixture must be a veteran with two actions');
assert.strictEqual(applyInfantrySuppression(veteranInfantry), true);
assert.strictEqual(consumeInfantryTurnSuppression(veteranInfantry), true);
assert.strictEqual(veteranInfantry.suppressed, false,
  'suppression is cleared only after the skipped turn is consumed');
assert.match(battleSceneSource,
  /consumeInfantryTurnSuppression\(enemy\)[\s\S]*?enemyInfantryActionIndex = infantryTurnActions\(enemy\)\.length[\s\S]*?enemyIndex\+\+[\s\S]*?beginCurrentEnemyTurn\(\)/,
  'suppression must consume every rank-granted infantry action and advance to the next actor');

assert.strictEqual(nonPlayerTankWeaponForTarget(infantry, 1), 'mg');
assert.strictEqual(nonPlayerTankWeaponForTarget(infantry, 2), 'he');
assert.strictEqual(nonPlayerTankWeaponForTarget(make('at_gun', 'german', 1, 0), 1), 'mg');
assert.strictEqual(nonPlayerTankWeaponForTarget(make('at_gun', 'german', 2, 0), 2), 'he');
assert.strictEqual(nonPlayerTankWeaponForTarget(make('truck', 'german', 2, 0), 2), 'he');
assert.strictEqual(nonPlayerTankWeaponForTarget(make('panzer4', 'german', 2, 0), 2), 'ap');
assert.strictEqual(nonPlayerTankWeaponForTarget(make('stug3', 'german', 2, 0), 2), 'ap');
assert.strictEqual(nonPlayerTankWeaponForTarget(make('german_heavy_artillery', 'german', 2, 0), 2), 'ap');

const rng = values => ({ d6: () => values.shift() });
let report = rollHighExplosiveAttack({
  attacker: sherman, target: infantry, map, units: [sherman, infantry], mainGunSuppressesInfantry: true, shellType: 'he',
}, rng([2, 2]));
assert.strictEqual(report.automaticHit, true);
assert.deepStrictEqual(report.dice, [0, 0], 'HE against infantry must not consume or display a hit roll');
assert.strictEqual(report.hit, true);
assert.deepStrictEqual(report.effectDice, [2, 2], 'infantry HE must use 2d6');
assert.strictEqual(report.destroyThreshold, 10);
assert.strictEqual(report.suppressThreshold, 4);
assert.strictEqual(report.infantryCoverSource, undefined, 'open ground must not report a cover row');
assert.strictEqual(report.outcome, 'suppressed');
applyHighExplosiveAttack(infantry, report);
assert.strictEqual(infantry.suppressed, true);

infantry.suppressed = false;
map.get(infantry.pos).hasBuilding = true;
report = rollHighExplosiveAttack({
  attacker: sherman, target: infantry, map, units: [sherman, infantry], mainGunSuppressesInfantry: true, shellType: 'he',
}, rng([2, 2]));
assert.strictEqual(report.infantryInCover, true);
assert.strictEqual(report.infantryCoverSource, 'building');
assert.strictEqual(report.destroyThreshold, 11);
assert.strictEqual(report.suppressThreshold, 5);
assert.strictEqual(report.outcome, 'none', 'one point of cover raises both infantry thresholds by one');
map.get(infantry.pos).hasBuilding = false;
map.get(infantry.pos).terrain = 'forest';
report = rollHighExplosiveAttack({
  attacker: sherman, target: infantry, map, units: [sherman, infantry], mainGunSuppressesInfantry: true, shellType: 'he',
}, rng([2, 2]));
assert.strictEqual(report.infantryCoverSource, 'forest');
map.get(infantry.pos).terrain = 'field';

const tank = make('panzer4', 'german', 2, 0, 3);
report = rollHighExplosiveAttack({ attacker: sherman, target: tank, map, units: [sherman, tank], shellType: 'he' }, rng([1, 1, 5, 4]));
assert.strictEqual(report.hit, false);
assert.deepStrictEqual(report.effectDice, [5, 4],
  'HE against a tank must pre-roll and display its immobilization dice even after a miss');
assert.strictEqual(report.outcome, 'none', 'a displayed post-miss HE roll must never affect the tank');
report = rollHighExplosiveAttack({ attacker: sherman, target: tank, map, units: [sherman, tank], shellType: 'he' }, rng([6, 6, 5, 4]));
assert.strictEqual(report.effectThreshold, tank.stats.armorFront - sherman.stats.highExplosivePower);
assert.strictEqual(report.paralyzeThreshold, tank.stats.armorFront - sherman.stats.highExplosivePower);
assert.strictEqual(report.fireThreshold, tank.stats.armorFront + 4 - sherman.stats.highExplosivePower);
assert.strictEqual(report.outcome, 'paralyzed');
applyHighExplosiveAttack(tank, report);
assert.strictEqual(tank.paralyzed, true);

const lightTank = {
  ...tank,
  id: 'light-tank',
  stats: { ...tank.stats, armorFront: 8 },
};
report = rollHighExplosiveAttack({
  attacker: sherman, target: lightTank, map, units: [sherman, lightTank], shellType: 'he',
}, rng([6, 6, 5, 5]));
assert.strictEqual(report.paralyzeThreshold, 6);
assert.strictEqual(report.fireThreshold, 10);
assert.strictEqual(report.effectThreshold, 10, 'a fire result must expose the fire threshold as the effective threshold');
assert.strictEqual(report.outcome, 'fire');
applyHighExplosiveAttack(lightTank, report);
assert.strictEqual(lightTank.fireLevel, 1);

const burningTank = { ...lightTank, id: 'burning-tank', fireLevel: 1 };
report = rollHighExplosiveAttack({
  attacker: sherman, target: burningTank, map, units: [sherman, burningTank], shellType: 'he',
}, rng([6, 6, 5, 5]));
assert.strictEqual(report.outcome, 'destroyed', 'repeat HE fire must destroy a burning non-player tank');
assert.strictEqual(report.destroyedByRepeatFire, true);
applyHighExplosiveAttack(burningTank, report);
assert.strictEqual(burningTank.destroyed, true);

const burningProtagonist = {
  ...lightTank,
  id: 'burning-protagonist',
  controller: 'local_player',
  fireLevel: 1,
};
report = rollHighExplosiveAttack({
  attacker: sherman,
  target: burningProtagonist,
  protagonist: burningProtagonist,
  map,
  units: [sherman, burningProtagonist],
  shellType: 'he',
}, rng([6, 6, 5, 5]));
assert.strictEqual(report.outcome, 'fire', 'repeat HE fire must not directly destroy the protagonist tank');
assert.strictEqual(report.destroyedByRepeatFire, false);

const heTruck = make('truck', 'german', 2, 0, 3);
report = rollHighExplosiveAttack({ attacker: sherman, target: heTruck, map, units: [sherman, heTruck], shellType: 'he' }, rng([6, 6]));
assert.strictEqual(report.outcome, 'destroyed', 'a hit must destroy a truck without a blast check');

const atGun = make('at_gun', 'german', 2, 0, 3);
report = rollHighExplosiveAttack({ attacker: sherman, target: atGun, map, units: [sherman, atGun], shellType: 'he' }, rng([5, 5]));
assert.strictEqual(report.automaticHit, true, 'HE must automatically hit an AT gun');
assert.deepStrictEqual(report.effectDice, [5, 5]);
assert.strictEqual(report.destroyThreshold, 10);
assert.strictEqual(report.outcome, 'destroyed');

const artillery = make('german_heavy_artillery', 'german', 2, 0, 3);
const bunkerHEContext = {
  attacker: sherman, target: artillery, map, units: [sherman, artillery], shellType: 'he',
  hardcoreHeavyArtilleryRules: true,
};
report = rollHighExplosiveAttack(bunkerHEContext, rng([3, 3]));
assert.strictEqual(report.automaticHit, true);
assert.strictEqual(report.fireThreshold, 6);
assert.strictEqual(report.destroyThreshold, 10);
assert.strictEqual(report.outcome, 'fire');
report = rollHighExplosiveAttack(bunkerHEContext, rng([5, 5]));
assert.strictEqual(report.outcome, 'destroyed');

const burningArtillery = { ...artillery, id: 'burning-artillery', fireLevel: 1 };
const burningBunkerHEContext = {
  ...bunkerHEContext,
  target: burningArtillery,
  units: [sherman, burningArtillery],
};
report = rollHighExplosiveAttack(burningBunkerHEContext, rng([3, 3]));
assert.strictEqual(report.outcome, 'destroyed', 'a second heavy-artillery fire result must destroy it');
assert.strictEqual(report.destroyedByRepeatFire, true);
applyHighExplosiveAttack(burningArtillery, report);
assert.strictEqual(burningArtillery.destroyed, true);

report = rollHighExplosiveAttack({
  ...bunkerHEContext, precisionFire: true, hitThresholdModifier: -2,
}, rng([3, 3]));
assert.strictEqual(report.shootingPortHit, true);
assert.strictEqual(report.outcome, 'destroyed');
assert.strictEqual(report.effectDice, undefined, 'a shooting-port hit destroys before the HE power check');

report = rollHighExplosiveAttack({
  ...bunkerHEContext, precisionFire: true, hitThresholdModifier: -2,
}, rng([1, 1, 5, 5]));
assert.strictEqual(report.shootingPortHit, false);
assert.strictEqual(report.hit, true, 'a shooting-port miss must still hit the bunker body');
assert.strictEqual(report.outcome, 'destroyed', 'the failed port attempt must continue into the HE power check');

let apReport = rollAttack({
  attacker: sherman, target: artillery, map,
  hardcoreHeavyArtilleryRules: true,
  directionalDamageCheck: true,
  unitDamageTargetClass: true,
  overpenetration: true,
}, rng([4, 4, 6]));
assert.strictEqual(apReport.automaticHit, true);
assert.deepStrictEqual(apReport.dice, [0, 0], 'ordinary AP fire at a bunker skips the hit roll');
assert.deepStrictEqual(apReport.penDice, [4, 4]);

apReport = rollAttack({
  attacker: { ...sherman, stats: { ...sherman.stats, penetration: 10 } },
  target: artillery,
  map,
  hardcoreHeavyArtilleryRules: true,
  overpenetration: true,
}, rng([6, 6, 6]));
assert.strictEqual(apReport.overpenetrated, true, 'a bunker must remain eligible for AP overpenetration');

apReport = rollAttack({
  attacker: sherman, target: artillery, map,
  hardcoreHeavyArtilleryRules: true,
  precisionFire: true,
  hitThresholdModifier: -2,
}, rng([3, 3]));
assert.strictEqual(apReport.shootingPortHit, true);
assert.strictEqual(apReport.damageEffect, 'destroyed');
assert.strictEqual(apReport.penDice, undefined);

apReport = rollAttack({
  attacker: sherman, target: artillery, map,
  hardcoreHeavyArtilleryRules: true,
  precisionFire: true,
  hitThresholdModifier: -2,
}, rng([1, 1, 6, 6, 6]));
assert.strictEqual(apReport.shootingPortHit, false);
assert.strictEqual(apReport.hit, true);
assert.deepStrictEqual(apReport.penDice, [6, 6], 'a port miss must continue into AP penetration');

const truck = make('truck', 'german', 2, 3, 3);
const coLocatedInfantry = make('german_infantry', 'german', 2, 3, null);
assert.deepStrictEqual(selectMainGunTargetsByHex([coLocatedInfantry, truck]).map(unit => unit.id), [truck.id]);

assert.match(battleSceneSource,
  /if \(loadedShell === 'he'\)[\s\S]*?highExplosivePanelReport\(report\)[\s\S]*?startDiceShow\(panelReport[\s\S]*?highExplosiveReport: report[\s\S]*?onHold: \(\) => applyAndSyncHEAttack\(false\)/,
  'player HE must use the AP-style result panel and apply its result while the panel waits for confirmation');
assert.match(battleSceneSource,
  /if \(automaticWeapon === 'he'\)[\s\S]*?highExplosivePanelReport\(report\)[\s\S]*?startDiceShow\(panelReport[\s\S]*?highExplosiveReport: report[\s\S]*?runNextEnemyStep\(\)/,
  'AI HE must wait for the shared result panel confirmation before continuing its turn');
assert.match(battleSceneSource,
  /highExplosiveReport\?: HighExplosiveReport[\s\S]*?buildDiceShowPanel\([\s\S]*?opts\.highExplosiveReport,[\s\S]*?opts\.highExplosiveCollateral/,
  'the shared AP result modal must accept HE-specific presentation data');
assert.match(battleSceneSource,
  /rollHighExplosiveCollateralResults\([\s\S]*?if \(!this\.mission\) return \[\][\s\S]*?!isAttachedATGunCrew\(unit\)[\s\S]*?unit\.pos\.q === target\.pos\.q[\s\S]*?rollHighExplosiveAttack\([\s\S]*?target: infantry/,
  'every ordinary infantry unit sharing an HE target hex must receive a pre-rolled blast result');
assert.match(battleSceneSource,
  /rollHighExplosiveCollateralResults\([\s\S]*?isAntiTankGunUnit\(target\)[\s\S]*?unit\.attachedToATGunId === target\.id/,
  'the targeted AT gun crew must receive exactly one additional infantry HE check');
assert.doesNotMatch(
  battleSceneSource.match(/private rollHighExplosiveCollateralResults[\s\S]*?\n  }/)?.[0] ?? '',
  /report\.hit|isTankUnit\(target\)/,
  'collateral infantry HE checks must not depend on the primary target type or hit result');
assert.match(battleSceneSource,
  /highExplosiveCollateral\.length[\s\S]*?attackerLabel} → \$\{unitDisplayName\(collateral\.target\.kind\)}[\s\S]*?highExplosiveCollateralRows\.push/,
  'the tank HE result panel must add an attacker-to-infantry result section below the tank result');
assert.match(battleSceneSource,
  /basePanelH \+ highExplosiveCollateral\.length \* 116[\s\S]*?collateralAnchorY = heHasEffectRow \? penDiceY : hitDiceY[\s\S]*?rowY = collateralAnchorY - 126 - i \* 110[\s\S]*?rowY \+ 54/,
  'collateral HE rows must reserve separate vertical space for their title and dice');
assert.match(battleSceneSource,
  /applyHighExplosiveAttackResult\([\s\S]*?collateralResults[\s\S]*?applyHighExplosiveAttack\(collateral\.target, collateral\.report\)/,
  'confirmation must apply the exact collateral infantry reports shown in the panel without rerolling');
assert.match(battleSceneSource,
  /else \{[\s\S]*?penVerdictLabel\.node\.active = false[\s\S]*?for \(let i = 0; i < show\.highExplosiveCollateralRows\.length; i\+\+\)/,
  'collateral infantry results must still be revealed when the primary HE attack misses');
assert.match(battleSceneSource,
  /shellType === 'he' && isFootUnit\(e\)[\s\S]*?destroyNeed = 12 \+ infantryHighExplosiveCoverValue\(ctx\)[\s\S]*?sherman\.stats\.highExplosivePower[\s\S]*?probHit2d6\(destroyNeed\)/,
  'HE infantry targeting preview must show only the cover-dependent destruction threshold and chance');
assert.match(battleSceneSource,
  /if \(!automaticHit\)[\s\S]*?else \{[\s\S]*?d1\.node\.parent!\.active = false[\s\S]*?hitVerdict\.node\.active = false/,
  'automatic infantry HE must hide the normal hit-dice row');
assert.match(battleSceneSource,
  /he\.suppressThreshold !== undefined[\s\S]*?he\.outcome === 'destroyed'[\s\S]*?heDestroyNeed[\s\S]*?heSuppressNeed/,
  'the HE infantry row must show destroy-needed only for destruction, otherwise suppress-needed');
assert.match(battleSceneSource,
  /he\.fireThreshold !== undefined[\s\S]*?he\.outcome === 'destroyed'[\s\S]*?heDestroyNeed[\s\S]*?heFireNeed/,
  'the heavy-artillery HE row must show destroy-needed only for destruction, otherwise fire-needed');
assert.match(battleSceneSource,
  /he\.destroyedByRepeatFire \? he\.fireThreshold[\s\S]*?: he\.destroyThreshold/,
  'a repeated-fire destruction must display the fire threshold as its effective destroy threshold');
assert.match(battleSceneSource,
  /he\.paralyzeThreshold !== undefined[\s\S]*?he\.outcome === 'fire' \|\| he\.outcome === 'destroyed'[\s\S]*?heFireNeed[\s\S]*?heParalyzeNeed/,
  'the HE tank result row must show fire-needed for fire/destruction and immobilize-needed otherwise');
assert.match(battleSceneSource,
  /hitNeedText = mg[\s\S]*?dice\.panel\.mgHitNeed[\s\S]*?dice\.panel\.hitNeed/,
  'main-gun hit rows must explicitly say that the displayed threshold is required to hit');
assert.match(battleSceneSource,
  /shootingPortHit !== undefined[\s\S]*?shootingPortHitNeed[\s\S]*?shootingPortMissContinue/,
  'bunker precision fire must label its firing-slit roll and show that a miss continues');
assert.match(battleSceneSource,
  /if \(he\.effectDice\?\.length\)[\s\S]*?!he\.hit[\s\S]*?dice\.panel\.heParalyzeCheck[\s\S]*?dice\.panel\.invalid/,
  'a missed HE tank attack must still show its pre-rolled immobilization row as an invalid check');
assert.match(battleSceneSource,
  /show\.penNeedLabel\.string = t\('dice\.panel\.penCheck'\)[\s\S]*?show\.penNeedLabel\.color = DICE_INFO_TEXT[\s\S]*?show\.penVerdictLabel\.string = t\('dice\.panel\.invalid'\)/,
  'a missed AP attack must label the white middle row as penetration check while retaining the invalid verdict');
assert.match(battleSceneSource,
  /thr <= 0[\s\S]*?dice\.panel\.penMustPen[\s\S]*?dice\.panel\.penetrateNeed/,
  'a normal AP penetration threshold must be labeled as required to penetrate');
assert.match(battleSceneSource,
  /he\.armor !== undefined && he\.paralyzeThreshold !== undefined[\s\S]*?dice\.rule\.armorLine[\s\S]*?armorFaceText\(he\.armorFace\)[\s\S]*?dice\.rule\.hePower[\s\S]*?dice\.rule\.heFireModifier[\s\S]*?dice\.rule\.heFireNeed[\s\S]*?dice\.rule\.heParalyzeNeed/,
  'the HE tank detail modal must identify the armor face and show both fire and immobilization thresholds');
assert.match(battleSceneSource,
  /if \(highExplosiveReport\) \{[\s\S]*?makeDiceRuleButton\(panel, -238, penDiceY, \(\) => this\.openDiceRuleModal\('he'\)\)/,
  'the HE blast row must expose a clickable blast-detail button');
assert.match(battleSceneSource,
  /dice\.rule\.heBaseDestroy[\s\S]*?dice\.rule\.heBaseSuppress[\s\S]*?coverValue !== 0[\s\S]*?infantryCoverSource === 'building'[\s\S]*?terrain\.forest[\s\S]*?dice\.rule\.hePower[\s\S]*?heSuppressNeed/,
  'the infantry blast-detail modal must list every threshold parameter and summarize destroy and suppression totals');
assert.match(battleSceneSource,
  /const totals = spec\.totals[\s\S]*?drawDiceRuleDivider[\s\S]*?for \(const total of totals\)/,
  'formula detail modals must draw a divider before rendering all summarized thresholds');
assert.match(battleSceneSource,
  /playHighExplosiveSuppressionCue\([\s\S]*?report\?: HighExplosiveReport[\s\S]*?const hit = report\?\.hit \?\? true[\s\S]*?\{ hit, penetrated: hit[\s\S]*?onPenetrationImpact: hit[\s\S]*?spawnHighExplosiveBlast/,
  'HE must create its target-side blast only on a reported hit while preserving legacy replay cues');
assert.match(battleSceneSource,
  /drawHighExplosiveBlast[\s\S]*?smokeLobes[\s\S]*?pressure ring[\s\S]*?shockProgress/,
  'HE hits must combine fire, smoke/debris, and an expanding pressure ring');
assert.doesNotMatch(
  battleSceneSource.match(/private drawProjectilePenetration[\s\S]*?\n  }/)?.[0] ?? '',
  /g\.close\(\)|255, 92, 30/,
  'AP penetration must not reuse the old orange muzzle-flash-shaped cone at the target');

console.log('Hardcore AP/HE main-gun rules test passed');
