const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert.match(
  source,
  /if \(GameSession\.gameMode === 'hardcore'\) \{[\s\S]*?mover\.kind === 'at_gun' && !isTankUnit\(occupant\)[\s\S]*?isFootUnit\(mover\) && isAbandonedATGun\(occupant\)[\s\S]*?isTankUnit\(mover\) && occupant\.kind === 'at_gun'[\s\S]*?isControlledATGun\(occupant\) && mover\.faction === occupant\.faction/,
  'hardcore occupancy should let infantry enter abandoned guns, keep friendly controlled guns blocking tanks, and keep AT guns out of non-tank hexes',
);

assert.match(
  source,
  /finishedUnit\.pos = \{ q: anim\.toQ, r: anim\.toR \};\s*this\.crushEnemyATGunsAt\(finishedUnit\);\s*this\.captureAbandonedATGunsAt\(finishedUnit\);/,
  'every completed movement animation should check for AT-gun overrun and infantry capture',
);

assert.match(
  source,
  /private crushEnemyATGunsAt\(mover: Unit\)[\s\S]*?GameSession\.gameMode !== 'hardcore' \|\| !isTankUnit\(mover\)[\s\S]*?unit\.kind !== 'at_gun'[\s\S]*?isControlledATGun\(unit\) && unit\.faction === mover\.faction[\s\S]*?this\.killATGunCrew\(unit\)[\s\S]*?unit\.destroyed = true/,
  'only tanks should destroy enemy/neutral AT guns on arrival, including their crew',
);

console.log('BattleScene hardcore AT-gun overrun tests passed');
