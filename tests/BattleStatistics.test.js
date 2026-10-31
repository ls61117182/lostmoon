const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { battleCrewStatus, cloneBattleStatistics, recordBattleAttack, recordBattleKill, battleStatisticRate } = require('../assets/scripts/core/BattleStatistics.ts');
const { prepareTurnEndEvent } = require('../assets/scripts/core/TurnEndEventApply.ts');
const { applyHighExplosiveAttack } = require('../assets/scripts/core/Combat.ts');
const { isTankUnit } = require('../assets/scripts/core/types.ts');
const { destroyTankRiders } = require('../assets/scripts/core/TankRiding.ts');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');

test('incoming fire counts misses, hits and armor penetrations independently', () => {
  const stats = cloneBattleStatistics();
  recordBattleAttack(stats, false, true, 'main', [
    { hit: false }, { hit: true, penThreshold: 4, penetrated: false },
    { hit: true, penThreshold: 4, penetrated: true },
  ]);
  recordBattleAttack(stats, false, false, 'main', [{ hit: true, penThreshold: 4, penetrated: true }]);
  assert.deepEqual([stats.attacksReceived, stats.hitsReceived, stats.penetrationsReceived], [3, 2, 1]);
});

test('main-gun hit rate excludes automatic HE/AP and distinguishes precision checks', () => {
  const stats = cloneBattleStatistics();
  recordBattleAttack(stats, true, false, 'he', [{ hit: true, automaticHit: true }]);
  recordBattleAttack(stats, true, false, 'main', [{ hit: true, automaticHit: true, penThreshold: 2, penetrated: true }]);
  recordBattleAttack(stats, true, false, 'main', [
    { hit: false, penetrated: false }, { hit: true, shootingPortHit: false, penThreshold: 6, penetrated: false },
    { hit: true, shootingPortHit: true, penetrated: true },
    { hit: true, directHitDestroy: true, penetrated: true },
    { hit: true, penThreshold: 1, penetrated: true, overpenetrated: true },
  ]);
  recordBattleAttack(stats, true, false, 'he', [{ hit: true }]);
  assert.deepEqual([stats.mainGunHitChecks, stats.mainGunHits], [6, 4]);
  assert.deepEqual([stats.mainGunPenetrationChecks, stats.mainGunPenetrations], [3, 2]);
  assert.equal(battleStatisticRate(stats.mainGunHits, stats.mainGunHitChecks), '67%');
});

test('dual MG fire counts individual rolls, including impossible misses', () => {
  const stats = cloneBattleStatistics();
  recordBattleAttack(stats, true, false, 'mg', [{ hit: false }, { hit: true }]);
  recordBattleAttack(stats, true, false, 'mg', [{ hit: false }]);
  assert.deepEqual([stats.machineGunHits, stats.machineGunShots], [1, 3]);
  assert.equal(battleStatisticRate(1, 3), '33%');
  assert.equal(battleStatisticRate(0, 0), '—');
  assert.equal(battleStatisticRate(0, 3), '0%');
});

test('old saves start at zero and restored counts do not alias the checkpoint', () => {
  const empty = cloneBattleStatistics();
  assert.equal(Object.values(empty).filter(value => typeof value === 'number').every(value => value === 0), true);
  assert.deepEqual(empty.killsByKind, {});
  const checkpoint = { ...empty, attacksReceived: 7 };
  const restored = cloneBattleStatistics(checkpoint);
  restored.attacksReceived++;
  assert.equal(checkpoint.attacksReceived, 7);
  assert.equal(cloneBattleStatistics({ hitsReceived: NaN, machineGunHits: -2 }).machineGunHits, 0);
});

