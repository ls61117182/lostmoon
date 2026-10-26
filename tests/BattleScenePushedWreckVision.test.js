const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, filename);
const { HexMap, neighbors, offsetToAxial, axialToPixel } = require('../assets/scripts/core/HexGrid.ts');
const { isTankUnit } = require('../assets/scripts/core/types.ts');
const { wreckVisualHex, pushTankWrecks, WRECK_PUSH_STEP } = require('../assets/scripts/view/TankWreckPush.ts');
const { urbanBuildingState } = require('../assets/scripts/core/UrbanTerrain.ts');
const { wreckWaterAppearance, WRECK_SINK_DURATION } = require('../assets/scripts/view/TankWreckWater.ts');
class UITransform { setContentSize() {} }
class Graphics {
  clear() { this.hexes = []; this.polygons = []; }
  moveTo(x, y) { this.polygons.push([{ x, y }]); }
  lineTo(x, y) { this.polygons.at(-1).push({ x, y }); }
  close() {}
  fill() {}
}
class Node {
  constructor(name = '') { this.name = name; this.children = []; this.components = new Map(); this.active = true; this.layer = 1; this.position = { x: 0, y: 0 }; this.scale = { x: 1, y: 1 }; }
  getChildByName(name) { return this.children.find(n => n.name === name); }
  addComponent(Type) { const component = new Type(); component.node = this; this.components.set(Type, component); return component; }
  getComponent(Type) { return this.components.get(Type); }
  addChild(node) { this.insertChild(node, this.children.length); }
  insertChild(node, index) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = this; this.children.splice(index, 0, node);
  }
  getSiblingIndex() { return this.parent.children.indexOf(this); }
  setSiblingIndex(index) { this.parent.insertChild(this, index); }
  setPosition(point) { this.position = { ...point }; }
  setScale(scale) { this.scale = { ...scale }; }
}
class Color { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } }
const Scene = require('./helpers/BattleSceneMethods.cjs')([
  'tankWreckVisualLayer',
  'redrawUnitVisibilityMask', 'redrawVisibleHexMask', 'updateTankWreckPose',
  'isUnitVisible', 'isHexVisible', 'fogOverlayAlpha', 'captureSilhouetteSources', 'syncTankDamageOverlay',
  'advanceTankWreckPush', 'interpolatedPos', 'drawPresentedUnit',
], { Node, Graphics, UITransform, Color, HexMap, neighbors, isTankUnit,
  wreckVisualHex, wreckWaterAppearance, WRECK_SINK_DURATION,
  pushTankWrecks, WRECK_PUSH_STEP, urbanBuildingState, easeOutCubic: t => 1 - (1 - t) ** 3,
  FOG_OVERLAY_COLOR: { a: 145 }, GameSession: { gameMode: 'classic' }, fogOfWarEnabled: () => true,
  ensureTankTrackDamage: () => ({ side: 'left', position: 0.5 }), drawSlippedTankTrack: () => {},
});

function fixture() {
  const scene = new Scene();
  scene.node = { layer: 1 }; scene.hexSize = 1;
  const map = new HexMap(4, 1);
  for (let q = 0; q < 4; q++) map.set({ pos: { q, r: 0 }, terrain: 'field' });
  const unit = (id, q, destroyed) => ({ id, pos: { q, r: 0 }, kind: 'sherman', destroyed });
  const known = unit('known', 0, true), unseen = unit('unseen', 1, true), live = unit('live', 1, false);
  scene.mission = { data: {}, sherman: unit('player', 0, false), allies: [], enemies: [known, unseen, live], map };
  scene.allUnits = () => [scene.mission.sherman, ...scene.mission.enemies];
  scene.visibleHexKeys = new Set(['0,0', '1,0', '2,0']);
  scene.transientFogRevealKeys = new Set();
  scene.fogVisionTransition = { expanding: true, displayedHexKeys: new Set(['0,0']), activeLayer: new Set(['1,0']),
    pendingLayers: [['2,0']], elapsed: 0.5, layerInterval: 1 };
  scene.project = (q, r) => ({ x: q, y: r });
  scene.traceHexPathOn = (g, x, y) => g.hexes.push(`${x},${y}`);
  scene.playerTankEvacVisibilityExtension = () => null;
  scene.tankVisibilityGraphics = new Graphics();
  scene.unitVisibilityMaskGraphics = new Graphics();
  scene.trackVisibilityMaskGraphics = new Graphics();
  scene.silhouetteVisibilityGraphics = new Graphics();
  scene.mapNode = new Node('map');
  scene.roofs = new Node('roofs'); scene.liveMask = new Node('live'); scene.foliage = new Node('foliage'); scene.fog = new Node('fog');
  for (const node of [scene.roofs, scene.liveMask, scene.foliage, scene.fog]) scene.mapNode.addChild(node);
  scene.tankWreckLayer = new Node('normalWrecks'); scene.liveMask.addChild(scene.tankWreckLayer);
  scene.tankContentNode = new Node('liveContent'); scene.liveMask.addChild(scene.tankContentNode);
  scene.tankWreckTrackLayer = new Node('normalWreckTracks'); scene.tankWreckLayer.addChild(scene.tankWreckTrackLayer);
  scene.infantryContentNode = new Node('infantry');
  scene.enemyTopSpritePool = [{ sprite: { node: new Node('pooled') } }];
  scene.commanderHatchSpritePool = []; scene.infantryTopSpritePool = []; scene.officerTopSpritePool = [];
  scene.silhouetteClaimed = new Set(); scene.silhouetteSources = new Map();
  scene.unitSilhouetteColor = () => null; scene.shouldDisplayUnitOutline = () => false;
  scene.tankDamageTrackNodes = new Map(); scene.tankBodyDisplaySizePx = () => ({ length: 1, width: 0.6 });
  return { scene, known, unseen, live, sprite: scene.enemyTopSpritePool[0].sprite };
}

