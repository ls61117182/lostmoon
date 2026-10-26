const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, filename);
const water = require('../assets/scripts/view/TankWreckWater.ts');
const push = require('../assets/scripts/view/TankWreckPush.ts');
const { isTankUnit, tileHasBridge } = require('../assets/scripts/core/types.ts');
const { HexMap, neighbors } = require('../assets/scripts/core/HexGrid.ts');
const { urbanBuildingState } = require('../assets/scripts/core/UrbanTerrain.ts');
const body = (x, y = 0, angle = 0) => ({ id: 'wreck', x, y, angle, halfLength: 0.6, halfWidth: 0.3 });
const waterAt = point => point.x > 0 ? { x: 1, y: 0 } : null;

test('a hull straddling a shoreline can ground, then sink before its center enters water', () => {
  const shallow = water.sampleWreckWater(body(-0.35), waterAt);
  assert.equal(shallow.fraction, 3 / 18);
  const grounded = water.startWreckWater(body(-0.35), { x: 0, y: 0, angle: 0 }, { x: 0, y: 0 }, shallow);
  assert(grounded && !grounded.sink);
  const threshold = water.sampleWreckWater(body(-0.15), waterAt);
  assert.equal(threshold.fraction, 1 / 3);
  const falling = water.startWreckWater(body(-0.15), { x: 0, y: 0, angle: 0 }, { x: 0, y: 0 }, threshold);
  assert(falling.sink && falling.sink.slideX > 0, 'slip direction must point into water');
  assert(falling.contactX > 0, 'ripples belong on the wet side of the hull');
});

test('sampling follows all hull headings and distinguishes land, water, and missing tiles', () => {
  for (let dir = 0; dir < 6; dir++) {
    const angle = dir * Math.PI / 3, ux = Math.cos(angle), uy = Math.sin(angle);
    const hull = body(-0.15 * ux, -0.15 * uy, angle);
    assert.equal(water.sampleWreckWater(hull, p => p.x * ux + p.y * uy > 0 ? { x: ux, y: uy } : null).fraction, 1 / 3);
  }
  assert.equal(water.sampleWreckWater(body(0), () => null).fraction, 0);
  assert.equal(water.sampleWreckWater(body(0), () => ({ x: 0, y: 0 })).fraction, 1);
  assert.equal(water.startWreckWater(body(0), { x: 0, y: 0, angle: 0 }, { x: 0, y: 0 }, water.sampleWreckWater(body(0), () => null)), undefined);
});

test('sinking completes in one second without a pusher, with frame-independent pose and fading', () => {
  const initial = water.startWreckWater(body(-0.15), { x: 0.4, y: -0.2, angle: 0.1 }, { x: 0, y: 0 }, water.sampleWreckWater(body(-0.15), waterAt));
  const run = frames => {
    const state = JSON.parse(JSON.stringify(initial));
    let pose;
    for (let i = 0; i < frames; i++) pose = water.advanceWreckSinking(state, 0.5 / frames);
    return { state, pose };
  };
  const a = run(1), b = run(60);
  for (const key of ['x', 'y', 'angle']) assert(Math.abs(a.pose[key] - b.pose[key]) < 1e-9);
  const appearance = water.wreckWaterAppearance(a.state);
  assert(appearance.scale < 1 && appearance.alpha < 1 && appearance.shade < 255);
  water.advanceWreckSinking(a.state, 0.6);
  assert.equal(a.state.sink.elapsed, water.WRECK_SINK_DURATION);
  assert.equal(water.wreckWaterAppearance(a.state).alpha, 0);
  assert.equal(water.advanceWreckSinking(a.state, 0.1), null);
});

const Scene = require('./helpers/BattleSceneMethods.cjs')([
  'sampleTankWreckWater', 'syncTankWreckWater', 'advanceTankWreckWater', 'interpolatedPos',
  'advanceTankMoveTime', 'advanceTankWreckPush', 'fireEffectLevel', 'isUnitVisible', 'drawWreckWaterRipples',
  'updateTankWreckPose',
  'placeWreckRippleLayerAboveUnits',
  'syncWreckRippleWaterMask',
], { ...water, ...push, isTankUnit, effectiveDiceTerrain: require('../assets/scripts/core/types.ts').effectiveDiceTerrain, tileHasBridge, neighbors, urbanBuildingState,
  visualFireEffectLevel: () => 1, easeOutCubic: t => 1 - (1 - t) ** 3,
  Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } } });

