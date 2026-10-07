const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'), 'utf8');
const start = source.indexOf('  private captureSilhouetteSources(');
const end = source.indexOf('\n  private ', start + 10);
const compiled = ts.transpile(`class Scene { ${source.slice(start, end)} }`, {
  target: ts.ScriptTarget.ES2020,
});
const Scene = new Function('isTankUnit', `${compiled}; return Scene;`)(unit => unit.tank);

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
  unitSilhouetteColor: () => null, isUnitVisible: () => true,
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
