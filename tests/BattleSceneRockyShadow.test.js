const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const method = name => {
  const start = source.indexOf(`  private ${name}(`);
  assert(start >= 0);
  const end = source.indexOf('\n  private ', start + 10);
  return source.slice(start, end);
};
class UITransform {
  setContentSize(width, height) { this.size = [width, height]; }
}
class Sprite { static SizeMode = { CUSTOM: 1 }; }
class Node {
  constructor() { this.components = new Map(); this.children = []; }
  addComponent(Type) { const value = new Type(); value.node = this; this.components.set(Type, value); return value; }
  getComponent(Type) { return this.components.get(Type); }
  addChild(node) { this.children.push(node); node.parent = this; }
  setPosition(...value) { this.position = value; }
  setRotationFromEuler(...value) { this.rotation = value; }
  setScale(...value) { this.scale = value; }
}
const js = ts.transpileModule(`class BattleScene {
  static TERRAIN_SPRITE_POOL = 16;
  ${method('ensureScenerySlot')}
  ${method('drawTerrainTileSprite')}
  ${method('redrawObjectShadows')}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const Scene = new Function('Node', 'Sprite', 'UITransform', `${js}; return BattleScene;`)(Node, Sprite, UITransform);
const scene = new Scene();
const groundLayer = new Node(), rockLayer = new Node();
const rockFrame = {}, fieldFrame = {};
Object.assign(scene, {
  node: new Node(), terrainSpritePool: [], terrainSpritePoolNext: 0,
  rockySpritePool: [], rockySpritePoolNext: 0,
  bunkerOcclusionSprites: new Map(), splitTankSprites: {}, lateWarSplitTankSprites: {},
  urbanBuildingSpritePoolNext: 0, urbanRubbleSpritePoolNext: 0, foliageSpritePoolNext: 0,
  hexSize: 50, mission: { data: { cameraRotation: 90 } },
  terrainSpriteFrameFor: terrain => ({ rocky: rockFrame, field: fieldFrame })[terrain],
});
scene.sceneryPoolParents = new Map([[scene.terrainSpritePool, groundLayer], [scene.rockySpritePool, rockLayer]]);
assert(scene.drawTerrainTileSprite(10, 20, 50, 'rocky'));
assert(scene.drawTerrainTileSprite(90, 20, 50, 'field'));
assert.equal(rockLayer.children.length, 1, 'Rock is above the cast layer, separate from flat terrain');
assert.equal(groundLayer.children.length, 1);
const rock = scene.rockySpritePool[0].sprite;
assert.equal(rock.spriteFrame, rockFrame);
assert.deepEqual(rock.node.getComponent(UITransform).size, [50 * Math.sqrt(3), 100]);
const calls = [];
scene.rockyShadows = {
  begin: rotation => calls.push(['begin', rotation]),
  draw: (...args) => calls.push(['draw', ...args]),
  end: () => calls.push(['end']),
};
scene.sceneryShadows = {
  begin() {},
  draw() { assert.fail('Rock shadows must not also be drawn in the higher building shadow layer'); },
  end() {},
};
// A released pooled slot must never cast, and ordinary ground must never cast.
scene.rockySpritePool.push({ sprite: {} });
scene.redrawObjectShadows();
assert.deepEqual(calls, [['begin', 90], ['draw', rock, 'rocky', 50], ['end']]);
scene.rockySpritePoolNext = 0;
calls.length = 0;
scene.redrawObjectShadows();
assert.deepEqual(calls, [['begin', 90], ['end']], 'Removing rocks clears their casts');
assert(scene.drawTerrainTileSprite(40, 30, 50, 'rocky'));
assert.equal(scene.rockySpritePool[0].sprite, rock, 'Redraw reuses the rock node');
assert.equal(scene.drawTerrainTileSprite(0, 0, 50, 'missing'), false);
assert.equal(scene.rockySpritePoolNext, 1, 'Missing frames do not reserve a casting slot');

const shadowIndex = source.indexOf("new ObjectShadowRenderer(gNode, 'RockyGroundShadows')");
const rockIndex = source.indexOf("new Node('RockyHighlandSprites')");
const trackIndex = source.indexOf("new Node('VisibleTrackMask')");
const bloodIndex = source.indexOf("new Node('InfantryBloodDecals')");
const buildingIndex = source.indexOf("new Node('UrbanBuildingSprites')");
assert(shadowIndex >= 0 && rockIndex > shadowIndex && trackIndex > rockIndex && bloodIndex > trackIndex,
  'Rock faces cover their own casts and remain below the masked tracks/blood layer');
assert(buildingIndex > bloodIndex && source.indexOf("new Node('VisibleUnitMask')") > buildingIndex,
  'Infantry stays above rock terrain while buildings keep their existing depth');
assert.match(source, /rockySpritePoolNext = 0;\s*for \(const \{ node \} of this\.rockySpritePool\) node\.active = false;/,
  'Every map redraw releases old rock sprites');
console.log('Rocky highland shadow integration tests passed.');
