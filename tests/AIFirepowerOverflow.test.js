const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { rollHardcoreTankAIDice, hardcoreTankAIDiceCount, actionForHardcoreTankDie } = require('../assets/scripts/core/EnemyAI.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { createTankCrew } = require('../assets/scripts/core/types.ts');

function unit(firepower) {
  const stats = { ...getUnitStats('sherman'), firepower };
  return { kind: 'sherman', stats, crew: createTankCrew(stats), faction: stats.faction };
}

test('AI firepower splits into full dice and a remainder die at every six-point boundary', () => {
  for (const [power, faces] of [[0,[0]], [1,[1]], [6,[6]], [7,[6,1]], [8,[6,2]], [12,[6,6]], [14,[6,6,2]], [18,[6,6,6]], [20,[6,6,6,2]]]) {
    const actor = unit(power);
    const dice = rollHardcoreTankAIDice({ d6: () => 6 }, actor, 'road');
    assert.deepEqual(dice.filter(d => d.type === 'attack').map(d => d.attackFirepower), faces);
    assert.equal(hardcoreTankAIDiceCount(actor, 'road').attack, faces.length);
    for (const faceCount of faces) {
      for (let pip = 1; pip <= 6; pip++) {
        assert.equal(actionForHardcoreTankDie(actor, 'attack', pip, 0, faceCount).primary, pip <= faceCount ? 'shoot' : 'none');
      }
    }
    assert.deepEqual(dice.filter(d => d.type !== 'attack'), rollHardcoreTankAIDice({ d6: () => 6 }, unit(6), 'road').filter(d => d.type !== 'attack'));
  }
});

test('terrain changes both the overflow count and final die threshold', () => {
  assert.deepEqual(rollHardcoreTankAIDice({ d6: () => 1 }, unit(7), 'mud').filter(d => d.type === 'attack').map(d => d.attackFirepower), [6]);
  assert.deepEqual(rollHardcoreTankAIDice({ d6: () => 1 }, unit(14), 'mud').filter(d => d.type === 'attack').map(d => d.attackFirepower), [6,6,1]);
});

test('sorting and subsequent stat changes preserve each rolled die threshold', () => {
  const actor = unit(8);
  let roll = 0;
  const dice = rollHardcoreTankAIDice({ d6: () => ++roll === 1 ? 6 : 3 }, actor, 'road').filter(d => d.type === 'attack');
  dice.sort((a,b) => a.pip - b.pip);
  actor.stats.firepower = 20;
  assert.deepEqual(dice.map(d => actionForHardcoreTankDie(actor, d.type, d.pip, -2, d.attackFirepower).primary), ['none', 'shoot']);
});

test('battle scene resolves each attack using its stored threshold', () => {
  const vm = require('node:vm');
  const source = ts.createSourceFile('BattleScene.ts', fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const cls = source.statements.find(s => ts.isClassDeclaration(s) && s.name?.text === 'BattleScene');
  const method = cls.members.find(m => m.name?.getText(source) === 'enemyDieActionEntry').getText(source);
  const js = ts.transpileModule('class Host {' + method + '}', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const Host = vm.runInNewContext(js + ';Host', { actionForHardcoreTankDie });
  const host = new Host();
  Object.assign(host, { enemyOrder: [unit(14)], enemyIndex: 0, enemyDice: [6, 5, 3], enemyDiceTypes: ['attack', 'attack', 'attack'], enemyDiceFirepower: [6, 6, 2], enemyFirepowerModifier: 0 });
  assert.deepEqual([0,1,2].map(i => host.enemyDieActionEntry(i).primary), ['shoot', 'shoot', 'none']);
  host.enemyDice[2] = 2;
  assert.equal(host.enemyDieActionEntry(2).primary, 'shoot');
});
