const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  }).outputText;
  module._compile(output, filename);
};

const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { canAttack, canMGAttack, infantryAttackRange, MG_MAX_RANGE } = require('../assets/scripts/core/Combat.ts');

const map = new HexMap(6, 6);
for (let q = 0; q <= 3; q++) {
  map.set({ pos: { q, r: 0 }, terrain: 'field' });
}

const infantry = {
  id: 'infantry-attacker',
  kind: 'american_infantry',
  faction: 'american',
  pos: { q: 0, r: 0 },
  facing: null,
  stats: {
    faction: 'american', size: 2, armorFront: 0, armorFrontSide: 0,
    armorRearSide: 0, armorRear: 0, penetration: 3, effectiveRange: 1,
    visionRange: 3, visionType: 'infantry',
  },
};

const targetStats = {
  faction: 'german', size: 4, armorFront: 4, armorFrontSide: 3,
  armorRearSide: 2, armorRear: 1, penetration: 3, effectiveRange: 3,
  visionRange: 4, visionType: 'turreted',
};
const tankAt = q => ({
  id: `tank-${q}`, kind: 'panzer4', faction: 'german', pos: { q, r: 0 },
  facing: 3, stats: targetStats,
});
const infantryAt = q => ({
  id: `foot-${q}`, kind: 'german_infantry', faction: 'german', pos: { q, r: 0 },
  facing: null, stats: { ...targetStats, size: 2, visionType: 'infantry' },
});

assert.strictEqual(infantryAttackRange(tankAt(1)), 1, 'anti-tank launcher range should be one hex');
assert.strictEqual(infantryAttackRange(infantryAt(1)), 1, 'rifle range should remain one hex');

assert.strictEqual(canAttack({ attacker: infantry, target: tankAt(1), map }).ok, true,
  'infantry should be able to attack an adjacent tank');
assert.deepStrictEqual(canAttack({ attacker: infantry, target: tankAt(2), map }),
  { ok: false, reason: 'attack.reason.outOfRange' },
  'infantry should not attack a tank two hexes away');
assert.strictEqual(canAttack({ attacker: infantry, target: infantryAt(1), map }).ok, true,
  'infantry should still attack infantry one hex away');
assert.deepStrictEqual(canAttack({ attacker: infantry, target: infantryAt(2), map }),
  { ok: false, reason: 'attack.reason.outOfRange' },
  'infantry should not attack infantry two hexes away');

const mgAttacker = tankAt(0);
const adjacentMGTarget = { ...infantryAt(1), faction: 'american' };
const distantMGTarget = { ...infantryAt(2), faction: 'american' };
assert.strictEqual(MG_MAX_RANGE, 1, 'all tank machine guns should have a one-hex range');
assert.strictEqual(canMGAttack({ attacker: mgAttacker, target: adjacentMGTarget, map }).ok, true,
  'tank machine guns should attack adjacent infantry');
assert.deepStrictEqual(canMGAttack({ attacker: mgAttacker, target: distantMGTarget, map }),
  { ok: false, reason: 'attack.reason.mgRange' },
  'tank machine guns should not attack infantry two hexes away');

console.log('Infantry target-specific range tests passed');
