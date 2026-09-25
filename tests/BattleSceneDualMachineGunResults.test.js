const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

const playerAttack = source.match(
  /private tryMGAttack\([\s\S]*?\n  \}\n\n  \/\*\*\n   \* 烟雾/,
);
assert.ok(playerAttack, 'player machine-gun attack flow should exist');
assert.match(
  playerAttack[0],
  /machineGun\?\.weapon === 'both'[\s\S]*?rollSelectedTankMachineGunAttacks\(ctx, this\.rng\)/,
  'combined player MG fire should resolve two selected-weapon attacks',
);
assert.match(
  playerAttack[0],
  /const hit = report\.hit \|\| secondaryReport\?\.hit === true/,
  'either independent player MG hit should destroy the target',
);
assert.match(
  playerAttack[0],
  /applyMachineGunAttackResult\(target, \{ hit \}\)/,
  'the combined player result should be applied only after both reports exist',
);
assert.match(
  playerAttack[0],
  /secondaryMGReport: secondaryPanelReport/,
  'the player result panel should receive the hull-MG report',
);

assert.match(
  source,
  /coaxialMGHitNeed[\s\S]*?hullMGHitNeed/,
  'the dual result panel should label both coaxial and hull MG rows',
);
assert.match(
  source,
  /revealSecondaryMachineGunResult\(show\)[\s\S]*?show\.report\.hit \|\| show\.secondaryMGReport\?\.hit/,
  'the dual result panel should reveal both dice before computing the final outcome',
);

const aiAttack = source.match(
  /private tryAIMGAttack\([\s\S]*?\n  \}\n\n  private startTurnEndEventFlow/,
);
assert.ok(aiAttack, 'AI machine-gun attack flow should exist');
assert.match(
  aiAttack[0],
  /machineGun\?\.weapon === 'both'[\s\S]*?rollSelectedTankMachineGunAttacks\(ctx, this\.rng\)/,
  'combined AI MG fire should use the same two independent rolls',
);
assert.match(
  aiAttack[0],
  /applyMachineGunAttackResult\(target, \{ hit \}\)/,
  'AI should apply the OR of both independent attack results',
);

console.log('BattleScene dual machine-gun result tests passed');
