const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
class UITransform {
  anchorPoint = { x: .5, y: .5 }; contentSize = { width: 20, height: 20 };
  setAnchorPoint(v) { this.anchorPoint = v; }
  setContentSize(v) { this.contentSize = v; }
  getBoundingBoxToWorld() {
    this.boundsReads = (this.boundsReads ?? 0) + 1;
    const n = this.node, w = this.contentSize.width, h = this.contentSize.height;
    return new Rect(n.worldPosition.x - w / 2, n.worldPosition.y - h / 2, w, h);
  }
}
class Rect {
  constructor(x, y, width, height) { Object.assign(this, { x, y, width, height, w: width }); }
  intersects(other) { return this.x < other.x + other.width && this.x + this.width > other.x
    && this.y < other.y + other.height && this.y + this.height > other.y; }
}
class Node {
  active = true; children = []; components = new Map(); layer = 1;
  worldPosition = { x: 0, y: 0, z: 0 }; worldRotation = {}; worldScale = { x: 1, y: 1, z: 1 };
  worldMatrix = { m00: 1, m01: 0, m04: 0, m05: 1, m12: 0, m13: 0 };
  constructor(name) { this.name = name; }
  get activeInHierarchy() { return this.active; }
  addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
  getComponent(Type) { return this.components.get(Type); }
  addChild(n) { this.children.push(n); n.parent = this; }
  setPosition(x, y, z) { this.worldPosition = { x, y, z }; }
  setRotationFromEuler() {}
  setScale(x, y, z) { this.worldScale = { x, y, z }; }
  setWorldPosition(v) { this.worldPosition = { ...v }; }
  setWorldRotation(v) { this.worldRotation = v; }
  setWorldScale(v) { this.worldScale = { ...v }; }
}
class Vec4 { constructor(x, y, z, w) { Object.assign(this, {x, y, z, w}); } }
class Sprite { getMaterialInstance() { return { setProperty() {} }; } static SizeMode = { CUSTOM: 1 }; trim = true; getComponent(t) { return this.node.getComponent(t); } }
class Graphics {
  circles = []; clear() { this.circles = []; } circle(...v) { this.circles.push(v); }
  fill() {} stroke() {} moveTo() {} lineTo() {} close() {}
}
class Mask {
  static Type = { SPRITE_STENCIL: 3, GRAPHICS_STENCIL: 2 }; subComp = new Sprite();
  set type(v) { if (this._type !== v) this.subComp = v === 2 ? new Graphics() : new Sprite(); this._type = v; }
  get type() { return this._type; }
}
const code = ts.transpileModule(fs.readFileSync('assets/scripts/view/UnitOcclusionRenderer.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleObject = { exports: {} };
vm.runInNewContext(code, { exports: moduleObject.exports, require: () => ({ Node, Sprite, Mask, Rect, UITransform, Graphics, Vec4 }) });
const Renderer = moduleObject.exports.UnitOcclusionRenderer;
function sprite(x) { const n = new Node('source'); n.worldPosition.x = x; n.addComponent(UITransform); const s = n.addComponent(Sprite); s.spriteFrame = { uv: [0, 0, 1, 0, 0, 1, 1, 1] }; return s; }
test('only overlapping active sprites get silhouettes, with exact frame and faction color', () => {
  const root = new Node('root'), r = new Renderer(root); r.setMaterial({ destroy() {} });
  const unit = sprite(0), far = sprite(100), hidden = sprite(0), blocker = sprite(4); hidden.node.active = false;
  const red = { r: 240, g: 65, b: 65 };
  r.sync(new Map([[unit, red], [far, red], [hidden, red]]), [blocker]);
  assert.equal(root.children.length, 1);
  const stencil = root.children[0];
  assert.equal(stencil.getComponent(Mask).type, Mask.Type.SPRITE_STENCIL);
  assert.equal(stencil.getComponent(Mask).subComp.spriteFrame, blocker.spriteFrame);
  assert.equal(stencil.children.length, 1);
  const copy = stencil.children[0].getComponent(Sprite);
  assert.equal(copy.spriteFrame, unit.spriteFrame); assert.equal(copy.color, red);
  unit.node.worldPosition.x = 8; unit.node.worldRotation = { angle: 30 }; r.syncTransforms();
  assert.equal(copy.node.worldPosition.x, 8); assert.equal(copy.node.worldRotation.angle, 30);
  r.sync(new Map(), [blocker]); assert.equal(stencil.active, false);
  r.sync(new Map([[unit, red]]), [blocker]); assert.equal(root.children.length, 1);
});
test('scene uses whole-unit visibility and retains roof/foliage stencils', () => {
  const s = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
  assert.equal(s.includes('silhouetteRoot.addComponent(Mask)'), false, 'fog must not cut unit outlines');
  assert.equal(s.includes('!unit.destroyed\n            && (this.drawingUnitFogId || this.isUnitVisible(unit))'), true);
  assert.match(s, /insertChild\(unitMaskNode, urbanBuildingLayerNode.getSiblingIndex\(\)\)/);
  assert.equal(s.includes('this.syncUnitOcclusion();'), true);
  assert.equal(s.includes('], this.occlusionShapes, this.vectorSilhouettes, this.bunkerInfantryOccluders());'), true,
    'stationary and moving units must share the same occlusion pass and soft fog texture');
  const shader = fs.readFileSync('assets/resources/effects/unit-silhouette.effect', 'utf8');
  assert.match(shader, /center \* \(1\.0 - interior\) \* color\.a/);
  assert.match(shader, /vec2 dx = outlineStep\.xy/);
  assert.doesNotMatch(shader, /dFdx|dFdy|fwidth/, 'WebGL 1 compilation must not require the derivatives extension');
});

test('vector fallback silhouettes and tree/roof geometry remain clipped by stencils', () => {
  const root = new Node('root'), r = new Renderer(root); r.setMaterial({ destroy() {} });
  const green = { r: 65, g: 225, b: 95 };
  r.sync(new Map(), [sprite(0)], [{ circle: [0, 0, 12] }], [{ circle: [2, 3, 4], color: green }]);
  assert.equal(root.children.length, 2);
  const vector = root.children[0].children[0].getComponent(Graphics);
  assert.deepEqual(vector.circles[0], [2, 3, 4]); assert.equal(vector.strokeColor, green);
  assert.equal(root.children[1].getComponent(Mask).type, Mask.Type.GRAPHICS_STENCIL);
});

test('bunker passes clip only their selected infantry and keep existing building passes independent', () => {
  const root = new Node('root'), r = new Renderer(root); r.setMaterial({ destroy() {} });
  const infantry = sprite(0), tank = sprite(0), roof = sprite(0), bunker = sprite(0);
  const color = { r: 65, g: 225, b: 95 };
  r.sync(new Map([[infantry, color], [tank, color]]), [roof], [], [],
    [{ blocker: bunker, sources: new Map([[infantry, color]]) }]);
  assert.equal(root.children.length, 2);
  assert.equal(root.children[0].children.length, 2, 'normal roofs retain their original source set');
  const stencil = root.children[1];
  assert.equal(stencil.getComponent(Mask).subComp.spriteFrame, bunker.spriteFrame);
  assert.equal(stencil.getComponent(Mask).alphaThreshold, 0.1);
  assert.equal(stencil.children.length, 1);
  assert.equal(stencil.children[0].getComponent(Sprite).spriteFrame, infantry.spriteFrame);
  r.sync(new Map(), [], [], [], [{ blocker: bunker, sources: new Map(), vectors: [{ circle: [2, 3, 4], color }] }]);
  assert.equal(root.children[0].getComponent(Mask).subComp.spriteFrame, bunker.spriteFrame);
  assert.deepEqual(root.children[0].children.find(node => node.getComponent(Graphics))
    .getComponent(Graphics).circles[0], [2, 3, 4]);
  bunker.node.active = false;
  r.sync(new Map(), [], [], [], [{ blocker: bunker, sources: new Map([[infantry, color]]) }]);
  assert(root.children.every(node => !node.active), 'pooled bunker passes reset when no longer visible');
});

test('a dense map computes each world bound once per sync, including shared bunker sources', () => {
  const root = new Node('root'), renderer = new Renderer(root); renderer.setMaterial({ destroy() {} });
  const units = Array.from({ length: 24 }, (_, i) => sprite(i * 3));
  const blockers = Array.from({ length: 300 }, (_, i) => sprite(1000 + i * 30));
  const sources = new Map(units.map(unit => [unit, {}]));
  renderer.sync(sources, blockers, [], [], [{ blocker: blockers[0], sources: new Map([[units[0], {}]]) }]);
  assert.equal(root.children.length, 0, 'distant trees must not allocate stencil nodes');
  const reads = [...units, ...blockers].reduce((sum, sprite) => sum + sprite.getComponent(UITransform).boundsReads, 0);
  assert.equal(reads, 324, '24 units and 300 trees must not perform 7200 unit transform walks');
  units[0].node.worldPosition.x = 1000;
  renderer.sync(sources, blockers);
  assert(root.children.some(node => node.active), 'the next sync must pick up newly overlapping motion');
});

test('fallback infantry vectors allocate stencils only for overlapping trees and roofs', () => {
  const root = new Node('root'), renderer = new Renderer(root); renderer.setMaterial({ destroy() {} });
  const vector = { circle: [0, 0, 4], color: {} };
  const blockers = Array.from({ length: 300 }, (_, i) => sprite(100 + i * 30));
  renderer.sync(new Map(), blockers, [], [vector]);
  assert.equal(root.children.length, 0);
  blockers[0].node.worldPosition.x = 0;
  renderer.sync(new Map(), blockers, [], [vector]);
  assert.equal(root.children.filter(node => node.active).length, 1);
  assert.deepEqual(root.children[0].children[0].getComponent(Graphics).circles[0], [0, 0, 4]);
});

test('vector overlap follows map pan, zoom and rotation in world coordinates', () => {
  const root = new Node('root'), renderer = new Renderer(root); renderer.setMaterial({ destroy() {} });
  root.worldMatrix = { m00: 0, m01: 2, m04: -2, m05: 0, m12: 100, m13: 200 };
  const blocker = sprite(100); blocker.node.worldPosition.y = 220;
  renderer.sync(new Map(), [blocker], [], [{ circle: [10, 0, 4], color: {} }]);
  assert.equal(root.children.length, 1);
  blocker.node.worldPosition.y = 300;
  renderer.sync(new Map(), [blocker], [], [{ circle: [10, 0, 4], color: {} }]);
  assert.equal(root.children[0].active, false);
});
