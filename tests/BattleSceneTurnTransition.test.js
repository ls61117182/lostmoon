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
  /const \{ width, height \} = visibleSizeInRootSpace\(UI_ROOT_SCALE\)[\s\S]*?panelTransform\?\.setContentSize\(width, bannerHeight\)/,
  'turn-transition banner must expand to the actual visible width',
);
assert.match(
  source,
  /subscribeAdaptiveResolution\([\s\S]*?this\.layoutTurnTransition\(\)/,
  'turn-transition banner must relayout when the window size or orientation changes',
);
assert.match(
  source,
  /title\.horizontalAlign = HorizontalTextAlignment\.CENTER/,
  'turn-transition title must remain centered in the full-width banner',
);
assert.match(
  source,
  /g\.moveTo\(-width \* 0\.5, bannerHeight \* 0\.5 - 1\)/,
  'turn-transition banner must use open horizontal borders instead of side frames',
);
assert.match(
  source,
  /refs\.panel\.setPosition\(-w, 0, 0\)/,
  'turn-transition entry animation must start outside the current visible width',
);
assert.match(
  source,
  /transition\.panel\.setPosition\(-width \+ width \* \(transition\.t \/ enter\), 0, 0\)/,
  'turn-transition animation must use the adaptive banner width',
);
assert.match(
  source,
  /this\.showTurnTransition\(this\.mission\.sherman\.faction, 'player', \(\) => this\.beginPlayerPhaseForNewTurn\(\)\)/,
  'the first player turn of a new battle must also display the banner',
);
assert.match(
  source,
  /iconNode\.setPosition\(-240, 0, 0\)/,
  'faction insignia should sit close to the centered copy',
);
assert.match(
  source,
  /const enter = 0\.12, hold = 1\.2, leave = 0\.13/,
  'banner enter and leave animations should be twice as fast without changing hold time',
);
assert.match(
  source,
  /this\.mission\.enemies\.find\(unit => !unit\.destroyed\)\?\.faction\s*\?\?\s*this\.mission\.enemies\[0\]\?\.faction\s*\?\?\s*\(this\.mission\.data\.theater === 'pacific' \? 'japanese' : 'german'\)/,
  'an enemy transition must retain the mission faction when no enemy unit is alive',
);

console.log('BattleScene turn-transition tests passed');
