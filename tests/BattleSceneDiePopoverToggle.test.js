const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'),
  'utf8',
);

assert.match(
  source,
  /private diePopoverDieIdx: number = -1;/,
  'BattleScene should track which die owns the open action menu',
);

const onClickDie = source.match(
  /private onClickDie\(idx: number\) \{[\s\S]*?\n  \}\n\n  \/\*\* 关闭弹出动作菜单/,
);
assert(onClickDie, 'BattleScene.onClickDie() should be found');
assert.match(
  onClickDie[0],
  /if \(this\.diePopover && this\.diePopoverDieIdx === idx\) \{\s*this\.closeDiePopover\(\);\s*return;/,
  'clicking the die that owns the open action menu should close it without reopening it',
);

const closeDiePopover = source.match(
  /private closeDiePopover\(\) \{[\s\S]*?\n  \}\n\n  \/\*\*/,
);
assert(closeDiePopover, 'BattleScene.closeDiePopover() should be found');
assert.match(
  closeDiePopover[0],
  /this\.diePopoverDieIdx = -1;/,
  'closing the action menu should clear its owning die index',
);

assert.match(
  source,
  /this\.diePopover = panel;\s*this\.diePopoverDieIdx = idx;/,
  'opening an action menu should record its owning die index',
);

console.log('BattleScene die popover toggle test passed');
