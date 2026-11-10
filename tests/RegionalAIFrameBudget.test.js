const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, f);
const rules = Object.assign({}, ...['types', 'HexGrid', 'Dice', 'EnemyAI', 'UnitLevel', 'Ambush', 'LockedFire', 'Suppression', 'TankRiding', 'MultiRegion']
  .map(name => require(`../assets/scripts/core/${name}.ts`)));
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');

function simulation(yielding = true, regional = true) {
  let now = 0;
  const Scene = sceneMethods(['update', 'deferRegionalAI', 'resumeRegionalAI', 'beginCurrentEnemyTurn', 'runNextEnemyStep', 'runHardcoreInfantryTurn'], {
    ...rules, performance: { now: () => now }, GameSession: { gameMode: 'hardcore' },
    describeEntry: entry => entry.primary, unitDisplayName: kind => kind,
  });
  const scene = new Scene(), executed = [];
  const actors = Array.from({ length: 24 }, (_, i) => ({ id: `actor-${i}`, pos: { q: 100 + i, r: 0 }, facing: 0,
    kind: i % 3 === 0 ? 'german_infantry' : 'panzer4', faction: 'german', sideId: 'enemy', unitLevel: 'elite',
    stats: { visionType: i % 3 === 0 ? 'infantry' : 'turreted' } }));
  Object.assign(scene, { mission: { data: regional ? { multiRegion: {} } : {}, map: { get: () => ({ terrain: 'field' }) }, smokeHexes: new Set() },
    enemyOrder: actors, enemyIndex: 0, phase: 'enemy', aiSide: 'german', turn: 2, outcome: 'ongoing',
    rng: new rules.RNG(7), regionalAIFrameStart: null, regionalAIWorkChecks: 0, regionalAIContinuation: null,
    enemyTurretFacing: new Map(), enemyDiceHighlightIdx: -1,
    pauseAIFlowForCombatLogReplay: () => false, isOutsidePlayerRegion: () => true,
    clearAIMoveState() {}, clearActiveActingUnit() {}, setActiveActingUnit() {}, updateNonPlayerTankCommanderHatch() {},
    usesHardcoreTankDice: () => false, destroyEnemyDiceTray() {}, buildEnemyDiceTray() {}, refreshEnemyDiceTray() {},
    describeEnemyDicePool: () => '', describeEnemyDiceRolls: () => '', describeEnemyDie: () => '', battleLog() {},
    computeEnemyDiceExecOrder() { return this.enemyDice.map((_, i) => i).sort((a, b) => this.enemyDice[a] - this.enemyDice[b]); },
    enemyDieActionEntry(i) { return { primary: this.enemyDice[i] % 2 ? 'advance' : 'shoot' }; },
    chooseActionForEntry: (_, entry) => entry.primary,
    isHardcoreInfantryActor: unit => unit.kind === 'german_infantry',
    selectAIShootTarget: () => null, findInfantryAIMove: () => ({ q: 1, r: 0 }),
    hasSmokeAt: () => false, allUnits: () => actors,
    executeEnemyAction(unit, action) { now += 1.1; executed.push([unit.id, action, this.rng.d6()]); return 'done'; },
    maybeBeginTurnEndEventOrEndEnemyPhase() { this.finished = true; },
  });
  for (const method of ['syncTerrainLoadingOverlay', 'advanceFogVisionTransition', 'advanceEngineVibration',
    'advanceTankEngineExhaust', 'advanceTurnTransition', 'advanceStukaFlyover', 'advanceAirborneSupport', 'advanceUnitEffects']) scene[method] = () => {};
  scene.advanceTankWreckWater = scene.openPendingCombatLogReplayIfReady = () => false;
  for (const list of ['floaters', 'repairIndicators', 'muzzleFlashes', 'muzzleSmokes', 'projectileTraces', 'highExplosiveBlasts',
    'machineGunBursts', 'infantryBulletVolleys', 'infantryRocketTraces', 'sniperBulletTraces']) scene[list] = [];
  scene.mainGunRecoils = new Map();
  if (!yielding) scene.deferRegionalAI = () => false;
  return { scene, executed, setNow: value => { now = value; } };
}

test('remote turns resume across frames with identical dice, action order and RNG, including infantry action indices', () => {
  const baseline = simulation(false), split = simulation();
  baseline.scene.beginCurrentEnemyTurn(); split.scene.beginCurrentEnemyTurn();
  assert(split.scene.regionalAIContinuation, 'remote work must yield instead of processing every unit in one frame');
  assert(split.executed.length < baseline.executed.length);
  let frames = 0;
  while (!split.scene.finished && frames++ < 100) {
    const before = split.executed.length;
    split.scene.update(1 / 60);
    assert(split.executed.length - before <= 3, '3 ms budget is checked between complete actions');
  }
  assert(split.scene.finished); assert(frames > 1);
  assert.deepEqual(split.executed, baseline.executed);
  assert.equal(split.scene.rng.getState(), baseline.scene.rng.getState());
  assert.equal(split.scene.enemyIndex, baseline.scene.enemyIndex);
});

test('ordinary maps and local units do not enter the background scheduler', () => {
  for (const regional of [false, true]) {
    const { scene } = simulation(true, regional);
    scene.isOutsidePlayerRegion = () => false;
    scene.beginCurrentEnemyTurn();
    assert(scene.finished); assert.equal(scene.regionalAIContinuation, null);
  }
});

