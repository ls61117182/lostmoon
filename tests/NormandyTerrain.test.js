const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
const { HexMap, neighbor, directionTo } = require('../assets/scripts/core/HexGrid.ts');
const { effectiveDiceTerrain, tileForbidsConcealment, tileForbidsSmokeOrConcealment, createTankCrew } = require('../assets/scripts/core/types.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { tileMoveCost } = require('../assets/scripts/core/MoveCost.ts');
const { PLAYER_DICE_POOL, PLAYER_HARDCORE_DICE_POOL } = require('../assets/scripts/core/PlayerActionDB.ts');
const { canExecuteAction, hardcoreTankDiceTerrain } = require('../assets/scripts/core/EnemyAI.ts');
const { hitBreakdown, mgHitBreakdown } = require('../assets/scripts/core/Combat.ts');
const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
const { terrainMaterial, TerrainGroundRaster } = require('../assets/scripts/view/TerrainGroundRaster.ts');
const { TerrainGroundGpuData, GPU_MATERIALS, ATLAS_ROWS, ATLAS_COLUMNS } = require('../assets/scripts/view/TerrainGroundGpuData.ts');
const unit = (kind, pos, faction = 'german') => ({ id: kind, kind, faction, pos, facing: 0, crew: createTankCrew(getUnitStats(kind)), stats: getUnitStats(kind) });
const start = { q: 0, r: 0 };
function pair(dir = 0) {
  const map = new HexMap(5, 5), to = neighbor(start, dir);
  const a = { pos: { ...start }, terrain: 'europe_beach' }, b = { pos: to, terrain: 'europe_beach' };
  map.set(a); map.set(b); return { map, a, b, to };
}
function missionData() {
  return { id: 'normandy-test', name: 'Normandy', description: 'Test', theater: 'europe', cols: 4, rows: 3,
    tiles: Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => ({ t: 'eb' }))),
    sherman: { kind: 'sherman', at: { col: 0, row: 0 }, facing: 0 },
    enemies: [{ kind: 'infantry', at: { col: 3, row: 2 }, facing: 3 }], objective: { type: 'destroy_all_enemies' } };
}

test('European sand inherits Clear dice and movement without Pacific beach restrictions', () => {
  const { map, a } = pair();
  assert.equal(effectiveDiceTerrain(a), 'clear'); assert.equal(tileMoveCost(a), 1);
  for (const pool of [PLAYER_DICE_POOL, PLAYER_HARDCORE_DICE_POOL]) for (const phase of ['movement', 'attack', 'misc']) assert.equal(pool.baseByPhaseTerrain[phase].europe_beach, pool.baseByPhaseTerrain[phase].clear);
  assert.equal(hardcoreTankDiceTerrain('europe_beach'), 'clear');
  assert.equal(tileForbidsConcealment(a), true); assert.equal(tileForbidsSmokeOrConcealment(a), false);
  for (const faction of ['usa', 'german', 'japanese', 'soviet']) assert.equal(map.canTankEnter(start, faction), true);
  const tank = unit('panzer4', start);
  for (const action of ['conceal', 'hull_down']) assert.equal(canExecuteAction(tank, action, tank, map, new Set()), false);
  a.crater = true;
  assert.equal(tileForbidsConcealment(a), false);
  for (const action of ['conceal', 'hull_down']) assert.equal(canExecuteAction(tank, action, tank, map, new Set()), true);
});

test('all six wire edges block foot units and AT guns from either encoding side', () => {
  for (let dir = 0; dir < 6; dir++) for (const side of ['a', 'b']) {
    const p = pair(dir), tile = p[side], edge = side === 'a' ? dir : (dir + 3) % 6;
    tile.barbedWire = Array(6).fill(0); tile.barbedWire[edge] = 1;
    for (const kind of ['infantry', 'american_infantry', 'japanese_infantry', 'officer', 'at_gun', 'pak38']) {
      const u = unit(kind, start);
      assert.equal(p.map.canUnitCrossEdge(start, p.to, u), false, `${kind} dir ${dir} side ${side}`);
      assert.equal(p.map.canUnitCrossEdge(p.to, start, { ...u, pos: p.to }), false);
    }
    assert.equal(p.map.canUnitCrossEdge(start, p.to, unit('sherman', start, 'usa')), true);
    assert.equal(tile.barbedWire[edge], 1, 'preview must not damage wire');
    tile.barbedWire[edge] = 2;
    assert.equal(p.map.canUnitCrossEdge(start, p.to, unit('infantry', start)), true);
    assert.equal(p.map.canUnitCrossEdge(start, p.to, unit('at_gun', start)), true);
  }
});

