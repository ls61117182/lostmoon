const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const ast = ts.createSourceFile('BattleScene.ts', source, ts.ScriptTarget.Latest, true);
const scene = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'BattleScene');
const methods = ['nextTurnEndUnitId', 'currentEnemyTurretLerp', 'mainGunRecoilOffsetFor'];
const js = ts.transpileModule(`class Harness { ${methods.map(name =>
  scene.members.find(n => n.name?.getText(ast) === name).getText(ast)).join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
const Harness = new Function('mainGunRecoilOffset', `${js}; return Harness;`)(() => ({ x: 4, y: 0 }));
const h = new Harness();
const first = { id: 'turnend_1', facing: 0, turretFacing: 0 };
const third = { id: 'turnend_3', facing: 0, turretFacing: 0 };
const units = [first, third];
h.allUnits = () => units;
h.turnEndUnitSeq = 0;
const second = { id: h.nextTurnEndUnitId(), facing: 0, turretFacing: 0 };
assert.equal(second.id, 'turnend_2', 'loaded reinforcement IDs must be skipped');
units.push(second);
assert.equal(h.nextTurnEndUnitId(), 'turnend_4');
h.enemyTurretFacing = new Map([[first.id, 2]]);
h.mainGunRecoils = new Map([[first.id, { mode: 'turret', elapsed: 0, ux: 1, uy: 0 }]]);
h.hexSize = 50;
assert.equal(h.currentEnemyTurretLerp(first).to, 2);
assert.equal(h.currentEnemyTurretLerp(second).to, 0, 'other tanks retain their own turret heading');
assert.deepEqual(h.mainGunRecoilOffsetFor(first, 'turret'), { x: 4, y: 0 });
assert.deepEqual(h.mainGunRecoilOffsetFor(second, 'turret'), { x: 0, y: 0 }, 'other tanks must not recoil');
console.log('Reinforcement identity and animation isolation tests passed');
