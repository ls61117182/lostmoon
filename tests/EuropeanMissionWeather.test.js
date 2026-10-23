const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { RNG } = require('../assets/scripts/core/Dice.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');

function missionData(number) {
  return JSON.parse(fs.readFileSync(`assets/resources/missions/mission_${String(number).padStart(2, '0')}.json`, 'utf8').replace(/^\uFEFF/, ''));
}

function weatherRng(roll) {
  const rng = new RNG(42);
  const next = rng.next.bind(rng);
  rng.next = () => { rng.next = next; return roll; };
  return rng;
}

test('all 13 European missions draw 50% clear, 25% fog and 25% rain on each new game', () => {
  for (let number = 1; number <= 13; number++) {
    const data = missionData(number);
    const original = JSON.stringify(data);
    for (const [roll, expected] of [[0, 'clear'], [0.499999, 'clear'], [0.5, 'fog'], [0.749999, 'fog'], [0.75, 'rain'], [0.999999, 'rain']]) {
      const loaded = loadMission(data, weatherRng(roll));
      assert.equal(loaded.data.weather, expected, `mission ${number}, roll ${roll}`);
    }
    assert.equal(JSON.stringify(data), original, 'loading must leave the source ready for a fresh draw');
  }
});

test('save JSON preserves all drawn weather results when loading into a differently drawn game', () => {
  for (const [roll, expected] of [[0, 'clear'], [0.5, 'fog'], [0.75, 'rain']]) {
    const loaded = loadMission(missionData(1), weatherRng(roll));
    const save = JSON.parse(JSON.stringify(captureSave({
      mission: loaded, missionId: loaded.data.id, gameMode: 'classic', turn: 2, phase: 'player',
      movesLeft: 2, attacksLeft: 1, miscDone: false, playerStep: 'choose', hatchChangedThisTurn: false, phaseDice: [],
    })));
    assert.equal(save.weather, expected);
    const resumed = loadMission(missionData(1), weatherRng(roll === 0 ? 0.75 : 0));
    assert.notEqual(resumed.data.weather, expected);
    assert.equal(applySave(resumed, resumed.data.id, save).ok, true);
    assert.equal(resumed.data.weather, expected);
  }
});

test('missions without a pool keep their fixed weather', () => {
  const data = missionData(1);
  delete data.weatherPool;
  data.weather = 'heavy_snow';
  assert.equal(loadMission(data, weatherRng(0)).data.weather, 'heavy_snow');
  delete data.weather;
  assert.equal(loadMission(data, weatherRng(0.75)).data.weather, undefined);
});

test('PvP can load the shared map without drawing local weather', () => {
  const data = missionData(1);
  const rng = new RNG(42);
  const reference = new RNG(42);
  const loaded = loadMission(data, rng, { randomizeWeather: false });
  const fixed = { ...missionData(1) };
  delete fixed.weatherPool;
  loadMission(fixed, reference);
  assert.equal(loaded.data.weather, data.weather);
  assert.equal(rng.getState(), reference.getState());
});
