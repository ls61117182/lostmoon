const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText, filename);
const types = require('../assets/scripts/core/types.ts');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
class UITransform { setContentSize() {} }
class Sprite { static SizeMode = { CUSTOM: 1 }; }
class Node {
  constructor(name) { this.name = name; this.children = []; this.components = new Map(); this.active = true; }
  addComponent(Type) { const component = new Type(); component.node = this; this.components.set(Type, component); return component; }
  addChild(node) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); this.children.push(node); node.parent = this; }
  setSiblingIndex(index) { const siblings = this.parent.children; siblings.splice(siblings.indexOf(this), 1); siblings.splice(index, 0, this); }
}
const Scene = sceneMethods(['reserveUnitSpritePools', 'growUnitSpritePool', 'isOutsidePlayerRegion', 'drawUnit', 'captureSilhouetteSources'], {
  ...types, Node, Sprite, UITransform, GameSession: { gameMode: 'classic' },
  WRECK_SINK_DURATION: 5,
  isEnemyTopKind: () => true, isSplitTankKind: () => true, commanderHatchVisualState: () => 'hidden',
  FACTION_COLORS: { usa: {}, german: {} }, UNIT_BORDER: {},
});
const tank = (id, q, faction = 'german', destroyed = false) => ({ id, kind: 'panzer4', pos: { q, r: 0 }, faction, destroyed,
  stats: { visionType: 'turreted' } });
function fixture() {
  const scene = new Scene(), node = new Node('Scene'), unitLayer = new Node('UnitContent');
  const player = tank('player', 0, 'usa');
  let fallbacks = 0;
  Object.assign(scene, { node, unitGraphics: { node: unitLayer }, hexSize: 60,
    mission: { data: { multiRegion: {} }, sherman: player,
      map: { sameRegion: (a, b) => (a.q < 50) === (b.q < 50) } },
    enemyTopSpritePool: [], commanderHatchSpritePool: [], infantryTopSpritePool: [], officerTopSpritePool: [],
    project: (q, r) => ({ x: q, y: r }), enemySupportsSplitTurret: () => true,
    currentEnemyTurretLerp: () => null, currentShermanTurretLerp: () => null,
    commanderHatchSpriteFrames: {}, mainGunRecoilOffsetFor: () => ({ x: 0, y: 0 }),
    tankVisualColor: color => color, recordVectorSilhouette() {},
    g: { circle: () => fallbacks++, fill() {}, stroke() {} },
    silhouetteClaimed: new Set(), silhouetteSources: new Map(), tankContentNode: new Node('TankContent'),
    unitSilhouetteColor: () => null, shouldDisplayUnitOutline: () => false,
    applySplitTankHullSprite: (slot, unit) => { slot.node.active = true; slot.part = 'hull'; slot.owner = unit.id; },
    applySplitTankTurretSprite: (slot, unit) => { slot.node.active = true; slot.part = 'turret'; slot.owner = unit.id; },
    destroyedTankTopMetaFor: () => ({}),
    drawDestroyedTankSprite: function(unit) { const slot = this.enemyTopSpritePool[this.enemyTopPoolNext++]; slot.owner = unit.id; slot.part = 'wreck'; slot.node.active = true; return true; },
  });
  scene.growUnitSpritePool(scene.enemyTopSpritePool, 16, 'EnemyTop');
  scene.tankWreckVisualLayer = () => scene.tankContentNode;
  return { scene, player, fallbacks: () => fallbacks };
}
function redrawUnits(scene, units) {
  scene.enemyTopPoolNext = 0;
  for (const slot of scene.enemyTopSpritePool) slot.node.active = false;
  scene.silhouetteClaimed.clear();
  scene.reserveUnitSpritePools(units);
  for (const unit of units) {
    if (scene.isOutsidePlayerRegion(unit)) continue;
    scene.drawUnit(unit);
    scene.captureSilhouetteSources(unit);
  }
}

test('entering a crowded region renders every tank with its own hull and turret instead of circular fallbacks', () => {
  const { scene, player, fallbacks } = fixture();
  const oldRegion = Array.from({ length: 4 }, (_, i) => tank(`A1_${i}`, i));
  const newRegion = Array.from({ length: 13 }, (_, i) => tank(`A2_${i}`, 100 + i, i < 4 ? 'usa' : 'german'));
  const units = [...oldRegion, ...newRegion];
  redrawUnits(scene, units);
  assert.equal(scene.enemyTopPoolNext, 8);
  player.pos.q = 100;
  redrawUnits(scene, units);
  assert.equal(fallbacks(), 0);
  assert.equal(scene.enemyTopPoolNext, 26);
  for (let i = 0; i < newRegion.length; i++) {
    const hull = scene.enemyTopSpritePool[i * 2], turret = scene.enemyTopSpritePool[i * 2 + 1];
    assert.equal(hull.owner, newRegion[i].id); assert.equal(turret.owner, newRegion[i].id);
    assert.equal(hull.part, 'hull'); assert.equal(turret.part, 'turret');
    const siblings = scene.tankContentNode.children;
    assert(siblings.indexOf(hull.node) < siblings.indexOf(turret.node));
  }
  const allocated = scene.enemyTopSpritePool.length;
  for (let i = 0; i < 6; i++) { player.pos.q = i % 2 ? 100 : 0; redrawUnits(scene, units); }
  assert.equal(fallbacks(), 0);
  assert.equal(scene.enemyTopSpritePool.length, allocated, 'returning to either region reuses existing nodes');
});

test('masked units and wrecks reserve capacity together; old-region sprites are inactive on return', () => {
  const { scene, player, fallbacks } = fixture();
  const units = Array.from({ length: 12 }, (_, i) => ({ ...tank(`unit_${i}`, 100 + i, 'german', i < 5), hidden: i % 2 === 0 }));
  player.pos.q = 100;
  redrawUnits(scene, units);
  assert.equal(scene.enemyTopPoolNext, 5 + 7 * 2);
  assert.equal(fallbacks(), 0);
  player.pos.q = 0;
  redrawUnits(scene, units);
  assert.equal(scene.enemyTopPoolNext, 0);
  assert(scene.enemyTopSpritePool.every(slot => !slot.node.active));
});

test('reinforcement crowds grow infantry, officer and commander pools without allocating for other regions', () => {
  const { scene } = fixture();
  const troops = Array.from({ length: 16 }, (_, i) => ({ ...tank(`inf_${i}`, i), kind: 'german_infantry' }));
  const officers = Array.from({ length: 6 }, (_, i) => ({ ...tank(`officer_${i}`, i), kind: 'officer' }));
  const vehicles = Array.from({ length: 15 }, (_, i) => tank(`tank_${i}`, i));
  const remote = Array.from({ length: 80 }, (_, i) => tank(`remote_${i}`, 100));
  scene.reserveUnitSpritePools([...troops, ...officers, ...vehicles, ...remote]);
  assert.equal(scene.infantryTopSpritePool.length, 48);
  assert.equal(scene.officerTopSpritePool.length, 6);
  assert.equal(scene.commanderHatchSpritePool.length, 15);
  assert.equal(scene.enemyTopSpritePool.length, 30);
  assert(scene.enemyTopSpritePool.every(slot => slot.sprite.sizeMode === Sprite.SizeMode.CUSTOM));
  assert(scene.enemyTopSpritePool.every(slot => !slot.node.active));
});