test('scene settlement counts the real protagonist and never counts HE collateral as extra shots', () => {
  const Scene = sceneMethods(['recordSettledBattleAttack', 'applyHighExplosiveAttackResult'], {
    dismountRidersAfterAttack() {}, cloneBattleStatistics, recordBattleAttack, GameSession: { isPvp: false },
    isAntiTankGunUnit: () => false, applyHighExplosiveAttack: () => {}, markAmbushAction: () => {},
  });
  const player = { id: 'player' };
  const scene = new Scene();
  scene.mission = { playerTank: player, sherman: player };
  scene.recordPlayerBattleKill = () => {}; scene.allUnits = () => [];
  scene.applyHighExplosiveAttackResult({}, { hit: true }, [
    { target: {}, report: { hit: true, automaticHit: true } },
    { target: {}, report: { hit: false } },
  ], player);
  assert.equal(scene.mission.battleStatistics.mainGunHitChecks, 1);
  scene.applyHighExplosiveAttackResult(player, { hit: true }, [], {});
  assert.equal(scene.mission.battleStatistics.hitsReceived, 1);
});

test('kill totals merge by kind, deduplicate settlement and survive save cloning', () => {
  const stats = cloneBattleStatistics();
  recordBattleKill(stats, 'segment1:tank1', 'tiger');
  recordBattleKill(stats, 'segment1:tank1', 'tiger');
  recordBattleKill(stats, 'segment2:tank1', 'tiger');
  recordBattleKill(stats, 'segment2:infantry1', 'infantry');
  const restored = cloneBattleStatistics(JSON.parse(JSON.stringify(stats)));
  recordBattleKill(restored, 'segment2:tank1', 'tiger');
  assert.deepEqual(restored.killsByKind, { tiger: 2, infantry: 1 });
  restored.killsByKind.tiger++;
  restored.countedKillIds.push('extra');
  assert.equal(stats.killsByKind.tiger, 2);
  assert.equal(stats.countedKillIds.length, 3);
});

test('only hostile units destroyed by the protagonist enter its kill list', () => {
  const Scene = sceneMethods(['recordPlayerBattleKill'], { cloneBattleStatistics, recordBattleKill, isTankUnit, destroyTankRiders,
    isSameSide: (a, b) => a.sideId === b.sideId });
  const player = { sideId: 'player' };
  const target = { id: 'enemy1', kind: 'tiger', sideId: 'enemy', destroyed: true };
  const scene = new Scene();
  scene.mission = { playerTank: player }; scene.allUnits = () => []; scene.missionId = 'mission1';
  scene.recordPlayerBattleKill({}, target);
  scene.recordPlayerBattleKill(player, { ...target, destroyed: false });
  scene.recordPlayerBattleKill(player, { ...target, sideId: 'player' });
  assert.equal(scene.mission.battleStatistics, undefined);
  scene.recordPlayerBattleKill(player, target);
  scene.recordPlayerBattleKill(player, target);
  assert.equal(scene.mission.battleStatistics.killsByKind.tiger, 1);
});

test('crew list follows physical crew slots, including the second loader', () => {
  const crew = battleCrewStatus({ stats: { crewMembers: [1, 2, 3, 4, 5, 6] },
    crew: { commander: true, gunner: false, loader: true, driver: true, coDriver: false, secondLoader: true } });
  assert.deepEqual(crew.map(row => row.alive), [true, false, true, true, false, true]);
  assert.deepEqual(battleCrewStatus({ stats: { crewMembers: [1, 3, 4, 5] } }).map(row => row.slot), [1, 3, 4, 5]);
});

