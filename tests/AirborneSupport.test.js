const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { RNG } = require('../assets/scripts/core/Dice.ts');
const { HexMap, hexDistance, neighbor } = require('../assets/scripts/core/HexGrid.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { rollMGAttack } = require('../assets/scripts/core/Combat.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { planAirborneSupport, landAirborneUnit, airborneReactionContext } = require('../assets/scripts/core/AirborneSupport.ts');
const { roundEventsForTurn, isAirborneWeather, validateRoundEvents } = require('../assets/scripts/core/RoundEvents.ts');
const { prepareTurnEndEvent } = require('../assets/scripts/core/TurnEndEventApply.ts');
const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
function unit(id, kind, q, r, side = 'enemy') {
  const stats = getUnitStats(kind);
  return { id, kind, stats, faction: stats.faction, sideId: side, controller: 'ai', pos: { q, r }, facing: 0, turretFacing: 0 };
}
function mission() {
  const map = new HexMap(7, 7);
  for (let q = 0; q < 7; q++) for (let r = 0; r < 7; r++) map.set({ pos: { q, r }, terrain: 'field' });
  return { map, sherman: unit('player', 'sherman', 0, 0, 'player'), allies: [], enemies: [], smokeHexes: new Set(), data: { id: 'airborne', theater: 'europe', weather: 'clear' } };
}
function plan(m, side = 'friendly', seed = 10, keys) { let id = 0; return planAirborneSupport(m, side, new RNG(seed), () => `drop_${++id}`, keys); }

test('mission 1 is sunny and supports exactly rounds 1, 3, 5, including save/restore', () => {
  const data = JSON.parse(fs.readFileSync('assets/resources/missions/mission_01.json', 'utf8'));
  assert.equal(data.weather, 'clear');
  for (let turn = 1; turn <= 6; turn++) assert.equal(roundEventsForTurn(data.roundEvents, turn).length, [1,3,5].includes(turn) ? 1 : 0);
  const loaded = loadMission(data, new RNG(1), { hardcore: true });
  const p = plan(loaded);
  assert.equal(p.units.length, 3);
  p.units.forEach(u => { landAirborneUnit(loaded, p, u); landAirborneUnit(loaded, p, u); });
  assert.equal(loaded.allies.length, 3);
  assert(loaded.allies.every(u => u.kind === 'american_infantry' && u.faction === 'usa' && u.sideId === 'player'));
  const saved = captureSave({ mission: loaded, missionId: data.id, turn: 2, phase: 'player', gameMode:'hardcore', movesLeft: 2, attacksLeft: 1, miscDone: false, phaseDice:[] });
  const restored = loadMission(data, new RNG(1));
  const result = applySave(restored, data.id, saved);
  assert.equal(result.ok, true, result.reason);
  assert.equal(restored.allies.length, 3);
});
test('weather gate rejects rain, all snow and future fog', () => {
  for (const weather of ['rain', 'light_snow', 'heavy_snow', 'fog']) {
    const m = mission(); m.data.weather = weather;
    assert.equal(plan(m), null); assert.equal(isAirborneWeather(weather), false);
  }
  assert.equal(isAirborneWeather(undefined), true);
});
test('targets are interior and favor opposite side; landing hexes are unique and nearby', () => {
  for (let seed = 1; seed <= 35; seed++) for (const side of ['friendly', 'enemy']) {
    const m = mission(); const p = plan(m, side, seed);
    for (let dir = 0; dir < 6; dir++) assert(m.map.has(neighbor(p.target, dir)));
    const x = p.target.q + p.target.r / 2;
    assert(side === 'friendly' ? x >= 4.5 : x <= 4.5);
    assert.equal(p.units.length, 3);
    assert.equal(new Set(p.units.map(u => HexMap.keyOf(u.pos))).size, 3);
    assert(p.units.every(u => hexDistance(p.target, u.pos) <= 1));
  }
});
test('search expands, respects occupants, and handles one/two/zero drops', () => {
  for (const available of [0, 1, 2, 3]) {
    const m = mission(); for (const tile of m.map.all()) tile.terrain = 'water';
    [{q:0,r:6},{q:1,r:6},{q:2,r:6}].slice(0, available).forEach(pos => { m.map.get(pos).terrain = 'field'; });
    const p = plan(m);
    if (!available) assert.equal(p, null);
    else { assert.equal(p.units.length, available); assert(p.units.every(u => hexDistance(p.target, u.pos) > 1)); }
  }
  const m = mission();
  m.enemies = m.map.all().filter(t => t.pos.q !== 0 || t.pos.r !== 0).map((t,i) => unit(`block${i}`, i % 2 ? 'infantry' : 'flak88', t.pos.q, t.pos.r));
  const p = plan(m); assert.equal(p.units.length, 1); assert.deepEqual(p.units[0].pos, m.sherman.pos);
});
test('enemy drops retain USA identity and respect active-map scope', () => {
  const m = mission(); const keys = new Set(m.map.all().filter(t => t.pos.q < 4).map(t => HexMap.keyOf(t.pos)));
  const p = plan(m, 'enemy', 10, keys); p.units.forEach(u => landAirborneUnit(m, p, u));
  assert.equal(m.allies.length, 0); assert.equal(m.enemies.length, 3);
  assert(m.enemies.every(u => u.faction === 'usa' && u.sideId === 'enemy' && keys.has(HexMap.keyOf(u.pos))));
});
test('random event uses deferred plan, not pre-animation spawning', () => {
  const m = mission(); let id=0;
  const prepared = prepareTurnEndEvent({ effectType:'airborne_support', reinforcementSide:'friendly' }, [4,4], 8, { mission:m, rng:new RNG(10), nextEnemyId:()=>`random${++id}` });
  assert.equal(m.allies.length, 0); assert.equal(prepared.airbornePlan.units.length, 3);
  prepared.apply(); assert.equal(m.allies.length, 3);
});
test('MG reactions respect suppression, once-per-unit and current tank orientation', () => {
  const m = mission(); const target = unit('paratrooper','american_infantry',3,3,'player');
  const infantry = unit('infantry','german_infantry',2,3);
  const tank = unit('tank','panzer4',4,3); tank.facing=3; tank.turretFacing=1;
  const reacted = new Set(); assert(airborneReactionContext(m, infantry, target, reacted));
  infantry.suppressed = true; assert.equal(airborneReactionContext(m, infantry, target, reacted), null); infantry.suppressed = false;
  const before = JSON.stringify(tank); const ctx = airborneReactionContext(m,tank,target,reacted);
  assert(ctx); assert.equal(ctx.tankMachineGun,'hull'); assert.equal(ctx.tankMachineGunWillTraverse,false);
  assert.equal(JSON.stringify(tank), before);
  tank.facing=0; tank.turretFacing=3; assert.equal(airborneReactionContext(m,tank,target,reacted).tankMachineGun,'coaxial');
  tank.turretFacing=1; assert.equal(airborneReactionContext(m,tank,target,reacted),null);
  reacted.add(infantry.id); assert.equal(airborneReactionContext(m,infantry,target,reacted),null);
  assert.equal(airborneReactionContext(m,unit('ally','american_infantry',2,3,'player'),target,new Set()),null);
});
test('infantry landing reactions never gain tank MG modifiers from their facing', () => {
  const m = mission();
  const target = unit('paratrooper', 'american_infantry', 3, 3, 'player');
  const infantry = unit('infantry', 'german_infantry', 2, 3);
  for (const facing of [0, 3]) {
    infantry.facing = facing;
    const ctx = airborneReactionContext(m, infantry, target, new Set());
    assert(ctx);
    const miss = rollMGAttack(ctx, { d6: () => 3 });
    assert.equal(miss.hitBreakdown.frontArc, 0);
    assert.deepEqual(miss.hitModifiers, []);
    assert.equal(miss.threshold, 4, 'size 3 + distance 1, independent of infantry facing');
    assert.equal(miss.hit, false);
    assert.equal(rollMGAttack(ctx, { d6: () => 4 }).hit, true);
  }
  const tank = unit('tank', 'stug3', 2, 3);
  const tankCtx = airborneReactionContext(m, tank, target, new Set());
  assert(tankCtx);
  const report = rollMGAttack(tankCtx, { d6: () => 3 });
  assert.equal(report.threshold, 3);
  assert.equal(report.hitBreakdown.frontArc, 0);
  assert.deepEqual(report.hitModifiers, [{ labelKey: 'dice.rule.tankHitModifier', value: -1 }]);
});

test('every-round and scheduled entries all remain eligible; invalid authoring rejected', () => {
  const events=[{effectType:'none'}, {effectType:'airborne_support',reinforcementSide:'friendly',turns:[1,3,5]}, {effectType:'none',turns:'every'}];
  assert.equal(roundEventsForTurn(events,1).length,3); assert.equal(roundEventsForTurn(events,2).length,2); assert.deepEqual(validateRoundEvents(events),[]);
  for (const turns of [[],[0],[1,1],[1.5],'1,3']) assert(validateRoundEvents([{effectType:'none',turns}]).length);
  assert(validateRoundEvents([{effectType:'unknown'}]).length); assert(validateRoundEvents([{effectType:'airborne_support'}]).length); assert(validateRoundEvents([{}]).length);
});
