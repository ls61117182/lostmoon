const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, filename);

const rules = Object.assign({}, ...['HexGrid', 'FogOfWar', 'Combat', 'TankRiding', 'types',
  'GameMode', 'Suppression', 'Ambush', 'LockedFire']
  .map(name => require(`../assets/scripts/core/${name}.ts`)));
const GameSession = { gameMode: 'hardcore' };
const Scene = require('./helpers/BattleSceneMethods.cjs')([
  'canPlayerMainGunAttack', 'turretTargetDirection', 'startShermanTurretAim',
  'startShermanTurretAimDirection',
], { ...rules, GameSession });

function fixture() {
  const map = new rules.HexMap(13, 13);
  for (let q = -6; q <= 6; q++) for (let r = -6; r <= 6; r++) {
    map.set({ pos: { q, r }, terrain: 'field' });
  }
  const attacker = {
    id: 'player', kind: 'sherman', faction: 'usa', pos: { q: 0, r: 0 },
    facing: 4, turretFacing: 8, previousTurretFacing: 2, diagonalGunnerSidePreference: 2,
    hatchOpen: false, gunnerVisionRange: 4, interiorVisionRange: 1,
    loaded: true, loadedShell: 'ap', stats: { visionType: 'turreted', turretTraverseSpeed: 6 },
  };
  const target = { ...attacker, id: 'target', kind: 'panzer3', faction: 'german', pos: { q: -3, r: 1 } };
  const scene = new Scene();
  Object.assign(scene, {
    mission: { map, sherman: attacker, smokeHexes: new Set(), data: { theater: 'europe' } },
    currentWeather: () => 'clear', isUnitVisible: () => true,
    canTurretReachDirection: () => true, enemySupportsSplitTurret: () => false,
    campaignMainGunHitThresholdModifier: () => 0, playerMainGunHitThresholdModifierDetails: () => [],
    selectedGunHitThresholdModifier: 0, redraw() {},
  });
  const context = () => ({ attacker, target, map, smokeHexes: scene.mission.smokeHexes,
    weather: 'clear', expandedTurretDirections: true, requireOwnVision: true, shellType: attacker.loadedShell });
  return { scene, map, attacker, target, context };
}

test('both visible diagonal flanks are selectable without changing the current view', () => {
  for (const mode of ['hardcore', 'test']) for (const shell of ['ap', 'hvap', 'he']) {
    GameSession.gameMode = mode;
    const { scene, attacker, target, context } = fixture();
    attacker.loadedShell = shell;
    const before = JSON.stringify(attacker);
    for (const pos of [{ q: -3, r: 1 }, { q: -3, r: 2 }]) {
      target.pos = pos;
      assert.equal(rules.canAttack(context()).ok, true, `${mode}/${shell}/${JSON.stringify(pos)}`);
      assert.equal(scene.canPlayerMainGunAttack(target), true);
      assert.equal(JSON.stringify(attacker), before, 'preview must preserve the current view and loaded shell');
    }
  }
});

test('committing an attack switches gunner sight to its flank, including another target on the same heading', () => {
  const { scene, map, attacker, target } = fixture();
  const sees = pos => rules.computeUnitVisibleHexes(map, attacker).has(rules.HexMap.keyOf(pos));
  const upper = { q: -3, r: 1 }, lower = { q: -3, r: 2 };
  assert.equal(sees(upper), false);
  assert.equal(sees(lower), true);
  for (const [pos, side, other] of [[upper, 3, lower], [lower, 2, upper]]) {
    target.pos = pos;
    let completed = false;
    scene.startShermanTurretAim(target, () => {
      completed = true;
      assert.equal(attacker.diagonalGunnerSidePreference, side);
      assert.equal(sees(pos), true, 'the firing callback must see the attacked flank');
      assert.equal(sees(other), false, 'switching sides must retain a single gunner path');
    });
    assert.equal(completed, true);
    assert.equal(attacker.turretFacing, 8);
  }
});

test('switching flanks still respects terrain, smoke, elevation, range and turret damage', () => {
  for (const blocker of ['terrain', 'smoke', 'height', 'range', 'damage']) {
    const { scene, map, attacker, context } = fixture();
    if (blocker === 'terrain') map.get({ q: -1, r: 0 }).terrain = 'forest';
    if (blocker === 'smoke') scene.mission.smokeHexes.add('-1,0');
    if (blocker === 'height') map.get({ q: -3, r: 1 }).height = 1;
    if (blocker === 'range') attacker.gunnerVisionRange = 2;
    if (blocker === 'damage') attacker.turretDamaged = true;
    const before = JSON.stringify(attacker);
    assert.equal(rules.canAttack(context()).ok, false, blocker);
    assert.equal(JSON.stringify(attacker), before);
  }
});
