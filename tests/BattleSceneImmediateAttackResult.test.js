const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

function methodBody(name, nextName) {
  const start = source.indexOf(`private ${name}`);
  const end = source.indexOf(`private ${nextName}`, start + 1);
  assert(start >= 0, `missing ${name}`);
  assert(end > start, `missing method after ${name}`);
  return source.slice(start, end);
}

const hold = methodBody('enterDiceShowHold', 'applyDiceShowDestroyedVisual');
assert.match(
  hold,
  /show\.stage\s*=\s*'hold'[\s\S]*?show\.onHold\?\.\(\)/,
  'the settled attack result must be applied when the final result is revealed',
);

for (const [method, nextMethod, callback] of [
  ['tryMGAttack', 'trySmoke', 'applyAndSyncMGAttack'],
  ['resolveHardcoreATGunAttack', 'updateNonPlayerTankCommanderHatch', 'applyAndPresentAttack'],
  ['tryEnemyAttack', 'startDiceShow', 'applyAndPresentAttack'],
  ['tryAIMGAttack', 'startTurnEndEventFlow', 'applyAndPresentAttack'],
  ['beginAdjacentInfantryDiceChain', 'turnEndBodyText', 'applyAndPresentVolley'],
]) {
  const body = methodBody(method, nextMethod);
  assert.match(
    body,
    new RegExp(`onHold:\\s*(?:\\(\\)\\s*=>\\s*)?${callback}`),
    `${method} must apply and redraw the target before confirmation`,
  );
}

const playerMainGun = methodBody('tryAttack', 'startDiceShow');
assert.match(playerMainGun, /onHold:\s*\(\)\s*=>\s*applyAndSyncAttack\(false\)/,
  'player AP attacks must apply while their result panel remains open');
assert.match(playerMainGun, /const applyHEAtImpact[\s\S]*?heImpactReached = true;[\s\S]*?applyAndSyncHEAttack\(false\)[\s\S]*?onHighExplosiveImpact:\s*applyHEAtImpact/,
  'successful player HE attacks must apply at projectile impact');
assert.match(playerMainGun, /if \(completeAction\) completeAfterHEImpact = true;[\s\S]*?if \(!heImpactReached\) return;/,
  'confirmation during HE projectile flight must wait for impact before settling the action');
assert.match(playerMainGun, /onHold:\s*\(\)\s*=>\s*\{\s*if \(!report\.hit\) applyAndSyncHEAttack\(false\)/,
  'missed player HE attacks must still settle while their result panel remains open');

console.log('BattleScene immediate attack-result presentation tests passed');
