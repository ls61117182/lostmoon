const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const grid = require('../assets/scripts/core/HexGrid.ts');
const combat = require('../assets/scripts/core/Combat.ts');
const traverse = require('../assets/scripts/core/TurretTraverse.ts');
const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/view/BattleScene.ts'), 'utf8');
const ast = ts.createSourceFile('BattleScene.ts', source, ts.ScriptTarget.Latest, true);
const cls = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'BattleScene');
const names = ['turretTraverseSpeedFor', 'canClassicMainGunReachTile', 'canTurretReachDirection',
  'gunActionUnavailable', 'outsideMapTurretAimDirection', 'redrawTurretAimOverlay', 'onTouchMap',
  'tryAimShermanTurretAtFogTile', 'machineGunAimDirection', 'mgActionUnavailable',
  'canWeaponAimDirection', 'tryMGAttack', 'startShermanTurretAim', 'startShermanTurretAimDirection'];
const code = ts.transpile(`class Scene { ${names.map(name => cls.members.find(n => n.name?.getText(ast) === name).getText(ast)).join('\n')} }`, { target: ts.ScriptTarget.ES2020 });
const GameSession = { gameMode: 'classic' };
const deps = { ...grid, ...combat, ...traverse, ...require('../assets/scripts/core/Suppression.ts'), GameSession,
  ...require('../assets/scripts/core/FogOfWar.ts'),
  ...require('../assets/scripts/core/GameMode.ts'),
  ...require('../assets/scripts/core/LockedFire.ts'),
  isTankUnit: require('../assets/scripts/core/types.ts').isTankUnit,
  isMainGunLoaded: u => u.loaded, t: key => key, UITransform: {},
};
const Scene = new Function(...Object.keys(deps), `${code}; return Scene;`)(...Object.values(deps));
const scene = new Scene();
const map = new grid.HexMap(9, 9);
for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) {
  if (grid.hexDistance({ q: 0, r: 0 }, { q, r }) <= 3) map.set({ pos: { q, r }, terrain: 'field' });
}
const tank = { id: 'player', kind: 'sherman', faction: 'usa', pos: { q: 0, r: 0 },
  facing: 0, turretFacing: 0, loaded: true, stats: { visionType: 'turreted', turretTraverseSpeed: 0 } };
let masks = [], rings = 0, shots = 0, rotations = 0, consumed = 0;
Object.assign(scene, {
  mission: { sherman: tank, map, smokeHexes: new Set(), enemies: [], data: {} },
  phase: 'player', playerStep: 'attack', outcome: 'ongoing', mapNode: { getComponent: () => null },
  selectedGunDieIdx: 0, selectedMGDieIdx: -1, selectedGunHitThresholdModifier: 0,
  turretAimOverlayGraphics: { clear() {} }, turretAimOverlayNode: {}, outsideMapTurretInputNodes: [],
  playerTurretCanRotate: () => true, playerHasFixedWeaponArc: () => false,
  hasTurretReconGunSelection: () => true, playerWeaponTargetHexKeys: () => new Set(),
  isDeepShadowTile: () => false, currentWeather: () => undefined, currentTurretFacingFor: () => tank.turretFacing,
  project: (q, r) => ({ x: q, y: r }), drawTurretAimHex: (_g, q, r) => masks.push(`${q},${r}`),
  drawTurretAimBoundaryEdge() {}, drawTurretTraverseAngleRing: () => rings++,
  outsideMapTurretAimPositions: () => { throw Error('classic must not show off-map selectors'); },
  isBusy: () => false, closeDiePopover() {}, isHexVisible: () => true, isUnitVisible: () => true,
  allUnits: () => [tank], playerMainGunTargets: () => [], canDirectlyAttackUrbanBuilding: () => false,
  tryAttack: () => shots++, startShermanTurretAimDirection: () => rotations++, usePhaseDice: () => consumed++,
});
assert.equal(scene.gunActionUnavailable(), null, 'no enemies must not disable the gun button');
for (let direction = 0; direction < 6; direction++) assert.equal(scene.canTurretReachDirection(tank, direction), true);
scene.redrawTurretAimOverlay();
assert.equal(masks.length, 18, 'six firing rays, each three cells long');
assert.equal(rings, 0, 'classic has no traverse-speed ring');
assert(!masks.includes('1,1'), 'between-axis cells are excluded');
assert.equal(scene.outsideMapTurretAimDirection({ q: 4, r: 0 }), null);
map.get({ q: 1, r: 0 }).terrain = 'forest';
masks = []; scene.redrawTurretAimOverlay();
assert(!masks.includes('2,0'), 'terrain blocks cells beyond it');
assert(!masks.includes('3,0'));
map.get({ q: 1, r: 0 }).terrain = 'field';
const click = { x: 0, y: 0 };
const event = { getStartLocation: () => click, getLocation: () => click };
scene.pickTileAtScreenUi = () => map.get({ q: -1, r: 0 });
scene.onTouchMap(event);
scene.tryAimShermanTurretAtFogTile(3, { q: -1, r: 0 });
assert.equal(rotations, 0, 'empty blue-cell clicks must not turn the turret');
assert.equal(consumed, 0, 'empty blue-cell clicks must not consume dice');
assert.equal(scene.selectedGunDieIdx, 0, 'selection stays active');
const enemy = { ...tank, id: 'enemy', faction: 'german', pos: { q: -1, r: 0 } };
scene.playerMainGunTargets = () => [enemy]; scene.allUnits = () => [tank, enemy];
scene.canPlayerMainGunAttack = target => combat.canAttack({ attacker: tank, target, map }).ok;
scene.onTouchMap(event);
assert.equal(shots, 1, 'an actual legal target still fires normally');
GameSession.gameMode = 'hardcore';
assert.equal(scene.canTurretReachDirection(tank, 3), false, 'hardcore keeps configured traverse limits');
assert.equal(scene.gunActionUnavailable(), null, 'hardcore keeps recon selection available');
console.log('Classic main-gun coverage and input tests passed');

