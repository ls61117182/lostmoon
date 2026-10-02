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
    const n = this.node, w = this.contentSize.width, h = this.contentSize.height;
    return { intersects(other) { return Math.abs(n.worldPosition.x - other.x) < (w + other.w) / 2; }, x: n.worldPosition.x, w };
  }
}
class Node {
  active = true; children = []; components = new Map(); layer = 1;
  worldPosition = { x: 0, y: 0, z: 0 }; worldRotation = {}; worldScale = { x: 1, y: 1, z: 1 };
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
vm.runInNewContext(code, { exports: moduleObject.exports, require: () => ({ Node, Sprite, Mask, UITransform, Graphics, Vec4 }) });
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
test('scene clips silhouettes with the same fog mask and excludes destroyed units', () => {
  const s = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
  assert.match(s, /redrawVisibleHexMask\(this.silhouetteVisibilityGraphics, true\)/);
  assert.match(s, /!unit.destroyed && this.isUnitVisible\(unit\)/);
  assert.match(s, /insertChild\(unitMaskNode, urbanBuildingLayerNode.getSiblingIndex\(\)\)/);
  assert.match(s, /this\.unitOcclusion\?\.sync\(this\.silhouetteSources,\s*\[\s*\.\.\.this\.urbanBuildingSpritePool\.map\(slot => slot\.sprite\),\s*\.\.\.this\.foliageSpritePool\.map\(slot => slot\.sprite\),\s*\], this\.occlusionShapes, this\.vectorSilhouettes\);/,
    'map redraw must submit collected units, roofs, foliage and vector fallbacks to the silhouette renderer');
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
