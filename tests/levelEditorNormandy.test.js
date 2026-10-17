const assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
const { test } = require('node:test');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
const { applyNormandyEditorBrush, normandyEditorEdgeState, setNormandyEditorEdge } = require('../assets/scripts/core/NormandyEditor.ts');
const { terrainCategoryForCode } = require('../assets/scripts/core/TerrainCatalog.ts');
const { offsetToAxial, axialToOffset, neighbor } = require('../assets/scripts/core/HexGrid.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { effectiveDiceTerrain } = require('../assets/scripts/core/types.ts');
const { CustomMissionStore } = require('../assets/scripts/core/CustomMissionStore.ts');
const storage = new Map();
global.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
const grid = () => Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ t: 'f' })));
const other = (row, col, dir, parity = 0) => axialToOffset(neighbor(offsetToAxial({ row, col }, parity), dir), parity);
const flag = (dir, value) => Array.from({ length: 6 }, (_, i) => i === dir ? String(value) : '0').join('');

function actualPalette() {
  const source = fs.readFileSync('assets/scripts/view/MainMenuScene.ts', 'utf8');
  const parsed = ts.createSourceFile('MainMenuScene.ts', source, ts.ScriptTarget.Latest, true);
  let init;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'terrainTools') init = node.initializer.getText(parsed); ts.forEachChild(node, visit); };
  visit(parsed); assert.ok(init);
  const module = { exports: {} };
  new Function('module', 'Color', ts.transpileModule(`module.exports = ${init}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText)(module, class Color {});
  return module.exports;
}

test('all Normandy tools are directly available in the real European terrain palette', () => {
  const palette = actualPalette();
  const european = palette.filter(tool => tool.code === null || terrainCategoryForCode(tool.code) === 'europe');
  assert.ok(european.some(tool => tool.code === 'eb' && !tool.normandy));
  assert.deepEqual(european.filter(tool => tool.normandy).map(tool => tool.normandy).sort(), ['crater', 'erase', 'seawall', 'steel', 'wire_damaged', 'wire_intact']);
  assert.ok(palette.filter(tool => terrainCategoryForCode(tool.code) === 'pacific').every(tool => !tool.normandy));
  const bottom = 78 - (Math.ceil(european.length / 3) - 1) * 42;
  assert.ok(bottom - 76 - 14 > -250, 'palette and edge-direction controls fit the editor panel');
});

test('steel/crater brushes create sand overlays without losing marker or other overlay data', () => {
  const tiles = grid();
  tiles[2][2] = { t: 'r', rd: '100100', rid: 1, rf: 0, eid: 2, ef: 3, h: '010000' };
  assert.equal(applyNormandyEditorBrush(tiles, 2, 2, 'steel'), true);
  assert.equal(tiles[2][2].t, 'eb'); assert.equal(tiles[2][2].sh, 1); assert.equal(tiles[2][2].rd, undefined);
  applyNormandyEditorBrush(tiles, 2, 2, 'crater');
  assert.equal(tiles[2][2].sh, 1); assert.equal(tiles[2][2].cr, 1);
  assert.equal(tiles[2][2].rid, 1); assert.equal(tiles[2][2].eid, 2); assert.equal(tiles[2][2].h, '010000');
});

test('edge brushes honor all six directions and both offset parity layouts', () => {
  for (const parity of [0, 1]) for (let dir = 0; dir < 6; dir++) {
    const tiles = grid(), pos = other(2, 2, dir, parity), back = (dir + 3) % 6;
    tiles[pos.row][pos.col].wire = flag(back, 1);
    tiles[pos.row][pos.col].sw = flag(back, 1);
    assert.equal(normandyEditorEdgeState(tiles, 2, 2, dir, 'wire', parity), 1, 'neighbor-only encoding is shown in properties');
    applyNormandyEditorBrush(tiles, 2, 2, 'wire_damaged', dir, parity);
    assert.equal(tiles[2][2].wire[dir], '2'); assert.equal(tiles[pos.row][pos.col].wire[back], '2');
    assert.equal(normandyEditorEdgeState(tiles, 2, 2, dir, 'wire', parity), 2);
    applyNormandyEditorBrush(tiles, 2, 2, 'wire_intact', dir, parity);
    assert.equal(normandyEditorEdgeState(tiles, 2, 2, dir, 'wire', parity), 1);
    assert.equal(tiles[2][2].t, 'f', 'edge brushes preserve existing ground');
    applyNormandyEditorBrush(tiles, 2, 2, 'seawall', dir, parity);
    setNormandyEditorEdge(tiles, 2, 2, dir, 'sw', 0, parity);
    assert.equal(normandyEditorEdgeState(tiles, 2, 2, dir, 'sw', parity), 0);
    setNormandyEditorEdge(tiles, 2, 2, dir, 'wire', 0, parity);
    assert.equal(normandyEditorEdgeState(tiles, 2, 2, dir, 'wire', parity), 0);
  }
});

test('eraser removes shared beach obstacles and keeps ordinary ground properties', () => {
  const tiles = grid(); tiles[2][2] = { t: 'eb', sh: 1, cr: 1, bd: 1, rid: 1, h: '100000' };
  tiles[2][3].wire = '000100'; tiles[2][3].sw = '000100';
  tiles[2][3].h = '010000';
  applyNormandyEditorBrush(tiles, 2, 2, 'erase');
  assert.deepEqual(tiles[2][2], { t: 'eb', bd: 1, rid: 1, h: '100000' });
  assert.equal(tiles[2][3].wire, undefined); assert.equal(tiles[2][3].sw, undefined); assert.equal(tiles[2][3].h, '010000');
});

test('water rejects edge brushes without mutating authoring data; empty cells create sand', () => {
  for (const t of ['w', 'dw', 'B', 'esw']) for (const brush of ['wire_intact', 'wire_damaged', 'seawall']) {
    const tiles = grid(); tiles[2][2] = { t, disp: 1 };
    const before = JSON.stringify(tiles);
    assert.equal(applyNormandyEditorBrush(tiles, 2, 2, brush), false); assert.equal(JSON.stringify(tiles), before);
  }
  const tiles = grid(); tiles[2][2] = null;
  assert.equal(applyNormandyEditorBrush(tiles, 2, 2, 'seawall', 0), true);
  assert.deepEqual(tiles[2][2], { t: 'eb', sw: '100000' });
  assert.equal(applyNormandyEditorBrush(tiles, 2, 2, 'seawall', 6), false);
});

test('palette-painted authoring data survives custom mission save/export/import and loads with real rules', () => {
  const tiles = grid();
  for (const brush of ['steel', 'crater', 'wire_damaged', 'seawall']) applyNormandyEditorBrush(tiles, 2, 2, brush, 0);
  const mission = { id: 'normandy-editor-roundtrip', name: 'Editor test', description: 'Test', theater: 'europe', cols: 5, rows: 5, tiles,
    playerTank: { kind: 'sherman', faction: 'usa', at: { col: 1, row: 2 }, facing: 0 }, enemies: [{ kind: 'infantry', at: { col: 4, row: 4 } }], objective: { type: 'destroy_all_enemies' } };
  const pkg = { schemaVersion: 2, editorVersion: '1', savedAt: 0, source: 'player', mission, turnEndEvents: [] };
  CustomMissionStore.save('normandy-editor-test', pkg);
  const exported = JSON.stringify(CustomMissionStore.load('normandy-editor-test'));
  const imported = JSON.parse(exported);
  assert.deepEqual(imported.mission.tiles[2][2], tiles[2][2]);
  const loaded = loadMission(imported.mission), p = offsetToAxial({ row: 2, col: 2 }), tile = loaded.map.get(p);
  assert.equal(tile.steelHedgehogs, true); assert.equal(tile.crater, true); assert.equal(effectiveDiceTerrain(tile), 'mud');
  assert.equal(tile.barbedWire[0], 2); assert.equal(tile.seawalls[0], true);
});
