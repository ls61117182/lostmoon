const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'),
  'utf8',
);

assert.match(
  source,
  /__turnTransitionRefs = \{ panel, panelG, opacity, title, subtitle, icon \}/,
  'turn-transition setup must retain the banner panel that showTurnTransition reads',
);
assert.match(
  source,
  /const w = refs\.panel\.getComponent\(UITransform\)!\.contentSize\.width/,
  'turn-transition rendering must use the retained banner panel',
);
assert.match(
  source,
  /setContentSize\(CANVAS_W, 132\)/,
  'turn-transition banner must span the full screen width',
);
assert.match(
  source,
  /title\.horizontalAlign = HorizontalTextAlignment\.CENTER/,
  'turn-transition title must remain centered in the full-width banner',
);
assert.match(
  source,
  /g\.moveTo\(-w \* 0\.5, h \* 0\.5 - 1\)/,
  'turn-transition banner must use open horizontal borders instead of side frames',
);
assert.match(
  source,
  /this\.showTurnTransition\(this\.mission\.sherman\.faction, 'player', \(\) => this\.beginPlayerPhaseForNewTurn\(\)\)/,
  'the first player turn of a new battle must also display the banner',
);

console.log('BattleScene turn-transition tests passed');
