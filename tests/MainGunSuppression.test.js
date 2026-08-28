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
}, rng([4]));
assert.strictEqual(report.automaticHit, true);
assert.deepStrictEqual(report.dice, [0, 0], 'HE against infantry must not consume or display a hit roll');
assert.strictEqual(report.hit, true);
assert.strictEqual(report.outcome, 'suppressed');
applyHighExplosiveAttack(infantry, report);
assert.strictEqual(infantry.suppressed, true);

infantry.suppressed = false;
map.get(infantry.pos).hasBuilding = true;
report = rollHighExplosiveAttack({
  attacker: sherman, target: infantry, map, units: [sherman, infantry], mainGunSuppressesInfantry: true, shellType: 'he',
}, rng([5]));
assert.strictEqual(report.infantryInCover, true);
assert.strictEqual(report.outcome, 'suppressed', 'building cover raises destruction to 6+');
map.get(infantry.pos).hasBuilding = false;

const tank = make('panzer4', 'german', 2, 0, 3);
report = rollHighExplosiveAttack({ attacker: sherman, target: tank, map, units: [sherman, tank], shellType: 'he' }, rng([1, 1, 5, 4]));
assert.strictEqual(report.hit, false);
assert.deepStrictEqual(report.effectDice, [5, 4],
  'HE against a tank must pre-roll and display its immobilization dice even after a miss');
assert.strictEqual(report.outcome, 'none', 'a displayed post-miss HE roll must never affect the tank');
report = rollHighExplosiveAttack({ attacker: sherman, target: tank, map, units: [sherman, tank], shellType: 'he' }, rng([6, 6, 5, 4]));
assert.strictEqual(report.effectThreshold, tank.stats.armorFront - sherman.stats.highExplosivePower);
assert.strictEqual(report.outcome, 'paralyzed');
applyHighExplosiveAttack(tank, report);
assert.strictEqual(tank.paralyzed, true);

for (const kind of ['truck', 'at_gun']) {
  const target = make(kind, 'german', 2, 0, 3);
  report = rollHighExplosiveAttack({ attacker: sherman, target, map, units: [sherman, target], shellType: 'he' }, rng([6, 6]));
  assert.strictEqual(report.outcome, 'destroyed');
}

const artillery = make('german_heavy_artillery', 'german', 2, 0, 3);
report = rollHighExplosiveAttack({ attacker: sherman, target: artillery, map, units: [sherman, artillery], shellType: 'he' }, rng([6, 6, 3, 3]));
assert.strictEqual(report.outcome, 'suppressed');
report = rollHighExplosiveAttack({ attacker: sherman, target: artillery, map, units: [sherman, artillery], shellType: 'he' }, rng([6, 6, 4, 4]));
assert.strictEqual(report.outcome, 'fire_suppressed');
artillery.fireLevel = 1;
report = rollHighExplosiveAttack({ attacker: sherman, target: artillery, map, units: [sherman, artillery], shellType: 'he' }, rng([6, 6]));
assert.strictEqual(report.outcome, 'suppressed');
assert.strictEqual(report.effectDice, undefined);

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
  /rollHighExplosiveCollateralResults\([\s\S]*?!isAttachedATGunCrew\(unit\)/,
  'an infantry squad attached to an AT gun must resolve as part of the gun instead of receiving a separate HE check');
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
  /shellType === 'he' && isFootUnit\(e\)[\s\S]*?destroyNeed = infantryHasHighExplosiveCover\(ctx\) \? 6 : 5[\s\S]*?spawnPreviewLabel\(c\.x, c\.y - this\.hexSize \* 0\.28, destroyNeed, destroyProbability\)/,
  'HE infantry targeting preview must show only the cover-dependent destruction threshold and chance');
assert.match(battleSceneSource,
  /if \(!automaticHEHit\)[\s\S]*?else \{[\s\S]*?d1\.node\.parent!\.active = false[\s\S]*?hitVerdict\.node\.active = false/,
  'automatic infantry HE must hide the normal hit-dice row');
assert.match(battleSceneSource,
  /he\.infantryInCover !== undefined[\s\S]*?dice\.panel\.heDestroyNeed/,
  'the HE infantry result row must label its threshold as a destruction threshold');
assert.match(battleSceneSource,
  /he\.armor !== undefined[\s\S]*?dice\.panel\.heParalyzeNeed/,
  'the HE tank result row must label its threshold as an immobilization threshold');
assert.match(battleSceneSource,
  /hitNeedText = mg[\s\S]*?dice\.panel\.mgHitNeed[\s\S]*?dice\.panel\.hitNeed/,
  'main-gun hit rows must explicitly say that the displayed threshold is required to hit');
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
  /tankHighExplosiveFormula[\s\S]*?he\.armor !== undefined && he\.fireThreshold === undefined[\s\S]*?dice\.rule\.armorLine[\s\S]*?armorFaceText\(he\.armorFace\)[\s\S]*?dice\.rule\.hePower[\s\S]*?total: \[t\('dice\.rule\.heParalyzeNeed'\)/,
  'the HE tank detail modal must identify the struck armor face and separate the immobilization threshold as its total');
assert.match(battleSceneSource,
  /if \(highExplosiveReport\) \{[\s\S]*?makeDiceRuleButton\(panel, -238, penDiceY, \(\) => this\.openDiceRuleModal\('he'\)\)/,
  'the HE blast row must expose a clickable blast-detail button');
assert.match(battleSceneSource,
  /kind === 'he'[\s\S]*?populateDiceRuleHighExplosive[\s\S]*?for \(let roll = firstRoll; roll <= lastRoll; roll\+\+\)[\s\S]*?highExplosiveTableOutcome\(report, roll\)/,
  'the blast-detail modal must list the outcome for every possible HE roll');
assert.match(battleSceneSource,
  /highExplosiveTableOutcome[\s\S]*?dice\.panel\.heSuppressed[\s\S]*?highExplosiveOutcomeLabel[\s\S]*?case 'suppressed': return \{ text: t\('dice\.panel\.heSuppressed'\)/,
  'HE result tables and result rows must show suppression without an exclamation mark');
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