test('HE credits primary and collateral kills once while recording only one gun shot', () => {
  const Scene = sceneMethods(['recordSettledBattleAttack', 'recordPlayerBattleKill', 'applyHighExplosiveAttackResult'], {
    dismountRidersAfterAttack() {}, cloneBattleStatistics, recordBattleAttack, recordBattleKill, isTankUnit, destroyTankRiders, GameSession: { isPvp: false },
    isSameSide: (a, b) => a.sideId === b.sideId, isAntiTankGunUnit: () => false,
    applyHighExplosiveAttack, markAmbushAction: () => {},
  });
  const scene = new Scene(), player = { sideId: 'player' };
  scene.mission = { playerTank: player }; scene.allUnits = () => []; scene.missionId = 'test';
  const target = { id: 'a', kind: 'infantry', sideId: 'enemy' };
  const collateral = { id: 'b', kind: 'infantry', sideId: 'enemy' };
  scene.applyHighExplosiveAttackResult(target, { hit: true, outcome: 'destroyed' },
    [{ target: collateral, report: { hit: true, outcome: 'destroyed', automaticHit: true } }], player);
  scene.recordPlayerBattleKill(player, target);
  assert.equal(scene.mission.battleStatistics.mainGunHitChecks, 1);
  assert.equal(scene.mission.battleStatistics.killsByKind.infantry, 2);
});

test('MG elimination of an AT-gun crew credits infantry without claiming the intact gun', () => {
  const Scene = sceneMethods(['recordPlayerBattleKill', 'applyMachineGunAttackResult'], {
    cloneBattleStatistics, recordBattleKill, isTankUnit, destroyTankRiders, GameSession: { gameMode: 'hardcore' },
    isSameSide: (a, b) => a.sideId === b.sideId, isAntiTankGunUnit: () => true,
  });
  const scene = new Scene(), player = { sideId: 'player' };
  const gun = { id: 'gun', kind: 'pak38', sideId: 'enemy', atGunCrewAlive: true };
  const crew = { id: 'crew', kind: 'infantry', sideId: 'enemy' };
  Object.assign(scene, { mission: { playerTank: player }, missionId: 'test',
    recordSettledBattleAttack: () => {}, destroyWreckVisualIds: new Set(),
    atGunController: () => crew, killATGunCrew: () => { crew.destroyed = true; gun.atGunCrewAlive = false; } });
  scene.applyMachineGunAttackResult(gun, { hit: true }, player, [{ hit: true }, { hit: true }]);
  assert.equal(gun.destroyed, false);
  assert.deepEqual(scene.mission.battleStatistics.killsByKind, { infantry: 1 });
});

function eventFixture(effectType, dice, options = {}) {
  const player = { id: 'player', kind: 'sherman', pos: { q: 0, r: 0 }, crew: { commander: true }, ...options.player };
  const mission = { sherman: player, data: { weather: 'clear' }, enemies: options.enemies ?? [],
    map: { get: () => ({ terrain: options.terrain ?? 'field' }) } };
  let index = 0;
  const prepared = prepareTurnEndEvent({ effectType }, [], 0, { mission, rng: { d6: () => dice[index++] ?? 6 }, nextEnemyId: () => 'id' });
  assert.equal(mission.battleStatistics, undefined, 'preparation must not increment counts');
  prepared.apply();
  return mission.battleStatistics ?? cloneBattleStatistics();
}

test('Stuka misses, ricochets and penetrations count; shot-down aircraft do not attack', () => {
  for (const [dice, counts] of [[[1, 1], [1, 0, 0]], [[4, 4, 1], [1, 1, 0]], [[4, 4, 4, 6], [1, 1, 1]]]) {
    const stats = eventFixture('stuka', dice);
    assert.deepEqual([stats.attacksReceived, stats.hitsReceived, stats.penetrationsReceived], counts);
  }
  assert.equal(eventFixture('stuka', [6, 6], { player: { hatchOpen: true } }).attacksReceived, 0);
});

test('mine and mortar hits count even when armor prevents damage', () => {
  const mine = eventFixture('road_mine', [1], { terrain: 'road' });
  assert.deepEqual([mine.attacksReceived, mine.hitsReceived, mine.penetrationsReceived], [1, 1, 0]);
  const mortar = eventFixture('heavy_mortar', [1, 1], { enemies: [{ kind: 'japanese_infantry', pos: { q: 3, r: 0 } }] });
  assert.deepEqual([mortar.attacksReceived, mortar.hitsReceived, mortar.penetrationsReceived], [1, 1, 0]);
});