function fixture(terrain = 'water', bridge = false) {
  const scene = new Scene();
  scene.unitEffectTime = 0;
  scene.hexSize = 100; scene.offsetX = 23; scene.offsetY = -17;
  scene.project = (q, r) => ({ x: Math.sqrt(3) * (q + r / 2) * scene.hexSize + scene.offsetX, y: -1.5 * r * scene.hexSize + scene.offsetY });
  const map = new HexMap(4, 4);
  map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
  map.set({ pos: { q: 1, r: 0 }, terrain, bridgeEnds: bridge ? [0, 3] : undefined });
  const player = { id: 'player', kind: 'sherman', pos: { q: -1, r: 0 }, facing: 0 };
  const wreck = { id: 'wreck', kind: 'sherman', pos: { q: 0, r: 0 }, facing: 0, destroyed: true,
    wreckPose: { x: 0.70, y: 0, angle: 0 } };
  scene.mission = { sherman: player, allies: [], enemies: [wreck], map };
  scene.anim = null;
  scene.wreckWaterProbe = new WeakMap(); scene.unitEffectVisuals = new Map(); scene.destroyWreckVisualIds = new Set(['wreck']);
  scene.isHexVisible = () => true;
  scene.allUnits = () => [player, wreck];
  scene.tankWreckCollisionBody = unit => {
    const c = scene.interpolatedPos(unit);
    return { ...body(c.x / scene.hexSize, c.y / scene.hexSize, unit.wreckPose?.angle ?? 0), id: unit.id };
  };
  return { scene, wreck, player };
}

test('actual hex lookup uses the visual hull across shorelines and exempts bridges', () => {
  for (const terrain of ['water', 'deep_water']) {
    const { scene, wreck } = fixture(terrain);
    scene.syncTankWreckWater(wreck);
    assert.equal(wreck.wreckWater.fraction, 1 / 3);
    assert(wreck.wreckWater.sink);
    assert.deepEqual(wreck.pos, { q: 0, r: 0 }, 'center remains logically on land');
  }
  for (const terrain of ['field', 'forest', 'urban_rubble']) {
    const { scene, wreck } = fixture(terrain);
    scene.syncTankWreckWater(wreck);
    assert.equal(wreck.wreckWater, undefined);
  }
  const { scene, wreck } = fixture('water', true);
  scene.syncTankWreckWater(wreck);
  assert.equal(wreck.wreckWater, undefined, 'bridge tiles must support the wreck');
});

test('stationary grounded wrecks cache probes, can be pushed back ashore and handle board resize', () => {
  const { scene, wreck } = fixture();
  wreck.wreckPose.x = 0.45;
  let reads = 0;
  const originalGet = scene.mission.map.get.bind(scene.mission.map);
  scene.mission.map.get = pos => { reads++; return originalGet(pos); };
  scene.syncTankWreckWater(wreck);
  assert(wreck.wreckWater && !wreck.wreckWater.sink);
  const initial = reads;
  for (let i = 0; i < 60; i++) scene.advanceTankWreckWater(1 / 60);
  assert.equal(reads, initial, 'static wrecks must not resample terrain every frame');
  scene.hexSize = 150; scene.offsetX = -90;
  scene.syncTankWreckWater(wreck);
  assert(reads > initial);
  assert(wreck.wreckWater && !wreck.wreckWater.sink);
  wreck.wreckPose.x = 0;
  scene.syncTankWreckWater(wreck);
  assert.equal(wreck.wreckWater, undefined, 'drying the hull must remove tint/ripples');
});

test('sinking extinguishes fire, finishes while idle and hides the wreck', () => {
  const { scene, wreck } = fixture();
  scene.unitEffectVisuals.set(wreck.id, { fireAlpha: 1 });
  assert.equal(scene.fireEffectLevel(wreck), 1);
  scene.advanceTankWreckWater(0.25);
  assert.equal(scene.anim, null);
  assert(wreck.wreckPose.x > 0.7, 'sliding continues with no active movement');
  assert.equal(scene.fireEffectLevel(wreck), 0);
  assert.equal(scene.unitEffectVisuals.has(wreck.id), false);
  assert.equal(scene.isUnitVisible(wreck), true);
  let strokes = 0;
  const alphas = [];
  const g = { circle() {}, stroke() { strokes++; alphas.push(this.strokeColor.a); } };
  scene.screenAlignedMapGraphics = () => g;
  scene.drawWreckWaterRipples(g);
  assert.equal(strokes, 1, 'only the first simple circular pulse should appear before the second pulse delay');
  assert(Math.max(...alphas) > 150, 'water rings must remain clearly visible during sinking');
  scene.advanceTankWreckWater(1);
  assert.equal(scene.isUnitVisible(wreck), false);
  strokes = 0;
  scene.drawWreckWaterRipples(g);
  assert(strokes > 0, 'ripples must outlive the sunken hull');
  assert.equal(scene.advanceTankWreckWater(1), false);
  strokes = 0;
  scene.drawWreckWaterRipples(g);
  assert.equal(strokes, 0, 'the water effect must eventually finish');
});

