const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'),
  'utf8',
);

const calls = [...source.matchAll(/canMGAttack\(/g)];
assert.strictEqual(calls.length, 6, 'expected all six BattleScene machine-gun legality call sites, including target-mask rendering');

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

assert.doesNotMatch(
  source,
  /if\s*\(attackOrMisc\s*&&\s*this\.hasTurretReconGunSelection\(\)\s*&&\s*!this\.isCommanderHatchOpen\(\)\)/,
  'opening the hatch must not disable marked-tile turret rotation',
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

assert.match(
  source,
  /const\s+currentRuleFacing\s*=\s*\(sherman\.turretFacing\s*\?\?\s*sherman\.facing\s*\?\?\s*to\)[\s\S]*?const\s+preserveRuleFacing\s*=\s*flankDirection\s*!==\s*null\s*&&\s*currentRuleFacing\s*===\s*flankDirection[\s\S]*?this\.startShermanTurretAimDirection\([\s\S]*?preserveRuleFacing/,
  'an open-hatch flank attack from another facing must rotate the rules-facing turret before visual target aiming',
);

assert.match(
  source,
  /const\s+attackedSidePreference\s*=\s*flankDirection\s*!==\s*null[\s\S]*?diagonalGunnerClickPreference\([\s\S]*?target\.pos[\s\S]*?this\.startShermanTurretAimDirection\([\s\S]*?preserveRuleFacing,\s*attackedSidePreference\s*\?\?\s*undefined/,
  'a halfway-ray attack must remember which flank contained the attacked target',
);

assert.match(
  source,
  /if\s*\(diagonalSidePreference\s*!==\s*undefined\)\s*\{\s*sherman\.diagonalGunnerSidePreference\s*=\s*diagonalSidePreference;\s*\}\s*else\s+if\s*\(!preserveRuleFacing\)/,
  'an explicit attacked flank must update closed-hatch vision even when the rules-facing turret direction is unchanged',
);

assert.match(
  source,
  /private\s+tankMachineGunSelection[\s\S]*?selectTankMachineGun\([\s\S]*?this\.canTurretReachDirection/,
  'hardcore target selection should resolve hull versus coaxial machine guns through the shared rule',
);

assert.match(
  source,
  /private\s+startShermanMachineGunAim[\s\S]*?selection\.weapon\s*!==\s*'hull'[\s\S]*?limitTurretTraverse[\s\S]*?startShermanTurretAimDirection\(traverse\.direction/,
  'combined fire should require full alignment while hull-only fire may apply a partial turret traverse',
);

assert.doesNotMatch(
  source,
  /mgSelectionActive[\s\S]*?GameSession\.gameMode\s*===\s*'hardcore'\s*&&\s*this\.mission\?\.sherman\.turretDamaged/,
  'turret damage should not discard a selected independent machine gun',
);

assert.match(
  source.slice(source.indexOf('private onTouchMap'), source.indexOf('private showGunAimWarning')),
  /this\.playerTurretCanRotate\(\)[\s\S]*?if \(mgSel && legalMGTarget\)[\s\S]*?tryMGAttack\(legalMGTarget\)/,
  'turret rotation handling must be skipped without blocking a legal forward hull-MG attack',
);

assert.match(
  source,
  /const\s+turretCanRotate\s*=\s*this\.playerTurretCanRotate\(\);[\s\S]*?&& \(turretCanRotate \|\| precisionGunSelection\)/,
  'a damaged turret must not show the blue rotation mask for machine-gun selection',
);

assert.doesNotMatch(
  source,
  /classifyMiscDie\(slot\.pip\)\s*!==\s*'codriver_mg'[\s\S]{0,200}checkCrewAlive\('coDriver'\)/,
  'the miscellaneous machine-gun die must not require a living co-driver',
);

assert.doesNotMatch(
  source,
  /mgActionUnavailable\('coDriver'\)/,
  'miscellaneous machine-gun availability must not be crew-gated',
);

console.log('BattleScene hardcore machine-gun direction tests passed');
