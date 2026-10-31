const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText, file);
const combat = require('../assets/scripts/core/Combat.ts');
const traverse = require('../assets/scripts/core/TurretTraverse.ts');
const types = require('../assets/scripts/core/types.ts');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
const report = () => ({ dice: [3, 0], hitDiceCount: 1, hitBonus: 0, roll: 3, threshold: 4, hit: false });
const noop = () => {};
let maxRoll = 6;
const AttackScene = sceneMethods([
  'tryMGAttack', 'tryAIMGAttack', 'startShermanMachineGunAim', 'startEnemyMachineGunAim',
], { ...traverse, ...require('../assets/scripts/core/TankRiding.ts'), GameSession: { gameMode: 'hardcore' },
  canMGAttack: () => ({ ok: true }), getGameModeConfig: () => ({ expandedTurretDirections: true }),
  markAmbushAction: noop, markAmbushTargeted: noop, finishLockedFireAttack: noop,
  maxMGHitRoll: () => maxRoll, mgHitThreshold: () => 4, mgHitBreakdown: () => ({}), mgHitThresholdModifierDetails: () => [],
  rollMGAttack: ctx => { assert.equal(ctx.tankMachineGun, 'hull'); return report(); },
  t: k => k, unitDisplayName: k => k, Color: class {}, HexMap: { keyOf: () => '0,0' },
});

function attackFixture() {
  const scene = new AttackScene();
  const actor = { id: 'tank', kind: 'sherman', pos: { q: 0, r: 0 }, facing: 0, turretFacing: 2,
    stats: { visionType: 'turreted', turretTraverseSpeed: 2 } };
  const target = { id: 'infantry', kind: 'infantry', pos: { q: 1, r: 0 } };
  const selection = unit => combat.selectTankMachineGun(unit, 0,
    traverse.limitTurretTraverse(unit.turretFacing, 0, unit.stats.turretTraverseSpeed).reached);
  Object.assign(scene, { mission: { sherman: actor, data: {}, map: {} }, phase: 'enemy', outcome: 'ongoing',
    playerStep: 'attack', selectedMGDieIdx: 0, phaseDice: [{ used: false }], transientFogRevealKeys: new Set(),
    allUnits: () => [actor, target], currentWeather: noop, tankMachineGunSelection: selection,
    tankMachineGunContext: (_a, _t, chosen) => ({ tankMachineGun: chosen.weapon }),
    currentTurretFacingFor: u => u.turretFacing, turretTargetDirection: () => 0,
    startShermanTurretAimDirection: (direction, done) => { actor.turretFacing = direction; done(); },
    beginTurretAimAnim: anim => { anim.unit.turretFacing = anim.to; anim.onDone(); },
    selectAIMGTarget: () => target, isUnitVisible: () => true, combatLogUnitTone: () => 'enemy',
    startDiceShow: (r, _a, _t, _done, opts) => { scene.presentation = opts; },
    playMachineGunFireCue: (_a, _t, _hit, weapon) => { scene.directWeapon = weapon; },
    sendPvpActionResult: (_type, details) => { scene.pvpDetails = details; },
    computeOutcome: () => 'ongoing', recordSettledBattleAttack: noop, applyMachineGunAttackResult: noop,
    hideTurretTargetOverlayForCommittedAction: noop, mgDiceExpr: () => '', battleLogI18n: noop,
    usePhaseDice: noop, spawnFloater: noop, refreshPhaseUI: noop, updateHUD: noop, redraw: noop,
    refreshStatusPanel: noop, completePhaseDiceAction: noop, scheduleOnce: noop,
  });
  return { scene, actor, target, selection };
}

for (const ai of [false, true]) for (const impossible of [false, true]) {
  test(`${ai ? 'AI' : 'player'} preserves hull-only weapon after partial traverse (${impossible ? 'impossible roll' : 'dice presentation'})`, () => {
    maxRoll = impossible ? 3 : 6;
    const { scene, actor, target, selection } = attackFixture();
    assert.equal(selection(actor).weapon, 'hull', 'initial attack can only use the hull gun');
    if (ai) scene.tryAIMGAttack(actor);
    else scene.tryMGAttack(target);
    assert.notEqual(actor.turretFacing, 0, 'turret still has not reached the target');
    assert.equal(selection(actor).weapon, 'both', 'reselecting would incorrectly grant another traverse');
    if (impossible) {
      assert.equal(scene.directWeapon, 'hull');
      if (!ai) assert.equal(scene.pvpDetails.tankMachineGun, 'hull');
    } else {
      assert.equal(scene.presentation.tankMachineGun, 'hull');
      assert.equal(scene.presentation.secondaryMGReport, undefined);
      if (!ai) {
        scene.presentation.onHold();
        assert.equal(scene.pvpDetails.tankMachineGun, 'hull');
      }
    }
  });
}

