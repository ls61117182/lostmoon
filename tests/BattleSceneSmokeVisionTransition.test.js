const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert.match(
  source,
  /const SMOKE_VISION_LAYER_INTERVAL = 1/,
  'each smoke visibility distance ring should take one second',
);
assert.match(
  source,
  /const HATCH_VISION_LAYER_INTERVAL = 0\.5/,
  'each commander-hatch visibility distance ring should take half a second',
);
assert.match(
  source,
  /sort\(\(a, b\) => expanding \? a - b : b - a\)/,
  'smoke clearing should reveal near-to-far while deployment hides far-to-near',
);
assert.match(
  source,
  /while \(transition\.elapsed >= transition\.layerInterval[\s\S]*?activeLayer[\s\S]*?displayedHexKeys\.(?:add|delete)/,
  'visibility rings should be applied one layer at a time from the update loop',
);
assert.match(
  source,
  /private fogOverlayAlpha[\s\S]*?transition\.elapsed \/ transition\.layerInterval[\s\S]*?transition\.expanding \? 1 - progress : progress/,
  'the active ring should fade its fog alpha continuously in opposite directions',
);
assert.match(
  source,
  /deploySmokeAt\(s\.pos, 'friendly', true\)/,
  'player smoke deployment should start the visibility transition',
);
assert.match(
  source,
  /case 'smoke':[\s\S]*?deploySmokeAt\(enemy\.pos,[\s\S]*?, true\)/,
  'enemy AI smoke deployment should start the same visibility transition',
);
assert.match(
  source,
  /private applyPvpSmokeSnapshot[\s\S]*?addedEnemySmoke[\s\S]*?startFogVisionTransition\(visibilityBefore, false, SMOKE_VISION_LAYER_INTERVAL\)/,
  'enemy smoke received through PvP state synchronization should animate lost vision',
);
assert.match(
  source,
  /for \(const unit of this\.mission\.enemies\)[\s\S]*?deploySmokeAt\(unit\.pos, 'enemy', true\)/,
  'legacy enemy smoke state should also animate lost vision when converted',
);
assert.match(
  source,
  /clearSmokeByOwner\('friendly', true\)[\s\S]*?clearSmokeByOwner\('enemy', true\)/,
  'both friendly and enemy smoke expiration should start reverse visibility transitions',
);
assert.match(
  source,
  /private tryToggleHatch[\s\S]*?const openingHatch = !s\.hatchOpen[\s\S]*?openingHatch \? this\.displayedFogVisionSnapshot\(\) : null[\s\S]*?startFogVisionTransition\(visibilityBefore, true, HATCH_VISION_LAYER_INTERVAL\)[\s\S]*?fogVisionTransition = null/,
  'opening the player hatch should animate vision while closing it should cancel the transition',
);
assert.match(
  source,
  /private tryCloseHatchWithDoubles[\s\S]*?s\.hatchOpen = false;[\s\S]*?fogVisionTransition = null/,
  'closing the hatch with misc doubles should remove vision immediately',
);
assert.match(
  source,
  /private updateNonPlayerTankCommanderHatch[\s\S]*?nextOpen \? this\.displayedFogVisionSnapshot\(\) : null[\s\S]*?startFogVisionTransition\(visibilityBefore, true, HATCH_VISION_LAYER_INTERVAL\)[\s\S]*?fogVisionTransition = null/,
  'non-player hatch opening should animate while closing should remove shared vision immediately',
);

console.log('BattleScene smoke vision transition tests passed');
