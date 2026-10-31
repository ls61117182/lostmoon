const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, f);
const types = require('../assets/scripts/core/types.ts');
const riding = require('../assets/scripts/core/TankRiding.ts');
const combat = require('../assets/scripts/core/Combat.ts');
const hex = require('../assets/scripts/core/HexGrid.ts');
const { HexMap } = hex;
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const statistics = require('../assets/scripts/core/BattleStatistics.ts');
const GameSession = { gameMode: 'hardcore', isPvp: false };
const Scene = require('./helpers/BattleSceneMethods.cjs')([
  'playMoveStartSound', 'completePhaseDiceAction', 'autoEndPhaseIfDone', 'endCurrentSubPhase', 'applyMainGunAttackResult',
  'rollHighExplosiveCollateralResults', 'applyHighExplosiveAttackResult', 'applyMachineGunAttackResult',
  'runNextEnemyStep', 'executeEnemyAction', 'aiMoveDestinationForAction',
  'recordPlayerBattleKill', 'applyAttackDestroyedVisualAtImpact',
], { ...types, ...hex, ...riding, ...combat, ...statistics, GameSession, rollHEAttack: combat.rollHighExplosiveAttack,
  startManeuverSound() {}, playInfantryMove() {}, markAmbushAction() {}, clearLockedFire() {}, endAmbushTurn() {},
  unitDisplayName: kind => kind, describeEntry: entry => entry.primary });
function unit(id, kind, controller = 'ai') {
  const stats = getUnitStats(kind);
  return { id, kind, stats, faction: stats.faction, sideId: 'player', controller,
    pos: { q: 1, r: 1 }, facing: 0, turretFacing: 0,
    ...(types.isTankUnit({ kind }) ? { crew: types.createTankCrew(stats) } : {}) };
}
function fixture() {
  GameSession.isPvp = false;
  const tank = unit('player', 'sherman', 'local_player'), infantry = unit('riders', 'american_infantry');
  const units = [tank, infantry], map = new HexMap(5, 5);
  for (let q = 0; q < 5; q++) for (let r = 0; r < 5; r++) map.set({ pos: { q, r }, terrain: 'field' });
  const scene = new Scene();
  Object.assign(scene, { mission: { sherman: tank, playerTank: tank, map, data: { theater: 'europe' } },
    allUnits: () => units, canHearBattleAt: () => false, recordSettledBattleAttack() {}, recordPlayerBattleKill() {},
    redraw() {}, phase: 'player', playerStep: 'movement', outcome: 'ongoing', phaseDice: [],
    movementDone: true, attackDone: true, miscDone: false, campaignUpgradeActive: () => false,
    clearGunSelection() {}, closeDiePopover() {}, refreshPhaseUI() {}, updateHUD() {}, battleLogI18n() {},
    fadeTankTracksAtTurnEnd() {}, beginFireCheckPhase() { this.fireChecksStarted = true; this.phase = 'fire_check'; },
    playerDieActionItems: () => [], rng: { d6: () => 1 } });
  return { scene, tank, infantry, units, map };
}

test('all non-officer infantry can auto-board a same-faction player or AI tank, one squad per tank', () => {
  for (const kind of ['infantry', 'german_infantry', 'soviet_infantry', 'japanese_infantry', 'american_infantry']) {
    for (const controller of ['local_player', 'remote_player', 'ai']) {
      const tank = unit('carrier', 'sherman', controller), infantry = unit('rider', kind);
      tank.faction = infantry.faction;
      const units = [tank, infantry];
      assert.equal(riding.autoMountTankForMove(tank, units), infantry, kind);
      assert.equal(riding.autoMountTankForMove(tank, [...units, unit('extra', kind)]), null);
      tank.pos = { q: 2, r: 1 }; riding.syncTankRiders(units);
      assert.deepEqual(infantry.pos, tank.pos); assert.equal(infantry.mountedOnUnitId, tank.id);
      assert.deepEqual(riding.dismountTankRiders(tank, units), [infantry]);
    }
  }
  const { tank, infantry, units } = fixture();
  tank.controller = 'local_player'; infantry.faction = 'german';
  assert.equal(riding.autoMountTankForMove(tank, units), null, 'alliance alone cannot replace faction equality');
  infantry.faction = tank.faction; infantry.kind = 'officer';
  assert.equal(riding.autoMountTankForMove(tank, units), null);
});