test('a tank move crushes both representations; damage is permanent and has no extra terrain cost', () => {
  const { map, a, b, to } = pair();
  a.barbedWire = [1, 0, 0, 0, 0, 0]; b.barbedWire = [0, 0, 0, 1, 0, 0];
  const tank = unit('sherman', start, 'usa');
  assert.equal(tileMoveCost(b), 1); assert.equal(map.applyMovementTerrainEffects(tank, start, to), true);
  assert.equal(a.barbedWire[0], 2); assert.equal(b.barbedWire[3], 2);
  assert.equal(map.barbedWireBetween(to, start), 2);
  assert.equal(map.canUnitCrossEdge(start, to, unit('at_gun', start)), true);
  assert.equal(map.applyMovementTerrainEffects(tank, to, start), false);
  a.barbedWire[0] = 1;
  assert.equal(map.barbedWireBetween(start, to), 1, 'conflicting sides resolve to intact');
  map.applyMovementTerrainEffects(unit('truck', start), start, to);
  assert.equal(a.barbedWire[0], 1, 'only tanks crush wire');
});

test('steel hedgehogs permit entry and sight but immediately immobilize tanks only', () => {
  const { map, b, to } = pair(); b.steelHedgehogs = true;
  assert.equal(map.lineOfSightBlockedByTile(b), false); assert.equal(map.canTankEnter(to), true);
  for (const kind of ['sherman', 'panzer4']) {
    const tank = unit(kind, start);
    assert.equal(map.canUnitCrossEdge(start, to, tank), true);
    map.applyMovementTerrainEffects(tank, start, to); assert.equal(tank.paralyzed, true);
  }
  const foot = unit('infantry', start); map.applyMovementTerrainEffects(foot, start, to); assert.equal(foot.paralyzed, undefined);
  const tank = unit('sherman', start); map.applyMovementTerrainEffects(tank, start, { q: 4, r: 4 }); assert.equal(tank.paralyzed, undefined, 'non-moves are ignored');
});

test('craters inherit Mud and add exactly +1 hit threshold to infantry, including MG', () => {
  const { map, b, to } = pair(), attacker = unit('sherman', start, 'usa'), infantry = unit('infantry', to);
  const ctx = { attacker, target: infantry, map, attackKind: 'mg' };
  const plain = hitBreakdown(ctx).threshold, plainMG = mgHitBreakdown(ctx).threshold;
  b.crater = true;
  assert.equal(effectiveDiceTerrain(b), 'mud'); assert.equal(tileMoveCost(b), 2);
  assert.equal(tileForbidsConcealment(b), false);
  assert.equal(hitBreakdown(ctx).threshold, plain + 1); assert.equal(mgHitBreakdown(ctx).threshold, plainMG + 1);
  assert.equal(hitBreakdown({ ...ctx, target: unit('panzer4', to) }).crater, 0);
  assert.equal(map.lineOfSightBlockedByTile(b), false);
});

test('concrete seawalls use the same directional crossing permission as breakwaters', () => {
  for (let dir = 0; dir < 6; dir++) {
    const { map, b, to } = pair(dir); b.seawalls = Array(6).fill(false); b.seawalls[(dir + 3) % 6] = true;
    assert.equal(map.canTankCrossEdge(start, to), false);
    assert.equal(map.canTankCrossEdge(to, start), false);
    assert.equal(map.canTankCrossEdge(start, to, { ignoreBreakwater: true }), true);
    assert.equal(map.canUnitCrossEdge(start, to, unit('infantry', start)), true);
    assert.equal(map.lineOfSightBlockedByTile(b), false);
  }
});

