const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const battleScene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const endCurrentSubPhase = battleScene.match(/private\s+endCurrentSubPhase\s*\(\)\s*{[\s\S]*?\n  }\n\n  \/\*\*/);
assert(endCurrentSubPhase, 'BattleScene.endCurrentSubPhase() should be found');

assert(
  /private\s+autoEnterPhaseWhenReady\s*\(/.test(battleScene),
  'BattleScene should have a retrying helper for auto-entering the next player phase after busy attack cleanup',
);

assert(
  endCurrentSubPhase[0].includes('this.autoEnterPhaseWhenReady(next);'),
  'endCurrentSubPhase() should use the retrying helper instead of a one-shot scheduleOnce() when the scene is busy',
);

assert(
  !/scheduleOnce\s*\(\s*\(\)\s*=>\s*this\.enterPhaseIfChoose\(next\)\s*,\s*0\s*\)/.test(endCurrentSubPhase[0]),
  'endCurrentSubPhase() should not rely on a one-frame retry that can fire while DiceShow is still busy',
);

const enterDiceShowHold = battleScene.match(/private\s+enterDiceShowHold\s*\(\s*show:\s*DiceShow\s*\)\s*{[\s\S]*?\n  }\n\n  private\s+applyDiceShowDestroyedVisual/);
assert(enterDiceShowHold, 'BattleScene.enterDiceShowHold() should be found');

assert(
  /show\.confirmButton\.active\s*=\s*!show\.mg\s*\|\|\s*show\.requireManualClose/.test(enterDiceShowHold[0]),
  'manual-close MG DiceShow panels should show the confirm button so the last misc MG result can be dismissed',
);

const holdStage = battleScene.match(/case\s+'hold'\s*:\s*{[\s\S]*?break;\s*\n\s*}/);
assert(holdStage, 'BattleScene.advanceDiceShow() hold stage should be found');

assert(
  /show\.mg\s*&&\s*!show\.requireManualClose\s*&&\s*show\.t\s*>=\s*DICE_HOLD_DUR/.test(holdStage[0]),
  'ordinary MG DiceShow panels should still auto-close unless requireManualClose is set',
);

console.log('BattleScene phase advance test passed');
