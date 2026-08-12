const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'),
  'utf8',
);

function methodBody(name, nextName) {
  const start = source.indexOf(`private ${name}`);
  const end = source.indexOf(`private ${nextName}`, start + 1);
  assert(start >= 0, `missing ${name}`);
  assert(end > start, `missing method after ${name}`);
  return source.slice(start, end);
}

const turnEndEntry = methodBody(
  'maybeBeginTurnEndEventOrEndEnemyPhase',
  'continueAfterTurnEndEvent',
);
assert.match(
  turnEndEntry,
  /turnEndEventProvider\.has\(mid\)[\s\S]*startTurnEndEventFlow\(mid\)[\s\S]*continueAfterTurnEndEvent\(\)/,
  'turn-end events must be started before the Pacific US casualty phase',
);
assert.doesNotMatch(
  turnEndEntry,
  /beginPacificUsCasualtyCheckOrContinue/,
  'the US casualty phase must not start before checking for a turn-end event',
);

const afterTurnEnd = methodBody(
  'continueAfterTurnEndEvent',
  'beginPacificUsCasualtyCheckOrContinue',
);
assert.match(
  afterTurnEnd,
  /beginPacificUsCasualtyCheckOrContinue\(\)[\s\S]*endEnemyPhase\(\)/,
  'the Pacific US casualty phase must run after the turn-end event and before the next turn',
);

const casualtyConfirm = methodBody(
  'onUsCasualtyConfirmClick',
  'destroyTurnEndEventUI',
);
assert.match(casualtyConfirm, /this\.endEnemyPhase\(\)/);
assert.doesNotMatch(casualtyConfirm, /startTurnEndEventFlow|continueAfterTurnEndEvent/);

const eventConfirm = methodBody(
  'onTurnEndConfirmClick',
  'enqueueTankReinforceMoveAnim',
);
assert.match(eventConfirm, /this\.continueAfterTurnEndEvent\(\)/);
assert.doesNotMatch(
  eventConfirm,
  /this\.endEnemyPhase\(\)/,
  'every completed turn-end event path must pass through the US casualty phase',
);

console.log('BattleScene Pacific turn-end order tests passed');
