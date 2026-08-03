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

assert.match(
  source,
  /private\s+hasTurretReconGunSelection\s*\(\)\s*:\s*boolean\s*\{[\s\S]*?selectedMGDieIdx\s*>=\s*0/,
  'a selected machine-gun die should enable the fog-tile turret-aim path',
);

assert.match(
  source,
  /tryAimShermanTurretAtFogTile\(aimDirection,\s*target\.pos,\s*mgSel\)/,
  'fog-tile aiming should preserve whether the selected die is a machine gun',
);

assert.match(
  source,
  /private\s+tryAimShermanTurretAtFogTile\(direction:\s*FireDirection,\s*targetPos:\s*Axial,\s*useMG\s*=\s*false\)[\s\S]*?this\.startShermanTurretAimDirection\(direction,\s*\(\)\s*=>\s*\{[\s\S]*?\},\s*undefined,\s*false,\s*clickedSidePreference\s*\?\?\s*undefined\);/,
  'fog-tile turret rotation must use the selected rules direction without visually aiming at the clicked flank hex',
);

assert.match(
  source,
  /const\s+dieIdx\s*=\s*useMG\s*\?\s*this\.selectedMGDieIdx\s*:\s*this\.selectedGunDieIdx/,
  'machine-gun fog aiming should consume the selected machine-gun die',
);

assert.match(
  source,
  /private\s+mgActionUnavailable[\s\S]*?if\s*\(GameSession\.gameMode\s*===\s*'hardcore'\)\s*return\s+null;/,
  'hardcore machine-gun dice should stay available without an infantry target for fog-tile turret aiming',
);

console.log('BattleScene hardcore machine-gun direction tests passed');
