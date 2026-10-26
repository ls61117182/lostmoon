const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, filename);

const grid = require('../assets/scripts/core/HexGrid.ts');
const combat = require('../assets/scripts/core/Combat.ts');
const fog = require('../assets/scripts/core/FogOfWar.ts');
const types = require('../assets/scripts/core/types.ts');
const GameSession = { gameMode: 'hardcore' };
const Scene = require('./helpers/BattleSceneMethods.cjs')([
  'redrawTurretAimOverlay', 'canMainGunReachTile', 'visibleTurretAimDirection',
  'fogTurretAimDirection', 'onTouchMap', 'tryAimShermanTurretAtFogTile',
], {
  ...grid, ...combat, ...fog, ...types, GameSession, UITransform: {},
  ...require('../assets/scripts/core/GameMode.ts'),
  ...require('../assets/scripts/core/Suppression.ts'),
});

function fixture() {
  const scene = new Scene();
  const map = new grid.HexMap(13, 13);
  for (let q = -6; q <= 6; q++) for (let r = -6; r <= 6; r++) {
    if (grid.hexDistance({ q: 0, r: 0 }, { q, r }) <= 6) map.set({ pos: { q, r }, terrain: 'field' });
  }
  const tank = { id: 'player', kind: 'sherman', faction: 'usa', pos: { q: 0, r: 0 },
    facing: 0, turretFacing: 3, loaded: true, loadedShell: 'ap',
    stats: { visionType: 'turreted', gunnerVisionRange: 4, turretTraverseSpeed: 6 } };
  const masks = new Set(), edges = new Set(), actions = [];
  Object.assign(scene, {
    mission: { sherman: tank, map, smokeHexes: new Set(), enemies: [], data: {} },
    phase: 'player', playerStep: 'attack', outcome: 'ongoing',
    selectedGunDieIdx: 0, selectedMGDieIdx: -1, selectedGunDoublesIdx: -1,
    selectedGunHitThresholdModifier: 0, phaseDice: [{ used: false }],
    outsideMapTurretInputNodes: [], turretAimOverlayNode: {},
    turretAimOverlayGraphics: { clear() { masks.clear(); edges.clear(); } },
    mapNode: { getComponent: () => null },
    playerTurretCanRotate: () => true, playerHasFixedWeaponArc: () => false,
    hasTurretReconGunSelection: () => true, playerWeaponTargetHexKeys: () => new Set(),
    isDeepShadowTile: () => false, isHexVisible: () => true, isUnitVisible: () => true,
    currentWeather: () => undefined, currentTurretFacingFor: () => tank.turretFacing,
    canWeaponAimDirection: () => true, canTurretReachDirection: () => true,
    project: (q, r) => ({ x: q, y: r }),
    drawTurretAimHex: (_g, q, r) => masks.add(`${q},${r}`),
    drawTurretAimBoundaryEdge: (_g, q, r, direction) => edges.add(`${q},${r}:${direction}`),
    outsideMapTurretAimPositions: () => [], directionScreenAngle: () => 0,
    drawTurretTraverseAngleRing() {}, isBusy: () => false, closeDiePopover() {},
    allUnits: () => [tank], playerMainGunTargets: () => [],
    canDirectlyAttackUrbanBuilding: () => false, canFireSmokeAt: () => false,
    hideTurretTargetOverlayForCommittedAction() {},
    startShermanTurretAimDirection(direction, done) { tank.turretFacing = direction; actions.push('rotate'); done(); },
    usePhaseDice(indices) { for (const i of indices) scene.phaseDice[i].used = true; },
    clearGunSelection() { scene.selectedGunDieIdx = -1; },
    refreshPhaseUI() {}, updateHUD() {}, redraw() {}, completePhaseDiceAction() {},
    openTileInspectModal() { actions.push('inspect'); }, tryAttack() { actions.push('fire'); },
    showGunAimWarning(reason) { actions.push(reason); },
  });
  return { scene, map, tank, masks, edges, actions };
}

for (const mode of ['hardcore', 'test']) {
  GameSession.gameMode = mode;
  for (const blocker of [{ terrain: 'forest' }, { terrain: 'rocky' }, { hasBuilding: true }, { smoke: true }]) {
    const { scene, map, masks, edges } = fixture();
    scene.redrawTurretAimOverlay();
    const clearEdges = new Set(edges);
    assert(masks.has('3,0'), 'clear firing rays are filled even before turning the turret');
    if (blocker.smoke) scene.mission.smokeHexes.add('1,0');
    else Object.assign(map.get({ q: 1, r: 0 }), blocker);
    for (const visible of [true, false]) {
      scene.isHexVisible = () => visible;
      scene.redrawTurretAimOverlay();
      assert(masks.has('1,0'), 'the blocker endpoint remains targetable');
      assert(!masks.has('2,0') && !masks.has('3,0'), 'blocked cells receive no blue fill, including shared visible cells');
      assert(masks.has('-2,0'), 'other clear directions retain their fill');
      assert.deepEqual(edges, clearEdges, 'occlusion must not change the firing-arc boundary or create internal edges');
    }
  }
}

