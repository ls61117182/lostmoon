const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const battleScene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const openTileInspect = battleScene.match(
  /private\s+openTileInspectModal\s*\([^)]*\)\s*{[\s\S]*?\n  }\n\n  \/\*\*/,
);
assert(openTileInspect, 'BattleScene.openTileInspectModal() should be found');

const source = openTileInspect[0];
assert(
  source.includes('const panelH = panelChromeH + scrollH;'),
  'tile inspection panel height should be derived from its measured content height',
);
assert(
  source.includes('const scrollH = Math.min(maxScrollH, contentTopInset + contentH);'),
  'tile inspection content should grow naturally until it reaches the maximum viewport height',
);
assert(
  source.includes('sv.vertical = needsVerticalScroll;'),
  'vertical scrolling should only be enabled when measured content exceeds the maximum viewport height',
);
assert(
  /if \(needsVerticalScroll\) \{[\s\S]*?new Node\('VBar'\)/.test(source),
  'the vertical scrollbar should only be created for overflowing content',
);
assert(
  !source.includes('Math.max(scrollH'),
  'short tile inspection content should not be forced to the viewport height',
);

console.log('BattleScene tile inspection sizing checks passed.');
