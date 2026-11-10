const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const ast = ts.createSourceFile('BattleScene.ts', source, ts.ScriptTarget.Latest, true);
const scene = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'BattleScene');
const methods = ['mapPanBounds', 'tileBoundsCenter'].map(name =>
  scene.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast));
const js = ts.transpileModule(`class Harness { ${methods.join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
const offsetToAxial = ({ col, row }, parity = 0) => ({ q: col - Math.floor((row + parity) / 2), r: row });
const axialToPixel = ({ q, r }, size) => ({ x: Math.sqrt(3) * size * (q + r / 2), y: 1.5 * size * r });
const Harness = new Function('offsetToAxial', 'axialToPixel', 'BOARD_CENTER_OFFSET_Y', `${js}; return Harness;`)(offsetToAxial, axialToPixel, 38);
const board = (cols, rows, parity = 0) => Array.from({ length: rows }, (_, row) =>
  Array.from({ length: cols }, (_, col) => ({ pos: offsetToAxial({ col, row }, parity) }))).flat();
const standardColumns = [[2, 6], [1, 6], [1, 7], [0, 6], [1, 6], [1, 5]];
const standardBoard = board(8, 6).filter((_, index) => {
  const row = Math.floor(index / 8);
  const col = index % 8;
  return col >= standardColumns[row][0] && col <= standardColumns[row][1];
});
const sizingFor = (tiles) => {
  const host = new Harness();
  host.hexSize = 60;
  host.cameraReferenceTiles = () => tiles;
  const center = host.tileBoundsCenter(tiles) ?? { x: 0, y: 0 };
  host.offsetX = -center.x;
  host.offsetY = center.y + 38;
  return host.mapPanBounds();
};

assert.strictEqual(sizingFor(standardBoard), null, 'standard 36-hex board stays fixed');
assert.strictEqual(sizingFor([]), null, 'empty maps stay fixed');
assert.ok(sizingFor(board(8, 6)), 'filled canvas is larger than the standard playable board');
const wide = sizingFor(board(12, 6));
assert.ok(wide.minX < 0 && wide.maxX > 0, 'wide maps pan horizontally');
assert.strictEqual(wide.minY, 0);
assert.strictEqual(wide.maxY, 0, 'a fitting axis stays centered');
const tall = sizingFor(board(8, 9));
assert.ok(tall.minY < 0 && tall.maxY > 0, 'tall maps pan vertically');
assert.strictEqual(sizingFor(board(12, 9).filter((_, index) => {
  const row = Math.floor(index / 12);
  const col = index % 12;
  return row < 6 && col >= standardColumns[row][0] && col <= standardColumns[row][1];
})), null, 'unused editor canvas cells do not enable dragging');
const shifted = sizingFor(board(12, 6).map(tile => ({ pos: { q: tile.pos.q + 100, r: tile.pos.r } })));
assert.ok(Object.keys(wide).every(key => Math.abs(shifted[key] - wide[key]) < 1e-9),
  'campaign segment offsets do not affect drag range');
assert.ok(source.includes('this.hexSize = this.standardHexSize;'), 'all maps retain standard hex size');
assert.ok(!source.includes('mapFitScale'), 'large maps never trigger automatic zooming');

console.log('BattleScene map sizing test passed');
