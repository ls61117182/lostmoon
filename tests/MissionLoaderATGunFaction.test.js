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

const germanGun = loadMission(missionWithGun('europe')).enemies[0];
assert.strictEqual(germanGun.faction, 'german');
assert.strictEqual(germanGun.atGunCrewKind, 'german_infantry',
  'an initially deployed European AT gun should use German infantry as its crew');

const japaneseGun = loadMission(missionWithGun('pacific')).enemies[0];
assert.strictEqual(japaneseGun.faction, 'japanese');
assert.strictEqual(japaneseGun.atGunCrewKind, 'japanese_infantry',
  'an initially deployed Pacific AT gun should use Japanese infantry as its crew');

const sovietGun = loadMission(missionWithGun('europe', 'soviet')).enemies[0];
assert.strictEqual(sovietGun.faction, 'soviet');
assert.strictEqual(sovietGun.atGunCrewKind, 'soviet_infantry',
  'an explicit gun faction should determine its infantry crew type');

console.log('MissionLoader AT-gun faction crew tests passed');
