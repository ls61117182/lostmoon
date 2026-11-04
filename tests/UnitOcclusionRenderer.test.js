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
  setSiblingIndex(index) { const a = this.parent.children; a.splice(a.indexOf(this), 1); a.splice(index, 0, this); }
  setPosition(x, y, z) { this.worldPosition = { x, y, z }; }
  setRotationFromEuler() {}
  setScale(x, y, z) { this.worldScale = { x, y, z }; }
  setWorldPosition(v) { this.worldWrites = (this.worldWrites ?? 0) + 1; this.worldPosition = { ...v }; }
  setWorldRotation(v) { this.worldRotation = v; }
  setWorldScale(v) { this.worldScale = { ...v }; }
}
class Vec4 { constructor(x, y, z, w) { Object.assign(this, {x, y, z, w}); } }
class Sprite {
  material = { writes: [], setProperty(...args) { this.writes.push(args); } };
  getMaterialInstance() { return this.material; }
  static SizeMode = { CUSTOM: 1 }; trim = true;
  getComponent(t) { return this.node.getComponent(t); }
}
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
  assert.match(s, /\], this\.occlusionShapes, this\.vectorSilhouettes, \[[\s\S]*?\.\.\.this\.bunkerInfantryOccluders\(\), \.\.\.this\.tankTrenchInfantryOccluders\(\)/,
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

test('tank masks appear only on overlap, follow movement and rotation, and release when the tank leaves', () => {
  const root=new Node('root'),renderer=new Renderer(root);renderer.setMaterial({destroy(){}});
  const infantry=sprite(0),other=sprite(0),tank=sprite(100),red={r:240,g:65,b:65};
  const sources=new Map([[infantry,red]]),passes=[{blocker:tank,sources}];
  renderer.sync(new Map([[infantry,red],[other,red]]),[],[],[],passes);
  assert.equal(root.children.length,0,'no stencil or outline is allocated for a distant tank');
  tank.node.worldPosition.x=4;renderer.sync(new Map(),[],[],[],passes);
  const mask=root.children[0],copy=mask.children[0].getComponent(Sprite);
  assert.equal(mask.getComponent(Mask).subComp.spriteFrame,tank.spriteFrame,'clip against the tank alpha, not its rectangular bounds');
  assert.equal(mask.children.length,1);assert.equal(copy.spriteFrame,infantry.spriteFrame);assert.equal(copy.color,red);
  tank.node.worldPosition.x=8;tank.node.worldRotation={angle:37};tank.node.worldScale={x:1.2,y:1.2,z:1};
  renderer.syncTransforms();
  assert.equal(mask.worldPosition.x,8);assert.equal(mask.worldRotation.angle,37);assert.equal(mask.worldScale.x,1.2);
  assert.equal(copy.node.worldPosition.x,0,'moving the mask must not move the stationary soldier outline');
  tank.node.worldPosition.x=100;renderer.sync(new Map(),[],[],[],passes);
  assert.equal(mask.active,false);assert.equal(root.children.length,1,'reuse the stencil rather than creating more nodes');
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

test('60 movement frames read only the changed source bounds and retain distant passes', () => {
  const root = new Node('root'), renderer = new Renderer(root); renderer.setMaterial({ destroy() {} });
  const units = Array.from({ length: 24 }, (_, i) => sprite(i * 1000));
  const blockers = Array.from({ length: 300 }, (_, i) => sprite(i * 1000));
  renderer.sync(new Map(units.map(unit => [unit, {}])), blockers);
  const first = root.children[0], distant = root.children[23], distantWrites = distant.worldWrites;
  const boundsReads = () => [...units, ...blockers].reduce((sum, s) => sum + (s.getComponent(UITransform).boundsReads ?? 0), 0);
  const before = boundsReads(), copies = first.children[0].getComponent(Sprite), uniforms = copies.material.writes.length;
  for (let frame = 1; frame <= 60; frame++) {
    units[0].node.worldPosition.x = frame / 100;
    renderer.syncTransforms();
  }
  assert.equal(boundsReads() - before, 60, 'trees and stationary units reuse their cached bounds');
  assert.equal(distant.worldWrites, distantWrites, 'distant masks are never reconfigured');
  assert.equal(copies.material.writes.length, uniforms, 'translation does not change UVs or outline width');
  assert.equal(root.children.length, 24, 'no stencil allocation during motion inside an existing overlap');
  renderer.syncTransforms();
  assert.equal(boundsReads() - before, 60, 'an unchanged final pose is a complete no-op');
});

test('crossing spatial cells removes the old outline and adds the new one in the same frame', () => {
  const root = new Node('root'), renderer = new Renderer(root); renderer.setMaterial({ destroy() {} });
  const unit = sprite(0), oldTree = sprite(0), nextTree = sprite(1024);
  renderer.sync(new Map([[unit, {}]]), [oldTree, nextTree]);
  const oldMask = root.children[0];
  unit.node.worldPosition.x = 1024; renderer.syncTransforms();
  assert.equal(oldMask.active, false);
  assert.equal(root.children.length, 2);
  const nextMask = root.children[1];
  assert(nextMask.active);
  assert.equal(nextMask.getComponent(Mask).subComp.spriteFrame, nextTree.spriteFrame);
  assert.equal(nextMask.children[0].worldPosition.x, 1024);
  unit.node.active = false; renderer.syncTransforms();
  assert(root.children.every(node => !node.active), 'hidden or released source leaves no outline');
  unit.node.active = true; renderer.syncTransforms();
  assert(nextMask.active); assert.equal(root.children.length, 2, 're-entering reuses its pass');
  unit.node.isValid = false; renderer.syncTransforms();
  assert(root.children.every(node => !node.active), 'destroyed sources are removed too');
});

test('a tank mask enters and leaves stationary bridge infantry without a rules rebuild', () => {
  const root = new Node('root'), renderer = new Renderer(root); renderer.setMaterial({ destroy() {} });
  const infantry = sprite(0), tank = sprite(100), sources = new Map([[infantry, {}]]);
  renderer.sync(new Map(), [], [], [], [{ blocker: tank, sources }]);
  assert.equal(root.children.length, 0);
  tank.node.worldPosition.x = 5; renderer.syncTransforms();
  const mask = root.children[0], copy = mask.children[0];
  assert(mask.active); assert.equal(mask.worldPosition.x, 5); assert.equal(copy.worldPosition.x, 0);
  tank.node.worldPosition.x = 7; tank.node.worldRotation = { x: 0, y: 0, z: .3, w: .95 };
  renderer.syncTransforms();
  assert.equal(mask.worldRotation.z, .3); assert.equal(copy.worldPosition.x, 0);
  tank.node.worldPosition.x = 100; renderer.syncTransforms();
  assert.equal(mask.active, false);
  tank.node.worldPosition.x = 0; renderer.syncTransforms();
  assert(mask.active); assert.equal(root.children.length, 1);
});

test('outline parameters invalidate for scale, dimensions, atlas UV and material replacement', () => {
  const root = new Node('root'), renderer = new Renderer(root); renderer.setMaterial({ destroy() {} });
  const unit = sprite(0), tree = sprite(0), sources = new Map([[unit, {}]]);
  renderer.sync(sources, [tree]);
  const copy = root.children[0].children[0].getComponent(Sprite), material = copy.material;
  assert.equal(material.writes.length, 2);
  unit.node.worldRotation = { x: 0, y: 0, z: .5, w: .86 }; renderer.syncTransforms();
  assert.equal(material.writes.length, 2, 'rotation alone leaves sampling parameters unchanged');
  unit.node.worldScale.x = 2; renderer.syncTransforms(); assert.equal(material.writes.length, 4);
  unit.getComponent(UITransform).contentSize.width = 30; renderer.syncTransforms(); assert.equal(material.writes.length, 6);
  unit.spriteFrame.uv[2] = .5; renderer.syncTransforms(); assert.equal(material.writes.length, 8);
  copy.material = { writes: [], setProperty(...args) { this.writes.push(args); } };
  renderer.sync(sources, [tree]);
  assert.equal(copy.material.writes.length, 2, 'a new stencil material receives all sampling uniforms');
});

test('fallback vectors update nearby masks and retain a late-activated graphics stencil', () => {
  const root = new Node('root'), renderer = new Renderer(root); renderer.setMaterial({ destroy() {} });
  const vector = { circle: [1024, 0, 4], color: {} }, tree = sprite(0), shapes = [{ circle: [0, 0, 20] }];
  renderer.sync(new Map(), [tree], shapes, [vector]);
  const graphicMask = root.children[0];
  vector.circle[0] = 0; renderer.syncTransforms();
  assert.equal(root.children.filter(node => node.active).length, 2);
  const treeMask = root.children.find(node => node.getComponent(Mask).type === Mask.Type.SPRITE_STENCIL);
  assert.deepEqual(treeMask.children[0].getComponent(Graphics).circles, [[0, 0, 4]]);
  assert.deepEqual(graphicMask.getComponent(Mask).subComp.circles, [[0, 0, 20]]);
  vector.circle[0] = 1024; renderer.syncTransforms(); assert.equal(treeMask.active, false);
});

test('camera changes rebuild world-space indices and a rules redraw replaces pooled memberships', () => {
  const root = new Node('root'), renderer = new Renderer(root); renderer.setMaterial({ destroy() {} });
  const unit = sprite(0), tree = sprite(0), sources = new Map([[unit, {}]]);
  renderer.sync(sources, [tree]);
  const before = tree.getComponent(UITransform).boundsReads;
  root.worldMatrix.m12 = 1000; root.worldMatrix.m00 = 2; root.worldMatrix.m05 = 2;
  unit.node.worldPosition.x = 1000; tree.node.worldPosition.x = 1000; renderer.syncTransforms();
  assert.equal(tree.getComponent(UITransform).boundsReads, before + 1);
  assert(root.children[0].active); assert.equal(root.children[0].worldPosition.x, 1000);
  renderer.sync(new Map(), [tree]); assert(root.children.every(node => !node.active));
  renderer.sync(sources, []); assert(root.children.every(node => !node.active));
});

test('spatial reinsertion and newly overlapping masks preserve source and stencil draw order', () => {
  const root = new Node('root'), renderer = new Renderer(root); renderer.setMaterial({ destroy() {} });
  const hull = sprite(0), turret = sprite(0), lateTree = sprite(100), roof = sprite(0);
  const hullColor = {}, turretColor = {}, sources = new Map([[hull, hullColor], [turret, turretColor]]);
  renderer.sync(sources, [lateTree, roof]);
  const roofMask = root.children[0];
  hull.node.worldPosition.x = 1; renderer.syncTransforms();
  assert.deepEqual(roofMask.children.map(n => n.getComponent(Sprite).color), [hullColor, turretColor]);
  hull.node.worldPosition.x = 100; renderer.syncTransforms();
  assert.equal(root.children[1], roofMask, 'late activation inserts the earlier tree pass before the existing roof');
});
