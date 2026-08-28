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

const showDiePopover = source.match(
  /private showDiePopover\(idx: number\) \{[\s\S]*?\n  \}\n\n  \/\/ ---------- 移动阶段动作/,
);
assert(showDiePopover, 'BattleScene.showDiePopover() should be found');
assert.match(
  showDiePopover[0],
  /const nonDoublesEffects = new Set<string>\(\)[\s\S]*?if \(doubles && effectId && nonDoublesEffects\.has\(effectId\)\) return;[\s\S]*?if \(!doubles && effectId\) nonDoublesEffects\.add\(effectId\)/,
  'matching-dice actions must be omitted when the same effect is already offered by one die',
);
assert.match(
  showDiePopover[0],
  /'reload-ap', doubles[\s\S]*?'reload-he', doubles[\s\S]*?tryDoublesLoaderReload[\s\S]*?'action\.doublesLoaderReload', true/,
  'AP and HE reload pair buttons must share effect identities with ordinary reload buttons',
);
assert.match(
  showDiePopover[0],
  /local\.y \+ BattleScene\.DICE_TRAY_SLOT \/ 2 \+ 8 \+ panelH \/ 2/,
  'the die action menu should sit close to the top edge of its die',
);

assert.doesNotMatch(
  source,
  /new Node\('DiceTitle'\)|private diceTitleLabel:/,
  'the player dice tray should not show a phase explanation title',
);
assert.match(
  source,
  /private buildEnemyDiceTray\([\s\S]*?hl\.string = unitDisplayName\(enemy\.kind\);/,
  'the enemy dice tray header should show the acting unit name',
);

console.log('BattleScene die popover toggle test passed');
