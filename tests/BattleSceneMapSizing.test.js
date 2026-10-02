const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const ast = ts.createSourceFile('BattleScene.ts', source, ts.ScriptTarget.Latest, true);
const scene = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'BattleScene');
const sizing = scene.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'mapFitScale');
assert(sizing, 'mapFitScale should exist');
const js = ts.transpileModule(`class Harness { ${sizing.getText(ast)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
const offsetToAxial = ({ col, row }, parity = 0) => ({ q: col - Math.floor((row + parity) / 2), r: row });
const axialToPixel = ({ q, r }, size) => ({ x: Math.sqrt(3) * size * (q + r / 2), y: 1.5 * size * r });
const Harness = new Function('offsetToAxial', 'axialToPixel', `${js}; return Harness;`)(offsetToAxial, axialToPixel);
const board = (cols, rows, parity = 0) => Array.from({ length: rows }, (_, row) =>
  Array.from({ length: cols }, (_, col) => ({ pos: offsetToAxial({ col, row }, parity) }))).flat();
const standardColumns = [[2, 6], [1, 6], [1, 7], [0, 6], [1, 6], [1, 5]];
const standardBoard = board(8, 6).filter((_, index) => {
  const row = Math.floor(index / 8);
  const col = index % 8;
  return col >= standardColumns[row][0] && col <= standardColumns[row][1];
});
const sizingFor = (tiles, segments = null) => {
  const host = new Harness();
  host.cameraReferenceTiles = () => tiles;
  host.campaignRuntime = segments ? { segments } : null;
  host.cameraReferenceTilesForSegment = index => segments[index];
  return host.mapFitScale();
};

assert.strictEqual(sizingFor(standardBoard), 1, 'standard 36-hex board keeps its size');
assert.strictEqual(sizingFor(board(8, 6)) < 1, true, 'filled canvas is larger than the standard playable board');
assert.strictEqual(sizingFor(board(12, 6)) < 1, true, 'wide maps shrink');
assert.strictEqual(sizingFor(board(8, 9)) < 1, true, 'tall maps shrink');
assert.strictEqual(sizingFor(board(12, 9).filter((_, index) => {
  const row = Math.floor(index / 12);
  const col = index % 12;
  return row < 6 && col >= standardColumns[row][0] && col <= standardColumns[row][1];
})), 1,
  'unused editor canvas cells do not shrink the map');
assert.strictEqual(sizingFor([], [standardBoard, board(12, 6)]), sizingFor(board(12, 6)),
  'campaign sizing fits its largest segment');

console.log('BattleScene map sizing test passed');
