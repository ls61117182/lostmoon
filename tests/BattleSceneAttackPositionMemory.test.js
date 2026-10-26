const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'),
  'utf8',
);

// Check the fallback value rather than requiring the memory read to be inlined
// in the targeting call: regional battles must reject memories across a border.
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
const actor = { sideId: 'enemy', pos: { q: 0, r: 0 } };
let remembered = { q: 20, r: 0 };
const Scene = sceneMethods(['currentAITurnTargetPosition'], {
  GameSession: { gameMode: 'hardcore' }, getGameModeConfig: () => ({ radioVisionSharing: false }),
  computeUnitVisibleHexes: () => new Set(), regionalSupportStep: () => null, regionAt: () => 'A1',
  previousEnemyAttackPosition: (_memory, observer) => { assert.strictEqual(observer, actor); return remembered; },
  visibleAITurnTargetPositionFor: (...args) => args[6],
});
const scene = new Scene();
Object.assign(scene, { mission: { map: { sameRegion: (a, b) => (a.q < 10) === (b.q < 10) },
  data: {}, smokeHexes: new Set() }, currentWeather: () => 'clear', aiTargetsFor: () => [], aiMissionTargetsFor: () => [] });
assert.strictEqual(scene.currentAITurnTargetPosition(actor), remembered, 'ordinary missions retain the previous enemy attack position');
scene.mission.data.multiRegion = { regions: [{ id: 'A1', friendlySpawnKeys: ['1,0'], enemySpawnKeys: ['3,0'] }] };
assert.deepEqual({ ...scene.currentAITurnTargetPosition(actor) }, { q: 1, r: 0 }, 'off-region memories use the local fallback');
remembered = { q: 2, r: 0 };
assert.strictEqual(scene.currentAITurnTargetPosition(actor), remembered, 'local enemy attack positions remain valid');
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
