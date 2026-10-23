const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, filename);
const { HexMap, neighbors, offsetToAxial, axialToPixel } = require('../assets/scripts/core/HexGrid.ts');
const { isTankUnit } = require('../assets/scripts/core/types.ts');
const { wreckVisualHex, wreckBodyPolygon, wreckPolygonContact, pushTankWrecks, WRECK_PUSH_STEP } = require('../assets/scripts/view/TankWreckPush.ts');
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
class Mask { static Type = { GRAPHICS_STENCIL: 1 }; constructor() { this.subComp = new Graphics(); } }
class Node {
  constructor(name = '') { this.name = name; this.children = []; this.components = new Map(); this.active = true; this.layer = 1; this.position = { x: 0, y: 0 }; this.scale = { x: 1, y: 1 }; }
  getChildByName(name) { return this.children.find(n => n.name === name); }
  addComponent(Type) { const component = new Type(); this.components.set(Type, component); return component; }
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
class ObjectShadowRenderer {
  constructor(parent, name, index) { const node = new Node(name); parent.insertChild(node, index); }
}
class Color { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } }
const Scene = require('./helpers/BattleSceneMethods.cjs')([
  'createPushedWreckVisionLayer', 'usesPushedWreckVision', 'tankWreckVisualLayer',
  'redrawUnitVisibilityMask', 'redrawVisibleHexMask', 'updateTankWreckPose',
  'isUnitVisible', 'isHexVisible', 'fogOverlayAlpha', 'captureSilhouetteSources', 'syncTankDamageOverlay',
  'isTankWreckPartVisible',
  'advanceTankWreckPush', 'interpolatedPos', 'tankWreckVisionBody',
], { Node, Mask, Graphics, UITransform, ObjectShadowRenderer, Color, HexMap, neighbors, isTankUnit,
  wreckVisualHex, wreckBodyPolygon, wreckPolygonContact, wreckWaterAppearance, WRECK_SINK_DURATION,
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
  scene.mission = { sherman: unit('player', 0, false), allies: [], enemies: [known, unseen, live], map };
  scene.allUnits = () => [scene.mission.sherman, ...scene.mission.enemies];
  scene.visibleHexKeys = new Set(['0,0', '1,0', '2,0']);
  scene.transientFogRevealKeys = new Set();
  scene.fogVisionTransition = { expanding: true, displayedHexKeys: new Set(['0,0']), activeLayer: new Set(['1,0']),
    pendingLayers: [['2,0']], elapsed: 0.5, layerInterval: 1 };
  scene.knownPushedWreckPoses = new WeakMap();
  scene.pushedWreckVisionMoves = new WeakMap();
  scene.project = (q, r) => ({ x: q, y: r });
  scene.tankWreckVisionBody = unit => ({ id: unit.id, x: unit.pos.q + (unit.wreckPose?.x ?? 0),
    y: unit.pos.r + (unit.wreckPose?.y ?? 0), angle: unit.wreckPose?.angle ?? 0, halfLength: 0.1, halfWidth: 0.1 });
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
  scene.createPushedWreckVisionLayer(scene.mapNode, scene.liveMask);
  scene.enemyTopSpritePool = [{ sprite: { node: new Node('pooled') } }];
  scene.commanderHatchSpritePool = []; scene.infantryTopSpritePool = []; scene.officerTopSpritePool = [];
  scene.silhouetteClaimed = new Set(); scene.silhouetteSources = new Map();
  scene.unitSilhouetteColor = () => null; scene.shouldDisplayUnitOutline = () => false;
  scene.tankDamageTrackNodes = new Map(); scene.tankBodyDisplaySizePx = () => ({ length: 1, width: 0.6 });
  return { scene, known, unseen, live, sprite: scene.enemyTopSpritePool[0].sprite };
}

test('known pushed wrecks use unlocked target hexes while other units retain the displayed mask', () => {
  const { scene, known, unseen, live } = fixture();
  scene.updateTankWreckPose(known, { x: 1.1, y: 0, angle: 0 }, true);
  scene.redrawUnitVisibilityMask();
  assert.equal(scene.pushedWreckMaskNode.active, true);
  assert(scene.pushedWreckVisibilityGraphics.hexes.includes('1,0'), 'active reveal ring must not cut away the wreck');
  assert(scene.pushedWreckVisibilityGraphics.hexes.includes('2,0'), 'known shape can stay dim beneath a pending fog ring');
  assert(!scene.pushedWreckVisibilityGraphics.hexes.includes('3,0'), 'genuinely hidden terrain must remain clipped');
  for (const g of [scene.tankVisibilityGraphics, scene.unitVisibilityMaskGraphics, scene.trackVisibilityMaskGraphics, scene.silhouetteVisibilityGraphics]) {
    assert(!g.hexes.includes('1,0') && !g.hexes.includes('2,0'), 'other units must not inherit the extra visibility');
  }
  assert.equal(scene.isUnitVisible(known), true);
  assert.equal(scene.isUnitVisible(unseen), false);
  assert.equal(scene.isUnitVisible(live), false);
  assert.equal(scene.isHexVisible({ q: 1, r: 0 }), false, 'the fix must not change gameplay/displayed visibility');
});

test('ordinary movement preserves a known wreck before the arrival hex unlocks, without a fog transition', () => {
  const { scene, known } = fixture();
  scene.fogVisionTransition = null;
  scene.visibleHexKeys = new Set(['0,0']);
  scene.anim = { kind: 'move', unit: scene.mission.sherman, fromQ: 0, fromR: 0, toQ: 1, toR: 0, t: 0.5 };
  scene.updateTankWreckPose(known, { x: 1.1, y: 0, angle: 0 }, true);
  scene.redrawUnitVisibilityMask();
  assert.equal(scene.pushedWreckMaskNode.active, true, 'normal movement has no expanding fog-transition object');
  assert.equal(scene.isUnitVisible(known), true, 'the pushed known hull must not disappear behind its old hex boundary');
  assert.equal(scene.isHexVisible({ q: 1, r: 0 }), false, 'arrival visibility must remain governed by the game rules');
  assert.equal(scene.pushedWreckVisibilityGraphics.polygons.length, 1, 'the mask must preserve the hull geometry, not just switch layers');
  assert(scene.pushedWreckVisibilityGraphics.polygons[0].some(point => point.x > 1), 'the geometry must reach beyond the old visible hex');
  assert.equal(scene.tankVisibilityGraphics.polygons.length, 0, 'hidden live units must not inherit the footprint exception');
  scene.mission.sherman.pos = { q: 1, r: 0 };
  scene.visibleHexKeys.add('1,0');
  scene.anim = null;
  scene.redrawUnitVisibilityMask();
  assert.equal(scene.pushedWreckMaskNode.active, false);
  assert(scene.tankVisibilityGraphics.hexes.includes('1,0'), 'normal visibility takes over on arrival');
});

test('a visibly clipped fragment is sufficient to remember a wreck whose center is still hidden', () => {
  const { scene, unseen } = fixture();
  scene.fogVisionTransition = null;
  scene.visibleHexKeys = new Set(['0,0']);
  scene.anim = { kind: 'move', unit: scene.mission.sherman };
  scene.tankWreckVisionBody = unit => ({ id: unit.id, x: 1.2 + (unit.wreckPose?.x ?? 0), y: 0,
    angle: 0, halfLength: 0.6, halfWidth: 0.25 });
  assert.equal(scene.isUnitVisible(unseen), false, 'center visibility alone cannot recognize the fragment');
  assert.equal(scene.isTankWreckPartVisible(unseen), true);
  scene.updateTankWreckPose(unseen, { x: 0.02, y: 0, angle: 0 }, true);
  assert.equal(scene.usesPushedWreckVision(unseen), true);
  scene.redrawUnitVisibilityMask();
  assert.equal(scene.pushedWreckVisibilityGraphics.polygons.length, 1);
  scene.anim = { kind: 'move', unit: scene.mission.sherman };
  scene.redrawUnitVisibilityMask();
  assert.equal(scene.pushedWreckMaskNode.active, false, 'another tank move must not keep an old hidden wreck visible');
});

test('mission 09 building approach preserves a pushed wreck while the real sight rules still hide the far side', () => {
  const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
  const { computePlayerVisibleHexes } = require('../assets/scripts/core/FogOfWar.ts');
  const data = JSON.parse(fs.readFileSync('assets/resources/missions/mission_09.json', 'utf8'));
  assert.equal(data.name, '跨过水域');
  const mission = loadMission(data);
  const from = offsetToAxial({ col: 2, row: 2 });
  const to = offsetToAxial({ col: 3, row: 2 });
  const farSide = offsetToAxial({ col: 4, row: 2 });
  assert.equal(mission.map.get(to).hasBuilding, true);
  const player = mission.sherman;
  Object.assign(player, { pos: from, facing: 0, turretFacing: 0, hatchOpen: true, visionRange: 4, gunnerVisionRange: 4 });
  const before = computePlayerVisibleHexes(mission.map, player, [], false, 'clear', new Set());
  const after = computePlayerVisibleHexes(mission.map, { ...player, pos: to }, [], false, 'clear', new Set());
  assert(before.has(HexMap.keyOf(to)) && !before.has(HexMap.keyOf(farSide)));
  assert(after.has(HexMap.keyOf(farSide)), 'arrival at the building must unlock its far side in this real map');
  const wreck = { ...mission.enemies.find(isTankUnit), id: 'pushed_wreck', pos: { ...to }, destroyed: true };
  mission.enemies = [wreck]; mission.allies = [];
  const { scene } = fixture();
  scene.mission = mission;
  scene.visibleHexKeys = before;
  scene.fogVisionTransition = null;
  scene.project = (q, r) => { const p = axialToPixel({ q, r }, 1); return { x: p.x, y: -p.y }; };
  scene.anim = { kind: 'move', unit: player, fromQ: from.q, fromR: from.r, toQ: to.q, toR: to.r, t: 0.7 };
  scene.tankWreckCollisionBody = unit => {
    const c = scene.interpolatedPos(unit);
    return { id: unit.id, ...c, angle: 0, halfLength: 0.65, halfWidth: 0.35 };
  };
  scene.destroyedTankTopMetaFor = () => null;
  delete scene.tankWreckVisionBody;
  scene.syncTankWreckWater = () => false;
  scene.advanceTankWreckPush(scene.anim);
  assert(wreck.wreckPose?.x > 0, 'use the actual push animation, not a manually marked known pose');
  scene.redrawUnitVisibilityMask();
  assert.equal(scene.pushedWreckMaskNode.active, true);
  const c = scene.project(farSide.q, farSide.r);
  const hiddenHex = Array.from({ length: 6 }, (_, i) => ({ x: c.x + Math.cos(Math.PI / 6 + i * Math.PI / 3), y: c.y + Math.sin(Math.PI / 6 + i * Math.PI / 3) }));
  const polygon = scene.pushedWreckVisibilityGraphics.polygons[0];
  assert(wreckPolygonContact(polygon, hiddenHex), 'the known wreck footprint must survive on the still-hidden side of the building');
  assert(!scene.tankVisibilityGraphics.hexes.includes(`${c.x},${c.y}`), 'ordinary enemies beyond the building must stay clipped');
  assert.equal(scene.isHexVisible(farSide), false);
  player.pos = to; scene.anim = null; scene.visibleHexKeys = after;
  scene.redrawUnitVisibilityMask();
  assert.equal(scene.pushedWreckMaskNode.active, false);
  assert(scene.tankVisibilityGraphics.hexes.includes(`${c.x},${c.y}`));
});

test('wrecks stay under the fading fog and existing scenery, and below live hulls', () => {
  const { scene, known } = fixture();
  scene.updateTankWreckPose(known, { x: 1.1, y: 0, angle: 0 }, true);
  const order = scene.mapNode.children;
  assert(order.indexOf(scene.roofs) < order.indexOf(scene.pushedWreckMaskNode));
  assert(order.indexOf(scene.pushedWreckMaskNode) < order.indexOf(scene.liveMask));
  assert(order.indexOf(scene.pushedWreckMaskNode) < order.indexOf(scene.foliage));
  assert(order.indexOf(scene.pushedWreckMaskNode) < order.indexOf(scene.fog));
  assert.equal(scene.fogOverlayAlpha({ q: 1, r: 0 }), 72.5);
  scene.fogVisionTransition.elapsed = 0.75;
  assert.equal(scene.fogOverlayAlpha({ q: 1, r: 0 }), 36.25, 'fog should continue its smooth fade over the wreck');
  assert.equal(scene.fogOverlayAlpha({ q: 3, r: 0 }), 145);
});

test('pooled hulls and loose tracks switch between continuous wreck and normal unit layers', () => {
  const { scene, known, unseen, live, sprite } = fixture();
  scene.updateTankWreckPose(known, { x: 1.1, y: 0, angle: 0 }, true);
  scene.captureSilhouetteSources(known);
  assert.equal(sprite.node.parent, scene.pushedWreckContentNode);
  known.paralyzed = true;
  scene.syncTankDamageOverlay(sprite.node, known, 'hull');
  assert.equal(scene.tankDamageTrackNodes.get(sprite.node).parent, scene.pushedWreckTrackLayer);
  scene.silhouetteClaimed.clear(); scene.captureSilhouetteSources(unseen);
  assert.equal(sprite.node.parent, scene.tankWreckLayer, 'unseen wreck must not reuse a permissive mask');
  scene.silhouetteClaimed.clear(); scene.captureSilhouetteSources(live);
  assert.equal(sprite.node.parent, scene.tankContentNode, 'live enemy must return to the ordinary tank mask');
});

test('ending or reversing a reveal restores normal clipping and disables the extra layer', () => {
  const { scene, known, sprite } = fixture();
  scene.updateTankWreckPose(known, { x: 1.1, y: 0, angle: 0 }, true);
  scene.redrawUnitVisibilityMask();
  scene.fogVisionTransition = null;
  scene.redrawUnitVisibilityMask(); scene.captureSilhouetteSources(known);
  assert.equal(scene.pushedWreckMaskNode.active, false);
  assert.equal(sprite.node.parent, scene.tankWreckLayer);
  assert(scene.tankVisibilityGraphics.hexes.includes('1,0'), 'completed reveal must retain the visible wreck without a pop');
  scene.fogVisionTransition = { expanding: false, displayedHexKeys: new Set(['0,0']), activeLayer: new Set(), elapsed: 0, layerInterval: 1 };
  scene.redrawUnitVisibilityMask();
  assert.equal(scene.usesPushedWreckVision(known), false);
  assert.equal(scene.isUnitVisible(known), false);
});

test('unseen pushes, restored pose objects and fully submerged wrecks never get reveal continuity', () => {
  const { scene, known, unseen } = fixture();
  scene.updateTankWreckPose(unseen, { x: 0.1, y: 0, angle: 0 }, true);
  assert.equal(scene.usesPushedWreckVision(unseen), false);
  scene.redrawUnitVisibilityMask();
  assert.equal(scene.pushedWreckMaskNode.active, false, 'no extra stencil work is needed without a known pushed wreck');
  scene.updateTankWreckPose(known, { x: 1.1, y: 0, angle: 0 }, true);
  scene.updateTankWreckPose(known, { x: 1.2, y: 0, angle: 0.1 });
  assert.equal(scene.usesPushedWreckVision(known), true, 'independent sinking motion should preserve known visibility');
  known.wreckPose = { ...known.wreckPose };
  assert.equal(scene.usesPushedWreckVision(known), false, 'checkpoint/snapshot pose replacement invalidates local knowledge');
  scene.fogVisionTransition = null;
  scene.visibleHexKeys.add('1,0');
  scene.updateTankWreckPose(known, { x: 1.3, y: 0, angle: 0 }, true);
  scene.fogVisionTransition = { expanding: true };
  known.wreckWater = { sink: { elapsed: 1 } };
  assert.equal(scene.usesPushedWreckVision(known), false);
  assert.equal(scene.isUnitVisible(known), false);
});
