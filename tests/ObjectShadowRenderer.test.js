const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

class Color {
  constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); }
}
class UITransform {
  constructor() { this.contentSize = { width: 1, height: 1 }; this.anchorPoint = { x: 0.5, y: 0.5 }; }
  setContentSize(size) { this.contentSize = size; }
  setAnchorPoint(point) { this.anchorPoint = point; }
  get width() { return this.contentSize.width; }
  get height() { return this.contentSize.height; }
}
class Graphics {
  clear() { this.ellipses = []; }
  ellipse(...args) { this.ellipses.push(args); }
  fill() {}
}
class Sprite { static SizeMode = { CUSTOM: 1 }; color = new Color(255, 255, 255, 255); }
class Node {
  constructor(name) {
    this.name = name; this.active = true; this.children = []; this.components = new Map();
    this.position = { x: 0, y: 0 }; this.scale = { x: 1, y: 1, z: 1 }; this.angle = 0;
  }
  addComponent(Type) { const component = new Type(); component.node = this; this.components.set(Type, component); return component; }
  getComponent(Type) { return this.components.get(Type); }
  addChild(child) { this.children.push(child); child.parent = this; }
  setSiblingIndex(index) { const siblings = this.parent.children; siblings.splice(siblings.indexOf(this), 1); siblings.splice(index, 0, this); }
  setPosition(x, y, z) { this.position = { x, y, z }; }
  setScale(x, y, z) { this.scale = typeof x === 'object' ? { ...x } : { x, y, z }; }
}
const js = ts.transpileModule(fs.readFileSync('assets/scripts/view/ObjectShadowRenderer.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exportsObject = {};
new Function('require', 'exports', js)(() => ({ Color, Graphics, Node, Sprite, UITransform }), exportsObject);
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
assert.equal(parent.children[0].children.length, 1, 'Redraw reuses the silhouette');
assert.deepEqual(renderer.contacts.ellipses[0].slice(0, 2), [100, 200], 'Contact stays at the ground position');
sourceNode.active = false;
renderer.begin(); renderer.draw(source, 'vehicle', 50); renderer.end();
assert.equal(cast.active, false, 'Hidden/released sources leave no stale shadow');
assert.equal(renderer.contacts.ellipses.length, 0);
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
