const fs = require('node:fs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText, file);
const { CustomMissionStore } = require('../assets/scripts/core/CustomMissionStore.ts');
const source = fs.readFileSync('assets/scripts/view/MainMenuScene.ts', 'utf8');
const ast = ts.createSourceFile('MainMenuScene.ts', source, ts.ScriptTarget.Latest, true);
function find(predicate) {
  let result;
  function visit(node) { if (!result && predicate(node)) result = node; ts.forEachChild(node, visit); }
  visit(ast); assert.ok(result, 'missing actual editor code'); return result;
}
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2019 } }).outputText;
const builder = find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'buildDraftMission').initializer.getText(ast);
const button = find(n => ts.isCallExpression(n) && n.expression.getText(ast) === 'addPlainBtn' && n.arguments[0].getText(ast).includes('German paint:')).getText(ast);
function context() {
  return vm.createContext({ captureMissionFields() {}, cloneJson: v => JSON.parse(JSON.stringify(v)),
    draftBaseMission: { germanTankCamouflage: 'late_war' }, draftSherman: { kind: 'sherman', at: { col: 0, row: 0 }, facing: 0 },
    draftShermanStartByDice: false, draftName: 'Test', draftDescription: 'Test', draftTerrainCategory: 'europe', cols: 2, rows: 1,
    draftTiles: [[{ t: 'f' }, { t: 'f' }]], draftEnemies: [], draftObjective: { type: 'destroy_all_enemies' }, draftRoundEvents: [],
    draftRowParityOffset: 0, draftTruckPath: [], draftAllies: [], draftEnemyStartByDice: false, draftEnemyDiceEidMax: undefined,
    draftWeather: 'clear', draftSeason: 'summer', draftGermanTankCamouflage: 'grey', getLang: () => 'zh',
  });
}
test('the real editor button and export builder roundtrip late war and explicitly clear inherited paint', () => {
  const ctx = context(); let click, label;
  ctx.addPlainBtn = (text, x, y, w, h, active, onClick) => { label = text; click = onClick; };
  const build = vm.runInContext(compile(`const build = ${builder}; build;`), ctx);
  assert.equal(build('new', null, 'Test').germanTankCamouflage, undefined, 'new levels remain grey even if a spread base used late war');
  vm.runInContext(compile(button), ctx);
  assert.match(label, /德军灰/);
  click();
  vm.runInContext(compile(button), ctx);
  assert.match(label, /后期三色迷彩/);
  const late = JSON.parse(JSON.stringify(build('new', null, 'Test')));
  assert.equal(late.germanTankCamouflage, 'late_war');
  const id = CustomMissionStore.saveTransient('camouflage-editor-test', { schemaVersion: 2, mission: late, turnEndEvents: [], editorVersion: '1', source: 'player', savedAt: 0 });
  assert.equal(CustomMissionStore.load(id).mission.germanTankCamouflage, 'late_war');
  click();
  assert.equal(build('new', null, 'Test').germanTankCamouflage, undefined);
});
test('initial editor state, imports and new-mission resets read or reset paint instead of leaking between drafts', () => {
  const init = find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'draftGermanTankCamouflage').initializer.getText(ast);
  for (const value of [undefined, 'grey', 'late_war']) {
    const ctx = context(); ctx.existingPackage = { mission: { germanTankCamouflage: value } };
    assert.equal(vm.runInContext(compile(init), ctx), value === 'late_war' ? 'late_war' : 'grey');
    ctx.mission = { germanTankCamouflage: value };
    const imported = find(n => ts.isBinaryExpression(n) && n.left.getText(ast) === 'draftGermanTankCamouflage' && n.right.getText(ast).includes('mission.germanTankCamouflage')).getText(ast);
    vm.runInContext(compile(imported), ctx);
    assert.equal(ctx.draftGermanTankCamouflage, value === 'late_war' ? 'late_war' : 'grey');
  }
  const reset = find(n => ts.isBinaryExpression(n) && n.left.getText(ast) === 'draftGermanTankCamouflage' && n.right.getText(ast) === "'grey'").getText(ast);
  const ctx = context(); ctx.draftGermanTankCamouflage = 'late_war';
  vm.runInContext(compile(reset), ctx);
  assert.equal(ctx.draftGermanTankCamouflage, 'grey');
});
