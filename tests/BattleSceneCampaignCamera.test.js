const fs = require('fs');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(
  /private\s+cameraReferenceTilesForSegment\s*\(\s*index:\s*number\s*\):\s*Tile\[\]/.test(battleScene),
  'BattleScene should gather campaign camera reference tiles by segment',
);

assert(
  /const\s+playableTiles\s*=\s*segmentTiles\.filter\(tile\s*=>\s*!tile\.displayOnly\);/.test(battleScene),
  'Campaign camera reference should ignore display-only scenery tiles',
);

assert(
  /private\s+cameraReferenceTiles\s*\(\):\s*Tile\[\]/.test(battleScene),
  'BattleScene should centralize camera reference tile selection',
);

assert(
  battleScene.includes('const viewTiles = this.cameraReferenceTiles();'),
  'loadAndDraw() should use camera reference tiles for the initial mission center',
);

const campaignSegmentPanTarget = battleScene.match(/private\s+campaignSegmentPanTarget\s*\([\s\S]*?\n  }\n\n/);
assert(campaignSegmentPanTarget, 'BattleScene.campaignSegmentPanTarget() should be found');
assert(
  campaignSegmentPanTarget[0].includes('this.cameraReferenceTilesForSegment(index)'),
  'Campaign pan target should use the same tile bounds as normal mission centering',
);
assert(
  campaignSegmentPanTarget[0].includes('BOARD_CENTER_OFFSET_Y - center.y'),
  'Campaign pan target should keep the same vertical board center as normal missions',
);

console.log('BattleScene campaign camera test passed');
