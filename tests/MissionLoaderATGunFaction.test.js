const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = function transpileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  module._compile(output, filename);
};

const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { liveEnemyCount } = require('../assets/scripts/core/Objective.ts');
const { applySave, captureSave } = require('../assets/scripts/core/SaveLoad.ts');

function missionWithGun(theater, faction) {
  const mission = JSON.parse(fs.readFileSync('assets/resources/missions/mission_03.json', 'utf8'));
  mission.id = `at_gun_faction_${theater}_${faction ?? 'default'}`;
  mission.theater = theater;
  mission.enemyStartByDice = false;
  mission.enemies = [{
    kind: 'at_gun',
    ...(faction ? { faction } : {}),
    at: { col: 6, row: 4 },
    facing: 3,
  }];
  return mission;
}

function missionWithPak38(theater = 'europe') {
  const mission = missionWithGun(theater);
  mission.id = `pak38_faction_${theater}`;
  mission.enemies[0].kind = 'pak38';
  return mission;
}

const germanGun = loadMission(missionWithGun('europe')).enemies[0];
assert.strictEqual(germanGun.faction, 'german');
assert.strictEqual(germanGun.atGunCrewKind, 'german_infantry',
  'an initially deployed European AT gun should use German infantry as its crew');

const germanMission = loadMission(missionWithGun('europe'));
const germanController = germanMission.enemies.find(unit => unit.id === germanMission.enemies[0].atGunControllerUnitId);
assert(germanController, 'an initially deployed AT gun should create a real infantry controller');
assert.strictEqual(germanController.kind, 'german_infantry');
assert.strictEqual(germanController.faction, germanMission.enemies[0].faction);
assert.deepStrictEqual(germanController.pos, germanMission.enemies[0].pos);
assert.strictEqual(germanController.attachedToATGunId, germanMission.enemies[0].id,
  'the generated infantry should start folded into its gun composite');
assert.strictEqual(liveEnemyCount(germanMission), 1,
  'the attached controller should count only through its composite gun');

const veteranMissionData = missionWithGun('europe', 'usa');
veteranMissionData.enemies[0].unitLevel = 'veteran';
veteranMissionData.enemies[0].crewSkills = { commander: ['use_smoke_grenade'] };
const veteranMission = loadMission(veteranMissionData);
const veteranGun = veteranMission.enemies[0];
const veteranController = veteranMission.enemies.find(unit => unit.id === veteranGun.atGunControllerUnitId);
assert(veteranController);
assert.strictEqual(veteranController.faction, 'usa');
assert.strictEqual(veteranController.unitLevel, 'veteran');
assert.deepStrictEqual(veteranController.crewSkills, { commander: ['use_smoke_grenade'] },
  'the generated controller should inherit the scenario crew level and skills');

const japaneseGun = loadMission(missionWithGun('pacific')).enemies[0];
assert.strictEqual(japaneseGun.faction, 'japanese');
assert.strictEqual(japaneseGun.atGunCrewKind, 'japanese_infantry',
  'an initially deployed Pacific AT gun should use Japanese infantry as its crew');

const sovietGun = loadMission(missionWithGun('europe', 'soviet')).enemies[0];
assert.strictEqual(sovietGun.faction, 'soviet');
assert.strictEqual(sovietGun.atGunCrewKind, 'soviet_infantry',
  'an explicit gun faction should determine its infantry crew type');

const pak38 = loadMission(missionWithPak38()).enemies[0];
assert.strictEqual(pak38.faction, 'german');
assert.strictEqual(pak38.atGunCrewKind, 'german_infantry');
assert.strictEqual(pak38.atGunCrewAlive, true,
  'Pak 38 should enter the generic AT-gun crew lifecycle as an independent German unit');
assert.strictEqual(loadMission(missionWithPak38()).enemies[1].kind, 'german_infantry',
  'Pak 38 should spawn with a same-faction German infantry controller');

const pacificPak38 = loadMission(missionWithPak38('pacific')).enemies[0];
assert.strictEqual(pacificPak38.faction, 'german',
  'a named Pak 38 keeps its own UnitDB faction instead of inheriting the legacy at_gun theater fallback');

const currentSave = captureSave({
  gameMode: 'hardcore',
  missionId: germanMission.data.id,
  mission: germanMission,
  turn: 1,
  phase: 'player',
  movesLeft: 2,
  attacksLeft: 1,
  miscDone: false,
  playerStep: 'choose',
  hatchChangedThisTurn: false,
  phaseDice: [],
});
assert.strictEqual(currentSave.version, 10);
assert(currentSave.enemies.some(unit => unit.id.endsWith(':scenario_crew')),
  'current saves should persist the real initial controller');
const restoredCurrentMission = loadMission(missionWithGun('europe'));
const currentResult = applySave(restoredCurrentMission, restoredCurrentMission.data.id, currentSave);
assert.strictEqual(currentResult.ok, true, currentResult.reason);
assert(restoredCurrentMission.enemies.some(unit => unit.id === restoredCurrentMission.enemies[0].atGunControllerUnitId
  && unit.attachedToATGunId === restoredCurrentMission.enemies[0].id),
'v10 saves should restore the real controller binding');

const legacySave = JSON.parse(JSON.stringify(currentSave));
legacySave.version = 9;
legacySave.enemies = legacySave.enemies.filter(unit => !unit.id.endsWith(':scenario_crew'));
delete legacySave.enemies[0].atGunControllerUnitId;
const legacyMission = loadMission(missionWithGun('europe'));
const legacyResult = applySave(legacyMission, legacyMission.data.id, legacySave);
assert.strictEqual(legacyResult.ok, true, legacyResult.reason);
const migratedGun = legacyMission.enemies[0];
const migratedController = legacyMission.enemies.find(unit => unit.id === migratedGun.atGunControllerUnitId);
assert(migratedController && migratedController.attachedToATGunId === migratedGun.id,
  'v9 saves should migrate their implicit initial crew into a real attached controller');

console.log('MissionLoader AT-gun faction crew tests passed');
