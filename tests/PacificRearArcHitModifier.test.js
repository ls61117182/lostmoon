const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  }).outputText;
  module._compile(output, filename);
};

const { hitBreakdown } = require('../assets/scripts/core/Combat.ts');
const { HexMap } = require('../assets/scripts/core/HexGrid.ts');

const map = new HexMap(3, 3);
map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
map.set({ pos: { q: -1, r: 0 }, terrain: 'field' });

const stats = {
  faction: 'japanese',
  size: 1,
  armorFront: 0,
  armorFrontSide: 0,
  armorRearSide: 0,
  armorRear: 0,
  penetration: 1,
  effectiveRange: 1,
  visionRange: 2,
  visionType: 'infantry',
};
const target = {
  id: 'target',
  kind: 'sherman',
  faction: 'usa',
  pos: { q: -1, r: 0 },
  facing: 0,
  stats: { ...stats, faction: 'usa', size: 4, visionType: 'turreted' },
};
const infantry = {
  id: 'infantry',
  kind: 'japanese_infantry',
  faction: 'japanese',
  pos: { q: 0, r: 0 },
  facing: 0,
  stats,
};
const tank = {
  ...infantry,
  id: 'tank',
  kind: 'type95',
  stats: { ...stats, visionType: 'turreted' },
};

const infantryHit = hitBreakdown({ attacker: infantry, target, map, theater: 'pacific' });
assert.strictEqual(infantryHit.rearArc, 0, 'infantry attacks must ignore the rear-arc hit modifier');
assert.strictEqual(infantryHit.threshold, infantryHit.size + infantryHit.distance);

const tankHit = hitBreakdown({ attacker: tank, target, map, theater: 'pacific' });
assert.strictEqual(tankHit.rearArc, 1, 'tank attacks must retain the rear-arc hit modifier');
assert.strictEqual(tankHit.threshold, tankHit.size + tankHit.distance + 1);

console.log('Pacific rear-arc hit modifier tests passed');
