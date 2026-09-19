const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const sharp = require('sharp');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const types = require('../assets/scripts/core/types.ts');
const visuals = require('../assets/scripts/core/TankVisualDB.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { canExecuteAction } = require('../assets/scripts/core/EnemyAI.ts');
const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
function scenario() {
  const data = JSON.parse(fs.readFileSync('assets/resources/missions/mission_03.json', 'utf8'));
  data.id = 'test_flak88'; data.theater = 'europe'; data.enemyStartByDice = false;
  data.enemies = [{ kind: 'flak88', at: { col: 6, row: 4 }, facing: 3, turretFacing: 0 }];
  return loadMission(data);
}
// Execute the real scene methods with a minimal renderer host, without a Cocos window.
const source = ts.createSourceFile('BattleScene.ts', fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const sceneClass = source.statements.find(s => ts.isClassDeclaration(s) && s.name?.text === 'BattleScene');
function sceneMethods(names, globals = {}) {
  const methods = names.map(name => sceneClass.members.find(m => m.name?.getText(source) === name).getText(source));
  const js = ts.transpileModule(`class TestScene { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return vm.runInNewContext(js + '\nTestScene', { ...types, ...visuals, isSplitTankKind: k => visuals.SPLIT_TANK_KINDS.includes(k), ...globals });
}
test('88mm gun creates a German infantry controller and remains immobile after save/load', () => {
  const mission = scenario(), gun = mission.enemies[0];
  assert.equal(types.isAntiTankGunUnit(gun), true);
  assert.equal(types.isTankUnit(gun), false);
  assert.equal(types.isControlledATGun(gun), true);
  assert.equal(gun.stats.visionType, 'turreted');
  assert.equal(gun.stats.mobility, 0);
  assert.equal(gun.facing, 3); assert.equal(gun.turretFacing, 0);
  const crew = mission.enemies.find(u => u.id === gun.atGunControllerUnitId);
  assert.equal(crew.kind, 'german_infantry'); assert.equal(crew.attachedToATGunId, gun.id);
  gun.turretFacing = 7;
  const save = captureSave({ gameMode: 'hardcore', missionId: mission.data.id, mission, turn: 1, phase: 'player', movesLeft: 2, attacksLeft: 1, miscDone: false, playerStep: 'choose', hatchChangedThisTurn: false, phaseDice: [] });
  const restored = scenario(); assert.equal(applySave(restored, restored.data.id, save).ok, true);
  const loaded = restored.enemies[0];
  assert.equal(loaded.facing, 3); assert.equal(loaded.turretFacing, 7);
  loaded.paralyzed = false; // Repairs must never unlock emplacement movement.
  for (const action of ['turn', 'advance', 'reverse', 'advance_to_building', 'infantry_move']) {
    assert.equal(canExecuteAction(loaded, action, restored.sherman, restored.map, new Set()), false, action);
  }
  loaded.atGunCrewAlive = false;
  assert.equal(types.isControlledATGun(loaded), false); assert.equal(types.isAbandonedATGun(loaded), true);
});
test('terrain-obstructed emplacement cannot use the mobile AT-gun forward fallback', () => {
  const Scene = sceneMethods(['tryHardcoreATGunForwardMove']);
  const scene = new Scene(); scene.mission = {};
  assert.equal(scene.tryHardcoreATGunForwardMove(scenario().enemies[0], 0), false);
  assert.equal(scene.anim, undefined);
});
test('rendering leaves base fixed and sends the same turret interpolation to gun and crew', () => {
  const Scene = sceneMethods(['drawUnit', 'drawATGunCrewMaybeAnim'], { isEnemyTopKind: k => k === 'flak88', commanderHatchVisualState: () => 'hidden' });
  const scene = new Scene(); const gun = scenario().enemies[0];
  const aim = { from: 0, to: 2, t: 0.5, angular: true };
  Object.assign(scene, { hexSize: 64, mission: {}, project: () => ({ x: 0, y: 0 }), enemyTopPoolNext: 0, enemyTopSpritePool: [{}, {}, {}], commanderHatchSpriteFrames: {}, enemySupportsSplitTurret: () => true, currentEnemyTurretLerp: () => aim });
  let hullFacing, turretFacing, crewFacing, crewAngle;
  scene.applySplitTankHullSprite = (...args) => { hullFacing = args[4]; };
  scene.applySplitTankTurretSprite = (...args) => { turretFacing = args[5]; };
  scene.drawUnit(gun);
  assert.equal(hullFacing, undefined); assert.equal(turretFacing, aim); assert.equal(gun.facing, 3);
  scene.atGunCrewFormationOffsets = (_gun, lerp) => { crewFacing = lerp; return []; };
  scene.topDownForwardVec = (_gun, _center, lerp) => { assert.equal(lerp, aim); return { ux: 0, uy: 1 }; };
  scene.atGunCrewActor = () => ({});
  scene.drawInfantry = (_crew, _x, _y, _offsets, angle) => { crewAngle = angle; };
  scene.drawSuppressionMarks = () => {};
  scene.drawATGunCrewMaybeAnim(gun);
  assert.equal(crewFacing, turretFacing); assert.equal(crewAngle, 180);
});
test('all layers are 150px and intact composite uses the same pivot and scale', async () => {
  const dir = 'assets/resources/textures/units/';
  for (const suffix of ['', '_hull', '_turret', '_destroyed']) {
    const info = await sharp(dir + 'flak88_top' + suffix + '.png').metadata();
    assert.equal(info.width, 150); assert.equal(info.height, 150); assert.equal(info.hasAlpha, true);
  }
  const cfg = visuals.splitTankGeometryConfigOf('flak88');
  assert.equal(cfg.pivot.bodyX, cfg.pivot.spriteX); assert.equal(cfg.pivot.bodyY, cfg.pivot.spriteY);
  assert.equal(visuals.splitTankVisualConfigOf('flak88').turretScale, 1);
  const expected = await sharp(dir+'flak88_top_hull.png').composite([{input:dir+'flak88_top_turret.png'}]).raw().toBuffer();
  const actual = await sharp(dir+'flak88_top.png').raw().toBuffer();
  assert.deepEqual(actual, expected);
});

test('destroyed base keeps the intact base display size and offset', () => {
  const Scene = sceneMethods(['splitHullDisplayBasis', 'destroyedTankDisplaySize', 'destroyedTankOffset']);
  const scene = new Scene(); const cfg = visuals.splitTankVisualConfigOf('flak88');
  const size = scene.destroyedTankDisplaySize('flak88', 150, 150, 64);
  assert.equal(size.w, 64 * 1.8 * cfg.hullFitScale);
  assert.equal(size.h, size.w);
  const offset = scene.destroyedTankOffset('flak88', 64 * Math.sqrt(3));
  assert.equal(offset.forward, cfg.hullOffsetForward * 64 * Math.sqrt(3));
  assert.equal(offset.right, cfg.hullOffsetRight * 64 * Math.sqrt(3));
});
