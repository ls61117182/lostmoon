const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

function methodBody(name, nextName) {
  const start = source.indexOf(`private ${name}`);
  const end = source.indexOf(`private ${nextName}`, start + 1);
  assert(start >= 0, `missing ${name}`);
  assert(end > start, `missing method after ${name}`);
  return source.slice(start, end);
}

assert.match(
  methodBody('enterDiceShowHold', 'applyDiceShowDestroyedVisual'),
  /show\.confirmButton\.active\s*=\s*false/,
  'combat-result confirmation must remain hidden when final impact presentation begins',
);
assert.match(
  methodBody('advanceDiceShow', 'finalizeDiceShow'),
  /case 'hold':[\s\S]*?show\.t\s*>=\s*DICE_HOLD_DUR[\s\S]*?show\.confirmButton\.active\s*=\s*true/,
  'combat-result confirmation must appear only after the final presentation hold',
);

for (const [builder, nextMethod] of [
  ['buildFireCheckEventPanel', 'advanceFireCheckEventUI'],
  ['buildUsCasualtyEventPanel', 'setUsCasualtyDieFace'],
  ['buildTurnEndEventPanel', 'beginAdjacentInfantryDiceChain'],
]) {
  const body = methodBody(builder, nextMethod);
  assert.match(body, /confirmB\.node\.active\s*=\s*false/,
    `${builder} must hide confirmation while its settlement animation is running`);
  assert.match(body, /confirmButton:\s*confirmB\.node/,
    `${builder} must expose its confirmation node to the state machine`);
}

assert.match(
  methodBody('advanceFireCheckEventUI', 'onFireCheckConfirmClick'),
  /ui\.stage\s*=\s*'hold';\s*ui\.confirmButton\.active\s*=\s*true/,
  'fire-check confirmation should appear only after dice settle',
);
assert.match(
  methodBody('advanceUsCasualtyEventUI', 'applyUsCasualtyEventUI'),
  /ui\.stage\s*=\s*'hold';[\s\S]*?ui\.resultLabel\.string[\s\S]*?ui\.confirmButton\.active\s*=\s*true/,
  'casualty confirmation should appear only after dice and result settle',
);

const turnEndAdvance = methodBody('advanceTurnEndEventUI', 'onTurnEndConfirmClick');
const holdTransitions = turnEndAdvance.match(/ui\.stage\s*=\s*'hold';/g) ?? [];
const revealTransitions = turnEndAdvance.match(/ui\.confirmButton\.active\s*=\s*true;/g) ?? [];
assert.strictEqual(revealTransitions.length, holdTransitions.length,
  'every terminal turn-end hold transition should reveal confirmation');
assert.match(
  methodBody('beginAdjacentInfantryDiceChain', 'turnEndBodyText'),
  /idx\s*>=\s*volleys\.length[\s\S]*?ui\.root\.active\s*=\s*true[\s\S]*?ui\.confirmButton\.active\s*=\s*true/,
  'adjacent-infantry confirmation should appear only after the full attack chain',
);

console.log('BattleScene settlement confirmation timing tests passed');
