const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const { Prototype3DBattle, prototypeKey, prototypeHeight, prototypeWorld } = require('../assets/scripts/core/Prototype3DScenario.ts');
const { hexDistance } = require('../assets/scripts/core/HexGrid.ts');

test('sample has 37 unique cells, valid spawns and a continuously rising ramp', () => {
  const b = new Prototype3DBattle();
  assert.equal(b.cells.length, 37);
  assert.equal(b.cellMap.size, 37);
  for (const p of [b.player, b.enemy]) assert.equal(b.cellMap.get(prototypeKey(p)).blocked, false);
  assert.equal(prototypeHeight(-1, 0), 0);
  assert.equal(prototypeHeight(5, 0), 1.4);
  let previous = 0;
  for (let x = -1; x < 6; x += .01) {
    const h = prototypeHeight(x, 0);
    assert.ok(h >= previous - 1e-10 && h - previous < .005);
    previous = h;
  }
  assert.ok(prototypeHeight(...Object.values(prototypeWorld(b.enemy))) > prototypeHeight(...Object.values(prototypeWorld(b.player))));
});

test('reachable paths honor obstacles, adjacency, bounds and cumulative movement budget', () => {
  const b = new Prototype3DBattle();
  for (const [key, path] of b.reachablePaths()) {
    assert.ok(path.length <= 3);
    let last = b.player;
    for (const pos of path) {
      assert.equal(hexDistance(last, pos), 1);
      assert.equal(b.cellMap.get(prototypeKey(pos)).blocked, false);
      assert.notEqual(prototypeKey(pos), prototypeKey(b.enemy));
      last = pos;
    }
    assert.equal(prototypeKey(last), key);
  }
  const target = [...b.reachablePaths().values()].find(path => path.length === 2).at(-1);
  assert.equal(b.moveTo(target).length, 2);
  assert.equal(b.moves, 1);
  const before = JSON.stringify([b.player, b.moves]);
  for (const p of [{ q: 99, r: 0 }, b.enemy, { q: -1, r: -2 }, b.player]) assert.equal(b.moveTo(p), null);
  assert.equal(JSON.stringify([b.player, b.moves]), before);
  const next = [...b.reachablePaths().values()].find(path => path.length === 1).at(-1);
  assert.equal(b.moveTo(next).length, 1);
  assert.equal(b.moves, 0);
  assert.equal(b.reachablePaths().size, 1);
});

test('two-turn win: one shell per turn, enemy response, reload, terminal actions frozen', () => {
  const b = new Prototype3DBattle();
  assert.equal(b.canFire, true);
  assert.equal(b.fire(), true);
  assert.equal(b.enemyHP, 1);
  assert.equal(b.fire(), false);
  assert.equal(b.endTurn(), true);
  assert.equal(b.playerHP, 2);
  assert.equal(b.turn, 2);
  assert.equal(b.moves, 3);
  assert.equal(b.fired, false);
  assert.equal(b.fire(), true);
  assert.equal(b.outcome, 'won');
  assert.equal(b.endTurn(), false);
  assert.equal(b.fire(), false);
  assert.equal(b.moveTo({ q: 0, r: 0 }), null);
  assert.equal(b.playerHP, 2);
});

test('line blockers prevent both outgoing and returning fire; exposed waiting loses', () => {
  const b = new Prototype3DBattle();
  b.player = { q: -1, r: 2 };
  assert.equal(b.clearShot, false);
  assert.equal(b.fire(), false);
  assert.equal(b.enemyHP, 2);
  assert.equal(b.endTurn(), false);
  assert.equal(b.playerHP, 3);
  b.player = { q: -2, r: 1 };
  for (let i = 0; i < 3; i++) assert.equal(b.endTurn(), true);
  assert.equal(b.outcome, 'lost');
  assert.equal(b.playerHP, 0);
  assert.equal(b.endTurn(), false);
  assert.equal(b.playerHP, 0);
});
