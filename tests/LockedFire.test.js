const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const rules = require('../assets/scripts/core/LockedFire.ts');
const combat = require('../assets/scripts/core/Combat.ts');
const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const types = require('../assets/scripts/core/types.ts');
const source = fs.readFileSync(require.resolve('../assets/scripts/view/BattleScene.ts'), 'utf8');
const ast = ts.createSourceFile('BattleScene.ts', source, ts.ScriptTarget.Latest, true);
const sceneClass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'BattleScene');
function sceneMethods(names, deps) {
  const code = ts.transpile(`class Scene { ${names.map(name => sceneClass.members.find(n => n.name?.getText(ast) === name).getText(ast)).join('\n')} }`, { target: ts.ScriptTarget.ES2020 });
  return new (new Function(...Object.keys(deps), `${code}; return Scene;`)(...Object.values(deps)))();
}
function fixture() {
  const tank = (id, sideId, q) => ({ id, kind: 'sherman', faction: 'usa', sideId, pos: { q, r: 0 }, facing: 0,
    turretFacing: 0, stats: { size: 4, visionType: 'turreted', penetration: 0,
      armorFront: 30, armorSide: 30, armorRear: 30, highExplosivePower: 0 } });
  const attacker = tank('player', 'player', 0), target = tank('enemy', 'enemy', 1);
  const map = new HexMap(4, 4);
  for (let q = 0; q < 4; q++) map.set({ pos: { q, r: 0 }, terrain: 'field' });
  return { attacker, target, map, lockedFire: true };
}
function sceneRoll(name, ctx, mode = 'hardcore') {
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  const code = ts.transpile(node.getText(ast), { target: ts.ScriptTarget.ES2020 });
  const deps = { GameSession: { gameMode: mode }, ...rules, rollMainGunAttack: combat.rollAttack, rollHEAttack: combat.rollHighExplosiveAttack };
  const report = new Function(...Object.keys(deps), `${code}; return ${name};`)(...Object.values(deps))(ctx, { d6: () => 3 });
  // Ordinary shots pre-roll before aiming; their aim callback commits the hit.
  if (mode === 'hardcore') assert.equal(ctx.attacker.lockedFireTargetId, undefined);
  rules.finishLockedFireAttack(ctx.attacker, ctx.target, report.hit, mode === 'hardcore');
  return report;
}

test('AP hit without penetration locks; bonus is consumed on a miss and renewed on a hit', () => {
  const ctx = fixture();
  const first = sceneRoll('rollAttack', ctx);
  assert.equal(first.hit, true);
  assert.equal(first.penetrated, false);
  assert.equal(ctx.attacker.lockedFireTargetId, ctx.target.id);
  const second = sceneRoll('rollAttack', ctx);
  assert.equal(second.threshold, first.threshold - 2);
  assert(second.hitModifiers.some(m => m.labelKey === 'dice.rule.lockedFire' && m.value === -2));
  assert.equal(ctx.attacker.lockedFireTargetId, ctx.target.id);
  rules.finishLockedFireAttack(ctx.attacker, ctx.target, false, true);
  assert.equal(combat.hitThreshold(ctx), first.threshold);
});

test('HE and enemy tanks acquire locks; smoke, friendly tanks and non-tanks do not', () => {
  const ctx = fixture();
  const he = sceneRoll('rollHighExplosiveAttack', { ...ctx, shellType: 'he' });
  assert.equal(he.hit, true);
  assert.equal(ctx.attacker.lockedFireTargetId, ctx.target.id);
  assert.equal(combat.hitThreshold({ ...ctx, shellType: 'smoke' }), 5);
  rules.finishLockedFireAttack(ctx.attacker, ctx.target, true, true, 'smoke');
  assert.equal(ctx.attacker.lockedFireTargetId, undefined);
  rules.finishLockedFireAttack(ctx.target, ctx.attacker, true, true);
  assert.equal(rules.lockedFireModifier(ctx.target, ctx.attacker, true), -2);
  for (const kind of ['german_infantry', 'pak38', 'heavy_artillery']) {
    rules.finishLockedFireAttack(ctx.attacker, { ...ctx.target, kind }, true, true);
    assert.equal(ctx.attacker.lockedFireTargetId, undefined);
  }
  rules.finishLockedFireAttack(ctx.attacker, { ...ctx.target, sideId: 'player' }, true, true);
  assert.equal(ctx.attacker.lockedFireTargetId, undefined);
  sceneRoll('rollAttack', ctx, 'classic');
  assert.equal(ctx.attacker.lockedFireTargetId, undefined);
});

