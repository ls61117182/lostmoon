const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS } }).outputText;
class Node {
  static EventType = { TOUCH_END: 'touchend' };
  constructor(name) { this.name = name; this.children = []; this.components = []; this.position = { x: 0, y: 0 }; this.scale = 1; this.active = true; this.events = {}; }
  addChild(child) { child.parent = this; this.children.push(child); }
  addComponent(Type) { const c = new Type(); c.node = this; this.components.push(c); return c; }
  getComponent(Type) { return this.components.find(c => c instanceof Type); }
  setPosition(x, y) { this.position = { x, y }; }
  setScale(x) { this.scale = x; }
  setSiblingIndex(index) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent.children.splice(index, 0, this); }
  on(name, fn) { this.events[name] = fn; }
}
class UITransform { setContentSize(width, height) { this.contentSize = { width, height }; } }
class Label { static Overflow = { SHRINK: 1 }; }
class Color { constructor(r, g, b, a = 255) { Object.assign(this, { r, g, b, a }); } }
class Graphics {
  constructor() { this.shapes = []; }
  clear() { this.shapes = []; }
  rect(x, y, w, h) { this.pending = { x, y, w, h }; }
  roundRect(x, y, w, h, radius) { this.pending = { x, y, w, h, radius }; }
  fill() { this.shapes.push({ ...this.pending, fill: this.fillColor }); }
  stroke() { this.shapes.push({ ...this.pending, stroke: this.strokeColor }); }
}
const cc = { Node, Label, Color, UITransform, Graphics, BlockInputEvents: class {}, HorizontalTextAlignment: { LEFT: 0, CENTER: 1 }, VerticalTextAlignment: { CENTER: 1 } };
function load(name, requires = {}) {
  const file = path.resolve(__dirname, '../../assets/scripts', name + '.ts');
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compile(fs.readFileSync(file, 'utf8')))(id => {
    if (!(id in requires)) throw Error('Missing mock: ' + id);
    return requires[id];
  }, mod, mod.exports);
  return mod.exports;
}
const statistics = load('core/BattleStatistics');
const lang = load('core/Lang', { './LangDB': load('core/LangDB') });
const { BattleOutcomePanel } = load('view/BattleOutcomePanel', {
  cc, '../core/BattleStatistics': statistics, '../core/Lang': lang,
  './ButtonFeedback': { bindButtonPressScale: () => {} }, '../audio/GameAudio': { playUiClick: () => {} },
});
function create(width = 1280, height = 720, hostWidth = 100, hostHeight = 100) {
  const parent = new Node('BattleScene');
  parent.addComponent(UITransform).setContentSize(hostWidth, hostHeight);
  const calls = [];
  const panel = new BattleOutcomePanel(parent, () => calls.push('retry'), () => calls.push('menu'), { width, height });
  return { panel, parent, calls };
}
function find(node, name) { return node.name === name ? node : node.children.map(n => find(n, name)).find(Boolean); }
module.exports = { ...cc, ...statistics, ...lang, create, find };