test('JSON overlay loading and save/load retain crushed wire and immobilization', () => {
  const data = missionData();
  data.tiles[0][0].wire = '100000';
  Object.assign(data.tiles[0][1], { wire: '000100', sh: 1, cr: 1, sw: '010000' });
  const live = loadMission(data), from = live.sherman.pos, to = neighbor(from, 0);
  const tile = live.map.get(to); assert.equal(tile.steelHedgehogs, true); assert.equal(tile.crater, true); assert.equal(tile.seawalls[1], true);
  live.map.applyMovementTerrainEffects(live.sherman, from, to); live.sherman.pos = to;
  const save = JSON.parse(JSON.stringify(captureSave({ mission: live, missionId: data.id, turn: 2, phase: 'player', gameMode: 'hardcore', movesLeft: 2, attacksLeft: 1, miscDone: false, playerStep: 'movement', hatchChangedThisTurn: false, phaseDice: [{ pip: 5, used: true }] })));
  const restored = loadMission(data);
  assert.equal(applySave(restored, data.id, save).ok, true);
  assert.equal(restored.map.barbedWireBetween(from, to), 2); assert.equal(restored.sherman.paralyzed, true);
  const legacy = loadMission(data); delete save.barbedWireStates;
  assert.equal(applySave(legacy, data.id, save).ok, true); assert.equal(legacy.map.barbedWireBetween(from, to), 1);
});

test('loader rejects malformed edge states and beach overlays on other ground', () => {
  for (const fields of [{ wire: '123456' }, { wire: '1' }, { sw: '200000' }, { t: 'f', sh: 1 }, { t: 'c', cr: 1 }, { sh: 2 }]) {
    const data = missionData(); Object.assign(data.tiles[0][1], fields); assert.throws(() => loadMission(data));
  }
});

test('live infantry and hardcore AT-gun movement refuse wire before starting animation', () => {
  const types = require('../assets/scripts/core/types.ts');
  const hex = require('../assets/scripts/core/HexGrid.ts');
  const Scene = require('./helpers/BattleSceneMethods.cjs')(['findInfantryAIMove', 'tryHardcoreATGunForwardMove'], {
    ...types, ...hex, markAmbushAction: () => {}, unitDisplayName: kind => kind,
  });
  const { map, a, to } = pair();
  a.barbedWire = [1, 0, 0, 0, 0, 0];
  const scene = new Scene();
  Object.assign(scene, {
    mission: { map }, moveDuration: .1, rng: { intRange: () => 0 },
    nearestInfantryAITarget: () => ({ pos: { q: 2, r: 0 } }),
    infantryMoveHexPriority: () => 4, infantryAIMovePriority: () => 4,
    canMoveToBattleTile: () => true, buildOccupiedSet: () => new Set(),
    findMoveBlocker: () => null, breakConcealment: () => {}, redraw: () => {}, battleLog: () => {},
  });
  const infantry = unit('infantry', start), gun = unit('at_gun', start);
  assert.equal(scene.findInfantryAIMove(infantry), null);
  assert.equal(scene.tryHardcoreATGunForwardMove(gun, 0), false);
  assert.equal(scene.anim, undefined, 'blocked moves never start');
  assert.equal(a.barbedWire[0], 1, 'foot/gun movement never crushes wire');
  a.barbedWire[0] = 2;
  const moved = scene.findInfantryAIMove(infantry);
  assert.equal(moved.q, to.q); assert.equal(moved.r, to.r);
  assert.equal(scene.tryHardcoreATGunForwardMove(gun, 0), true);
  assert.equal(scene.anim.toQ, to.q); assert.equal(scene.anim.toR, to.r);
});

test('GPU and CPU both map European sand to its own dry material, never water', () => {
  const bundle = JSON.parse(fs.readFileSync('assets/resources/textures/terrain/redesign_v3/materials.json', 'utf8'));
  const tile = { pos: start, terrain: 'europe_beach' };
  assert.equal(terrainMaterial(tile, false), 'europe_sand');
  const raster = new TerrainGroundRaster(bundle.europeanSummer ?? bundle);
  assert.notDeepEqual(raster.getGpuMaterials().europe_sand.pixels, raster.getGpuMaterials().sand.pixels);
  const gpu = new TerrainGroundGpuData(bundle.europeanSummer ?? bundle), data = gpu.tileData([tile], false);
  assert.equal(data.hasWater, false); assert.ok(data.ground.includes(GPU_MATERIALS.indexOf('europe_sand') + 1));
  assert.ok(ATLAS_ROWS * ATLAS_COLUMNS >= GPU_MATERIALS.length);
  assert.ok(ATLAS_ROWS * 386 <= 2048 && ATLAS_COLUMNS * 386 <= 2048, 'mobile atlas fits a 2048 texture limit');
});
