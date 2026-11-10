const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText, file);
const visuals = require('../assets/scripts/core/TankVisualDB.ts');
const camo = require('../assets/scripts/core/TankCamouflage.ts');
const { isTankKind } = require('../assets/scripts/core/types.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const footprint = require('../assets/scripts/core/UnitFootprint.ts');
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
  `const drawHex = ${initializer('drawHex').getText(ast)};`,
  fn('refreshCamouflageButton'), fn('refreshTankRidersButton'), fn('refreshPreview'),
  `const clickCamouflage = ${initializer('camouflageBtn').arguments[6].getText(ast)};`,
  `const clickTankRiders = ${initializer('tankRidersBtn').arguments[6].getText(ast)};`,
  '({ loadTankFrames, refreshPreview, refreshCamouflageButton, refreshTankRidersButton, clickCamouflage, clickTankRiders });',
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2019 } }).outputText;
class Node {
  constructor(name) { this.name = name; this.isValid = true; this.layer = 1; this.children = []; }
  addComponent(Type) {
    const component = new Type();
    if (component.setContentSize) this.transform = component;
    else this.graphics = component;
    return component;
  }
  getComponent() { return this.transform ??= { setContentSize(w, h) { this.width = w; this.height = h; } }; }
  setPosition(x, y) { this.position = { x, y }; }
  setScale(x, y) { this.scale = { x, y }; }
  addChild(child) { this.children.push(child); }
  removeAllChildren() { this.children = []; }
}
class Graphics {
  constructor() { this.points = []; }
  moveTo(x, y) { this.points.push({ x, y }); }
  lineTo(x, y) { this.points.push({ x, y }); }
  close() {} fill() {} stroke() {}
}
function setup(kind = 'tiger') {
  const pending = [], sprites = [], riderDraws = [];
  const geometry = visuals.splitTankGeometryConfigOf(kind);
  const draft = { ...visuals.tankVisualConfigOf(kind), ...visuals.splitTankVisualConfigOf(kind), turretPivotX: geometry.pivot.bodyX, turretPivotY: geometry.pivot.bodyY };
  const ctx = vm.createContext({ ...visuals, ...camo, isTankKind, Node, node: new Node(),
    UITransform: class { setContentSize(w, h) { this.width = w; this.height = h; } }, Graphics,
    Color: class { constructor(...rgba) { this.rgba = rgba; } }, SpriteFrame: class {},
    makeLabel(parent, text, x, y) { const label = new Node('Label'); label.text = text; label.setPosition(x, y); parent.addChild(label); },
    selectedKind: kind, showLateWarCamouflage: false, showDestroyed: false, frames: {}, drafts: { [kind]: draft, sherman: draft },
    lateWarKindSet: new Set(camo.GERMAN_LATE_WAR_VISUAL_KINDS), splitKindSet: new Set(visuals.SPLIT_TANK_KINDS),
    previewRoot: new Node(), engineVibrationLayer: null, exhaustPreviewGraphics: null,
    hexR: 185, bodyAngleDeg: 35, turretAngleDeg: 90, lastPivot: { x: 0, y: 0 },
    commanderHatchState: 'closed', commanderHatchFrames: {}, showMuzzleFlash: false,
    machineGunPick: null, machineGunTransforms: {}, machineGunPickBtn: { label: {}, redraw() {} },
    machineGunHint: {}, addMachineGunPorts() {},
    showTankRiders: false, tankRiderDoubleSide: 'right', tankRidersBtn: { label: {}, redraw() {} },
    tankRiderRenderer: { clear() { riderDraws.length = 0; },
      drawPreview(id, hull, doubleSide, kind) { riderDraws.push({ id, hull, doubleSide, kind, spriteCount: sprites.length }); } },
    selectedLabel: {}, bodyAngleLabel: {}, turretAngleLabel: {}, statusLabel: {},
    camouflageBtn: { label: {}, redraw() {} },
    MODE_BTN_ACTIVE: 'active', MODE_BTN_IDLE: 'idle', TEXT_DISABLED: 'disabled', TEXT_TITLE: 'title', TEXT_PRIMARY: 'primary',
    tankVisualAssetName: k => k, drawTankExhaustPreview() {}, addExhaustPortDots() {}, addPivotDot() {},
    normalizeAngleDeg: n => n,
    angleVec: deg => ({ deg, ux: Math.cos(deg * Math.PI / 180), uy: Math.sin(deg * Math.PI / 180) }),
    addSprite: (parent, sf, ...transform) => {
      const sprite = { path: sf.path, transform }; sprites.push(sprite); return sprite;
    },
    getUnitStats,
    seatedInfantryKindForFaction: require('../assets/scripts/view/TankRiderVisual.ts').seatedInfantryKindForFaction,
    resources: { load: (path, Type, callback) => pending.push({ path, callback }) },
  });
  const api = vm.runInContext(compiled, ctx);
  const flush = (failed = false) => {
    const batch = pending.splice(0).reverse();
    for (const request of batch) request.callback(failed ? new Error('not imported') : null,
      failed ? null : { path: request.path, rect: { width: 150, height: 80 }, width: 150, height: 80 });
  };
  return { ctx, api, pending, sprites, riderDraws, flush, draft };
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

test('Maus debugger shows two adjacent runtime cells around the hull midpoint at the configured scale', () => {
  const { ctx, api, sprites, flush, draft } = setup('maus');
  api.loadTankFrames('maus'); flush();
  const radius = ctx.hexR;
  for (let facing = 0; facing < 6; facing++) {
    ctx.bodyAngleDeg = -60 * facing;
    sprites.length = 0; api.refreshPreview();
    const cells = ctx.previewRoot.children.filter(n => n.name.startsWith('DebugHex_'));
    assert.equal(cells.length, 2);
    const unit = { stats: getUnitStats('maus'), pos: { q: 0, r: 0 }, facing };
    const project = ({ q, r }) => ({ x: radius * Math.sqrt(3) * (q + r / 2), y: -radius * 1.5 * r });
    const center = project(footprint.unitCenterHex(unit));
    for (const [i, pos] of footprint.unitOccupiedHexes(unit).entries()) {
      const expected = project(pos);
      assert(Math.abs(cells[i].position.x - (expected.x - center.x)) < 1e-8);
      assert(Math.abs(cells[i].position.y - (expected.y - center.y)) < 1e-8);
    }
    assert.equal(cells[0].children[0].text, '前格');
    assert.equal(cells[1].children[0].text, '后格（炮塔）');
    const scale = radius * 1.8 * draft.hullFitScale / Math.max(
      visuals.splitTankGeometryConfigOf('maus').topTrim.w, visuals.splitTankGeometryConfigOf('maus').topTrim.h);
    assert(Math.abs(sprites[0].transform[0] - visuals.splitTankGeometryConfigOf('maus').topTrim.w * scale) < 1e-8);
    assert(Math.abs(sprites[0].transform[2] - radius * Math.sqrt(3) *
      (draft.hullOffsetForward * Math.cos(ctx.bodyAngleDeg * Math.PI / 180)
        + draft.hullOffsetRight * Math.sin(ctx.bodyAngleDeg * Math.PI / 180))) < 1e-8);
    assert.equal(ctx.previewRoot.scale.x, 1);
    assert.equal(ctx.previewRoot.scale.y, 1);
    for (const cell of cells) for (const point of cell.graphics.points) {
      assert(Math.abs(Math.hypot(point.x, point.y) * ctx.previewRoot.scale.x - radius) < 1e-8);
    }
  }
  ctx.bodyAngleDeg = 37; api.refreshPreview();
  const cells = ctx.previewRoot.children.filter(n => n.name.startsWith('DebugHex_'));
  const shared = cells[0].graphics.points.filter(a => cells[1].graphics.points.some(b =>
    Math.hypot(a.x + cells[0].position.x - b.x - cells[1].position.x,
      a.y + cells[0].position.y - b.y - cells[1].position.y) < 1e-8));
  assert.equal(shared.length, 2, 'freely rotating the preview keeps the cells joined by a full edge');
  ctx.showDestroyed = true; api.refreshPreview();
  assert.equal(ctx.previewRoot.children.filter(n => n.name.startsWith('DebugHex_')).length, 2);
  api.loadTankFrames('sherman'); flush();
  ctx.selectedKind = 'sherman'; api.refreshPreview();
  assert.equal(ctx.previewRoot.children.filter(n => n.name.startsWith('DebugHex')).length, 1);
  assert.equal(ctx.previewRoot.scale.x, 1, 'ordinary and two-hex tanks share the same preview zoom');
  const ordinaryHex = ctx.previewRoot.children.find(n => n.name === 'DebugHex');
  for (const point of ordinaryHex.graphics.points) {
    assert(Math.abs(Math.hypot(point.x, point.y) * ctx.previewRoot.scale.x - radius) < 1e-8);
  }
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

test('rider toggle shares the hull renderer, preserves drafts and hides riders on wrecks and non-tanks', () => {
  const { ctx, api, sprites, riderDraws, flush, draft } = setup();
  ctx.Math = Object.create(Math); ctx.Math.random = () => 0.1;
  api.loadTankFrames('tiger'); flush();
  const before = JSON.stringify(draft);
  sprites.length = 0; api.clickTankRiders();
  assert.equal(ctx.showTankRiders, true);
  assert.equal(ctx.tankRidersBtn.label.string, '卸载步兵');
  assert.equal(riderDraws.length, 1);
  assert.equal(riderDraws[0].doubleSide, 'left');
  assert.equal(riderDraws[0].kind, 'german_infantry');
  assert.match(riderDraws[0].hull.path, /tiger_top_hull/);
  assert.equal(riderDraws[0].spriteCount, 1, 'riders attach to the hull before the turret is drawn');
  ctx.turretAngleDeg = 135; sprites.length = 0; api.refreshPreview();
  assert.equal(riderDraws[0].doubleSide, 'left', 'turning/redrawing must preserve the boarding side');
  assert.equal(riderDraws[0].hull.transform[4], ctx.bodyAngleDeg + 180, 'rider carrier keeps body angle');
  assert.equal(JSON.stringify(draft), before);
  ctx.showDestroyed = true; sprites.length = 0; api.refreshPreview();
  assert.equal(riderDraws.length, 0);
  assert.equal(ctx.tankRidersBtn.label.string, '击毁时不可搭乘');
  api.clickTankRiders(); assert.equal(ctx.showTankRiders, true, 'disabled click does not change preview preference');
  ctx.showDestroyed = false; sprites.length = 0; api.refreshPreview();
  assert.equal(riderDraws.length, 1);
  api.clickTankRiders(); assert.equal(riderDraws.length, 0);
  assert.equal(ctx.tankRidersBtn.label.string, '搭乘步兵');
  ctx.Math.random = () => 0.9; api.clickTankRiders();
  assert.equal(riderDraws[0].doubleSide, 'right', 'boarding again can choose the opposite side');
  api.clickTankRiders();
  ctx.selectedKind = 'at_gun'; api.refreshTankRidersButton(); api.clickTankRiders();
  assert.equal(ctx.showTankRiders, false);
  assert.equal(ctx.tankRidersBtn.label.color, 'disabled');
});

test('fixed-gun tank preview also attaches riders to its body sprite', () => {
  const { ctx, api, sprites, riderDraws, flush, draft } = setup();
  ctx.selectedKind = 'su152';
  ctx.drafts.su152 = { ...draft, ...visuals.tankVisualConfigOf('su152') };
  api.loadTankFrames('su152'); flush();
  sprites.length = 0; api.clickTankRiders();
  assert.equal(riderDraws.length, 1);
  assert.match(riderDraws[0].hull.path, /su152_top/);
  assert.equal(riderDraws[0].hull.transform[4], ctx.bodyAngleDeg + 180);
  assert.equal(ctx.tankRidersBtn.label.string, '卸载步兵');
});
