const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, 'assets/scripts/view', file), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
} }).outputText;
const ast = ts.createSourceFile('MainMenuScene.ts', read('MainMenuScene.ts'), ts.ScriptTarget.Latest, true);
function find(parent, predicate) {
  let result;
  function visit(node) { if (!result && predicate(node)) result = node; ts.forEachChild(node, visit); }
  visit(parent); assert.ok(result, 'actual page code must exist'); return result;
}
const method = name => find(ast, n => ts.isMethodDeclaration(n) && n.name.getText(ast) === name);
const layout = name => find(method(name), n => ts.isCallExpression(n) && n.expression.getText(ast) === 'bindAdaptivePageLayout').arguments[2];
class Transform {
  setContentSize(width, height) { this.width = width; this.height = height; }
}
class Graphics {
  clear() {} rect() {} roundRect() {} fill() {} stroke() {} moveTo() {} lineTo() {} circle() {} bezierCurveTo() {}
}
class Color { constructor(r, g, b, a = 255) { this.set(r, g, b, a); } set(r,g,b,a) { Object.assign(this, { r,g,b,a }); } }
class Node {
  static EventType = { TOUCH_END: 'end', TOUCH_START: 'start' };
  constructor(name) { this.name = name; this.children = []; this.components = new Map(); this.handlers = {}; this.position = { x:0,y:0 }; this.isValid = true; }
  addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
  getComponent(Type) { return this.components.get(Type); }
  addChild(node) { this.children.push(node); node.parent = this; }
  setPosition(x,y) { this.position = { x,y }; }
  on(event, handler) { this.handlers[event] = handler; }
  destroy() { for (const c of this.components.values()) c.onDestroy?.(); for (const c of this.children) c.destroy(); this.isValid = false; }
}
const node = (w = 0, h = 0) => { const n = new Node(); n.addComponent(Transform).setContentSize(w,h); return n; };
const ref = () => ({ node: node() });
function environment() {
  const events = new Map();
  const cc = {
    _decorator: { ccclass: () => c => c }, Component: class {}, Color, Node, Graphics, UITransform: Transform,
    game: {}, director: {}, ResolutionPolicy: { FIXED_HEIGHT: 1, FIXED_WIDTH: 2 },
    screen: { windowSize: { width:1920,height:1080 }, on: (name,fn) => events.set(name,fn) },
    view: { on: (name,fn) => events.set(name,fn), resizeWithBrowserSize() {},
      setDesignResolutionSize(w,h,policy) {
        const f = cc.screen.windowSize;
        this.visible = policy === 1 ? { width:h*f.width/f.height,height:h } : { width:w,height:w*f.height/f.width };
      }, getVisibleSize() { return this.visible; },
    },
  };
  const module = { exports: {} };
  new Function('require','module','exports',compile(read('ResolutionAdapter.ts')))(() => cc,module,module.exports);
  const adapter = module.exports;
  const pageModule = { exports: {} };
  new Function('require','module','exports',compile(read('AdaptivePageLayout.ts')))(
    name => name === 'cc' ? cc : adapter, pageModule, pageModule.exports,
  );
  Object.assign(adapter, pageModule.exports);
  adapter.applyAdaptiveResolution();
  return { cc, adapter, resize(width,height) {
    cc.screen.windowSize = { width,height }; events.get('canvas-resize')();
    return adapter.visibleSizeInRootSpace(1.5);
  } };
}
const sizes = [[1884,953], [2560,1080], [1024,768], [390,844], [1920,1080]];

test('fullscreen pages cover the viewport and ignore backdrop clicks; ordinary dialogs still dismiss', () => {
  const { adapter, resize } = environment();
  const ctx = vm.createContext({ ...adapter, Node, UITransform: Transform, Graphics, Color,
    BlockInputEvents: class {}, CANVAS_W:1280, CANVAS_H:720, UI_ROOT_SCALE:1.5,
    MODAL_BACKDROP:new Color(), MODAL_PANEL_BG:new Color(), MODAL_PANEL_BORDER:new Color(),
    MENU_DIVIDER:new Color(), TEXT_TITLE:new Color(), TEXT_PRIMARY:new Color(), TEXT_OUTLINE:new Color(),
    MODAL_CLOSE_BG:new Color(), ICON_BTN_BG:new Color(), drawFieldPanel() {}, t: s => s,
    createMenuBackground: (parent,name,scale) => adapter.createAdaptiveFullscreenMask(parent,name,new Color(),scale).node,
  });
  const Harness = vm.runInContext(compile(`class Harness { ${method('openModal').getText(ast)} }; Harness;`),ctx);
  const h = new Harness(); h.node = new Node(); h.closeModal = () => h.closed = true;
  h.makeLabel = (parent,text,x,y,w,height) => { const r = ref(); r.node.setPosition(x,y); r.node.getComponent(Transform).setContentSize(w,height); parent.addChild(r.node); return r; };
  h.makeRectButton = (parent,x,y,w,height,color,click) => { const r = h.makeLabel(parent,'',x,y,w,height); r.click = click; return r; };
  const { panel } = h.openModal('Editor',1280,720,false);
  const backdrop = h.modalRoot.children[0];
  for (const [w,height] of sizes) {
    const size = resize(w,height);
    assert.equal(panel.getComponent(Transform).width,size.width);
    assert.equal(panel.getComponent(Transform).height,size.height);
    assert.equal(backdrop.getComponent(Transform).width,size.width);
    assert.equal(backdrop.getComponent(Transform).height,size.height);
    const event = {}; backdrop.handlers.end(event);
    assert.equal(event.propagationStopped,true);
    assert.equal(h.closed,undefined,'empty screen edges cannot discard the page');
    const back = panel.children.at(-1);
    assert.equal(back.position.x,-size.width/2+82);
    assert.equal(back.position.y,size.height/2-30);
  }
  h.modalRoot.destroy();
  h.openModal('Settings',480,500);
  h.modalRoot.children[0].handlers.end({});
  assert.equal(h.closed,true,'small dialogs retain outside-click dismissal');
});