test('only the locked target gets the bonus, precision stacks, MG consumes without reacquiring', () => {
  const ctx = fixture();
  rules.finishLockedFireAttack(ctx.attacker, ctx.target, true, true);
  assert.equal(combat.hitThreshold({ ...ctx, lockedFire: false }), 5);
  assert.equal(combat.hitThreshold({ ...ctx, hitThresholdModifier: -2 }), 1);
  const other = { ...ctx.target, id: 'other' };
  assert.equal(combat.hitThreshold({ ...ctx, target: other }), 5);
  const mg = combat.rollSelectedTankMachineGunAttacks({ ...ctx, hardcoreTankMachineGuns: true, tankMachineGun: 'both' }, { d6: () => 3 });
  assert(mg.every(m => m.report.threshold === 3));
  rules.finishLockedFireAttack(ctx.attacker, ctx.target, true, true, 'mg');
  assert.equal(ctx.attacker.lockedFireTargetId, undefined);
  rules.finishLockedFireAttack(ctx.attacker, ctx.target, true, true);
  rules.finishLockedFireAttack(ctx.attacker, other, false, true);
  assert.equal(ctx.attacker.lockedFireTargetId, undefined);
});

test('hull animation and turret animation cancel locks; unchanged automatic aim retains them', () => {
  const ctx = fixture();
  const scene = sceneMethods(['beginTankTrackAnimation', 'beginTurretAimAnim', 'startShermanTurretAimDirection'], {
    ...rules, ...types, axialEquals: (a, b) => a.q === b.q && a.r === b.r,
    startTurretTraverseSound: () => {}, turretTraverseAnimationDuration: () => 1,
  });
  Object.assign(scene, { mission: { sherman: ctx.attacker }, shermanTurretFacing: 0,
    redraw: () => {}, enemySupportsSplitTurret: () => false,
    project: () => ({ x: 0, y: 0 }), directionScreenAngle: () => 0, turretTraverseSpeedFor: () => 1,
    addTankTrack: () => null, addTankTurnTrack: () => null });
  ctx.attacker.turretVisualTarget = { ...ctx.target.pos };
  rules.finishLockedFireAttack(ctx.attacker, ctx.target, true, true);
  scene.startShermanTurretAimDirection(0, () => {}, ctx.target.pos);
  assert.equal(ctx.attacker.lockedFireTargetId, ctx.target.id);
  scene.startShermanTurretAimDirection(1, () => {});
  assert.equal(ctx.attacker.lockedFireTargetId, undefined);
  for (const kind of ['move', 'turn']) {
    rules.finishLockedFireAttack(ctx.attacker, ctx.target, true, true);
    scene.beginTankTrackAnimation({ unit: ctx.attacker, kind });
    assert.equal(ctx.attacker.lockedFireTargetId, undefined);
  }
  rules.finishLockedFireAttack(ctx.attacker, ctx.target, true, true);
  scene.beginTurretAimAnim({ unit: ctx.attacker, from: 0, to: 1, dur: 1 });
  assert.equal(ctx.attacker.lockedFireTargetId, undefined);
});

