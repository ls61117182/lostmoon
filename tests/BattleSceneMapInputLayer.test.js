const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const battleScene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(
  /private\s+mapInputNode\s*:\s*Node\s*\|\s*null\s*=\s*null\s*;/.test(battleScene),
  'BattleScene should keep a root-level mapInputNode that does not move with the campaign map',
);

assert(
  /new\s+Node\('MapInput'\)/.test(battleScene),
  'BattleScene should create a MapInput node for map touches',
);

assert(
  /this\.node\.addChild\(mapInputNode\);/.test(battleScene),
  'MapInput should be attached to the scene root, not to MapGraphics',
);

assert(
  /mapInputNode\.on\(Node\.EventType\.TOUCH_END,\s*this\.onTouchMap,\s*this\);/.test(battleScene),
  'MapInput should own the map click listener',
);

assert(
  !/onMapPanStart|onMapPanMove|mapPanEnabled/.test(battleScene),
  'BattleScene should not allow manual map panning',
);

assert(
  !/gNode\.on\(Node\.EventType\.TOUCH_END,\s*this\.onTouchMap,\s*this\);/.test(battleScene),
  'MapGraphics should not be the sole touch target because campaign panning moves it away from the viewport',
);

console.log('BattleScene map input layer test passed');
