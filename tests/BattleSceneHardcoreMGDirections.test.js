const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'),
  'utf8',
);

const calls = [...source.matchAll(/canMGAttack\(/g)];
assert.strictEqual(calls.length, 5, 'expected all five BattleScene machine-gun legality call sites');

for (const call of calls) {
  const around = source.slice(Math.max(0, call.index - 500), call.index + 700);
  assert.match(
    around,
    /expandedTurretDirections\s*:\s*getGameModeConfig\(GameSession\.gameMode\)\.expandedTurretDirections/,
    'every BattleScene machine-gun legality path must pass the current mode direction expansion',
  );
}

console.log('BattleScene hardcore machine-gun direction tests passed');
