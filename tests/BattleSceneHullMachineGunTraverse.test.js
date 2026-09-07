const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const battleScene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');

const onTouchMap = battleScene.match(
  /private onTouchMap\(event: EventTouch\) \{[\s\S]*?\n  \}\n\n  \/\*\*\n   \* 玩家主炮 \/ 机枪/,
);
assert.ok(onTouchMap, 'BattleScene.onTouchMap() should exist');
assert.match(
  onTouchMap[0],
  /const hullMGCanFireWhileTurretPartiallyTraverses = GameSession\.gameMode === 'hardcore'[\s\S]*?legalMGSelection\?\.weapon === 'hull'/,
  'a legal hardcore hull-MG target should be recognized independently of full turret traverse',
);
assert.match(
  onTouchMap[0],
  /if \(!this\.canWeaponAimDirection\(this\.mission\.sherman, direction\)\s*&& !hullMGCanFireWhileTurretPartiallyTraverses\)/,
  'the map click gate should allow the hull MG while the turret can only traverse partway',
);
assert.match(
  battleScene,
  /if \(selection\.weapon !== 'hull'\)[\s\S]*?const traverse = limitTurretTraverse\(from, requestedDirection, sherman\.stats\.turretTraverseSpeed\);[\s\S]*?this\.startShermanTurretAimDirection\(traverse\.direction, onDone\);/,
  'hull-MG fire should first rotate the turret as far as its current traverse permits',
);

console.log('BattleScene hull machine-gun traverse tests passed');
