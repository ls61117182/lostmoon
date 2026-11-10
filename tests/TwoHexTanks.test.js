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
const { computeUnitVisibleHexes, computePlayerVisibleHexes, hasFogLineOfSight } = require('../assets/scripts/core/FogOfWar.ts');
const { PlayerVisionCache } = require('../assets/scripts/core/PlayerVisionCache.ts');
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

test('AP and HE open-hatch casualties and commander shields apply only at the configured turret cell', () => {
  for (let facing=0;facing<6;facing++) for (const turretCell of ['front','rear'])
    for (const hitCell of ['front','rear']) for (const shell of ['ap','he']) for (const shield of [false,true]) for (const playerTarget of [false,true]) {
      const target=unit('maus',{q:0,r:0},{facing,hatchOpen:true,campaignCommanderShieldAvailable:shield});
      target.sideId=playerTarget?'player':'enemy';
      target.stats={...target.stats,turretCell,armorFront:100,armorFrontSide:100,armorRearSide:100,armorRear:100};
      const hitHex=hitCell==='front'?target.pos:geometry.unitRearHex(target);
      const attacker=unit('sherman',neighbor(hitHex,(facing+2)%6));
      attacker.sideId=playerTarget?'enemy':'player';
      const ctx={map:battlefield(),attacker,target,targetHex:hitHex,shellType:shell,expandedTurretDirections:true};
      const roll=shell==='he'?combat.rollHighExplosiveAttack:combat.rollAttack;
      const apply=shell==='he'?combat.applyHighExplosiveAttack:combat.applyAttack;
      const report=roll(ctx,rolls(6,6,1,1,1));
      const exposed=hitCell===turretCell;
      assert.equal(report.hit,true);
      assert.equal(report.targetCommanderExposed,exposed);
      assert.equal(report.commanderKilledByHitDoubles,exposed&&!shield);
      assert.equal(report.commanderShieldBlocked,exposed&&shield);
      apply(target,report);
      assert.equal(target.crew.commander,!(exposed&&!shield));
      assert.equal(target.campaignCommanderShieldAvailable,shield&&!exposed);
    }
});

