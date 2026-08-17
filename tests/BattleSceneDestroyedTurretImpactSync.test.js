const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert.match(
  source,
  /if \(!attackerVisible \|\| !targetVisible\)[\s\S]*?playAttackFireCue\([\s\S]*?applyAttackDestroyedVisualAtImpact\(report, opts\.attacker \?\? null, opts\.target \?\? null\)[\s\S]*?scheduleOnce\([\s\S]*?FOG_ATTACK_REVEAL_DURATION/,
  'hidden attacks should attach the destroyed visual to projectile impact while retaining the reveal delay',
);

const projectileImpact = source.match(/private advanceProjectileTraces\(dt: number\)[\s\S]*?\n  }\n\n/);
assert(projectileImpact, 'the tank projectile advancement method should exist');
assert(
  projectileImpact[0].indexOf('tr.onPenetrationImpact?.(') >= 0
    && projectileImpact[0].indexOf('tr.onPenetrationImpact?.(')
      < projectileImpact[0].indexOf('playTankHitPenetration()'),
  'the destroyed visual should trigger in the same impact frame before the penetration sound',
);

const rocketImpact = source.match(/private advanceInfantryRocketTraces\(dt: number\)[\s\S]*?\n  }\n\n/);
assert(rocketImpact, 'the infantry rocket advancement method should exist');
assert(
  rocketImpact[0].indexOf('trace.onPenetrationImpact?.()') >= 0
    && rocketImpact[0].indexOf('trace.onPenetrationImpact?.()')
      < rocketImpact[0].indexOf('playTankHitPenetration()'),
  'infantry anti-tank impacts should use the same synchronized destroyed visual timing',
);

console.log('BattleScene destroyed-turret impact sync tests passed');
