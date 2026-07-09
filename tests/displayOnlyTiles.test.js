const fs = require('fs');
const assert = require('assert');

const types = fs.readFileSync('assets/scripts/core/types.ts', 'utf8');
const missionLoader = fs.readFileSync('assets/scripts/core/MissionLoader.ts', 'utf8');
const hexGrid = fs.readFileSync('assets/scripts/core/HexGrid.ts', 'utf8');
const turnEndEventApply = fs.readFileSync('assets/scripts/core/TurnEndEventApply.ts', 'utf8');
const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert(
  /displayOnly\?:\s*boolean/.test(types),
  'Tile should expose displayOnly?: boolean for runtime rules',
);

assert(
  /disp\?:\s*1\s*\|\s*true/.test(types),
  'TileDef should support a compact disp marker for display-only terrain',
);

assert(
  /\.\.\.\(def\.disp\s*===\s*1\s*\|\|\s*def\.disp\s*===\s*true\s*\?\s*\{\s*displayOnly:\s*true\s*\}/.test(missionLoader),
  'MissionLoader should copy TileDef.disp into Tile.displayOnly',
);

assert(
  missionLoader.includes('if (tile.displayOnly) continue;'),
  'MissionLoader dice spawn marker lookup should ignore display-only tiles',
);

assert(
  missionLoader.includes('validateUnitNotOnDisplayOnly(data.id, map, sherman);'),
  'MissionLoader should reject initial unit placement on display-only tiles',
);

assert(
  hexGrid.includes('if (t.displayOnly) return false;'),
  'HexMap.canTankEnter() should reject display-only tiles',
);

assert(
  turnEndEventApply.includes('tile?.displayOnly'),
  'Turn-end reinforcements should not spawn onto display-only tiles',
);

assert(
  /private\s+isEffectiveBattleTile\s*\(\s*tile:\s*Tile\s*\|\s*undefined\s*\|\s*null\s*\):\s*boolean/.test(battleScene),
  'BattleScene should centralize effective battlefield tile checks',
);

assert(
  /private\s+canMoveToBattleTile\s*\(\s*pos:\s*Axial\s*\):\s*boolean/.test(battleScene),
  'BattleScene should centralize movement permission for display-only and campaign tiles',
);

assert(
  battleScene.includes('this.canMoveToBattleTile(pos)'),
  'Player drive preview should block display-only tiles through the shared movement helper',
);

assert(
  battleScene.includes('this.canMoveToBattleTile(to)'),
  'Player and AI movement execution should block display-only tiles through the shared movement helper',
);

assert(
  /private\s+redrawDisplayOnlyShadow\s*\(\)/.test(battleScene),
  'BattleScene should draw display-only tiles with the same shadow treatment as locked campaign tiles',
);

assert(
  /private\s+isCampaignShadowTile\s*\(\s*tile:\s*Tile\s*\):\s*boolean/.test(battleScene),
  'BattleScene should identify campaign-shadowed tiles so display-only shadow does not stack on them',
);

const displayOnlyShadow = battleScene.match(/private\s+redrawDisplayOnlyShadow\s*\(\)\s*{[\s\S]*?\n  }\n\n/);
assert(displayOnlyShadow, 'BattleScene.redrawDisplayOnlyShadow() should be found');
assert(
  displayOnlyShadow[0].includes('this.isCampaignShadowTile(tile)'),
  'Display-only shadow should skip tiles already covered by campaign shadow',
);

assert(
  battleScene.includes('this.redrawDisplayOnlyShadow();'),
  'BattleScene.redraw() should render display-only shadow overlays',
);

const fogOverlay = battleScene.match(/private\s+redrawFogOverlay\s*\(\)\s*{[\s\S]*?\n  }\n\n/);
assert(fogOverlay, 'BattleScene.redrawFogOverlay() should be found');
assert(
  fogOverlay[0].includes('this.isDeepShadowTile(tile)'),
  'Fog overlay should not stack on campaign-shadowed or display-only tiles',
);

assert(
  /private\s+drawEffectiveBattlefieldBoundary\s*\(\)/.test(battleScene),
  'BattleScene should draw an outline around effective battlefield tiles',
);

assert(
  battleScene.includes('this.drawEffectiveBattlefieldBoundary();'),
  'BattleScene.redraw() should draw the effective battlefield boundary',
);

console.log('display-only tile tests passed');
