const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { RNG } = require('../assets/scripts/core/Dice.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { prepareTurnEndEvent } = require('../assets/scripts/core/TurnEndEventApply.ts');
const { roundEventConditionMet } = require('../assets/scripts/core/RoundEvents.ts');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');

function mission(weather) {
  const data = JSON.parse(fs.readFileSync('assets/resources/missions/mission_01.json', 'utf8'));
  delete data.weatherPool;
  data.weather = weather;
  return loadMission(data, new RNG(42));
}

test('bad-weather aircraft events trigger without combat dice, unit IDs or changes to units', () => {
  for (const weather of ['rain', 'fog', 'light_snow', 'heavy_snow']) {
    for (const effectType of ['airborne_support', 'stuka']) {
      for (const hatchOpen of [true, false]) {
        const loaded = mission(weather);
        loaded.sherman.hatchOpen = hatchOpen;
        const before = JSON.stringify([loaded.sherman, loaded.allies, loaded.enemies]);
        const row = { effectType, condition: 'clear', reinforcementSide: 'friendly' };
        assert.equal(roundEventConditionMet(row, weather), true);
        const unexpected = () => { throw new Error('flyover must not roll combat dice or create units'); };
        const prepared = prepareTurnEndEvent(row, [], 0, {
          mission: loaded, rng: { next: unexpected, d6: unexpected, pick: unexpected }, nextEnemyId: unexpected,
        });
        assert.equal(prepared.extraDicePhases, undefined);
        if (effectType === 'airborne_support') assert.deepEqual(prepared.airbornePlan.units, []);
        else assert.equal(prepared.flyoverOnly, true);
        prepared.apply();
        assert.equal(JSON.stringify([loaded.sherman, loaded.allies, loaded.enemies]), before);
      }
    }
  }
  assert.equal(roundEventConditionMet({ effectType: 'none', condition: 'clear' }, 'rain'), false);
});

test('clear-weather aircraft still deploy troops and resolve Stuka combat dice', () => {
  for (const weather of [undefined, 'clear']) {
    for (const effectType of ['airborne_support', 'stuka']) {
      const loaded = mission(weather);
      const prepared = prepareTurnEndEvent({ effectType, reinforcementSide: 'friendly' }, [], 0, {
        mission: loaded, rng: new RNG(1), nextEnemyId: () => 'drop',
      });
      assert.equal(prepared.flyoverOnly, undefined);
      if (effectType === 'airborne_support') assert.equal(prepared.airbornePlan.units.length, 3);
      else assert(prepared.extraDicePhases.length > 0);
    }
  }
});

test('Stuka flyover plays engine sound and movement, with no cannon or commander reaction', () => {
  let engines = 0, cannons = 0, attacks = 0, completed = 0;
  class Sprite {}
  class UITransform {}
  const Scene = sceneMethods(['playStukaFlyover', 'advanceStukaFlyover'], {
    CANVAS_W: 1280, Sprite, UITransform,
    playStukaFlyover: () => engines++, playStukaCannonFire: () => cannons++, stopStukaCannonFire: () => {},
  });
  const scene = new Scene();
  const plane = { active: false, getComponent: () => null, setPosition(x, y) { this.position = { x, y }; }, setScale() {} };
  Object.assign(scene, {
    mission: mission('fog'), mapNode: { position: { x: 0, y: 0 } }, hexSize: 50, stukaFlyover: null,
    stukaSpriteNode: plane, project: () => ({ x: 0, y: 0 }), hashStringToSeed: () => 1,
    drawStukaCannonBurst: () => attacks++, drawStukaShotDown: () => attacks++,
  });
  scene.playStukaFlyover(scene.mission.sherman, false, () => completed++, true, true);
  assert.equal(engines, 1);
  assert.equal(scene.stukaFlyover.shotDown, false);
  scene.advanceStukaFlyover(0.1);
  const startX = plane.position.x;
  for (let i = 0; i < 39; i++) scene.advanceStukaFlyover(0.1);
  assert(plane.position.x < startX);
  assert.equal(cannons, 0);
  assert.equal(attacks, 0);
  assert.equal(completed, 1);
  assert.equal(scene.stukaFlyover, null);
  assert.equal(plane.active, false);
});

test('bad-weather event flow waits for the aircraft before continuing and skips combat panels', () => {
  const Scene = sceneMethods(['startTurnEndEventFlow'], {
    GameSession: { isPvp: false, gameMode: 'classic' }, getGameModeConfig: () => ({}),
    HexMap: require('../assets/scripts/core/HexGrid.ts').HexMap, prepareTurnEndEvent, t: key => key,
  });
  for (const effectType of ['airborne_support', 'stuka']) {
    let completed = 0, onDone, flown = 0;
    const scene = new Scene();
    Object.assign(scene, {
      mission: mission('rain'), turnEndEventProvider: { diceCount: () => 2 },
      clearActiveActingUnit() {}, redraw() {}, isEffectiveBattleTile: () => true, currentWeather: () => 'rain',
      finishTurnEvent: () => completed++, battleLog() {},
      playAirborneSupport(plan, done) { assert.equal(plan.units.length, 0); flown++; onDone = done; },
      playStukaFlyover(target, player, done, shotDown, flyoverOnly) {
        assert.equal(shotDown, false); assert.equal(flyoverOnly, true); flown++; onDone = done;
      },
    });
    scene.startTurnEndEventFlow('mission_01', { effectType, condition: 'clear', reinforcementSide: 'friendly' });
    assert.equal(flown, 1);
    assert.equal(completed, 0);
    onDone();
    assert.equal(completed, 1);
    assert.equal(scene.turnEndEventUI, undefined);
  }
});
