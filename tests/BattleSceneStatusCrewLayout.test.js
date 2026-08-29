const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const refresh = source.match(/private refreshStatusPanel\(\) \{[\s\S]*?\n  \}\n\n  \/\*\* 绘制结束回合按钮/);

assert(refresh, 'refreshStatusPanel should remain discoverable');
assert.match(refresh[0], /new Set<number>\(s\.stats\.crewMembers\)/,
  'the status row should use the current tank crewMembers configuration');
assert.match(refresh[0], /iconNode\.active = slotExists/,
  'crew positions absent from the vehicle configuration should be hidden');
assert.match(
  refresh[0],
  /STATUS_CREW_START_X \+ visibleCrewIndex \* \(STATUS_CREW_ICON_SIZE \+ STATUS_CREW_ICON_GAP\)/,
  'visible crew icons should be compacted from the left edge without gaps',
);
assert.match(refresh[0], /if \(!slotExists\) \{[\s\S]*?continue;[\s\S]*?visibleCrewIndex\+\+/,
  'missing crew slots must not consume a visible layout position');

console.log('BattleScene status crew layout test passed');
