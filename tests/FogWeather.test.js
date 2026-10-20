const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { normalizeWeather, weatherRule, weatherVisionRange } = require('../assets/scripts/core/Weather.ts');
const { RNG } = require('../assets/scripts/core/Dice.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { roundEventConditionMet } = require('../assets/scripts/core/RoundEvents.ts');
const { HexMap, neighbor } = require('../assets/scripts/core/HexGrid.ts');
const { computeUnitVisibleHexes, currentVisionRange, currentGunnerVisionRange, currentInteriorVisionRange,
  isWithinOwnVisionRange, diagonalGunnerRuleDirectionForVisibleHex } = require('../assets/scripts/core/FogOfWar.ts');

test('fog survives JSON round trips and fixes tank commander/gunner vision at two hexes', () => {
  assert.equal(normalizeWeather(JSON.parse('{"weather":"fog"}').weather), 'fog');
  assert.deepEqual(weatherRule('fog'), { hitThresholdModifier: 0, visionRangeModifier: 0, tankVisionRangeOverride: 2 });
  for (const range of [0, 1, 3, 6]) {
    assert.equal(weatherVisionRange({ kind: 'sherman', hatchOpen: true }, range, 'fog'), 2);
    assert.equal(weatherVisionRange({ kind: 'sherman', hatchOpen: false }, range, 'fog', 'gunner'), 2);
    assert.equal(weatherVisionRange({ kind: 'sherman', hatchOpen: false }, range, 'fog'), range);
    assert.equal(weatherVisionRange({ kind: 'german_infantry', hatchOpen: true }, range, 'fog'), range);
  }
  assert.equal(normalizeWeather('unknown'), 'clear');
});

function fieldMap() {
  const map = new HexMap(11, 11);
  for (let q = -5; q <= 5; q++) for (let r = -5; r <= 5; r++) map.set({ pos: { q, r }, terrain: 'field' });
  return map;
}
function tank(overrides = {}) {
  return { kind: 'sherman', pos: { q: 0, r: 0 }, facing: 0, turretFacing: 0, hatchOpen: true,
    visionRange: 6, gunnerVisionRange: 6, interiorVisionRange: 1, stats: { visionType: 'turreted' }, ...overrides };
}
test('open commander sight and closed gunner sight end at two hexes for player and enemy tanks', () => {
  for (const kind of ['sherman', 'panzer4', 'stug3']) {
    const map = fieldMap(), unit = tank({ kind });
    assert.equal(currentVisionRange(unit, 'fog'), 2);
    assert.equal(currentGunnerVisionRange(unit, 'fog'), 2);
    const openSight = computeUnitVisibleHexes(map, unit, 'fog');
    for (let direction = 0; direction < 6; direction++) {
      const two = neighbor(neighbor(unit.pos, direction), direction);
      assert(openSight.has(HexMap.keyOf(two)));
      assert(!openSight.has(HexMap.keyOf(neighbor(two, direction))));
    }
    unit.hatchOpen = false;
    const closedSight = computeUnitVisibleHexes(map, unit, 'fog');
    assert(closedSight.has('2,0'));
    assert(!closedSight.has('3,0'));
    assert(closedSight.has('-1,0'));
    assert(!closedSight.has('-2,0'));
    assert.equal(currentInteriorVisionRange(unit), 1);
    assert.equal(isWithinOwnVisionRange(unit, { pos: { q: 3, r: 0 } }, 'fog'), false);
    assert.equal(isWithinOwnVisionRange(unit, { pos: { q: 2, r: 0 } }, 'fog'), true);
  }
});
test('diagonal gunner sight and targeting also respect the fog range', () => {
  const map = fieldMap(), unit = tank({ hatchOpen: false, turretFacing: 6 });
  const visible = computeUnitVisibleHexes(map, unit, 'fog');
  assert(visible.has('1,1'));
  assert(!visible.has('2,1'));
  // The center ray uses its normal bearing; this helper only overrides flank cells.
  assert.equal(diagonalGunnerRuleDirectionForVisibleHex(map, unit, { q: 1, r: 1 }, 'fog'), null);
  assert.equal(diagonalGunnerRuleDirectionForVisibleHex(map, unit, { q: 2, r: 1 }, 'fog'), null);
  unit.hatchOpen = true;
  assert.equal(diagonalGunnerRuleDirectionForVisibleHex(map, unit, { q: 2, r: 1 }, 'fog'), null);
});
test('fog preserves interior sight, smoke and terrain blockers; other weather retains its ranges', () => {
  const map = fieldMap(), unit = tank({ hatchOpen: false, interiorVisionRange: 3 });
  assert.equal(currentInteriorVisionRange(unit), 3);
  assert(computeUnitVisibleHexes(map, unit, 'fog').has('-3,0'));
  unit.hatchOpen = true;
  const smokeSight = computeUnitVisibleHexes(map, unit, 'fog', new Set(['0,0']));
  assert.deepEqual([...smokeSight], ['0,0']);
  assert(!smokeSight.has('1,0'));
  assert(!smokeSight.has('2,0'));
  map.set({ pos: { q: 1, r: 0 }, terrain: 'forest' });
  const blocked = computeUnitVisibleHexes(map, unit, 'fog');
  assert(blocked.has('1,0'));
  assert(!blocked.has('2,0'));
  unit.crew = { commander: false };
  const deadCommanderSight = computeUnitVisibleHexes(fieldMap(), { ...unit, interiorVisionRange: 0 }, 'fog');
  assert(!deadCommanderSight.has('-1,0'));
  assert(deadCommanderSight.has('2,0'));
  delete unit.crew;
  assert.equal(currentVisionRange(unit, 'clear'), 6);
  assert.equal(currentVisionRange(unit, 'rain'), 5);
  assert.equal(currentGunnerVisionRange(unit, 'rain'), 6);
  assert.equal(currentGunnerVisionRange(unit, 'heavy_snow'), 6);
});

test('Europe mission 1 loads with fog and cannot trigger sunny-only airborne events', () => {
  const data = JSON.parse(fs.readFileSync('assets/resources/missions/mission_01.json', 'utf8'));
  assert.equal(data.weather, 'fog');
  const mission = loadMission(data, new RNG(1), { hardcore: true });
  assert.equal(normalizeWeather(mission.data.weather), 'fog');
  assert(mission.data.roundEvents.length > 0);
  for (const event of mission.data.roundEvents) assert.equal(roundEventConditionMet(event, mission.data.weather), false);
});

test('fog follows the displayed player through movement and camera changes without rebuilding its footprint', () => {
  const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
  const ast = ts.createSourceFile('BattleScene.ts', source, ts.ScriptTarget.Latest, true);
  let method;
  const visit = node => {
    if (ts.isMethodDeclaration(node) && node.name?.getText(ast) === 'drawFogWeather') method = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const { axialToPixel } = require('../assets/scripts/core/HexGrid.ts');
  const draw = new Function('axialToPixel', ts.transpile(`return function() ${method.body.getText(ast)}`,
    { target: ts.ScriptTarget.ES2020 }))(axialToPixel);
  const unit = { pos: { q: 0, r: 0 } };
  let samples = 0, calls = [];
  const scene = {
    mission: { sherman: unit, map: { all() { samples++; return [{ pos: unit.pos }]; } } },
    hexSize: 50, offsetX: 80, offsetY: -120, unitEffectTime: 1,
    // Deliberately differs from logical pos: the tank is midway through a move.
    playerPoint: { x: .5, y: -.75 },
    interpolatedPos(u) { assert.equal(u, unit); return { x: this.offsetX + this.playerPoint.x * this.hexSize,
      y: this.offsetY + this.playerPoint.y * this.hexSize }; },
    fogWeatherRenderer: { draw(...args) { calls.push(args); } },
  };
  draw.call(scene);
  const footprint = calls[0][0];
  assert.deepEqual(calls[0].slice(-2), [.5, -.75]);
  scene.hexSize = 100; scene.offsetX = -360; scene.offsetY = 200;
  draw.call(scene);
  assert.deepEqual(calls[1].slice(-2), [.5, -.75], 'panning and zoom cannot move the gradient relative to the player');
  scene.playerPoint = { x: .6, y: -.8 };
  draw.call(scene);
  assert(Math.abs(calls[2].at(-2) - .6) < 1e-10);
  assert.equal(calls[2].at(-1), -.8);
  assert.equal(calls[2][0], footprint);
  assert.equal(samples, 1, 'movement changes uniforms, never rebuilds the map mask');
});