test('actual move-start hook boards before moving even off-screen; turns and mid-move frames do not board', () => {
  const { scene, tank, infantry } = fixture();
  scene.playMoveStartSound({ unit: tank, kind: 'turn', t: 0 }); assert.equal(infantry.mountedOnUnitId, undefined);
  scene.playMoveStartSound({ unit: tank, kind: 'move', t: .1 }); assert.equal(infantry.mountedOnUnitId, undefined);
  scene.playMoveStartSound({ unit: tank, kind: 'move', t: 0 }); assert.equal(infantry.mountedOnUnitId, tank.id);
  const side = infantry.mountedDoubleSide;
  scene.playMoveStartSound({ unit: tank, kind: 'move', t: 0 }); assert.equal(infantry.mountedDoubleSide, side);
});

function germanAIFixture() {
  const { scene, tank: player, units, map } = fixture();
  player.pos = { q: 4, r: 4 }; units.splice(1);
  const tank = unit('german-tank', 'panzer4'), infantry = unit('german-riders', 'german_infantry');
  tank.sideId = infantry.sideId = 'enemy'; units.push(tank, infantry);
  Object.assign(scene, { phase: 'enemy', anim: null, moveDuration: 1,
    enemyOrder: [tank], enemyIndex: 0, enemyDice: [5, 1], enemyDiceTypes: ['move', 'move'],
    enemyDiceUsed: [false, false], enemyDiceResolvedActions: [], enemyDiceExecOrder: [0, 1],
    enemyDieActionEntry: i => ({ primary: i === 0 ? 'advance' : 'reverse' }),
    chooseActionForEntry: (_, entry) => entry.primary,
    pauseAIFlowForCombatLogReplay: () => false, isHardcoreInfantryActor: () => false,
    isOutsidePlayerRegion: () => false, canMoveToBattleTile: () => true, findMoveBlocker: () => null,
    isAIReverseMoveFilterEnabled: () => false, breakConcealment() {}, battleLog() {},
    clearAIMoveState() {}, clearActiveActingUnit() {}, refreshEnemyDiceTray() {}, hasSmokeAt: () => false,
    beginCurrentEnemyTurn() { this.nextActorStarted = true; },
    crushEnemyATGunsAt() {}, captureAbandonedATGunsAt() {}, captureAbandonedTanksAt() {} });
  return { scene, tank, infantry, units, map };
}

test('German AI carries infantry through real advance/reverse dice actions and dismounts only at its turn end', () => {
  for (const mode of ['classic', 'hardcore', 'test']) for (const occupied of [false, true]) {
    const { scene, tank, infantry, units } = germanAIFixture(); GameSession.gameMode = mode;
    for (let i = 0; i < 2; i++) {
      scene.runNextEnemyStep();
      assert.equal(scene.anim?.kind, 'move');
      assert.equal(scene.nextActorStarted, undefined);
      scene.playMoveStartSound(scene.anim);
      assert.equal(infantry.mountedOnUnitId, tank.id, `${mode}: ${i === 0 ? 'advance' : 'reverse'}`);
      tank.pos = { q: scene.anim.toQ, r: scene.anim.toR }; riding.syncTankRiders(units);
      assert.deepEqual(infantry.pos, tank.pos);
      scene.anim = null;
      assert.equal(infantry.mountedOnUnitId, tank.id, 'arrival alone must not dismount between dice');
    }
    if (occupied) {
      const ground = unit('ground', 'german_infantry'); ground.sideId = 'enemy'; ground.pos = { ...tank.pos }; units.push(ground);
    }
    scene.runNextEnemyStep();
    assert.equal(infantry.mountedOnUnitId, occupied ? tank.id : undefined);
    assert.equal(scene.nextActorStarted, true, 'blocked dismount must not stall the AI turn');
  }
  GameSession.gameMode = 'hardcore';
});

