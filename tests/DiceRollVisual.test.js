const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/view/DiceRollGeometry.ts'), 'utf8');
const loaded = { exports: {} };
new Function('module', 'exports', ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText)(loaded, loaded.exports);
const { projectRoundedDie, restingRoundedDie } = loaded.exports;

test('all six results settle into one front-facing square with the correct pip count', () => {
  for (let pip = 1; pip <= 6; pip++) {
    for (let variant = 0; variant < 12; variant++) {
      const { faces } = projectRoundedDie(pip, 1, 64, variant);
      assert.equal(faces.length, 1);
      assert.equal(faces[0].pip, pip);
      assert.equal(faces[0].pips.length, pip);
      assert.equal(faces[0].shade, 1);
      assert.deepEqual(faces[0].corners, [
        { x: -32, y: -32 }, { x: 32, y: -32 }, { x: 32, y: 32 }, { x: -32, y: 32 },
      ]);
    }
  }
});

test('rolling keeps the resting visual area and a fixed center within the spread tray spacing', () => {
  const area = points => Math.abs(points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.y - p.y * q.x;
  }, 0)) / 2;
  for (const size of [24, 44, 58, 64]) {
    const restingArea = area(restingRoundedDie(size).outline);
    const limit = size * 1.33 / 2;
    for (let pip = 1; pip <= 6; pip++) {
      for (let frame = 0; frame <= 60; frame++) {
        const { faces, outline, surface } = projectRoundedDie(pip, frame / 60, size, pip);
        assert(Math.abs(area(outline) / restingArea - 1) < 1e-8, 'rotation must not make the die visually shrink');
        assert(faces.length >= 1 && faces.length <= 3);
        const values = faces.map(face => face.pip);
        for (const value of values) assert(!values.includes(7 - value), 'opposite faces cannot both face the camera');
        for (const face of faces) {
          assert.equal(face.pips.length, face.pip);
          for (const point of face.pips.flat()) {
            assert(Number.isFinite(point.x) && Number.isFinite(point.y));
            assert(Math.abs(point.x) <= limit);
            assert(Math.abs(point.y) <= limit);
          }
        }
        const corners = [...outline, ...surface.flatMap(patch => patch.corners)];
        assert(outline.length > 4, 'the physical silhouette must retain rounded corners during rotation');
        for (const point of corners) {
          assert(Number.isFinite(point.x) && Number.isFinite(point.y));
          assert(Math.abs(point.x) <= limit);
          assert(Math.abs(point.y) <= limit);
        }
        for (const axis of ['x', 'y']) {
          assert(Math.abs(Math.max(...corners.map(p => p[axis])) + Math.min(...corners.map(p => p[axis]))) < 1e-8);
        }
      }
    }
  }
});

test('rotation changes geometry between former face-change ticks and eases to a continuous stop', () => {
  const a = projectRoundedDie(5, .10, 64, 0);
  const b = projectRoundedDie(5, .11, 64, 0);
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(a, projectRoundedDie(5, .10, 64, 1), 'dice should have distinct rotations');
  const almost = projectRoundedDie(5, .999, 64, 3).faces.find(face => face.pip === 5);
  const final = projectRoundedDie(5, 1, 64, 3).faces[0];
  almost.corners.forEach((p, i) => assert(Math.hypot(p.x - final.corners[i].x, p.y - final.corners[i].y) < .001));
});

test('the last rolling frame and resting body share the rounded silhouette without a corner change', () => {
  for (const size of [24, 44, 64]) {
    const rest = restingRoundedDie(size);
    assert(rest.outline.every(point => Math.abs(point.x) < size / 2 - .01 || Math.abs(point.y) < size / 2 - .01),
      'rounded silhouette must cut away the four sharp square corners');
    for (let pip = 1; pip <= 6; pip++) {
      const nearStop = projectRoundedDie(pip, .9999, size, pip);
      for (const outline of [nearStop.outline, projectRoundedDie(pip, 1, size, pip).outline]) {
        for (const point of outline) {
          assert(Math.min(...rest.outline.map(other => Math.hypot(point.x - other.x, point.y - other.y))) < .001);
        }
      }
    }
  }
});

