const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText, file);
const visuals = require('../assets/scripts/core/TankVisualDB.ts');
const camo = require('../assets/scripts/core/TankCamouflage.ts');
const { isTankKind } = require('../assets/scripts/core/types.ts');
const source = fs.readFileSync('assets/scripts/view/MainMenuScene.ts', 'utf8');
const ast = ts.createSourceFile('MainMenuScene.ts', source, ts.ScriptTarget.Latest, true);
function find(predicate) {
  let result;
  function visit(n) { if (!result && predicate(n)) result = n; ts.forEachChild(n, visit); }
  visit(ast); assert.ok(result); return result;
}
const initializer = name => find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === name).initializer;
const fn = name => find(n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(ast);
const compiled = ts.transpileModule([
  `const frameKey = ${initializer('frameKey').getText(ast)};`,
  `const loadTankFrames = ${initializer('loadTankFrames').getText(ast)};`,
  fn('refreshCamouflageButton'), fn('refreshPreview'),
  `const clickCamouflage = ${initializer('camouflageBtn').arguments[6].getText(ast)};`,
  '({ loadTankFrames, refreshPreview, refreshCamouflageButton, clickCamouflage });',
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2019 } }).outputText;
class Node {
  constructor() { this.isValid = true; this.layer = 1; }
  addComponent() { return { setContentSize() {} }; }
  addChild() {}
  removeAllChildren() {}
}
function setup() {
  const pending = [], sprites = [];
  const kind = 'tiger', geometry = visuals.splitTankGeometryConfigOf(kind);
  const draft = { ...visuals.tankVisualConfigOf(kind), ...visuals.splitTankVisualConfigOf(kind), turretPivotX: geometry.pivot.bodyX, turretPivotY: geometry.pivot.bodyY };
  const ctx = vm.createContext({ ...visuals, ...camo, isTankKind, Node, UITransform: class {}, Graphics: class {}, SpriteFrame: class {},
    selectedKind: kind, showLateWarCamouflage: false, showDestroyed: false, frames: {}, drafts: { tiger: draft, sherman: draft },
    lateWarKindSet: new Set(camo.GERMAN_LATE_WAR_VISUAL_KINDS), splitKindSet: new Set(visuals.SPLIT_TANK_KINDS),
    previewRoot: new Node(), engineVibrationLayer: null, exhaustPreviewGraphics: null,
    hexR: 185, bodyAngleDeg: 35, turretAngleDeg: 90, lastPivot: { x: 0, y: 0 },
    commanderHatchState: 'closed', commanderHatchFrames: {}, showMuzzleFlash: false,
    selectedLabel: {}, bodyAngleLabel: {}, turretAngleLabel: {}, statusLabel: {},
    camouflageBtn: { label: {}, redraw() {} },
    MODE_BTN_ACTIVE: 'active', MODE_BTN_IDLE: 'idle', TEXT_DISABLED: 'disabled', TEXT_TITLE: 'title', TEXT_PRIMARY: 'primary',
    tankVisualAssetName: k => k, drawHex() {}, drawTankExhaustPreview() {}, addExhaustPortDots() {}, addPivotDot() {},
    normalizeAngleDeg: n => n,
    angleVec: deg => ({ deg, ux: Math.cos(deg * Math.PI / 180), uy: Math.sin(deg * Math.PI / 180) }),
    addSprite: (parent, sf, ...transform) => sprites.push({ path: sf.path, transform }),
    getUnitStats: () => ({}),
    resources: { load: (path, Type, callback) => pending.push({ path, callback }) },
  });
  const api = vm.runInContext(compiled, ctx);
  const flush = (failed = false) => {
    const batch = pending.splice(0).reverse();
    for (const request of batch) request.callback(failed ? new Error('not imported') : null,
      failed ? null : { path: request.path, rect: { width: 150, height: 80 }, width: 150, height: 80 });
  };
  return { ctx, api, pending, sprites, flush, draft };
}
test('debugger switches normal layers and wrecks together, retaining angles, transforms and parameter drafts', () => {
  const { ctx, api, pending, sprites, flush, draft } = setup();
  api.loadTankFrames('tiger'); flush();
  sprites.length = 0; api.refreshPreview();
  const grey = sprites.slice();
  assert.equal(grey.length, 2);
  assert.ok(grey.every(s => !s.path.includes('/late_war/')));
  const originalDraft = JSON.stringify(draft);
  api.clickCamouflage();
  assert.equal(pending.length, 4);
  assert.equal(ctx.camouflageBtn.label.string, '配色：后期三色迷彩');
  flush(); sprites.length = 0; api.refreshPreview();
  assert.equal(sprites.length, 2);
  assert.ok(sprites.every(s => s.path.includes('/late_war/')));
  assert.deepEqual(sprites.map(s => s.transform), grey.map(s => s.transform));
  assert.equal(JSON.stringify(draft), originalDraft);
  ctx.showDestroyed = true; sprites.length = 0; api.refreshPreview();
  assert.equal(sprites.length, 1);
  assert.match(sprites[0].path, /late_war\/tiger_top_destroyed/);
  api.clickCamouflage(); sprites.length = 0; api.refreshPreview();
  assert.match(sprites[0].path, /units\/tiger_top_destroyed/);
  assert.equal(pending.length, 0, 'returning to grey reuses the original cache');
  assert.equal(ctx.bodyAngleDeg, 35); assert.equal(ctx.turretAngleDeg, 90);
  ctx.selectedKind = 'sherman'; api.refreshCamouflageButton();
  assert.equal(ctx.camouflageBtn.label.color, 'disabled');
  api.clickCamouflage(); assert.equal(pending.length, 0);
});
test('failed alternate imports are reported, cannot show a grey wreck as camouflage, and can be retried', () => {
  const { ctx, api, pending, sprites, flush } = setup();
  api.loadTankFrames('tiger'); flush();
  ctx.showDestroyed = true;
  api.clickCamouflage(); flush(true); sprites.length = 0; api.refreshPreview();
  assert.equal(sprites.length, 0);
  assert.match(ctx.statusLabel.string, /加载失败/);
  api.clickCamouflage(); api.clickCamouflage();
  assert.equal(pending.length, 4, 'toggling after a failed import retries the alternate assets');
  flush(); sprites.length = 0; api.refreshPreview();
  assert.match(sprites[0].path, /late_war\/tiger_top_destroyed/);
});
