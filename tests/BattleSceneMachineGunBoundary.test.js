const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, filename);
const grid = require('../assets/scripts/core/HexGrid.ts');
const combat = require('../assets/scripts/core/Combat.ts');
const types = require('../assets/scripts/core/types.ts');
const GameSession = { gameMode: 'hardcore' };
const Scene = require('./helpers/BattleSceneMethods.cjs')([
  'redrawTurretAimOverlay', 'machineGunAimDirection', 'canTurretReachDirection',
  'turretTraverseSpeedFor', 'playerTurretCanRotate', 'playerHasFixedWeaponArc', 'canWeaponAimDirection',
], { ...grid, ...combat, ...types, ...require('../assets/scripts/core/FogOfWar.ts'),
  ...require('../assets/scripts/core/TurretTraverse.ts'), GameSession });

function fixture() {
  const scene = new Scene();
  const map = new grid.HexMap(7, 7);
  for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) {
    if (grid.hexDistance({ q: 0, r: 0 }, { q, r }) <= 3) map.set({ pos: { q, r }, terrain: 'field' });
  }
  const tank = { kind: 'sherman', pos: { q: 0, r: 0 }, facing: 0, turretFacing: 3,
    stats: { visionType: 'turreted', turretTraverseSpeed: 2 }, crew: { coDriver: true } };
  const masks = new Set(), edges = new Set();
  Object.assign(scene, {
    mission: { sherman: tank, map }, selectedGunDieIdx: -1, selectedMGDieIdx: 0,
    selectedGunHitThresholdModifier: 0, outsideMapTurretInputNodes: [], turretAimOverlayNode: {},
    turretAimOverlayGraphics: { clear() { masks.clear(); edges.clear(); } },
    hasTurretReconGunSelection: () => true, playerWeaponTargetHexKeys: () => new Set(),
    isDeepShadowTile: () => false, currentTurretFacingFor: unit => unit.turretFacing,
    currentWeather: () => undefined,
    project: (q, r) => ({ x: q, y: r }),
    drawTurretAimHex: (_g, q, r) => masks.add(`${q},${r}`),
    drawTurretAimBoundaryEdge: (_g, q, r, dir) => edges.add(`${q},${r}:${dir}`),
    outsideMapTurretAimPositions: () => [], directionScreenAngle: () => 0,
    drawTurretTraverseAngleRing() {},
  });
  return { scene, map, tank, masks, edges };
}

for (const mode of ['hardcore', 'test']) {
  GameSession.gameMode = mode;
  const { scene, tank, masks, edges } = fixture();
  for (let facing = 0; facing < 6; facing++) for (let turret = 0; turret < 12; turret++) {
    for (const speed of [0, 1, 2, 6]) for (const damaged of [false, true]) {
      Object.assign(tank, { facing, turretFacing: turret, turretDamaged: damaged });
      tank.stats.turretTraverseSpeed = speed;
      const frontKey = grid.HexMap.keyOf(grid.neighbor(tank.pos, facing));
      const canAimForward = damaged ? turret === facing : scene.canTurretReachDirection(tank, facing);
      tank.crew.coDriver = true;
      scene.redrawTurretAimOverlay();
      assert(masks.has(frontKey), 'operational hull MG always retains its forward fill');
      const withHullEdges = new Set(edges);
      if (!canAimForward) {
        assert(![...edges].some(key => key.startsWith(`${frontKey}:`)),
          'hull-only forward tile must not draw an enclosing blue boundary');
      }
      tank.crew.coDriver = false;
      scene.redrawTurretAimOverlay();
      assert.deepEqual(edges, withHullEdges,
        'adding independent hull-MG coverage must never enlarge the turret boundary');
      assert.equal(masks.has(frontKey), canAimForward,
        'without the hull MG, forward fill depends on coaxial reach');
    }
  }
}

// Reachable side tiles must draw their separating edge against the hull-only cell.
GameSession.gameMode = 'hardcore';
{
  const { scene, tank, masks, edges } = fixture();
  tank.turretFacing = 3;
  tank.stats.turretTraverseSpeed = 4;
  scene.redrawTurretAimOverlay();
  assert(masks.has('1,0'));
  assert(edges.has('0,1:5') && edges.has('1,-1:1'),
    'the perimeter turns inward on both sides of the excluded forward tile');
  tank.turretFacing = 1;
  scene.redrawTurretAimOverlay();
  assert([...edges].some(key => key.startsWith('1,0:')),
    'forward cell rejoins the perimeter when the turret can reach it');
}

GameSession.gameMode = 'classic';
{
  const { scene, masks, edges } = fixture();
  scene.redrawTurretAimOverlay();
  assert.equal(masks.size, 6, 'classic retains all six adjacent MG masks');
  for (const pos of grid.neighbors(scene.mission.sherman.pos)) {
    assert([...edges].some(key => key.startsWith(`${grid.HexMap.keyOf(pos)}:`)),
      'classic retains the complete MG perimeter');
  }
}
console.log('Machine-gun turret boundary and independent hull-MG fill tests passed');
