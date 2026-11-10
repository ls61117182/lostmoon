const test = require('node:test');
const assert = require('node:assert/strict');
class RNG { next() { return 0.5; } }
class Node {
  constructor() { this.children = []; }
  addChild(node) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    this.children.push(node); node.parent = this;
  }
}
const Scene = require('./helpers/BattleSceneMethods.cjs')(['drawHedgeEdgeTrees'], {
  RNG, BattleScene: { HEDGE_TREES_PER_EDGE: 4 },
});
function fixture(sprites = true) {
  const scene = new Scene(), above = new Node(), below = new Node(), fallback = [];
  Object.assign(scene, {
    hedgesBelowTanksNode: below, hedgeMiddleGraphics: {}, g: {},
    foliageSpritePool: [], foliageSpritePoolNext: 0, hashStringToSeed: () => 1,
    drawTreeSprite(x, y) {
      if (!sprites) return false;
      const node = new Node(); Object.assign(node, { x, y }); above.addChild(node);
      this.foliageSpritePool[this.foliageSpritePoolNext++] = { node };
      return true;
    },
    drawHedgeTreeClump() { fallback.push(this.g); },
  });
  return { scene, above, below, fallback };
}

test('all six hedge edges put endpoints above tanks and their two middle clumps below tanks', () => {
  for (let edge = 0; edge < 6; edge++) {
    const f = fixture();
    f.scene.drawHedgeEdgeTrees(0, 0, 60, edge, 0, 0, new Set());
    assert.deepEqual(f.scene.foliageSpritePool.map(slot => slot.node.parent),
      [f.above, f.below, f.below, f.above]);
    assert.equal(f.above.children.length, 2); assert.equal(f.below.children.length, 2);
  }
});

test('shared endpoints are drawn once and remain above tanks at hedge corners', () => {
  const f = fixture(), keys = new Set();
  f.scene.drawHedgeEdgeTrees(0, 0, 60, 0, 0, 0, keys);
  f.scene.drawHedgeEdgeTrees(0, 0, 60, 1, 0, 0, keys);
  assert.equal(f.scene.foliageSpritePool.length, 7);
  assert.equal(f.above.children.length, 3); assert.equal(f.below.children.length, 4);
  f.scene.drawHedgeEdgeTrees(0, 0, 60, 0, 0, 0, keys);
  assert.equal(f.scene.foliageSpritePool.length, 7, 'a duplicate edge adds no trees');
});

test('vector fallback uses the same endpoint/middle layers and restores the scenery graphics', () => {
  const f = fixture(false), original = f.scene.g;
  f.scene.drawHedgeEdgeTrees(0, 0, 60, 0, 0, 0, new Set());
  assert.deepEqual(f.fallback, [original, f.scene.hedgeMiddleGraphics, f.scene.hedgeMiddleGraphics, original]);
  assert.equal(f.scene.g, original);
});
