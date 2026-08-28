const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

const previousTsLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

try {
  const { RNG } = require('../assets/scripts/core/Dice.ts');
  const { currentTargetFor, hardcoreTankAIDiceCount } = require('../assets/scripts/core/EnemyAI.ts');
  const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
  const {
    crewLevelFor,
    normalizePlayerCrewLevels,
    normalizeUnitLevel,
    atGunActionDiceBonus,
    infantryTurnActions,
    nonPlayerTankDiceBonus,
    unitLevelHitThresholdModifier,
    unitLevelOf,
  } = require('../assets/scripts/core/UnitLevel.ts');
  const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');

  const crew = { commander: true, loader: true, gunner: true, driver: true, coDriver: true };
  const tank = (id, faction, q, unitLevel) => ({
    id,
    kind: id === 'hero' || id === 'sherman_player' ? 'sherman' : 'panzer4',
    faction,
    pos: { q, r: 0 },
    facing: 0,
    stats: { faction, visionRange: 4, mobility: 3 },
    crew: { ...crew },
    unitLevel,
  });

  const hero = tank('hero', 'usa', 5);
  const nearbyAlly = tank('nearby', 'usa', 1);
  const actor = tank('actor', 'german', 0, 'recruit');

  assert.strictEqual(
    currentTargetFor(actor, [hero, nearbyAlly], [hero], new RNG(1)),
    nearbyAlly,
    'recruit enemies must choose the nearest hostile unit',
  );
  actor.unitLevel = 'veteran';
  assert.strictEqual(
    currentTargetFor(actor, [hero, nearbyAlly], [hero], new RNG(1)),
    nearbyAlly,
    'veteran enemies use the same nearest-target rule as recruits',
  );
  actor.unitLevel = 'elite';
  assert.strictEqual(
    currentTargetFor(actor, [hero, nearbyAlly], [hero], new RNG(1)),
    hero,
    'elite enemies must prioritize the protagonist',
  );

  const friendlyActor = tank('friendly-ai', 'usa', 0, 'recruit');
  const nearbyEnemy = tank('nearby-enemy', 'german', 1, 'recruit');
  const farMissionTarget = tank('mission-target', 'german', 5, 'recruit');
  assert.strictEqual(
    currentTargetFor(friendlyActor, [nearbyEnemy, farMissionTarget], [farMissionTarget], new RNG(1)),
    farMissionTarget,
    'friendly AI must retain mission-target priority',
  );

  const player = tank('sherman_player', 'usa', 0);
  player.crewLevels = normalizePlayerCrewLevels({ commander: 'elite', gunner: 'veteran' });
  assert.strictEqual(crewLevelFor(player, 'commander'), 'elite');
  assert.strictEqual(crewLevelFor(player, 'gunner'), 'veteran');
  assert.strictEqual(crewLevelFor(player, 'loader'), 'recruit');
  actor.unitLevel = 'veteran';
  for (const slot of ['commander', 'loader', 'gunner', 'driver', 'coDriver']) {
    assert.strictEqual(crewLevelFor(actor, slot), 'veteran', `NPC ${slot} must inherit unit level`);
  }
  assert.strictEqual(normalizeUnitLevel('invalid'), 'recruit');

  actor.unitLevel = 'veteran';
  assert.deepStrictEqual(nonPlayerTankDiceBonus(actor), { attack: 1, move: 1, misc: 0 });
  actor.unitLevel = 'elite';
  assert.deepStrictEqual(nonPlayerTankDiceBonus(actor), { attack: 2, move: 1, misc: 1 });
  const recruitDice = hardcoreTankAIDiceCount({ ...actor, unitLevel: 'recruit' }, 'clear');
  const eliteDice = hardcoreTankAIDiceCount(actor, 'clear');
  const minimumDice = hardcoreTankAIDiceCount({
    ...actor,
    unitLevel: 'recruit',
    stats: { ...actor.stats, mobility: 0 },
    crew: { ...actor.crew, commander: false, driver: false },
  }, 'road');
  assert.deepStrictEqual(minimumDice, { attack: 1, move: 1, misc: 1 },
    'hardcore tanks must always receive at least one die of every type');
  assert.deepStrictEqual({
    attack: eliteDice.attack - recruitDice.attack,
    move: eliteDice.move - recruitDice.move,
    misc: eliteDice.misc - recruitDice.misc,
  }, { attack: 2, move: 1, misc: 1 });

  const infantry = { ...actor, kind: 'german_infantry', crew: undefined, unitLevel: 'veteran' };
  assert.deepStrictEqual(infantryTurnActions(infantry), ['attack_or_move', 'move']);
  infantry.unitLevel = 'elite';
  assert.deepStrictEqual(infantryTurnActions(infantry), ['attack_or_move', 'attack_or_move']);
  const atGun = {
    ...actor,
    id: 'ranked-at-gun',
    kind: 'at_gun',
    crew: undefined,
    unitLevel: undefined,
    atGunCrewLevel: 'elite',
    atGunCrewAlive: true,
  };
  assert.strictEqual(unitLevelOf(atGun), 'elite');
  assert.strictEqual(atGunActionDiceBonus(atGun), 2);
  assert.strictEqual(unitLevelHitThresholdModifier(atGun, nearbyAlly), -1);
  assert.strictEqual(unitLevelHitThresholdModifier(infantry, nearbyAlly), 1);
  assert.strictEqual(unitLevelHitThresholdModifier(nearbyAlly, infantry), 1);
  assert.strictEqual(unitLevelHitThresholdModifier(actor, nearbyAlly), -1);
  assert.strictEqual(unitLevelHitThresholdModifier(nearbyAlly, actor), 1);
  actor.unitLevel = 'veteran';

  const testMissionData = JSON.parse(fs.readFileSync(
    'assets/resources/missions/mission_test.json',
    'utf8',
  ));
  const loadedTestMission = loadMission(testMissionData, new RNG(123));
  assert.deepStrictEqual(
    loadedTestMission.enemies.map(unit => unit.unitLevel),
    ['veteran', 'elite'],
    'dice-based spawning must preserve configured unit levels',
  );

  const mission = {
    data: { theater: 'europe' },
    sherman: player,
    allies: [],
    enemies: [actor, atGun],
    smokeHexes: new Set(),
    smokeHexOwners: new Map(),
  };
  const save = JSON.parse(JSON.stringify(captureSave({
    gameMode: 'classic',
    missionId: 'unit_level_test',
    mission,
    turn: 1,
    phase: 'player',
    movesLeft: 0,
    attacksLeft: 0,
    miscDone: false,
    playerStep: 'choose',
    hatchChangedThisTurn: false,
    phaseDice: [],
  })));
  player.crewLevels.commander = 'recruit';
  actor.unitLevel = 'recruit';
  atGun.atGunCrewLevel = 'recruit';
  const restored = applySave(mission, 'unit_level_test', save);
  assert.strictEqual(restored.ok, true);
  assert.strictEqual(player.crewLevels.commander, 'elite');
  assert.strictEqual(actor.unitLevel, 'veteran');
  assert.strictEqual(atGun.unitLevel, undefined);
  assert.strictEqual(atGun.atGunCrewLevel, 'elite');

  console.log('unit level system tests passed');
} finally {
  if (previousTsLoader) require.extensions['.ts'] = previousTsLoader;
  else delete require.extensions['.ts'];
}
