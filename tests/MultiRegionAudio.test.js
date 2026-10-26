const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
const { generateMultiRegionPackage } = require('../assets/scripts/core/MultiRegionGenerator.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { RNG } = require('../assets/scripts/core/Dice.ts');
const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { isTankUnit, isFootUnit } = require('../assets/scripts/core/types.ts');
const { applyUrbanStructureDamage } = require('../assets/scripts/core/UrbanTerrain.ts');
let played = [];
const audio = Object.fromEntries([
  'playConfiguredAttackSound', 'playInfantryAntiTankFire', 'playInfantryAttack', 'playMgFire',
  'playHighExplosiveHit', 'playTankHitPenetration', 'playTankHitRicochet', 'playTankExplosion',
  'playCommanderHatch', 'playSmokeDeploy', 'playBuildingCollapse', 'playInfantryMove',
  'startManeuverSound', 'startTurretTraverseSound',
].map(name => [name, () => played.push(name)]));
const Scene = sceneMethods([
  'canHearBattleAt', 'isOutsidePlayerRegion', 'playAttackFireCue', 'playMachineGunFireCue',
  'playHighExplosiveSuppressionCue', 'playTankDestroySoundOnce', 'deploySmokeAt',
  'applyUrbanBuildingDamage', 'updateNonPlayerTankCommanderHatch', 'playMoveStartSound',
  'advanceProjectileTraces', 'advanceInfantryRocketTraces', 'beginTurretAimAnim',
], { ...audio, isTankUnit, isFootUnit, applyUrbanStructureDamage, HexMap,
  GameSession: { gameMode: 'hardcore' }, shouldNonPlayerTankOpenCommanderHatch: () => true,
  clearLockedFire() {},
});
function fixture() {
  played = [];
  const mission = loadMission(generateMultiRegionPackage(20261026, 4).mission, new RNG(1), { hardcore: true });
  const scene = new Scene();
  Object.assign(scene, { mission, hexSize: 60, destroyWreckVisualIds: new Set(), smokeScreenAges: new Map(),
    projectileTraces: [], infantryRocketTraces: [], enemyTurretFacing: new Map(),
    rememberAttackPosition() {}, setInfantryVisualFacing() {}, redraw() {}, startMainGunRecoil() {},
    spawnMuzzleSmoke() {}, spawnMuzzleFlash() {}, spawnProjectileTrace() {},
    spawnInfantryRocketTrace() {}, spawnInfantryBulletVolley() {}, spawnMachineGunBurst() {},
    allUnits: () => [mission.sherman, ...mission.allies, ...mission.enemies],
    displayedFogVisionSnapshot: () => null, startFogVisionTransition() {},
    hashStringToSeed: () => 1, project: (q, r) => ({ x: q, y: r }), spawnHighExplosiveBlast() {},
    drawProjectileTrace() {}, drawInfantryRocketTrace() {},
  });
  const local = mission.data.multiRegion.regions[0].center;
  const remote = mission.data.multiRegion.regions[1].center;
  return { scene, mission, local, remote };
}

test('battle sound follows the player region, independent of fog, and ordinary missions keep their sound', () => {
  const { scene, mission, local, remote } = fixture();
  assert.equal(scene.canHearBattleAt(local), true);
  assert.equal(scene.canHearBattleAt(remote), false);
  mission.sherman.pos = { ...remote };
  assert.equal(scene.canHearBattleAt(local), false);
  assert.equal(scene.canHearBattleAt(remote), true);
  delete mission.data.multiRegion;
  assert.equal(scene.canHearBattleAt(local), true);
  assert.equal(scene.canHearBattleAt(), true);
});

test('remote cannon, MG, infantry volley and launcher cues are silent; hidden local units retain sound', () => {
  const { scene, mission, local, remote } = fixture();
  for (const [attackerKind, targetKind, mg, expected] of [
    ['panzer4', 'sherman', false, 'playConfiguredAttackSound'],
    ['panzer4', 'american_infantry', true, 'playMgFire'],
    ['german_infantry', 'american_infantry', false, 'playInfantryAttack'],
    ['german_infantry', 'sherman', false, 'playInfantryAntiTankFire'],
  ]) {
    for (const pos of [remote, local]) {
      played = [];
      const attacker = { ...mission.enemies[0], kind: attackerKind, pos, hidden: true };
      const target = { ...mission.sherman, kind: targetKind, pos };
      scene.playAttackFireCue(attacker, target, mg, 'audio/cannon_fire');
      assert.deepEqual(played, pos === local ? [expected] : []);
    }
  }
});

test('remote destruction, hatch, smoke and building damage remain effective without playing sound', () => {
  const { scene, mission, local, remote } = fixture();
  for (const pos of [remote, local]) {
    played = [];
    const tank = { ...mission.enemies.find(isTankUnit), id: 'audio_tank', pos, destroyed: true, hatchOpen: false };
    scene.playTankDestroySoundOnce(tank);
    tank.destroyed = false;
    scene.updateNonPlayerTankCommanderHatch(tank);
    assert.equal(tank.hatchOpen, true);
    scene.deploySmokeAt(pos, 'enemy');
    assert(mission.smokeHexes.has(HexMap.keyOf(pos)));
    const building = { pos, terrain: 'urban_dense', urbanKind: 'destructible', urbanStructure: 2 };
    assert(scene.applyUrbanBuildingDamage(building, 10) > 0);
    assert.equal(building.terrain, 'urban_rubble');
    assert.deepEqual(played, pos === local
      ? ['playTankExplosion', 'playCommanderHatch', 'playSmokeDeploy', 'playBuildingCollapse'] : []);
  }
});

test('HE impact rechecks its region after a camera change and still commits combat effects', () => {
  const { scene, mission, local, remote } = fixture();
  const attacker = { ...mission.enemies[0], pos: local }, target = { ...mission.sherman, pos: local };
  let impact, resolved = 0;
  scene.spawnProjectileTrace = (_a, _t, _r, options) => {
    scene.projectileTraces.push({}); impact = options.onPenetrationImpact;
  };
  scene.playHighExplosiveSuppressionCue(attacker, target, { hit: true }, () => resolved++);
  assert.deepEqual(played, ['playConfiguredAttackSound']);
  played = [];
  mission.sherman.pos = { ...remote };
  impact(0, 0);
  assert.deepEqual(played, []);
  assert.equal(resolved, 1);
  impact(0, 0);
  assert.equal(resolved, 1, 'the impact still resolves exactly once');
});

test('delayed cannon and rocket impacts stay silent off-region without skipping penetration callbacks', () => {
  const { scene, local, remote } = fixture();
  for (const impactHex of [remote, local]) {
    played = []; let resolved = 0;
    scene.projectileTraces = [{ impactHex, phase: 'flight', mode: 'penetration', t: 0, dur: .1,
      impactX: 0, impactY: 0, node: { destroy() {} }, onPenetrationImpact: () => resolved++ }];
    scene.infantryRocketTraces = [{ impactHex, mode: 'penetration', t: 0, flightDur: .1, dur: 1,
      node: { destroy() {} }, onPenetrationImpact: () => resolved++ }];
    scene.advanceProjectileTraces(.2);
    scene.advanceInfantryRocketTraces(.2);
    assert.equal(resolved, 2);
    assert.deepEqual(played, impactHex === local ? ['playTankHitPenetration', 'playTankHitPenetration'] : []);
  }
});

test('remote movement and turret rotation are silent; entering the current region restores normal move audio', () => {
  const { scene, mission, local, remote } = fixture();
  const tank = { ...mission.enemies.find(isTankUnit), pos: remote }, infantry = { ...tank, kind: 'german_infantry', stats: { moveSound: '' } };
  scene.playMoveStartSound({ unit: tank, kind: 'move', t: 0 });
  scene.playMoveStartSound({ unit: infantry, kind: 'move', t: 0 });
  let rotated = 0;
  scene.beginTurretAimAnim({ unit: tank, from: 0, to: 1, onDone: () => rotated++ });
  assert.equal(rotated, 1);
  assert.equal(tank.turretFacing, 1);
  assert.deepEqual(played, []);
  tank.pos = { ...local }; infantry.pos = { ...local };
  scene.playMoveStartSound({ unit: tank, kind: 'move', t: 0 });
  scene.playMoveStartSound({ unit: infantry, kind: 'move', t: 0 });
  scene.playMoveStartSound({ unit: tank, kind: 'move', t: .5 });
  assert.deepEqual(played, ['startManeuverSound', 'playInfantryMove']);
});
