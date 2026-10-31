const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { HexMap, neighbor, axialAdd, fireDirectionVector } = require('../assets/scripts/core/HexGrid.ts');
const { computeUnitVisibleHexes, computeRadioSharedVisibleHexes, hasFogLineOfSight,
  diagonalGunnerClickPreference, reconcileDiagonalGunnerSideAfterMove, isHexInOwnAttackVision } = require('../assets/scripts/core/FogOfWar.ts');
const { PlayerVisionCache } = require('../assets/scripts/core/PlayerVisionCache.ts');
const { canAttack, canMGAttack } = require('../assets/scripts/core/Combat.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');

const origin = { q: 0, r: 0 };
function fieldMap() {
  const map = new HexMap(13, 13);
  for (let q = -6; q <= 6; q++) for (let r = -6; r <= 6; r++) map.set({ pos: { q, r }, terrain: 'field' });
  return map;
}
function unit(kind = 'sherman', overrides = {}) {
  return { id: 'observer', kind, faction: 'usa', sideId: 'player', pos: origin, facing: 0, turretFacing: 0,
    hatchOpen: true, visionRange: 5, gunnerVisionRange: 5, interiorVisionRange: 2,
    stats: getUnitStats(kind), ...overrides };
}
const sees = (map, observer, target) => computeUnitVisibleHexes(map, observer).has(HexMap.keyOf(target));

test('six axes: low cannot see high; high sees low only when intermediate heights do not exceed the target', () => {
  for (let direction = 0; direction < 6; direction++) {
    const map = fieldMap(), x = origin, y = neighbor(x, direction), z = neighbor(y, direction);
    for (const [observerHeight, targetHeight] of [[1, 0], [0, -1], [-.5, -2.5]]) {
      map.get(x).height = observerHeight;
      map.get(y).height = observerHeight;
      map.get(z).height = targetHeight;
      for (const los of [map.hasLineOfSight.bind(map), (from, to) => hasFogLineOfSight(map, from, to)]) {
        assert.equal(los(x, y), true, 'same-height neighbor remains visible');
        assert.equal(los(y, z), true, 'a higher origin is excluded from blockers');
        assert.equal(los(z, y), false, 'higher target itself is hidden from below');
        assert.equal(los(x, z), false, 'x(1), y(1), z(0) is blocked');
        map.get(y).height = targetHeight;
        assert.equal(los(x, z), true, 'intermediate height equal to target is clear');
        map.get(y).height = targetHeight - .5;
        assert.equal(los(x, z), true, 'lower intermediate height is clear');
        map.get(y).height = targetHeight + .25;
        assert.equal(los(x, z), false, 'even an intermediate height below the observer can block');
        map.get(y).height = observerHeight + 1;
        assert.equal(los(x, z), false, 'terrain above the observer blocks');
        map.get(y).height = observerHeight;
      }
    }
  }
});

test('commander, interior, infantry, fixed gun, gunner and artillery use the same height rules', () => {
  for (const [kind, overrides] of [
    ['sherman', {}],
    ['sherman', { hatchOpen: false, turretFacing: 3 }], // interior sight faces away from the gun
    ['sherman', { hatchOpen: false, interiorVisionRange: 0 }],
    ['stug3', { hatchOpen: false, interiorVisionRange: 0 }],
    ['american_infantry', {}], ['at_gun', {}], ['heavy_artillery', {}],
  ]) {
    const map = fieldMap(), observer = unit(kind, overrides), y = { q: 1, r: 0 }, z = { q: 2, r: 0 };
    map.get(origin).height = 1;
    map.get(y).height = 1;
    assert(sees(map, observer, y), `${kind}: same height visible`);
    assert(!sees(map, observer, z), `${kind}: plateau edge blocks lower ground`);
    map.get(y).height = 0;
    assert(sees(map, observer, z), `${kind}: clear downhill path visible`);
    map.get(y).height = 2;
    assert(!sees(map, observer, y), `${kind}: higher endpoint hidden`);
    assert(!sees(map, observer, z), `${kind}: higher intermediate blocks`);
  }
});

test('axis and halfway gunner rays can see higher ground after a hidden low cell', () => {
  for (const direction of [0, 6]) for (const kind of ['sherman', 'stug3']) {
    const map = fieldMap(), observer = unit(kind, {
      hatchOpen: false, interiorVisionRange: 0, facing: direction, turretFacing: direction,
    });
    const step = fireDirectionVector(direction), first = axialAdd(origin, step), second = axialAdd(first, step);
    map.get(origin).height = 1;
    // For halfway rays both first flanks stand on the plateau and hide the low center.
    if (direction === 6) {
      map.get({ q: 1, r: 0 }).height = 1;
      map.get({ q: 0, r: 1 }).height = 1;
    } else map.get(first).height = 1;
    const low = direction === 6 ? first : second;
    const later = direction === 6 ? second : axialAdd(second, step);
    map.get(low).height = 0;
    map.get(later).height = 1;
    assert(!sees(map, observer, low), `${kind}/${direction}: low target blocked`);
    assert(sees(map, observer, later), `${kind}/${direction}: later same-height target visible`);
  }
});

