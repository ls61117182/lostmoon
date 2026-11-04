const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

class Color {
  constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); }
}
class UITransform {
  constructor() { this.contentSize = { width: 1, height: 1 }; this.anchorPoint = { x: 0.5, y: 0.5 }; }
  setContentSize(size, height) { this.sizeWrites = (this.sizeWrites ?? 0) + 1; this.contentSize = typeof size === 'number' ? { width: size, height } : { ...size }; }
  setAnchorPoint(point) { this.anchorPoint = point; }
  get width() { return this.contentSize.width; }
  get height() { return this.contentSize.height; }
}
class Sprite { static SizeMode = { CUSTOM: 1 }; color = new Color(255, 255, 255, 255); }
class Texture2D {
  static PixelFormat = { RGBA8888: 1 }; static Filter = { LINEAR: 1 };
  reset(options) { this.options = options; } setFilters() {} uploadData(pixels) { this.pixels = pixels; }
  destroy() { this.destroyed = true; }
}
class SpriteFrame { destroy() { this.destroyed = true; } }
class Node {
  constructor(name) {
    this.name = name; this.active = true; this.children = []; this.components = new Map();
    this.position = { x: 0, y: 0 }; this.scale = { x: 1, y: 1, z: 1 }; this.angle = 0;
  }
  addComponent(Type) { const component = new Type(); component.node = this; this.components.set(Type, component); return component; }
  get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
  getComponent(Type) { return this.components.get(Type); }
  addChild(child) { this.children.push(child); child.parent = this; }
  setSiblingIndex(index) { const siblings = this.parent.children; siblings.splice(siblings.indexOf(this), 1); siblings.splice(index, 0, this); }
  setPosition(x, y, z) { this.positionWrites = (this.positionWrites ?? 0) + 1; this.position = { x, y, z }; }
  setScale(x, y, z) { this.scale = typeof x === 'object' ? { ...x } : { x, y, z }; }
}
const js = ts.transpileModule(fs.readFileSync('assets/scripts/view/ObjectShadowRenderer.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exportsObject = {};
new Function('require', 'exports', js)(() => ({ Color, Node, Sprite, SpriteFrame, Texture2D, UITransform }), exportsObject);
const { ObjectShadowRenderer } = exportsObject;
const parent = new Node('Map');
parent.addChild(new Node('Units'));
const renderer = new ObjectShadowRenderer(parent, 'Shadows', 0);
assert.equal(parent.children[0].name, 'Shadows');
const sourceNode = new Node('Hull');
sourceNode.addComponent(UITransform).setContentSize({ width: 40, height: 60 });
const source = sourceNode.addComponent(Sprite);
source.spriteFrame = {};
sourceNode.setPosition(100, 200, 0);
sourceNode.angle = 60;
renderer.begin(); renderer.draw(source, 'vehicle', 50); renderer.end();
const cast = parent.children[0].children[0];
assert(cast.position.x > 100 && cast.position.y < 200, 'Cast points down/right');
assert.equal(cast.children[0].angle, 60, 'Hull rotation follows the vehicle');
sourceNode.angle = 180;
source.color.a = 128;
renderer.begin(); renderer.draw(source, 'vehicle', 50); renderer.end();
assert(cast.position.x > 100 && cast.position.y < 200, 'Sun direction stays fixed while turning');
assert.equal(cast.children[0].getComponent(Sprite).color.a, 35, 'Concealment fades the cast too');
assert.equal(parent.children[0].children.length, 2, 'Redraw reuses the silhouette and shared contact layer');
const contact = renderer.contacts.children[0];
assert.deepEqual([contact.position.x, contact.position.y], [100, 200], 'Contact stays at the ground position');
sourceNode.active = false;
renderer.begin(); renderer.draw(source, 'vehicle', 50); renderer.end();
assert.equal(cast.active, false, 'Hidden/released sources leave no stale shadow');
assert.equal(contact.active, false);
renderer.begin(); sourceNode.active = true; renderer.draw(source, 'tree', 50); renderer.end();
assert.equal(cast.position.x - 100, 50 * 0.08, 'Trees use the shared 8% offset');
assert(cast.scale.y < 1, 'Tree silhouettes flatten onto the ground');
for (const kind of ['tree', 'building', 'vehicle']) {
  renderer.begin(); renderer.draw(source, kind, 50); renderer.end();
  assert.equal(cast.position.x - 100, 4, `${kind} offsets right by 8%`);
  assert.equal(cast.position.y - 200, -4, `${kind} offsets down by 8%`);
}
sourceNode.getComponent(UITransform).setContentSize({ width: 8, height: 10 });
renderer.begin(); renderer.draw(source, 'groundProp', 50); renderer.end();
assert(cast.position.x - 100 <= 8 * 0.08 + 1e-6, 'Small hay/well shadows stay attached to their footprint');
assert.equal(cast.scale.y, 1, 'Ground props preserve the silhouette footprint');
renderer.begin(); renderer.draw(source, 'infantry', 50); renderer.end();
assert(cast.active && cast.position.y < 200, 'Infantry receives a short ground cast');
assert.equal(cast.children[0].getComponent(Sprite).color.a, 45, 'Infantry shadows respect source opacity');
console.log('Object shadow rendering tests passed');

sourceNode.getComponent(UITransform).setContentSize({ width: 40, height: 60 });
for (const kind of ['tree', 'building', 'vehicle']) {
  renderer.begin(90); renderer.draw(source, kind, 50); renderer.end();
  const dx = cast.position.x - sourceNode.position.x;
  const dy = cast.position.y - sourceNode.position.y;
  assert.equal(-dy, 4, `${kind} shadow still points screen-right after a 90 degree camera rotation`);
  assert.equal(dx, -4, `${kind} shadow still points screen-down after a 90 degree camera rotation`);
  assert.equal(cast.angle, -90, 'flattening stays in the screen frame');
  assert.equal(cast.children[0].angle + cast.angle, sourceNode.angle, 'source silhouette keeps its map facing');
  const contactSize = contact.getComponent(UITransform).contentSize;
  assert.ok(contactSize.width < contactSize.height, 'contact flattening compensates for camera rotation');
}
renderer.begin(); renderer.draw(source, 'tree', 50); renderer.end();
assert.equal(cast.angle, 0, 'pooled shadow resets when returning to an unrotated mission');
for (const rotation of [0, 90]) {
  renderer.begin(rotation); renderer.draw(source, 'rocky', 50); renderer.end();
  const dx = cast.position.x - sourceNode.position.x;
  const dy = cast.position.y - sourceNode.position.y;
  assert.equal(dx, rotation === 90 ? -10 : 10, 'Raised rock cast reflects its greater height');
  assert.equal(dy, -10, 'Rock cast stays screen-down/right after camera rotation');
  assert.equal(cast.scale.y, 1, 'Rock projection preserves the overhead footprint');
  assert.equal(cast.children[0].getComponent(Sprite).color.a, 44, 'Rock cast respects source opacity');
}

// Moving a unit only changes its own two positions. Contact geometry, all
// stationary casts and fog bindings remain untouched across animation frames.
const stationaryNode = new Node('Stationary');
stationaryNode.addComponent(UITransform).setContentSize({ width: 20, height: 30 });
const stationary = stationaryNode.addComponent(Sprite); stationary.spriteFrame = {};
let fogBinds = 0, policy = 'known';
renderer.setFogRenderer({ policyOf: () => policy, bind() { fogBinds++; } });
renderer.begin(); renderer.draw(source, 'vehicle', 50); renderer.draw(stationary, 'infantry', 50); renderer.end();
const stationarySlot = renderer.pool[1], movingSlot = renderer.pool[0];
const before = { stationary: stationarySlot.root.positionWrites,
  contact: movingSlot.contact.node.getComponent(UITransform).sizeWrites,
  shape: movingSlot.sprite.node.getComponent(UITransform).sizeWrites, fogBinds };
for (let frame = 0; frame < 60; frame++) {
  sourceNode.setPosition(100 + frame, 200, 0); sourceNode.angle = frame;
  renderer.syncTransforms();
}
assert.equal(stationarySlot.root.positionWrites, before.stationary);
assert.equal(movingSlot.contact.node.getComponent(UITransform).sizeWrites, before.contact);
assert.equal(movingSlot.sprite.node.getComponent(UITransform).sizeWrites, before.shape);
assert.equal(fogBinds, before.fogBinds);
assert.equal(movingSlot.contact.node.position.x, sourceNode.position.x);
assert.equal(movingSlot.sprite.node.angle, sourceNode.angle);
assert.equal(movingSlot.contact.spriteFrame, stationarySlot.contact.spriteFrame, 'All contacts batch with the same disc');
sourceNode.setScale(2, 2, 1); source.color.a = 64; policy = 'hidden'; renderer.syncTransforms();
assert(movingSlot.contact.node.getComponent(UITransform).sizeWrites > before.contact, 'Scale invalidates contact size');
assert.equal(movingSlot.sprite.color.a, 18);
assert.equal(movingSlot.contact.color.a, 12);
sourceNode.active = false; renderer.syncTransforms();
assert.equal(movingSlot.root.active, false); assert.equal(movingSlot.contact.node.active, false);
sourceNode.active = true; renderer.syncTransforms();
assert.equal(movingSlot.root.active, true); assert.equal(movingSlot.contact.node.active, true);
const texture = renderer.contactTexture, frame = renderer.contactFrame;
assert.equal(texture.pixels[3], 0, 'Disc corners are transparent');
assert.equal(texture.pixels[(32 * 64 + 32) * 4 + 3], 255);
renderer.destroy();
assert(texture.destroyed && frame.destroyed, 'Generated contact resources are released with the scene');