test('pushing a visible wreck into an unseen hex hides it until vision arrives', () => {
  const { scene, known } = fixture();
  scene.fogVisionTransition = null;
  scene.visibleHexKeys = new Set(['0,0']);
  scene.anim = { kind: 'move', unit: scene.mission.sherman };
  assert.equal(scene.isUnitVisible(known), true);
  scene.updateTankWreckPose(known, { x: 1.1, y: 0, angle: 0 });
  assert.equal(scene.isUnitVisible(known), false);
  // Repeated solver steps must not remember visibility from before the push.
  scene.updateTankWreckPose(known, { x: 1.2, y: 0, angle: 0.1 });
  assert.equal(scene.isUnitVisible(known), false);
  scene.redrawUnitVisibilityMask();
  assert.deepEqual(scene.trackVisibilityMaskGraphics.hexes, ['0,0']);
  assert.equal(scene.trackVisibilityMaskGraphics.polygons.length, 0);
  scene.visibleHexKeys.add('1,0');
  scene.anim = null;
  assert.equal(scene.isUnitVisible(known), true);
});

test('pushed wrecks wait for fog reveal rings and hide again when vision contracts', () => {
  const { scene, known, unseen, live } = fixture();
  scene.updateTankWreckPose(known, { x: 1.1, y: 0, angle: 0 });
  assert.equal(scene.isUnitVisible(known), false);
  assert.equal(scene.isUnitVisible(unseen), false);
  assert.equal(scene.isUnitVisible(live), false);
  assert.equal(scene.fogOverlayAlpha({ q: 1, r: 0 }), 72.5);
  scene.fogVisionTransition.displayedHexKeys.add('1,0');
  scene.fogVisionTransition.activeLayer = new Set(['2,0']);
  assert.equal(scene.isUnitVisible(known), true);
  scene.fogVisionTransition = { expanding: false, displayedHexKeys: new Set(['0,0']), activeLayer: new Set() };
  assert.equal(scene.isUnitVisible(known), false);
});

test('pooled wreck hulls and loose tracks always use the normal spatial fog policy', () => {
  const { scene, known, unseen, live, sprite } = fixture();
  const bindings = [];
  scene.unitFogRenderer = { bindTree: (node, policy) => bindings.push({ node, policy }) };
  scene.updateTankWreckPose(known, { x: 1.1, y: 0, angle: 0 });
  scene.captureSilhouetteSources(known);
  assert.equal(sprite.node.parent, scene.tankWreckLayer);
  assert.equal(bindings.at(-1).policy, 'hidden');
  known.paralyzed = true;
  scene.syncTankDamageOverlay(sprite.node, known, 'hull');
  const track = scene.tankDamageTrackNodes.get(sprite.node);
  assert.equal(track.parent, scene.tankWreckTrackLayer);
  scene.silhouetteClaimed.clear();
  scene.captureSilhouetteSources(known);
  assert(bindings.some(binding => binding.node === track && binding.policy === 'hidden'));
  scene.fogVisionTransition = null;
  scene.silhouetteClaimed.clear();
  scene.captureSilhouetteSources(known);
  assert.equal(bindings.at(-1).policy, 'known');
  assert(bindings.every(binding => binding.policy !== 'unmasked'));
  scene.silhouetteClaimed.clear(); scene.captureSilhouetteSources(unseen);
  assert.equal(sprite.node.parent, scene.tankWreckLayer);
  scene.silhouetteClaimed.clear(); scene.captureSilhouetteSources(live);
  assert.equal(sprite.node.parent, scene.tankContentNode);
});

