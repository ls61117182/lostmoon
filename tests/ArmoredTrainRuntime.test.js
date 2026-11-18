const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const train = require('../assets/scripts/core/ArmoredTrain.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { HexMap, offsetToAxial, axialToOffset, directionTo, neighbor } = require('../assets/scripts/core/HexGrid.ts');
const { checkOutcome } = require('../assets/scripts/core/Objective.ts');
const { rollAttack, applyAttack, rollHighExplosiveAttack, applyHighExplosiveAttack, canAttack } = require('../assets/scripts/core/Combat.ts');
const { computeRadioSharedVisibleHexes, computeUnitVisibleHexes, hasRadioTransmit } = require('../assets/scripts/core/FogOfWar.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { trainBodyBlocks } = require('../assets/scripts/core/types.ts');
const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
const { RNG } = require('../assets/scripts/core/Dice.ts');
const SceneMethods = require('./helpers/BattleSceneMethods.cjs');
function data(kinds = ['howitzer', 'locomotive', 'tender'], extra = {}) {
  return { id: 'train-test', name: 'Train', description: '', cols: 16, rows: 9, theater: 'europe',
    tiles: Array.from({ length: 9 }, (_, row) => Array.from({ length: 16 }, () => ({ t: row === 3 ? 'm' : 'f', ...(row === 3 ? { rl: '100100' } : {}) }))),
    sherman: { kind: 'sherman', at: { col: 0, row: 8 }, facing: 0 }, enemies: [],
    trainRoutes: [{ id: 'main', cells: Array.from({ length: 16 }, (_, col) => ({ col, row: 3 })), entryDir: 3, exitDir: 0 }],
    trains: [{ id: 'enemy-train', sideId: 'enemy', routeId: 'main', headIndex: 5,
      carriages: kinds.map((kind, index) => ({ id: `car-${index}`, kind: `train_${kind}` })) }],
    objective: { type: 'destroy_train', trainId: 'enemy-train' }, ...extra };
}
function fixture(kinds, extra) { return loadMission(data(kinds, extra)); }
function step(m, state) { const moves = train.advanceTrainStep(m, state); train.finishTrainStep(m, state); return moves; }
function dice(...values) { let count = 0; return { d6: () => { assert.ok(count < values.length, 'unexpected dice'); return values[count++]; }, count: () => count }; }
function attacker(kind = 'sherman') { return { id: 'shot', kind, faction: 'usa', sideId: 'player', pos: { q: 0, r: 0 }, facing: 0,
  stats: { ...getUnitStats(kind), penetration: 2 }, loaded: true }; }

test('independent profiles, no crew/dice, optional tender and multiple locomotives retain fixed speed', () => {
  const m = fixture(['howitzer', 'locomotive', 'locomotive', 'tender', 'tender']);
  const t = m.trains[0];
  for (const module of ['locomotive', 'tender', 'command', 'howitzer', 'artillery_flak', 'panzerjaeger']) {
    const stats = getUnitStats(`train_${module}`);
    assert.equal(stats.size, 2);
    assert.deepEqual([stats.armorFront, stats.armorFrontSide, stats.armorRearSide, stats.armorRear], [7, 9, 9, 7]);
  }
  assert.equal(train.trainSpeed(t), 2);
  assert.ok(t.carriages.every(c => c.controller === 'ai' && !c.crew && c.visionRange === 3));
  t.carriages[1].destroyed = true; train.syncArmoredTrains(m);
  assert.equal(t.separated, false); assert.equal(train.trainSpeed(t), 2);
  t.carriages[3].destroyed = true; assert.equal(train.trainSpeed(t), 2);
  t.carriages[4].destroyed = true; assert.equal(train.trainSpeed(t), 1);
  t.carriages[2].destroyed = true; train.syncArmoredTrains(m);
  assert.equal(t.destroyed, true); assert.equal(t.separated, true); assert.equal(train.trainSpeed(t), 0);
  assert.equal(trainBodyBlocks(t.carriages[1]), false);
  assert.equal(trainBodyBlocks(t.carriages[0]), true);
  assert.equal(checkOutcome(m), 'victory');
});
test('one-grid synchronized steps retain weapon aim and do not depend on mud cost', () => {
  const m = fixture(), t = m.trains[0], state = train.beginTrainAction(m, 'enemy', 1);
  t.carriages[0].turretFacing = 4;
  const original = t.carriages.map(c => ({ ...c.pos }));
  const moves = train.advanceTrainStep(m, state);
  assert.equal(moves.length, 3); assert.equal(state.stage, 'ambush');
  t.carriages.forEach((c, i) => assert.equal(c.pos.q, original[i].q + 1));
  assert.equal(t.carriages[0].turretFacing, 4);
  train.finishTrainStep(m, state); assert.equal(state.stage, 'move');
  step(m, state); assert.equal(state.stage, 'attack');
  assert.equal(train.nextTrainAttacker(m, state).id, 'car-0');
  assert.equal(train.nextTrainAttacker(m, state), undefined);
  assert.equal(state.stage, 'done'); assert.equal(t.lastActionTurn, 1);
});
test('first-step loss of all locomotives cancels the second step, but surviving gun still attacks', () => {
  const m = fixture(), t = m.trains[0], state = train.beginTrainAction(m, 'enemy', 1);
  train.advanceTrainStep(m, state); const pos = t.headIndex;
  t.carriages[1].destroyed = true; train.finishTrainStep(m, state);
  assert.equal(state.stage, 'attack'); assert.equal(t.headIndex, pos);
  assert.equal(train.nextTrainAttacker(m, state), t.carriages[0]);
  assert.equal(checkOutcome(m), 'victory');
});
test('destroying the last tender between steps preserves locked allowance until the next turn', () => {
  const m = fixture(), t = m.trains[0], state = train.beginTrainAction(m, 'enemy', 1);
  train.advanceTrainStep(m, state); t.carriages[2].destroyed = true;
  train.finishTrainStep(m, state); assert.equal(state.stage, 'move');
  step(m, state); assert.equal(state.budgets[0].moved, 2);
  while (train.nextTrainAttacker(m, state)) {}
  assert.equal(train.beginTrainAction(m, 'enemy', 2).budgets[0].allowance, 1);
});
test('front train is resolved before its follower, and follower cannot borrow a future gap', () => {
  const d = data(['locomotive']); d.trains[0].headIndex = 5;
  d.trains.unshift({ id: 'rear', sideId: 'enemy', routeId: 'main', headIndex: 4,
    carriages: [{ id: 'rear-loco', kind: 'train_locomotive' }, { id: 'rear-tender', kind: 'train_tender' }] });
  const m = loadMission(d), state = train.beginTrainAction(m, 'enemy', 1);
  step(m, state);
  assert.equal(m.trains[0].headIndex, 5); assert.equal(m.trains[1].headIndex, 6);
  step(m, state);
  assert.equal(m.trains[0].headIndex, 5); assert.equal(state.budgets[0].blocked, true);
  assert.ok(m.trains.every(t => !t.destroyed));
});
test('step collisions destroy both sides of non-infantry, spare infantry, and lock its movement', () => {
  const d = data(['locomotive', 'tender']);
  d.enemies = [{ kind: 'truck', at: { col: 6, row: 3 }, facing: 0 }, { kind: 'german_infantry', at: { col: 6, row: 3 } }];
  d.allies = [{ kind: 'panzer4', at: { col: 7, row: 3 }, facing: 0 }];
  const m = loadMission(d), state = train.beginTrainAction(m, 'enemy', 1);
  step(m, state); assert.equal(m.enemies.find(c => c.kind === 'truck').destroyed, true);
  const infantry = m.enemies.find(c => c.kind === 'german_infantry');
  assert.ok(!infantry.destroyed); assert.equal(train.infantryLockedByTrain(m, infantry), true);
  step(m, state); assert.equal(m.allies[0].destroyed, true);
  assert.equal(train.infantryLockedByTrain(m, infantry), true, 'next carriage still occupies the cell');
  m.trains[0].carriages.forEach(c => c.destroyed = true); train.syncArmoredTrains(m);
  assert.equal(train.infantryLockedByTrain(m, infantry), false);
});
test('entry advances from the front, keeps off-map locomotive untargetable, persists across rounds', () => {
  const d = data(); delete d.trains[0].headIndex; d.trains[0].entryTurn = 2;
  const m = loadMission(d), t = m.trains[0];
  assert.equal(m.enemies.length, 0); assert.equal(checkOutcome(m), 'ongoing');
  assert.deepEqual(train.activateTrainEntries(m, 1), []);
  assert.deepEqual(train.activateTrainEntries(m, 2), ['enemy-train']);
  const state = train.beginTrainAction(m, 'enemy', 2, ['enemy-train']);
  train.advanceTrainStep(m, state);
  assert.equal(t.carriages[0].trainCar.presence, 'present'); assert.equal(t.carriages[1].trainCar.presence, 'outside');
  assert.equal(canAttack({ attacker: attacker(), target: t.carriages[1], map: m.map }).ok, false);
  train.finishTrainStep(m, state); step(m, state);
  assert.equal(state.stage, 'done'); assert.equal(t.carriages[2].trainCar.presence, 'outside');
  assert.deepEqual(train.activateTrainEntries(m, 2), []);
  const next = train.beginTrainAction(m, 'enemy', 3); step(m, next);
  assert.equal(t.carriages[2].trainCar.presence, 'present');
});
test('any live carriage escaping the whole-train objective fails, wreck escape does not', () => {
  const m = fixture(), t = m.trains[0]; t.headIndex = 15;
  step(m, train.beginTrainAction(m, 'enemy', 1));
  assert.equal(t.carriages[0].trainCar.presence, 'exited'); assert.ok(!t.carriages[0].destroyed);
  assert.equal(checkOutcome(m), 'defeat');
  const safe = fixture(); safe.trains[0].headIndex = 15; safe.trains[0].carriages[0].destroyed = true;
  step(safe, train.beginTrainAction(safe, 'enemy', 1)); assert.equal(checkOutcome(safe), 'ongoing');
});
test('specific carriage goals use stable identity, independent of formation destruction', () => {
  const m = fixture(undefined, { objective: { type: 'destroy_train_carriage', trainId: 'enemy-train', carriageId: 'car-0' } });
  m.trains[0].carriages[1].destroyed = true; assert.equal(checkOutcome(m), 'ongoing');
  m.trains[0].carriages[0].destroyed = true; assert.equal(checkOutcome(m), 'victory');
});
test('AP damage uses train fire/destroy table, repeat penetration destroys, and overpenetration cancels', () => {
  for (const die of [1, 4, 5, 6]) {
    const m = fixture(), car = m.trains[0].carriages[0];
    const shooter = attacker(); shooter.pos = neighbor(car.pos, 0);
    const report = rollAttack({ attacker: shooter, target: car, map: m.map, directionalDamageCheck: true, unitDamageTargetClass: true }, dice(6, 6, 6, 6, die));
    assert.equal(report.damageEffect, die >= 5 ? 'destroyed' : 'fire'); applyAttack(car, report);
    assert.ok(!car.crew && !car.paralyzed && !car.turretDamaged);
    if (die < 5) {
      const rng = dice(6, 6, 6, 6);
      const repeat = rollAttack({ attacker: shooter, target: car, map: m.map }, rng);
      assert.equal(rng.count(), 4); applyAttack(car, repeat); assert.equal(car.destroyed, true);
    }
  }
  const m = fixture(), car = m.trains[0].carriages[0]; car.stats = { ...car.stats, armorFront: 0, armorRear: 0, armorRearSide: 0, armorFrontSide: 0 };
  const shooter = attacker(); shooter.pos = neighbor(car.pos, 0);
  const report = rollAttack({ attacker: shooter, target: car, map: m.map, overpenetration: true }, dice(6, 6, 6, 6, 6));
  assert.equal(report.overpenetrated, true); applyAttack(car, report); assert.ok(!car.destroyed && !car.fireLevel);
});
test('HE shares tank blast checks but never immobilizes a carriage', () => {
  const m = fixture(), car = m.trains[0].carriages[0], shooter = attacker();
  shooter.pos = neighbor(car.pos, 0);
  car.stats = { ...car.stats, armorFront: 8, armorFrontSide: 8, armorRearSide: 8, armorRear: 8 };
  shooter.stats.highExplosivePower = 2;
  const report = rollHighExplosiveAttack({ attacker: shooter, target: car, map: m.map }, dice(6, 6, 4, 4));
  assert.equal(report.outcome, 'none'); applyHighExplosiveAttack(car, report); assert.ok(!car.paralyzed);
  const fire = rollHighExplosiveAttack({ attacker: shooter, target: car, map: m.map }, dice(6, 6, 5, 5));
  assert.equal(fire.outcome, 'fire'); applyHighExplosiveAttack(car, fire);
  const repeat = rollHighExplosiveAttack({ attacker: shooter, target: car, map: m.map }, dice(6, 6, 5, 5));
  assert.equal(repeat.outcome, 'destroyed');
});
test('same-hex infantry can attack train cars only in a mode that permits it', () => {
  const m = fixture(), car = m.trains[0].carriages[0], infantry = attacker('american_infantry'); infantry.pos = { ...car.pos };
  assert.equal(canAttack({ attacker: infantry, target: car, map: m.map, sameHexInfantryTankAttack: true }).ok, true);
  assert.equal(canAttack({ attacker: infantry, target: car, map: m.map }).ok, false);
});
test('nearest legal carriage wins ambush selection regardless of its position in the consist', () => {
  const m = fixture(), t = m.trains[0], watcher = attacker(); watcher.pos = { ...t.carriages[2].pos };
  assert.equal(train.nearestTrainAmbushTarget(t.carriages, watcher, () => true), t.carriages[2]);
  assert.equal(train.nearestTrainAmbushTarget(t.carriages, watcher, c => c !== t.carriages[2]), t.carriages[1]);
});

test('train ground guns use the tank diagonal aiming paths and their independent gunner range', () => {
  const m = fixture(), car = m.trains[0].carriages[0];
  const fog = require('../assets/scripts/core/FogOfWar.ts');
  const target = { ...m.sherman, pos: neighbor(neighbor(neighbor(car.pos, 0), 1), 0) };
  const tank = { ...car, kind: 'sherman', trainCar: undefined, stats: getUnitStats('sherman') };
  const expected = fog.diagonalMainGunDirectionForHex(m.map, tank, target.pos);
  assert.notEqual(expected, null);
  assert.equal(fog.diagonalMainGunDirectionForHex(m.map, car, target.pos), expected);
  assert.equal(canAttack({ attacker: car, target, map: m.map, expandedTurretDirections: true }).ok, true);
  car.turretFacing = 0;
  const distant = { ...target, pos: { q: car.pos.q + 4, r: car.pos.r } };
  assert.equal(fog.isWithinOwnVisionRange(car, distant), true);
  assert.ok(computeUnitVisibleHexes(m.map, car).has(HexMap.keyOf(distant.pos)));
});

test('a completely exited train keeps its live identities but stops advancing off-map', () => {
  const d = data(['locomotive'], { objective: { type: 'destroy_all_enemies' } });
  d.trains[0].headIndex = 15;
  const m = loadMission(d), t = m.trains[0], state = train.beginTrainAction(m, 'enemy', 1);
  step(m, state);
  assert.equal(t.carriages[0].trainCar.presence, 'exited');
  assert.equal(t.carriages[0].destroyed, undefined);
  assert.equal(train.trainSpeed(t), 0);
  assert.equal(checkOutcome(m), 'ongoing', 'exiting is never destruction');
  const next = train.beginTrainAction(m, 'enemy', 2);
  assert.deepEqual(train.advanceTrainStep(m, next), []);
  assert.equal(t.headIndex, 16);
});
test('internal vision survives separation; external radio requires an intact command formation', () => {
  const m = fixture(['howitzer', 'command', 'locomotive']), t = m.trains[0], gun = t.carriages[0];
  assert.equal(hasRadioTransmit(gun), true);
  t.carriages[2].destroyed = true; train.syncArmoredTrains(m);
  assert.equal(hasRadioTransmit(gun), false);
  const shared = computeRadioSharedVisibleHexes(m.map, gun, t.carriages);
  const commandSight = computeUnitVisibleHexes(m.map, t.carriages[1]);
  assert.ok([...commandSight].every(key => shared.has(key)));
  const radio = attacker(); radio.pos = { q: 10, r: 7 };
  const noExternal = computeRadioSharedVisibleHexes(m.map, gun, [...t.carriages, radio]);
  assert.deepEqual(shared, noExternal);
});
test('live, joined wrecked and separated carriages never block sight or firing rays; terrain still blocks', () => {
  const m = fixture(), t = m.trains[0], car = t.carriages[0];
  const a = neighbor(car.pos, 4), b = neighbor(car.pos, 1);
  const observer = { ...attacker(), pos: a, turretFacing: 1 };
  const target = { ...m.sherman, id: 'behind-train', pos: b };
  const check = expected => {
    assert.equal(m.map.hasLineOfSight(a, b), expected);
    assert.equal(computeUnitVisibleHexes(m.map, observer).has(HexMap.keyOf(b)), expected);
    assert.equal(canAttack({ attacker: observer, target, map: m.map }).ok, expected);
  };
  check(true);
  car.destroyed = true; train.syncArmoredTrains(m); check(true);
  t.carriages[1].destroyed = true; train.syncArmoredTrains(m); check(true);
  m.map.get(car.pos).hasBuilding = true; check(false);
});
function loopData(lengths) {
  const d = data(['locomotive']); const center = { q: 5, r: 4 };
  let p = neighbor(neighbor(center, 4), 4); const positions = [];
  for (const dir of [0, 1, 2, 3, 4, 5]) for (let n = 0; n < 2; n++) { positions.push(p); p = neighbor(p, dir); }
  d.trainRoutes = [{ id: 'loop', loop: true, cells: positions.map(p => axialToOffset(p)) }];
  for (let i = 0; i < positions.length; i++) {
    const at = axialToOffset(positions[i]), prev = positions[(i + 11) % 12], next = positions[(i + 1) % 12];
    const bits = Array(6).fill('0'); bits[directionTo(positions[i], prev)] = '1'; bits[directionTo(positions[i], next)] = '1';
    d.tiles[at.row][at.col] = { t: 'f', rl: bits.join('') };
  }
  d.trains = lengths.map((length, i) => ({ id: `loop-${i}`, sideId: 'enemy', routeId: 'loop', headIndex: i * 6 + length - 1,
    carriages: Array.from({ length }, (_, n) => ({ id: `${i}-${n}`, kind: n ? 'train_tender' : 'train_locomotive' })) }));
  d.objective = { type: 'destroy_train', trainId: 'loop-0' }; return d;
}
test('closed routes reserve two cells per train and cycle without leaving the map', () => {
  assert.throws(() => loadMission(loopData([5, 4])), /total length/);
  const m = loadMission(loopData([4, 4]));
  for (let turn = 1; turn <= 10; turn++) {
    const state = train.beginTrainAction(m, 'enemy', turn);
    while (state.stage === 'move') step(m, state);
    while (train.nextTrainAttacker(m, state)) {}
    assert.equal(new Set(m.trains.flatMap(t => t.carriages.map(c => HexMap.keyOf(c.pos)))).size, 8);
    assert.ok(m.trains.every(t => t.carriages.every(c => c.trainCar.presence === 'present')));
  }
});
test('route validation rejects broken ports, missing engines, overlapping cars and standalone train placement', () => {
  const broken = data(); broken.tiles[3][7].rl = '000100'; assert.throws(() => loadMission(broken), /Disconnected/);
  assert.throws(() => fixture(['tender']), /locomotive/);
  const overlap = data(); overlap.trains.push({ ...overlap.trains[0], id: 'other', carriages: [{ id: 'other-loco', kind: 'train_locomotive' }] });
  assert.throws(() => loadMission(overlap), /Overlapping/);
  const standalone = data(); standalone.enemies.push({ kind: 'train_locomotive', at: { col: 9, row: 1 } });
  assert.throws(() => loadMission(standalone), /formation/);
});
test('save/load preserves outside members, locked speed, action cursor and separated wreck identities', () => {
  const source = data(), m = loadMission(source), t = m.trains[0];
  const state = train.beginTrainAction(m, 'enemy', 3); train.advanceTrainStep(m, state);
  t.carriages[2].destroyed = true; t.carriages[2].wreckPose = { x: 1, y: 2, angle: .5 };
  const save = captureSave({ mission: m, missionId: source.id, gameMode: 'hardcore', turn: 3, phase: 'enemy',
    movesLeft: 0, attacksLeft: 0, miscDone: true, playerStep: 'misc', hatchChangedThisTurn: false, phaseDice: [] });
  const restored = loadMission(source); assert.equal(applySave(restored, source.id, JSON.parse(JSON.stringify(save))).ok, true);
  assert.equal(restored.trains[0].headIndex, t.headIndex); assert.equal(restored.trainAction.stage, 'ambush');
  assert.equal(restored.trainAction.budgets[0].allowance, 2);
  assert.deepEqual(restored.trains[0].carriages[2].wreckPose, t.carriages[2].wreckPose);
  assert.equal(restored.enemies.filter(c => c.trainCar).length, 3);
  train.finishTrainStep(restored, restored.trainAction); step(restored, restored.trainAction);
  assert.equal(restored.trainAction.budgets[0].moved, 2);
});
test('scene phase waits for each step ambush and enters the ground-gun queue once, with no action dice', () => {
  const m = fixture(), events = [], real = train;
  const Scene = SceneMethods(['runTrainSceneAction'], { ...real, isTankUnit: () => false, isAntiTankGunUnit: () => false,
    GameSession: { gameMode: 'hardcore' },
    getGameModeConfig: () => ({}), computeRadioSharedVisibleHexes: () => new Set(), HexMap,
    currentTargetFor: () => null, canAttack: () => ({ ok: true }) });
  const scene = Object.assign(new Scene(), { mission: m, turn: 1, outcome: 'ongoing', moveDuration: .1,
    destroyEnemyDiceTray() {}, clearActiveActingUnit() {}, updateOutcomeOverlay() {}, redraw() {},
    allUnits: () => [m.sherman, ...m.allies, ...m.enemies], pushTrainWrecks() {},
    tryResolveAmbushAfterMove(mover, after, batch) { events.push(['ambush', batch.length]); m.trains[0].carriages[2].destroyed = true; after(); return true; },
    computeOutcome: () => 'ongoing', aiFriendliesFor: () => [], aiMissionTargetsFor: () => [], currentWeather: () => 'clear', aiTargetsFor: () => [],
    scheduleOnce: fn => fn() });
  scene.runTrainSceneAction(train.beginTrainAction(m, 'enemy', 1), () => events.push(['done']));
  assert.equal(events.length, 0, 'wait for first synchronized animation');
  const first = scene.trainMoveAnimation; scene.trainMoveAnimation = null; first.onDone();
  assert.equal(events.length, 1); assert.ok(scene.trainMoveAnimation, 'second move survives tender loss');
  const second = scene.trainMoveAnimation; scene.trainMoveAnimation = null; second.onDone();
  assert.deepEqual(events.map(e => e[0]), ['ambush', 'ambush', 'done']);
  assert.equal(m.trainAction.attackIndex, 3); assert.equal(scene.trainSceneRunning, false);
});

test('consecutive idle gun cars finish with Cocos one-shot callback deduplication and hand off the turn', () => {
  const m = loadMission(JSON.parse(fs.readFileSync('assets/resources/missions/mission_destroy_train.json', 'utf8')));
  const state = train.beginTrainAction(m, 'enemy', 1); state.stage = 'attack';
  const scheduled = new Set(), queue = []; let completed = 0;
  const Scene = SceneMethods(['runTrainSceneAction'], { ...train, HexMap,
    computeRadioSharedVisibleHexes: () => new Set(), canAttack: () => ({ ok: true }), currentTargetFor: () => null });
  const scene = Object.assign(new Scene(), { mission: m, outcome: 'ongoing',
    destroyEnemyDiceTray() {}, clearActiveActingUnit() {}, updateOutcomeOverlay() {}, redraw() {},
    aiFriendliesFor: () => [], aiMissionTargetsFor: () => [], currentWeather: () => 'clear', aiTargetsFor: () => [],
    scheduleOnce(fn) {
      // Scheduler.schedule ignores a second registration of the active callback.
      if (!scheduled.has(fn)) { scheduled.add(fn); queue.push(fn); }
    } });
  scene.runTrainSceneAction(state, () => completed++);
  for (let i = 0; queue.length && i < 20; i++) {
    const callback = queue.shift(); callback(); scheduled.delete(callback);
  }
  assert.equal(completed, 1);
  assert.equal(scene.trainSceneRunning, false);
  assert.equal(state.stage, 'done');
  assert.equal(m.trains[0].lastActionTurn, 1);
  assert.equal(train.beginTrainAction(m, 'enemy', 1).budgets.length, 0, 'must not start the same formation again');
});

test('European Destroy the Train level is reachable and meets the requested scenario and objective', () => {
  const mission = JSON.parse(fs.readFileSync('assets/resources/missions/mission_destroy_train.json', 'utf8'));
  const loaded = loadMission(mission);
  assert.equal(mission.name, '击毁列车'); assert.equal(mission.theater, 'europe');
  assert.equal(mission.objective.type, 'destroy_train');
  assert.equal(loaded.trains.length, 1); assert.equal(mission.trainRoutes.length, 1);
  const village = JSON.parse(fs.readFileSync('assets/resources/missions/mission_01.json', 'utf8'));
  assert.equal(mission.cols, village.cols); assert.equal(mission.rows, village.rows);
  assert.deepEqual(mission.tiles.map(row => row.map(Boolean)), village.tiles.map(row => row.map(Boolean)));
  assert.equal(loaded.map.all().length, 36);
  assert.equal(mission.trainRoutes[0].loop, true); assert.equal(mission.trainRoutes[0].cells.length, 14);
  const rails = new Set(mission.trainRoutes[0].cells.map(p => `${p.col},${p.row}`));
  for (const unit of [mission.sherman, ...mission.enemies]) {
    assert.ok(!rails.has(`${unit.at.col},${unit.at.row}`), 'ordinary units start clear of the moving train');
  }
  assert.equal(mission.tiles.flat().filter(tile => tile?.rl && tile?.rd).length, 2);
  const cars = loaded.trains[0].carriages;
  assert.equal(cars.length, 11); assert.equal(cars[5].kind, 'train_locomotive');
  assert.deepEqual(cars.slice(0, 5).map(c => c.kind), cars.slice(6).map(c => c.kind).reverse());
  assert.equal(mission.enemies.filter(c => c.kind === 'german_infantry').length, 2);
  assert.equal(mission.enemies.filter(c => c.kind === 'panzer3_n').length, 2);
  const { getChapterLevels } = require('../assets/scripts/core/LevelDB.ts');
  const level = getChapterLevels('europe').find(level => level.missionId === mission.id);
  assert.equal(level.alwaysUnlocked, true);
  assert.equal(checkOutcome(loaded), 'ongoing');
  cars[5].destroyed = true; assert.equal(checkOutcome(loaded), 'victory');
  assert.ok(mission.enemies.every(c => !c.destroyed), 'support enemies are not additional victory conditions');
});

test('scene rail poses have no snap at movement boundaries and retain the stopped bend pose after separation', () => {
  const m = loadMission(JSON.parse(fs.readFileSync('assets/resources/missions/mission_destroy_train.json', 'utf8')));
  const { trainTrackPose } = require('../assets/scripts/core/ArmoredTrainArt.ts');
  const { axialToPixel } = require('../assets/scripts/core/HexGrid.ts');
  const easeOutCubic = t => 1 - (1 - t) ** 3;
  const Scene = SceneMethods(['trainVisualPose', 'interpolatedPos'], { ...train, trainTrackPose, easeOutCubic });
  const scene = Object.assign(new Scene(), { mission: m, hexSize: 66,
    trainArt: { manifest: JSON.parse(fs.readFileSync('assets/resources/textures/units/trains/bp44/bp44_art_manifest.json', 'utf8')) },
    project(q, r) { const p = axialToPixel({ q, r }, this.hexSize); return { x: p.x, y: -p.y }; } });
  const formation = m.trains[0], before = formation.carriages.map(c => scene.trainVisualPose(c));
  const state = train.beginTrainAction(m, 'enemy', 1), moves = train.advanceTrainStep(m, state);
  scene.trainMoveAnimation = { moves, t: 0 };
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8);
  formation.carriages.forEach((car, i) => {
    const pose = scene.trainVisualPose(car); close(pose.x, before[i].x); close(pose.y, before[i].y); close(pose.angleDegrees, before[i].angleDegrees);
  });
  scene.trainMoveAnimation.t = 1;
  const arriving = formation.carriages.map(c => scene.trainVisualPose(c)); scene.trainMoveAnimation = null;
  formation.carriages.forEach((car, i) => {
    const pose = scene.trainVisualPose(car); close(pose.x, arriving[i].x); close(pose.y, arriving[i].y); close(pose.angleDegrees, arriving[i].angleDegrees);
    const center = scene.interpolatedPos(car); close(center.x, pose.x); close(center.y, pose.y);
  });
  formation.carriages[5].destroyed = true; train.syncArmoredTrains(m);
  formation.carriages.forEach((car, i) => close(scene.trainVisualPose(car).angleDegrees, arriving[i].angleDegrees));
  const car = formation.carriages[0]; car.destroyed = true; car.wreckPose = { x: .2, y: -.3, angle: .1 };
  const pushed = scene.trainVisualPose(car);
  close(pushed.x, arriving[0].x + .2 * scene.hexSize); close(pushed.y, arriving[0].y - .3 * scene.hexSize);
});

test('scene turret traverse fires at most once and waits a turn when it cannot aim', () => {
  for (const reached of [false, true]) {
    const m = fixture(['howitzer', 'locomotive']), car = m.trains[0].carriages[0], target = m.sherman;
    const state = train.beginTrainAction(m, 'enemy', 1); state.stage = 'attack';
    let attacks = 0, completed = 0, pending;
    const Scene = SceneMethods(['runTrainSceneAction'], { ...train, HexMap,
      isFootUnit: () => false, getGameModeConfig: () => ({}), GameSession: { gameMode: 'hardcore' },
      computeRadioSharedVisibleHexes: () => new Set([HexMap.keyOf(target.pos)]), canAttack: () => ({ ok: true }),
      currentTargetFor: (_, list) => list[0], limitTurretTraverse: () => ({ direction: 2, reached }),
      unitDisplayName: kind => kind, rollAttack: () => ({ hit: false, penetrated: false }) });
    const scene = Object.assign(new Scene(), { mission: m, outcome: 'ongoing',
      destroyEnemyDiceTray() {}, clearActiveActingUnit() {}, updateOutcomeOverlay() {}, redraw() {},
      aiFriendliesFor: () => [], aiMissionTargetsFor: () => [], currentWeather: () => 'clear', aiTargetsFor: () => [target],
      trainShotContext: () => ({ shellType: 'ap' }), rng: new RNG(1),
      setActiveActingUnit() {}, turretTargetDirection: () => 2, currentTurretFacingFor: () => 0,
      startEnemyTurretAim: (_, __, done) => done(),
      startDiceShow: (_, __, ___, done) => { attacks++; pending = done; },
      applyMainGunAttackResult() {}, presentAttackResult() {}, computeOutcome: () => 'ongoing', scheduleOnce: fn => fn() });
    scene.runTrainSceneAction(state, () => completed++);
    assert.equal(attacks, reached ? 1 : 0);
    if (pending) { assert.equal(completed, 0); pending(); }
    assert.equal(completed, 1); assert.equal(m.trainAction.stage, 'done');
  }
});

test('batch ambush continues to the next nearest live carriage after the first target dies', () => {
  const m = fixture(), cars = m.trains[0].carriages;
  const types = require('../assets/scripts/core/types.ts'), ambush = require('../assets/scripts/core/Ambush.ts');
  const watchers = [1, 2].map(order => ({ ...attacker(), id: `watcher-${order}`, pos: { ...cars[2].pos },
    ambushReadyThisTurn: true, ambushEnteredOrder: order, loadedShell: 'ap' }));
  const shots = []; let resumed = 0;
  const Scene = SceneMethods(['tryResolveAmbushAfterMove'], { ...types, ...ambush, ...train, HexMap,
    GameSession: { gameMode: 'hardcore' }, getGameModeConfig: () => ({}),
    hexDistance: require('../assets/scripts/core/HexGrid.ts').hexDistance,
    canEnterAmbush: () => true, canAttack: () => ({ ok: true }), nonPlayerTankWeaponForTarget: () => 'ap',
    rollAttack: () => ({ hit: true, penetrated: true, statusChange: 'destroyed' }),
    finishLockedFireAttack() {}, t: key => key, unitDisplayName: kind => kind, Color: class {} });
  const scene = Object.assign(new Scene(), { mission: m, resolvingAmbush: false, rng: new RNG(1),
    allUnits: () => [...watchers, ...cars], ambushGunnerSightKeys: () => new Set(cars.map(c => HexMap.keyOf(c.pos))),
    currentTurretFacingFor: () => 0, currentWeather: () => 'clear', protagonistForAttackTarget: () => m.sherman,
    battleLog() {}, spawnFloater() {}, startEnemyTurretAim: (_, __, done) => done(),
    startDiceShow: (_, __, ___, done, options) => { shots.push(options.target.id); done(); },
    applyMainGunAttackResult: target => target.destroyed = true,
    registerImpactDestroyWreckVisual() {}, presentAttackResult() {}, computeOutcome: () => 'ongoing',
    refreshStatusPanel() {}, updateHUD() {}, redraw() {} });
  assert.equal(scene.tryResolveAmbushAfterMove(cars[0], () => resumed++, cars), true);
  assert.deepEqual(shots, ['car-2', 'car-1']); assert.equal(resumed, 1);
  assert.ok(watchers.every(w => !w.ambushReadyThisTurn && w.loaded === false));
});
