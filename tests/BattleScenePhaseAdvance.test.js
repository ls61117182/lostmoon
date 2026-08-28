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

const usePhaseDice = battleScene.match(/private\s+usePhaseDice\s*\([^)]*\)\s*{[\s\S]*?\n  }\n\n  \/\*\*/);
assert(usePhaseDice, 'BattleScene.usePhaseDice() should centralize player action-die consumption');
assert(
  usePhaseDice[0].includes('!this.phaseDice.some(die => !die.used)'),
  'phase exhaustion must be based on whether any unused die remains',
);
assert(
  usePhaseDice[0].includes('this.pendingAutoEndStep = this.playerStep'),
  'using the last unused die should defer phase completion until the action finishes',
);

const completePhaseDiceAction = battleScene.match(/private\s+completePhaseDiceAction\s*\(\)\s*{[\s\S]*?\n  }\n\n  \/\/ ----------/);
assert(completePhaseDiceAction, 'BattleScene.completePhaseDiceAction() should be found');
assert(
  completePhaseDiceAction[0].includes('this.phaseDice.some(die => !die.used)'),
  'action completion should re-check for unused dice before advancing',
);
assert(
  completePhaseDiceAction[0].includes('this.autoEndPhaseIfDone();'),
  'an action that consumed the last unused die should advance the phase when it completes',
);

assert(
  !/\b(?:slot|partner|capturedSlot|p)\.used\s*=\s*true/.test(battleScene),
  'player action dice should be consumed through usePhaseDice() instead of direct writes',
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

const isBusy = battleScene.match(/private\s+isBusy\s*\(\)\s*:\s*boolean\s*{[\s\S]*?\n  }\n\n  private\s+destroyFireCheckEventUI/);
assert(isBusy, 'BattleScene.isBusy() should be found');
assert(
  !isBusy[0].includes('this.highExplosiveBlasts.length'),
  'high-explosive visual effects must not block game-flow phase transitions',
);

const computeAdvanceButton = battleScene.match(/private\s+computeAdvanceButton\s*\(\)[^{]*{[\s\S]*?\n  }\n\n  private\s+pvpOpponentProtagonist/);
assert(computeAdvanceButton, 'BattleScene.computeAdvanceButton() should be found');
assert(
  /return\s*{\s*label:\s*t\('btn\.nextPhase'\),\s*urgent:\s*false,\s*visible:\s*false\s*};/.test(computeAdvanceButton[0]),
  'the advance button should be hidden while the player is still choosing movement or attack',
);
assert(
  battleScene.includes('if (this.endTurnBtn) this.endTurnBtn.active = adv.visible;'),
  'updateHUD() should apply the computed advance-button visibility to the whole button node',
);
assert(
  /btn\.on\(Node\.EventType\.TOUCH_END, this\.onAdvanceClicked, this\);\s*\/\/[^\n]*\n\s*btn\.active\s*=\s*false;/.test(battleScene),
  'the advance button should start hidden before the first HUD refresh',
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
  /show\.confirmButton\.active\s*=\s*false/.test(enterDiceShowHold[0]),
  'DiceShow confirmation should stay hidden until the final presentation hold finishes',
);

const holdStage = battleScene.match(/case\s+'hold'\s*:\s*{[\s\S]*?break;\s*\n\s*}/);
assert(holdStage, 'BattleScene.advanceDiceShow() hold stage should be found');

assert(
  /show\.mg\s*&&\s*!show\.requireManualClose/.test(holdStage[0]),
  'only non-player MG DiceShow panels may auto-close',
);

const tryMGAttack = battleScene.match(/private\s+tryMGAttack\s*\([\s\S]*?\n  }\n\n  \/\*\*/);
assert(tryMGAttack, 'BattleScene.tryMGAttack() should be found');
assert(
  /\{\s*mg:\s*true,\s*attacker:\s*sherman,\s*target,\s*requireManualClose:\s*true\s*\}/.test(tryMGAttack[0]),
  'player MG result panels must wait for confirmation before applying the result and advancing',
);

console.log('BattleScene phase advance test passed');
