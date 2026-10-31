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
const { getUnitStats, getAllUnitKinds } = require('../assets/scripts/core/UnitDB.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { canExecuteAction } = require('../assets/scripts/core/EnemyAI.ts');
const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
const { HexMap, fireDirectionVector, neighbor } = require('../assets/scripts/core/HexGrid.ts');
const { canAttack, rollAttack, resolveAttack } = require('../assets/scripts/core/Combat.ts');

function scenario(theater = 'europe') {
  const data = JSON.parse(fs.readFileSync('assets/resources/missions/mission_03.json', 'utf8'));
  data.id = 'test_pak43'; data.theater = theater; data.enemyStartByDice = false;
  data.enemies = [{ kind: 'pak43', at: { col: 6, row: 4 }, facing: 3, turretFacing: 0 }];
  return loadMission(data);
}
const source = ts.createSourceFile('BattleScene.ts', fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const sceneClass = source.statements.find(s => ts.isClassDeclaration(s) && s.name?.text === 'BattleScene');
function sceneMethods(names, globals = {}) {
  const methods = names.map(name => sceneClass.members.find(m => m.name?.getText(source) === name).getText(source));
  const js = ts.transpileModule(`class TestScene { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return vm.runInNewContext(js + '\nTestScene', { ...types, ...visuals, HexMap, neighbor,
    isSplitTankKind: k => visuals.SPLIT_TANK_KINDS.includes(k), ...globals });
}
function field() {
  const map = new HexMap(30, 30);
  for (let q = 0; q < 30; q++) for (let r = 0; r < 30; r++) map.set({ pos: { q, r }, terrain: 'field' });
  return map;
}
function unit(kind, pos = { q: 15, r: 15 }) {
  return { id: kind, kind, pos, facing: 3, turretFacing: 3, stats: getUnitStats(kind), faction: getUnitStats(kind).faction };
}

test('approved Pak 43/41 is a crew-operated towed gun, not a cruciform emplacement', () => {
  assert(getAllUnitKinds().includes('pak43'));
  const stats = getUnitStats('pak43'), tiger = getUnitStats('tigerking');
  for (const key of ['penetration', 'effectiveRange', 'highExplosivePower', 'reloadDifficulty']) assert.equal(stats[key], tiger[key], key);
  assert(stats.penetration > getUnitStats('flak88').penetration);
  assert.equal(stats.visionType, 'fixed');
  assert.equal(visuals.SPLIT_TANK_KINDS.includes('pak43'), false);
  const assets = visuals.tankVisualAssetConfigOf('pak43');
  assert.equal(assets.hullSpritePath, ''); assert.equal(assets.turretSpritePath, '');
  for (const theater of ['europe', 'pacific']) {
    const mission = scenario(theater), gun = mission.enemies[0];
    assert.equal(gun.faction, 'german');
    assert.equal(types.isTankUnit(gun), false);
    assert.equal(types.isControlledATGun(gun), true);
    assert.equal(types.isImmobileGunUnit(gun), false);
    const crew = mission.enemies.find(u => u.id === gun.atGunControllerUnitId);
    assert.equal(crew.kind, 'german_infantry');
    assert.equal(crew.attachedToATGunId, gun.id);
  }
});

test('hardcore whole-gun aim uses the existing twelve-bearing AT-gun proxy', () => {
  const map = field(), gun = unit('pak43');
  const attacker = { ...gun, stats: { ...gun.stats, visionType: 'turreted' } };
  for (let direction = 0; direction < 12; direction++) {
    const vector = fireDirectionVector(direction);
    const target = unit('sherman', { q: gun.pos.q + vector.q * 2, r: gun.pos.r + vector.r * 2 });
    attacker.turretFacing = direction;
    assert.equal(canAttack({ attacker, target, map, expandedTurretDirections: true }).ok, true, `bearing ${direction}`);
  }
});

test('save/load preserves whole-gun aim and the towed-gun forward fallback remains available', () => {
  const mission = scenario(), gun = mission.enemies[0];
  gun.turretFacing = 7;
  const save = captureSave({ gameMode: 'hardcore', missionId: mission.data.id, mission,
    turn: 1, phase: 'player', movesLeft: 2, attacksLeft: 1, miscDone: false,
    playerStep: 'choose', hatchChangedThisTurn: false, phaseDice: [] });
  const restored = scenario(); assert.equal(applySave(restored, restored.data.id, save).ok, true);
  const loaded = restored.enemies[0];
  assert.equal(loaded.facing, 3); assert.equal(loaded.turretFacing, 7);
  assert.equal(canExecuteAction(loaded, 'turn', restored.sherman, restored.map, new Set()), true);
  const Scene = sceneMethods(['tryHardcoreATGunForwardMove'], { markAmbushAction: () => {}, unitDisplayName: () => 'Pak 43/41' });
  const scene = new Scene();
  Object.assign(scene, { mission: { map: field() }, canMoveToBattleTile: () => true, findMoveBlocker: () => null,
    breakConcealment: () => {}, battleLog: () => {}, redraw: () => {}, moveDuration: 0.1 });
  assert.equal(scene.tryHardcoreATGunForwardMove(unit('pak43'), 0), true);
  assert.equal(scene.anim.kind, 'move'); assert.equal(scene.anim.toQ, 16);
});

test('AP destroys the gun directly while small arms eliminate only its crew', () => {
  const map = field(), attacker = unit('sherman', { q: 13, r: 15 }), target = unit('pak43');
  target.atGunCrewAlive = true;
  const report = rollAttack({ attacker, target, map, shellType: 'ap', directionalDamageCheck: true,
    unitDamageTargetClass: true }, { d6: () => 6 });
  assert.equal(report.directHitDestroy, true);
  assert.equal(report.damageEffect, 'destroyed');
  assert.equal(report.penDice, undefined);
  const infantry = unit('american_infantry', { q: 14, r: 15 });
  target.atGunCrewTargetSize = getUnitStats('german_infantry').size;
  resolveAttack({ attacker: infantry, target, map }, { d6: () => 6 });
  assert.equal(target.destroyed, undefined);
  assert.equal(types.isAbandonedATGun(target), true);
  assert.equal(target.faction, 'neutral');
});

test('battle rotates one complete deployed sprite with the same crew interpolation', () => {
  const Scene = sceneMethods(['drawUnit', 'drawATGunCrewMaybeAnim'], {
    isEnemyTopKind: k => k === 'pak43', commanderHatchVisualState: () => 'hidden' });
  const scene = new Scene(), gun = scenario().enemies[0];
  const aim = { from: 0, to: 2, t: 0.5, angular: true };
  Object.assign(scene, { hexSize: 64, mission: {}, project: () => ({ x: 0, y: 0 }),
    enemyTopPoolNext: 0, enemyTopSpritePool: [{ node: {}, sprite: {} }], commanderHatchSpriteFrames: {},
    currentEnemyTurretLerp: () => aim, tankTopMetaFor: () => ({ sf: {}, dw: 200, dh: 80 }) });
  let wholeFacing, crewFacing;
  scene.applyTopDownTankSprite = (...args) => { wholeFacing = args[7]; };
  scene.applySplitTankHullSprite = () => { assert.fail('no fixed cruciform layer'); };
  scene.drawUnit(gun);
  assert.equal(wholeFacing, aim); assert.equal(scene.enemyTopPoolNext, 1);
  scene.atGunCrewFormationOffsets = (_gun, lerp) => { crewFacing = lerp; return []; };
  scene.topDownForwardVec = () => ({ ux: 0, uy: 1 }); scene.atGunCrewActor = () => ({});
  scene.drawInfantry = () => {}; scene.drawSuppressionMarks = () => {};
  scene.drawATGunCrewMaybeAnim(gun);
  assert.equal(crewFacing, wholeFacing);
});

test('deployed trails stay visibly separated and the wreck retains the same canvas', async () => {
  const dir = 'assets/resources/textures/units/pak43_top';
  assert(visuals.TANK_VISUAL_KINDS.includes('pak43'));
  const alive = await sharp(`${dir}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const dead = await sharp(`${dir}_destroyed.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(alive.info.width, 200); assert.equal(dead.info.width, alive.info.width); assert.equal(dead.info.height, alive.info.height);
  const x = Math.round(alive.info.width * 0.85), height = alive.info.height, bands = [];
  const axis = visuals.tankVisualConfigOf('pak43').muzzle.spriteY;
  for (let y = 0; y < height; y++) {
    if (alive.data[(y * alive.info.width + x) * 4 + 3] <= 32) continue;
    if (!bands.length || y > bands[bands.length - 1].end + 1) bands.push({ start: y, end: y });
    else bands[bands.length - 1].end = y;
  }
  // Small brace links can form additional narrow bands alongside either beam.
  // All rear structure must lie on two widely separated sides of a clear gap.
  assert(bands.some(band => band.end < axis - height * 0.15));
  assert(bands.some(band => band.start > axis + height * 0.15));
  assert(bands.every(band => band.end < axis - height * 0.15 || band.start > axis + height * 0.15),
    'trails must remain open around a broad transparent center gap');
  // Check the exported pixels themselves: the former generated art had a
  // roughly 4.0-diameter forward reach; the approved plan measures 3.70.
  const alpha = (px, py) => alive.data[(py * alive.info.width + px) * 4 + 3];
  const wheel = []; for (let px = 70; px < 130; px++) if (alpha(px, 15) > 32) wheel.push(px);
  const wheelDiameter = wheel[wheel.length - 1] - wheel[0] + 1;
  let muzzleX = 0; while (muzzleX < alive.info.width && alpha(muzzleX, Math.round(axis)) <= 32) muzzleX++;
  const forwardReach = 108.8 - muzzleX;
  assert(Math.abs(forwardReach / wheelDiameter - 3.70) < 0.15, 'barrel-to-wheel proportions must match the plan');
  // Moving the wheels outward formerly left transparent bands across the
  // bearing housings. Both states must retain opaque wheel-to-frame bridges.
  for (const image of [alive, dead]) {
    for (const [firstY, lastY] of [[19, 22], [54, 57]]) {
      for (let py = firstY; py <= lastY; py++) for (let px = 104; px <= 112; px++) {
        assert(image.data[(py * image.info.width + px) * 4 + 3] >= 200,
          `wheel bearing must connect to carriage at ${px},${py}`);
      }
    }
  }
  let changed = 0; for (let i = 3; i < alive.data.length; i += 4) changed += alive.data[i] !== dead.data[i];
  assert(changed > 100, 'wreck must have structural damage');
  const Scene = sceneMethods(['splitHullDisplayBasis', 'destroyedTankDisplaySize', 'destroyedTankOffset']);
  const scene = new Scene(), cfg = visuals.tankVisualConfigOf('pak43');
  const size = scene.destroyedTankDisplaySize('pak43', alive.info.width, height, 64);
  assert(Math.abs(size.h / size.w - height / alive.info.width) < 1e-9);
  const offset = scene.destroyedTankOffset('pak43', 64 * Math.sqrt(3));
  assert.equal(offset.forward, cfg.offsetForward * 64 * Math.sqrt(3));
  assert.equal(offset.right, cfg.offsetRight * 64 * Math.sqrt(3));
});
