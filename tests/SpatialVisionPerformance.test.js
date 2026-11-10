const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, f);
const rules = Object.assign({}, ...['HexGrid', 'FogOfWar', 'Dice', 'UnitDB', 'types']
  .map(name => require(`../assets/scripts/core/${name}.ts`)));
const { HexMap, RNG } = rules;
// Reference uses exactly the same sight geometry, with the previous exhaustive candidate search.
function exhaustive(map) {
  const reference = Object.create(map);
  reference.tilesInBounds = function* () { yield* map.all(); };
  reference.tilesInRange = function* (center, range) {
    for (const tile of map.all()) if (rules.hexDistance(center, tile.pos) <= range) yield tile;
  };
  return reference;
}

test('local queries match exhaustive ranges for negative coordinates, gaps, replacements and very large ranges', () => {
  const map = new HexMap(20, 20), rng = new RNG(431);
  for (let q = -8; q <= 8; q++) for (let r = -8; r <= 8; r++) {
    if (rng.d6() > 2) map.set({ pos: { q, r }, terrain: 'field' });
  }
  const keys = tiles => tiles.map(t => HexMap.keyOf(t.pos)).sort();
  for (const range of [0, 1, 2, 4, 10000]) for (const center of [{ q: 0, r: 0 }, { q: -6, r: 3 }]) {
    assert.deepEqual(keys([...map.tilesInRange(center, range)]),
      keys(map.all().filter(t => rules.hexDistance(center, t.pos) <= range)));
  }
  const changed = { pos: { q: -3, r: 2 }, terrain: 'forest' };
  map.set(changed);
  assert.equal([...map.tilesInRange(changed.pos, 0)][0], changed, 'queries cannot retain an obsolete tile');
});

test('bounded sight matches exhaustive geometric blockers, including grazing edges, smoke and elevations', () => {
  const rng = new RNG(431), map = new HexMap(15, 15);
  for (let q = -7; q <= 7; q++) for (let r = -7; r <= 7; r++) {
    if (rng.d6() === 1) continue;
    map.set({ pos: { q, r }, terrain: rng.d6() <= 2 ? 'forest' : 'field', height: rng.d6() === 1 ? 1 : 0 });
  }
  const tiles = map.all(), smoke = new Set(tiles.filter(() => rng.d6() === 1).map(t => HexMap.keyOf(t.pos)));
  const full = exhaustive(map);
  for (let i = 0; i < 1200; i++) {
    const from = rng.pick(tiles).pos, to = rng.pick(tiles).pos;
    assert.equal(rules.hasFogLineOfSight(map, from, to, smoke), rules.hasFogLineOfSight(full, from, to, smoke),
      `${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
  }
});

test('all unit sight types retain exact visible sets across regions, weather, hatch, turret and crew states', () => {
  const rng = new RNG(431), map = new HexMap(15, 15);
  for (let q = -7; q <= 7; q++) for (let r = -7; r <= 7; r++) {
    map.set({ pos: { q, r }, terrain: rng.d6() === 1 ? 'forest' : 'field', height: rng.d6() === 1 ? 1 : 0 });
  }
  const smoke = new Set(['1,0', '-1,1', '3,-2']), full = exhaustive(map);
  for (const regional of [false, true]) {
    map.regions.clear();
    if (regional) for (const tile of map.all()) map.regions.set(HexMap.keyOf(tile.pos), tile.pos.q <= 1 ? 'A' : 'B');
    for (const kind of ['panzer4', 'maus', 'stug3', 'german_infantry', 'at_gun', 'heavy_artillery']) {
      const stats = rules.getUnitStats(kind);
      for (const weather of ['clear', 'fog', 'rain']) for (const hatchOpen of [false, true]) for (const facing of [0, 2, 5, 8]) {
        const unit = { id: kind, kind, faction: stats.faction, stats, pos: { q: 0, r: 0 }, facing: facing % 6,
          turretFacing: facing, hatchOpen, crew: { commander: facing !== 2 },
          visionRange: 4, gunnerVisionRange: 4, interiorVisionRange: 1 };
        assert.deepEqual(rules.computeUnitVisibleHexes(map, unit, weather, smoke),
          rules.computeUnitVisibleHexes(full, unit, weather, smoke), `${regional}/${kind}/${weather}/${hatchOpen}/${facing}`);
      }
    }
  }
});

test('distant map expansion adds no all-map enumerations or local sight probes', () => {
  const map = new HexMap(100, 100);
  for (let q = -10; q <= 10; q++) for (let r = -10; r <= 10; r++) map.set({ pos: { q, r }, terrain: 'field' });
  const unit = { id: 'observer', kind: 'panzer4', faction: 'german', pos: { q: 0, r: 0 }, facing: 0, hatchOpen: true,
    stats: rules.getUnitStats('panzer4'), crew: { commander: true } };
  map.all = () => assert.fail('sight must use indexed local candidates');
  const get = map.get; let probes = 0;
  map.get = function (...args) { probes++; return get.apply(this, args); };
  const before = rules.computeUnitVisibleHexes(map, unit); const beforeProbes = probes;
  for (let i = 0; i < 1000; i++) map.set({ pos: { q: 100 + i, r: 100 }, terrain: 'forest' });
  probes = 0;
  assert.deepEqual(rules.computeUnitVisibleHexes(map, unit), before);
  assert.equal(probes, beforeProbes);
});
