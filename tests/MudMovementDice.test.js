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
const { wreckVisualHex, WRECK_PUSH_STEP } = require('../assets/scripts/view/TankWreckPush.ts');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
const GameSession = { gameMode: 'hardcore', isPvp: false };
const Scene = sceneMethods(['update', 'advanceTankMoveTime', 'dieStep', 'usePhaseDice',
  'completePhaseDiceAction', 'autoEndPhaseIfDone'], {
  ...types, ...require('../assets/scripts/core/TankRiding.ts'), GameSession, wreckVisualHex, WRECK_PUSH_STEP, easeOutCubic: t => 1 - (1 - t) ** 3,
  reconcileDiagonalGunnerSideAfterMove() {},
  syncTankRiders() {},
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
    mission: { data: {}, sherman: phase === 'player' ? mover : {}, map, allies: [], enemies: [] }, phase, playerStep: step,
    hexSize: 100,
    currentWeather: () => 'clear',
    allUnits: () => [mover],
    startMultiRegionPan: () => false,
    project: (q, r) => ({ x: Math.sqrt(3) * (q + r / 2) * 100, y: -1.5 * r * 100 }),
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
    'advanceUnitEffects', 'advanceTankWreckWater', 'openPendingCombatLogReplayIfReady', 'beginTankTrackAnimation',
    'advanceTankTrackAnimation', 'finishTankTrackAnimation', 'finishCampaignExitTurretAlignment',
    'battleLogI18n', 'crushEnemyATGunsAt', 'captureAbandonedATGunsAt', 'captureAbandonedTanksAt',
    'drainPvpPendingRemoteSnapshot', 'tryResolveAmbushAfterMove', 'refreshEnemyDiceTray',
    'refreshPhaseUI', 'updateHUD', 'redraw', 'redrawAnimatedUnits', 'playMoveStartSound', 'runNextEnemyStep']) h[name] = () => {};
  return h;
}
const used = h => Array.from(h.phaseDice, d => !!d.used);

test('arriving on mud preserves remaining movement dice in every mode', () => {
  for (const mode of ['classic', 'hardcore', 'test']) {
    const h = fixture({ mode });
    h.tryResolveAmbushAfterMove = () => {
      assert.deepEqual(used(h), [true, false, false]);
      assert.equal(h.pendingAutoEndStep, undefined);
      return false;
    };
    h.update(0.5);
    assert.deepEqual(used(h), [true, false, false], 'dice remain until the tank arrives');
    assert.equal(h.ended, undefined);
    h.update(2);
    assert.equal(h.mission.sherman.pos.q, 1);
    assert.deepEqual(used(h), [true, false, false]);
    assert.equal(h.ended, undefined, 'remaining movement dice keep the phase open');
  }
});

test('combined phase keeps attack dice, and misc driving keeps other misc dice', () => {
  const h = fixture({ mode: 'test', step: 'attack' });
  h.phaseDice.unshift({ pip: 6, type: 'attack' });
  h.update(2);
  assert.deepEqual(used(h), [false, true, false, false]);
  assert.equal(h.ended, undefined);
  const misc = fixture({ step: 'misc' });
  misc.phaseDice.forEach(d => { d.type = 'misc'; });
  misc.update(2);
  assert.deepEqual(used(misc), [true, false, false]);
});

test('allied and enemy tanks retain remaining movement dice in every mode', () => {
  for (const mode of ['classic', 'hardcore', 'test']) for (const phase of ['ally', 'enemy']) {
    const h = fixture({ mode, phase, kind: 'stug3' });
    h.runNextEnemyStep = () => assert.deepEqual(h.enemyDiceUsed, [true, false, false, false]);
    h.update(2);
    assert.deepEqual(h.enemyDiceUsed, [true, false, false, false]);
  }
});

test('classic mode, non-tanks and non-mud destinations retain their dice', () => {
  for (const options of [{ mode: 'classic' }, { terrain: 'field' }, { terrain: 'road' },
    { terrain: 'water', tileExtra: { bridgeEnds: [0, 3] } },
    { kind: 'truck', phase: 'enemy' }, { kind: 'american_infantry', phase: 'ally' }]) {
    const h = fixture(options);
    h.update(2);
    assert.deepEqual(used(h), [true, false, false]);
    assert.deepEqual(h.enemyDiceUsed, [true, false, false, false]);
  }
});

test('mud-equivalent rubble and beach craters apply the same movement rule', () => {
  for (const options of [{ terrain: 'urban_rubble' },
    { terrain: 'europe_beach', tileExtra: { crater: true } }]) {
    const h = fixture(options);
    h.update(2);
    assert.deepEqual(used(h), [true, false, false]);
  }
});

test('standing on mud does not consume newly rolled movement dice', () => {
  const h = fixture();
  h.anim = null;
  h.mission.map.get({ q: 0, r: 0 }).terrain = 'mud';
  h.update(1);
  assert.deepEqual(used(h), [true, false, false]);
});

test('tanks move at half speed throughout mud, including rubble and beach craters', () => {
  for (const mode of ['classic', 'hardcore', 'test']) for (const options of [
    {}, { terrain: 'urban_rubble' }, { terrain: 'europe_beach', tileExtra: { crater: true } },
  ]) {
    const h = fixture({ mode, ...options });
    Object.assign(h.mission.map.get({ q: 0, r: 0 }), { terrain: options.terrain ?? 'mud', ...options.tileExtra });
    h.advanceTankMoveTime(h.anim, 1);
    assert(Math.abs(h.anim.t - 0.5) < 1e-9);
    h.advanceTankMoveTime(h.anim, 1);
    assert.equal(h.anim.t, 1);
  }
});

test('entering and leaving mud switches speed at the shared hex edge', () => {
  const edgeTime = 1 - Math.cbrt(0.5);
  for (const entering of [true, false]) {
    const run = frames => {
      const h = fixture({ terrain: entering ? 'mud' : 'field' });
      h.mission.map.get({ q: 0, r: 0 }).terrain = entering ? 'field' : 'mud';
      const before = entering ? 1 : 0.5, after = entering ? 0.5 : 1;
      const time = edgeTime / before + 0.1 / after;
      for (let i = 0; i < frames; i++) h.advanceTankMoveTime(h.anim, time / frames);
      assert(Math.abs(h.anim.t - edgeTime - 0.1) < 1e-9);
    };
    for (const frames of [1, 12, 60, 144]) run(frames);
  }
});

test('bridges, non-tanks and turning keep normal speed on mud', () => {
  for (const options of [{ kind: 'truck' }, { kind: 'american_infantry' },
    { terrain: 'water', tileExtra: { bridgeEnds: [0, 3] } }, { turn: true }]) {
    const h = fixture(options);
    Object.assign(h.mission.map.get({ q: 0, r: 0 }), { terrain: options.terrain ?? 'mud', ...options.tileExtra });
    if (options.turn) h.anim.kind = 'turn';
    h.advanceTankMoveTime(h.anim, 0.2);
    assert(Math.abs(h.anim.t - 0.2) < 1e-9);
  }
});
