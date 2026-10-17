const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { getAllUnitKinds, getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { isFootKind } = require('../assets/scripts/core/types.ts');
const { hitBreakdown, mgHitBreakdown, mgHitThreshold, rollMGAttack } = require('../assets/scripts/core/Combat.ts');
const unit = (kind, q) => ({ id: kind, kind, faction: getUnitStats(kind).faction,
  pos: { q, r: 0 }, facing: 0, stats: getUnitStats(kind) });
const map = new HexMap(3, 3);
map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
const tile = { pos: { q: 1, r: 0 }, terrain: 'field' };
map.set(tile);
for (const kind of getAllUnitKinds().filter(isFootKind)) {
  for (const attackerKind of ['sherman', 'stug3', 'american_infantry']) {
    const ctx = { attacker: unit(attackerKind, 0), target: unit(kind, 1), map, hardcoreTankMachineGuns: true };
    tile.terrain = 'field';
    const plain = hitBreakdown(ctx).threshold;
    const plainMG = mgHitThreshold(ctx);
    tile.terrain = 'rocky';
    assert.equal(hitBreakdown(ctx).rocky, 1);
    assert.equal(hitBreakdown(ctx).threshold, plain + 1);
    assert.equal(mgHitBreakdown(ctx).rocky, 1);
    assert.equal(mgHitThreshold(ctx), plainMG + 1);
    assert.equal(rollMGAttack(ctx, { d6: () => plainMG }).hit, false);
    assert.equal(rollMGAttack(ctx, { d6: () => plainMG + 1 }).hit, true);
    ctx.target.hidden = true;
    assert.equal(mgHitBreakdown(ctx).rocky, 1, 'concealment does not replace rocky cover');
  }
}
const crewCtx = { attacker: unit('sherman', 0), target: { ...unit('at_gun', 1),
  atGunCrewAlive: true, atGunCrewTargetSize: 3 }, map, atGunCrewTargets: true, hardcoreTankMachineGuns: true };
tile.terrain = 'field';
const crewPlain = mgHitThreshold(crewCtx);
tile.terrain = 'rocky';
assert.equal(mgHitThreshold(crewCtx), crewPlain + 1, 'MG attacks on gun crews gain rocky cover');
assert.equal(hitBreakdown({ ...crewCtx, atGunCrewTargets: false }).rocky, 0, 'gun hardware is not infantry');
assert.equal(hitBreakdown({ ...crewCtx, target: unit('panzer4', 1) }).rocky, 0, 'tanks gain no rocky cover');
const scene = fs.readFileSync(require('node:path').join(__dirname, '../assets/scripts/view/BattleScene.ts'), 'utf8');
assert.match(scene, /add\(t\('dice.rule.rockyCover'\), base.rocky\)/);
console.log('Rocky infantry cover tests passed');