test('water rings expand visibly for 2.2 seconds and support old saves without a ripple clock', () => {
  const state = water.startWreckWater(body(-0.15), { x: 0, y: 0, angle: 0 }, { x: 0, y: 0 }, water.sampleWreckWater(body(-0.15), waterAt));
  water.advanceWreckSinking(state, 0.5);
  const early = water.wreckWaterRippleRings(state, 0, 100);
  assert.equal(early.length, 1);
  assert(early.every(ring => ring.width >= 1.5 && ring.alpha > 130));
  water.advanceWreckSinking(state, 0.6);
  const afterSinking = water.wreckWaterRippleRings(state, 0, 100);
  assert.equal(state.sink.elapsed, 1);
  assert(afterSinking[0].radius > early[0].radius);
  assert.equal(afterSinking.length, 2);
  assert(afterSinking.every(ring => ring.alpha > 80));
  water.advanceWreckSinking(state, 1.2);
  assert.deepEqual(water.wreckWaterRippleRings(state, 0, 100), []);
  const legacy = structuredClone(state);
  delete legacy.sink.rippleElapsed;
  assert.equal(water.wreckWaterRippleRings(legacy, 0, 100).length, 2);
  water.advanceWreckSinking(legacy, 0.5);
  assert.equal(legacy.sink.rippleElapsed, 1.5);
});

test('ripple visibility follows the water entry point, including after the hull becomes hidden', () => {
  const { scene, wreck } = fixture();
  scene.advanceTankWreckWater(0.4);
  let strokes = 0;
  const g = { circle() {}, stroke() { strokes++; } };
  scene.screenAlignedMapGraphics = () => g;
  scene.isUnitVisible = () => false;
  scene.isHexVisible = pos => pos.q === 1 && pos.r === 0;
  scene.drawWreckWaterRipples(g);
  assert(strokes > 0, 'visible water should still show waves even if the hull center is not visible');
  strokes = 0;
  scene.isHexVisible = () => false;
  scene.drawWreckWaterRipples(g);
  assert.equal(strokes, 0, 'genuinely hidden water must not reveal ripples');
});

test('ripples use true circles with at most two well-spaced sinking pulses and one grounded pulse', () => {
  const { scene, wreck } = fixture();
  scene.advanceTankWreckWater(0.8);
  const circles = [];
  const g = {
    circle(x, y, radius) { circles.push({ x, y, radius }); },
    ellipse() { throw new Error('overhead ripples must not be elliptical'); },
    stroke() {},
  };
  scene.drawWreckWaterRipples(g);
  assert.equal(circles.length, 2);
  assert(Math.abs(circles[0].radius - circles[1].radius) >= scene.hexSize * 0.19);
  for (let age = 0; age <= 2.3; age += 0.05) {
    wreck.wreckWater.sink.rippleElapsed = age;
    const rings = water.wreckWaterRippleRings(wreck.wreckWater, age, scene.hexSize);
    assert(rings.length <= 2);
    if (rings.length === 2) assert(Math.abs(rings[0].radius - rings[1].radius) >= scene.hexSize * 0.19);
  }
  delete wreck.wreckWater.sink;
  for (const time of [0, 0.5, 1, 2, 4, 8]) assert.equal(water.wreckWaterRippleRings(wreck.wreckWater, time, 100).length, 1);
});

test('the ripple stencil includes only open-water hexes and caches its geometry', () => {
  const { scene } = fixture();
  const map = scene.mission.map;
  map.set({ pos: { q: 2, r: 0 }, terrain: 'deep_water' });
  map.set({ pos: { q: 3, r: 0 }, terrain: 'water', bridgeEnds: [0, 3] });
  map.set({ pos: { q: -1, r: 0 }, terrain: 'forest' });
  let builds = 0;
  const stencil = scene.wreckRippleMaskGraphics = {
    hexes: [], clear() { builds++; this.hexes = []; }, fill() {},
  };
  scene.traceHexPathOn = (g, x, y) => g.hexes.push({ x, y });
  scene.syncWreckRippleWaterMask();
  assert.equal(stencil.hexes.length, 2, 'land and bridge cells must not enter the water stencil');
  assert.deepEqual(stencil.hexes, [scene.project(1, 0), scene.project(2, 0)]);
  scene.syncWreckRippleWaterMask();
  assert.equal(builds, 1, 'static terrain geometry must not rebuild per ripple frame');
  scene.hexSize = 150;
  scene.syncWreckRippleWaterMask();
  assert.equal(builds, 2);
  assert.deepEqual(stencil.hexes, [scene.project(1, 0), scene.project(2, 0)]);
  scene.mission.map = new HexMap(2, 2);
  scene.mission.map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
  scene.syncWreckRippleWaterMask();
  assert.equal(stencil.hexes.length, 0, 'a new mission must discard old water geometry');
});

