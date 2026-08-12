const assert = require('assert');
const fs = require('fs');

const menu = fs.readFileSync('assets/scripts/view/MainMenuScene.ts', 'utf8');

assert.match(
  menu,
  /const unitLevels: UnitLevel\[\] = \['recruit', 'veteran', 'elite'\]/,
  'level editor must expose all three non-player unit levels',
);
assert.match(
  menu,
  /unitLevelLabels: Record<UnitLevel, string>[\s\S]*recruit: '新兵'[\s\S]*veteran: '老兵'[\s\S]*elite: '王牌'/,
  'level editor must label recruit, veteran, and elite choices',
);
assert.match(
  menu,
  /item\.unit\.kind === 'at_gun'[\s\S]*item\.unit\.atGunCrewLevel \?\? item\.unit\.unitLevel[\s\S]*item\.unit\.atGunCrewLevel = nextLevel[\s\S]*item\.unit\.unitLevel = nextLevel/,
  'each row must persist unitLevel, while AT guns persist the controlling infantry level',
);
assert.match(
  menu,
  /unitLevel: 'recruit'/,
  'new level-editor units must default to recruit',
);
assert.match(
  menu,
  /enemies: cloneJson\(draftEnemies\)/,
  'mission export must preserve edited enemy placement fields including unitLevel',
);

console.log('level editor unit-level tests passed');
