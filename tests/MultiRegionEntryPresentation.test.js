const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText, filename);
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
const grid = require('../assets/scripts/core/HexGrid.ts');
const { buildFogMask } = require('../assets/scripts/view/FogMaskRaster.ts');
const { UnitAnimationCache } = require('../assets/scripts/view/UnitAnimationCache.ts');
class UITransform { setContentSize() {} }
class Graphics {}
class Node {
  children = []; components = new Map(); isValid = true; position = { x: 0, y: 0, z: 0 };
  addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
  addChild(node) { node.parent = this; this.children.push(node); }
  setPosition(x, y, z) { this.position = { x, y, z }; }
}
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const Scene = sceneMethods(['isRegionalBoundaryMove', 'isOutsidePlayerRegion', 'isUnitVisible', 'drawPresentedUnit',
  'redrawAnimatedUnits', 'interpolatedPos', 'redrawFogOverlay', 'beginTankTrackAnimation'], {
  Node, Graphics, UITransform, GameSession: { gameMode: 'hardcore' }, WRECK_SINK_DURATION: 5,
  ...grid, easeOutCubic, isHeavyArtilleryUnit: () => false, isTankUnit: () => true,
  clearLockedFire() {}, fogOfWarEnabled: mode => mode !== 'classic', FOG_OVERLAY_COLOR: { a: 145 },
});
const tank = (id, q) => ({ id, kind: 'panzer4', pos: { q, r: 0 } });
function fixture(from = 1, to = 0) {
  const scene = new Scene(), player = tank('player', 0), unit = tank('crossing', from), map = {
    sameRegion: (a, b) => (a.q <= 0) === (b.q <= 0),
  };
  Object.assign(scene, { node: new Node(), mission: { data: { multiRegion: {} }, map, sherman: player },
    anim: { unit, kind: 'move', fromQ: from, fromR: 0, toQ: to, toR: 0, t: 0 },
    g: new Node().addComponent(Graphics), unitFallbackGraphics: new Map(), suppressionMarkPoolNext: 0,
    isHexVisible: pos => pos.q <= 0, drawUnitMaybeAnim() {}, captureSilhouetteSources() {},
    unitFogRenderer: { ready: true, bind() {} }, project: (q, r) => grid.axialToPixel({ q, r }, 60),
  });
  return { scene, unit, map };
}

test('entry and exit submit the moving body to a hidden-padding shader before logical arrival; remote moves stay absent', () => {
  for (const [from, to] of [[1, 0], [0, 1]]) {
    const { scene, unit } = fixture(from, to), policies = [];
    scene.unitFogRenderer.bind = (_renderer, policy) => policies.push(policy);
    let draws = 0; scene.drawUnitMaybeAnim = () => draws++;
    assert.equal(scene.isRegionalBoundaryMove(unit), true);
    scene.drawPresentedUnit(unit);
    assert.equal(draws, 1);
    assert.deepEqual(policies, ['hidden'], 'both directions clip every pixel outside the region');
    assert.equal(unit.pos.q, from, 'rendering must not commit movement rules early');
    assert.equal(scene.isUnitVisible(unit), from === 0, 'rules/UI visibility still uses the logical cell');
    scene.anim = null; scene.drawPresentedUnit(unit);
    assert.equal(draws, from === 0 ? 2 : 1, 'an off-region stationary body never renders');
  }
  const { scene, unit } = fixture(2, 1);
  scene.drawUnitMaybeAnim = () => assert.fail('remote-to-remote body was submitted');
  assert.equal(scene.isRegionalBoundaryMove(unit), false);
  scene.drawPresentedUnit(unit);
});

