const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file, deps = {}) {
  const module = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText)(module, module.exports, name => deps[name]);
  return module.exports;
}
const { buildFogMask } = load('assets/scripts/view/FogMaskRaster.ts');
const cells = [];
for (let r = -4; r <= 4; r++) for (let q = -4; q <= 4; q++) {
  const visible = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 2;
  cells.push({ x: Math.sqrt(3) * (q + r / 2), y: -1.5 * r, from: visible ? 0 : 1, to: 1 });
}
const mask = buildFogMask(cells);
function sample(data, x, y, channel) {
  const px = Math.floor((x - data.left) * data.width / data.spanX);
  const py = Math.floor((data.top - y) * data.height / data.spanY);
  return data.pixels[(py * data.width + px) * 4 + channel];
}
assert.equal(sample(mask, 0, 0, 0), 0, 'visible interior stays clear');
assert.equal(sample(mask, 6, 0, 0), 255, 'hidden interior retains full fog');
assert.equal(sample(mask, 0, 0, 1), 255, 'end state may independently hide the entire map');
assert.ok(mask.pixels.some((v, i) => i % 4 === 0 && v > 30 && v < 220), 'field has a continuous soft boundary');
assert.deepEqual(buildFogMask(cells).pixels, mask.pixels, 'noise input and raster remain deterministic');
const clear = buildFogMask([{ x: 0, y: 0, from: 0, to: 0 }]);
assert.ok(clear.pixels.every((v, i) => i % 4 > 1 || v === 0), 'off-map pixels do not introduce fog around visible border cells');
assert.equal(sample(clear, 0, 0, 2), 255, 'map interior covered');
assert.equal(clear.pixels[2], 0, 'padding does not cover absent map');
const large = buildFogMask([{ x: 0, y: 0, from: 1, to: 1 }, { x: 500, y: 1000, from: 1, to: 1 }]);
assert.ok(large.width <= 512 && large.height <= 512, 'bounded texture dimensions');
assert.equal(sample(large, 500, 1000, 2), 255, 'far cells survive dimension limiting');

let uploads = 0, builds = 0, releaseCount = 0, resets = 0;
class Node {
  constructor() { this.layer = 1; this.isValid = true; this.components = new Map(); }
  addChild() {}
  addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
  getComponent(Type) { return this.components.get(Type); }
  setPosition(...args) { this.position = args; }
  destroy() {
    this.isValid = false;
    // Cocos destroys components and clears their node references before the
    // parent BattleScene.onDestroy may run.
    for (const component of this.components.values()) {
      component.isValid = false;
      component.node = null;
    }
  }
}
class UITransform { setContentSize(...args) { this.size = args; } }
class Texture2D {
  reset() { resets++; if (this.bound) throw Error('Reset invalidates a cached GPU texture binding'); }
  setFilters() {} setWrapMode() {} uploadData() { uploads++; } destroy() { releaseCount++; }
}
Texture2D.Filter = { LINEAR: 1 }; Texture2D.WrapMode = { CLAMP_TO_EDGE: 1 }; Texture2D.PixelFormat = { RGBA8888: 1 };
class SpriteFrame { reset(info) { this.texture = info.texture; } destroy() { releaseCount++; } }
class Material { initialize() {} setProperty(name, value) { this[name] = value; } destroy() { releaseCount++; } }
class Sprite {
  constructor() { this.isValid = true; }
  set spriteFrame(value) { if (!this.node.isValid) throw Error('Sprite already destroyed'); this.frame = value; if (value) value.texture.bound = true; }
  set customMaterial(value) { if (!this.node.isValid) throw Error('Material internals already cleared'); this.material = value; }
  get customMaterial() { return this.material; }
  getRenderMaterial() { return this.customMaterial; }
}
Sprite.SizeMode = { CUSTOM: 1 };
class Vec4 { constructor(...args) { this.set(...args); } set(x, y, z, w) { Object.assign(this, { x, y, z, w }); } }
let ready;
const cc = { Node, UITransform, Texture2D, SpriteFrame, Material, Sprite, Vec4, Rect: Vec4, Size: Vec4,
  resources: { load(_path, _type, cb) { ready = cb; } } };