test('German AI boards before instant offscreen movement, while a blocked move never boards', () => {
  const { scene, tank, infantry, units } = germanAIFixture();
  scene.findMoveBlocker = () => ({});
  assert.equal(scene.executeEnemyAction(tank, 'advance'), 'done');
  assert.equal(infantry.mountedOnUnitId, undefined);
  scene.findMoveBlocker = () => null;
  scene.mission.data.multiRegion = {}; scene.isOutsidePlayerRegion = () => true;
  for (const action of ['advance', 'reverse']) {
    assert.equal(scene.executeEnemyAction(tank, action), 'done');
    assert.equal(scene.anim, null);
    assert.equal(infantry.mountedOnUnitId, tank.id);
    assert.deepEqual({ ...infantry.pos }, { ...tank.pos });
  }
  scene.enemyDiceUsed = [true, true]; scene.enemyDidActThisTurn = true;
  scene.runNextEnemyStep(); assert.equal(infantry.mountedOnUnitId, undefined);
});

test('remote snapshot playback cannot invent a boarding action on the observing PVP peer', () => {
  const { scene, tank, infantry } = fixture();
  GameSession.isPvp = true; tank.controller = 'remote_player';
  scene.playMoveStartSound({ unit: tank, kind: 'move', t: 0 });
  assert.equal(infantry.mountedOnUnitId, undefined);
  tank.controller = 'local_player'; scene.playMoveStartSound({ unit: tank, kind: 'move', t: 0 });
  assert.equal(infantry.mountedOnUnitId, tank.id);
  GameSession.isPvp = false;
});

test('unusable movement dice wait for Misc, while paired turns remain executable in the shared menu', () => {
  const DiceScene = require('./helpers/BattleSceneMethods.cjs')(['playerDieActionItems', 'completePhaseDiceAction'], {
    ...riding, GameSession, classifyMoveDie: () => 'drive', isMainGunLoaded: () => true,
    t: key => key, PHASE_BTN_MOVE: 'move', DIE_ACTION_DOUBLES: 'pair', DIE_ACTION_UNAVAILABLE: 'disabled',
  });
  for (const paired of [false, true]) {
    const { scene: base, tank, infantry, units } = fixture();
    const scene = Object.assign(new DiceScene(), base);
    delete scene.playerDieActionItems;
    riding.autoMountTankForMove(tank, units);
    Object.assign(scene, { phaseDice: paired ? [{ pip: 5 }, { pip: 5 }] : [{ pip: 5 }],
      dieStep: () => 'movement', findDoublesPartner: i => paired ? 1 - i : -1,
      campaignMovementDiceCanReverseDirection: () => false, driveActionUnavailable: () => 'terrain',
      turnActionUnavailable: () => null });
    assert.equal(scene.playerDieActionItems(0).some(item => !item.unavailableReason), paired,
      'paired dice still allow a co-driver turn even when the direct drive is blocked');
    scene.completePhaseDiceAction();
    assert.equal(infantry.mountedOnUnitId, tank.id, 'neither available nor unusable movement dice trigger an early dismount');
  }
});

