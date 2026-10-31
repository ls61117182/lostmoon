const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText, filename);

const types = require('../assets/scripts/core/types.ts');
const hex = require('../assets/scripts/core/HexGrid.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { hitBreakdown, mgHitBreakdown, rollMGAttack, rollAttack,
  infantryHighExplosiveCoverValue } = require('../assets/scripts/core/Combat.ts');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
const GameSession = { gameMode: 'hardcore' };
const Scene = sceneMethods([
  'allUnits', 'hasBunkerAt', 'buildOccupiedSet', 'findMoveBlocker',
  'isBlockingMoveOccupant', 'areUnitsOnSameSide', 'infantryMoveHexPriority',
  'canInfantryEnterPriorityOccupiedHex', 'drawRuralBuildingSprites', 'drawBuildingOverlay',
  'addTileInspectUrbanBuildingSprite', 'captureSilhouetteSources', 'bunkerInfantryOccluders',
  'campaignAutoEvacPath', 'shouldDisplayUnitOutline', 'recordVectorSilhouette', 'redrawObjectShadows',
], { ...types, ...hex, GameSession });
const pos = { q: 1, r: 0 };
const unit = (kind, sideId, extra = {}) => ({
  id: `${kind}-${sideId}`, kind, sideId, faction: getUnitStats(kind).faction,
  pos: { ...pos }, facing: 0, turretFacing: 0, destroyed: false,
  stats: getUnitStats(kind), ...extra,
});
function fixture(kind = 'heavy_artillery') {
  const scene = new Scene();
  const tank = unit('sherman', 'player', { pos: { q: 0, r: 0 } });
  const infantry = unit('american_infantry', 'player', { pos: { q: 0, r: 0 } });
  const bunker = unit(kind, 'player');
  scene.mission = { sherman: tank, allies: [infantry, bunker], enemies: [] };
  return { scene, tank, infantry, bunker };
}

test('both bunker kinds restrict entry by side and retain tank collision after destruction', () => {
  for (const gameMode of ['hardcore', 'test', 'classic']) {
    GameSession.gameMode = gameMode;
    for (const kind of ['heavy_artillery', 'german_heavy_artillery']) {
      const { scene, tank, infantry, bunker } = fixture(kind);
      const enemy = unit('german_infantry', 'enemy');
      for (const destroyed of [false, true]) {
        bunker.destroyed = destroyed;
        assert.equal(scene.findMoveBlocker(tank, pos) === bunker, gameMode !== 'classic' || !destroyed);
        assert.equal(scene.buildOccupiedSet(tank).has('1,0'), gameMode !== 'classic' || !destroyed);
        assert.equal(scene.findMoveBlocker(infantry, pos) === bunker, gameMode === 'classic' && !destroyed);
        assert.equal(scene.buildOccupiedSet(infantry).has('1,0'), gameMode === 'classic' && !destroyed);
        assert.equal(scene.findMoveBlocker(enemy, pos) === bunker, !destroyed);
        assert.equal(scene.canInfantryEnterPriorityOccupiedHex(infantry, pos), gameMode !== 'classic' || destroyed);
        assert.equal(scene.canInfantryEnterPriorityOccupiedHex(enemy, pos), destroyed);
        assert.equal(scene.hasBunkerAt(pos), gameMode !== 'classic');
      }
      bunker.destroyed = false;
      bunker.faction = 'neutral';
      assert.equal(scene.findMoveBlocker(infantry, pos), bunker, 'neutral bunkers grant no allied entry');
    }
  }
});

test('ordinary wrecks remain passable and live friendly bunkers count as infantry cover destinations', () => {
  GameSession.gameMode = 'hardcore';
  const { scene, tank, infantry, bunker } = fixture();
  const tile = { pos, terrain: 'field' };
  assert.equal(scene.infantryMoveHexPriority(infantry, pos, tile), 2);
  bunker.destroyed = true;
  assert.equal(scene.infantryMoveHexPriority(infantry, pos, tile), 4);
  bunker.kind = 'tiger';
  assert.equal(scene.findMoveBlocker(tank, pos), null);
  assert.equal(scene.buildOccupiedSet(tank).has('1,0'), false);
});

