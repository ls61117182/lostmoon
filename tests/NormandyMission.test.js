const fs = require('node:fs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { HexMap, neighbor, neighbors, offsetToAxial, axialToOffset } = require('../assets/scripts/core/HexGrid.ts');
const { RNG } = require('../assets/scripts/core/Dice.ts');
const { getChapterLevels, getImportableMissionLevels } = require('../assets/scripts/core/LevelDB.ts');
const { checkOutcome, destroyKindEvacPrereqMet, isPlayerTankEvacDrive } = require('../assets/scripts/core/Objective.ts');
const { turnEndEventsForMission, turnEndRowForSum } = require('../assets/scripts/core/TurnEndEventDB.ts');
const { roundEventsForTurn, validateRoundEvents } = require('../assets/scripts/core/RoundEvents.ts');
const { prepareTurnEndEvent } = require('../assets/scripts/core/TurnEndEventApply.ts');
const { isAttachedATGunCrew, isFootUnit } = require('../assets/scripts/core/types.ts');
const { canAttack } = require('../assets/scripts/core/Combat.ts');
const data = JSON.parse(fs.readFileSync('assets/resources/missions/mission_13.json', 'utf8'));
function safePath(mission, destination, exclude = new Set()) {
  const { map, sherman } = mission, target = HexMap.keyOf(destination);
  const queue = [{ pos: sherman.pos, path: [sherman.pos] }], seen = new Set([HexMap.keyOf(sherman.pos)]);
  for (let i = 0; i < queue.length; i++) {
    const { pos, path } = queue[i];
    if (HexMap.keyOf(pos) === target) return path;
    for (const next of neighbors(pos)) {
      const key = HexMap.keyOf(next), tile = map.get(next);
      if (seen.has(key) || exclude.has(key) || tile?.steelHedgehogs || !map.canTankCrossEdge(pos, next, { faction: 'usa' })) continue;
      seen.add(key); queue.push({ pos: next, path: [...path, next] });
    }
  }
  return null;
}

test('European mission 13 is listed, importable and has a real Cocos JSON asset', () => {
  const standard = JSON.parse(fs.readFileSync('assets/resources/missions/mission_12.json', 'utf8'));
  assert.deepEqual([data.cols, data.rows], [standard.cols, standard.rows]);
  assert.equal(data.tiles.length, data.rows);
  assert.ok(data.tiles.every(row => row.length === data.cols));
  const levels = getChapterLevels('europe');
  assert.equal(levels.length, 13);
  const last = levels.at(-1); assert.equal(last.id, 13); assert.equal(last.missionId, data.id); assert.equal(last.titleKey, 'level.13.title');
  assert.equal(last.alwaysUnlocked, true, 'the new mission can be tried without replaying mission 12 on an old save');
  assert.ok(getImportableMissionLevels().some(level => level.missionId === data.id));
  assert.equal(JSON.parse(fs.readFileSync(`assets/resources/${last.missionPath}.json.meta`, 'utf8')).importer, 'json');
});

test('fixed deployment loads for different seeds with both American support squads and all five defenders', () => {
  for (const seed of [1, 2, 17, 72]) {
    const mission = loadMission(data, new RNG(seed));
    assert.equal(mission.map.all().length, 48);
    assert.deepEqual(axialToOffset(mission.sherman.pos), { col: 1, row: 3 });
    assert.equal(mission.sherman.facing, 0);
    assert.equal(mission.allies.length, 2);
    assert.ok(mission.allies.every(unit => unit.kind === 'american_infantry' && unit.faction === 'usa' && unit.sideId === 'player'));
    assert.equal(mission.enemies.filter(unit => !isAttachedATGunCrew(unit)).length, 5);
    for (const unit of [mission.sherman, ...mission.allies, ...mission.enemies]) assert.ok(mission.map.canUnitEnter(unit.pos, unit.faction));
    assert.equal(checkOutcome(mission), 'ongoing');
    assert.ok(mission.enemies.filter(unit => !isFootUnit(unit)).every(enemy => !canAttack({ attacker: enemy, target: mission.sherman, map: mission.map }).ok), 'landing does not start on an aligned enemy gun ray');
  }
});

test('player starts in real shallow water and can drive onto sand with normal movement', () => {
  const mission = loadMission(data), start = mission.sherman.pos, landing = neighbor(start, mission.sherman.facing);
  const tile = mission.map.get(start), shore = mission.map.get(landing);
  assert.equal(data.tiles[3][1].t, 'esw');
  assert.equal(tile.terrain, 'beach', 'reuses the Pacific front-beach runtime rules');
  assert.equal(tile.displayOnly, undefined, 'the water start is a playable hex');
  assert.deepEqual(axialToOffset(landing), { col: 2, row: 3 });
  assert.equal(shore.terrain, 'europe_beach');
  assert.equal(mission.map.canTankCrossEdge(start, landing, { faction: mission.sherman.faction }), true);
  assert.ok(![...mission.allies, ...mission.enemies].some(unit => unit.pos.q === landing.q && unit.pos.r === landing.r));
  const { actionDicePool } = require('../assets/scripts/core/ActionDice.ts');
  const { tileForbidsConcealment } = require('../assets/scripts/core/types.ts');
  assert.equal(tileForbidsConcealment(tile), true);
  for (const hardcore of [false, true]) assert.ok(actionDicePool({ terrain: tile.terrain, subPhase: 'movement', hardcore, mobility: mission.sherman.stats.mobility, crew: mission.sherman.crew, hatchOpen: false }) >= 1);
});

test('both seawall breaches lead to the road exit without entering hedgehogs or crossing a wall', () => {
  const mission = loadMission(data), upper = offsetToAxial({ col: 5, row: 1 }), lower = offsetToAxial({ col: 5, row: 4 });
  const exit = offsetToAxial(data.objective.evacAt);
  for (const breach of [upper, lower]) {
    const other = breach === upper ? lower : upper;
    const path = safePath(mission, breach, new Set([HexMap.keyOf(other)])); assert.ok(path, 'each breach has a safe independent tank approach');
    for (let i = 1; i < path.length; i++) assert.ok(!mission.map.get(path[i]).steelHedgehogs);
    const fromBreach = { ...mission, sherman: { ...mission.sherman, pos: breach } };
    assert.ok(safePath(fromBreach, exit), 'road is reachable beyond the breach');
  }
  const excluded = new Set([HexMap.keyOf(upper), HexMap.keyOf(lower)]);
  assert.equal(safePath(mission, exit, excluded), null, 'there is no unintended normal-movement bypass of both breaches');
  const terrain = mission.map.all();
  assert.ok(terrain.filter(tile => tile.steelHedgehogs).length >= 6);
  assert.ok(terrain.filter(tile => tile.crater).length >= 5);
  assert.ok(terrain.some(tile => tile.barbedWire?.includes(1)));
  assert.ok(terrain.some(tile => tile.barbedWire?.includes(2)));
  assert.ok(terrain.filter(tile => tile.displayOnly).every(tile => tile.terrain === 'water'));
});

test('both target kinds are required; other infantry and the reserve tank do not gate evacuation', () => {
  const mission = loadMission(data), objective = data.objective, exit = offsetToAxial(objective.evacAt), to = neighbor(exit, 0);
  mission.sherman.pos = exit;
  assert.equal(mission.map.has(to), false);
  assert.equal(isPlayerTankEvacDrive(mission, exit, 0, 1, to), false);
  mission.enemies.find(unit => unit.kind === 'german_heavy_artillery').destroyed = true;
  assert.equal(destroyKindEvacPrereqMet(mission, objective), false);
  mission.enemies.find(unit => unit.kind === 'pak38').destroyed = true;
  assert.equal(destroyKindEvacPrereqMet(mission, objective), true);
  assert.equal(isPlayerTankEvacDrive(mission, exit, 0, 1, to), true);
  assert.equal(isPlayerTankEvacDrive(mission, exit, 3, -1, to), true);
  assert.equal(isPlayerTankEvacDrive(mission, exit, 1, 1, neighbor(exit, 1)), false);
  assert.equal(checkOutcome(mission), 'ongoing', 'killing targets alone is not victory');
  mission.playerTankEvacuated = true; assert.equal(checkOutcome(mission), 'victory');
  mission.sherman.destroyed = true; assert.equal(checkOutcome(mission), 'defeat');
});

test('event table covers every 2d6 sum exactly once and timed reserve spawns at every dice marker', () => {
  const rows = turnEndEventsForMission(data.eventTableId);
  assert.equal(rows.length, 3);
  for (let sum = 2; sum <= 12; sum++) {
    assert.equal(rows.filter(row => sum >= row.sumMin && sum <= row.sumMax).length, 1);
    assert.ok(turnEndRowForSum(data.eventTableId, sum));
  }
  assert.deepEqual(validateRoundEvents(data.roundEvents), []);
  for (let turn = 1; turn <= 12; turn++) assert.equal(roundEventsForTurn(data.roundEvents, turn).length, turn === 3 || turn === 6 ? 1 : 0);
  assert.equal(roundEventsForTurn(data.roundEvents, 3)[0].effectType, 'commander_extra');
  const reserve = roundEventsForTurn(data.roundEvents, 6)[0];
  assert.equal(reserve.effectType, 'panzer4_spawn'); assert.equal(reserve.reinforcementSide, 'enemy');
  for (let die = 1; die <= 6; die++) {
    const mission = loadMission(data), before = mission.enemies.length;
    const prepared = prepareTurnEndEvent({ ...reserve, missionId: data.id, sumMin: 2, sumMax: 12, diceCount: 2 }, [1, 1], 2,
      { mission, rng: { d6: () => die }, nextEnemyId: () => `reserve-${die}`, hardcoreReload: true });
    prepared.apply();
    assert.equal(mission.enemies.length, before + 1);
    const tank = mission.enemies.at(-1);
    assert.equal(tank.kind, 'panzer4_f'); assert.equal(tank.faction, 'german'); assert.equal(tank.sideId, 'enemy');
    assert.equal(mission.map.canTankEnter(tank.pos, tank.faction), true);
    assert.equal(mission.map.get(tank.pos).steelHedgehogs, undefined);
  }
});