test('hidden pushed vector wrecks stay masked and are omitted while fog shaders load', () => {
  const { scene, known } = fixture();
  scene.updateTankWreckPose(known, { x: 1.1, y: 0, angle: 0 });
  const calls = [];
  scene.g = { node: new Node() };
  scene.unitFallbackGraphics = new Map();
  scene.unitFogRenderer = { ready: true, bind: (graphics, policy) => calls.push(policy) };
  scene.drawUnitMaybeAnim = unit => calls.push(unit);
  scene.captureSilhouetteSources = () => {};
  scene.drawPresentedUnit(known);
  assert.deepEqual(calls, ['hidden', known]);
  calls.length = 0;
  scene.unitFogRenderer.ready = false;
  scene.drawPresentedUnit(known);
  assert.deepEqual(calls, []);
});

test('mission 09 pushes wrecks physically while the building still hides the far side', () => {
  const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
  const { computePlayerVisibleHexes } = require('../assets/scripts/core/FogOfWar.ts');
  const data = JSON.parse(fs.readFileSync('assets/resources/missions/mission_09.json', 'utf8'));
  const mission = loadMission(data);
  const from = offsetToAxial({ col: 2, row: 2 });
  const to = offsetToAxial({ col: 3, row: 2 });
  const farSide = offsetToAxial({ col: 4, row: 2 });
  const player = mission.sherman;
  Object.assign(player, { pos: from, facing: 0, turretFacing: 0, hatchOpen: true, visionRange: 4, gunnerVisionRange: 4 });
  const before = computePlayerVisibleHexes(mission.map, player, [], false, 'clear', new Set());
  const after = computePlayerVisibleHexes(mission.map, { ...player, pos: to }, [], false, 'clear', new Set());
  assert(before.has(HexMap.keyOf(to)) && !before.has(HexMap.keyOf(farSide)));
  assert(after.has(HexMap.keyOf(farSide)));
  const wreck = { ...mission.enemies.find(isTankUnit), id: 'pushed_wreck', pos: { ...to }, destroyed: true };
  mission.enemies = [wreck]; mission.allies = [];
  const { scene } = fixture();
  scene.mission = mission;
  scene.visibleHexKeys = before;
  scene.fogVisionTransition = null;
  scene.project = (q, r) => { const p = axialToPixel({ q, r }, 1); return { x: p.x, y: -p.y }; };
  scene.anim = { kind: 'move', unit: player, fromQ: from.q, fromR: from.r, toQ: to.q, toR: to.r, t: 0.7 };
  scene.tankWreckCollisionBody = unit => ({ id: unit.id, ...scene.interpolatedPos(unit), angle: 0, halfLength: 0.65, halfWidth: 0.35 });
  scene.syncTankWreckWater = () => false;
  scene.advanceTankWreckPush(scene.anim);
  assert(wreck.wreckPose?.x > 0, 'hidden portions still participate in the push solver');
  assert.equal(scene.isHexVisible(farSide), false);
  scene.redrawVisibleHexMask(scene.trackVisibilityMaskGraphics, true);
  const c = scene.project(farSide.q, farSide.r);
  assert(!scene.trackVisibilityMaskGraphics.hexes.includes(`${c.x},${c.y}`));
  assert.equal(scene.trackVisibilityMaskGraphics.polygons.length, 0, 'no hull footprint may reveal hidden terrain');
  player.pos = to; scene.anim = null; scene.visibleHexKeys = after;
  assert.equal(scene.isUnitVisible(wreck), true);
});

test('unseen pushes and fully submerged wrecks remain hidden', () => {
  const { scene, known, unseen } = fixture();
  scene.anim = { kind: 'move', unit: scene.mission.sherman };
  scene.updateTankWreckPose(unseen, { x: 0.1, y: 0, angle: 0 });
  assert.equal(scene.isUnitVisible(unseen), false);
  scene.fogVisionTransition = null;
  scene.updateTankWreckPose(known, { x: 1.1, y: 0, angle: 0 });
  known.wreckWater = { sink: { elapsed: 1 } };
  assert.equal(scene.isUnitVisible(known), false);
});

test('a wreck pushed into a neighboring region stays inside its shadow', () => {
  const { scene, known } = fixture();
  scene.mission.data.multiRegion = {};
  scene.mission.map.sameRegion = (playerPos, pos) => pos.q === playerPos.q;
  scene.isOutsidePlayerRegion = () => false;
  scene.fogVisionTransition = null;
  scene.anim = { kind: 'move', unit: scene.mission.sherman };
  assert.equal(scene.isUnitVisible(known), true);
  scene.updateTankWreckPose(known, { x: 1.1, y: 0, angle: 0 });
  assert.equal(scene.isUnitVisible(known), false, 'the visual wreck position must respect the region shadow');
  scene.redrawUnitVisibilityMask();
  assert.deepEqual(scene.trackVisibilityMaskGraphics.hexes, ['0,0']);
});
