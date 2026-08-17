const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

const previousTsLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

try {
  const { prepareTurnEndEvent } = require('../assets/scripts/core/TurnEndEventApply.ts');
  const { applySave } = require('../assets/scripts/core/SaveLoad.ts');
  const { hasLivingTankCrew, isAbandonedTank } = require('../assets/scripts/core/types.ts');

  const spawnTile = {
    pos: { q: 0, r: 0 },
    terrain: 'field',
    enemyStartId: 1,
    enemyStartFacing: 0,
  };
  const mission = {
    data: { id: 'mission_01', theater: 'europe' },
    map: {
      all: () => [spawnTile],
      has: () => false,
      canTankEnter: () => false,
    },
    sherman: {
      id: 'sherman_player',
      kind: 'sherman',
      faction: 'usa',
      pos: { q: 4, r: 0 },
      facing: 3,
      stats: { faction: 'usa' },
    },
    allies: [],
    enemies: [],
  };

  const prepared = prepareTurnEndEvent(
    {
      missionId: 'mission_01',
      sumMin: 11,
      sumMax: 12,
      diceCount: 2,
      effectType: 'panzer3_spawn',
      reinforcementSide: 'enemy',
    },
    [6, 6],
    12,
    {
      mission,
      rng: { d6: () => 1 },
      nextEnemyId: () => 'reinforcement-1',
    },
  );

  prepared.apply();
  assert.strictEqual(mission.enemies.length, 1, 'tank reinforcement should be added');
  const reinforcement = mission.enemies[0];
  assert.deepStrictEqual(reinforcement.crew, {
    commander: true,
    loader: true,
    gunner: true,
    driver: true,
    coDriver: true,
  });
  assert.strictEqual(hasLivingTankCrew(reinforcement), true);
  assert.strictEqual(isAbandonedTank(reinforcement), false);
  assert.strictEqual(reinforcement.faction, 'german');
  assert.strictEqual(reinforcement.visionRange, reinforcement.stats.visionRange);
  assert.strictEqual(reinforcement.turretFacing, reinforcement.facing);

  // Regression for saves produced by the buggy reinforcement constructor:
  // crew was omitted, an attack neutralized the unit, and load used to retain
  // that neutral faction while silently supplying a full crew.
  const legacyMission = {
    data: { id: 'mission_01', theater: 'europe' },
    sherman: {
      id: 'sherman_player',
      kind: 'sherman',
      faction: 'usa',
      pos: { q: 4, r: 0 },
      facing: 3,
      stats: { faction: 'usa' },
      crew: {
        commander: true,
        loader: true,
        gunner: true,
        driver: true,
        coDriver: true,
      },
    },
    allies: [],
    enemies: [],
    smokeHexes: new Set(),
    smokeHexOwners: new Map(),
  };
  const saveResult = applySave(legacyMission, 'mission_01', {
    version: 7,
    missionId: 'mission_01',
    turn: 2,
    phase: 'enemy',
    movesLeft: 0,
    attacksLeft: 0,
    sherman: {
      id: 'sherman_player',
      kind: 'sherman',
      faction: 'usa',
      q: 4,
      r: 0,
      facing: 3,
      crew: { ...legacyMission.sherman.crew },
    },
    allies: [],
    enemies: [{
      id: 'legacy-reinforcement',
      kind: 'panzer3',
      faction: 'neutral',
      q: 0,
      r: 0,
      facing: 0,
      // Intentionally no crew: this is the exact old corrupt snapshot shape.
    }],
  });
  assert.strictEqual(saveResult.ok, true);
  assert.strictEqual(legacyMission.enemies.length, 1);
  assert.strictEqual(legacyMission.enemies[0].faction, 'german');
  assert.strictEqual(hasLivingTankCrew(legacyMission.enemies[0]), true);
  assert.strictEqual(isAbandonedTank(legacyMission.enemies[0]), false);

  console.log('turn-end reinforcement crew tests passed');
} finally {
  if (previousTsLoader) require.extensions['.ts'] = previousTsLoader;
  else delete require.extensions['.ts'];
}
