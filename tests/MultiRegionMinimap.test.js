const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { generateMultiRegionPackage } = require('../assets/scripts/core/MultiRegionGenerator.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { RNG } = require('../assets/scripts/core/Dice.ts');
const { neighbors } = require('../assets/scripts/core/HexGrid.ts');
const { buildMultiRegionMinimap } = require('../assets/scripts/view/MultiRegionMinimap.ts');
const fixture = count => loadMission(generateMultiRegionPackage(20261026, count).mission, new RNG(1), { hardcore: true });

test('4–6 region terrain thumbnails fit the UI, preserve shared edges, and keep badges separate', () => {
  for (const count of [4, 5, 6]) {
    const mission = fixture(count), map = buildMultiRegionMinimap(mission);
    assert.equal(map.cells.length, 36 * count);
    assert.equal(map.regions.length, count);
    assert.equal(map.regions.filter(region => region.current).length, 1);
    if (count === 4) {
      const [a1, a2, a3, a4] = ['A1', 'A2', 'A3', 'A4'].map(id => map.regions.find(region => region.id === id));
      assert(Math.abs(a1.x - a2.x) < 1e-6, 'A1/A2 share the left column');
      assert(Math.abs(a3.x - a4.x) < 1e-6, 'A3/A4 share the right column');
      assert(a1.x < a3.x && a2.x < a4.x);
      assert(a1.y < a2.y && a3.y < a4.y, 'UI Y increases upward: A1/A3 below A2/A4');
      const regionById = id => mission.data.multiRegion.regions.find(region => region.id === id);
      for (const [left, right] of [['A1', 'A2'], ['A1', 'A3'], ['A2', 'A4'], ['A3', 'A4']]) {
        const adjacent = new Set(regionById(right).tileKeys);
        assert(regionById(left).tileKeys.some(key => {
          const [q, r] = key.split(',').map(Number);
          return neighbors({ q, r }).some(pos => adjacent.has(`${pos.q},${pos.r}`));
        }), `${left}/${right} must meet along playable hex edges`);
      }
    }
    for (const cell of map.cells) for (const point of cell.corners) {
      assert(Math.abs(point.x) <= 99.001);
      assert(point.y >= -68.001 && point.y <= 74.001);
    }
    for (const a of map.regions) for (const b of map.regions) {
      if (a.id === b.id) continue;
      assert(Math.abs(a.x - b.x) >= 42 || Math.abs(a.y - b.y) >= 27, `${count} regions: ${a.id}/${b.id} badge overlap`);
    }
    const key = p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
    const vertices = new Set(map.cells.flatMap(cell => cell.corners.map(key)));
    for (const region of map.regions) for (const edge of region.edges) {
      assert(vertices.has(key(edge.from)) && vertices.has(key(edge.to)));
      assert(Math.abs(Math.hypot(edge.from.x - edge.to.x, edge.from.y - edge.to.y) - map.radius) < 1e-6);
    }
  }
});

test('thumbnail powers and control remain a turn snapshot; crossing updates only the current-region marker', () => {
  const mission = fixture(4);
  const before = buildMultiRegionMinimap(mission);
  const enemyRegion = before.regions.find(region => region.state === 'enemy');
  assert(enemyRegion.power.endsWith('/ ?'));
  mission.enemies.forEach(unit => { unit.destroyed = true; });
  mission.allies.forEach(unit => { unit.destroyed = true; });
  const target = mission.data.multiRegion.regions.find(region => region.id === enemyRegion.id);
  const [q, r] = target.tileKeys[0].split(',').map(Number);
  mission.sherman.pos = { q, r };
  const after = buildMultiRegionMinimap(mission);
  assert.equal(after.regions.find(region => region.current).id, target.id);
  assert.deepEqual(after.regions.map(({ id, state, power }) => ({ id, state, power })),
    before.regions.map(({ id, state, power }) => ({ id, state, power })));
  assert(after.cells.every(cell => !('units' in cell)), 'terrain only, no unit positions');
});
