const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const battleScene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(
  /private\s+campaignDebugSkipBtn\s*:\s*Node\s*\|\s*null\s*=\s*null\s*;/.test(battleScene),
  'BattleScene should keep a handle to the campaign debug skip button',
);

assert(
  /private\s+buildCampaignDebugSkipButton\s*\(\)/.test(battleScene),
  'BattleScene should build a dedicated campaign debug skip button',
);

assert(
  /this\.campaignDebugSkipBtn\s*=\s*btn\.node;/.test(battleScene),
  'BattleScene should store the created debug skip button node',
);

assert(
  /private\s+refreshCampaignDebugSkipButton\s*\(\)/.test(battleScene),
  'BattleScene should refresh debug skip button visibility with phase UI',
);

assert(
  /this\.campaignDebugSkipBtn\.active\s*=\s*!!this\.campaignRuntime[\s\S]*this\.activeCampaignSegmentIndex\s*<\s*this\.campaignRuntime\.segments\.length\s*-\s*1/.test(battleScene),
  'Debug skip button should only be active in campaign segments that have a next segment',
);

const refreshPhaseUI = battleScene.match(/private\s+refreshPhaseUI\s*\(\)\s*{[\s\S]*?\n  }\n\n  private drawDieSlot/);
assert(refreshPhaseUI, 'BattleScene.refreshPhaseUI() should be found');
assert(
  refreshPhaseUI[0].includes('this.refreshCampaignDebugSkipButton();'),
  'refreshPhaseUI() should update the campaign debug skip button',
);

const debugSkip = battleScene.match(/private\s+debugSkipCampaignSegment\s*\(\)\s*{[\s\S]*?\n  }\n\n/);
assert(debugSkip, 'BattleScene.debugSkipCampaignSegment() should be found');
assert(
  debugSkip[0].includes('this.advanceCampaignSegment();'),
  'debugSkipCampaignSegment() should reuse the existing campaign advance path',
);
assert(
  /if\s*\(!this\.campaignRuntime\s*\|\|\s*!this\.mission\)\s*return;/.test(debugSkip[0]),
  'debugSkipCampaignSegment() should be campaign-only',
);
assert(
  /if\s*\(this\.isBusy\(\)\)\s*return;/.test(debugSkip[0]),
  'debugSkipCampaignSegment() should not fire while battle UI is busy',
);

console.log('BattleScene campaign debug skip test passed');