test('intact friendly bunkers use city cover without stacking, wrecks use only underlying terrain', () => {
  const map = new hex.HexMap(3, 3);
  map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
  for (const kind of ['heavy_artillery', 'german_heavy_artillery']) {
    const bunker = unit(kind, 'enemy');
    const target = unit('german_infantry', 'enemy');
    const attacker = unit('sherman', 'player', { pos: { q: 0, r: 0 } });
    for (const terrain of ['field', 'urban_indestructible', 'urban_rubble']) {
      for (const hasBuilding of [false, true]) {
        map.set({ pos, terrain, hasBuilding });
        for (const hardcore of [false, true]) {
          for (const destroyed of [false, true]) {
            bunker.destroyed = destroyed;
            const ctx = { attacker, target, map, units: [attacker, target, bunker],
              hardcoreTankMachineGuns: hardcore, tankMachineGun: 'hull' };
            const base = types.tileHasBuilding(map.get(pos)) ? (terrain.startsWith('urban_') ? 3 : 1) : 0;
            const expected = hardcore && !destroyed ? Math.max(base, 3) : base;
            assert.equal(mgHitBreakdown(ctx).building, expected);
            assert.equal(rollMGAttack(ctx, { d6: () => 6 }).hitBreakdown.building, expected);
            const ordinaryBase = types.tileHasBuilding(map.get(pos)) ? 1 : 0;
            assert.equal(hitBreakdown(ctx).building, hardcore && !destroyed ? Math.max(ordinaryBase, 1) : ordinaryBase);
            assert.equal(infantryHighExplosiveCoverValue(ctx), ordinaryBase || (hardcore && !destroyed ? 1 : 0));
          }
        }
      }
    }
    map.set({ pos, terrain: 'field' });
    bunker.destroyed = false;
    const ctx = { attacker, target, map, units: [target, bunker], sameHexInfantryTankAttack: true };
    assert.equal(rollAttack({ ...ctx, attacker: unit('american_infantry', 'player', { pos: attacker.pos }) },
      { d6: () => 6 }).hitBreakdown.building, 1, 'infantry rifles use the same +1 as a city building');
    target.sideId = 'player';
    assert.equal(mgHitBreakdown(ctx).building, 0, 'hostile bunkers provide no shelter');
    target.sideId = 'enemy';
    bunker.faction = 'neutral';
    assert.equal(mgHitBreakdown(ctx).building, 0, 'neutral bunkers provide no shelter');
  }
});

test('bunker sites skip all rural props and urban building sprites, including inspector previews', () => {
  GameSession.gameMode = 'hardcore';
  const { scene, bunker } = fixture();
  const tile = { pos, terrain: 'field', hasBuilding: true };
  for (const destroyed of [false, true]) {
    bunker.destroyed = destroyed;
    // No graphics, frames or sprite pools: these calls must return before creating any art.
    scene.drawRuralBuildingSprites(0, 0, 1, tile);
    scene.drawRuralBuildingSprites(0, 0, 1, tile, {});
    scene.drawBuildingOverlay(0, 0, 1, tile);
    scene.addTileInspectUrbanBuildingSprite({}, { ...tile, terrain: 'urban_indestructible' }, 0, 0, 1);
  }
  assert.equal(scene.hasBunkerAt({ q: 2, r: 0 }), false);
  GameSession.gameMode = 'classic';
  assert.equal(scene.hasBunkerAt(pos), false);
});

test('automatic evacuation routes around bunker sites in non-classic modes', () => {
  const { scene, bunker } = fixture();
  const map = new hex.HexMap(3, 1);
  for (let q = 0; q < 3; q++) map.set({ pos: { q, r: 0 }, terrain: 'field' });
  scene.mission.map = map;
  scene.canMoveToBattleTile = p => !!map.get(p);
  bunker.destroyed = true;
  GameSession.gameMode = 'hardcore';
  assert.equal(scene.campaignAutoEvacPath({ q: 2, r: 0 }), null);
  GameSession.gameMode = 'classic';
  assert.equal(scene.campaignAutoEvacPath({ q: 2, r: 0 }).length, 3);
});

class Node {
  constructor(name) { this.name = name; this.children = []; this.active = true; this.parent = null; this.components = new Map(); }
  addComponent(Type) { const component = new Type(); this.components.set(Type, component); return component; }
  getComponent(Type) { return this.components.get(Type); }
  getSiblingIndex() { return this.parent.children.indexOf(this); }
  insertChild(node, index) { this.addChild(node); node.setSiblingIndex(index); }
  addChild(node) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = this;
    this.children.push(node);
  }
  setSiblingIndex(index) {
    const siblings = this.parent.children;
    siblings.splice(siblings.indexOf(this), 1);
    siblings.splice(index, 0, this);
  }
}

