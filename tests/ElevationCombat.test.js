const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { hitBreakdown, hitThreshold, previewAttack, mgHitBreakdown, mgHitThreshold, rollAttack,
  rollHighExplosiveAttack, rollMGAttack, rollSelectedTankMachineGunAttacks } = require('../assets/scripts/core/Combat.ts');
const { LANG_DB } = require('../assets/scripts/core/LangDB.ts');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
const actor = (kind, q) => ({ id: `${kind}-${q}`, kind, faction: getUnitStats(kind).faction,
  stats: getUnitStats(kind), pos: { q, r: 0 }, facing: 0, turretFacing: 0 });
function context(attackerKind = 'sherman', targetKind = 'panzer4') {
  const map = new HexMap(3, 3);
  map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
  map.set({ pos: { q: 1, r: 0 }, terrain: 'field' });
  return { map, attacker: actor(attackerKind, 0), target: actor(targetKind, 1), shellType: 'ap' };
}
function diceWithTotal(total) {
  const first = Math.min(6, total - 1), dice = [first, total - first];
  return { d6: () => dice.shift() ?? 6 };
}

test('main guns gain a fixed +2 only when firing uphill, for tanks, fixed guns and artillery', () => {
  for (const kind of ['sherman', 'panzer4', 'stug3', 'pak38', 'heavy_artillery']) {
    const ctx = context(kind), origin = ctx.map.get(ctx.attacker.pos), target = ctx.map.get(ctx.target.pos);
    const plain = hitThreshold(ctx);
    for (const [low, high] of [[0, .25], [-2, -1], [1, 7]]) {
      origin.height = low; target.height = high;
      assert.equal(hitBreakdown(ctx).elevation, 2, kind);
      assert.equal(hitThreshold(ctx), plain + 2);
      assert.equal(previewAttack(ctx).hit.threshold, plain + 2, 'preview shares the combat threshold');
      target.height = low;
      assert.equal(hitThreshold(ctx), plain, 'same height has no penalty');
      target.height = low - 1;
      assert.equal(hitThreshold(ctx), plain, 'downhill has no penalty');
    }
  }
});

test('main-gun AP, HVAP and HE reports apply the +2 at the actual hit boundary', () => {
  const ctx = context(), plain = hitThreshold(ctx);
  ctx.map.get(ctx.target.pos).height = 1;
  for (const shellType of ['ap', 'hvap', 'he']) {
    const shot = { ...ctx, shellType };
    const resolve = shellType === 'he' ? rollHighExplosiveAttack : rollAttack;
    const miss = resolve(shot, diceWithTotal(plain + 1));
    const hit = resolve(shot, diceWithTotal(plain + 2));
    assert.equal(miss.threshold, plain + 2);
    assert.equal(miss.hitBreakdown.elevation, 2);
    assert.equal(miss.hit, false);
    assert.equal(hit.hit, true);
  }
});

test('tank and infantry MGs gain +1 in both classic and hardcore rules, including both tank MG rolls', () => {
  for (const kind of ['sherman', 'stug3', 'american_infantry', 'infantry', 'japanese_infantry']) {
    for (const hardcoreTankMachineGuns of [false, true]) {
      const ctx = { ...context(kind, 'german_infantry'), hardcoreTankMachineGuns, tankMachineGun: 'both' };
      const plain = mgHitThreshold(ctx);
      ctx.map.get(ctx.target.pos).height = 3;
      assert.equal(mgHitBreakdown(ctx).elevation, 1);
      assert.equal(mgHitThreshold(ctx), plain + 1);
      assert.equal(rollMGAttack(ctx, { d6: () => plain }).hit, false);
      assert.equal(rollMGAttack(ctx, { d6: () => plain + 1 }).hit, true);
      if (kind === 'sherman' || kind === 'stug3') {
        const dice = [plain, plain + 1];
        const reports = rollSelectedTankMachineGunAttacks(ctx, { d6: () => dice.shift() });
        assert.deepEqual(reports.map(item => item.report.threshold), [plain + 1, plain + 1]);
        assert.deepEqual(reports.map(item => item.report.hit), [false, true]);
      }
      ctx.map.get(ctx.attacker.pos).height = 3;
      assert.equal(mgHitThreshold(ctx), plain);
      ctx.map.get(ctx.attacker.pos).height = 4;
      assert.equal(mgHitThreshold(ctx), plain);
    }
  }
});

test('infantry ordinary attack resolution applies +1 to foot targets and operated gun crews', () => {
  for (const targetKind of ['german_infantry', 'pak38']) {
    const ctx = context('american_infantry', targetKind);
    if (targetKind === 'pak38') Object.assign(ctx.target, { atGunCrewAlive: true, atGunCrewTargetSize: 3 });
    const plain = rollAttack(ctx, diceWithTotal(2)).threshold;
    ctx.map.get(ctx.target.pos).height = 1;
    const miss = rollAttack(ctx, diceWithTotal(plain));
    const hit = rollAttack(ctx, diceWithTotal(plain + 1));
    assert.equal(miss.hitBreakdown.elevation, 1);
    assert.equal(miss.threshold, plain + 1);
    assert.equal(miss.hit, false);
    assert.equal(hit.hit, true);
    assert.equal(hit.penDice, undefined, 'small arms do not roll penetration');
  }
  const antiTank = context('american_infantry');
  antiTank.map.get(antiTank.target.pos).height = 1;
  assert.equal(hitBreakdown(antiTank).elevation, 0, 'infantry anti-tank weapons are not MG fire');
});

test('uphill penalties stack with weather, cover and actions, including the strongest-cover trench rule', () => {
  for (const kind of ['sherman', 'american_infantry']) {
    const ctx = { ...context(kind, 'german_infantry'), weather: 'rain', hitThresholdModifier: -2 };
    Object.assign(ctx.map.get(ctx.target.pos), { terrain: 'forest', fortification: { kind: 'trench', connections: '000000' } });
    const plainMG = mgHitThreshold(ctx), plainMain = hitThreshold(ctx);
    ctx.map.get(ctx.target.pos).height = 1;
    assert.equal(mgHitBreakdown(ctx).trench, 2);
    assert.equal(mgHitThreshold(ctx), plainMG + 1, 'height adds to the winning protection');
    assert.equal(hitThreshold(ctx), plainMain + (kind === 'sherman' ? 2 : 1));
  }
});

test('dice details show the stored uphill modifier for main guns, MGs and infantry', () => {
  const Scene = sceneMethods(['diceRuleModalSpec'], { t: key => key, getLang: () => 'zh' });
  const scene = new Scene();
  for (const [attackerKind, targetKind, mg] of [
    ['sherman', 'panzer4', false], ['sherman', 'german_infantry', true], ['american_infantry', 'german_infantry', false],
  ]) {
    const ctx = context(attackerKind, targetKind);
    ctx.map.get(ctx.target.pos).height = 1;
    const report = mg ? rollMGAttack(ctx, { d6: () => 6 }) : rollAttack(ctx, diceWithTotal(2));
    // Report snapshots must survive a later map change and require no live units.
    ctx.map.get(ctx.target.pos).height = 0;
    const spec = scene.diceRuleModalSpec({ report }, 'hit');
    assert(spec.rows.some(([label, value]) => label === 'dice.rule.uphill' && value === String(mg || attackerKind.includes('infantry') ? 1 : 2)));
    assert.equal(spec.total[1], String(report.threshold));
  }
  assert.equal(LANG_DB['dice.rule.uphill'].zh, '仰射高地');
  assert.equal(LANG_DB['dice.rule.uphill'].en, 'Uphill fire');
});
