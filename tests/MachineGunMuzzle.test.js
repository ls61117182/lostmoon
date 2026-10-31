const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText, file);
const visuals = require('../assets/scripts/core/TankVisualDB.ts');
const geometry = require('../assets/scripts/view/MachineGunBurstGeometry.ts');
const types = require('../assets/scripts/core/types.ts');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const nearPoint = (a, b) => { near(a.x, b.x); near(a.y, b.y); };

test('PNG coordinates round-trip under rotation, nonuniform scale and offsets', () => {
  for (let deg = 0; deg < 360; deg += 15) {
    const t = { originX: 143, originY: -27, anchorX: 72, anchorY: 45,
      scaleX: 0.71, scaleY: 1.23, ux: Math.cos(deg * Math.PI / 180), uy: Math.sin(deg * Math.PI / 180) };
    for (const point of [{ x: 0, y: 34.5 }, { x: 12.25, y: 23.75 }, { x: 120, y: 67 }]) {
      nearPoint(geometry.machineGunSpriteCoordinates(geometry.machineGunSpritePoint(point.x, point.y, t), t), point);
    }
  }
  const t = { originX: 10, originY: 20, anchorX: 50, anchorY: 30, scaleX: 2, scaleY: 3, ux: 1, uy: 0 };
  nearPoint(geometry.machineGunSpritePoint(40, 35, t), { x: 30, y: 35 });
});

const Scene = sceneMethods(['machineGunMuzzlePosition', 'splitTankMuzzlePosition', 'splitTankTurretPivot', 'topSpriteMuzzlePosition'], {
  ...visuals, ...geometry,
  isSplitTankKind: kind => visuals.SPLIT_TANK_KINDS.includes(kind),
  tankVisualConfigOf: kind => ({ ...visuals.tankVisualConfigOf(kind),
    coaxialMuzzleSpriteX: 20.5, coaxialMuzzleSpriteY: 18.25, hullMuzzleSpriteX: 15.75, hullMuzzleSpriteY: 36.5 }),
});

test('coaxial port follows turret; hull port stays fixed while turret turns, for player and AI', () => {
  for (const kind of visuals.SPLIT_TANK_KINDS.filter(types.isTankKind)) {
    const u = { kind, pos: { q: 0, r: 0 } };
    const cfg = visuals.splitTankVisualConfigOf(kind), g = visuals.splitTankGeometryConfigOf(kind);
    const scene = new Scene();
    let angle = 0;
    Object.assign(scene, { hexSize: 80, mission: { sherman: u }, project: () => ({ x: 100, y: 70 }),
      topDownForwardVec: (_u, _c, lerp) => lerp ? { ux: Math.cos(angle), uy: Math.sin(angle) } : { ux: 1, uy: 0 },
      currentShermanTurretLerp: () => ({}), currentEnemyTurretLerp: () => ({}),
    });
    const scale = 80 * 1.8 * cfg.hullFitScale / Math.max(g.topTrim.w, g.topTrim.h);
    const expectedHull = { x: 100 + cfg.hullOffsetForward * 80 * Math.sqrt(3)
      + (g.topTrim.x + g.topTrim.w / 2 - 15.75) * scale,
      y: 70 - cfg.hullOffsetRight * 80 * Math.sqrt(3) + (36.5 - g.topTrim.y - g.topTrim.h / 2) * scale };
    for (const player of [true, false]) {
      scene.mission.sherman = player ? u : {};
      const pivot = scene.splitTankTurretPivot(u, { x: 100, y: 70 }, cfg, g);
      for (angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        nearPoint(scene.machineGunMuzzlePosition(u, 'hull'), expectedHull);
        const forward = (g.pivot.spriteX - 20.5) * scale * cfg.turretScale + cfg.turretOffsetForward * 80 * Math.sqrt(3);
        const right = (g.pivot.spriteY - 18.25) * scale * cfg.turretScale + cfg.turretOffsetRight * 80 * Math.sqrt(3);
        nearPoint(scene.machineGunMuzzlePosition(u, 'coaxial'), {
          x: pivot.x + forward * Math.cos(angle) + right * Math.sin(angle),
          y: pivot.y + forward * Math.sin(angle) - right * Math.cos(angle),
        });
      }
    }
  }
});

test('fixed-gun ports use full-sprite scale, aspect ratio, body angle and offsets', () => {
  const scene = new Scene(), u = { kind: 'jagdtiger', pos: { q: 0, r: 0 } };
  Object.assign(scene, { hexSize: 70, project: () => ({ x: 60, y: -10 }),
    topDownForwardVec: () => ({ ux: 0, uy: 1 }), tankTopMetaFor: () => ({ dw: 200, dh: 100, sf: {} }),
  });
  const cfg = visuals.tankVisualConfigOf(u.kind), s = 70 * 1.8 * cfg.fitScale / 200, k = Math.sqrt(cfg.aspectRatioMul);
  nearPoint(scene.machineGunMuzzlePosition(u, 'coaxial'), {
    x: 60 + cfg.offsetRight * 70 * Math.sqrt(3) + (50 - 18.25) * s / k,
    y: -10 + cfg.offsetForward * 70 * Math.sqrt(3) + (100 - 20.5) * s * k,
  });
});

