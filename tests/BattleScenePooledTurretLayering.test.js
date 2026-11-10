const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'), 'utf8');
const start = source.indexOf('  private captureSilhouetteSources(');
const end = source.indexOf('\n  private ', start + 10);
const compiled = ts.transpile(`class Scene { ${source.slice(start, end)} }`, {
  target: ts.ScriptTarget.ES2020,
});
const Scene = new Function('isTankUnit', 'isFootUnit', 'GameSession', `${compiled}; return Scene;`)(
  unit => unit.tank, () => false, { gameMode: 'classic' },
);

class Node {
  constructor() { this.children = []; this.active = true; this.parent = null; }
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

const scene = new Scene();
const hull = { node: new Node() };
const turret = { node: new Node() };
Object.assign(scene, {
  mission: {}, enemyTopSpritePool: [hull, turret].map(sprite => ({ sprite })),
  commanderHatchSpritePool: [], infantryTopSpritePool: [], officerTopSpritePool: [],
  tankContentNode: new Node(), infantryContentNode: new Node(),
  silhouetteClaimed: new Set(), silhouetteSources: new Map(),
  unitSilhouetteColor: () => null, isUnitVisible: () => true, shouldDisplayUnitOutline: () => true,
});
// A fire-support unit uses only the hull slot in the other layer, leaving the
// turret slot behind. On reuse, reparenting the hull appends it above the turret.
scene.tankContentNode.addChild(hull.node);
scene.tankContentNode.addChild(turret.node);
for (let i = 0; i < 3; i++) {
  turret.node.active = false;
  scene.silhouetteClaimed.clear();
  scene.captureSilhouetteSources({ tank: false });
  turret.node.active = true;
  scene.silhouetteClaimed.clear();
  scene.captureSilhouetteSources({ tank: true });
  assert.deepEqual(scene.tankContentNode.children, [hull.node, turret.node]);
}
console.log('Pooled turret layering tests passed.');

const LayeredScene = require('./helpers/BattleSceneMethods.cjs')([
  'drawUnit', 'updateShermanTopSprite', 'drawDestroyedTankSprite', 'captureSilhouetteSources',
], {
  isTankUnit: unit => unit.tank, isFootUnit: () => false,
  isAttachedATGunCrew: () => false, isAntiTankGunUnit: () => false,
  isEnemyTopKind: () => true, isDestroyedTopKind: () => true, isSplitTankKind: () => true,
  isHeavyArtilleryUnit: () => false, commanderHatchVisualState: () => 'occupied',
  WRECK_SINK_DURATION: 5, GameSession: { gameMode: 'classic' },
});

function layeredFixture() {
  const scene = new LayeredScene();
  const slot = () => { const node = new Node(); return { node, sprite: { node } }; };
  const hull = slot(), turret = slot(), turretLayer = new Node(), tankLayer = new Node();
  const tracks = new Node(), wrecks = new Node(), infantry = new Node();
  tankLayer.addChild(wrecks); tankLayer.addChild(tracks); tankLayer.addChild(turretLayer);
  const activate = slot => { slot.node.active = true; };
  Object.assign(scene, {
    mission: { data: {} }, hexSize: 60, g: {},
    tankContentNode: tankLayer, tankTurretContentNode: turretLayer, infantryContentNode: infantry,
    shermanSpriteNode: hull.node, shermanTopSprite: hull.sprite, shermanTopSpriteFrame: {},
    shermanTurretSpriteNode: turret.node, shermanTurretTopSprite: turret.sprite,
    enemyTopSpritePool: Array.from({ length: 12 }, slot), commanderHatchSpritePool: Array.from({ length: 6 }, slot),
    infantryTopSpritePool: [], officerTopSpritePool: [],
    commanderHatchSpriteFrames: { hatch: {} },
    silhouetteClaimed: new Set(), silhouetteSources: new Map(),
    unitSilhouetteColor: () => null, isUnitVisible: () => true, shouldDisplayUnitOutline: () => true,
    tankWreckVisualLayer: () => wrecks, interpolatedPos: () => ({ x: 0, y: 0 }),
    enemySupportsSplitTurret: unit => unit.split !== false,
    currentShermanTurretLerp: () => null, currentEnemyTurretLerp: () => null,
    applySplitTankHullSprite: activate, applySplitTankTurretSprite: activate,
    applySplitTankCommanderHatchSprite: activate, applyFixedTankCommanderHatchSprite: activate,
    applyTopDownTankSprite: node => { node.active = true; },
    applyDestroyedTopDownTankSprite: node => { node.active = true; },
    updateShermanCommanderHatchSprite() {},
    tankTopMetaFor: () => ({ sf: {} }), destroyedTankTopMetaFor: () => ({ sf: {} }),
  });
  const player = { tank: true, kind: 'sherman', stats: {} };
  scene.mission.sherman = player;
  function render(units) {
    scene.silhouetteClaimed.clear(); scene.enemyTopPoolNext = scene.commanderHatchPoolNext = 0;
    for (const s of [hull, turret, ...scene.enemyTopSpritePool, ...scene.commanderHatchSpritePool]) s.node.active = false;
    for (const unit of units) { scene.drawUnit(unit); scene.captureSilhouetteSources(unit); }
  }
  return { scene, player, hull, turret, tankLayer, turretLayer, tracks, wrecks, infantry, render };
}

test('player, allied and enemy turrets and commanders render above every live hull', () => {
  const f = layeredFixture();
  const ally = { tank: true, kind: 'maus', faction: 'usa', stats: { commanderSpritePath: 'hatch' } };
  const enemy = { ...ally, kind: 'panzer4', faction: 'german' };
  for (const units of [[f.player, ally, enemy], [enemy, ally, f.player]]) {
    f.render(units);
    assert.equal(f.tankLayer.children.at(-1), f.turretLayer);
    assert.equal(f.hull.node.parent, f.tankLayer);
    assert.equal(f.turret.node.parent, f.turretLayer);
    for (let i = 0; i < 4; i++) {
      assert.equal(f.scene.enemyTopSpritePool[i].node.parent, i % 2 ? f.turretLayer : f.tankLayer);
    }
    for (let i = 0; i < 2; i++) {
      const commander = f.scene.commanderHatchSpritePool[i].node;
      assert.equal(commander.parent, f.turretLayer);
      assert(f.turretLayer.children.indexOf(commander) > f.turretLayer.children.indexOf(f.scene.enemyTopSpritePool[i * 2 + 1].node));
    }
    // Animation replay updates sprites directly, without recapturing silhouettes.
    f.scene.updateShermanTopSprite(f.player, { x: 0, y: 0 });
    assert.equal(f.tankLayer.children.at(-1), f.turretLayer);
  }
});

test('pool slots switch between turret, hull, wreck and non-tank layers on repeated reuse', () => {
  const f = layeredFixture(), split = { tank: true, kind: 'panzer4', stats: {} };
  for (let i = 0; i < 3; i++) {
    f.render([split, split]);
    const reused = f.scene.enemyTopSpritePool[1];
    assert.equal(reused.node.parent, f.turretLayer);
    const whole = { ...split, split: false };
    f.render([whole, whole]);
    assert.equal(reused.node.parent, f.tankLayer);
    assert.equal(reused.turret, false);
    f.render([{ ...whole, destroyed: true }, { ...whole, destroyed: true }]);
    assert.equal(reused.node.parent, f.wrecks);
    f.render([{ ...whole, tank: false }, { ...whole, tank: false }]);
    assert.equal(reused.node.parent, f.infantry);
    assert.equal(f.tankLayer.children.at(-1), f.turretLayer);
    assert(f.tankLayer.children.indexOf(f.wrecks) < f.tankLayer.children.indexOf(f.tracks));
  }
});