const CueScene = sceneMethods(['playMachineGunFireCue'], {
  ...types, selectTankMachineGun: combat.selectTankMachineGun, fireDirectionTo: () => 0, playMgFire: noop,
});
test('legacy cues check present alignment without allowing another turret traverse', () => {
  const scene = new CueScene(), bursts = [];
  const { actor, target } = attackFixture(); actor.turretFacing = 1;
  Object.assign(scene, { canHearBattleAt: () => false, rememberAttackPosition: noop,
    currentTurretFacingFor: u => u.turretFacing, spawnMachineGunBurst: (...args) => bursts.push(args[4]),
    tankMachineGunSelection: () => assert.fail('legacy VFX must not predict a future turn'),
  });
  scene.playMachineGunFireCue(actor, target, false);
  assert.deepEqual(bursts, ['hull']);
});

const PresentationScene = sceneMethods([
  'startDiceShow', 'advanceDiceShow', 'playAttackFireCue', 'playMachineGunFireCue',
], { isTankUnit: () => true, isFootUnit: () => false, fireDirectionTo: () => 0,
  selectTankMachineGun: () => assert.fail('snapshot must survive through presentation'),
  playMgFire: noop, playDiceRoll: noop, t: k => k,
  DICE_CYCLE_INTERVAL: 0.1, DICE_ROLL_DUR: 1, DICE_HIT_SHOW_DUR: 0.5, FOG_ATTACK_REVEAL_DURATION: 1,
  DICE_FAIL_TEXT: 'miss', DICE_OK_TEXT: 'hit', HexMap: { keyOf: () => '0,0' },
});
for (const path of ['panel', 'automatic', 'fog']) {
  test(`weapon snapshot reaches actual burst dispatch through ${path} presentation`, () => {
    for (const weapon of ['hull', 'coaxial', 'both']) {
      const scene = new PresentationScene(), bursts = [];
      const { actor, target } = attackFixture(); actor.turretFacing = 1;
      Object.assign(scene, { transientFogRevealKeys: new Set(), firedAttackCueReports: new WeakSet(),
        destroyTurnEndEventUI: noop, destroyFireCheckEventUI: noop, closeDiePopover: noop,
        isUnitOutsideFog: () => path !== 'fog', redraw: noop, scheduleOnce: noop,
        canHearBattleAt: () => false, rememberAttackPosition: noop, setInfantryVisualFacing: noop,
        liftEnemyDiceTrayIntoDiceShowIfNeeded: noop, setDieLabelFace: noop, revealSecondaryMachineGunResult: noop,
        spawnMachineGunBurst: (...args) => bursts.push(args[4]),
        buildDiceShowPanel: () => ({ root: {}, hitDieLabels: [{}], hitSumLabel: {}, hitVerdictLabel: {} }),
      });
      scene.startDiceShow(report(), 'tank', 'infantry', noop, {
        mg: true, tankMachineGun: weapon, attacker: actor, target, autoResolveWithoutPanel: path === 'automatic',
      });
      if (path === 'panel') {
        assert.equal(bursts.length, 0, 'panel defers fire until the roll is revealed');
        scene.advanceDiceShow(1);
      }
      assert.deepEqual(bursts, weapon === 'both' ? ['coaxial', 'hull'] : [weapon]);
    }
  });
}

test('PvP playback keeps the transmitted hull-only attack even if the current turret is aligned', () => {
  const RemoteScene = sceneMethods(['playPvpRemoteActionCue', 'playMachineGunFireCue'], {
    ...types, selectTankMachineGun: () => assert.fail('remote attack must use its transmitted weapon'),
    fireDirectionTo: () => 0, playMgFire: noop, Color: class {}, t: k => k,
  });
  const scene = new RemoteScene(), bursts = [];
  const { actor, target } = attackFixture(); actor.turretFacing = 0;
  Object.assign(scene, { mission: { sherman: actor }, allUnits: () => [actor, target],
    recordSettledBattleAttack: noop, setInfantryVisualFacing: noop, redraw: noop, spawnFloater: noop,
    canHearBattleAt: () => false, rememberAttackPosition: noop,
    spawnMachineGunBurst: (...args) => bursts.push(args[4]),
  });
  scene.playPvpRemoteActionCue({ details: {
    type: 'machine_gun', attackerId: actor.id, targetId: target.id, tankMachineGun: 'hull', hit: false,
  } });
  assert.deepEqual(bursts, ['hull']);
});
