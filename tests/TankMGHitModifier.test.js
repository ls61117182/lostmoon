const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS } },
).outputText, filename);

const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { getAllUnitKinds, getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { isFootKind, isTankUnit } = require('../assets/scripts/core/types.ts');
const { mgHitThreshold, rollMGAttack, rollSelectedTankMachineGunAttacks } = require('../assets/scripts/core/Combat.ts');
const { LANG_DB } = require('../assets/scripts/core/LangDB.ts');

const map = new HexMap(3, 3);
map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
map.set({ pos: { q: 1, r: 0 }, terrain: 'field' });
const unit = (kind, pos) => ({ id: kind, kind, faction: getUnitStats(kind).faction,
  pos, facing: 0, turretFacing: 0, stats: getUnitStats(kind) });
const footKinds = getAllUnitKinds().filter(isFootKind);
assert.equal(footKinds.length, 6);
for (const kind of footKinds) {
  assert.equal(getUnitStats(kind).size, 3, `${kind} infantry size increases to 3`);
}

for (const kind of getAllUnitKinds().filter(kind => isTankUnit({ kind }))) {
  for (const targetKind of footKinds) {
    for (const hardcoreTankMachineGuns of [false, true]) {
      const ctx = { attacker: unit(kind, { q: 0, r: 0 }),
        target: unit(targetKind, { q: 1, r: 0 }), map, hardcoreTankMachineGuns,
        tankMachineGun: 'both' };
      const need = hardcoreTankMachineGuns ? 3 : 2;
      assert.equal(mgHitThreshold(ctx), need, `${kind} vs ${targetKind}: size + range - tank bonus - classic front bonus`);
      const report = rollMGAttack(ctx, { d6: () => need - 1 });
      assert.equal(report.hit, false);
      assert.equal(rollMGAttack(ctx, { d6: () => need }).hit, true);
      assert.deepEqual(report.hitModifiers, [{ labelKey: 'dice.rule.tankHitModifier', value: -1 }]);
      const rolls = [need - 1, need];
      const dual = rollSelectedTankMachineGunAttacks(ctx, { d6: () => rolls.shift() });
      assert.deepEqual(dual.map(item => item.report.hit), [false, true]);
      assert.deepEqual(dual.map(item => item.report.threshold), [need, need]);
    }
  }
}

const footCtx = { attacker: unit('american_infantry', { q: 0, r: 0 }),
  target: unit('german_infantry', { q: 1, r: 0 }), map, hardcoreTankMachineGuns: true };
assert.equal(rollMGAttack(footCtx, { d6: () => 6 }).hitModifiers.some(item => item.labelKey === 'dice.rule.tankHitModifier'), false,
  'infantry attackers do not receive the tank modifier');
const gunCtx = { ...footCtx, attacker: unit('sherman', { q: 0, r: 0 }),
  target: unit('at_gun', { q: 1, r: 0 }), atGunCrewTargets: true };
assert.equal(rollMGAttack(gunCtx, { d6: () => 6 }).hitModifiers.some(item => item.labelKey === 'dice.rule.tankHitModifier'), false,
  'guns without a living crew do not receive the infantry-target modifier');
gunCtx.target.atGunCrewAlive = true;
gunCtx.target.atGunCrewTargetSize = 3;
gunCtx.target.facing = 3;
gunCtx.target.turretFacing = 3;
map.set({ pos: { q: 1, r: 0 }, terrain: 'field', hasBuilding: true });
for (const kind of getAllUnitKinds().filter(kind => isTankUnit({ kind }))) {
  const ctx = { ...gunCtx, attacker: unit(kind, { q: 0, r: 0 }), tankMachineGun: 'both' };
  const report = rollMGAttack(ctx, { d6: () => 5 });
  assert.equal(report.hitBreakdown.size, 3);
  assert.equal(report.hitBreakdown.building, 1);
  assert.equal(report.threshold, 5, `${kind}: distance 1 + crew size 3 + building 1 + shield 1 - tank modifier 1`);
  assert.equal(report.hit, true);
  assert.deepEqual(report.hitModifiers, [
    { labelKey: 'dice.rule.tankHitModifier', value: -1 },
    { labelKey: 'dice.rule.atGunCrewTarget', value: 1 },
  ]);
  const rolls = [4, 5];
  assert.deepEqual(rollSelectedTankMachineGunAttacks(ctx, { d6: () => rolls.shift() })
    .map(item => item.report.hit), [false, true]);
}
assert.equal(rollMGAttack({ ...gunCtx, attacker: footCtx.attacker }, { d6: () => 6 })
  .hitModifiers.some(item => item.labelKey === 'dice.rule.tankHitModifier'), false,
  'infantry firing at a gun crew still gains no tank modifier');
assert.equal(LANG_DB['dice.rule.tankHitModifier'].zh, '坦克命中修正');
console.log('Tank MG hit modifier tests passed');
