const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
class Vec4 {
  constructor(x = 0, y = 0, z = 0, w = 0) { this.set(x, y, z, w); }
  set(x, y, z, w) { Object.assign(this, { x, y, z, w }); }
}
class UITransform { contentSize = { width: 200, height: 100 }; }
class Mask {}
class Node {
  isValid = true; children = []; components = new Map();
  worldMatrix = { m00: 1, m01: 0, m04: 0, m05: 1, m12: 100, m13: 50 };
  getComponent(Type) { return this.components.get(Type); }
  addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
  addChild(n) { n.parent = this; this.children.push(n); }
}
class Material {
  isValid = true; calls = 0; values = {};
  initialize() {}
  setProperty(key, value) { this.calls++; this.values[key] = value instanceof Vec4 ? { ...value } : value; }
  destroy() { this.isValid = false; }
}
class Sprite {
  isValid = true; customMaterial = null;
  getRenderMaterial() { return this.rendered ?? this.customMaterial; }
}
class Graphics {
  isValid = true; customMaterial = null;
  getRenderMaterial() { return this.rendered ?? this.customMaterial; }
}
let callbacks = [];
const cc = { Vec4, UITransform, Mask, Node, Material, Sprite, Graphics,
  resources: { load(path, type, cb) { callbacks.push(cb); } } };
