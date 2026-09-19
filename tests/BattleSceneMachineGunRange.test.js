const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, filename);
const { HexMap, hexDistance, fireDirectionTo, neighbor } = require('../assets/scripts/core/HexGrid.ts');
const { MG_MAX_RANGE, selectTankMachineGun, canMGAttack } = require('../assets/scripts/core/Combat.ts');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/scripts/view/BattleScene.ts'), 'utf8');
function method(name) {
  const start = source.indexOf(`  private ${name}(`);
  return source.slice(start, source.indexOf('\n  private ', start + 1));
}
const code = ts.transpileModule(`class Harness { ${method('machineGunAimDirection')} ${method('tryAimShermanTurretAtFogTile')} }`, {}).outputText;
const Harness = new Function('hexDistance', 'fireDirectionTo', 'MG_MAX_RANGE', 'selectTankMachineGun', 'GameSession', `${code}; return Harness;`)(hexDistance, fireDirectionTo, MG_MAX_RANGE, selectTankMachineGun, { gameMode: 'hardcore' });
const scene = new Harness();
const map = new HexMap(7, 7);
for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) map.set({ pos: { q, r }, terrain: 'field' });
const tank = { kind: 'sherman', pos: { q: 0, r: 0 }, facing: 0, turretFacing: 3, stats: { visionType: 'turreted' } };
scene.mission = { sherman: tank, map };
scene.isDeepShadowTile = () => false;
scene.currentTurretFacingFor = unit => unit.turretFacing;
scene.canTurretReachDirection = () => true;
scene.playerTurretCanRotate = () => !tank.turretDamaged;
scene.selectedMGDieIdx = 0;
scene.phaseDice = [{ used: false }];
for (let dir = 0; dir < 6; dir++) assert.equal(scene.machineGunAimDirection(neighbor(tank.pos, dir)), dir);
assert.equal(scene.machineGunAimDirection(tank.pos), null);
assert.equal(scene.machineGunAimDirection({ q: 2, r: 0 }), null);
// Invalid rotation must return before touching animation, selection, or dice.
scene.tryAimShermanTurretAtFogTile(0, { q: 2, r: 0 }, true);
assert.equal(scene.phaseDice[0].used, false);
tank.turretDamaged = true;
for (let turret = 0; turret < 12; turret++) {
  tank.turretFacing = turret;
  for (let dir = 0; dir < 6; dir++) {
    const allowed = dir === 0 || dir === turret;
    const pos = neighbor(tank.pos, dir);
    assert.equal(scene.machineGunAimDirection(pos), allowed ? dir : null, `turret ${turret}, target ${dir}`);
    const selection = selectTankMachineGun(tank, dir, false);
    const target = { kind: 'infantry', pos, stats: { visionType: 'infantry' } };
    assert.equal(canMGAttack({ attacker: tank, target, map, hardcoreTankMachineGuns: true,
      expandedTurretDirections: true, tankMachineGun: selection?.weapon }).ok, allowed);
  }
}
scene.tryAimShermanTurretAtFogTile(0, { q: 1, r: 0 }, true);
assert.equal(scene.phaseDice[0].used, false);
console.log('Machine-gun range and damaged turret direction tests passed');