test('editor expands its map, keeps action buttons inside screen, and preserves the draft and view', () => {
  const { adapter, resize } = environment();
  const ctx = { Color, UITransform:Transform, CANVAS_W:1280, CANVAS_H:720, UI_ROOT_SCALE:1.5,
    panel:node(), panelH:720, contentY:280, footerY:-298, saveButtonX:505, exportButtonX:332, deleteButtonX:194,
    currentLabelX:57, currentLabelW:110, gridViewportW:800, gridViewportH:480,
    gridViewport:node(), gridContent:node(), gridFrame:node(), propRoot:node(), footer:node(),
    extendUp:node(), extendDown:node(), extendLeft:node(), extendRight:node(),
    footerGraphics:new Graphics(), gridFrameGraphics:new Graphics(), MENU_DIVIDER:new Color(),
    mapHeading:ref(), currentLabel:ref(), statusLabel:ref(), editExistingBtn:ref(),
    newBtn:ref(), prevBtn:ref(), nextBtn:ref(), importBtn:ref(), randomBtn:ref(), saveBtn:ref(), exportBtn:ref(), deleteBtn:ref(),
    gridScale:1.3, draftTiles:[[{ t:'F' }]], clamps:0, clampGridPosition() { ctx.clamps++; },
  };
  const draft = ctx.draftTiles;
  ctx.gridContent.setPosition(30,-20);
  ctx.bindAdaptivePageLayout = adapter.bindAdaptivePageLayout;
  vm.runInNewContext(compile(`bindAdaptivePageLayout(panel,UI_ROOT_SCALE,${layout('openLevelEditorWorkspace').getText(ast)});`),ctx);
  for (const [w,h] of sizes) {
    const size = resize(w,h);
    assert.equal(ctx.gridViewportW,size.width-480);
    assert.equal(ctx.gridViewportH,size.height-240);
    assert.equal(ctx.saveBtn.node.position.x+105,size.width/2-30);
    assert.equal(ctx.newBtn.node.position.x-62,-size.width/2+13);
    assert.equal(ctx.extendLeft.position.x,-size.width/2+35);
    assert.equal(ctx.currentLabel.node.getComponent(Transform).width,110+size.width-1280);
    assert.equal(ctx.draftTiles,draft);
    assert.equal(ctx.gridScale,1.3);
    assert.deepEqual(ctx.gridContent.position,{ x:30,y:-20 });
  }
  assert.equal(ctx.clamps,6);
});

test('debugger resizes scroll lists in place and retains parameter inputs and scroll position', () => {
  const { adapter, resize } = environment();
  const ctx = { ...adapter, Color, UITransform:Transform, CANVAS_W:1280, CANVAS_H:720, UI_ROOT_SCALE:1.5,
    panel:node(), stage:node(), propsPanel:node(), listPanel:node(), stageG:new Graphics(), propsG:new Graphics(), listG:new Graphics(),
    MODAL_PANEL_BORDER:new Color(), MENU_DIVIDER:new Color(), drawFieldPanel() {}, debugColumnH:604, debugColumnY:-30,
    tankListViewportW:230, tankListViewportH:528, tankListRows:20, tankListRowStride:47, fieldDefs:Array(24),
    tankListViewport:node(230,528), tankListContent:node(230,956), inputViewport:node(280,540), inputRoot:node(280,932),
  };
  for (const name of ['selectedLabel','statusLabel','bodyAngleLabel','turretAngleLabel','flashBtn','hatchBtn','destroyedBtn',
    'vibrationBtn','camouflageBtn','saveConfigBtn','tankListTitle','saveHint']) ctx[name] = ref();
  for (const name of ['inputScroll','tankListScroll']) ctx[name] = { getScrollOffset: () => ({ x:0,y:93 }),
    scrollToOffset(offset) { assert.equal(offset.y,93); } };
  const input = node(); input.string = '1.25'; input.setPosition(58,444); ctx.inputRoot.addChild(input);
  vm.runInNewContext(compile(`bindAdaptivePageLayout(panel,UI_ROOT_SCALE,${layout('openTankVisualDebugger').getText(ast)});`),ctx);
  for (const [w,h] of sizes) {
    const size = resize(w,h);
    assert.equal(ctx.stage.getComponent(Transform).width,size.width-620);
    assert.equal(ctx.propsPanel.position.x,size.width/2-430);
    assert.equal(ctx.inputViewport.getComponent(Transform).height,size.height-180);
    assert.ok(ctx.inputRoot.getComponent(Transform).height >= ctx.inputViewport.getComponent(Transform).height);
    assert.equal(ctx.inputRoot.children[0],input);
    assert.equal(input.string,'1.25');
  }
  assert.equal(input.position.y,444,'returning to 16:9 cannot accumulate layout offsets');
});

test('destroying an adaptive page releases its resize listener', () => {
  const { adapter, resize } = environment(); let calls = 0;
  const page = node(); adapter.bindAdaptivePageLayout(page,1.5,() => calls++);
  resize(2560,1080); assert.equal(calls,2);
  page.destroy(); resize(1024,768); assert.equal(calls,2);
});
