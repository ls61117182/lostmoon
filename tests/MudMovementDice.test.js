const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText, filename);
const types = require('../assets/scripts/core/types.ts');
const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
const GameSession = { gameMode: 'hardcore', isPvp: false };
const Scene = sceneMethods(['update', 'consumeMovementDiceOnMudEntry', 'dieStep', 'usePhaseDice',
  'completePhaseDiceAction', 'autoEndPhaseIfDone'], {
  ...types, GameSession, reconcileDiagonalGunnerSideAfterMove() {},
  startManeuverSound() {}, stopManeuverSound() {}, playInfantryMove() {},
});

function fixture({ mode = 'hardcore', phase = 'player', step = 'movement', kind = 'sherman',
  terrain = 'mud', tileExtra = {} } = {}) {
  GameSession.gameMode = mode;
  const h = new Scene();
  const mover = { id: 'mover', kind, stats: getUnitStats(kind), pos: { q: 0, r: 0 }, facing: 0 };
  const map = new HexMap(3, 3);
  map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
  map.set({ pos: { q: 1, r: 0 }, terrain, ...tileExtra });
  Object.assign(h, {
    mission: { sherman: phase === 'player' ? mover : {}, map }, phase, playerStep: step,
    outcome: 'ongoing', phaseDice: [{ pip: 5, type: 'movement', used: true },
      { pip: 1, type: 'movement' }, { pip: 4, type: 'movement' }],
    enemyOrder: [mover], enemyIndex: 0, enemyDiceTypes: ['move', 'attack', 'move', 'misc'],
    enemyDiceUsed: [true, false, false, false], animQueue: [], mainGunRecoils: new Map(),
    anim: { unit: mover, kind: 'move', fromQ: 0, fromR: 0, toQ: 1, toR: 0, t: 0, dur: 1 },
    selectedGunDieIdx: -1, selectedGunDoublesIdx: -1, selectedMGDieIdx: -1,
    endCurrentSubPhase() { this.ended = true; },
  });
  for (const name of ['floaters', 'repairIndicators', 'muzzleFlashes', 'muzzleSmokes',
    'projectileTraces', 'highExplosiveBlasts', 'machineGunBursts', 'infantryBulletVolleys',
    'infantryRocketTraces', 'sniperBulletTraces']) h[name] = [];
  for (const name of ['syncTerrainLoadingOverlay', 'advanceFogVisionTransition', 'advanceEngineVibration',
    'advanceTankEngineExhaust', 'advanceTurnTransition', 'advanceStukaFlyover', 'advanceAirborneSupport',
    'advanceUnitEffects', 'openPendingCombatLogReplayIfReady', 'beginTankTrackAnimation',
    'advanceTankTrackAnimation', 'finishTankTrackAnimation', 'finishCampaignExitTurretAlignment',
    'battleLogI18n', 'crushEnemyATGunsAt', 'captureAbandonedATGunsAt', 'captureAbandonedTanksAt',
    'drainPvpPendingRemoteSnapshot', 'tryResolveAmbushAfterMove', 'refreshEnemyDiceTray',
    'refreshPhaseUI', 'updateHUD', 'redraw', 'runNextEnemyStep']) h[name] = () => {};
  return h;
}
const used = h => Array.from(h.phaseDice, d => !!d.used);

test('mud consumes remaining player movement dice on arrival, before ambush resolution', () => {
  for (const mode of ['hardcore', 'test']) {
    const h = fixture({ mode });
    h.tryResolveAmbushAfterMove = () => {
      assert.deepEqual(used(h), [true, true, true]);
      assert.equal(h.pendingAutoEndStep, 'movement');
      return false;
    };
    h.update(0.5);
    assert.deepEqual(used(h), [true, false, false], 'dice remain until the tank arrives');
    assert.equal(h.ended, undefined);
    h.update(0.5);
    assert.equal(h.mission.sherman.pos.q, 1);
    assert.deepEqual(used(h), [true, true, true]);
    assert.equal(h.ended, true, 'movement ends through the normal phase completion flow');
  }
});

test('combined phase keeps attack dice, and misc driving keeps other misc dice', () => {
  const h = fixture({ mode: 'test', step: 'attack' });
  h.phaseDice.unshift({ pip: 6, type: 'attack' });
  h.update(1);
  assert.deepEqual(used(h), [false, true, true, true]);
  assert.equal(h.ended, undefined);
  const misc = fixture({ step: 'misc' });
  misc.phaseDice.forEach(d => { d.type = 'misc'; });
  misc.update(1);
  assert.deepEqual(used(misc), [true, false, false]);
});

test('both allied and enemy tanks lose only movement dice in non-classic modes', () => {
  for (const mode of ['hardcore', 'test']) for (const phase of ['ally', 'enemy']) {
    const h = fixture({ mode, phase, kind: 'stug3' });
    h.runNextEnemyStep = () => assert.deepEqual(h.enemyDiceUsed, [true, false, true, false]);
    h.update(1);
    assert.deepEqual(h.enemyDiceUsed, [true, false, true, false]);
  }
});

test('classic mode, non-tanks and non-mud destinations retain their dice', () => {
  for (const options of [{ mode: 'classic' }, { terrain: 'field' }, { terrain: 'road' },
    { terrain: 'water', tileExtra: { bridgeEnds: [0, 3] } },
    { kind: 'truck', phase: 'enemy' }, { kind: 'american_infantry', phase: 'ally' }]) {
    const h = fixture(options);
    h.update(1);
    assert.deepEqual(used(h), [true, false, false]);
    assert.deepEqual(h.enemyDiceUsed, [true, false, false, false]);
  }
});

test('mud-equivalent rubble and beach craters apply the same movement rule', () => {
  for (const options of [{ terrain: 'urban_rubble' },
    { terrain: 'europe_beach', tileExtra: { crater: true } }]) {
    const h = fixture(options);
    h.update(1);
    assert.deepEqual(used(h), [true, true, true]);
  }
});

test('standing on mud does not consume newly rolled movement dice', () => {
  const h = fixture();
  h.anim = null;
  h.mission.map.get({ q: 0, r: 0 }).terrain = 'mud';
  h.update(1);
  assert.deepEqual(used(h), [true, false, false]);
});
