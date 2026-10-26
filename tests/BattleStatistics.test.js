const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { cloneBattleStatistics, recordBattleAttack, battleStatisticRate } = require('../assets/scripts/core/BattleStatistics.ts');
const { prepareTurnEndEvent } = require('../assets/scripts/core/TurnEndEventApply.ts');
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
  assert.equal(Object.values(empty).every(value => value === 0), true);
  const checkpoint = { ...empty, attacksReceived: 7 };
  const restored = cloneBattleStatistics(checkpoint);
  restored.attacksReceived++;
  assert.equal(checkpoint.attacksReceived, 7);
  assert.equal(cloneBattleStatistics({ hitsReceived: NaN, machineGunHits: -2 }).machineGunHits, 0);
});

test('scene settlement counts the real protagonist and never counts HE collateral as extra shots', () => {
  const Scene = sceneMethods(['recordSettledBattleAttack', 'applyHighExplosiveAttackResult'], {
    cloneBattleStatistics, recordBattleAttack, GameSession: { isPvp: false },
    isAntiTankGunUnit: () => false, applyHighExplosiveAttack: () => {}, markAmbushAction: () => {},
  });
  const player = { id: 'player' };
  const scene = new Scene();
  scene.mission = { playerTank: player, sherman: player };
  scene.applyHighExplosiveAttackResult({}, { hit: true }, [
    { target: {}, report: { hit: true, automaticHit: true } },
    { target: {}, report: { hit: false } },
  ], player);
  assert.equal(scene.mission.battleStatistics.mainGunHitChecks, 1);
  scene.applyHighExplosiveAttackResult(player, { hit: true }, [], {});
  assert.equal(scene.mission.battleStatistics.hitsReceived, 1);
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