const { FogOverlayRenderer } = load('assets/scripts/view/FogOverlayRenderer.ts', {
  cc, './FogMaskRaster': { buildFogMask(cells) { builds++; return buildFogMask(cells); } },
});
const renderer = new FogOverlayRenderer(new Node(), () => {});
assert.equal(renderer.draw(cells, 50, 0, 0, 0, {}), false, 'old overlay remains available while shader loads');
ready(null, {});
renderer.draw(cells, 50, 0, 0, 0, {});
for (let frame = 0; frame < 60; frame++) renderer.draw(cells, 80, frame, -frame, frame / 60, {});
assert.equal(uploads, 1, 'animation and camera changes must not upload texture data');
assert.equal(builds, 1, 'animation and zoom must not rebuild or blur the mask');
renderer.draw(cells.map(c => ({ ...c, to: 0 })), 50, 0, 0, 0, {});
assert.equal(uploads, 2, 'visibility change uploads a new endpoint field');
for (let step = 0; step < 6; step++) {
  renderer.draw(cells.map((c, i) => ({ ...c, from: (i + step) % 3 === 0 ? 0 : 1 })), 50, 0, 0, 1, {});
}
assert.equal(resets, 1, 'consecutive movement preserves the bound GPU texture');
renderer.draw([{ x: 0, y: 0, from: 0, to: 1 }], 50, 0, 0, 1, {});
assert.equal(resets, 2, 'map resize creates a new texture identity');
assert.equal(releaseCount, 2, 'resize releases old frame and texture');
renderer.destroy();
assert.equal(releaseCount, 5, 'texture, sprite frame and material released');
renderer.destroy();
assert.equal(releaseCount, 5, 'repeated cleanup is harmless');
const teardownRenderer = new FogOverlayRenderer(new Node(), () => {});
ready(null, {});
teardownRenderer.draw(cells, 50, 0, 0, 1, {});
teardownRenderer.sprite.node.destroy();
assert.equal(teardownRenderer.sprite.node, null, 'scene teardown reproduces the cleared component node');
assert.equal(teardownRenderer.draw(cells, 50, 0, 0, 1, {}), false, 'late redraw after child destruction ignored');
assert.doesNotThrow(() => teardownRenderer.destroy(), 'cleanup after scene destroys the Sprite must not access its setters');
assert.doesNotThrow(() => teardownRenderer.destroy(), 'cleanup remains idempotent after the child was already destroyed');
const loadingRenderer = new FogOverlayRenderer(new Node(), () => {});
loadingRenderer.destroy();
assert.doesNotThrow(() => ready(null, {}), 'late shader load after scene exit ignored');
const destroyedLoadingRenderer = new FogOverlayRenderer(new Node(), () => { throw Error('Destroyed renderer must not request a redraw'); });
destroyedLoadingRenderer.sprite.node.destroy();
assert.doesNotThrow(() => ready(null, {}), 'late shader load after child destruction ignored even before owner cleanup');
assert.doesNotThrow(() => destroyedLoadingRenderer.destroy());

// Execute the actual scene method, including active-ring and transient reveals.
const battleSource = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const ast = ts.createSourceFile('BattleScene.ts', battleSource, ts.ScriptTarget.Latest, true);
let method;
function visit(node) {
  if (ts.isMethodDeclaration(node) && node.name?.getText(ast) === 'redrawFogOverlay') method = node;
  ts.forEachChild(node, visit);
}
visit(ast);
const redraw = new Function('HexMap', 'axialToPixel', 'fogOfWarEnabled', 'GameSession', 'FOG_OVERLAY_COLOR', 'Color',
  ts.transpile(`return function() ${method.body.getText(ast)}`, { target: ts.ScriptTarget.ES2020 }))(
    { keyOf: p => `${p.q},${p.r}` }, p => ({ x: p.q, y: p.r }), () => true, {}, { a: 145 }, class {},
  );
let sceneCells, sceneProgress;
const transition = { activeLayer: new Set(['1,0']), expanding: true, elapsed: .25, layerInterval: 1 };
const scene = {
  fogGraphics: { clear() {} }, fogNode: { setSiblingIndex() {} },
  mapNode: { children: [] }, hexSize: 50, offsetX: 0, offsetY: 0,
  mission: { map: { all: () => [0, 1, 2, 3].map(q => ({ pos: { q, r: 0 } })) } },
  fogVisionTransition: transition, transientFogRevealKeys: new Set(['2,0']),
  isDeepShadowTile: t => t.pos.q === 3,
  fogOverlayAlpha: p => p.q === 0 ? 145 : p.q === 1 ? 145 * (1 - transition.elapsed) : 0,
  fogOverlayRenderer: { draw(cells, _size, _x, _y, progress) { sceneCells = cells; sceneProgress = progress; return true; } },
  redrawTurretAimOverlay() {}, redrawSupportMarkers() {},
};
redraw.call(scene);
assert.deepEqual(sceneCells.map(c => [c.from, c.to]), [[1, 1], [1, 0], [0, 0]], 'hidden, active ring, transient reveal remain independent; deep shadow omitted');
assert.equal(sceneProgress, .25);
const endpoints = JSON.stringify(sceneCells);
transition.elapsed = .75;
redraw.call(scene);
assert.equal(JSON.stringify(sceneCells), endpoints, 'scene sends stable endpoints through the fade');
assert.equal(sceneProgress, .75);
assert.deepEqual([...transition.activeLayer], ['1,0'], 'rendering cannot change gameplay visibility');
console.log('Fog mask geometry, transition endpoints, caching and resource cleanup passed');
