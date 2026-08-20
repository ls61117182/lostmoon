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
const {
  canMGAttack,
  mgHitThreshold,
  selectTankMachineGun,
} = require('../assets/scripts/core/Combat.ts');

const stats = {
  faction: 'usa',
  size: 4,
  armorFront: 4,
  armorFrontSide: 3,
  armorRearSide: 2,
  armorRear: 1,
  penetration: 3,
  effectiveRange: 3,
  visionRange: 4,
  visionType: 'turreted',
  turretTraverseSpeed: 2,
};
const attacker = {
  id: 'tank',
  kind: 'sherman',
  faction: 'usa',
  pos: { q: 0, r: 0 },
  facing: 0,
  turretFacing: 3,
  stats,
};
const infantryAt = (q, r) => ({
  id: `infantry-${q}-${r}`,
  kind: 'infantry',
  faction: 'german',
  pos: { q, r },
  facing: null,
  stats: { ...stats, size: 2, visionType: 'infantry' },
});
const map = new HexMap(3, 3);
map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
map.set({ pos: { q: 1, r: 0 }, terrain: 'field' });
map.set({ pos: { q: -1, r: 0 }, terrain: 'field' });

assert.deepStrictEqual(selectTankMachineGun(attacker, 0, false), {
  weapon: 'hull',
  rotateTurret: true,
}, 'the hull MG fires forward even if the turret cannot finish rotating there');

assert.deepStrictEqual(selectTankMachineGun({ ...attacker, turretFacing: 0 }, 0, true), {
  weapon: 'both',
  rotateTurret: false,
}, 'both machine guns fire when an intact turret is already aligned with the hull front');

assert.deepStrictEqual(selectTankMachineGun(attacker, 0, true), {
  weapon: 'both',
  rotateTurret: true,
}, 'both machine guns fire after an intact turret can finish aligning with the hull front');

const noCoDriver = {
  ...attacker,
  crew: {
    commander: true,
    loader: true,
    gunner: true,
    driver: true,
    coDriver: false,
  },
};
assert.deepStrictEqual(selectTankMachineGun(noCoDriver, 0, true), {
  weapon: 'coaxial',
  rotateTurret: true,
}, 'a dead co-driver disables the hull MG and makes a forward target use the coaxial MG');
assert.deepStrictEqual(selectTankMachineGun({ ...noCoDriver, turretFacing: 0 }, 0, true), {
  weapon: 'coaxial',
  rotateTurret: false,
}, 'aligned weapons still use the coaxial MG when the co-driver is dead');
assert.strictEqual(selectTankMachineGun({ ...noCoDriver, turretDamaged: true }, 0, true), null,
  'a dead co-driver plus a damaged off-axis turret leaves no MG for a forward target');

assert.deepStrictEqual(selectTankMachineGun(attacker, 3, false), {
  weapon: 'coaxial',
  rotateTurret: false,
}, 'the coaxial MG can fire along the current turret direction');

assert.strictEqual(selectTankMachineGun({ ...attacker, turretDamaged: true }, 1, true), null,
  'a damaged turret cannot rotate the coaxial MG to a new direction');
assert.deepStrictEqual(selectTankMachineGun({ ...attacker, turretDamaged: true }, 3, false), {
  weapon: 'coaxial',
  rotateTurret: false,
}, 'a damaged turret retains coaxial fire in its existing direction');
assert.deepStrictEqual(selectTankMachineGun({ ...attacker, turretDamaged: true, turretFacing: 0 }, 0, true), {
  weapon: 'hull',
  rotateTurret: false,
}, 'a damaged turret uses only the operational hull MG against a forward target');

const frontTarget = infantryAt(1, 0);
const rearTarget = infantryAt(-1, 0);
const common = { attacker, map, hardcoreTankMachineGuns: true };
assert.deepStrictEqual(canMGAttack({ ...common, target: frontTarget }), {
  ok: false,
  reason: 'attack.reason.mgDirection',
}, 'hardcore tank MG attacks require a legal selected weapon');
assert.deepStrictEqual(canMGAttack({
  ...common,
  attacker: { ...attacker, turretFacing: 2 },
  target: rearTarget,
  tankMachineGun: 'coaxial',
}), {
  ok: false,
  reason: 'attack.reason.mgDirection',
}, 'the coaxial MG cannot fire outside its current direction without a legal traverse');
assert.strictEqual(canMGAttack({
  ...common,
  attacker: { ...attacker, turretFacing: 2 },
  target: rearTarget,
  tankMachineGun: 'coaxial',
  tankMachineGunWillTraverse: true,
}).ok, true, 'an intact turret may traverse the coaxial MG to a reachable target');
assert.strictEqual(canMGAttack({
  ...common,
  attacker: { ...attacker, turretDamaged: true, turretFacing: 0 },
  target: frontTarget,
  tankMachineGun: 'hull',
}).ok, true, 'a damaged turret does not block an operational hull MG firing forward');
assert.deepStrictEqual(canMGAttack({
  ...common,
  attacker: { ...attacker, turretDamaged: true, turretFacing: 0 },
  target: frontTarget,
  tankMachineGun: 'both',
}), {
  ok: false,
  reason: 'attack.reason.mgDirection',
}, 'a damaged turret can never combine the coaxial MG with the hull MG');

const bothNeed = mgHitThreshold({
  ...common,
  attacker: { ...attacker, turretFacing: 0 },
  target: frontTarget,
  tankMachineGun: 'both',
});
const hullNeed = mgHitThreshold({
  ...common,
  target: frontTarget,
  tankMachineGun: 'hull',
});
const coaxialNeed = mgHitThreshold({
  ...common,
  target: rearTarget,
  tankMachineGun: 'coaxial',
});
assert.strictEqual(hullNeed, coaxialNeed,
  'hull-only and coaxial-only fire should use the same unmodified hit threshold');
assert.strictEqual(bothNeed, hullNeed - 1,
  'only combined hull and coaxial fire receives the -1 hit-threshold effect');

console.log('Hardcore tank machine-gun tests passed');
