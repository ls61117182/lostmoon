const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'),
  'utf8',
);

function methodBody(name, nextName) {
  const start = source.indexOf(`  private ${name}(`);
  const end = source.indexOf(`  private ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name}() should exist`);
  return source.slice(start, end);
}

const projectile = methodBody('spawnProjectileTrace', 'spawnHighExplosiveBlast');
assert.match(
  projectile,
  /const flightDx = targetCenter\.x - muzzle\.x;[\s\S]*?const flightDy = targetCenter\.y - muzzle\.y;/,
  'projectile flight should be aimed from the rendered muzzle at the actual target center',
);
assert.match(
  projectile,
  /projectileMapExitPoint\(muzzle\.x, muzzle\.y, flight\.ux, flight\.uy\)/,
  'a missed projectile should continue beyond the target along the precise flight heading',
);
assert.match(
  projectile,
  /ux: flight\.ux,[\s\S]*?uy: flight\.uy,/,
  'the projectile tail should use the same heading as its motion',
);

const muzzle = methodBody('muzzleFlashPosition', 'projectileImpactPoint');
assert.match(
  muzzle,
  /isTankUnit\(attacker\) && attacker\.stats\.visionType === 'turreted'/,
  'turreted tanks should use precise target aim for their rendered barrel and muzzle effects',
);
assert.match(
  muzzle,
  /isAntiTankGunUnit\(attacker\) \|\| preciseTurretAim[\s\S]*?targetScreenAngle\(attacker\.pos, target\.pos\)/,
  'precise turret aim should point at the actual target hex',
);

const shermanAim = methodBody('startShermanTurretAim', 'startShermanTurretAimDirection');
assert.match(
  shermanAim,
  /startShermanTurretAimDirection\([\s\S]*?to,[\s\S]*?onDone,[\s\S]*?target\.pos,/,
  'the player turret should retain the exact attacked hex as its visual heading',
);

const enemyAim = methodBody('startEnemyTurretAim', 'cancelPrecisionAimHold');
assert.match(
  enemyAim,
  /const visualTarget = traverse\.reached \? target\.pos : undefined;/,
  'an AI turret that reaches its rules direction should visually face the exact target',
);

console.log('BattleScene projectile aim tests passed.');