test('Misc ends and riders dismount only after no executable Misc dice remain; occupied hexes still advance the phase', () => {
  for (const available of [true, false]) {
    const { scene, tank, infantry, units } = fixture(); riding.autoMountTankForMove(tank, units);
    scene.playerStep = 'misc';
    scene.phaseDice = [{ used: false }]; scene.playerDieActionItems = () => [{ unavailableReason: available ? null : 'blocked' }];
    scene.completePhaseDiceAction();
    assert.equal(infantry.mountedOnUnitId, available ? tank.id : undefined);
    assert.equal(!!scene.miscDone, !available);
  }
  const { scene, tank, infantry, units } = fixture(); riding.autoMountTankForMove(tank, units);
  scene.playerStep = 'misc';
  scene.anim = {}; scene.completePhaseDiceAction(); assert.equal(infantry.mountedOnUnitId, tank.id, 'never dismount before arrival');
  scene.anim = null; const ground = unit('ground', 'american_infantry'); units.push(ground);
  scene.completePhaseDiceAction(); assert.equal(infantry.mountedOnUnitId, tank.id);
  assert.equal(scene.miscDone, true); assert.equal(scene.fireChecksStarted, true);
  ground.destroyed = true; scene.phase = 'player'; scene.playerStep = 'misc';
  scene.phaseDice = [{ used: true }]; scene.completePhaseDiceAction();
  assert.equal(infantry.mountedOnUnitId, undefined);
});

test('spent dice and manual phase completion preserve riders through movement/attack until Misc in every mode', () => {
  for (const mode of ['classic', 'hardcore', 'test']) for (const manual of [false, true]) {
    const { scene, tank, infantry, units } = fixture(); GameSession.gameMode = mode;
    riding.autoMountTankForMove(tank, units);
    for (const step of mode === 'test' ? ['attack', 'misc'] : ['movement', 'attack', 'misc']) {
      scene.playerStep = step;
      scene.phaseDice = [{ used: !manual }]; scene.pendingAutoEndStep = manual ? null : step;
      if (manual) scene.endCurrentSubPhase(); else scene.completePhaseDiceAction();
      assert.equal(infantry.mountedOnUnitId, step === 'misc' ? undefined : tank.id, `${mode}: ${step}`);
    }
    assert.equal(scene.miscDone, true); assert.equal(scene.fireChecksStarted, true);
  }
  GameSession.gameMode = 'hardcore';
});

test('main-gun hits, ricochets and misses each trigger one blocked-or-allowed dismount attempt', () => {
  for (const hit of [false, true]) for (const occupied of [false, true]) {
    const { scene, tank, infantry, units } = fixture(); riding.autoMountTankForMove(tank, units);
    if (occupied) units.push(unit('ground', 'american_infantry'));
    scene.applyMainGunAttackResult(tank, { hit, penetrated: false });
    assert.equal(infantry.mountedOnUnitId, occupied ? tank.id : undefined);
  }
});

test('MG actions exclusively target riders and do not transfer a miss or dual-weapon hit to ground infantry', () => {
  for (const hit of [false, true]) {
    const { scene, tank, infantry, units, map } = fixture(); riding.autoMountTankForMove(tank, units);
    const ground = unit('ground', 'american_infantry'); units.unshift(ground);
    const enemy = unit('enemy', 'panzer4'); enemy.sideId = 'enemy'; enemy.pos = { q: 0, r: 1 };
    assert.equal(riding.mountedMachineGunTarget(ground, units), infantry);
    assert.equal(riding.mountedMachineGunTarget(tank, units), infantry);
    assert.equal(combat.canMGAttack({ attacker: enemy, target: ground, map, units }).reason, 'attack.reason.ridersFirst');
    scene.applyMachineGunAttackResult(infantry, { hit }, enemy, [{ hit }, { hit }]);
    assert.equal(!!ground.destroyed, false);
    assert.equal(!!infantry.destroyed, hit);
    if (!hit) assert.equal(infantry.mountedOnUnitId, tank.id, 'ground squad blocks post-attack dismount');
  }
  const { scene, tank, infantry, units } = fixture(); riding.autoMountTankForMove(tank, units);
  scene.applyMachineGunAttackResult(infantry, { hit: false });
  assert.equal(infantry.mountedOnUnitId, undefined, 'a MG miss still causes dismount if the hex is free');
});

