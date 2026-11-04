const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const geometry = require('../assets/scripts/core/UnitFootprint.ts');
const { HexMap, neighbor, rotateDirection, hexDistance } = require('../assets/scripts/core/HexGrid.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { createTankCrew } = require('../assets/scripts/core/types.ts');
const combat = require('../assets/scripts/core/Combat.ts');
const { computeUnitVisibleHexes } = require('../assets/scripts/core/FogOfWar.ts');
const { actionDicePool } = require('../assets/scripts/core/ActionDice.ts');
const { canExecuteAction, rollHardcoreTankAIDice } = require('../assets/scripts/core/EnemyAI.ts');

function unit(kind, pos = { q: 0, r: 0 }, overrides = {}) {
  const stats = getUnitStats(kind);
  return { id: kind, kind, stats, pos, facing: 0, turretFacing: 0, faction: stats.faction,
    sideId: stats.faction === 'german' ? 'enemy' : 'player', crew: createTankCrew(stats), ...overrides };
}
function battlefield() {
  const map = new HexMap(20, 20);
  for (let q = -8; q <= 8; q++) for (let r = -8; r <= 8; r++) map.set({ pos: { q, r }, terrain: 'field' });
  return map;
}
function context(targetHex, attackerPos = { q: 0, r: 2 }) {
  return { map: battlefield(), attacker: unit('sherman', attackerPos), target: unit('maus'), targetHex,
    expandedTurretDirections: true, directionalDamageCheck: true, unitDamageTargetClass: true };
}
function rolls(...dice) { let i = 0; return { d6: () => dice[i++] ?? 6 }; }

test('Maus is configured as a rear-turret two-hex tank; ordinary tanks stay single-hex', () => {
  assert.equal(getUnitStats('maus').footprintLength, 2);
  assert.deepEqual(geometry.unitOccupiedHexes(unit('maus')), [{ q: 0, r: 0 }, { q: -1, r: 0 }]);
  assert.deepEqual(geometry.unitTurretHex(unit('maus')), { q: -1, r: 0 });
  assert.equal(geometry.unitOccupiedHexes(unit('sherman')).length, 1);
});

test('all 24 manoeuvres keep the two occupied hexes adjacent and use only the leading entry', () => {
  for (let facing = 0; facing < 6; facing++) for (const action of ['advance', 'reverse', 'cw', 'ccw']) {
    const tank = unit('maus', { q: 0, r: 0 }, { facing });
    const plan = geometry.planUnitMove(tank, action);
    const next = { ...tank, pos: plan.pos, facing: plan.facing };
    assert.equal(hexDistance(...geometry.unitOccupiedHexes(next)), 1);
    assert.deepEqual(neighbor(geometry.unitRearHex(next), plan.facing), plan.pos);
    assert.equal(hexDistance(plan.entryFrom, plan.entryTo), 1);
    if (action === 'reverse') assert.deepEqual(plan.entryFrom, geometry.unitRearHex(tank));
    else assert.deepEqual(plan.entryFrom, tank.pos);
    if (action === 'cw' || action === 'ccw') assert.deepEqual(geometry.unitRearHex(next), tank.pos);
  }
});

test('reverse checks the new rear terrain and cliff, not the old occupied front/rear edge', () => {
  const map = battlefield(), tank = unit('maus'), oldRear = geometry.unitRearHex(tank);
  map.get({ q: -2, r: 0 }).terrain = 'water';
  assert.equal(map.canUnitCrossEdge(tank.pos, oldRear, tank), false);
  map.get({ q: -2, r: 0 }).terrain = 'field';
  assert.equal(map.canUnitCrossEdge(tank.pos, oldRear, tank), true);
  // Callers that already provide the physical rear entry must not shift it a second time.
  map.get({ q: -3, r: 0 }).terrain = 'water';
  assert.equal(map.canUnitCrossEdge(oldRear, { q: -2, r: 0 }, tank), true);
  map.get(oldRear).height = 1;
  map.get(oldRear).cliffs = [false, false, false, true, false, false];
  assert.equal(map.canUnitCrossEdge(tank.pos, oldRear, tank), false);
});

test('AI reverse and turns reject newly occupied blocked hexes', () => {
  const tank = unit('maus'), target = unit('sherman', { q: 3, r: 0 }), map = battlefield();
  assert.equal(canExecuteAction(tank, 'reverse', target, map, new Set(['-2,0'])), false);
  assert.equal(canExecuteAction(tank, 'reverse', target, map, new Set()), true);
  assert.equal(canExecuteAction(tank, 'turn', target, map, new Set(['0,1', '1,-1'])), false);
});

test('only exact 0/180 prohibit rear/front targets; 30-degree rear shots use rear-side armour', () => {
  assert.equal(combat.canAttack(context({ q: -1, r: 0 }, { q: 2, r: 0 })).ok, false);
  assert.equal(combat.canAttack(context({ q: 0, r: 0 }, { q: -3, r: 0 })).ok, false);
  const ctx = context({ q: -1, r: 0 }, { q: 0, r: 1 });
  assert.equal(combat.canAttack(ctx).ok, true);
  const report = combat.rollAttack(ctx, rolls(6, 6, 6, 6, 1));
  assert.equal(report.armorFace, 'rearSide');
  assert.equal(report.damageCheckType, 'front');
});

test('armour remaps by hit cell while directional damage keeps its real bearing', () => {
  const front = combat.previewAttack(context({ q: 0, r: 0 }, { q: -2, r: 2 }));
  assert.equal(front.pen.armorFace, 'frontSide');
  const rear = combat.previewAttack(context({ q: -1, r: 0 }, { q: -1, r: 2 }));
  assert.equal(rear.pen.armorFace, 'rearSide');
});

test('all twelve incoming bearings use the documented front/rear armour matrix', () => {
  const { fireDirectionVector } = require('../assets/scripts/core/HexGrid.ts');
  for (let direction=0;direction<12;direction++) for (const cell of ['front','rear']) {
    const hex=cell==='front'?{q:0,r:0}:{q:-1,r:0};
    const vector=fireDirectionVector(direction);
    const ctx=context(hex,{q:hex.q+vector.q*2,r:hex.r+vector.r*2});
    const normal=combat.attackDirectionRuleFrom({ ...ctx.target, pos:hex },ctx.attacker.pos);
    const expected=cell==='front'
      ? ['rear','rearSide'].includes(normal.armorFace)?'frontSide':normal.armorFace
      : ['front','frontSide'].includes(normal.armorFace)?'rearSide':normal.armorFace;
    assert.equal(combat.previewAttack(ctx).pen.armorFace,expected,`${cell}/${normal.incomingAngle}`);
    const expectedLegal=!(cell==='rear'&&normal.incomingAngle===0)&&!(cell==='front'&&Math.abs(normal.incomingAngle)===180);
    assert.equal(combat.canAttack(ctx).ok,expectedLegal,`${cell}/${normal.incomingAngle}`);
  }
});

test('same-hex infantry uses front-side/front table or rear/rear table, including actual hit-cell filtering', () => {
  for (const [pos, face, direction] of [[{ q: 0, r: 0 }, 'frontSide', 'front'], [{ q: -1, r: 0 }, 'rear', 'rear']]) {
    const ctx = { ...context(pos), attacker: unit('american_infantry', pos), sameHexInfantryTankAttack: true };
    assert.equal(combat.canAttack(ctx).ok, true);
    const report = combat.rollAttack(ctx, rolls(6, 6, 6, 6, 6));
    assert.equal(report.armorFace, face);
    assert.equal(report.damageCheckType, direction);
    assert.equal(report.hitBreakdown.distance, 0);
  }
});

test('turret damage falls through to fire on front hits and survives on rear hits', () => {
  for (const [hex, source, effect] of [[{ q: 0, r: 0 }, { q: 0, r: 2 }, 'fire'], [{ q: -1, r: 0 }, { q: -1, r: 2 }, 'turret']]) {
    const ctx = context(hex, source); ctx.protagonist = ctx.target;
    ctx.attacker.stats.penetration = 100;
    const report = combat.rollAttack(ctx, rolls(6, 6, 6, 6, 4));
    assert.equal(report.damageEffect, effect);
  }
});

test('crew priorities skip personnel in the other cell, then use normal fallbacks', () => {
  for (const [hex, source, expected] of [[{ q: 0, r: 0 }, { q: 0, r: 2 }, 4], [{ q: -1, r: 0 }, { q: -1, r: 2 }, 2]]) {
    const ctx = context(hex, source); ctx.protagonist = ctx.target; ctx.attacker.stats.penetration = 100;
    const report = combat.rollAttack(ctx, rolls(6, 6, 6, 6, 6));
    assert.equal(report.damageEffects[0].crewSlot, expected);
  }
  const ctx = context({ q: 0, r: 0 }); ctx.protagonist = ctx.target;
  ctx.attacker.stats.penetration = 100; ctx.target.crew.driver = false;
  assert.equal(combat.rollAttack(ctx, rolls(6, 6, 6, 6, 6)).damageEffect, 'fire');
});

test('a front hit does not kill the rear commander on hit doubles; rear hit can', () => {
  for (const [hex, source, killed] of [[{ q: 0, r: 0 }, { q: 0, r: 2 }, false], [{ q: -1, r: 0 }, { q: -1, r: 2 }, true]]) {
    const ctx = context(hex, source); ctx.target.hatchOpen = true;
    assert.equal(combat.rollAttack(ctx, rolls(6, 6, 1, 1)).commanderKilledByHitDoubles, killed);
  }
});

test('main gun distance starts at the rear turret and cannot attack either occupied hex', () => {
  const map = battlefield(), tank = unit('maus');
  assert.equal(combat.hitBreakdown({ map, attacker: tank, target: unit('sherman', { q: 2, r: 0 }) }).distance, 3);
  for (const pos of geometry.unitOccupiedHexes(tank)) {
    assert.equal(combat.canAttack({ map, attacker: tank, target: unit('american_infantry', pos), shellType: 'he', mainGunSuppressesInfantry: true }).ok, false);
  }
});

test('closed-hatch interior sight combines both cells; open-hatch and gunner start at the turret', () => {
  const tank = unit('maus'), map = battlefield();
  let visible = computeUnitVisibleHexes(map, tank);
  assert(visible.has('-2,0')); assert(visible.has('0,1'));
  assert(visible.has('3,0')); assert(!visible.has('4,0'));
  tank.hatchOpen = true;
  visible = computeUnitVisibleHexes(map, tank);
  assert(visible.has('-5,0')); assert(!visible.has('4,0'));
});

test('half smoke limits the actual observation origin without isolating the other half', () => {
  const map = battlefield(), tank = unit('maus', { q: 0, r: 0 }, { hatchOpen: true });
  assert(computeUnitVisibleHexes(map, tank, 'sunny', new Set(['0,0'])).has('-3,0'));
  assert(!computeUnitVisibleHexes(map, tank, 'sunny', new Set(['-1,0'])).has('-3,0'));
});

test('hull MG reaches only the front adjacent hex and rejects infantry under either half', () => {
  const tank = unit('maus'), map = battlefield();
  const ctx = { map, attacker: tank, target: unit('american_infantry', { q: 1, r: 0 }), hardcoreTankMachineGuns: true, tankMachineGun: 'hull' };
  assert.equal(combat.canMGAttack(ctx).ok, true);
  assert.equal(combat.canMGAttack({ ...ctx, target: unit('american_infantry', { q: 2, r: 0 }) }).ok, false);
  for (const pos of geometry.unitOccupiedHexes(tank)) assert.equal(combat.canMGAttack({ ...ctx, target: unit('american_infantry', pos) }).ok, false);
});

test('mixed terrain takes the minimum completed dice pool without duplicating crew bonuses', () => {
  const tank = unit('maus');
  for (const subPhase of ['movement', 'attack', 'misc']) {
    const opts = { subPhase, terrain: 'road', crew: tank.crew, hatchOpen: true, hardcore: true, mobility: tank.stats.mobility, firepower: tank.stats.firepower };
    assert.equal(actionDicePool({ ...opts, occupiedTerrains: ['mud'] }), Math.min(actionDicePool(opts), actionDicePool({ ...opts, terrain: 'mud' })));
  }
  const random = { d6: () => 6 };
  const road = rollHardcoreTankAIDice(random, tank, 'road'), mud = rollHardcoreTankAIDice(random, tank, 'mud');
  const mixed = rollHardcoreTankAIDice(random, tank, 'road', ['mud']);
  for (const type of ['attack', 'move', 'misc']) assert.equal(mixed.filter(d=>d.type===type).length, Math.min(road.filter(d=>d.type===type).length, mud.filter(d=>d.type===type).length));
});

test('hit views preserve the persisted front anchor and write damage to the physical unit', () => {
  const tank = unit('maus'), view = geometry.unitHitView(tank, { q: -1, r: 0 });
  assert.deepEqual(geometry.unitFrontHex(view), tank.pos);
  assert.deepEqual(geometry.unitRearHex(view), view.pos);
  view.turretDamaged = true;
  assert.equal(tank.turretDamaged, true);
  assert.deepEqual(tank.pos, { q: 0, r: 0 });
});
