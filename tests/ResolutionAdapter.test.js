const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('desktop resolution adapter preserves 16:9 content and exposes surplus screen area', () => {
  const adapter = read('assets/scripts/view/ResolutionAdapter.ts');
  assert.match(adapter, /DESIGN_RESOLUTION_WIDTH = 1920/);
  assert.match(adapter, /DESIGN_RESOLUTION_HEIGHT = 1080/);
  assert.match(adapter, /aspect >= DESIGN_ASPECT[\s\S]*?ResolutionPolicy\.FIXED_HEIGHT[\s\S]*?ResolutionPolicy\.FIXED_WIDTH/);
  assert.match(adapter, /view\.setDesignResolutionSize\(DESIGN_RESOLUTION_WIDTH, DESIGN_RESOLUTION_HEIGHT, policy\)/);
  assert.match(adapter, /view\.on\('canvas-resize', handleWindowResize\)/);
});

test('menu and battle backgrounds expand to the visible logical area', () => {
  for (const file of [
    'assets/scripts/view/MainMenuScene.ts',
    'assets/scripts/view/BattleScene.ts',
  ]) {
    const source = read(file);
    assert.match(source, /applyAdaptiveResolution\(\)/, `${file} must apply the shared policy`);
    assert.match(source, /visibleSizeInRootSpace\(UI_ROOT_SCALE\)|createMenuBackground\(this.node/, `${file} must size its background to the visible area`);
    assert.match(source, /subscribeAdaptiveResolution/, `${file} must react to window aspect changes`);
  }
});

test('all modal backdrops use the shared adaptive fullscreen mask', () => {
  const adapter = read('assets/scripts/view/ResolutionAdapter.ts');
  assert.match(adapter, /class AdaptiveFullscreenMask extends Component/);
  assert.match(adapter, /visibleSizeInRootSpace\(this\.rootScale\)/);
  assert.match(adapter, /subscribeAdaptiveResolution\(\(\) => this\.redraw\(\)\)/);
  assert.match(adapter, /graphics\.rect\(-width \* 0\.5, -height \* 0\.5, width, height\)/);
  assert.match(adapter, /onDestroy\(\)[\s\S]*?this\.resolutionUnsubscribe\?\.\(\)/);

  const menu = read('assets/scripts/view/MainMenuScene.ts');
  const battle = read('assets/scripts/view/BattleScene.ts');
  assert.match(menu, /createAdaptiveFullscreenMask\(/);
  assert.match(battle, /createAdaptiveFullscreenMask\(/);
  assert.doesNotMatch(menu, /const backdrop = new Node\('Backdrop'\)/);
  assert.doesNotMatch(battle, /const backdrop = new Node\('Backdrop'\)/);
  assert.doesNotMatch(battle, /const mask = new Node\('Mask'\)[\s\S]{0,300}?DICE_BACKDROP/);
});

test('resize dispatch keeps every page updated across aspect ratios and unsubscribes safely', () => {
  const ts = require('typescript');
  const events = new Map();
  let containerResize;
  const resized = [];
  const cc = {
    _decorator: { ccclass: () => cls => cls }, Component: class {},
    Color: class {}, Graphics: class {}, Node: class {}, UITransform: class {},
    game: { canvas: { parentElement: {} } },
    director: { root: { resize: (w,h) => resized.push([w,h]) } },
    ResolutionPolicy: { FIXED_HEIGHT: 1, FIXED_WIDTH: 2 },
    screen: { windowSize: { width: 1920, height: 1080 }, on: (name, fn) => events.set(name, fn) },
    view: {
      on: (name, fn) => events.set(name, fn), resizeWithBrowserSize() {},
      setDesignResolutionSize(w, h, policy) {
        const frame = cc.screen.windowSize;
        this.visible = policy === 1 ? { width: h * frame.width / frame.height, height: h }
          : { width: w, height: w * frame.height / frame.width };
      },
      getVisibleSize() { return this.visible; },
    },
  };
  const output = ts.transpileModule(read('assets/scripts/view/ResolutionAdapter.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, experimentalDecorators: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'ResizeObserver', output)(() => cc, module, module.exports, class {
    constructor(callback) { containerResize = callback; } observe() {}
  });
  const adapter = module.exports;
  let menu = 0, battle = 0, modal = 0;
  adapter.subscribeAdaptiveResolution(() => menu++);
  adapter.subscribeAdaptiveResolution(() => battle++);
  const remove = adapter.subscribeAdaptiveResolution(() => modal++);
  const sizes = [[1920,1080], [1884,953], [1024,768], [800,600], [2560,1080], [390,844]];
  sizes.forEach(([width,height]) => {
    cc.screen.windowSize = { width, height };
    events.get('canvas-resize')();
    const visible = adapter.visibleSizeInRootSpace(1.5);
    assert.ok(visible.width >= 1280 && visible.height >= 720);
    assert.ok(Math.abs(visible.width / visible.height - width / height) < 0.0001);
  });
  assert.deepEqual([menu,battle,modal], [6,6,6]);
  remove(); events.get('canvas-resize')();
  assert.deepEqual([menu,battle,modal], [7,7,6]);
  cc.screen.windowSize = { width: 1440, height: 900 };
  containerResize();
  assert.deepEqual(resized, [[1440,900]]);
  assert.deepEqual([menu,battle,modal], [8,8,6]);
  containerResize();
  assert.equal(resized.length, 1);
});
