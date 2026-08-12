const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert.match(
  source,
  /if \(GameSession\.gameMode === 'hardcore'\) \{[\s\S]*?mover\.kind === 'at_gun' && !isTankUnit\(occupant\)[\s\S]*?isFootUnit\(mover\) && isAbandonedATGun\(occupant\)[\s\S]*?isTankUnit\(mover\) && occupant\.kind === 'at_gun'[\s\S]*?isControlledATGun\(occupant\) && this\.areUnitsOnSameSide\(mover, occupant\)/,
  'hardcore occupancy should let infantry enter abandoned guns, keep friendly controlled guns blocking tanks, and keep AT guns out of non-tank hexes',
);

assert.match(
  source,
  /private areUnitsOnSameSide\(a: Unit, b: Unit\): boolean \{[\s\S]*?a\.faction !== 'neutral'[\s\S]*?b\.faction !== 'neutral'[\s\S]*?isFriendlyFaction\(a\.faction\) === isFriendlyFaction\(b\.faction\)/,
  'friendly AT-gun blocking should use battle side rather than exact faction identity',
);

assert.match(
  source,
  /case 'advance':[\s\S]*?case 'reverse': \{[\s\S]*?const to = neighbor\(enemy\.pos, dir\);[\s\S]*?!this\.canMoveToBattleTile\(to\) \|\| this\.findMoveBlocker\(enemy, to\) !== null/,
  'AI advance and reverse should recheck the destination occupant before starting movement',
);

assert.match(
  source,
  /finishedUnit\.pos = \{ q: anim\.toQ, r: anim\.toR \};\s*this\.crushEnemyATGunsAt\(finishedUnit\);\s*this\.captureAbandonedATGunsAt\(finishedUnit\);/,
  'every completed movement animation should check for AT-gun overrun and infantry capture',
);

assert.match(
  source,
  /private crushEnemyATGunsAt\(mover: Unit\)[\s\S]*?GameSession\.gameMode !== 'hardcore' \|\| !isTankUnit\(mover\)[\s\S]*?unit\.kind !== 'at_gun'[\s\S]*?isControlledATGun\(unit\) && this\.areUnitsOnSameSide\(mover, unit\)[\s\S]*?this\.releaseATGunCrew\(unit\)[\s\S]*?unit\.destroyed = true/,
  'only tanks should destroy enemy/neutral AT guns on arrival while releasing a living crew',
);

console.log('BattleScene hardcore AT-gun overrun tests passed');
