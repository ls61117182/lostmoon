const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { getAllUnitKinds, getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { isFootKind } = require('../assets/scripts/core/types.ts');
const { hitBreakdown, hitThreshold, mgHitBreakdown, mgHitThreshold, rollAttack, rollMGAttack,
  rollSelectedTankMachineGunAttacks } = require('../assets/scripts/core/Combat.ts');

const unit = (kind, q) => ({ id: kind, kind, faction: getUnitStats(kind).faction,
  pos: { q, r: 0 }, facing: 0, turretFacing: 0, stats: getUnitStats(kind) });
const map = new HexMap(3, 3);
map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
const tile = { pos: { q: 1, r: 0 }, terrain: 'field' };
map.set(tile);

for (const kind of getAllUnitKinds().filter(isFootKind)) {
  for (const attackerKind of ['sherman', 'stug3']) {
    for (const hardcoreTankMachineGuns of [false, true]) {
      const ctx = { attacker: unit(attackerKind, 0), target: unit(kind, 1), map,
        hardcoreTankMachineGuns, tankMachineGun: 'both' };
      tile.terrain = 'field';
      const plainMG = mgHitThreshold(ctx);
      const plainMain = hitBreakdown(ctx).threshold;
      tile.terrain = 'forest';
      assert.equal(mgHitBreakdown(ctx).forest, 1);
      assert.equal(mgHitThreshold(ctx), plainMG + 1);
      const miss = rollMGAttack(ctx, { d6: () => plainMG });
      assert.equal(miss.hit, false);
      assert.equal(miss.threshold, plainMG + 1);
      assert.equal(miss.hitBreakdown.forest, 1);
      assert.equal(rollMGAttack(ctx, { d6: () => plainMG + 1 }).hit, true);
      const rolls = [plainMG, plainMG + 1];
      const dual = rollSelectedTankMachineGunAttacks(ctx, { d6: () => rolls.shift() });
      assert.deepEqual(dual.map(item => item.report.threshold), [plainMG + 1, plainMG + 1]);
      assert.deepEqual(dual.map(item => item.report.hit), [false, true]);
      assert.equal(hitBreakdown(ctx).threshold, plainMain, 'forest MG cover does not change main-gun rules');
      ctx.target.hidden = true;
      assert.equal(mgHitThreshold(ctx), plainMG + 3, 'forest cover stacks with concealment');
    }
  }
}

for (const attackerKind of getAllUnitKinds().filter(isFootKind)) {
  for (const targetKind of getAllUnitKinds().filter(isFootKind)) {
    const ctx = { attacker: unit(attackerKind, 0), target: unit(targetKind, 1), map };
    tile.terrain = 'field';
    const plain = hitThreshold(ctx);
    tile.terrain = 'forest';
    assert.equal(hitBreakdown(ctx).forest, 1, `${attackerKind} vs ${targetKind}: forest cover applies to rifle fire`);
    assert.equal(hitThreshold(ctx), plain + 1);
    for (const total of [plain, plain + 1]) {
      const dice = [2, total - 2];
      const report = rollAttack(ctx, { d6: () => {
        assert.ok(dice.length, 'infantry combat uses only the two hit dice');
        return dice.shift();
      } });
      assert.equal(report.threshold, plain + 1);
      assert.equal(report.hitBreakdown.forest, 1, 'the report retains cover for the hit details');
      assert.equal(report.hit, total >= plain + 1);
      assert.equal(report.statusChange, total >= plain + 1 ? 'destroyed' : 'none');
    }
    tile.terrain = 'field';
    map.set({ pos: { q: 0, r: 0 }, terrain: 'forest' });
    assert.equal(hitThreshold(ctx), plain, 'attacker forest does not grant target cover');
    map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
  }
}
tile.terrain = 'forest';
assert.equal(hitBreakdown({ attacker: unit('american_infantry', 0),
  target: unit('panzer4', 1), map }).forest, 0, 'rifle fire at tanks gains no infantry cover');

const crewCtx = { attacker: unit('sherman', 0), target: { ...unit('at_gun', 1),
  atGunCrewAlive: true, atGunCrewTargetSize: 3 }, map, atGunCrewTargets: true,
  hardcoreTankMachineGuns: true };
tile.terrain = 'field';
const crewPlain = mgHitThreshold(crewCtx);
tile.terrain = 'forest';
assert.equal(mgHitThreshold(crewCtx), crewPlain + 1, 'exposed gun crews share infantry MG cover');
assert.equal(mgHitBreakdown({ ...crewCtx, atGunCrewTargets: false }).forest, 0);
assert.equal(mgHitBreakdown({ ...crewCtx, target: unit('panzer4', 1) }).forest, 0);
tile.terrain = 'field';
map.set({ pos: { q: 0, r: 0 }, terrain: 'forest' });
assert.equal(mgHitThreshold(crewCtx), crewPlain, 'the attacker forest grants no target cover');
tile.terrain = 'trees';
assert.equal(mgHitBreakdown({ ...crewCtx, theater: 'pacific' }).forest, 0);
assert.equal(mgHitBreakdown({ ...crewCtx, theater: 'pacific' }).trees, 1, 'Pacific trees retain their existing modifier');
console.log('Forest infantry cover tests passed');
