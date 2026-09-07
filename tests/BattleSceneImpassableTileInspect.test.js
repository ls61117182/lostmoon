const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const battleScene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');
const lang = fs.readFileSync(path.join(root, 'data/lang.csv'), 'utf8');

const inspectText = battleScene.match(
  /private buildTileInspectTerrainText\(tile: Tile\): string \{[\s\S]*?\n  \}\n\n  \/\*\* 左栏多行文本/,
);
assert.ok(inspectText, 'tile-inspection text builder should exist');
assert.match(
  inspectText[0],
  /const infantryOnlyVisionBlocker = tile\.terrain === 'forest' \|\| tile\.terrain === 'rocky'/,
  'forest and rocky terrain should share the infantry-only rule',
);
assert.match(
  inspectText[0],
  /if \(infantryOnlyVisionBlocker\) \{[\s\S]*?tileInspect\.rules\.infantryOnly[\s\S]*?tileInspect\.rules\.blocksVision/,
  'tank-impassable infantry terrain should show entry and vision rules',
);
assert.match(
  inspectText[0],
  /const allUnitsImpassableNonVisionBlocker = [\s\S]*?factions\.every\(faction => !this\.mission!\.map\.canUnitEnter\(tile\.pos, faction\)\)[\s\S]*?!this\.mission\.map\.lineOfSightBlockedByTile\(tile\)/,
  'all-faction entry and line-of-sight rules should identify non-blocking impassable terrain',
);
assert.match(
  inspectText[0],
  /else if \(allUnitsImpassableNonVisionBlocker\) \{[\s\S]*?tileInspect\.rules\.impassable/,
  'non-blocking terrain that no unit can enter should be labelled impassable',
);
assert.match(
  inspectText[0],
  /if \(!infantryOnlyVisionBlocker && !allUnitsImpassableNonVisionBlocker\) \{[\s\S]*?tileInspect\.modifier\.mobility[\s\S]*?tileInspect\.diceRow\.misc/,
  'all dice details should be skipped for both impassable terrain categories',
);
assert.match(lang, /tileInspect\.rules\.infantryOnly,仅允许步兵进入,Infantry only/);
assert.match(lang, /tileInspect\.rules\.blocksVision,阻挡视野,Blocks line of sight/);
assert.match(lang, /tileInspect\.rules\.impassable,无法驶入,Impassable/);

console.log('BattleScene impassable tile-inspection tests passed');
