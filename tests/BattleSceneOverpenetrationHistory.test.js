const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/view/BattleScene.ts'), 'utf8');
const methods = ['presentAttackResult', 'combatLogIsVisible', 'combatLogDisplayText', 'damageEffectLogKey'].map(name => {
  const start = source.indexOf(`  private ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}).join('\n');
const start = source.indexOf('function combatLogDamageOutcomeLabel(');
const helper = source.slice(start, source.indexOf('\n}', start) + 2);
const compiled = ts.transpileModule(`${helper}\nclass History { ${methods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2017 },
}).outputText;
const outcome = () => ({ text: '过穿', color: {} });
const History = new Function('t', 'Color', 'isFootUnit', 'unitDisplayName',
  'overpenetrationOutcomeLabel', 'damageOutcomeLabel',
  `${compiled}; return History;`)(key => key, class {}, () => false, kind => kind,
  outcome, effect => ({ text: effect, color: {} }));

function record(report) {
  const history = new History();
  const player = { kind: 't34_85', sideId: 'player' };
  const enemy = { kind: 'panzer3', sideId: 'enemy', pos: { q: 0, r: 0 } };
  const entries = [];
  history.mission = { sherman: player };
  history.combatLogUnitTone = unit => unit.sideId;
  history.penDiceExpr = () => '6+6=12';
  history.battleLogI18n = (key, params, replay) => entries.push({ key, params, replay });
  history.spawnFloater = history.redraw = () => {};
  history.computeOutcome = () => 'ongoing';
  history.presentAttackResult('player', report, player, enemy);
  return { history, visible: entries.filter(entry => history.combatLogIsVisible(entry)) };
}

const base = {
  dice: [6, 5], roll: 11, threshold: 5, hit: true, penetrated: true,
  overpenetrated: true, overpenetrationSuppressedEffects: ['destroyed'],
  damageEffects: [], penetrationBreakdown: { penetrationBonus: 2, effectiveRangeBonus: 2 },
};

test('HVAP overpenetration with no remaining damage produces one visible, replayable attack', () => {
  const { history, visible } = record(base);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].replay.report, base);
  assert.equal(visible[0].params.effectKey, 'dmg.outcome.overpenetration');
  assert.equal(history.combatLogDisplayText(visible[0]), 't34_85 → panzer3：过穿');
});

test('overpenetration with surviving damage keeps one result with its actual effect', () => {
  const { history, visible } = record({ ...base, damageEffect: 'turret',
    damageEffects: [{ effect: 'turret' }], overpenetrationSuppressedEffects: ['fire'] });
  assert.equal(visible.length, 1);
  assert.equal(history.combatLogDisplayText(visible[0]), 't34_85 → panzer3：turret');
});

test('a missed shot with staged overpenetration remains a single miss result', () => {
  const { history, visible } = record({ ...base, hit: false });
  assert.equal(visible.length, 1);
  assert.equal(history.combatLogDisplayText(visible[0]), 't34_85 → panzer3：battleLog.combat.resultMiss');
});
