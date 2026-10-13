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

/** Keep the three attack posts unavailable to isolate point-to-face conversion. */
function unit(firepower) {
  const stats = { ...getUnitStats('sherman'), firepower };
  return { kind: 'sherman', stats, crew: { ...createTankCrew(stats), commander: false, gunner: false, loader: false }, faction: stats.faction };
}

test('veteran tank gains one firepower with terrain and partial overflow faces', () => {
  for (const [power, terrain, faces] of [[0, 'road', [3]], [2, 'road', [6, 3]], [2, 'mud', [6]]]) {
    const actor = { ...unit(power), unitLevel: 'veteran' };
    const attacks = rollHardcoreTankAIDice({ d6: () => 6 }, actor, terrain).filter(d => d.type === 'attack');
    assert.deepEqual(attacks.map(d => d.attackFirepower), faces);
    assert.equal(hardcoreTankAIDiceCount(actor, terrain).attack, faces.length);
  }
  const player = { ...unit(1), unitLevel: 'veteran', crewLevels: { gunner: 'veteran' } };
  assert.deepEqual(rollHardcoreTankAIDice({ d6: () => 6 }, player, 'road').filter(d => d.type === 'attack').map(d => d.attackFirepower), [3]);
});

test('elite tank gains two firepower with full and partial dice', () => {
  for (const [power, terrain, faces] of [[-1, 'road', [3]], [2, 'road', [6, 6]], [2, 'mud', [6, 3]], [3, 'road', [6, 6, 3]]]) {
    const actor = { ...unit(power), unitLevel: 'elite' };
    const attacks = rollHardcoreTankAIDice({ d6: () => 6 }, actor, terrain).filter(d => d.type === 'attack');
    assert.deepEqual(attacks.map(d => d.attackFirepower), faces);
    assert.equal(hardcoreTankAIDiceCount(actor, terrain).attack, faces.length);
    assert.equal(actionForHardcoreTankDie(actor, 'attack', 6, 0, faces.at(-1)).primary, faces.at(-1) === 6 ? 'reload' : 'none');
  }
  const player = { ...unit(2), unitLevel: 'elite', crewLevels: { gunner: 'elite' } };
  assert.deepEqual(rollHardcoreTankAIDice({ d6: () => 6 }, player, 'road').filter(d => d.type === 'attack').map(d => d.attackFirepower), [6]);
});

test('AI firepower splits into full dice and a remainder die at every two-point boundary', () => {
  for (const [power, faces] of [[-4,[3]], [-1,[3]], [0,[3]], [1,[3]], [2,[6]], [3,[6,3]], [4,[6,6]], [5,[6,6,3]], [6,[6,6,6]], [7,[6,6,6,3]]]) {
    const actor = unit(power);
    const dice = rollHardcoreTankAIDice({ d6: () => 6 }, actor, 'road');
    assert.deepEqual(dice.filter(d => d.type === 'attack').map(d => d.attackFirepower), faces);
    assert.equal(hardcoreTankAIDiceCount(actor, 'road').attack, faces.length);
    for (const faceCount of faces) {
      for (let pip = 1; pip <= 6; pip++) {
        assert.equal(actionForHardcoreTankDie(actor, 'attack', pip, 0, faceCount).primary, pip <= faceCount ? 'reload' : 'none');
      }
    }
    assert.deepEqual(dice.filter(d => d.type !== 'attack'), rollHardcoreTankAIDice({ d6: () => 6 }, unit(6), 'road').filter(d => d.type !== 'attack'));
  }
});

test('terrain changes both the overflow count and final die threshold', () => {
  assert.deepEqual(rollHardcoreTankAIDice({ d6: () => 1 }, unit(3), 'mud').filter(d => d.type === 'attack').map(d => d.attackFirepower), [6]);
  assert.deepEqual(rollHardcoreTankAIDice({ d6: () => 1 }, unit(6), 'mud').filter(d => d.type === 'attack').map(d => d.attackFirepower), [6,6,3]);
});

test('sorting and subsequent stat changes preserve each rolled die threshold', () => {
  const actor = unit(3);
  let roll = 0;
  const dice = rollHardcoreTankAIDice({ d6: () => ++roll === 1 ? 6 : 4 }, actor, 'road').filter(d => d.type === 'attack');
  dice.sort((a,b) => a.pip - b.pip);
  actor.stats.firepower = 20;
  assert.deepEqual(dice.map(d => actionForHardcoreTankDie(actor, d.type, d.pip, -2, d.attackFirepower).primary), ['none', 'reload']);
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
  assert.deepEqual([0,1,2].map(i => host.enemyDieActionEntry(i).primary), ['reload', 'reload', 'none']);
  host.enemyDice[2] = 2;
  assert.equal(host.enemyDieActionEntry(2).primary, 'reload');
});
