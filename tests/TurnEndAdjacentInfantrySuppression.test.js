const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  }).outputText;
  module._compile(output, filename);
};

const { prepareTurnEndEvent } = require('../assets/scripts/core/TurnEndEventApply.ts');
const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');

function makeUnit(id, kind, q, r, suppressed = false) {
  const stats = getUnitStats(kind);
  return {
    id, kind, faction: stats.faction, pos: { q, r }, facing: 3,
    stats, suppressed,
  };
}

function prepare(suppressedIds) {
  const map = new HexMap(5, 5);
  for (let q = 0; q < 5; q++) for (let r = 0; r < 5; r++) {
    map.set({ pos: { q, r }, terrain: 'field' });
  }
  const sherman = makeUnit('player', 'sherman', 2, 2);
  sherman.crew = { commander: true, gunner: true, loader: true, driver: true, assistant: true };
  const enemies = [
    makeUnit('infantry-a', 'german_infantry', 3, 2, suppressedIds.includes('infantry-a')),
    makeUnit('infantry-b', 'german_infantry', 2, 3, suppressedIds.includes('infantry-b')),
  ];
  const rng = { d6: () => 4 };
  return prepareTurnEndEvent({ effectType: 'adjacent_infantry_fire' }, [3, 4], 7, {
    mission: { sherman, enemies, allies: [], map, smokeHexes: new Set(), data: {} },
    rng,
    nextEnemyId: () => 'unused',
  });
}

test('suppressed infantry cannot trigger or join adjacent infantry fire', () => {
  const allSuppressed = prepare(['infantry-a', 'infantry-b']);
  assert.equal(allSuppressed.bodyKey, 'turnEnd.adjacent.noTarget');
  assert.equal(allSuppressed.adjacentInfantryVolleys, undefined);

  const mixed = prepare(['infantry-a']);
  assert.equal(mixed.bodyKey, 'turnEnd.adjacent');
  assert.deepEqual(mixed.adjacentInfantryVolleys.map(v => v.attackerId), ['infantry-b']);
});