test('ripple layer stays above unit layers, below the fog', () => {
  class Layer {
    constructor(parent) { this.children = []; if (parent) parent.add(this); }
    add(node) { node.parent = this; this.children.push(node); }
    getSiblingIndex() { return this.parent.children.indexOf(this); }
    setSiblingIndex(index) { const siblings = this.parent.children; siblings.splice(siblings.indexOf(this), 1); siblings.splice(index, 0, this); }
  }
  const { scene } = fixture();
  const map = scene.mapNode = new Layer();
  scene.wreckRippleNode = new Layer(map);
  scene.unitEffectNode = new Layer(map);
  const tankMask = new Layer(map);
  scene.tankContentNode = new Layer(tankMask);
  scene.unitOcclusion = { root: new Layer(map) };
  const fog = new Layer(map);
  scene.placeWreckRippleLayerAboveUnits();
  for (const anchor of [scene.unitEffectNode, tankMask, scene.unitOcclusion.root]) {
    assert(scene.wreckRippleNode.getSiblingIndex() > anchor.getSiblingIndex());
  }
  assert(scene.wreckRippleNode.getSiblingIndex() < fog.getSiblingIndex());
  const before = [...map.children];
  scene.placeWreckRippleLayerAboveUnits();
  assert.deepEqual(map.children, before, 'placing the layer repeatedly must not drift its order');
});

test('sinking wrecks neither move from pushing nor impose the 30-percent speed penalty', () => {
  const { scene, wreck, player } = fixture();
  scene.syncTankWreckWater(wreck);
  const pose = JSON.stringify(wreck.wreckPose);
  scene.anim = { unit: player, kind: 'move', fromQ: 0, fromR: 0, toQ: 1, toR: 0, t: 0, dur: 1 };
  scene.advanceTankMoveTime(scene.anim, 0.2);
  assert.equal(scene.anim.t, 0.2);
  scene.advanceTankWreckPush({ ...scene.anim, t: 1 });
  assert.equal(JSON.stringify(wreck.wreckPose), pose);
});

test('pushing across the shoreline starts a slip and releases the tank in the same movement', () => {
  const { scene, wreck, player } = fixture();
  wreck.wreckPose.x = 0.45;
  player.pos.q = -0.5;
  scene.syncTankWreckWater(wreck);
  assert(wreck.wreckWater && !wreck.wreckWater.sink);
  scene.anim = { unit: player, kind: 'move', fromQ: -0.5, fromR: 0, toQ: 1, toR: 0, t: 0, dur: 1 };
  scene.advanceTankMoveTime(scene.anim, 0.8);
  assert(wreck.wreckWater.sink, 'the pushed hull must cross the immersion threshold');
  const oldPose = JSON.stringify(wreck.wreckPose);
  const oldTime = scene.anim.t;
  scene.advanceTankMoveTime(scene.anim, 0.05);
  assert(Math.abs(scene.anim.t - oldTime - 0.05) < 1e-9, 'the tank should be free of resistance once the wreck slides off');
  assert.equal(JSON.stringify(wreck.wreckPose), oldPose, 'pushing must no longer move the sinking hull');
  scene.advanceTankWreckWater(0.2);
  assert.notEqual(JSON.stringify(wreck.wreckPose), oldPose, 'the independent sinking animation owns further motion');
});

