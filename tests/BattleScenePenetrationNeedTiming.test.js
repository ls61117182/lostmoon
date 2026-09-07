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

test('a missed AP attack keeps the initialized penetration target text', () => {
  const revealStart = source.indexOf('private revealMainGunDiceRows');
  const revealEnd = source.indexOf('private setMainGunDiceOutcome', revealStart);
  assert.ok(revealStart >= 0 && revealEnd > revealStart, 'revealMainGunDiceRows should exist');

  const revealBody = source.slice(revealStart, revealEnd);
  assert.doesNotMatch(
    revealBody,
    /show\.penNeedLabel\.string = t\('dice\.panel\.penCheck'\)/,
    'the miss branch should not overwrite the penetration threshold label',
  );
  assert.match(
    revealBody,
    /else \{[\s\S]*?show\.penNeedLabel\.color = DICE_INFO_TEXT[\s\S]*?show\.penVerdictLabel\.string = t\('dice\.panel\.invalid'\)/,
    'the miss branch should only mark the penetration result invalid',
  );
});