test('reticle follows visible target positions and hides after expiry, destruction or classic mode', () => {
  const ctx = fixture(), GameSession = { gameMode: 'hardcore' };
  const scene = sceneMethods(['drawLockedFireReticles'], { ...types, GameSession, Color: class {} });
  let visible = true;
  Object.assign(scene, { mission: {}, hexSize: 50, unitEffectTime: 0, allUnits: () => [ctx.attacker, ctx.target],
    isUnitVisible: () => visible, interpolatedPos: u => ({ x: u.pos.q * 50, y: u.pos.r * 50 }) });
  const circles = [];
  const g = { circle: (x, y) => circles.push([x, y]), stroke: () => {}, moveTo: () => {}, lineTo: () => {} };
  rules.finishLockedFireAttack(ctx.attacker, ctx.target, true, true);
  scene.drawLockedFireReticles(g);
  assert.deepEqual(circles, [[50, 0]]);
  for (const state of ['fog', 'destroyed', 'classic', 'expired']) {
    circles.length = 0;
    visible = state !== 'fog'; ctx.target.destroyed = state === 'destroyed';
    GameSession.gameMode = state === 'classic' ? 'classic' : 'hardcore';
    if (state === 'expired') rules.clearLockedFire(ctx.attacker);
    scene.drawLockedFireReticles(g);
    assert.equal(circles.length, 0);
  }
});

test('player turn end and full round end clear aim memory, including enemy reaction locks', () => {
  const ctx = fixture();
  const scene = sceneMethods(['continueAfterPlayerFireCheck', 'endEnemyPhase'], {
    ...rules, endAmbushTurn: () => {}, GameSession: { isPvp: true },
  });
  Object.assign(scene, { mission: { sherman: ctx.attacker }, hasSmokeAt: () => false,
    computeOutcome: () => 'victory', updateOutcomeOverlay: () => {}, refreshPhaseUI: () => {},
    updateHUD: () => {}, redraw: () => {}, pauseAIFlowForCombatLogReplay: () => false,
    allUnits: () => [ctx.attacker, ctx.target], enterPvpWaitingForOpponent: () => {} });
  rules.finishLockedFireAttack(ctx.attacker, ctx.target, true, true);
  scene.continueAfterPlayerFireCheck();
  assert.equal(ctx.attacker.lockedFireTargetId, undefined);
  rules.finishLockedFireAttack(ctx.attacker, ctx.target, true, true);
  rules.finishLockedFireAttack(ctx.target, ctx.attacker, true, true);
  scene.endEnemyPhase();
  assert.equal(ctx.attacker.lockedFireTargetId, undefined);
  assert.equal(ctx.target.lockedFireTargetId, undefined);
});

test('save round-trip preserves each shooter lock; old saves clear stale locks', () => {
  const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
  const ctx = fixture();
  const mission = { sherman: ctx.attacker, playerTank: ctx.attacker, enemies: [ctx.target], allies: [],
    map: ctx.map, smokeHexes: new Set(), smokeHexOwners: new Map(), data: {} };
  rules.finishLockedFireAttack(ctx.attacker, ctx.target, true, true);
  rules.finishLockedFireAttack(ctx.target, ctx.attacker, true, true);
  const save = JSON.parse(JSON.stringify(captureSave({ mission, missionId: 'test', gameMode: 'hardcore',
    turn: 1, phase: 'player', movesLeft: 0, attacksLeft: 1, miscDone: false,
    playerStep: 'attack', hatchChangedThisTurn: false, phaseDice: [] })));
  rules.clearLockedFire(ctx.attacker); rules.clearLockedFire(ctx.target);
  assert.equal(applySave(mission, 'test', save).ok, true);
  assert.equal(ctx.attacker.lockedFireTargetId, ctx.target.id);
  assert.equal(ctx.target.lockedFireTargetId, ctx.attacker.id);
  delete save.playerTank.lockedFireTargetId;
  delete save.sherman.lockedFireTargetId;
  delete save.enemies[0].lockedFireTargetId;
  assert.equal(applySave(mission, 'test', save).ok, true);
  assert.equal(ctx.attacker.lockedFireTargetId, undefined);
  assert.equal(ctx.target.lockedFireTargetId, undefined);
});