test('partial immersion tints only the water hex footprint and the overlay resets on sinking/drying', () => {
  class UITransform { setContentSize(w, h) { this.width = w; this.height = h; } }
  class Graphics {
    clear() { this.paths = []; }
    moveTo(x, y) { this.paths.push([{ x, y }]); }
    lineTo(x, y) { this.paths.at(-1).push({ x, y }); }
    close() {}
    fill() {}
  }
  class Mask { static Type = { GRAPHICS_STENCIL: 1 }; constructor() { this.subComp = new Graphics(); } }
  class Sprite { static SizeMode = { CUSTOM: 1 }; }
  class Node {
    constructor(name) { this.name = name; this.children = []; this.components = new Map(); this.layer = 1; this.position = { x: 0, y: 0 }; this.angle = 0; }
    getChildByName(name) { return this.children.find(child => child.name === name); }
    addChild(child) { this.children.push(child); child.parent = this; }
    addComponent(Type) { const component = new Type(); this.components.set(Type, component); return component; }
    getComponent(Type) { return this.components.get(Type); }
  }
  const TintScene = require('./helpers/BattleSceneMethods.cjs')(['syncWreckWaterOverlay'], {
    Node, Mask, Sprite, UITransform, Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } },
  });
  const scene = new TintScene();
  scene.hexSize = 100; scene.wreckWaterProbe = new WeakMap();
  const unit = { destroyed: true, wreckWater: { fraction: 1 / 6 } };
  const sample = { cells: [{ x: 1.2, y: -0.4 }] };
  scene.wreckWaterProbe.set(unit, { sample });
  scene.sampleTankWreckWater = () => { throw new Error('rendering must reuse cached sampling'); };
  const node = new Node('hull'); node.position = { x: 30, y: -20 }; node.angle = 123;
  const sprite = { spriteFrame: { id: 'wreck_texture' } };
  scene.syncWreckWaterOverlay(node, sprite, unit, { w: 110, h: 70 });
  const maskNode = node.getChildByName('WreckWaterMask');
  assert.equal(maskNode.active, true);
  const wet = maskNode.getChildByName('SubmergedHullTint').getComponent(Sprite);
  assert.equal(wet.spriteFrame, sprite.spriteFrame, 'tint uses the wreck alpha silhouette, not a filled hull rectangle');
  const vertices = maskNode.getComponent(Mask).subComp.paths[0];
  assert.equal(vertices.length, 6);
  const angle = node.angle * Math.PI / 180;
  vertices.forEach((point, i) => {
    const x = node.position.x + point.x * Math.cos(angle) - point.y * Math.sin(angle);
    const y = node.position.y + point.x * Math.sin(angle) + point.y * Math.cos(angle);
    assert(Math.abs(x - (1.2 + Math.cos(Math.PI / 6 + i * Math.PI / 3)) * 100) < 1e-8);
    assert(Math.abs(y - (-0.4 + Math.sin(Math.PI / 6 + i * Math.PI / 3)) * 100) < 1e-8);
  });
  unit.wreckWater.sink = { elapsed: 0.1 };
  scene.syncWreckWaterOverlay(node, sprite, unit, { w: 110, h: 70 });
  assert.equal(maskNode.active, false);
  unit.wreckWater = undefined;
  scene.syncWreckWaterOverlay(node, sprite, unit, { w: 110, h: 70 });
  assert.equal(maskNode.active, false);
});

test('water state round-trips while sinking and older checkpoints clear it', () => {
  const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
  const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
  const data = JSON.parse(fs.readFileSync('assets/resources/missions/mission_03.json', 'utf8'));
  const mission = loadMission(data);
  const initial = water.startWreckWater(body(-0.15), { x: 0.7, y: 0, angle: 0 }, { x: 0, y: 0 }, water.sampleWreckWater(body(-0.15), waterAt));
  const units = [mission.sherman, ...mission.allies, ...mission.enemies];
  for (const unit of units) {
    unit.destroyed = true; unit.wreckWater = structuredClone(initial);
    unit.wreckPose = water.advanceWreckSinking(unit.wreckWater, 0.4);
  }
  const saved = captureSave({ gameMode: 'hardcore', missionId: data.id, mission, turn: 1, phase: 'player',
    movesLeft: 2, attacksLeft: 1, miscDone: false, playerStep: 'choose', hatchChangedThisTurn: false, phaseDice: [] });
  const json = JSON.parse(JSON.stringify(saved));
  const restored = loadMission(data);
  assert.equal(applySave(restored, data.id, json).ok, true);
  const loaded = [restored.sherman, ...restored.allies, ...restored.enemies];
  loaded.forEach((unit, i) => {
    assert.deepEqual(unit.wreckWater, units[i].wreckWater);
    assert.deepEqual(water.advanceWreckSinking(unit.wreckWater, 0.6), water.advanceWreckSinking(structuredClone(units[i].wreckWater), 0.6));
  });
  loaded[0].wreckWater.sink.slideX = 99;
  assert.notEqual(json.playerTank.wreckWater.sink.slideX, 99, 'save must own a deep copy');
  for (const unit of [json.playerTank, json.sherman, ...json.allies, ...json.enemies]) delete unit.wreckWater;
  assert.equal(applySave(restored, data.id, json).ok, true);
  loaded.forEach(unit => assert.equal(unit.wreckWater, undefined));
});
