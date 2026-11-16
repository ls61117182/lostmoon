const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const test = require('node:test');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');

require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, filename);
};

const types = require('../assets/scripts/core/types.ts');
const ambush = require('../assets/scripts/core/Ambush.ts');
const { nonPlayerTankWeaponForTarget } = require('../assets/scripts/core/Combat.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { hexDistance, HexMap } = require('../assets/scripts/core/HexGrid.ts');

function setup({ player = false, targetKind = 'sherman', loadedShell = 'he', hit = true } = {}) {
  const watcher = {
    id: 'watcher', kind: 'panzer4_f', sideId: player ? 'player' : 'enemy',
    faction: player ? 'usa' : 'german', pos: { q: 0, r: 0 }, facing: 0,
    stats: getUnitStats('panzer4_f', 'europe'), loaded: true, loadedShell,
    reloadProgress: 1, ambushReadyThisTurn: true,
  };
  const mover = {
    id: 'mover', kind: targetKind, sideId: player ? 'enemy' : 'player',
    faction: player ? 'german' : 'usa', pos: { q: 1, r: 0 },
  };
  const apReport = { dice: [3, 4], roll: 7, threshold: 6, hit, penetrated: false };
  const heReport = { dice: [3, 4], roll: 7, threshold: 6, hit,
    outcome: hit ? 'fire' : 'none', effectRoll: 4, fireThreshold: 3, paralyzeThreshold: 5 };
  const events = [], logs = [], shots = [];
  let pending;
  const Scene = sceneMethods(['tryResolveAmbushAfterMove', 'presentAttackResult', 'combatLogIsVisible'], {
    ...types, ...ambush, nonPlayerTankWeaponForTarget, hexDistance, HexMap,
    GameSession: { gameMode: 'test' }, getGameModeConfig: () => ({}),
    isInAmbushSight: () => true, canAttack: ctx => {
      events.push(['validate', ctx.shellType]); return { ok: true };
    },
    rollAttack: ctx => { events.push(['roll', ctx.shellType]); return apReport; },
    rollHighExplosiveAttack: ctx => { events.push(['roll', ctx.shellType]); return heReport; },
    finishLockedFireAttack: () => {}, unitDisplayName: kind => kind,
    t: key => key, Color: class {},
  });
  const scene = Object.assign(new Scene(), {
    mission: { sherman: player ? watcher : mover, map: {}, data: {} }, outcome: 'ongoing',
    allUnits: () => [watcher, mover], ambushGunnerSightKeys: () => new Set(),
    currentTurretFacingFor: () => 0, currentWeather: () => 'clear',
    protagonistForAttackTarget: () => mover,
    startShermanTurretAim: (_, done) => done(), startEnemyTurretAim: (_, __, done) => done(),
    battleLog: () => {}, battleLogI18n: (key, params, replay) => logs.push({ key, params, replay }),
    combatLogUnitTone: unit => unit.sideId,
    spawnFloater: () => {}, penDiceExpr: () => '1',
    rollHighExplosiveCollateralResults: () => [], highExplosivePanelReport: () => apReport,
    applyHighExplosiveAttackResult: () => events.push(['apply', 'he']),
    applyMainGunAttackResult: () => events.push(['apply', 'ap']),
    computeOutcome: () => 'ongoing', refreshStatusPanel: () => {}, updateHUD: () => {}, redraw: () => {},
    startDiceShow: (report, actor, target, done, opts) => {
      // As in the real cue, capture ammunition before impact unloads the gun.
      shots.push(opts.highExplosiveReport ? 'he' : types.resolvedLoadedShell(opts.attacker));
      pending = { done, opts };
    },
  });
  return { scene, watcher, mover, events, logs, shots, apReport, heReport, pending: () => pending };
}

for (const loadedShell of ['he', 'ap', null]) for (const hit of [true, false]) {
  test(`AI Panzer IV F ambush uses AP against Sherman with stored ${loadedShell}, hit=${hit}`, () => {
    const h = setup({ loadedShell, hit });
    let resumed = 0;
    assert.equal(h.scene.tryResolveAmbushAfterMove(h.mover, () => resumed++), true);
    assert.equal(h.events[0][1], 'ap', 'eligibility must use the chosen AP round');
    assert.equal(h.events[1][1], 'ap', 'combat must resolve AP');
    assert.deepEqual(h.shots, ['ap'], 'visual ammunition must agree with combat');
    h.pending().done();
    assert.equal(h.logs.length, 1);
    assert.equal(h.scene.combatLogIsVisible(h.logs[0]), true);
    assert.equal(h.logs[0].replay.report, h.apReport);
    assert.equal(h.logs[0].replay.attackerKind, 'panzer4_f');
    assert.equal(h.logs[0].replay.targetKind, 'sherman');
    assert.equal(h.watcher.loadedShell, null);
    assert.equal(h.watcher.ambushReadyThisTurn, false);
    assert.equal(resumed, 1);
  });
}

for (const player of [true, false]) for (const hit of [true, false]) {
  test(`${player ? 'player' : 'AI'} HE ambush records one visible replay, hit=${hit}`, () => {
    // Trucks remain HE targets for AI; a player keeps their explicitly loaded HE against a tank.
    const h = setup({ player, targetKind: player ? 'panzer4' : 'truck', hit });
    let resumed = 0;
    assert.equal(h.scene.tryResolveAmbushAfterMove(h.mover, () => resumed++), true);
    assert.deepEqual(h.shots, ['he']);
    const { opts, done } = h.pending();
    opts.onHold();
    assert.equal(h.logs.length, hit ? 0 : 1, 'hits wait for impact; misses settle on hold');
    if (hit) opts.onHighExplosiveImpact();
    assert.equal(h.logs.length, 1, 'record is available as soon as the result settles');
    assert.equal(resumed, 0, 'next movement/ambush waits for presentation completion');
    done();
    assert.equal(h.logs.length, 1, 'completion must not log or apply twice');
    assert.equal(h.events.filter(event => event[0] === 'apply').length, 1);
    const entry = h.logs[0];
    assert.equal(h.scene.combatLogIsVisible(entry), true);
    assert.equal(entry.key, 'battleLog.combat.heResult');
    assert.equal(entry.replay.highExplosiveReport, h.heReport);
    assert.equal(entry.replay.report, h.apReport);
    assert.equal(entry.replay.highExplosiveCollateral.length, 0);
    assert.equal(entry.params.resultKey, hit ? 'dmg.outcome.fire' : 'dice.panel.outcomeMiss');
    assert.equal(h.watcher.loaded, false);
    assert.equal(h.watcher.loadedShell, null);
    assert.equal(h.watcher.reloadProgress, 0);
    assert.equal(h.scene.resolvingAmbush, false);
    assert.equal(resumed, 1);
  });
}
