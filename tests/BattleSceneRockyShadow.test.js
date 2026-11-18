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
const groundLayer = new Node();
const fieldFrame = {};
Object.assign(scene, {
  node: new Node(), terrainSpritePool: [], terrainSpritePoolNext: 0,
  bunkerOcclusionSprites: new Map(), splitTankSprites: {}, lateWarSplitTankSprites: {},
  urbanBuildingSpritePoolNext: 0, urbanRubbleSpritePoolNext: 0, foliageSpritePoolNext: 0,
  hexSize: 50, mission: { data: { cameraRotation: 90 } },
  terrainSpriteFrameFor: terrain => { assert.notEqual(terrain, 'rocky'); return { field: fieldFrame }[terrain]; },
});
scene.sceneryPoolParents = new Map([[scene.terrainSpritePool, groundLayer]]);
assert.equal(scene.drawTerrainTileSprite(10, 20, 50, 'rocky'), false, 'No call can draw an independent rock sprite');
assert.equal(scene.drawTerrainTileSprite(10, 20, 50, 'rocky', { terrain: 'rocky', pos: { q: 0, r: 0 } }), false);
assert.equal(scene.terrainSpritePoolNext, 0, 'Rocky terrain does not allocate scenery slots');
assert(scene.drawTerrainTileSprite(90, 20, 50, 'field'));
assert.equal(groundLayer.children.length, 1);
const field = scene.terrainSpritePool[0].sprite;
assert.equal(field.spriteFrame, fieldFrame);
assert.deepEqual(field.node.getComponent(UITransform).size, [50 * Math.sqrt(3), 100]);
const calls = [];
scene.sceneryShadows = {
  begin: rotation => calls.push(['begin', rotation]),
  draw: () => assert.fail('Rocky terrain and ordinary ground must not cast scenery shadows'),
  end: () => calls.push(['end']),
};
scene.redrawObjectShadows();
assert.deepEqual(calls, [['begin', 90], ['end']], 'Terrain casts are supplied only by the continuous contour');
calls.length = 0;
scene.redrawObjectShadows(true);
assert.deepEqual(calls, [], 'Unit-only redraws do not touch terrain');
assert.equal(scene.drawTerrainTileSprite(0, 0, 50, 'missing'), false);
assert.equal(scene.terrainSpritePoolNext, 1, 'Missing frames do not reserve a slot');

assert.doesNotMatch(source, /rockyShadows|rockySpritePool|RockyGroundShadows|RockyHighlandSprites/,
  'No legacy per-hex layer or shadow renderer remains active');
const terrainIndex = source.indexOf('this.elevationRenderer = new ElevationRenderer(terrainNode)');
const trackIndex = source.indexOf("new Node('VisibleTrackMask')");
const bloodIndex = source.indexOf("new Node('InfantryBloodDecals')");
const buildingIndex = source.indexOf("new Node('UrbanBuildingSprites')");
assert(terrainIndex >= 0 && trackIndex > terrainIndex && bloodIndex > trackIndex,
  'Continuous terrain remains below the masked tracks/blood layer');
assert(buildingIndex > bloodIndex && source.indexOf("new Node('VisibleUnitMask')") > buildingIndex,
  'Infantry stays above rock terrain while buildings keep their existing depth');
console.log('All rocky terrain uses continuous elevation without legacy sprites or duplicate shadows.');
