const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  }).outputText;
  module._compile(output, filename);
};

const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { canAttack, canMGAttack, selectTankMachineGun } = require('../assets/scripts/core/Combat.ts');

const stats = {
  faction: 'german',
  size: 5,
  armorFront: 11,
  armorFrontSide: 9,
  armorRearSide: 8,
  armorRear: 7,
  penetration: 2,
  effectiveRange: 2,
  visionRange: 4,
  gunnerVisionRange: 4,
  visionType: 'fixed',
  turretTraverseSpeed: 0,
};
const attacker = {
  id: 'stug',
  kind: 'stug3',
  faction: 'german',
  pos: { q: 0, r: 0 },
  facing: 0,
  turretFacing: 0,
  stats,
};
const unitAt = (id, kind, q, r) => ({
  id,
  kind,
  faction: 'usa',
  pos: { q, r },
  facing: kind === 'infantry' ? null : 3,
  stats: { ...stats, visionType: kind === 'infantry' ? 'infantry' : 'turreted' },
});
const map = new HexMap(2, 2);
for (const pos of [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }]) {
  map.set({ pos, terrain: 'field' });
}

const frontTank = unitAt('front-tank', 'sherman', 1, 0);
const sideTank = unitAt('side-tank', 'sherman', 0, 1);
assert.strictEqual(canAttack({ attacker, target: frontTank, map }).ok, true,
  'a fixed main gun may fire along the hull-facing ray');
assert.deepStrictEqual(canAttack({ attacker, target: sideTank, map }), {
  ok: false,
  reason: 'attack.reason.fixedGunFacing',
}, 'a fixed main gun may not fire to the side');

const frontInfantry = unitAt('front-infantry', 'infantry', 1, 0);
const sideInfantry = unitAt('side-infantry', 'infantry', 0, 1);
assert.strictEqual(canMGAttack({ attacker, target: frontInfantry, map }).ok, true,
  'a fixed-gun tank MG may fire forward');
assert.deepStrictEqual(canMGAttack({ attacker, target: sideInfantry, map }), {
  ok: false,
  reason: 'attack.reason.mgDirection',
}, 'a fixed-gun tank MG may not fire outside the hull-facing ray');
assert.strictEqual(selectTankMachineGun(attacker, 1, true), null,
  'hardcore MG selection must not invent a traversable coaxial gun on a fixed-gun tank');

const battleSceneSource = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'),
  'utf8',
);
assert.match(
  battleSceneSource,
  /private canWeaponAimDirection[\s\S]*?isTankUnit\(unit\)[\s\S]*?visionType === 'fixed'[\s\S]*?target === unit\.facing/,
  'the UI weapon-aim helper must restrict fixed-gun tanks to the hull-facing ray',
);
assert.match(
  battleSceneSource,
  /private fogTurretAimDirection[\s\S]*?canWeaponAimDirection[\s\S]*?private visibleTurretAimDirection[\s\S]*?canWeaponAimDirection/,
  'visible and fog turret-direction candidates must use the shared weapon arc',
);
assert.match(
  battleSceneSource,
  /private playerTurretCanRotate[\s\S]*?visionType === 'turreted'[\s\S]*?turretDamaged !== true/,
  'fixed-gun tanks must never qualify for the blue turret-rotation overlay',
);
assert.match(
  battleSceneSource,
  /if \(attackOrMisc[\s\S]*?&& this\.playerTurretCanRotate\(\)[\s\S]*?&& this\.hasTurretReconGunSelection\(\)\)/,
  'fixed-gun map clicks must bypass every rotation-only action that consumes a selected weapon die',
);
assert.match(
  battleSceneSource,
  /if \(attackOrMisc && enemiesOnTile\.length > 0\)[\s\S]*?if \(mgSel && legalMGTarget\)[\s\S]*?tryMGAttack[\s\S]*?if \(gunSel && legalMainGunTarget\)[\s\S]*?tryAttack/,
  'fixed-gun legal targets must still resolve through the normal MG and main-gun attack paths',
);

console.log('Fixed-gun tank weapon arc tests passed');