const mod = { exports: {} };
new Function('exports', 'require', ts.transpileModule(fs.readFileSync('assets/scripts/view/UnitFogRenderer.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(mod.exports, () => cc);
const { UnitFogRenderer, unitFogWorldUV } = mod.exports;
function setup() {
  callbacks = [];
  const fog = new UnitFogRenderer(() => {});
  callbacks.forEach(cb => cb(null, {}));
  const quad = new Node(); quad.addComponent(UITransform);
  const texture = { name: 'terrain-owned texture', uploads: 0, destroy() { assert.fail('unit fog must never destroy terrain texture'); } };
  const state = { quad, texture, data: { left: -2, top: 1, spanX: 4, spanY: 2 }, params: new Vec4(1, .055, .25, .75) };
  fog.update(state, true);
  return { fog, state };
}
const sprite = () => new Node().addComponent(Sprite);

test('world UVs stay aligned through pan, zoom, rotation and negative scale', () => {
  for (const angle of [0, Math.PI / 2, .4]) for (const scale of [1, 2, -1]) {
    const m = { m00: scale * Math.cos(angle), m01: scale * Math.sin(angle),
      m04: -scale * Math.sin(angle), m05: scale * Math.cos(angle), m12: 137, m13: -29 };
    const uv = unitFogWorldUV(m, 200, 100);
    for (const [x, y] of [[0, 0], [-100, 50], [100, -50]]) {
      const world = [m.m00 * x + m.m04 * y + m.m12, m.m01 * x + m.m05 * y + m.m13];
      const sample = row => row[0] * world[0] + row[1] * world[1] + row[2];
      assert(Math.abs(sample(uv.x) - (x / 200 + .5)) < 1e-9);
      assert(Math.abs(sample(uv.y) - (.5 - y / 100)) < 1e-9);
    }
  }
});

test('all units share the terrain texture and materials; settled frames update no uniforms', () => {
  const { fog, state } = setup();
  const hull = sprite(), turret = sprite();
  fog.bind(hull, 'hidden'); fog.bind(turret, 'hidden');
  assert.equal(hull.customMaterial, turret.customMaterial);
  assert.equal(hull.customMaterial.values.unitFogTexture, state.texture);
  const calls = hull.customMaterial.calls;
  for (let i = 0; i < 60; i++) fog.update(state, true);
  assert.equal(hull.customMaterial.calls, calls);
  state.params.x = .4; fog.update(state, true);
  assert.equal(hull.customMaterial.values.unitFogShape.x, .4);
  assert.equal(hull.customMaterial.values.unitFogTexture, state.texture);
  state.quad.worldMatrix.m12 += 20; fog.update(state, true);
  assert(Math.abs(hull.customMaterial.values.unitFogUvX.z + .1) < 1e-9);
  const replacement = { name: 'new terrain texture' };
  fog.update({ ...state, texture: replacement }, true);
  assert.equal(hull.customMaterial.values.unitFogTexture, replacement);
});

test('known map-edge overhang, hidden padding and scenery use separate policies', () => {
  const { fog, state } = setup();
  const hidden = sprite(), known = sprite();
  fog.bind(hidden, 'hidden'); fog.bind(known, 'known');
  assert.equal(hidden.customMaterial.values.unitFogUvY.w, 0);
  assert.equal(known.customMaterial.values.unitFogUvY.w, 1);
  fog.bind(known, 'unmasked');
  assert.equal(known.customMaterial, null, 'pooled bunker art must lose the previous tank fog material');
  fog.update(state, false);
  assert.equal(hidden.customMaterial.values.unitFogUvX.w, 0, 'fog-disabled modes render normally');
});

test('late stencil material instances receive current uniforms and shared texture', () => {
  const { fog, state } = setup();
  const body = sprite(); fog.bind(body, 'known');
  body.rendered = new Material();
  fog.update(state, true);
  assert.equal(body.rendered.values.unitFogTexture, state.texture);
  assert.equal(body.rendered.values.unitFogUvY.w, 1);
  fog.clear(); assert.equal(body.customMaterial, null);
  assert.doesNotThrow(() => fog.destroy());
  assert.doesNotThrow(() => fog.destroy());
});

test('riders and damage graphics inherit fog while stencil renderers keep their material', () => {
  const { fog } = setup();
  const hull = sprite();
  const rider = sprite(); hull.node.addChild(rider.node);
  const damage = new Node(); damage.addComponent(Graphics); hull.node.addChild(damage);
  const stencil = new Node(); stencil.addComponent(Mask);
  const stencilSprite = stencil.addComponent(Sprite); hull.node.addChild(stencil);
  fog.bindTree(hull.node, 'hidden');
  assert.equal(hull.customMaterial, rider.customMaterial);
  assert(damage.getComponent(Graphics).customMaterial);
  assert.equal(stencilSprite.customMaterial, null);
});

test('shader load failures and late callbacks cannot expose units or resurrect disposed materials', () => {
  callbacks = [];
  const fog = new UnitFogRenderer(() => assert.fail('late callback'));
  assert.equal(fog.ready, false);
  fog.destroy();
  assert.doesNotThrow(() => callbacks.forEach(cb => cb(null, {})));
  assert.equal(fog.ready, false);
});

test('scene submits hidden moving bodies to the shared spatial shader before logical arrival', () => {
  const Scene = require('./helpers/BattleSceneMethods.cjs')(['drawPresentedUnit'], {
    Node, UITransform, Graphics, GameSession: { gameMode: 'classic' },
  });
  const scene = new Scene(), enemy = { id: 'enemy' };
  const calls = [];
  Object.assign(scene, { node: new Node(), g: new Node().addComponent(Graphics), unitFallbackGraphics: new Map(),
    unitFogRenderer: { ready: true, bind: (g, policy) => calls.push(policy) },
    isUnitVisible: () => false, usesPushedWreckVision: () => false, suppressionMarkPoolNext: 0,
    drawUnitMaybeAnim: unit => calls.push(unit), captureSilhouetteSources() {},
  });
  scene.drawPresentedUnit(enemy);
  assert.deepEqual(calls, ['hidden', enemy]);
  assert.equal(scene.g.node.getComponent(Mask), undefined, 'the unit path must add no stencil');
  calls.length = 0;
  scene.unitFogRenderer.ready = false;
  scene.drawPresentedUnit(enemy);
  assert.deepEqual(calls, [], 'loading fallback never exposes a hidden body');
});
