const test = require('node:test');
const assert = require('node:assert/strict');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');

const History = sceneMethods(['combatLogDisplayText', 'combatLogDisplayRichLine'], {
  t: key => ({
    'battleLog.combat.resultMiss': '未命中',
    'battleLog.combatMg.hit': '击毁',
  })[key] ?? key,
  unitDisplayName: kind => kind,
  COMBAT_LOG_UNIT_COLOR: { player: '#player', enemy: '#enemy', ally: '#ally' },
});

for (const key of ['battleLog.combatMg', 'battleLog.combatMgAI']) {
  for (const [primaryHit, secondaryHit] of [
    [false, true], [true, false], [true, true], [false, false],
    [true, undefined], [false, undefined],
  ]) {
    test(`${key}: history summarizes MG hits ${primaryHit}/${secondaryHit}`, () => {
      const history = new History();
      history.escapeCombatLogRichText = text => text;
      history.combatLogPhraseColor = text => text === '击毁' ? '#hit' : '#miss';
      const entry = JSON.parse(JSON.stringify({
        key,
        replay: {
          kind: 'attack', mg: true,
          attackerKind: 'panzer4', targetKind: 'infantry',
          attackerTone: key === 'battleLog.combatMg' ? 'player' : 'enemy',
          targetTone: 'ally',
          report: { hit: primaryHit },
          secondaryMGReport: secondaryHit === undefined ? undefined : { hit: secondaryHit },
        },
      }));
      const hit = primaryHit || secondaryHit === true;
      const result = hit ? '击毁' : '未命中';
      const text = history.combatLogDisplayText(entry);
      const rich = history.combatLogDisplayRichLine(entry);
      assert.equal(text, `panzer4 → infantry：${result}`);
      assert.equal(rich.replace(/<[^>]+>/g, ''), text);
      assert.ok(rich.includes(`<color=${hit ? '#hit' : '#miss'}>${result}</color>`));
      assert.equal(entry.replay.report.hit, primaryHit, 'preserve each weapon result for replay');
    });
  }
}