test('main-gun destruction kills riders at impact or settlement, leaving ground infantry alive and crediting each kill once', () => {
  for (const earlyImpact of [false, true]) for (const occupied of [false, true]) {
    const { scene, tank: player, units } = fixture();
    const tank = unit('carrier', 'panzer4'), infantry = unit('passengers', 'german_infantry');
    tank.sideId = infantry.sideId = 'enemy'; units.push(tank, infantry);
    riding.autoMountTankForMove(tank, units);
    const ground = unit('ground', 'german_infantry'); ground.sideId = 'enemy';
    if (occupied) units.push(ground);
    delete scene.recordPlayerBattleKill;
    Object.assign(scene, { missionId: 'rider-destruction', registerImpactDestroyWreckVisual() {}, refreshStatusPanel() {},
      redraw: () => riding.syncTankRiders(units) });
    const report = { hit: true, penetrated: true, damageEffect: 'destroyed' };
    if (earlyImpact) {
      assert.equal(scene.applyAttackDestroyedVisualAtImpact(report, player, tank), true);
      assert.equal(infantry.destroyed, true, 'passengers must already be dead before the impact redraw');
    }
    scene.applyMainGunAttackResult(tank, report, player);
    scene.applyMainGunAttackResult(tank, report, player);
    assert.equal(infantry.destroyed, true); assert.equal(infantry.mountedOnUnitId, undefined);
    assert.equal(!!ground.destroyed, false);
    assert.deepEqual({ ...scene.mission.battleStatistics.killsByKind }, { panzer4: 1, german_infantry: 1 });
  }
});

test('HE destruction of a primary or collateral carrier kills riders even when their own HE check misses', () => {
  for (const carrierPrimary of [false, true]) {
    const { scene, tank, infantry, units } = fixture(); riding.autoMountTankForMove(tank, units);
    delete scene.recordPlayerBattleKill;
    const ground = unit('ground', 'american_infantry'); units.push(ground);
    const destroyed = { hit: true, outcome: 'destroyed' }, miss = { hit: false, outcome: 'none' };
    scene.applyHighExplosiveAttackResult(carrierPrimary ? tank : infantry, carrierPrimary ? destroyed : miss,
      carrierPrimary ? [{ target: infantry, report: miss }, { target: ground, report: miss }]
        : [{ target: tank, report: destroyed }, { target: ground, report: miss }]);
    assert.equal(tank.destroyed, true); assert.equal(infantry.destroyed, true);
    assert.equal(infantry.mountedOnUnitId, undefined); assert.equal(!!ground.destroyed, false);
  }
});

test('HE rolls every co-located squad and tank independently, including riders, even when the primary target misses', () => {
  const { scene, tank, infantry, units } = fixture(); riding.autoMountTankForMove(tank, units);
  const ground = unit('ground', 'american_infantry'), secondTank = unit('second-tank', 'sherman');
  const enemy = unit('attacker', 'panzer4'); enemy.sideId = 'enemy'; enemy.pos = { q: 0, r: 1 };
  const officer = unit('officer', 'officer');
  units.push(ground, secondTank, officer, enemy);
  const collateral = scene.rollHighExplosiveCollateralResults(enemy, tank);
  assert.deepEqual(new Set(collateral.map(r => r.target.id)), new Set([infantry.id, ground.id, secondTank.id]));
  assert.equal(new Set(collateral.map(r => r.report)).size, 3, 'each unit receives a separate report');
  officer.pos = { q: 2, r: 2 };
  scene.applyHighExplosiveAttackResult(tank, { hit: false, outcome: 'none' }, [
    { target: infantry, report: { hit: true, outcome: 'none' } },
    { target: ground, report: { hit: true, outcome: 'destroyed' } },
    { target: secondTank, report: { hit: true, outcome: 'paralyzed' } },
  ], enemy);
  assert.equal(ground.destroyed, true); assert.equal(secondTank.paralyzed, true);
  assert.equal(infantry.mountedOnUnitId, undefined, 'dismount checks occupancy after every independent HE result settles');
});
