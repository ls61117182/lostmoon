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

const cue = methodBody('playHighExplosiveSuppressionCue', 'startMainGunRecoil');
assert.match(cue, /onImpact\?: \(\) => void/,
  'the HE presentation must accept an impact-time combat callback');
assert.match(cue,
  /playHighExplosiveHit\(\);[\s\S]*?spawnHighExplosiveBlast\(x, y, seed\);[\s\S]*?onImpact\?\.\(\);/,
  'the blast must exist before the attack result hides infantry and creates blood');
assert.match(cue,
  /onPenetrationImpact: hit[\s\S]*?\? handleImpact[\s\S]*?if \(hit && this\.projectileTraces\.length === traceCount\)[\s\S]*?handleImpact\(pos\.x, pos\.y\)/,
  'a hit must resolve from the projectile callback with a no-tracer fallback');

const playerAttack = methodBody('tryAttack', 'startDiceShow');
assert.match(playerAttack,
  /const applyHEAtImpact[\s\S]*?heImpactReached = true;[\s\S]*?applyAndSyncHEAttack\(false\)[\s\S]*?onHighExplosiveImpact:\s*applyHEAtImpact/,
  'player HE hits must commit at impact');
assert.match(playerAttack,
  /if \(completeAction\) completeAfterHEImpact = true;[\s\S]*?if \(!heImpactReached\) return;/,
  'early confirmation must queue completion until the HE projectile impacts');
assert.match(playerAttack,
  /onHold:\s*\(\)\s*=>\s*\{\s*if \(!report\.hit\) applyAndSyncHEAttack\(false\)/,
  'player HE misses must still settle without an impact callback');

const enemyAttack = methodBody('tryEnemyAttack', 'startDiceShow');
assert.match(enemyAttack,
  /onHighExplosiveImpact:\s*applyAndPresentHEAttack/,
  'AI HE hits must commit at impact');
assert.match(enemyAttack,
  /onHold:\s*\(\)\s*=>\s*\{\s*if \(!report\.hit\) applyAndPresentHEAttack\(\)/,
  'AI HE misses must still settle without an impact callback');

console.log('BattleScene HE impact timing tests passed');
