const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, filename);

const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { effectiveDiceTerrain } = require('../assets/scripts/core/types.ts');
const {
  URBAN_INDESTRUCTIBLE_VARIANTS,
  URBAN_DESTRUCTIBLE_VARIANTS,
  applyUrbanStructureDamage,
  createUrbanVariantAllocator,
  urbanBuildingSpritePath,
  urbanBuildingSpriteScale,
  urbanStructureDamage,
} = require('../assets/scripts/core/UrbanTerrain.ts');

test('urban variant allocation exhausts each style pool before repeating', () => {
  const allocator = createUrbanVariantAllocator('urban-test');
  const indestructible = Array.from({ length: URBAN_INDESTRUCTIBLE_VARIANTS.length }, () => allocator.nextIndestructible());
  const destructible = Array.from({ length: URBAN_DESTRUCTIBLE_VARIANTS.length }, () => allocator.nextDestructible());
  assert.equal(new Set(indestructible).size, URBAN_INDESTRUCTIBLE_VARIANTS.length);
  assert.equal(new Set(destructible).size, URBAN_DESTRUCTIBLE_VARIANTS.length);
  const nextIndestructible = allocator.nextIndestructible();
  const nextDestructible = allocator.nextDestructible();
  assert.ok(URBAN_INDESTRUCTIBLE_VARIANTS.includes(nextIndestructible));
  assert.ok(URBAN_DESTRUCTIBLE_VARIANTS.includes(nextDestructible));
  assert.notEqual(nextIndestructible, indestructible.at(-1));
  assert.notEqual(nextDestructible, destructible.at(-1));
});

test('one editor building code expands to varied runtime building styles', () => {
  const mission = JSON.parse(fs.readFileSync('assets/resources/missions/mission_03.json', 'utf8'));
  mission.id = 'urban-runtime-variants';
  const cells = mission.tiles.flat().filter(Boolean);
  const setBuilding = (cell, terrain) => {
    cell.t = terrain;
    delete cell.rd;
    delete cell.br;
    delete cell.bd;
    delete cell.bw;
  };
  for (let i = 0; i < URBAN_INDESTRUCTIBLE_VARIANTS.length; i++) setBuilding(cells[i], 'ui');
  for (let i = 0; i < URBAN_DESTRUCTIBLE_VARIANTS.length; i++) {
    setBuilding(cells[URBAN_INDESTRUCTIBLE_VARIANTS.length + i], 'ud');
  }
  const loaded = loadMission(mission);
  const indestructible = loaded.map.all().filter(tile => tile.urbanKind === 'indestructible');
  const destructible = loaded.map.all().filter(tile => tile.urbanKind === 'destructible');
  assert.equal(new Set(indestructible.map(tile => tile.urbanVariant)).size, URBAN_INDESTRUCTIBLE_VARIANTS.length);
  assert.equal(new Set(destructible.map(tile => tile.urbanVariant)).size, URBAN_DESTRUCTIBLE_VARIANTS.length);
  assert.ok(destructible.every(tile => tile.urbanStructure === 2));
});

test('urban movement, sight and dice rules match their reference terrain', () => {
  const map = new HexMap(4, 4);
  const indestructible = { pos: { q: 0, r: 0 }, terrain: 'urban_indestructible', urbanKind: 'indestructible' };
  const destructible = { pos: { q: 1, r: 0 }, terrain: 'urban_destructible', urbanKind: 'destructible', urbanStructure: 2 };
  const road = { pos: { q: 2, r: 0 }, terrain: 'urban_road', urbanKind: 'road' };
  const ground = { pos: { q: 3, r: 0 }, terrain: 'urban_ground', urbanKind: 'ground' };
  [indestructible, destructible, road, ground].forEach(tile => map.set(tile));
  assert.equal(map.canTankEnter(indestructible.pos), false);
  assert.equal(map.canTankEnter(destructible.pos), false);
  assert.equal(map.canUnitEnter(destructible.pos), true);
  assert.equal(map.lineOfSightBlockedByTile(indestructible), true);
  assert.equal(map.lineOfSightBlockedByTile(destructible), true);
  assert.equal(effectiveDiceTerrain(road), 'road');
  assert.equal(effectiveDiceTerrain(ground), 'field');
  assert.equal(effectiveDiceTerrain(indestructible), 'forest');
});

test('HE structure damage changes intact building to damaged then rubble/mud', () => {
  assert.equal(urbanStructureDamage(1), 1);
  assert.equal(urbanStructureDamage(2), 1);
  assert.equal(urbanStructureDamage(3), 2);
  assert.equal(urbanStructureDamage(4), 2);
  const tile = { pos: { q: 0, r: 0 }, terrain: 'urban_destructible', urbanKind: 'destructible', urbanVariant: 'workshop', urbanStructure: 2 };
  assert.match(urbanBuildingSpritePath(tile), /workshop_intact/);
  assert.equal(applyUrbanStructureDamage(tile, 2), 1);
  assert.equal(tile.urbanStructure, 1);
  assert.match(urbanBuildingSpritePath(tile), /workshop_damaged/);
  assert.equal(applyUrbanStructureDamage(tile, 2), 1);
  assert.equal(tile.terrain, 'urban_rubble');
  assert.equal(effectiveDiceTerrain(tile), 'mud');
  assert.match(urbanBuildingSpritePath(tile), /workshop_rubble/);
  const map = new HexMap(2, 2); map.set(tile);
  assert.equal(map.canTankEnter(tile.pos), true);
  assert.equal(map.lineOfSightBlockedByTile(tile), false);
});

