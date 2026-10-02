const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const ast = ts.createSourceFile('BattleScene.ts', source, ts.ScriptTarget.Latest, true);
const scene = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'BattleScene');
const method = scene.members.find(n => n.name?.getText(ast) === 'redrawVisibleHexMask');
const js = ts.transpileModule(`class Harness { ${method.getText(ast)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
const directions = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
const neighbors = p => directions.map(([q, r]) => ({ q: p.q + q, r: p.r + r }));
const Harness = new Function('Color', 'neighbors', `${js}; return Harness;`)(class {}, neighbors);
const host = new Harness();
const tiles = [{ pos: { q: 0, r: 0 } }, { pos: { q: 1, r: 0 } }];
host.mission = { map: {
  all: () => tiles,
  has: p => tiles.some(t => t.pos.q === p.q && t.pos.r === p.r),
} };
host.isHexVisible = p => p.q === 0;
host.project = (q, r) => ({ x: q, y: r });
host.hexSize = 1;
host.playerTankEvacVisibilityExtension = () => null;
let drawn;
host.traceHexPathOn = (_, x, y) => drawn.push(`${x},${y}`);
const mask = { clear() { drawn = []; }, fill() {} };
host.redrawVisibleHexMask(mask, true);
assert(drawn.includes('-1,0'), 'Visible edge units may overhang the map');
assert(!drawn.includes('1,0'), 'Existing fog-hidden tiles must remain clipped');
assert(!drawn.includes('2,0'), 'Hidden edge tiles must not extend the stencil');
host.redrawVisibleHexMask(mask);
assert.deepStrictEqual(drawn, ['0,0'], 'Tracks remain constrained to visible terrain');
host.playerTankEvacVisibilityExtension = () => ({ q: -2, r: 0 });
host.redrawVisibleHexMask(mask, true);
assert(drawn.includes('-2,0'), 'Off-map evacuation remains visible');
console.log('BattleScene unit boundary mask test passed');