test('closed hatches and single-cell tanks retain their commander casualty rules', () => {
  for (const kind of ['maus','sherman']) for (const open of [false,true]) for (const shell of ['ap','he']) {
    const target=unit(kind,{q:0,r:0},{hatchOpen:open});
    target.stats={...target.stats,armorFront:100,armorFrontSide:100,armorRearSide:100,armorRear:100};
    const hitHex=geometry.unitTurretHex(target);
    const ctx={map:battlefield(),attacker:unit('panzer4',{q:0,r:2},{faction:'soviet',sideId:'opponent'}),
      target,targetHex:hitHex,shellType:shell,expandedTurretDirections:true};
    const report=(shell==='he'?combat.rollHighExplosiveAttack:combat.rollAttack)(ctx,rolls(6,6,1,1,1));
    assert.equal(report.hit,true);
    assert.equal(report.targetCommanderExposed,open);
    assert.equal(report.commanderKilledByHitDoubles,open);
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

test('open tanks retain the one-hex body perimeter in all six headings, including both Maus cells', () => {
  for (const kind of ['maus','sherman','tiger','stug3']) for (let facing=0;facing<6;facing++) {
    const map=battlefield(),tank=unit(kind,{q:0,r:0},{facing,turretFacing:facing,
      hatchOpen:true,visionRange:0,gunnerVisionRange:0,interiorVisionRange:1});
    const cells=geometry.unitOccupiedHexes(tank);
    const expected=map.all().filter(tile=>cells.some(pos=>hexDistance(pos,tile.pos)<=1)).map(tile=>HexMap.keyOf(tile.pos)).sort();
    const opened=computeUnitVisibleHexes(map,tank);
    assert.deepEqual(Array.from(opened).sort(),expected,`${kind}, heading ${facing}`);
    tank.hatchOpen=false;
    assert.deepEqual(Array.from(computeUnitVisibleHexes(map,tank)).sort(),expected);
  }
});

test('opening a Maus hatch retains nearby ground hidden from the rear turret by a plateau edge', () => {
  for (let facing=0;facing<6;facing++) {
    const map=battlefield(),tank=unit('maus',{q:0,r:0},{facing,turretFacing:rotateDirection(facing,3),
      hatchOpen:false,gunnerVisionRange:0,interiorVisionRange:1});
    const rear=geometry.unitRearHex(tank),nearFront=neighbor(tank.pos,facing),key=HexMap.keyOf(nearFront);
    map.get(rear).height=1;map.get(tank.pos).height=1;
    assert.equal(hasFogLineOfSight(map,rear,nearFront),false,'the turret-origin path is blocked by the plateau');
    assert(computeUnitVisibleHexes(map,tank).has(key),'the front-cell near sight sees down the plateau edge');
    tank.hatchOpen=true;
    assert(computeUnitVisibleHexes(map,tank).has(key),'opening must keep the front-cell near sight');
  }
});

test('open body sight does not create another long-range observer or activate closed-hatch cupola bonuses', () => {
  const map=battlefield(),tank=unit('maus',{q:0,r:0},{hatchOpen:true,visionRange:2,gunnerVisionRange:0,
    interiorVisionRange:2,campaignUpgradeIds:['commander_cupola']});
  assert(computeUnitVisibleHexes(map,tank).has('1,0'));
  assert(!computeUnitVisibleHexes(map,tank).has('2,0'),'two cells beyond the front is outside both near sight and rear-origin commander range');
  tank.hatchOpen=false;
  assert(computeUnitVisibleHexes(map,tank).has('2,0'),'the configured cupola interior bonus still applies while closed');
});

test('retained open-hatch perimeter obeys per-cell smoke, fog weather and region boundaries', () => {
  for (const kind of ['maus','sherman']) for (const weather of ['clear','rain','fog']) {
    const map=battlefield(),tank=unit(kind,{q:0,r:0},{hatchOpen:false,visionRange:0,gunnerVisionRange:0,interiorVisionRange:1});
    const cells=geometry.unitOccupiedHexes(tank),ownKeys=cells.map(HexMap.keyOf);
    for (const smoke of [new Set(),new Set(['0,0']),new Set(ownKeys),new Set(['1,0'])]) {
      tank.hatchOpen=false;
      const closed=computeUnitVisibleHexes(map,tank,weather,smoke);
      tank.hatchOpen=true;
      const opened=computeUnitVisibleHexes(map,tank,weather,smoke);
      for (const tile of map.all()) if (cells.some(pos=>hexDistance(pos,tile.pos)<=1) && closed.has(HexMap.keyOf(tile.pos))) {
        assert(opened.has(HexMap.keyOf(tile.pos)),`${kind}, ${weather}, ${HexMap.keyOf(tile.pos)}`);
      }
      if (weather==='fog') for (const key of smoke) if (!ownKeys.includes(key)) assert(!opened.has(key));
      if (weather==='fog' && ownKeys.every(key=>smoke.has(key))) assert.deepEqual(Array.from(opened).sort(),ownKeys.slice().sort());
    }
    for (const tile of map.all()) map.regions.set(HexMap.keyOf(tile.pos),'A');
    map.regions.set('1,0','B');tank.hatchOpen=true;
    assert(!computeUnitVisibleHexes(map,tank,weather).has('1,0'),'near sight cannot cross a region boundary');
  }
});

test('the player vision cache recomputes hatch changes without dropping near-body visibility', () => {
  const map=battlefield(),tank=unit('maus',{q:0,r:0},{hatchOpen:false,turretFacing:3,gunnerVisionRange:0});
  map.get({q:0,r:0}).height=1;map.get({q:-1,r:0}).height=1;
  const mission={map,sherman:tank,playerTank:tank,allies:[],smokeHexes:new Set(),data:{}};
  let computations=0;
  const cache=new PlayerVisionCache((...args)=>{computations++;return computePlayerVisibleHexes(...args);});
  const closed=cache.get(mission,'clear',true,false);
  assert(closed.has('1,0'));tank.hatchOpen=true;
  assert(cache.get(mission,'clear',true,false).has('1,0'));assert.equal(computations,2);
  tank.hatchOpen=false;
  assert.deepEqual(Array.from(cache.get(mission,'clear',true,false)).sort(),Array.from(closed).sort());
  assert.equal(computations,3);
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