test('all declared urban building sprites exist in the runtime resource folder', () => {
  const root = 'assets/resources/textures/terrain/urban';
  for (const variant of URBAN_INDESTRUCTIBLE_VARIANTS) {
    assert.ok(fs.existsSync(`${root}/urban_dense_indestructible_${variant}_v1.png`), variant);
  }
  for (const variant of URBAN_DESTRUCTIBLE_VARIANTS) {
    const tile = { terrain: 'urban_destructible', urbanKind: 'destructible', urbanVariant: variant, urbanStructure: 2 };
    for (const structure of [2, 1, 0]) {
      tile.urbanStructure = structure;
      tile.terrain = structure ? 'urban_destructible' : 'urban_rubble';
      const path = urbanBuildingSpritePath(tile).replace('textures/terrain/urban/', `${root}/`).replace('/spriteFrame', '.png');
      assert.ok(fs.existsSync(path), `${variant}/${structure}: ${path}`);
    }
  }
});

test('city art enlarges complete silhouettes consistently across destruction states', () => {
  const tile = { terrain: 'urban_destructible', urbanKind: 'destructible', urbanStructure: 2 };
  for (const urbanVariant of ['rowhouses_l', 'courtyard', 'workshop', 'block']) {
    for (const urbanStructure of [2, 1, 0]) {
      assert.equal(urbanBuildingSpriteScale({ ...tile, urbanVariant, urbanStructure }), 1.35);
    }
  }
  assert.equal(urbanBuildingSpriteScale({ ...tile, urbanKind: 'indestructible', urbanVariant: 'factory' }), 1.35);
});


test('city MG cover is +3 and rubble removes cover for infantry and tanks', () => {
  const { hitBreakdown, mgHitBreakdown } = require('../assets/scripts/core/Combat.ts');
  const map = new HexMap(3, 1);
  const tile = { pos: { q: 1, r: 0 }, terrain: 'urban_destructible', urbanKind: 'destructible', urbanStructure: 2, hasBuilding: true };
  map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
  map.set(tile);
  const attacker = { kind: 'sherman', faction: 'usa', pos: { q: 0, r: 0 }, facing: 0, stats: { size: 4 } };
  const infantry = { kind: 'infantry', faction: 'german', pos: tile.pos, facing: null, stats: { size: 2 } };
  const ctx = { attacker, target: infantry, map };
  for (const structure of [2, 1]) {
    tile.urbanStructure = structure;
    assert.equal(mgHitBreakdown(ctx).building, 3);
    assert.equal(hitBreakdown(ctx).building, 1, 'main-gun cover stays +1');
  }
  const coveredThreshold = mgHitBreakdown(ctx).threshold;
  applyUrbanStructureDamage(tile, 2);
  assert.equal(tile.hasBuilding, undefined);
  assert.equal(mgHitBreakdown(ctx).building, 0);
  assert.equal(mgHitBreakdown(ctx).threshold, coveredThreshold - 3);
  tile.hasBuilding = true; // Legacy or inconsistent tile flags must not revive cover.
  assert.equal(mgHitBreakdown(ctx).building, 0);
  assert.equal(hitBreakdown(ctx).building, 0);
  assert.equal(hitBreakdown({ ...ctx, target: { ...infantry, kind: 'panzer_iv' } }).building, 0);
  tile.terrain = 'urban_indestructible'; tile.urbanKind = 'indestructible';
  assert.equal(mgHitBreakdown(ctx).building, 3);
  tile.terrain = 'field'; delete tile.urbanKind;
  assert.equal(mgHitBreakdown(ctx).building, 1, 'rural building cover stays +1');
  delete tile.hasBuilding;
  assert.equal(mgHitBreakdown(ctx).building, 0);
});

test('destroying a city building opens sight through its rubble, including legacy flags', () => {
  const { computeUnitVisibleHexes } = require('../assets/scripts/core/FogOfWar.ts');
  const map = new HexMap(3, 1);
  const start = { q: 0, r: 0 }, end = { q: 2, r: 0 };
  const tile = { pos: { q: 1, r: 0 }, terrain: 'urban_destructible', urbanKind: 'destructible', urbanStructure: 2, hasBuilding: true };
  map.set({ pos: start, terrain: 'field' }); map.set(tile); map.set({ pos: end, terrain: 'field' });
  const observer = { kind: 'infantry', faction: 'usa', pos: start, facing: null, stats: { visionType: 'infantry' } };
  assert.equal(map.hasLineOfSight(start, end), false);
  assert.equal(computeUnitVisibleHexes(map, observer).has(HexMap.keyOf(end)), false);
  applyUrbanStructureDamage(tile, 4);
  tile.hasBuilding = true;
  assert.equal(map.lineOfSightBlockedByTile(tile), false);
  assert.equal(map.hasLineOfSight(start, end), true);
  assert.equal(computeUnitVisibleHexes(map, observer).has(HexMap.keyOf(end)), true);
});