test('player roll changes only visuals and preserves final results until normal completion', () => {
  const Scene = sceneMethods(['advancePlayerDiceRollAnim']);
  const scene = new Scene();
  const finalPips = [6, 2, 4];
  let refreshes = 0, logs = 0, completed = 0;
  Object.assign(scene, {
    phaseDice: finalPips.map(pip => ({ pip, used: false })),
    playerDiceRollAnim: { t: 0, dur: .5, finalPips, logEntry: {} },
    refreshDiceTray() { refreshes++; }, pushCombatLogEntry() { logs++; },
    beginPlayerDiceSortAnim: () => false, refreshPhaseUI() {}, updateHUD() {}, redraw() {},
    completePhaseDiceAction() { completed++; },
  });
  scene.advancePlayerDiceRollAnim(.1);
  assert.deepEqual(scene.phaseDice.map(slot => slot.pip), finalPips);
  assert.equal(refreshes, 1);
  assert.equal(completed, 0);
  scene.advancePlayerDiceRollAnim(1);
  assert.equal(scene.playerDiceRollAnim, null);
  assert.deepEqual(scene.phaseDice.map(slot => slot.pip), finalPips);
  assert.equal(logs, 1);
  assert.equal(completed, 1);
});

test('player dice gather from their actual spread positions even when already sorted', () => {
  const Scene = sceneMethods(['playerDiceSlotX', 'beginPlayerDiceSortAnim'], {
    BattleScene: { DICE_TRAY_SLOT: 58, DICE_TRAY_GAP: 10, PLAYER_DICE_SORT_DUR: .5 },
  });
  for (const pips of [[1, 2, 6], [6, 1, 2]]) {
    const scene = new Scene();
    scene.phaseDice = pips.map(pip => ({ pip, used: false }));
    scene.diceVisuals = pips.map((_, i) => ({ root: { position: { x: scene.playerDiceSlotX(i, pips.length, true) } } }));
    const startsByPip = new Map(pips.map((pip, i) => [pip, scene.diceVisuals[i].root.position.x]));
    assert.equal(scene.beginPlayerDiceSortAnim(), true);
    assert.deepEqual(Array.from(scene.phaseDice, slot => slot.pip), [1, 2, 6]);
    assert.deepEqual(Array.from(scene.playerDiceSortAnim.fromX), [1, 2, 6].map(pip => startsByPip.get(pip)));
    assert.deepEqual(Array.from(scene.playerDiceSortAnim.toX), [-68, 0, 68]);
    assert(scene.playerDiceSortAnim.fromX.some((x, i) => x !== scene.playerDiceSortAnim.toX[i]));
  }
});

test('enemy dice remain spread through the roll and gather into execution order afterward', () => {
  const Scene = sceneMethods(['playerDiceSlotX', 'applyEnemyDiceSortLayout'], {
    BattleScene: { DICE_TRAY_SLOT: 58, DICE_TRAY_GAP: 10 },
  });
  const scene = new Scene(), positions = [];
  Object.assign(scene, {
    enemyTrayMetrics: { count: 3, rowY: 0 },
    enemyDiceSortAnim: { t: 0, dur: 1, rollDur: .5, fromSlot: [0, 1, 2], toSlot: [2, 0, 1] },
    enemyDiceTrayDieRoots: Array.from({ length: 3 }, (_, i) => ({ isValid: true, setPosition(x, y) { positions[i] = { x, y }; } })),
  });
  scene.applyEnemyDiceSortLayout(0);
  assert.deepEqual(positions, [{ x: -85, y: 0 }, { x: 0, y: 0 }, { x: 85, y: 0 }]);
  scene.applyEnemyDiceSortLayout(.5);
  assert.deepEqual(positions, [{ x: -8.5, y: 0 }, { x: -34, y: 0 }, { x: 42.5, y: 0 }]);
  scene.applyEnemyDiceSortLayout(1);
  assert.deepEqual(positions, [{ x: 68, y: 0 }, { x: -68, y: 0 }, { x: 0, y: 0 }]);
});

test('modal roll renders into the existing Graphics without moving its node or retaining old dots', () => {
  const Graphics = Symbol('Graphics'), UITransform = Symbol('UITransform');
  const Scene = sceneMethods(['setDieLabelFace'], { Graphics, UITransform, DICE_DIE_FILL: {}, DICE_DIE_BORDER: {}, DICE_DIE_TEXT: {} });
  const scene = new Scene();
  let clears = 0, oldDotClears = 0, calls = [];
  const body = { clear() { clears++; } };
  const label = { string: '?', node: { parent: {
    getComponent(type) { return type === Graphics ? body : { contentSize: { width: 48, height: 48 } }; },
    getChildByName: () => ({ getComponent: () => ({ clear() { oldDotClears++; } }) }),
  } } };
  scene.drawRollingDie = (...args) => calls.push(args);
  scene.setDieLabelFace(label, 6, .4, 3);
  assert.equal(clears, 1);
  assert.equal(oldDotClears, 1);
  assert.equal(label.string, '');
  assert.deepEqual(calls[0].slice(0, 5), [body, 48, 6, .4, 3]);
});
