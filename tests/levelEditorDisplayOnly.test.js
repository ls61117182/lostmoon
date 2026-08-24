const fs = require('fs');
const assert = require('assert');

const menu = fs.readFileSync('assets/scripts/view/MainMenuScene.ts', 'utf8');

assert(
  menu.includes('tile.disp === 1 || tile.disp === true'),
  'Level editor should recognize TileDef.disp as a display-only tile',
);

assert(
  menu.includes('tile.disp = 1;'),
  'Level editor tile panel should be able to set disp: 1',
);

assert(
  menu.includes('delete tile.disp;'),
  'Level editor tile panel should be able to clear display-only status',
);

assert(
  /const\s+isEffectiveEditorTile\s*=/.test(menu),
  'Level editor should centralize effective battlefield tile checks',
);

assert(
  /const\s+drawEffectiveBattlefieldBoundary\s*=/.test(menu),
  'Level editor should draw a boundary around effective battlefield tiles',
);

assert(
  /const\s+drawBoundary\s*=\s*\(\)\s*=>\s*{[\s\S]*?outlineGraphics\.lineCap\s*=\s*Graphics\.LineCap\.ROUND;[\s\S]*?outlineGraphics\.lineCap\s*=\s*previousLineCap;/.test(menu),
  'Level editor battlefield edges should close scaled seams with round caps and restore Graphics state',
);

assert(
  menu.includes('drawEffectiveBattlefieldBoundary();'),
  'Level editor grid redraw should include effective battlefield boundary',
);

assert(
  menu.includes('DISPLAY_ONLY_EDITOR_SHADE'),
  'Level editor should visibly shade display-only tiles',
);

console.log('level editor display-only tests passed');
