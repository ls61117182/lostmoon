const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, filename);

const rules = Object.assign({}, ...['HexGrid', 'FogOfWar', 'Combat', 'types', 'GameMode', 'EnemyAI', 'Suppression', 'Ambush']
  .map(name => require(`../assets/scripts/core/${name}.ts`)));
const GameSession = { gameMode: 'hardcore' };
const Scene = require('./helpers/BattleSceneMethods.cjs')([
  'canPlayerMainGunAttack', 'selectAIShootTarget', 'selectAIMGTarget',
  'canAIMainGunResolveSelectedTarget', 'tryAIMGAttack', 'tankMachineGunContext', 'tryAttack', 'tryMGAttack',
], { ...rules, GameSession, t: key => key, Color: class {} });

function fixture(weather = 'fog', distance = 4) {
  GameSession.gameMode = 'hardcore';
  const map = new rules.HexMap(13, 13);
  for (let q = -6; q <= 6; q++) for (let r = -6; r <= 6; r++) map.set({ pos: { q, r }, terrain: 'field' });
  const attacker = { id: 'shooter', kind: 'sherman', faction: 'usa', pos: { q: 0, r: 0 },
    facing: 0, turretFacing: 0, hatchOpen: true, visionRange: 4, gunnerVisionRange: 4, interiorVisionRange: 0,
    loaded: true, loadedShell: 'ap', crew: { commander: true, gunner: true, loader: true, driver: true, coDriver: true },
    stats: { hasRadio: true, visionType: 'turreted', turretTraverseSpeed: 6 } };
  const sender = { ...attacker, id: 'sender', pos: { q: distance - 1, r: 0 } };
  const target = { ...attacker, id: 'target', kind: 'panzer4', faction: 'german', pos: { q: distance, r: 0 } };
  const scene = new Scene();
  Object.assign(scene, { mission: { map, sherman: attacker, smokeHexes: new Set(), data: { weather } },
    outcome: 'ongoing', currentWeather: () => weather,
    playerStep: 'attack', selectedGunDieIdx: 0, selectedMGDieIdx: 0, phaseDice: [{ used: false }],
    battleLogI18n() {}, spawnFloater() {},
    isUnitVisible: unit => rules.computePlayerVisibleHexes(map, attacker, [sender], true, weather, scene.mission.smokeHexes)
      .has(rules.HexMap.keyOf(unit.pos)),
    allUnits: () => [attacker, sender, target],
    canTurretReachDirection: () => true, turretTargetDirection: () => 0,
    campaignMainGunHitThresholdModifier: () => 0, playerMainGunHitThresholdModifierDetails: () => [],
    selectedGunHitThresholdModifier: 0, isHardcoreInfantryActor: () => false,
    aiMissionTargetsFor: () => [], aiTargetsFor: () => [target], aiFriendliesFor: () => [sender],
    tankMachineGunSelection: () => ({ weapon: 'both', rotateTurret: false }),
  });
  const context = () => ({ attacker, target, map, weather, smokeHexes: scene.mission.smokeHexes,
    requireOwnVision: true, expandedTurretDirections: true, shellType: attacker.loadedShell });
  return { scene, map, attacker, sender, target, context };
}

test('shared distant targets stay visible but cannot be shot by players or AI in any weather', () => {
  for (const weather of ['clear', 'rain', 'light_snow', 'heavy_snow', 'fog']) {
    const { scene, attacker, target, map } = fixture(weather, 5);
    assert(!rules.computeUnitVisibleHexes(map, attacker, weather).has('5,0'));
    assert(scene.isUnitVisible(target), weather);
    assert.equal(scene.canPlayerMainGunAttack(target), false, weather);
    assert.equal(scene.selectAIShootTarget(attacker, false), null, weather);
    assert.equal(scene.canAIMainGunResolveSelectedTarget(attacker, target), false, weather);
    scene.tryAttack(target);
    assert.equal(scene.phaseDice[0].used, false, 'rejected fire cannot spend an action die');
    assert.equal(attacker.loaded, true, 'rejected fire cannot consume the loaded shell');
  }
});

test('fog permits AP/HVAP/HE fire inside own sight, including after an intact turret aims', () => {
  for (const shell of ['ap', 'hvap', 'he']) {
    const { scene, attacker, target } = fixture('fog', 2);
    attacker.loadedShell = shell;
    attacker.hatchOpen = false;
    attacker.turretFacing = 3;
    assert(!rules.computeUnitVisibleHexes(scene.mission.map, attacker, 'fog').has('2,0'));
    assert.equal(scene.canPlayerMainGunAttack(target), true, shell);
    assert.equal(scene.selectAIShootTarget(attacker, false), target, shell);
    assert.equal(attacker.turretFacing, 3, 'previewing aimed sight must not mutate the turret');
    target.pos = { q: 3, r: 0 };
    assert(scene.isUnitVisible(target));
    assert.equal(scene.canPlayerMainGunAttack(target), false, shell);
    assert.equal(scene.selectAIShootTarget(attacker, false), null, shell);
  }
});

test('fog smoke blocks outward fire and fire into a shared smoky target hex', () => {
  for (const key of ['0,0', '1,0']) {
    const { scene, attacker, target, sender, context } = fixture('fog', 1);
    sender.pos = key === '1,0' ? { ...target.pos } : { q: 2, r: 0 };
    scene.mission.smokeHexes.add(key);
    assert(scene.isUnitVisible(target), 'radio intelligence remains visible');
    assert.equal(scene.canPlayerMainGunAttack(target), false);
    assert.equal(scene.selectAIShootTarget(attacker, false), null);
    target.kind = 'german_infantry';
    target.stats = { ...target.stats, visionType: 'infantry' };
    assert.equal(rules.canMGAttack(context()).ok, false);
    assert.equal(scene.selectAIMGTarget(attacker, false), null);
    assert.equal(scene.tryAIMGAttack(attacker, target), false, 'a preselected MG target cannot bypass sight checks');
    scene.tryMGAttack(target);
    assert.equal(scene.phaseDice[0].used, false, 'rejected MG fire cannot spend an action die');
    scene.mission.smokeHexes.clear();
    assert.equal(rules.canMGAttack(context()).ok, true);
    assert.equal(scene.selectAIMGTarget(attacker, false), target);
  }
});

test('radio cannot bypass intermediate terrain or smoke even within direct sight range', () => {
  const { scene, map, attacker, target, sender } = fixture('fog', 2);
  sender.pos = { q: 3, r: 0 };
  for (const smoke of [false, true]) {
    map.get({ q: 1, r: 0 }).terrain = smoke ? 'field' : 'forest';
    scene.mission.smokeHexes = new Set(smoke ? ['1,0'] : []);
    assert(scene.isUnitVisible(target));
    assert.equal(scene.canPlayerMainGunAttack(target), false);
    assert.equal(scene.selectAIShootTarget(attacker, false), null);
  }
});

test('classic shooting and smoke-shell placement retain their existing rules', () => {
  const { scene, context, attacker } = fixture();
  GameSession.gameMode = 'classic';
  assert.equal(scene.canPlayerMainGunAttack(scene.aiTargetsFor()[0]), true);
  assert.equal(rules.canAttack({ ...context(), requireOwnVision: false }).ok, true);
  scene.mission.smokeHexes.add('0,0');
  attacker.loadedShell = 'smoke';
  assert.equal(rules.canAttack(context()).ok, true, 'smoke shells can still be placed without observing an enemy');
});
