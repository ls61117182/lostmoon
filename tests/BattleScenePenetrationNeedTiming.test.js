const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'scripts', 'view', 'BattleScene.ts'),
  'utf8',
);

test('AP penetration target text is initialized with the result panel', () => {
  const buildStart = source.indexOf('private buildDiceShowPanel');
  const buildEnd = source.indexOf('private makeDiceRuleButton', buildStart);
  assert.ok(buildStart >= 0 && buildEnd > buildStart, 'buildDiceShowPanel should exist');

  const buildBody = source.slice(buildStart, buildEnd);
  assert.match(
    buildBody,
    /const initialPenNeedText = !highExplosiveReport && report\.penThreshold !== undefined[\s\S]*?dice\.panel\.penMustPen[\s\S]*?dice\.panel\.penetrateNeed/,
    'AP penetration text should be resolved while the panel is built',
  );
  assert.match(
    buildBody,
    /penNeed = this\.makeCenteredLabel\(panel, initialPenNeedText,/,
    'the penetration label should not be created with an empty string',
  );
});
