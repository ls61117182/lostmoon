const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
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
  const types = require('../assets/scripts/core/types.ts');
  const { applyAttack } = require('../assets/scripts/core/Combat.ts');
  const { isAIActorUnit } = require('../assets/scripts/core/EnemyAI.ts');
  const { checkOutcome } = require('../assets/scripts/core/Objective.ts');

  const crew = {
    commander: false,
    loader: false,
    gunner: false,
    driver: false,
    coDriver: true,
  };
  const tank = {
    id: 'tank',
    kind: 'panzer4',
    faction: 'german',
    pos: { q: 0, r: 0 },
    facing: 0,
    stats: { faction: 'german', visionRange: 4 },
    crew,
    hatchOpen: true,
    visionRange: 4,
    fireLevel: 2,
    paralyzed: true,
  };

  applyAttack(tank, {
    hit: true,
    penetrated: true,
    statusChange: 'damaged',
    damageEffect: 'crewCheck',
    damageEffects: [{ effect: 'crewCheck', crewPriority: [5], crewSlot: 5 }],
    protagonistTarget: false,
  });

  assert.strictEqual(types.isAbandonedTank(tank), true);
  assert.strictEqual(tank.faction, 'neutral');
  assert.strictEqual(tank.hatchOpen, false);
  assert.strictEqual(tank.visionRange, 0);
  assert.strictEqual(tank.fireLevel, 2, 'fire must survive abandonment');
  assert.strictEqual(tank.paralyzed, true, 'paralysis must survive abandonment');
  assert.strictEqual(isAIActorUnit(tank), false, 'abandoned tank must receive no AI dice');

  const protagonist = { ...tank, id: 'sherman_player', kind: 'sherman' };
  assert.strictEqual(checkOutcome({
    sherman: protagonist,
    allies: [],
    enemies: [],
    data: { objective: { type: 'destroy_all_enemies' } },
  }), 'defeat', 'an uncrewed protagonist must lose a single-player mission');

  types.restoreFullTankCrew(tank);
  tank.faction = 'usa';
  assert.strictEqual(types.hasLivingTankCrew(tank), true);
  assert.deepStrictEqual(tank.crew, {
    commander: true,
    loader: true,
    gunner: true,
    driver: true,
    coDriver: true,
  });
  assert.strictEqual(tank.fireLevel, 2);
  assert.strictEqual(tank.paralyzed, true);

  const battleScene = fs.readFileSync(
    path.join(root, 'assets/scripts/view/BattleScene.ts'),
    'utf8',
  );
  assert.match(battleScene, /isFootUnit\(mover\) && isAbandonedTank\(occupant\)/);
  assert.match(battleScene, /this\.captureAbandonedTanksAt\(finishedUnit\)/);
  assert.match(battleScene, /infantry\.destroyed = true/);
  assert.match(battleScene, /restoreFullTankCrew\(tank\)/);
  assert.match(battleScene, /this\.playerMainGunTargets\(\)/);
  const aiTargetsFor = battleScene.match(/private aiTargetsFor\(actor: Unit\): Unit\[\] \{[\s\S]*?\n  \}/);
  assert(aiTargetsFor, 'BattleScene.aiTargetsFor() should be found');
  assert.match(
    aiTargetsFor[0],
    /sideTargets\.filter\(u => u !== actor && !isAbandonedTank\(u\)\)/,
    'AI target lists must exclude abandoned tanks on both sides',
  );

  console.log('abandoned tank rules test passed');
} finally {
  if (previousTsLoader) require.extensions['.ts'] = previousTsLoader;
  else delete require.extensions['.ts'];
}