test('bunkers remain fog-darkened scenery and infantry bodies have no hex stencil', () => {
  class UITransform { setContentSize() {} }
  class Graphics {}
  class Mask { static Type = { GRAPHICS_STENCIL: 1 }; subComp = new Graphics(); }
  const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
  const start = source.indexOf("    const unitMaskNode = new Node('VisibleUnitMask');");
  const end = source.indexOf('    // Bottom to top: wreck tracks', start);
  assert(start >= 0 && end > start);
  const setup = new Function('Node', 'UITransform', 'Graphics', 'Mask', ts.transpileModule(
    `return function(gNode, urbanBuildingLayerNode) { ${source.slice(start, end)} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
  ).outputText)(Node, UITransform, Graphics, Mask);
  for (const gameMode of ['hardcore', 'test']) {
    GameSession.gameMode = gameMode;
    for (const kind of ['heavy_artillery', 'german_heavy_artillery']) {
      for (const destroyed of [false, true]) {
        const { scene, bunker, infantry } = fixture(kind);
        bunker.destroyed = destroyed;
        infantry.pos = { ...pos };
        const map = new Node('MapGraphics');
        const buildings = new Node('UrbanBuildingSprites');
        const fog = new Node('FogOfWar');
        map.addChild(buildings); map.addChild(fog);
        scene.node = { layer: 1 };
        scene.sceneryPoolParents = new Map();
        scene.fortificationSpritePool = [];
        scene.fortificationRimPool = [];
        setup.call(scene, map, buildings);
        const roof = { node: new Node('bunker') }, body = { node: new Node('infantry') };
        Object.assign(scene, {
          enemyTopSpritePool: [{ sprite: roof }], commanderHatchSpritePool: [],
          infantryTopSpritePool: [], officerTopSpritePool: [],
          silhouetteClaimed: new Set(), silhouetteSources: new Map(),
          bunkerOcclusionSprites: new Map(), infantryOcclusionSprites: new Map(),
          infantryVectorSilhouettes: [],
          unitSilhouetteColor: () => 'color', shouldDisplayUnitOutline: () => true,
          isUnitVisible: () => false,
        });
        scene.captureSilhouetteSources(bunker);
        scene.infantryTopSpritePool.push({ sprite: body });
        scene.captureSilhouetteSources(infantry);
        assert.equal(roof.node.active, true, 'unseen structures keep their body artwork');
        assert.equal(roof.node.parent.parent, map, 'bunker bodies belong to the map scenery');
        for (let ancestor = roof.node.parent; ancestor; ancestor = ancestor.parent) {
          assert.equal(ancestor.getComponent(Mask), undefined, 'visible-unit masks must not erase unseen bunkers');
        }
        assert(scene.unitVisibilityMaskNode.getSiblingIndex() < scene.bunkerContentNode.getSiblingIndex(),
          'bunkers still occlude infantry');
        assert(scene.bunkerContentNode.getSiblingIndex() < fog.getSiblingIndex(), 'fog darkens bunker bodies');
        assert.equal(body.node.parent, scene.infantryContentNode);
        assert.equal(scene.unitVisibilityMaskNode.getComponent(Mask), undefined, 'unit bodies must not be sliced at fog edges');
        assert.equal(scene.bunkerInfantryOccluders()[0].sources.size, 0, 'no hidden infantry outline leaks through fog');
      }
    }
  }
});

test('intact and wrecked bunker sprites cover only visible same-hex infantry with city-style alpha stencils', () => {
  for (const gameMode of ['hardcore', 'test', 'classic']) {
    GameSession.gameMode = gameMode;
    for (const destroyed of [false, true]) {
      const { scene, infantry, bunker } = fixture();
      scene.mission.map = { get: () => ({ terrain: 'field' }) };
      bunker.destroyed = destroyed;
      infantry.pos = { ...pos };
      const roof = { node: new Node() };
      const body = { node: new Node() };
      Object.assign(scene, {
        enemyTopSpritePool: [{ sprite: roof }], commanderHatchSpritePool: [],
        infantryTopSpritePool: [], officerTopSpritePool: [],
        tankContentNode: new Node(), infantryContentNode: new Node(), bunkerContentNode: new Node(),
        silhouetteClaimed: new Set(), silhouetteSources: new Map(),
        bunkerOcclusionSprites: new Map(), infantryOcclusionSprites: new Map(),
        infantryVectorSilhouettes: [], vectorSilhouettes: [],
        unitSilhouetteColor: () => 'color', isUnitVisible: () => true,
      });
      scene.captureSilhouetteSources(bunker);
      scene.infantryTopSpritePool.push({ sprite: body });
      scene.captureSilhouetteSources(infantry);
      scene.g = scene.unitGraphics = {};
      scene.recordVectorSilhouette(infantry, 0, 0, 1);
      assert.equal(roof.node.parent, gameMode === 'classic' ? scene.infantryContentNode : scene.bunkerContentNode);
      assert.equal(body.node.parent, scene.infantryContentNode);
      const entries = scene.bunkerInfantryOccluders();
      assert.equal(entries.length, gameMode === 'classic' ? 0 : 1);
      if (entries.length) {
        assert.equal(entries[0].blocker, roof);
        assert.equal(entries[0].sources.get(body), 'color');
        assert.equal(entries[0].sources.has(roof), false);
        assert.equal(entries[0].vectors.length, 1, 'fallback infantry geometry is also outlined');
        infantry.pos = { q: 2, r: 0 };
        assert.equal(scene.bunkerInfantryOccluders()[0].sources.size, 0);
        infantry.pos = { ...pos };
        scene.silhouetteSources.delete(body);
        assert.equal(scene.bunkerInfantryOccluders()[0].sources.size, 0, 'hidden infantry must not leak through silhouettes');
      }
    }
  }
});

test('unseen bunkers and wrecks cast once in the unmasked scenery layer while classic shadows stay unchanged', () => {
  for (const gameMode of ['hardcore', 'test', 'classic']) {
    GameSession.gameMode = gameMode;
    for (const kind of ['heavy_artillery', 'german_heavy_artillery']) {
      for (const destroyed of [false, true]) {
        for (const cameraRotation of [0, 90]) {
          const { scene, bunker } = fixture(kind);
          bunker.destroyed = destroyed;
          scene.mission.data = { cameraRotation };
          const base = { node: new Node(), spriteFrame: {} };
          const barrel = { node: new Node(), spriteFrame: {} };
          const tank = { node: new Node(), spriteFrame: {} };
          const art = destroyed ? [base] : [base, barrel];
          const casts = [], begins = [];
          const shadow = layer => ({
            begin: rotation => begins.push([layer, rotation]),
            draw: (sprite, profile) => casts.push({ layer, sprite, profile }),
            end() {},
          });
          Object.assign(scene, {
            enemyTopSpritePool: art.map(sprite => ({ sprite })), enemyTopPoolNext: art.length,
            commanderHatchSpritePool: [], infantryTopSpritePool: [], officerTopSpritePool: [],
            infantryTopPoolNext: 0, officerTopPoolNext: 0,
            urbanBuildingSpritePoolNext: 0, urbanRubbleSpritePoolNext: 0, foliageSpritePoolNext: 0,
            sceneryShadows: shadow('scenery'), vehicleShadows: shadow('vehicle'), hexSize: 50,
            splitTankSprites: { [kind]: { turret: barrel.spriteFrame } }, lateWarSplitTankSprites: {},
            bunkerContentNode: new Node(), infantryContentNode: new Node(), tankContentNode: new Node(),
            silhouetteClaimed: new Set(), silhouetteSources: new Map(), bunkerOcclusionSprites: new Map(),
            unitSilhouetteColor: () => 'color', shouldDisplayUnitOutline: () => true,
            isUnitVisible: () => false,
          });
          scene.captureSilhouetteSources(bunker);
          // Another mobile unit must continue using its original visibility-masked cast.
          scene.enemyTopSpritePool.push({ sprite: tank });
          scene.enemyTopPoolNext++;
          scene.redrawObjectShadows();
          const baseCasts = casts.filter(cast => cast.sprite === base);
          assert.equal(baseCasts.length, 1, 'bunker bodies must never cast twice');
          assert.equal(baseCasts[0].layer, gameMode === 'classic' ? 'vehicle' : 'scenery');
          assert.equal(baseCasts[0].profile, gameMode === 'classic' ? 'vehicle' : 'building');
          assert.equal(casts.filter(cast => cast.sprite === barrel).length, 0, 'barrels do not double the base shadow');
          assert.equal(casts.find(cast => cast.sprite === tank).layer, 'vehicle');
          assert(begins.every(([, rotation]) => rotation === cameraRotation));
        }
      }
    }
  }
});