// Classic MG coverage is independent of turret damage, heading, and traverse speed.
GameSession.gameMode = 'classic';
scene.selectedGunDieIdx = -1;
scene.selectedMGDieIdx = 0;
scene.phaseDice = [{ used: false }];
scene.tankMachineGunSelection = () => null;
scene.tankMachineGunContext = () => ({});
scene.turretTargetDirection = (_unit, target) => grid.fireDirectionTo(tank.pos, target.pos);
scene.hideTurretTargetOverlayForCommittedAction = () => {};
scene.updateHUD = () => {};
scene.redraw = () => {};
scene.enemySupportsSplitTurret = () => false;
delete scene.startShermanTurretAimDirection;
scene.playerMainGunTargets = () => [];
scene.allUnits = () => [tank];
scene.pickTileAtScreenUi = () => map.get({ q: 0, r: 1 });
let mgShots = 0;
const attack = Scene.prototype.tryMGAttack;
scene.tryMGAttack = (target, aimed) => {
  if (aimed) { mgShots++; return; }
  return attack.call(scene, target, aimed);
};
for (const damaged of [false, true]) {
  tank.turretDamaged = damaged;
  masks = [];
  scene.redrawTurretAimOverlay();
  assert.equal(masks.length, 6, 'classic MG mask includes all six adjacent cells');
  assert.equal(scene.mgActionUnavailable(), null, 'MG remains selectable without infantry');
  const facingBefore = tank.turretFacing;
  scene.onTouchMap(event);
  scene.tryAimShermanTurretAtFogTile(1, { q: 0, r: 1 }, true);
  assert.equal(tank.turretFacing, facingBefore, 'empty MG cells do not rotate the turret');
  assert.equal(consumed, 0);
  assert.equal(scene.selectedMGDieIdx, 0);
  assert.equal(mgShots, 0);
}
for (let direction = 0; direction < 6; direction++) {
  const pos = grid.neighbor(tank.pos, direction);
  const infantry = { id: 'infantry', kind: 'infantry', faction: 'german', pos, stats: { visionType: 'infantry' } };
  tank.turretFacing = (direction + 3) % 6;
  scene.shermanTurretFacing = tank.turretFacing;
  assert.equal(combat.canMGAttack({ attacker: tank, target: infantry, map }).ok, true,
    'classic damaged turret may attack infantry in every adjacent direction');
  scene.playerMainGunTargets = () => [infantry];
  scene.allUnits = () => [tank, infantry];
  scene.pickTileAtScreenUi = () => map.get(pos);
  scene.onTouchMap(event);
  assert.equal(tank.turretFacing, direction, 'damaged turret still aims toward the chosen classic MG target');
  assert.equal(mgShots, direction + 1);
}
assert.equal(combat.canMGAttack({ attacker: tank, target: { kind: 'infantry', pos: { q: 2, r: 0 } }, map }).ok, false,
  'classic MG range remains one cell');
console.log('Classic machine-gun coverage, damage and target-only aim tests passed');
