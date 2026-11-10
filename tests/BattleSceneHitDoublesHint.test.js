const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const test = require('node:test');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, file);
const geometry = require('../assets/scripts/core/UnitFootprint.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { createTankCrew } = require('../assets/scripts/core/types.ts');
const combat = require('../assets/scripts/core/Combat.ts');
const { HexMap } = require('../assets/scripts/core/HexGrid.ts');

const root = path.resolve(__dirname, '..');
const battleScene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');
const langDB = fs.readFileSync(path.join(root, 'assets/scripts/core/LangDB.ts'), 'utf8');

const hitRuleSpec = battleScene.match(/if \(kind === 'hit'\) \{[\s\S]*?\n    if \(kind === 'pen'\)/);
assert.ok(hitRuleSpec, 'hit rule modal spec should exist');
assert.match(
  hitRuleSpec[0],
  /const showOpenHatchCommanderHint = show\.targetCommanderExposed;[\s\S]*?note: showOpenHatchCommanderHint \? t\('dice\.rule\.hitDoublesCommanderKiaHint'\) : undefined/,
  'the hint should be attached whenever the attacked commander was exposed',
);
assert.match(
  battleScene,
  /targetCommanderExposed: report\.targetCommanderExposed \?\? \(opts\.target\?\.hatchOpen === true[\s\S]*?selectedUnitHitHex\(opts\.target\)[\s\S]*?unitTurretHex\(opts\.target\)/,
  'the exposed commander state should be captured before attack resolution regardless of hit result',
);
assert.match(
  battleScene,
  /if \(spec\.note\) \{[\s\S]*?makeBattleModalLabel\(panel, spec\.note/,
  'the rule modal should render its optional note below the calculation',
);
assert.match(langDB, /同点数命中时会造成开舱状态的车长阵亡/);

console.log('BattleScene hit-doubles hint tests passed');

const ast = ts.createSourceFile('BattleScene.ts', battleScene, ts.ScriptTarget.Latest, true);
const sceneClass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'BattleScene');
const startDiceShow = sceneClass.members.find(n => n.name?.getText(ast) === 'startDiceShow');
let exposureExpression;
function findExposure(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'targetCommanderExposed') exposureExpression = node.initializer.getText(ast);
  ts.forEachChild(node, findExposure);
}
findExposure(startDiceShow);
assert(exposureExpression);
const evaluate = new Function('report','opts','isTwoHexUnit','selectedUnitHitHex','unitTurretHex','axialEquals', `return (${exposureExpression});`);
const exposed = (report,target) => evaluate(report,{target},geometry.isTwoHexUnit,geometry.selectedUnitHitHex,geometry.unitTurretHex,geometry.sameHex);
const Panel = require('./helpers/BattleSceneMethods.cjs')(['highExplosivePanelReport']);

test('AP/HE hit hints use the resolved hit cell, including raw physical targets and settled replay', () => {
  const map = new HexMap(8,8);
  for (let q=-4;q<=4;q++) for (let r=-4;r<=4;r++) map.set({pos:{q,r},terrain:'field'});
  for (const shell of ['ap','he']) for (const rear of [false,true]) {
    const stats=getUnitStats('maus');
    const target={id:'target',kind:'maus',stats,pos:{q:0,r:0},facing:0,crew:createTankCrew(stats),hatchOpen:true,faction:'german'};
    const attacker={id:'attacker',kind:'sherman',stats:getUnitStats('sherman'),pos:{q:0,r:2},facing:4,faction:'usa'};
    const hitHex=rear?geometry.unitRearHex(target):target.pos;
    const ctx={map,attacker,target,targetHex:hitHex,shellType:shell};
    const report=(shell==='he'?combat.rollHighExplosiveAttack:combat.rollAttack)(ctx,{d6:()=>6});
    const panelReport=shell==='he'?new Panel().highExplosivePanelReport(report):report;
    assert.equal(exposed(panelReport,target),rear);
    target.hatchOpen=false;target.crew.commander=false;
    assert.equal(exposed(JSON.parse(JSON.stringify(panelReport)),target),rear,'settlement must not rewrite the shot-time hint');
    assert.equal(exposed(panelReport,null),rear,'history can display the correct hint without a live target');
  }
});

test('legacy hit reports only show open-hatch hints for the selected turret cell', () => {
  const stats=getUnitStats('maus');
  const target={kind:'maus',stats,pos:{q:0,r:0},facing:0,crew:createTankCrew(stats),hatchOpen:true};
  assert.equal(exposed({},geometry.unitHitView(target,target.pos)),false);
  assert.equal(exposed({},geometry.unitHitView(target,geometry.unitRearHex(target))),true);
  target.stats={...stats,turretCell:'front'};
  assert.equal(exposed({},geometry.unitHitView(target,target.pos)),true);
  assert.equal(exposed({},geometry.unitHitView(target,geometry.unitRearHex(target))),false);
});