test('instant remote attack callbacks may reenter the scheduler without duplicating or losing actions', () => {
  const baseline = simulation(false), split = simulation();
  for (const { scene } of [baseline, split]) {
    const execute = scene.executeEnemyAction;
    scene.executeEnemyAction = function(unit, action) {
      execute.call(this, unit, action);
      if (action === 'shoot') { this.runNextEnemyStep(); return 'animating'; }
      return 'done';
    };
  }
  baseline.scene.beginCurrentEnemyTurn(); split.scene.beginCurrentEnemyTurn();
  let frames = 0;
  while (!split.scene.finished && frames++ < 100) split.scene.update(1 / 60);
  assert(split.scene.finished);
  assert.deepEqual(split.executed, baseline.executed);
  assert.equal(split.scene.rng.getState(), baseline.scene.rng.getState());
});

test('stale continuations cannot run after exit, phase change, load, turn change or actor-order replacement', () => {
  for (const change of [s => { s.leavingBattle = true; }, s => { s.phase = 'player'; }, s => { s.mission = {}; },
    s => { s.turn++; }, s => { s.enemyOrder = [...s.enemyOrder]; },
    s => { s.enemyOrder[s.enemyIndex] = { ...s.enemyOrder[s.enemyIndex] }; }, s => { s.outcome = 'defeat'; }]) {
    const { scene, executed } = simulation(); scene.beginCurrentEnemyTurn();
    const count = executed.length; change(scene);
    scene.regionalAIFrameStart = null; scene.regionalAIWorkChecks = 0;
    assert(scene.resumeRegionalAI()); assert.equal(executed.length, count); assert.equal(scene.regionalAIContinuation, null);
  }
});

test('animation blocks a pending continuation and repeated requests cannot enqueue it twice', () => {
  const { scene, executed } = simulation(); scene.beginCurrentEnemyTurn();
  const pending = scene.regionalAIContinuation, count = executed.length;
  assert(scene.deferRegionalAI(() => assert.fail('duplicate resume')));
  assert.equal(scene.regionalAIContinuation, pending);
  scene.anim = {}; assert.equal(scene.resumeRegionalAI(), false); assert.equal(executed.length, count);
  scene.anim = null; scene.regionalAIFrameStart = null; scene.regionalAIWorkChecks = 0;
  scene.resumeRegionalAI(); assert(executed.length > count);
});

test('the work cap yields even when the clock has not advanced', () => {
  const { scene } = simulation();
  for (let i = 0; i < 32; i++) assert.equal(scene.deferRegionalAI(() => {}), false);
  assert.equal(scene.deferRegionalAI(() => {}), true);
});

test('support routes retry an unreachable remembered destination only once per decision, and recheck changed occupancy', () => {
  const map = new rules.HexMap(4, 1);
  for (let q = 0; q < 4; q++) { map.set({ pos: { q, r: 0 }, terrain: 'field' }); map.regions.set(`${q},0`, q === 3 ? 'B' : 'A'); }
  const actor = { id: 'actor', kind: 'panzer4', faction: 'german', sideId: 'enemy', pos: { q: 0, r: 0 }, facing: 0, stats: {},
    crew: { commander: true, gunner: true, loader: true, driver: true, coDriver: true } };
  const player = { ...actor, id: 'player', sideId: 'player', faction: 'usa', pos: { q: 3, r: 0 } };
  const mission = { map, sherman: player, allies: [], enemies: [actor],
    data: { multiRegion: { regions: [{ id: 'A', center: actor.pos }, { id: 'B', center: player.pos }], powerCosts: {} } },
    multiRegionState: { supportTargets: { actor: 'B' } } };
  const cross = map.canUnitCrossEdge; let checks = 0;
  map.canUnitCrossEdge = () => { checks++; return false; };
  assert.equal(rules.regionalSupportStep(mission, actor), null); assert.equal(checks, 6);
  assert.equal(rules.regionalSupportStep(mission, actor), null); assert.equal(checks, 12, 'failed routes are not cached across actions');
  // The occupied destination itself is unreachable; make the first B hex free.
  map.regions.set('2,0', 'B'); map.canUnitCrossEdge = cross;
  assert.deepEqual(rules.regionalSupportStep(mission, actor), { q: 1, r: 0 });
  const step = { q: 1, r: 0 };
  map.canUnitCrossEdge = () => assert.fail('turning with a known step must not run BFS again');
  assert.equal(rules.regionalSupportTurn(mission, actor, step), 'stay');
});

test('one action decision reuses its support step for both target position and turn planning', () => {
  let searches = 0;
  const Scene = sceneMethods(['chooseActionForEntry', 'currentAITurnTargetPosition', 'aiMoveStateForAction'], {
    ...rules, GameSession: { gameMode: 'hardcore' }, canExecuteAction: () => true,
    regionalSupportStep: () => { searches++; return { q: 1, r: 0 }; },
  });
  const scene = new Scene(), actor = { kind: 'panzer4', pos: { q: 0, r: 0 }, facing: 0 };
  Object.assign(scene, { mission: { data: { multiRegion: {} }, map: {} },
    currentAITarget: () => ({ pos: { q: 2, r: 0 } }), buildOccupiedSet: () => new Set(),
    enemyCrewRequirementMet: () => true, aiMoveDestinationForAction: () => null,
    isAIReverseMoveFilterEnabled: () => true, isAIMoveStateAllowed: () => true,
  });
  assert.equal(scene.chooseActionForEntry(actor, { primary: 'turn' }, { commitMoveState: true }), 'turn');
  assert.equal(searches, 1);
  assert.equal(scene.pendingAIMoveState.state, null, 'a unit already facing its support step stays aligned');
  scene.chooseActionForEntry(actor, { primary: 'turn' });
  assert.equal(searches, 2, 'a later decision starts a fresh route calculation');
});
