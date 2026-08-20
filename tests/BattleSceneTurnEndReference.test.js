const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'),
  'utf8',
);

const referenceMethod = source.match(
  /private openTurnEndEventsReference\(\) \{([\s\S]*?)\n  \}/,
);

assert(referenceMethod, 'turn-end event reference method should exist');
assert(
  referenceMethod[1].includes('const mid = this.currentTurnEndMissionId();'),
  'turn-end event reference must resolve the same campaign segment event-table id as runtime settlement',
);
assert(
  !referenceMethod[1].includes('const mid = this.missionId'),
  'turn-end event reference must not query the stitched campaign mission id directly',
);

console.log('BattleScene turn-end reference tests passed');
