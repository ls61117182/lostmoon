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
assert(
  referenceMethod[1].includes('this.measureBattleModalText(bodyText, 18, 26)'),
  'turn-end event reference panel should size itself from rendered body content',
);
assert(
  !referenceMethod[1].includes('n: r.diceCount'),
  'turn-end event reference should not include redundant dice-count details',
);

const langCsv = fs.readFileSync(
  path.resolve(__dirname, '../data/lang.csv'),
  'utf8',
);
const line = langCsv.split(/\r?\n/).find((row) => row.startsWith('battle.turnEndList.line,'));
assert(line, 'turn-end event reference line localization should exist');
assert(!line.includes('{n}'), 'turn-end event reference line should omit dice-count placeholder');
assert(!line.includes('点数之和'), 'turn-end event reference line should omit sum explanation');

console.log('BattleScene turn-end reference tests passed');
