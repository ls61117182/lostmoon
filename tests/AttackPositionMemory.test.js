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
  const {
    advanceAttackPositionMemory,
    createAttackPositionMemory,
    previousEnemyAttackPosition,
    recordAttackPosition,
  } = require('../assets/scripts/core/AttackPositionMemory.ts');
  const { RNG } = require('../assets/scripts/core/Dice.ts');
  const { visibleAITurnTargetPositionFor } = require('../assets/scripts/core/EnemyAI.ts');

  const unit = (id, faction, q, r) => ({
    id,
    kind: faction === 'usa' ? 'sherman' : 'panzer4',
    faction,
    pos: { q, r },
    facing: 0,
    stats: { faction },
  });
  const friendlyObserver = unit('friendly', 'usa', 0, 0);
  const enemyObserver = unit('enemy', 'german', 4, 0);
  const friendlyAttacker = unit('friendly-attacker', 'usa', 1, 2);
  const enemyAttacker = unit('enemy-attacker', 'german', 5, 3);
  const memory = createAttackPositionMemory();

  assert.strictEqual(previousEnemyAttackPosition(memory, friendlyObserver), undefined);
  recordAttackPosition(memory, enemyAttacker);
  recordAttackPosition(memory, friendlyAttacker);
  enemyAttacker.pos = { q: 9, r: 9 };
  enemyAttacker.destroyed = true;
  advanceAttackPositionMemory(memory);

  assert.deepStrictEqual(
    previousEnemyAttackPosition(memory, friendlyObserver),
    { q: 5, r: 3 },
    'memory keeps the attack-time position regardless of later movement or death',
  );
  assert.deepStrictEqual(previousEnemyAttackPosition(memory, enemyObserver), { q: 1, r: 2 });
  assert.deepStrictEqual(memory.currentTurn, {}, 'advancing a round clears current-round attacks');

  const hiddenTarget = unit('hidden-target', 'german', 7, 1);
  const lastAttack = previousEnemyAttackPosition(memory, friendlyObserver);
  assert.deepStrictEqual(
    visibleAITurnTargetPositionFor(
      friendlyObserver, [hiddenTarget], [], () => false, new RNG(1), 0, lastAttack,
    ),
    { q: 5, r: 3 },
    'last-round attack position precedes the opposing spawn fallback',
  );
  assert.deepStrictEqual(
    visibleAITurnTargetPositionFor(
      friendlyObserver, [hiddenTarget], [], () => true, new RNG(1), 0, lastAttack,
    ),
    hiddenTarget.pos,
    'a currently visible legal target still has highest priority',
  );

  advanceAttackPositionMemory(memory);
  assert.strictEqual(previousEnemyAttackPosition(memory, friendlyObserver), undefined);
  assert.deepStrictEqual(
    visibleAITurnTargetPositionFor(
      friendlyObserver, [hiddenTarget], [], () => false, new RNG(1), 0,
      previousEnemyAttackPosition(memory, friendlyObserver),
    ),
    { q: 6, r: 2 },
    'without a last-round attack, friendly AI falls back to enemy offset hex {7,2}',
  );

  console.log('Attack position memory tests passed.');
} finally {
  if (previousTsLoader) require.extensions['.ts'] = previousTsLoader;
  else delete require.extensions['.ts'];
}
