const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert.match(
  source,
  /private playerTankStatusTitle\(\): string \{[\s\S]*?this\.mission\?\.playerTank \?\? this\.mission\?\.sherman[\s\S]*?return t\('status\.panelTitle'/,
  'status title construction must tolerate the HUD being built before the mission loads',
);

const buildStatusPanel = source.match(/private buildStatusPanel\(\) \{[\s\S]*?\n  \}\n\n  private loadCrewStatusRankFrames/);
assert(buildStatusPanel, 'buildStatusPanel should remain discoverable');
assert.match(buildStatusPanel[0], /this\.playerTankStatusTitle\(\)/);
assert.doesNotMatch(buildStatusPanel[0], /this\.mission\.playerTank\.kind/,
  'buildStatusPanel must not dereference playerTank during pre-load HUD construction');

assert.match(
  source,
  /private refreshStatusPanel\(\) \{[\s\S]*?statusPanelTitleLabel\.string = this\.playerTankStatusTitle\(\)/,
  'the placeholder title should be replaced with the actual loaded tank name',
);

console.log('BattleScene status panel initialization test passed');
