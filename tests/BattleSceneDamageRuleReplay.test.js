const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  }).outputText, filename);
};

const { rollAttack } = require('../assets/scripts/core/Combat.ts');
const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { DAMAGE_TABLE } = require('../assets/scripts/core/DamageTableDB.ts');
const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/view/BattleScene.ts'), 'utf8');
const methods = ['damageTargetClassForRule', 'populateDiceRuleDamage', 'damageTableEntryText'].map(name => {
  const start = source.indexOf(`  private ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}).join('\n');
const compiled = ts.transpileModule(`class RulePanel { ${methods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2017 },
}).outputText;
const RulePanel = new Function('DAMAGE_TABLE', 't', 'HUD_TEXT_COLOR',
  `${compiled}; return RulePanel;`)(DAMAGE_TABLE, key => key, null);

function attack(die, hitDice = [6, 5], penDice = [6, 6]) {
  const stats = {
    size: 4, armorFront: 11, armorFrontSide: 10, armorRearSide: 9, armorRear: 8,
    penetration: 4, effectiveRange: 2, visionRange: 4, visionType: 'turreted',
  };
  const attacker = {
    id: 't34', kind: 't34_85', faction: 'soviet', sideId: 'player',
    pos: { q: 0, r: 1 }, facing: 4, turretFacing: 4,
    stats: { ...stats, damageTargetClass: 'us_tank' },
  };
  const target = {
    id: 'p4', kind: 'panzer4', faction: 'german', sideId: 'enemy',
    pos: { q: 0, r: 0 }, facing: 0, turretFacing: 0,
    stats: { ...stats, damageTargetClass: 'german_tank' },
    crew: { commander: true, loader: true, gunner: true, driver: true, coDriver: true },
  };
  const map = new HexMap(2, 2);
  for (const unit of [attacker, target]) map.set({ pos: unit.pos, terrain: 'field' });
  const dice = [...hitDice, ...penDice, die];
  return rollAttack({ attacker, target, map, protagonist: attacker,
    directionalDamageCheck: true, unitDamageTargetClass: true,
    expandedTurretDirections: true }, { d6: () => dice.shift() ?? 1 });
}

test('T-34/85 right-side hits retain the target table for every damage die', () => {
  const expected = [['fire', 'crewCheck'], ['fire', 'paralyzed'], ['fire', 'paralyzed'],
    ['fire', 'turret'], ['destroyed'], ['destroyed']];
  for (let die = 1; die <= 6; die++) {
    const report = attack(die);
    assert.equal(report.hit, true);
    assert.equal(report.penetrated, true);
    assert.equal(report.damageCheckType, 'right');
    assert.equal(report.damageTargetClass, 'german_tank');
    assert.equal(report.damageDie, die);
    assert.deepEqual(report.damageEffects.map(step => step.effect), expected[die - 1]);
  }
});

test('a serialized replay with no live target renders all six damage-table rows', () => {
  const report = JSON.parse(JSON.stringify(attack(6)));
  const panel = new RulePanel();
  const labels = [];
  panel.makeBattleModalLabel = (_parent, text) => labels.push(text);
  panel.makeDieSquare = () => ({});
  panel.setDieLabelFace = () => {};
  panel.damageTargetClassText = value => value;
  panel.damageCheckTypeText = value => value;
  panel.damageTableEffectText = effect => effect.kind;
  panel.populateDiceRuleDamage({}, { report, target: null }, 0, 460);
  assert.equal(labels[1], 'german_tank');
  assert.deepEqual(labels.slice(4), ['fire + crew', 'fire + paralyzed',
    'fire + paralyzed', 'fire + turret', 'destroyed', 'destroyed']);
});

test('failed hit and penetration checks also retain the selected table', () => {
  const miss = attack(3, [1, 1]);
  assert.equal(miss.hit, false);
  assert.equal(miss.damageTargetClass, 'german_tank');
  const bounce = attack(3, [6, 5], [1, 1]);
  assert.equal(bounce.hit, true);
  assert.equal(bounce.penetrated, false);
  assert.equal(bounce.damageTargetClass, 'german_tank');
});
