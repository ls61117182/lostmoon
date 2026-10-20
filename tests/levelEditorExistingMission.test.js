const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { loadExistingMission, saveExistingMission } = require('../tools/missionEditorFiles.cjs');
const { createDebugServer } = require('../tools/tankVisualDebugServer.cjs');
const { chooseParsedRows } = require('../tools/csvSmart');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-editor-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ['assets/resources/missions/mission_01.json', 'assets/resources/missions/mission_03.json',
    'data/turn_end_events.csv', 'assets/scripts/core/TurnEndEventDB.ts']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '..', file), path.join(root, file));
  }
  return root;
}
const read = (root, file) => fs.readFileSync(path.join(root, file));
const files = ['assets/resources/missions/mission_01.json', 'data/turn_end_events.csv', 'assets/scripts/core/TurnEndEventDB.ts'];

test('saving an existing level writes the same JSON/id, retains unknown fields, and leaves other levels/events untouched', t => {
  const root = fixture(t);
  const loaded = loadExistingMission(root, 'missions/mission_01');
  const original = structuredClone(loaded.mission);
  const other = read(root, 'assets/resources/missions/mission_03.json');
  const events = files.slice(1).map(file => read(root, file));
  loaded.mission.name = 'Edited village';
  loaded.mission.tiles[2][3] = { t: 'F', h: '100000' };
  loaded.mission.roundEvents = [{ effectType: 'airborne_support', reinforcementSide: 'friendly', turns: [2, 4] }];
  const result = saveExistingMission(root, loaded);
  assert.equal(result.mission.id, original.id);
  assert.equal(result.mission.name, 'Edited village');
  assert.deepEqual(result.mission.tiles[2][3], loaded.mission.tiles[2][3]);
  assert.equal(result.mission._comment, original._comment);
  assert.deepEqual(result.mission.objective, original.objective);
  assert.deepEqual(result.mission.roundEvents, loaded.mission.roundEvents);
  assert.notEqual(result.revision, loaded.revision);
  assert.deepEqual(read(root, 'assets/resources/missions/mission_03.json'), other);
  files.slice(1).forEach((file, i) => assert.deepEqual(read(root, file), events[i]));
  const backups = fs.readdirSync(path.join(root, '.codex-tmp/mission-editor-backups'));
  const backup = JSON.parse(read(root, `.codex-tmp/mission-editor-backups/${backups[0]}/${files[0]}`));
  assert.deepEqual(backup, original);
  result.mission.description = 'Second save';
  assert.equal(saveExistingMission(root, result).mission.description, 'Second save');
});

