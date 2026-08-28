const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'scripts', 'view', 'BattleScene.ts'),
  'utf8',
);

test('every attack-result dice layout leaves clear space above confirmation', () => {
  const compactHeight = Number(source.match(/basePanelH\s*=\s*compactPanel\s*\?\s*(\d+)/)?.[1]);
  const crewHeight = Number(source.match(/compactPanel\s*\?\s*\d+\s*:\s*needsCrewRow\s*\?\s*(\d+)/)?.[1]);
  const standardHeight = Number(source.match(/needsCrewRow\s*\?\s*\d+\s*:\s*(\d+)/)?.[1]);

  assert.ok(compactHeight && crewHeight && standardHeight, 'DiceShow panel heights should be explicit');

  // Mirrors buildDiceShowPanel geometry. Gap is measured between the bottom
  // edge of the lowest die and the top edge of the 44 px confirmation button.
  const compactGap = compactHeight - 236;
  const standardDamageGap = standardHeight - 384;
  const crewGap = crewHeight - 472;

  for (const [layout, gap] of [
    ['compact', compactGap],
    ['standard damage', standardDamageGap],
    ['crew check', crewGap],
  ]) {
    assert.ok(gap >= 32, `${layout} dice-to-confirm gap should be at least 32 px; got ${gap}`);
  }
});
