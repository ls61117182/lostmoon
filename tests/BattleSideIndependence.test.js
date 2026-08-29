const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
  }).outputText;
  module._compile(output, filename);
};

const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { currentTargetFor } = require('../assets/scripts/core/EnemyAI.ts');
const { RNG } = require('../assets/scripts/core/Dice.ts');
const { applySave, captureSave } = require('../assets/scripts/core/SaveLoad.ts');
const { isHostile, isSameSide } = require('../assets/scripts/core/types.ts');

const data = {
  id: 'mixed_side_test',
  name: 'Mixed side',
  description: '',
  cols: 3,
  rows: 1,
  tiles: [[{ t: 'f' }, { t: 'f' }, { t: 'f' }]],
  playerTank: {
    kind: 'tiger',
    faction: 'german',
    at: { col: 0, row: 0 },
    facing: 0,
    loaded: true,
    fireLevel: 2,
  },
  allies: [{
    kind: 'sherman76',
    faction: 'usa',
    at: { col: 1, row: 0 },
    facing: 0,
  }],
  enemies: [{
    kind: 'tiger',
    faction: 'german',
    at: { col: 2, row: 0 },
    facing: 3,
  }],
  objective: { type: 'destroy_all_enemies' },
};

const mission = loadMission(data);
const player = mission.playerTank;
const ally = mission.allies[0];
const enemy = mission.enemies[0];

assert.strictEqual(mission.sherman, player, 'legacy runtime alias should reference playerTank');
assert.strictEqual(player.kind, 'tiger');
assert.strictEqual(player.faction, 'german');
assert.strictEqual(player.sideId, 'player');
assert.strictEqual(player.controller, 'local_player');
assert.strictEqual(player.loaded, true, 'player state initialization must not require Sherman kind');
assert.strictEqual(player.fireLevel, 2, 'player damage state must not require Sherman kind');

assert.strictEqual(ally.faction, 'usa');
assert.strictEqual(ally.sideId, 'player');
assert.strictEqual(ally.controller, 'ai');
assert.strictEqual(isSameSide(player, ally), true, 'cross-national allies share a battle side');

assert.strictEqual(enemy.faction, player.faction, 'fixture uses the same nation on opposing sides');
assert.strictEqual(enemy.sideId, 'enemy');
assert.strictEqual(isHostile(player, enemy), true, 'same-national units may be hostile');
assert.strictEqual(
  currentTargetFor(enemy, [player, ally], [player], new RNG(1)),
  ally,
  'AI target selection uses side and distance rather than national faction',
);

const currentSave = captureSave({
  gameMode: 'hardcore',
  missionId: data.id,
  mission,
  turn: 2,
  phase: 'player',
  movesLeft: 1,
  attacksLeft: 1,
  miscDone: false,
  playerStep: 'choose',
  hatchChangedThisTurn: false,
  phaseDice: [],
});
assert.strictEqual(currentSave.version, 11);
assert.strictEqual(currentSave.playerTank.kind, 'tiger');
assert.strictEqual(currentSave.playerTank.sideId, 'player');
assert.strictEqual(currentSave.enemies[0].sideId, 'enemy');

const legacyV10Save = JSON.parse(JSON.stringify(currentSave));
legacyV10Save.version = 10;
delete legacyV10Save.playerTank;
for (const snapshot of [legacyV10Save.sherman, ...legacyV10Save.allies, ...legacyV10Save.enemies]) {
  delete snapshot.sideId;
  delete snapshot.controller;
}
const restoredLegacy = loadMission(data);
const restoreResult = applySave(restoredLegacy, data.id, legacyV10Save);
assert.strictEqual(restoreResult.ok, true, restoreResult.reason);
assert.strictEqual(restoredLegacy.playerTank.kind, 'tiger');
assert.strictEqual(restoredLegacy.playerTank.sideId, 'player');
assert.strictEqual(restoredLegacy.allies[0].sideId, 'player');
assert.strictEqual(restoredLegacy.enemies[0].sideId, 'enemy');
assert.strictEqual(isSameSide(restoredLegacy.playerTank, restoredLegacy.allies[0]), true);
assert.strictEqual(isHostile(restoredLegacy.playerTank, restoredLegacy.enemies[0]), true);

console.log('battle side independence tests passed');
