const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { computeUnitVisibleHexes, computeRadioSharedVisibleHexes, computePlayerVisibleHexes } = require('../assets/scripts/core/FogOfWar.ts');
function fieldMap() {
  const map = new HexMap(11, 11);
  for (let q = -5; q <= 5; q++) for (let r = -5; r <= 5; r++) map.set({ pos: { q, r }, terrain: 'field' });
  return map;
}
function unit(kind = 'sherman', overrides = {}) {
  return { id: 'observer', kind, faction: 'usa', sideId: 'player', pos: { q: 0, r: 0 }, facing: 0, turretFacing: 0,
    hatchOpen: true, visionRange: 4, gunnerVisionRange: 4, interiorVisionRange: 4,
    stats: { hasRadio: true, visionType: kind.includes('infantry') ? 'infantry' : kind === 'stug3' ? 'fixed' : 'turreted' }, ...overrides };
}

test('fog smoke isolates commander, interior, gunner, diagonal, infantry and bunker sight to the origin', () => {
  const map = fieldMap(), smoke = new Set(['0,0']);
  const observers = [unit(), unit('sherman', { hatchOpen: false }),
    unit('sherman', { hatchOpen: false, turretFacing: 6 }), unit('stug3'), unit('panzer4'),
    unit('american_infantry'), unit('heavy_artillery'), unit('german_heavy_artillery')];
  for (const observer of observers) {
    assert.deepEqual([...computeUnitVisibleHexes(map, observer, 'fog', smoke)], ['0,0'], observer.kind);
  }
});

test('outside observers cannot directly reveal smoky hexes, including adjacent and diagonal ray cells', () => {
  const map = fieldMap(), smoke = new Set(['1,0', '1,1', '0,1']);
  for (const observer of [unit(), unit('sherman', { hatchOpen: false, turretFacing: 6 }),
    unit('stug3'), unit('american_infantry'), unit('heavy_artillery'), unit('german_heavy_artillery')]) {
    const sight = computeUnitVisibleHexes(map, observer, 'fog', smoke);
    for (const key of smoke) assert(!sight.has(key), `${observer.kind} revealed ${key}`);
    assert(sight.has('0,0'));
  }
  assert(!computeUnitVisibleHexes(map, unit(), 'fog', smoke).has('2,0'), 'smoke still blocks hexes behind it');
});

test('a receiver in smoke still receives distant friendly radio sight without changing its direct sight', () => {
  const map = fieldMap(), smoke = new Set(['0,0']);
  const receiver = unit(), sender = unit('sherman', { id: 'sender', pos: { q: 3, r: 0 } });
  assert.deepEqual([...computeUnitVisibleHexes(map, receiver, 'fog', smoke)], ['0,0']);
  const shared = computeRadioSharedVisibleHexes(map, receiver, [sender], 'fog', smoke);
  assert(shared.has('5,0'));
  assert(!computePlayerVisibleHexes(map, receiver, [sender], false, 'fog', smoke).has('5,0'));
  assert(computePlayerVisibleHexes(map, receiver, [sender], true, 'fog', smoke).has('5,0'));
  receiver.radioDamaged = true;
  assert(!computeRadioSharedVisibleHexes(map, receiver, [sender], 'fog', smoke).has('5,0'));
});

test('radio can reveal a friendly smoke hex, while damaged radios, enemies and non-radio allies cannot', () => {
  const map = fieldMap(), smoke = new Set(['1,0', '1,1']);
  const receiver = unit(), sender = unit('sherman', { id: 'sender', pos: { q: 1, r: 0 } });
  assert(!computeUnitVisibleHexes(map, receiver, 'fog', smoke).has('1,0'));
  const shared = computeRadioSharedVisibleHexes(map, receiver, [sender], 'fog', smoke);
  assert(shared.has('1,0'), 'the friendly sends awareness of its own occupied smoke hex');
  assert(!shared.has('1,1'), 'radio never reveals an unrelated smoke hex');
  assert(!shared.has('2,0'), 'the sender has no direct vision outside its smoke hex to share');
  for (const unavailable of [{ radioDamaged: true }, { crew: { commander: false } },
    { faction: 'german', sideId: 'enemy' }, { destroyed: true }, { stats: { ...sender.stats, hasRadio: false } }]) {
    assert(!computeRadioSharedVisibleHexes(map, receiver, [{ ...sender, ...unavailable }], 'fog', smoke).has('1,0'));
  }
});

test('smoke expiry restores direct sight, and clear/rain/snow keep their existing smoke rules', () => {
  const map = fieldMap(), observer = unit(), originSmoke = new Set(['0,0']), outsideSmoke = new Set(['1,0']);
  for (const weather of ['clear', 'rain', 'light_snow', 'heavy_snow', undefined]) {
    assert(computeUnitVisibleHexes(map, observer, weather, originSmoke).has('1,0'));
    assert(computeUnitVisibleHexes(map, observer, weather, outsideSmoke).has('1,0'));
  }
  outsideSmoke.clear();
  assert(computeUnitVisibleHexes(map, observer, 'fog', outsideSmoke).has('1,0'));
  assert.equal(originSmoke.size, 1, 'visibility queries do not modify smoke state');
});
