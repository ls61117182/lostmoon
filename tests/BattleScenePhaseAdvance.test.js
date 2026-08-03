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

const autoEnterPhaseWhenReady = battleScene.match(/private\s+autoEnterPhaseWhenReady\s*\([^)]*\)\s*{[\s\S]*?\n  }\n\n  \/\*\*/);
assert(autoEnterPhaseWhenReady, 'BattleScene.autoEnterPhaseWhenReady() should be found');
assert(
  autoEnterPhaseWhenReady[0].includes('this.scheduleOnce(retry, 0);'),
  'the automatic phase transition should continue polling while an action result remains busy',
);
assert(
  !/attempts\s*</.test(autoEnterPhaseWhenReady[0]),
  'the retry must not expire while a matching-dice result panel is waiting for manual confirmation',
);

assert(
  endCurrentSubPhase[0].includes('this.autoEnterPhaseWhenReady(next);'),
  'endCurrentSubPhase() should use the retrying helper instead of a one-shot scheduleOnce() when the scene is busy',
);

assert(
  !/scheduleOnce\s*\(\s*\(\)\s*=>\s*this\.enterPhaseIfChoose\(next\)\s*,\s*0\s*\)/.test(endCurrentSubPhase[0]),
  'endCurrentSubPhase() should not rely on a one-frame retry that can fire while DiceShow is still busy',
);

const refreshPhaseUI = battleScene.match(/private\s+refreshPhaseUI\s*\(\)\s*{[\s\S]*?\n  }\n\n  private\s+setPhaseBtnEnabled/);
assert(refreshPhaseUI, 'BattleScene.refreshPhaseUI() should be found');
assert(
  refreshPhaseUI[0].includes("this.autoEnterPhaseWhenReady('misc');"),
  'the automatic misc transition should keep retrying after matching dice are consumed during a busy attack result',
);
assert(
  !/pendingMiscAuto[\s\S]*?this\.scheduleOnce\s*\(/.test(refreshPhaseUI[0]),
  'the automatic misc transition should not use a one-frame retry that can expire before the attack result closes',
);

assert(
  endCurrentSubPhase[0].includes('this.beginFireCheckPhase();'),
  'ending the player misc phase should enter the fire-check phase before any AI phase',
);

const beginFireCheckPhase = battleScene.match(/private\s+beginFireCheckPhase\s*\(\)\s*{[\s\S]*?\n  }\n\n  private\s+continueAfterPlayerFireCheck/);
assert(beginFireCheckPhase, 'BattleScene.beginFireCheckPhase() should be found');
assert(
  beginFireCheckPhase[0].includes("this.phase = 'fireCheck';"),
  'fire checks should have their own phase instead of being classified as the enemy phase',
);

const continueAfterFire = battleScene.match(/private\s+continueAfterPlayerFireCheck\s*\(\)\s*{[\s\S]*?\n  }\n\n  private\s+beginAllyPhaseAfterTransition/);
assert(continueAfterFire, 'BattleScene.continueAfterPlayerFireCheck() should be found');
assert(
  continueAfterFire[0].includes('this.beginAllyPhase();'),
  'fire checks should continue to the optional ally phase before the enemy transition',
);

const beginEnemyAfterTransition = battleScene.match(/private\s+beginEnemyPhaseAfterTransition\s*\(\)\s*{[\s\S]*?\n  }\n\n  \/\*\*/);
assert(beginEnemyAfterTransition, 'BattleScene.beginEnemyPhaseAfterTransition() should be found');
assert(
  !beginEnemyAfterTransition[0].includes('startFireCheckFlow'),
  'the enemy phase must not own or start the fire-check flow',
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