test('all six halfway rays use target height for both flanks and intermediate centers', () => {
  for (let direction = 6; direction < 12; direction++) {
    const map = fieldMap(), step = fireDirectionVector(direction), target = axialAdd(origin, step);
    const a = neighbor(origin, direction - 6), b = neighbor(origin, (direction - 5) % 6);
    map.get(origin).height = 2;
    map.get(a).height = map.get(b).height = 1;
    assert.equal(map.hasDiagonalLineOfSight(origin, target, direction), false);
    map.get(b).height = 0;
    assert.equal(map.hasDiagonalLineOfSight(origin, target, direction), true, 'one clear flank is enough');
    map.get(target).height = 1;
    assert.equal(map.hasDiagonalLineOfSight(origin, target, direction), true, 'same-height flanks stop blocking');
    const far = axialAdd(target, step);
    assert.equal(map.hasDiagonalLineOfSight(origin, far, direction), false, 'intermediate raised center blocks lower target');
    map.get(far).height = 1;
    assert.equal(map.hasDiagonalLineOfSight(origin, far, direction), true);
    map.get(far).height = 3;
    assert.equal(map.hasDiagonalLineOfSight(origin, far, direction), false, 'higher endpoint hidden');
  }
});

test('closed halfway sight requires one continuous flank, including mixed terrain and height blockers', () => {
  const map = fieldMap(), observer = unit('sherman', {
    hatchOpen: false, interiorVisionRange: 0, turretFacing: 6, diagonalGunnerSidePreference: 0,
  });
  map.get(origin).height = 2;
  map.get({ q: 1, r: 0 }).height = 1; // closes a for a low target
  map.get({ q: 1, r: 2 }).terrain = 'forest'; // closes b at the next pair
  const target = { q: 2, r: 2 }, flank = { q: 3, r: 2 };
  assert(!sees(map, observer, target), 'cannot weave between separate blocked flanks');
  assert.equal(diagonalGunnerClickPreference(map, observer, 6, flank), null);
  map.get(target).height = map.get(flank).height = 1;
  assert(sees(map, observer, target), 'higher target reopens the complete a path');
  assert.equal(diagonalGunnerClickPreference(map, observer, 6, flank), 0);
  map.get(flank).height = 3;
  assert.equal(diagonalGunnerClickPreference(map, observer, 6, flank), null, 'cannot select an uphill target');
  map.get({ q: 1, r: 0 }).height = 3;
  reconcileDiagonalGunnerSideAfterMove(map, observer);
  assert.equal(observer.diagonalGunnerSidePreference, 1, 'higher terrain changes the preferred clear side');
});

test('downhill vision preserves forest, building, smoke and cliff behavior', () => {
  const map = fieldMap(), observer = unit(), mid = { q: 1, r: 0 }, target = { q: 2, r: 0 };
  map.get(origin).height = 2;
  for (const terrain of ['forest', 'rocky']) {
    map.get(mid).terrain = terrain;
    assert(!sees(map, observer, target));
  }
  map.get(mid).terrain = 'field';
  map.get(mid).hasBuilding = true;
  assert(!sees(map, observer, target));
  map.get(mid).hasBuilding = false;
  assert(!computeUnitVisibleHexes(map, observer, undefined, new Set(['1,0'])).has('2,0'));
  map.get(origin).cliffs = [true, false, false, false, false, false];
  assert(sees(map, observer, target), 'a cliff flag adds no extra sight obstruction');
});

test('radio shares a high ally view while own attack sight and firing paths remain obstructed', () => {
  const map = fieldMap(), observer = unit(), ally = unit('sherman', { id: 'ally', pos: { q: 1, r: 0 } });
  map.get(ally.pos).height = 1;
  const target = { ...unit('panzer4'), id: 'enemy', sideId: 'enemy', faction: 'german', pos: { q: 2, r: 0 } };
  map.get(target.pos).height = 1;
  assert(!sees(map, observer, target.pos));
  assert(computeRadioSharedVisibleHexes(map, observer, [ally]).has('2,0'));
  assert.equal(isHexInOwnAttackVision(map, observer, target.pos), false);
  const context = { map, attacker: observer, target, shellType: 'ap', expandedTurretDirections: true };
  const mgContext = { ...context, target: { ...unit('infantry'), id: 'infantry', faction: 'german', sideId: 'enemy', pos: ally.pos } };
  assert.equal(canAttack(context).reason, 'attack.reason.blocked');
  assert.equal(canMGAttack(mgContext).reason, 'attack.reason.blocked');
  map.get(origin).height = 2;
  assert.equal(canAttack(context).ok, true, 'clear downhill firing path works');
  assert.equal(canMGAttack(mgContext).ok, true, 'MG can fire downhill at adjacent infantry');
  map.get(ally.pos).height = 2;
  assert.equal(canAttack(context).ok, false, 'raised intermediate cell blocks fire at lower target');
});

test('player sight cache updates when observer, intermediate or target height changes, including regional maps', () => {
  for (const regional of [false, true]) {
    const map = fieldMap(), observer = unit();
    if (regional) for (const tile of map.all()) map.regions.set(HexMap.keyOf(tile.pos), 'test');
    const mission = { map, sherman: observer, allies: [], smokeHexes: new Set() }, cache = new PlayerVisionCache();
    const visible = () => cache.get(mission, 'clear', true, false).has('2,0');
    assert(visible());
    map.get({ q: 1, r: 0 }).height = 1;
    assert(!visible());
    map.get(origin).height = 1;
    assert(!visible(), 'plateau still blocks lower target');
    map.get({ q: 2, r: 0 }).height = 1;
    assert(visible(), 'target rises to the plateau height');
    map.get(origin).height = 0;
    assert(!visible(), 'observer descends below target');
  }
});
