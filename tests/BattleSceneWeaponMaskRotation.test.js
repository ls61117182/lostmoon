const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/view/BattleScene.ts'), 'utf8');
const start = source.indexOf('  private onTouchMap(');
assert.notEqual(start, -1);
const method = source.slice(start, source.indexOf('\n  private ', start + 1));
const code = ts.transpileModule(`class Harness { ${method} }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const GameSession = { gameMode: 'hardcore', isPvp: false };
const Harness = new Function(
  'UITransform', 'GameSession', 'canMGAttack', 'getGameModeConfig',
  'selectMainGunTargetsByHex', 'fireDirectionTo', 'isMainGunLoaded', 'resolvedLoadedShell',
  `${code}; return Harness;`,
)(
  {}, GameSession, ({ target }) => ({ ok: target.legal }),
  () => ({ expandedTurretDirections: true }), units => units,
  () => 2, () => true, () => 'he',
);

const targetTile = { pos: { q: -1, r: 1 } };
const tank = { pos: { q: 0, r: 0 } };
const friend = { id: 'friend', pos: targetTile.pos, legal: true };
const illegalEnemy = { id: 'tank-enemy', pos: targetTile.pos, legal: false };
const legalEnemy = { id: 'infantry-enemy', pos: targetTile.pos, legal: true };
const event = {
  getStartLocation: () => ({ x: 0, y: 0 }),
  getLocation: () => ({ x: 0, y: 0 }),
};

function click(units, enemies, weapon = 'mg') {
  const scene = new Harness();
  const actions = [];
  Object.assign(scene, {
    mission: { sherman: tank, map: {}, data: {} },
    mapNode: { getComponent: () => null },
    phase: 'player', playerStep: 'attack', outcome: 'ongoing',
    selectedMGDieIdx: weapon === 'mg' ? 0 : -1,
    selectedGunDieIdx: weapon === 'gun' ? 0 : -1,
    selectedGunHitThresholdModifier: 0,
    isBusy: () => false,
    pickTileAtScreenUi: () => targetTile,
    closeDiePopover: () => {},
    isHexVisible: () => true,
    allUnits: () => [tank, ...units],
    isUnitVisible: () => true,
    playerMainGunTargets: () => enemies,
    machineGunAimDirection: () => 2,
    canPlayerMainGunAttack: target => target.legal,
    canDirectlyAttackUrbanBuilding: () => false,
    currentWeather: () => 'clear',
    tankMachineGunContext: () => ({}),
    tankMachineGunSelection: () => ({ weapon: 'coaxial' }),
    playerTurretCanRotate: () => true,
    hasTurretReconGunSelection: () => true,
    canWeaponAimDirection: () => true,
    canTurretReachDirection: () => true,
    tryAimShermanTurretAtFogTile: (direction, pos, useMG) => actions.push({ kind: 'rotate', direction, pos, useMG }),
    tryMGAttack: target => actions.push({ kind: 'mg', target }),
    tryAttack: target => actions.push({ kind: 'gun', target }),
    openTileInspectModal: () => actions.push({ kind: 'inspect' }),
  });
  scene.onTouchMap(event);
  return actions;
}

for (const [name, units, enemies] of [
  ['empty tile', [], []],
  ['friendly tile', [friend], []],
  ['illegal enemy tile', [illegalEnemy], [illegalEnemy]],
  ['mixed tile without a legal target', [friend, illegalEnemy], [illegalEnemy]],
]) {
  assert.deepEqual(click(units, enemies), [
    { kind: 'rotate', direction: 2, pos: targetTile.pos, useMG: true },
  ], `${name} should rotate the turret when MG has no legal target`);
}
assert.deepEqual(click([friend, legalEnemy], [legalEnemy]), [
  { kind: 'mg', target: legalEnemy },
], 'a legal enemy must retain priority over rotation');
assert.deepEqual(click([friend], [], 'gun'), [
  { kind: 'rotate', direction: 2, pos: targetTile.pos, useMG: false },
], 'ordinary main-gun selection should also rotate on a friendly tile');

console.log('BattleScene weapon-mask rotation tests passed');