test('60 crossing frames move cached hull/turret nodes continuously, with no scenery or vision recomputation', () => {
  const { scene, unit, map } = fixture(), cache = new UnitAnimationCache();
  const hull = new Node(), turret = new Node();
  const start = scene.interpolatedPos(unit);
  hull.setPosition(start.x, start.y, 0); turret.setPosition(start.x, start.y, 0);
  cache.record(unit, start, [hull, turret], {});
  cache.entries.get(unit).visible = false;
  Object.assign(scene, { unitAnimationCache: cache, sceneryCacheMap: map, mainGunRecoils: new Map(), engineVibrationVisuals: [],
    redraw: () => assert.fail('crossing animation triggered full redraw'),
    syncUnitOcclusion() {}, redrawObjectShadows() {}, syncActiveActingUnitFrame() {}, drawUnitEffects() {},
  });
  let previous = hull.position.x;
  for (let frame = 1; frame <= 60; frame++) {
    scene.anim.t = frame / 60; scene.redrawAnimatedUnits();
    const target = scene.interpolatedPos(unit);
    assert(Math.abs(hull.position.x - target.x) < 1e-8);
    assert.equal(turret.position.x, hull.position.x);
    assert(hull.position.x < previous); previous = hull.position.x;
  }
  assert.equal(unit.pos.q, 1);
});

test('the shared footprint reveals the leading body pixels before the rear; an unseen destination remains invisible', () => {
  const clear = buildFogMask([{ x: 0, y: 0, from: 0, to: 0 }]);
  const hidden = buildFogMask([{ x: 0, y: 0, from: 1, to: 1 }]);
  const sample = (data, x, y, channel) => {
    const px = Math.floor((x - data.left) / data.spanX * data.width);
    const py = Math.floor((data.top - y) / data.spanY * data.height);
    if (px < 0 || px >= data.width || py < 0 || py >= data.height) return 0;
    return data.pixels[(py * data.width + px) * 4 + channel] / 255;
  };
  const visibility = (data, x) => (1 - sample(data, x, 0, 0)) * sample(data, x, 0, 2);
  // A body straddling the boundary at x=sqrt(3)/2: front is already in the current tile.
  const edge = Math.sqrt(3) / 2;
  assert.equal(visibility(clear, edge - .3), 1);
  assert.equal(visibility(clear, edge + .3), 0);
  for (const x of [0, edge - .3, edge + .3]) assert.equal(visibility(hidden, x), 0);
});

test('classic multi-region mode keeps the shared clipping mask enabled while leaving the terrain fog overlay off', () => {
  // Use the real method with a classic-mode rule source.
  const Classic = sceneMethods(['redrawFogOverlay'], {
    ...grid, GameSession: { gameMode: 'classic' }, fogOfWarEnabled: () => false, FOG_OVERLAY_COLOR: { a: 145 },
  });
  const scene = new Classic(), states = [], bindings = []; let cells;
  Object.assign(scene, { mission: { data: { multiRegion: {} }, map: { all: () => [{ pos: { q: 0, r: 0 } }, { pos: { q: 1, r: 0 } }] } },
    fogGraphics: { clear() {} }, fogNode: { setSiblingIndex() {} }, mapNode: { children: [] },
    transientFogRevealKeys: new Set(), isDeepShadowTile: tile => tile.pos.q === 1,
    fogOverlayRenderer: { draw(value) { cells = value; return true; }, getUnitFogState: () => ({ texture: {} }) },
    tankTrackGraphics: {}, unitFogRenderer: { bind: (renderer, policy) => bindings.push(policy), update: (_state, enabled) => states.push(enabled) },
    redrawTurretAimOverlay() {}, redrawSupportMarkers() {},
  });
  scene.redrawFogOverlay();
  assert.equal(scene.fogNode.active, false);
  assert.deepEqual(Array.from(cells, cell => [cell.from, cell.to]), [[0, 0]]);
  assert.deepEqual(states, [true]); assert.deepEqual(bindings, ['hidden']);
});

test('loading the boundary shader cannot leave tracks ahead of an absent body', () => {
  const { scene, unit } = fixture();
  let draws = 0, tracks = 0;
  scene.drawUnitMaybeAnim = () => draws++;
  scene.addTankTrack = () => { tracks++; return {}; };
  scene.unitFogRenderer.ready = false;
  scene.drawPresentedUnit(unit); scene.beginTankTrackAnimation(scene.anim);
  assert.equal(draws, 0); assert.equal(tracks, 0);
  scene.unitFogRenderer.ready = true;
  scene.drawPresentedUnit(unit); scene.beginTankTrackAnimation(scene.anim);
  assert.equal(draws, 1); assert.equal(tracks, 1);
});
