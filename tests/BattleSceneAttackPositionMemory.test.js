const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'),
  'utf8',
);

assert.match(
  source,
  /visibleAITurnTargetPositionFor\([\s\S]*?previousEnemyAttackPosition\(this\.attackPositionMemory, actor\)/,
  'turn fallback must use the observing side previous-round enemy attack position',
);
assert.match(
  source,
  /private rememberAttackPosition[\s\S]*?recordAttackPositionForMemory\(this\.attackPositionMemory, attacker\)/,
);
assert.match(source, /private playAttackFireCue[\s\S]*?if \(!mg\) this\.rememberAttackPosition\(attacker\)/);
assert.match(source, /private playMachineGunFireCue[\s\S]*?this\.rememberAttackPosition\(attacker\)/);
assert.match(source, /private playHighExplosiveSuppressionCue[\s\S]*?this\.rememberAttackPosition\(attacker\)/);
assert.match(source, /private playTurnEndSniperShot[\s\S]*?this\.rememberAttackPosition\(attacker\)/);
assert.match(
  source,
  /private endEnemyPhase\(\)[\s\S]*?advanceAttackPositionMemory\(this\.attackPositionMemory\)[\s\S]*?this\.turn \+= 1/,
  'attack positions must roll over only after the complete enemy/end-event phase',
);
assert.strictEqual(
  (source.match(/attackPositionMemory: this\.attackPositionMemory/g) ?? []).length,
  2,
  'normal saves and campaign checkpoints must both persist attack memory',
);

console.log('BattleScene attack position memory integration tests passed.');