GameSession.gameMode = 'hardcore';
{
  const { scene, map, masks, edges } = fixture();
  scene.redrawTurretAimOverlay();
  const clearEdges = new Set(edges);
  map.get({ q: 1, r: 0 }).terrain = 'forest';
  scene.redrawTurretAimOverlay();
  assert(masks.has('1,1'), 'a halfway ray can pass one obstructed flank');
  map.get({ q: 0, r: 1 }).terrain = 'forest';
  scene.redrawTurretAimOverlay();
  assert(!masks.has('1,1'), 'two obstructed flanks remove the halfway-ray fill');
  assert.deepEqual(edges, clearEdges, 'diagonal occlusion retains the complete boundary');
}

const point = { x: 0, y: 0 };
const event = { getStartLocation: () => point, getLocation: () => point };
for (const visible of [true, false]) for (const shell of ['ap', 'smoke']) {
  const { scene, map, tank, masks, actions } = fixture();
  map.get({ q: 1, r: 0 }).terrain = 'forest';
  tank.loadedShell = shell;
  scene.isHexVisible = () => visible;
  scene.pickTileAtScreenUi = () => map.get({ q: 3, r: 0 });
  scene.redrawTurretAimOverlay();
  assert(!masks.has('3,0'));
  scene.onTouchMap(event);
  assert.deepEqual(actions, ['rotate'], 'clicking an unfilled cell still rotates without firing');
  assert.equal(tank.turretFacing, 0);
  assert.equal(scene.phaseDice[0].used, true, 'rotation uses the selected action die');
  assert.equal(tank.loadedShell, shell, 'rotation retains the loaded shell');
}

{
  const { scene, map, tank, masks, actions } = fixture();
  map.get({ q: 1, r: 0 }).terrain = 'forest';
  const enemy = { ...tank, id: 'enemy', faction: 'german', pos: { q: 3, r: 0 } };
  scene.playerMainGunTargets = () => [enemy];
  scene.allUnits = () => [tank, enemy];
  scene.canPlayerMainGunAttack = target => combat.canAttack({
    attacker: tank, target, map, expandedTurretDirections: true,
  }).ok;
  scene.pickTileAtScreenUi = () => map.get(enemy.pos);
  scene.redrawTurretAimOverlay();
  assert(!masks.has('3,0'));
  scene.onTouchMap(event);
  assert.deepEqual(actions, ['rotate'], 'a shared visible enemy behind cover also permits rotation only');
}
// Shared radio vision must not enlarge either the blue area or its clickable range.
for (const mode of ['hardcore', 'test']) for (const visible of [true, false]) {
  GameSession.gameMode = mode;
  for (const [configuredRange, weather, range] of [[4, 'clear', 4], [2, 'clear', 2], [5, 'clear', 5], [4, 'fog', 2]]) {
    for (const shell of ['ap', 'smoke']) for (const occupied of [false, true]) {
      const { scene, map, tank, masks, edges, actions } = fixture();
      tank.gunnerVisionRange = configuredRange;
      tank.loadedShell = shell;
      scene.currentWeather = () => weather;
      scene.isHexVisible = () => visible;
      const target = { ...tank, id: 'distant-enemy', faction: 'german', pos: { q: range + 1, r: 0 } };
      scene.allUnits = () => occupied ? [tank, target] : [tank];
      scene.playerMainGunTargets = () => occupied ? [target] : [];
      scene.canPlayerMainGunAttack = () => false;
      scene.pickTileAtScreenUi = () => map.get(target.pos);
      scene.redrawTurretAimOverlay();
      assert(masks.has(`${range},0`), 'the last gunner-visible hex keeps its blue fill');
      assert(edges.has(`${range},0:0`), 'the blue boundary closes at the gunner range');
      for (const key of [...masks, ...edges].map(key => key.split(':')[0])) {
        const [q, r] = key.split(',').map(Number);
        assert(grid.hexDistance(tank.pos, { q, r }) <= range, 'no fill or boundary may originate beyond gunner range');
      }
      scene.onTouchMap(event);
      assert.deepEqual(actions, ['attack.reason.turretAimRange'], 'distant empty/enemy clicks cannot rotate, even with shared vision');
      assert.equal(tank.turretFacing, 3);
      assert.equal(scene.phaseDice[0].used, false);
      assert.equal(scene.selectedGunDieIdx, 0);
      assert.equal(tank.loadedShell, shell);
      actions.length = 0;
      scene.tryAimShermanTurretAtFogTile(0, target.pos);
      assert.deepEqual(actions, ['attack.reason.turretAimRange'], 'direct rotation callbacks must also reject distant targets');
      actions.length = 0;
      scene.pickTileAtScreenUi = () => map.get({ q: range, r: 0 });
      scene.onTouchMap(event);
      assert.deepEqual(actions, ['rotate'], 'clicks at the gunner range boundary still rotate');
      assert.equal(scene.phaseDice[0].used, true);
    }
  }
}
console.log('Main-gun occlusion, gunner-limited masks, boundaries and rotation tests passed');
