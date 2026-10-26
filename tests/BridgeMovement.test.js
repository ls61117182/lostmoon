const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const hex = require('../assets/scripts/core/HexGrid.ts');
const types = require('../assets/scripts/core/types.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { HexMap, neighbor } = hex;
const center = { q: 0, r: 0 };
const kinds = ['infantry', 'german_infantry', 'soviet_infantry', 'american_infantry',
  'japanese_infantry', 'officer', 'at_gun', 'pak38', 'flak88', 'sherman', 'panzer4', 'truck'];
const unit = (kind, pos) => ({ id: kind, kind, pos, facing: 0,
  faction: getUnitStats(kind).faction, stats: getUnitStats(kind) });

test('all ground units enter and leave every bridge orientation only through its two ends', () => {
  for (let axis = 0; axis < 3; axis++) {
    const map = new HexMap(5, 5);
    map.set({ pos: center, terrain: 'water', bridgeEnds: [axis, axis + 3] });
    for (let dir = 0; dir < 6; dir++) map.set({ pos: neighbor(center, dir), terrain: 'clear' });
    for (const kind of kinds) for (let dir = 0; dir < 6; dir++) {
      const adjacent = neighbor(center, dir), allowed = dir % 3 === axis;
      assert.equal(map.canUnitCrossEdge(adjacent, center, unit(kind, adjacent)), allowed,
        `${kind}: entering bridge axis ${axis} from side ${dir}`);
      assert.equal(map.canUnitCrossEdge(center, adjacent, unit(kind, center)), allowed,
        `${kind}: leaving bridge axis ${axis} through side ${dir}`);
      assert.equal(map.canUnitCrossEdge(adjacent, center, unit(kind, adjacent), { ignoreBreakwater: true }), allowed,
        'ignoring breakwaters must not bypass bridge ends');
    }
  }
});

test('crossing between bridges requires both ends to align for every ground unit', () => {
  const map = new HexMap(5, 5), to = neighbor(center, 0);
  const fromTile = { pos: center, terrain: 'water', bridgeEnds: [0, 3] };
  const toTile = { pos: to, terrain: 'water', bridgeEnds: [0, 3] };
  map.set(fromTile); map.set(toTile);
  for (const kind of kinds) {
    for (const [a, b, allowed] of [[0, 0, true], [0, 1, false], [1, 0, false], [1, 1, false]]) {
      fromTile.bridgeEnds = [a, a + 3]; toTile.bridgeEnds = [b, b + 3];
      assert.equal(map.canUnitCrossEdge(center, to, unit(kind, center)), allowed, kind);
      assert.equal(map.canUnitCrossEdge(to, center, unit(kind, to)), allowed, kind);
    }
  }
});

test('shared bridge checks preserve infantry terrain access and reject nonadjacent movement', () => {
  const map = new HexMap(5, 5), to = neighbor(center, 0);
  map.set({ pos: center, terrain: 'clear' });
  const tile = { pos: to, terrain: 'forest' }; map.set(tile);
  for (const terrain of ['forest', 'rocky', 'urban_destructible', 'urban_indestructible']) {
    tile.terrain = terrain;
    assert.equal(map.canUnitCrossEdge(center, to, unit('american_infantry', center)), true);
    assert.equal(map.canUnitCrossEdge(center, to, unit('sherman', center)), false);
  }
  for (const kind of kinds) {
    assert.equal(map.canUnitCrossEdge(center, center, unit(kind, center)), false);
    assert.equal(map.canUnitCrossEdge(center, { q: 2, r: 0 }, unit(kind, center)), false);
    tile.terrain = 'water';
    assert.equal(map.canUnitCrossEdge(center, to, unit(kind, center)), false);
  }
});

test('live infantry AI and AT-gun movement refuse bridge sides before animation', () => {
  const Scene = require('./helpers/BattleSceneMethods.cjs')(['findInfantryAIMove', 'tryHardcoreATGunForwardMove'], {
    ...types, ...hex, markAmbushAction: () => {}, unitDisplayName: kind => kind,
  });
  const map = new HexMap(5, 5), to = neighbor(center, 0);
  map.set({ pos: center, terrain: 'clear' });
  const bridge = { pos: to, terrain: 'water', bridgeEnds: [1, 4] }; map.set(bridge);
  const scene = new Scene();
  Object.assign(scene, {
    mission: { map }, moveDuration: .1, rng: { intRange: () => 0 },
    nearestInfantryAITarget: () => ({ pos: { q: 2, r: 0 } }),
    infantryMoveHexPriority: () => 4, infantryAIMovePriority: () => 4,
    canMoveToBattleTile: () => true, buildOccupiedSet: () => new Set(),
    findMoveBlocker: () => null, breakConcealment: () => {}, redraw: () => {}, battleLog: () => {},
  });
  const gun = unit('at_gun', center);
  for (const kind of ['american_infantry', 'german_infantry', 'soviet_infantry', 'japanese_infantry']) {
    assert.equal(scene.findInfantryAIMove(unit(kind, center)), null, kind);
  }
  assert.equal(scene.tryHardcoreATGunForwardMove(gun, 0), false);
  assert.equal(scene.anim, undefined, 'blocked moves never start animation');
  bridge.bridgeEnds = [0, 3];
  const moved = scene.findInfantryAIMove(unit('american_infantry', center));
  assert.equal(moved.q, to.q); assert.equal(moved.r, to.r);
  assert.equal(scene.tryHardcoreATGunForwardMove(gun, 0), true);
  assert.equal(scene.anim.toQ, to.q); assert.equal(scene.anim.toR, to.r);
});