test('edited random events regenerate the runtime table and preserve unrelated rows and notes', t => {
  const root = fixture(t), loaded = loadExistingMission(root, 'missions/mission_01');
  const csvBefore = chooseParsedRows(read(root, files[1]).toString('utf8'), ['mission_id']).rows;
  loaded.turnEndEvents[0].effectType = 'none';
  loaded.turnEndEvents[0].sumMax = 2;
  const saved = saveExistingMission(root, loaded);
  assert.equal(saved.turnEndEvents[0].effectType, 'none');
  const csvAfter = chooseParsedRows(read(root, files[1]).toString('utf8'), ['mission_id']).rows;
  assert.deepEqual(csvAfter.filter(row => row[0] !== loaded.mission.id), csvBefore.filter(row => row[0] !== loaded.mission.id));
  const notesColumn = csvBefore[0].indexOf('notes');
  assert.equal(csvAfter.find(row => row[0] === loaded.mission.id)[notesColumn], csvBefore.find(row => row[0] === loaded.mission.id)[notesColumn]);
  const compiled = ts.transpileModule(read(root, files[2]).toString('utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const ctx = vm.createContext({ exports: {} });
  vm.runInContext(compiled, ctx);
  assert.equal(ctx.exports.turnEndRowForSum(loaded.mission.id, 2).effectType, 'none');
});

test('borrowed event tables are preserved when a mission gets its own edited events', t => {
  const root = fixture(t), file = path.join(root, 'assets/resources/missions/mission_03.json');
  const mission = JSON.parse(fs.readFileSync(file, 'utf8'));
  mission.eventTableId = 'mission_01';
  fs.writeFileSync(file, JSON.stringify(mission));
  const source = loadExistingMission(root, 'missions/mission_01').turnEndEvents;
  const loaded = loadExistingMission(root, 'missions/mission_03');
  loaded.turnEndEvents = [];
  const saved = saveExistingMission(root, loaded);
  assert.equal(saved.mission.eventTableId, 'mission_03');
  assert.deepEqual(saved.turnEndEvents, []);
  assert.deepEqual(loadExistingMission(root, 'missions/mission_01').turnEndEvents, source);
});

test('stale revisions, invalid paths, renamed IDs, and generation failures cannot overwrite files', t => {
  const root = fixture(t), original = files.map(file => read(root, file));
  const loaded = loadExistingMission(root, 'missions/mission_01');
  for (const name of ['missions/../mission_01', '../data/units', 'missions/mission_01.json', 'missions/missing']) {
    assert.throws(() => loadExistingMission(root, name));
  }
  assert.throws(() => saveExistingMission(root, { ...loaded, revision: 'old' }), /发生变化/);
  assert.throws(() => saveExistingMission(root, { ...loaded, mission: { ...loaded.mission, id: 'other' } }), /关卡配置无效/);
  loaded.turnEndEvents[0].effectType = 'none';
  assert.throws(() => saveExistingMission(root, loaded, () => { throw new Error('generator failed'); }), /generator failed/);
  files.forEach((file, i) => assert.deepEqual(read(root, file), original[i]));
});

test('HTTP roundtrip saves nested mission paths and reloads fresh file data', async t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'assets/resources/missions/campaign_pacific'));
  fs.copyFileSync(path.join(root, files[0]), path.join(root, 'assets/resources/missions/campaign_pacific/test.json'));
  const server = createDebugServer(root);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (action, payload) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/missions/${action}`, {
      method: 'POST', headers: { Origin: 'http://localhost:7456', 'Content-Type': 'application/json', 'X-Tank-Debug': '1' },
      body: JSON.stringify(payload),
    });
    return { status: response.status, data: await response.json() };
  };
  const loaded = await request('load', { missionPath: 'missions/campaign_pacific/test' });
  assert.equal(loaded.status, 200);
  loaded.data.mission.name = 'Nested mission';
  const saved = await request('save', loaded.data);
  assert.equal(saved.status, 200);
  assert.equal((await request('load', { missionPath: loaded.data.missionPath })).data.mission.name, 'Nested mission');
  assert.equal((await request('save', loaded.data)).status, 400);
});

const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/view/MainMenuScene.ts'), 'utf8');
const ast = ts.createSourceFile('MainMenuScene.ts', source, ts.ScriptTarget.Latest, true);
function initializer(name) {
  let found;
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === name) found = n.initializer;
    ts.forEachChild(n, visit);
  }
  visit(ast);
  assert.ok(found, name);
  return found;
}
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2019 } }).outputText;
function uiContext() {
  return vm.createContext({
    editingExistingMission: { id: 'mission_01', missionPath: 'missions/mission_01', revision: 'before' },
    editingPackageId: null, existingMissionSaving: false, panel: { isValid: true },
    currentLabel: {}, saveButtonLabel: {}, existingDeleteButton: { redraw() {} }, BTN_LEVEL_LOCKED: 0, MODAL_CLOSE_BG: 1,
    draftName: 'Edited', t: key => key, statusLabel: {}, draftBaseMission: { _comment: 'retain', id: 'mission_01' },
    captureMissionFields() {}, cloneJson: v => JSON.parse(JSON.stringify(v)),
    draftSherman: { kind: 'sherman', at: { col: 0, row: 0 }, facing: 0 }, draftShermanStartByDice: false,
    draftDescription: 'Description', draftTerrainCategory: 'europe', cols: 1, rows: 1,
    draftTiles: [[{ t: 'f' }]], draftEnemies: [], draftObjective: { type: 'destroy_all_enemies' }, draftRoundEvents: [],
    draftRowParityOffset: 0, draftTruckPath: [], draftAllies: [], draftEnemyStartByDice: false, draftEnemyDiceEidMax: undefined,
    draftWeather: 'clear', draftSeason: 'summer', draftGermanTankCamouflage: 'grey',
    buildTurnEndEvents: () => [], validateRoundEvents: () => [],
    CustomMissionStore: { save() { throw new Error('must not save custom package'); } },
  });
}
test('real UI save routes to the original resource file, retains ID, blocks duplicates and updates revision', async () => {
  const ctx = uiContext();
  let sent, release;
  ctx.requestMissionFile = (action, payload) => {
    sent = { action, payload };
    return new Promise(resolve => { release = resolve; });
  };
  vm.runInContext(compile(`const refreshCurrentLabel = ${initializer('refreshCurrentLabel').getText(ast)};
    const buildDraftMission = ${initializer('buildDraftMission').getText(ast)};
    const saveExistingMissionFile = ${initializer('saveExistingMissionFile').getText(ast)};`), ctx);
  const pending = vm.runInContext('saveExistingMissionFile()', ctx);
  assert.equal(sent.action, 'save');
  assert.equal(sent.payload.mission.id, 'mission_01');
  assert.equal(sent.payload.missionPath, 'missions/mission_01');
  assert.equal(sent.payload.mission._comment, 'retain');
  assert.equal(ctx.saveButtonLabel.string, '保存中…');
  await vm.runInContext('saveExistingMissionFile()', ctx);
  ctx.draftName = 'Newer edit during save';
  release({ revision: 'after', mission: { eventTableId: 'mission_01' }, file: 'assets/resources/missions/mission_01.json' });
  await pending;
  assert.equal(ctx.editingExistingMission.revision, 'after');
  assert.equal(ctx.saveButtonLabel.string, '保存现有关卡');
  assert.equal(ctx.draftName, 'Newer edit during save');
  assert.match(ctx.statusLabel.string, /已保存现有关卡/);
});

test('real UI retains source target after failure and new mode restores custom saving', async () => {
  const ctx = uiContext();
  ctx.requestMissionFile = async () => { throw new Error('offline'); };
  vm.runInContext(compile(`const refreshCurrentLabel = ${initializer('refreshCurrentLabel').getText(ast)};
    const buildDraftMission = ${initializer('buildDraftMission').getText(ast)};
    const saveExistingMissionFile = ${initializer('saveExistingMissionFile').getText(ast)};`), ctx);
  await vm.runInContext('saveExistingMissionFile()', ctx);
  assert.match(ctx.statusLabel.string, /保存失败.*offline/);
  assert.equal(ctx.editingExistingMission.missionPath, 'missions/mission_01');
  assert.equal(ctx.existingMissionSaving, false);
  Object.assign(ctx, { cloneEditorTiles: () => [[]], refreshDraftForNewMission() {}, rebuildGrid() {}, refreshSelection() {} });
  const newCallback = initializer('newBtn').arguments[6].getText(ast);
  vm.runInContext(compile(`(${newCallback})()`), ctx);
  assert.equal(ctx.editingExistingMission, null);
  assert.equal(ctx.editingPackageId, null);
  assert.equal(ctx.saveButtonLabel.string, 'levelEditor.workspace.save');
  assert.ok(initializer('editExistingBtn').getText(ast).includes('openImportMissionPicker(true)'));
});
