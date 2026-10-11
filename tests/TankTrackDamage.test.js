const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

const oldLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText, filename);

try {
  const { immobilizeTank, ensureTankTrackDamage } = require('../assets/scripts/core/TankTrackDamage.ts');
  const { incomingAngleFrom, applyAttack, applyHighExplosiveAttack, rollAttack, rollHighExplosiveAttack } = require('../assets/scripts/core/Combat.ts');
  const { HEX_DIRECTIONS, HexMap } = require('../assets/scripts/core/HexGrid.ts');
  const { repairableComponentById } = require('../assets/scripts/core/RepairableComponents.ts');
  const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
  const unit = facing => ({ id: 'tank', kind: 'sherman', pos: { q: 0, r: 0 },
    facing, faction: 'usa', stats: getUnitStats('sherman') });

  // For every hull heading, clockwise incoming bearings are on the right;
  // counterclockwise incoming bearings are on the left.
  for (let facing = 0; facing < 6; facing++) {
    for (const delta of [1, 2, 4, 5]) {
      const tank = unit(facing);
      const incoming = HEX_DIRECTIONS[(facing + delta) % 6];
      immobilizeTank(tank, incomingAngleFrom(tank, incoming), () => 0.5);
      assert.strictEqual(tank.trackDamage.side, delta < 3 ? 'right' : 'left');
      assert.strictEqual(tank.trackDamage.position, 0.5);
    }
  }
  for (const randomValue of [0, 0.25, 0.5, 0.999999]) {
    const tank = unit(0);
    immobilizeTank(tank, 60, () => randomValue);
    assert(tank.trackDamage.position >= 1 / 3 && tank.trackDamage.position <= 2 / 3);
  }
  for (const incoming of [undefined, 0, 180, -180]) {
    const tank = unit(0);
    immobilizeTank(tank, incoming, () => 0.25);
    assert.strictEqual(tank.trackDamage.side, 'left');
  }
  const tank = unit(0);
  immobilizeTank(tank, 60, () => 0.25);
  const initial = tank.trackDamage;
  immobilizeTank(tank, -60, () => 0.9);
  assert.strictEqual(tank.trackDamage, initial, 'repeated hits retain the current broken track');
  assert.strictEqual(ensureTankTrackDamage(tank), initial, 'redraw retains placement');
  repairableComponentById('mobility').repair(tank);
  assert.strictEqual(tank.trackDamage, undefined);
  immobilizeTank(tank, -60, () => 0.75);
  assert.strictEqual(tank.trackDamage.side, 'left');
  assert.notStrictEqual(tank.trackDamage.position, initial.position);

  const legacySave = { ...unit(0), paralyzed: true };
  const fallback = ensureTankTrackDamage(legacySave);
  assert.strictEqual(ensureTankTrackDamage(legacySave), fallback);
  const restored = JSON.parse(JSON.stringify(legacySave));
  assert.deepStrictEqual(ensureTankTrackDamage(restored), fallback);

  for (const directional of [false, true]) {
    const target = unit(0);
    const report = { hit: true, penetrated: true, incomingAngle: -60,
      damageEffect: 'paralyzed', statusChange: 'damaged',
      damageEffects: directional ? [{ effect: 'paralyzed' }] : undefined };
    applyAttack(target, report);
    assert.strictEqual(target.trackDamage.side, 'left');
    const protectedTarget = { ...unit(0), campaignParalyzedProtectionAvailable: true };
    applyAttack(protectedTarget, report);
    assert(!protectedTarget.paralyzed);
    assert.strictEqual(protectedTarget.trackDamage, undefined);
  }
  const heTarget = unit(0);
  applyHighExplosiveAttack(heTarget, { hit: true, outcome: 'paralyzed', incomingAngle: 60 });
  assert.strictEqual(heTarget.trackDamage.side, 'right');

  const map = new HexMap(3, 3);
  const attacker = { ...unit(0), id: 'attacker', pos: { q: 0, r: 1 } };
  const target = unit(0);
  const context = { attacker, target, map, protagonist: target };
  assert.strictEqual(rollAttack(context, { d6: () => 6 }).incomingAngle, 60);
  assert.strictEqual(rollHighExplosiveAttack(context, { d6: () => 6 }).incomingAngle, 60);
  console.log('Track damage direction, fixed placement, repairs, protection and attack report tests passed.');
} finally {
  if (oldLoader) require.extensions['.ts'] = oldLoader;
  else delete require.extensions['.ts'];
}
