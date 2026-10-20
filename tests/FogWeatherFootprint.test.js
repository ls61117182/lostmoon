const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(cc = {}) {
  const module = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(fs.readFileSync('assets/scripts/view/FogWeatherRenderer.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText)(module, module.exports, name => {
    assert.equal(name, 'cc', 'weather geometry must not import the low-resolution visibility raster');
    return cc;
  });
  return module.exports;
}
const { buildFogWeatherFootprint } = load();
const cells = [{ x: 0, y: 0, from: 0, to: 0 }, { x: Math.sqrt(3), y: 0, from: 0, to: 0 }];
const footprint = buildFogWeatherFootprint(cells);
assert.equal(footprint.vertices.length, 24);
assert.throws(() => buildFogWeatherFootprint([]));
const vertices = start => Array.from({ length: 6 }, (_, i) =>
  `${footprint.vertices[start + i * 2]},${footprint.vertices[start + i * 2 + 1]}`);
const leftHex = new Set(vertices(0)), rightHex = vertices(12);
assert.equal(rightHex.filter(v => leftHex.has(v)).length, 2, 'adjoining hexes share identical vertices, without cracks');
assert(Math.abs(footprint.top - 1.125) < 1e-10);

let ready, uploads = 0, releases = 0;
class Node {
  constructor(name) { this.name = name; this.layer = 1; this.isValid = true; this.children = []; this.components = new Map(); }
  addChild(child) { this.children.push(child); }
  addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
  getComponent(Type) { return this.components.get(Type); }
  setPosition(...p) { this.position = p; }
  setScale(...s) { this.scale = s; }
  destroy() {
    this.isValid = false;
    for (const child of this.children) child.destroy();
    for (const c of this.components.values()) { c.isValid = false; c.node = null; }
  }
}
class UITransform { setContentSize(...size) { this.size = size; } }
class Graphics {
  constructor() { this.clearCount = 0; this.paths = []; }
  clear() { this.clearCount++; this.paths = []; }
  moveTo(x, y) { this.path = [[x, y]]; }
  lineTo(x, y) { this.path.push([x, y]); }
  close() {} fill() { this.paths.push(this.path); }
}
class Mask { constructor() { this.subComp = new Graphics(); } }
Mask.Type = { GRAPHICS_STENCIL: 1 };
class Texture2D {
  reset(info) { assert.equal(info.width, 1); assert.equal(info.height, 1); }
  setFilters() {} setWrapMode() {}
  uploadData(pixels) { uploads++; assert.deepEqual(Array.from(pixels), [255,255,255,255]); }
  destroy() { releases++; }
}
Texture2D.Filter = { LINEAR: 1 }; Texture2D.WrapMode = { CLAMP_TO_EDGE: 1 }; Texture2D.PixelFormat = { RGBA8888: 1 };
class SpriteFrame { reset(info) { this.texture = info.texture; } destroy() { releases++; } }
class Material { initialize() {} setProperty() {} destroy() { releases++; } }
class Sprite { constructor() { this.isValid = true; } getRenderMaterial() { return this.customMaterial; } }
Sprite.SizeMode = { CUSTOM: 1 };
class Vec4 { set(...v) { this.values = v; } }
const cc = { Node, Graphics, Mask, UITransform, Texture2D, SpriteFrame, Material, Sprite, Vec4,
  Rect: Vec4, Size: Vec4, Color: Vec4, resources: { load(_path, _type, callback) { ready = callback; } } };
const { FogWeatherRenderer } = load(cc);
const renderer = new FogWeatherRenderer(new Node('map'));
ready(null, {});
renderer.draw(cells, 40, 0, 0, 0, 0, 0);
const stencil = renderer.clipGraphics;
assert.equal(stencil.paths.length, 2);
assert(stencil.paths.every(path => path.length === 6));
for (const size of [80, 180, 300]) {
  renderer.draw(cells, size, 37, -80, 2, .5, 0);
  assert.deepEqual(renderer.clipNode.scale, [size, size, 1]);
  assert.equal(renderer.clipNode.position[0], Math.sqrt(3) / 2 * size + 37);
}
assert.equal(stencil.clearCount, 1, 'zoom, pan, player movement and clock changes only transform cached geometry');
assert.equal(uploads, 1, 'only one opaque pixel is uploaded, never a raster map boundary');
renderer.hide(); assert.equal(renderer.clipNode.active, false);
renderer.draw(cells, 40, 0, 0, 1, 0, 0); assert.equal(renderer.clipNode.active, true);
renderer.draw(cells.slice(0, 1), 40, 0, 0, 1, 0, 0);
assert.equal(stencil.paths.length, 1, 'changing maps rebuilds the clipping geometry');
assert.equal(uploads, 1, 'changing maps reuses the opaque texture');
renderer.destroy(); renderer.destroy(); assert.equal(releases, 3);
const late = new FogWeatherRenderer(new Node('map'));
late.destroy(); assert.doesNotThrow(() => ready(null, {}));
const teardown = new FogWeatherRenderer(new Node('map'));
ready(null, {}); teardown.clipNode.destroy();
assert.doesNotThrow(() => teardown.draw(cells, 40, 0, 0, 0, 0, 0));
assert.doesNotThrow(() => teardown.destroy());
console.log('Weather fog exact hex footprint, cached stencil transforms and teardown passed');
