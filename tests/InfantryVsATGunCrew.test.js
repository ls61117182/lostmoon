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
const { resolveAttack, rollAttack } = require('../assets/scripts/core/Combat.ts');

const map = new HexMap(2, 2);
map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
map.set({ pos: { q: 1, r: 0 }, terrain: 'field' });

const infantry = {
  id: 'american-infantry',
  kind: 'american_infantry',
  faction: 'american',
  pos: { q: 0, r: 0 },
  facing: null,
  stats: {
    faction: 'american', size: 0, armorFront: 0, armorFrontSide: 0,
    armorRearSide: 0, armorRear: 0, penetration: 1, effectiveRange: 1,
    visionRange: 2, visionType: 'omni',
  },
};
const pak38 = {
  id: 'pak38',
  kind: 'pak38',
  faction: 'german',
  pos: { q: 1, r: 0 },
  facing: 3,
  atGunCrewAlive: true,
  atGunCrewTargetSize: 1,
  stats: {
    faction: 'german', size: 4, armorFront: 3, armorFrontSide: 2,
    armorRearSide: 1, armorRear: 0, penetration: 4, effectiveRange: 3,
    visionRange: 4, visionType: 'fixed',
  },
};

const report = rollAttack({ attacker: infantry, target: pak38, map }, { d6: () => 6 });
assert.strictEqual(report.smallArms, true, 'infantry should use small arms against an operated AT gun');
assert.strictEqual(report.hitBreakdown.size, pak38.atGunCrewTargetSize,
  'the hit check should use the exposed crew size instead of the gun carriage size');
assert.strictEqual(report.penDice, undefined, 'small-arms fire should not roll penetration dice');
assert.strictEqual(report.armor, undefined, 'small-arms fire should not test AT-gun armour');

resolveAttack({ attacker: infantry, target: pak38, map }, { d6: () => 6 });
assert.strictEqual(pak38.destroyed, undefined, 'small arms should leave the gun carriage intact');
assert.strictEqual(pak38.atGunCrewAlive, false, 'a hit should eliminate the AT-gun crew');
assert.strictEqual(pak38.faction, 'neutral', 'an uncrewed AT gun should become neutral');

console.log('Infantry versus AT-gun crew tests passed');