test('uncalibrated port returns null so legacy defaults remain available', () => {
  const DefaultScene = sceneMethods(['machineGunMuzzlePosition'], { ...geometry,
    tankVisualConfigOf: () => ({ coaxialMuzzleSpriteX: 0, coaxialMuzzleSpriteY: 0, hullMuzzleSpriteX: 0, hullMuzzleSpriteY: 0 }),
  });
  const scene = new DefaultScene();
  for (const kind of visuals.TANK_VISUAL_KINDS) for (const weapon of ['coaxial', 'hull']) {
    assert.equal(scene.machineGunMuzzlePosition({ kind }, weapon), null);
  }
});

class Node { addComponent() { return { setContentSize() {}, setAnchorPoint() {} }; } setPosition() {} }
test('burst starts exactly at calibrated port and aims from that port at the target', () => {
  const BurstScene = sceneMethods(['spawnMachineGunBurst'], { ...geometry, Node, UITransform: class {}, Graphics: class {} });
  const scene = new BurstScene(), u = { id: 'a', pos: { q: 0, r: 0 } }, target = { id: 'b', pos: { q: 2, r: 1 } };
  Object.assign(scene, { hexSize: 60, mapNode: { addChild() {} }, node: {}, machineGunBursts: [],
    project: (q, r) => ({ x: q * 100, y: r * 100 }), isUnitVisible: () => true,
    machineGunMuzzlePosition: () => ({ x: 27, y: -15 }), placeProjectileTraceNode() {}, hashStringToSeed: () => 1, drawMachineGunBurst() {},
  });
  const b = scene.spawnMachineGunBurst(u, target, true, undefined, 'hull');
  nearPoint({ x: b.startX, y: b.startY }, { x: 27, y: -15 });
  near(b.ux, 173 / Math.hypot(173, 115)); near(b.uy, 115 / Math.hypot(173, 115));
  scene.machineGunMuzzlePosition = () => { throw new Error('AA must use its own origin'); };
  scene.spawnMachineGunBurst(u, target, false, { x: 300, y: 400 });
  u.destroyed = true;
  assert.equal(scene.spawnMachineGunBurst(u, target, true, undefined, 'hull'), undefined);
});

test('hull-only and coaxial-only fire each use one port; combined fire uses both', () => {
  const CueScene = sceneMethods(['playMachineGunFireCue'], {
    isTankUnit: () => true, isFootUnit: () => false, fireDirectionTo: () => 0,
    selectTankMachineGun: () => { throw new Error('committed attacks must not reselect weapons'); }, playMgFire() {},
  });
  const scene = new CueScene(), calls = [], u = { pos: {} }, target = { pos: {} };
  Object.assign(scene, { canHearBattleAt: () => false, rememberAttackPosition() {},
    spawnMachineGunBurst: (...args) => calls.push(args[4]),
  });
  for (const weapon of ['coaxial', 'hull', 'both']) {
    calls.length = 0;
    scene.tankMachineGunSelection = () => { throw new Error('VFX must not predict another turret traverse'); };
    scene.playMachineGunFireCue(u, target, true, weapon);
    assert.deepEqual(calls, weapon === 'both' ? ['coaxial', 'hull'] : [weapon]);
  }
});

test('click positioning writes fractional source coordinates to the selected weapon only', () => {
  const source = fs.readFileSync('assets/scripts/view/MainMenuScene.ts', 'utf8');
  const ast = ts.createSourceFile('MainMenuScene.ts', source, ts.ScriptTarget.Latest, true);
  let handler;
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'beginDrag') handler = n.initializer.getText(ast);
    ts.forEachChild(n, visit);
  }
  visit(ast);
  const transform = { originX: 13, originY: -22, anchorX: 80, anchorY: 40, scaleX: 1.3, scaleY: 1.3, ux: 0, uy: 1 };
  const draft = { coaxialMuzzleSpriteX: 0, coaxialMuzzleSpriteY: 0, hullMuzzleSpriteX: 0, hullMuzzleSpriteY: 0 };
  const inputs = new Map(Object.keys(draft).map(k => [k, { string: '0' }]));
  const ctx = vm.createContext({ ...geometry, machineGunPick: 'coaxial', showDestroyed: false, isTankKind: () => true,
    selectedKind: 'tiger', machineGunTransforms: { coaxial: transform, hull: transform }, drafts: { tiger: draft },
    pointerLocal: () => geometry.machineGunSpritePoint(31.25, 24.75, transform), debugInputs: inputs,
    formatTankDebugNumber: String, refreshPreview() {},
  });
  const click = vm.runInContext(ts.transpileModule(`(${handler})`, { compilerOptions: { target: ts.ScriptTarget.ES2019 } }).outputText, ctx);
  const ev = {}; click('body', ev);
  assert.equal(ev.propagationStopped, true);
  assert.equal(draft.coaxialMuzzleSpriteX, 31.25); assert.equal(draft.coaxialMuzzleSpriteY, 24.75);
  assert.equal(draft.hullMuzzleSpriteX, 0); assert.equal(inputs.get('coaxialMuzzleSpriteX').string, '31.25');
  ctx.machineGunPick = 'hull'; click('turret', {});
  assert.equal(draft.hullMuzzleSpriteX, 31.25); assert.equal(draft.hullMuzzleSpriteY, 24.75);
});
