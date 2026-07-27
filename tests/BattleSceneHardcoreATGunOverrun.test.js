const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert.match(
  source,
  /if \(GameSession\.gameMode === 'hardcore'\) \{[\s\S]*?mover\.kind === 'at_gun' && !isTankUnit\(occupant\)[\s\S]*?!isFootUnit\(mover\) && occupant\.kind === 'at_gun'\)[\s\S]*?mover\.faction === occupant\.faction/,
  'hardcore occupancy should keep friendly AT guns blocking, allow enemy vehicle overruns, and keep AT guns out of non-tank hexes',
);

assert.match(
  source,
  /finishedUnit\.pos = \{ q: anim\.toQ, r: anim\.toR \};\s*this\.crushEnemyATGunsAt\(finishedUnit\);/,
  'every completed movement animation should check for an AT-gun overrun',
);

assert.match(
  source,
  /private crushEnemyATGunsAt\(mover: Unit\)[\s\S]*?GameSession\.gameMode !== 'hardcore' \|\| isFootUnit\(mover\)[\s\S]*?unit\.kind !== 'at_gun'[\s\S]*?unit\.faction === mover\.faction[\s\S]*?unit\.destroyed = true/,
  'only non-foot units should destroy enemy AT guns on arrival',
);

console.log('BattleScene hardcore AT-gun overrun tests passed');
