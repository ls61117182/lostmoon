const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = function transpileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  module._compile(output, filename);
};

const { generateRandomMissionPackage } = require('../assets/scripts/core/RandomMissionGenerator.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { spawnMarkerKindForMission } = require('../assets/scripts/core/TurnEndEventApply.ts');
const battleSceneSource = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const { RNG } = require('../assets/scripts/core/Dice.ts');
const { axialToOffset, hexDistance, offsetToAxial, neighbor } = require('../assets/scripts/core/HexGrid.ts');

const allowedTerrain = {
  europe: new Set(['f', 'r', 'm', 'F', 'w']),
  pacific: new Set(['c', 'a', 'T', 'B', 'H']),
};

const threatByKind = {
  infantry: 1, officer: 1, panzer3: 2, panzer4: 3, tiger: 5,
  japanese_infantry: 1, type95: 2, type97: 3, at_gun: 3, heavy_artillery: 4,
};

const targetSpawnEffect = {
  infantry: 'infantry_spawn',
  panzer3: 'panzer3_spawn',
  panzer4: 'panzer4_spawn',
  tiger: 'tiger_spawn',
  japanese_infantry: 'infantry_spawn',
  type95: 'type95_spawn',
  type97: 'type97_spawn',
};

assert.strictEqual(spawnMarkerKindForMission('random_europe_1', 'panzer3', 'rid'), 'eid');
assert.strictEqual(spawnMarkerKindForMission('random_pacific_1', 'type95', 'rid'), 'eid');
assert.strictEqual(spawnMarkerKindForMission('random_pacific_1', 'japanese_infantry', 'eid'), 'rid');
assert.strictEqual(spawnMarkerKindForMission('random_pacific_1', 'at_gun', 'eid'), 'rid');
assert.strictEqual(spawnMarkerKindForMission('random_pacific_1', 'heavy_artillery', 'eid'), 'rid');
assert.strictEqual(spawnMarkerKindForMission('mission_pacific_01', 'type95', 'rid'), 'rid');
assert.match(battleSceneSource, /if \(isControlledATGun\(u\)\) this\.drawATGunCrewMaybeAnim\(u\)/,
  'controlled AT-gun crews must render in every game mode');
assert.doesNotMatch(battleSceneSource,
  /GameSession\.gameMode === 'hardcore' && isControlledATGun\(u\)[\s\S]*?drawATGunCrewMaybeAnim/,
  'AT-gun crew rendering must not be hidden outside hardcore mode');

for (let seed = 1; seed <= 30; seed++) {
  const landing = generateRandomMissionPackage('pacific', seed, { pacificBattleType: 'landing' }).mission;
  const inland = generateRandomMissionPackage('pacific', seed, { pacificBattleType: 'inland' }).mission;
  const beachCount = mission => mission.tiles.flat().filter(tile => tile?.t === 'B').length;
  assert(beachCount(landing) >= 5 && beachCount(landing) <= 13,
    `${landing.id}: forced landing battle must contain 5..13 beach cells`);
  assert.strictEqual(beachCount(inland), 0, `${inland.id}: forced inland battle cannot contain beach cells`);
}

function countTiles(mission) {
  const counts = {};
  let active = 0;
  let buildings = 0;
  let hedgeEdges = 0;
  let breakwaterEdges = 0;
  const eids = new Set();
  const rids = new Set();
  for (const row of mission.tiles) {
    for (const tile of row) {
      if (!tile) continue;
      active++;
      counts[tile.t] = (counts[tile.t] ?? 0) + 1;
      if (tile.bd) buildings++;
      if (tile.h) hedgeEdges += [...tile.h].filter(value => value === '1').length;
      if (tile.bw) breakwaterEdges += [...tile.bw].filter(value => value === '1').length;
      if (tile.eid) eids.add(tile.eid);
      if (tile.rid) rids.add(tile.rid);
    }
  }
  return { counts, active, buildings, hedgeEdges, breakwaterEdges, eids, rids };
}

function assertTankRoute(loaded, mission) {
  const start = offsetToAxial({ col: 0, row: 3 });
  const exit = offsetToAxial({ col: 7, row: 2 });
  const queue = [start];
  const seen = new Set([`${start.q},${start.r}`]);
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (let dir = 0; dir < 6; dir++) {
      const next = neighbor(current, dir);
      const nextKey = `${next.q},${next.r}`;
      if (seen.has(nextKey) || !loaded.map.canTankCrossEdge(current, next)) continue;
      seen.add(nextKey);
      queue.push(next);
    }
  }
  assert(seen.has(`${exit.q},${exit.r}`), `${mission.id}: player route must reach the exit`);
  for (const tile of loaded.map.all()) {
    if (!loaded.map.canTankEnter(tile.pos)) continue;
    assert(seen.has(`${tile.pos.q},${tile.pos.r}`),
      `${mission.id}: every tank-passable tile must connect to the player start region`);
  }
}

function tileAt(mission, pos) {
  return mission.tiles[pos.row]?.[pos.col] ?? null;
}

function adjacentOffset(pos, dir) {
  return axialToOffset(neighbor(offsetToAxial(pos), dir));
}

function assertSmoothEuropeanRoad(mission) {
  const roadTiles = [];
  const exits = [];
  for (let row = 0; row < mission.rows; row++) {
    for (let col = 0; col < mission.cols; col++) {
      const pos = { col, row };
      const tile = tileAt(mission, pos);
      if (!tile) continue;
      if (tile.h) {
        for (let dir = 0; dir < 6; dir++) {
          if (tile.h[dir] !== '1') continue;
          assert.notStrictEqual(tile.t, 'r', `${mission.id}: hedge cannot originate on a road tile`);
          assert.notStrictEqual(tileAt(mission, adjacentOffset(pos, dir))?.t, 'r',
            `${mission.id}: hedge cannot touch a road tile`);
        }
      }
      if (!tile.rd) continue;
      roadTiles.push(pos);
      const directions = [...tile.rd].map((value, dir) => value === '1' ? dir : -1).filter(dir => dir >= 0);
      assert.strictEqual(directions.length, 2, `${mission.id}: every road tile must have two connections`);
      for (const dir of directions) {
        if (!tileAt(mission, adjacentOffset(pos, dir))) exits.push({ pos, dir });
      }
    }
  }
  assert.strictEqual(exits.length, 2, `${mission.id}: road must have exactly two boundary exits`);

  const visited = new Set();
  let current = exits[0].pos;
  let backDirection = exits[0].dir;
  let incomingHeading = (backDirection + 3) % 6;
  while (true) {
    const currentKey = `${current.col},${current.row}`;
    assert(!visited.has(currentKey), `${mission.id}: road cannot loop`);
    visited.add(currentKey);
    const tile = tileAt(mission, current);
    const outgoing = [...tile.rd]
      .map((value, dir) => value === '1' && dir !== backDirection ? dir : -1)
      .find(dir => dir >= 0);
    assert.notStrictEqual(outgoing, undefined, `${mission.id}: road must continue`);
    const turn = (outgoing - incomingHeading + 6) % 6;
    assert([0, 1, 5].includes(turn), `${mission.id}: road turn must be at most 60 degrees`);
    if (tile.t === 'w') assert.strictEqual(turn, 0, `${mission.id}: bridge road must be straight`);

    const next = adjacentOffset(current, outgoing);
    if (!tileAt(mission, next)) break;
    const nextTile = tileAt(mission, next);
    assert(nextTile.rd && nextTile.rd[(outgoing + 3) % 6] === '1',
      `${mission.id}: road connections must be reciprocal`);
    current = next;
    incomingHeading = outgoing;
    backDirection = (outgoing + 3) % 6;
  }
  assert.strictEqual(visited.size, roadTiles.length, `${mission.id}: all road tiles must form one route`);
}

function assertEuropeanForestClusters(mission) {
  const forestKeys = new Set();
  for (let row = 0; row < mission.rows; row++) {
    for (let col = 0; col < mission.cols; col++) {
      if (tileAt(mission, { col, row })?.t === 'F') forestKeys.add(`${col},${row}`);
    }
  }
  const visited = new Set();
  for (const startKey of forestKeys) {
    if (visited.has(startKey)) continue;
    const [col, row] = startKey.split(',').map(Number);
    const queue = [{ col, row }];
    visited.add(startKey);
    for (let head = 0; head < queue.length; head++) {
      for (let dir = 0; dir < 6; dir++) {
        const next = adjacentOffset(queue[head], dir);
        const nextKey = `${next.col},${next.row}`;
        if (!forestKeys.has(nextKey) || visited.has(nextKey)) continue;
        visited.add(nextKey);
        queue.push(next);
      }
    }
    assert(queue.length <= 2, `${mission.id}: European forest clusters should contain at most two cells`);
  }
}

function assertRidPriority(pkg) {
  const mission = pkg.mission;
  const active = [];
  const boundaries = [];
  const eidKeys = new Set();
  const ridPositions = [];
  for (let row = 0; row < mission.rows; row++) {
    for (let col = 0; col < mission.cols; col++) {
      const pos = { col, row };
      const tile = tileAt(mission, pos);
      if (!tile) continue;
      active.push(pos);
      if (tile.eid) eidKeys.add(`${col},${row}`);
      if (tile.rid) ridPositions.push(pos);
      if ([0, 1, 2, 3, 4, 5].some(dir => !tileAt(mission, adjacentOffset(pos, dir)))) boundaries.push(pos);
    }
  }
  const reserved = new Set(['0,3', '7,2']);
  for (const enemy of mission.enemies) {
    if (enemy.kind === 'truck' && enemy.at) reserved.add(`${enemy.at.col},${enemy.at.row}`);
  }
  const start = offsetToAxial({ col: 0, row: 3 });
  const eligibleEids = active.filter(pos => {
    const tile = tileAt(mission, pos);
    return !reserved.has(`${pos.col},${pos.row}`)
      && !['F', 'w', 'dw', 'H', 'B'].includes(tile.t)
      && hexDistance(offsetToAxial(pos), start) >= 4;
  });
  if (eligibleEids.filter(pos => tileAt(mission, pos).bd !== 1).length >= 6) {
    assert([...eidKeys].every(eidKey => {
      const [col, row] = eidKey.split(',').map(Number);
      return tileAt(mission, { col, row }).bd !== 1;
    }), `${mission.id}: eid markers should preserve buildings for infantry rid markers`);
  }
  const candidates = active.filter(pos => {
    const tile = tileAt(mission, pos);
    return !reserved.has(`${pos.col},${pos.row}`)
      && !eidKeys.has(`${pos.col},${pos.row}`)
      && !['w', 'dw', 'H', 'B'].includes(tile.t)
      && hexDistance(offsetToAxial(pos), start) >= 3;
  });
  const score = pos => {
    const tile = tileAt(mission, pos);
    const terrainPriority = tile.bd === 1 ? 0 : (tile.t === 'F' ? 1 : 2);
    const edgeDistance = Math.min(...boundaries.map(boundary =>
      hexDistance(offsetToAxial(pos), offsetToAxial(boundary))));
    return terrainPriority * 100 + edgeDistance;
  };
  const ridKeys = new Set(ridPositions.map(pos => `${pos.col},${pos.row}`));
  const unselected = candidates.filter(pos => !ridKeys.has(`${pos.col},${pos.row}`));
  assert.strictEqual(ridPositions.length, 6);
  if (unselected.length > 0) {
    assert(Math.max(...ridPositions.map(score)) <= Math.min(...unselected.map(score)),
      `${mission.id}: rid markers must prioritize buildings, then European forests`);
  }
  for (const pos of active) {
    const tile = tileAt(mission, pos);
    if (tile.eid || tile.rid) {
      assert(!['B', 'w', 'dw'].includes(tile.t), `${mission.id}: eid/rid cannot use beach or water tiles`);
    }
  }
}

function assertPacificTerrainRules(mission, stats) {
  assert.strictEqual(stats.counts.dw ?? 0, 0, `${mission.id}: deep water is excluded from random Pacific maps`);
  assert.strictEqual(stats.breakwaterEdges, 0, `${mission.id}: breakwaters are excluded from random Pacific maps`);
  const beachCount = stats.counts.B ?? 0;
  if (beachCount > 0) {
    assert.strictEqual(tileAt(mission, { col: 0, row: 3 }).t, 'B', `${mission.id}: landing map must start on beach`);
    if (beachCount > 1) {
      assert([0, 1, 2, 3, 4, 5].some(dir => tileAt(mission, adjacentOffset({ col: 0, row: 3 }, dir))?.t === 'B'),
        `${mission.id}: beach must extend from the player start`);
    }
    let startSideBeach = 0;
    let evacuationSideBeach = 0;
    const startAxial = offsetToAxial({ col: 0, row: 3 });
    const evacuationAxial = offsetToAxial({ col: 7, row: 2 });
    for (let row = 0; row < mission.rows; row++) {
      for (let col = 0; col < mission.cols; col++) {
        const pos = { col, row };
        if (tileAt(mission, pos)?.t !== 'B') continue;
        const axial = offsetToAxial(pos);
        const startDistance = hexDistance(axial, startAxial);
        const evacuationDistance = hexDistance(axial, evacuationAxial);
        if (startDistance < evacuationDistance) startSideBeach++;
        else if (evacuationDistance < startDistance) evacuationSideBeach++;
      }
    }
    assert(startSideBeach >= evacuationSideBeach, `${mission.id}: beaches must favor the player-start side`);
  }

  const airstripKeys = new Set();
  let evacuationSideTrees = 0;
  let startSideTrees = 0;
  const startAxial = offsetToAxial({ col: 0, row: 3 });
  const evacuationAxial = offsetToAxial({ col: 7, row: 2 });
  for (let row = 0; row < mission.rows; row++) {
    for (let col = 0; col < mission.cols; col++) {
      const pos = { col, row };
      const tile = tileAt(mission, pos);
      if (!tile) continue;
      if (tile.t === 'T') {
        const axial = offsetToAxial(pos);
        const startDistance = hexDistance(axial, startAxial);
        const evacuationDistance = hexDistance(axial, evacuationAxial);
        if (evacuationDistance < startDistance) evacuationSideTrees++;
        else if (startDistance < evacuationDistance) startSideTrees++;
      }
      if (tile.t === 'H') {
        assert([0, 1, 2, 3, 4, 5].every(dir => tileAt(mission, adjacentOffset(pos, dir))?.t !== 'H'),
          `${mission.id}: rocky high ground cannot be adjacent`);
      }
      if (tile.t !== 'a') continue;
      airstripKeys.add(`${col},${row}`);
      const dirs = [...(tile.rd ?? '')].map((value, dir) => value === '1' ? dir : -1).filter(dir => dir >= 0);
      assert.strictEqual(dirs.length, 2, `${mission.id}: airstrip tile must have exactly two directions`);
      assert.strictEqual((dirs[0] + 3) % 6, dirs[1], `${mission.id}: airstrip directions must be opposite`);
    }
  }
  assert(evacuationSideTrees >= startSideTrees,
    `${mission.id}: Pacific trees must favor the evacuation side`);
  const visited = new Set();
  for (const startKey of airstripKeys) {
    if (visited.has(startKey)) continue;
    const [col, row] = startKey.split(',').map(Number);
    const queue = [{ col, row }];
    visited.add(startKey);
    let size = 0;
    for (let head = 0; head < queue.length; head++) {
      const pos = queue[head];
      size++;
      const tile = tileAt(mission, pos);
      for (let dir = 0; dir < 6; dir++) {
        if (tile.rd?.[dir] !== '1') continue;
        const next = adjacentOffset(pos, dir);
        const nextKey = `${next.col},${next.row}`;
        const nextTile = tileAt(mission, next);
        if (!airstripKeys.has(nextKey) || nextTile?.rd?.[(dir + 3) % 6] !== '1' || visited.has(nextKey)) continue;
        visited.add(nextKey);
        queue.push(next);
      }
    }
    assert(size >= 3, `${mission.id}: each airstrip segment needs endpoints at least distance 2 apart`);
  }
}

function assertHighValueTarget(mission) {
  const target = mission.objective.kind;
  if (!target) return;
  const counts = new Map();
  for (const enemy of mission.enemies) counts.set(enemy.kind, (counts.get(enemy.kind) ?? 0) + 1);
  const kinds = [...counts.keys()].filter(kind => threatByKind[kind]);
  const maxSingle = Math.max(...kinds.map(kind => threatByKind[kind]));
  const maxAggregate = Math.max(...kinds.map(kind => threatByKind[kind] * counts.get(kind)));
  const targetThreat = threatByKind[target];
  const targetCount = counts.get(target) ?? 0;
  assert(targetThreat === maxSingle || targetThreat * targetCount === maxAggregate,
    `${mission.id}: evacuation target must have highest single or aggregate threat`);
  assert(!(targetThreat === 1 && targetCount === 1), `${mission.id}: a lone infantry cannot be the evacuation target`);
}

function assertEventTable(pkg) {
  for (let sum = 2; sum <= 12; sum++) {
    const matches = pkg.turnEndEvents.filter(row => sum >= row.sumMin && sum <= row.sumMax);
    assert.strictEqual(matches.length, 1, `${pkg.mission.id}: 2d6 sum ${sum} must have exactly one event`);
  }
  assert(pkg.turnEndEvents.some(row => row.effectType === 'commander_extra'));
  const objective = pkg.mission.objective;
  if (objective.type === 'destroy_all_enemies') {
    assert(!pkg.turnEndEvents.some(row => row.effectType.endsWith('_spawn')),
      `${pkg.mission.id}: destroy-all mission cannot contain reinforcements`);
  }
  if (objective.kind && targetSpawnEffect[objective.kind]) {
    assert(!pkg.turnEndEvents.some(row => row.effectType === targetSpawnEffect[objective.kind]),
      `${pkg.mission.id}: target kind cannot reinforce`);
  }
}

let gunFacingTotal = 0;
let gunFacingThree = 0;
let pacificLandingMaps = 0;
let pacificInlandMaps = 0;

for (const theater of ['europe', 'pacific']) {
  for (let seed = 1; seed <= 150; seed++) {
    const pkg = generateRandomMissionPackage(theater, seed);
    const mission = pkg.mission;
    assert.strictEqual(mission.theater, theater);
    assert.strictEqual(mission.cols, 8);
    assert.strictEqual(mission.rows, 6);
    assert.deepStrictEqual(mission.sherman.at, { col: 0, row: 3 });
    assert.strictEqual(mission.sherman.facing, 0);
    assert.strictEqual(pkg.turnEndEvents.every(row => row.missionId === mission.id), true);

    const stats = countTiles(mission);
    assert.strictEqual(stats.active, 36);
    assert.deepStrictEqual([...stats.eids].sort(), [1, 2, 3, 4, 5, 6]);
    assert.deepStrictEqual([...stats.rids].sort(), [1, 2, 3, 4, 5, 6]);
    for (const terrain of Object.keys(stats.counts)) {
      assert(allowedTerrain[theater].has(terrain), `${mission.id}: illegal ${theater} terrain ${terrain}`);
    }

    if (theater === 'europe') {
      assert((stats.counts.w ?? 0) >= 0 && (stats.counts.w ?? 0) <= 8);
      assert((stats.counts.r ?? 0) >= 4);
      assert((stats.counts.F ?? 0) >= 0 && (stats.counts.F ?? 0) <= 6);
      assert((stats.counts.m ?? 0) >= 1 && (stats.counts.m ?? 0) <= 13);
      assert((stats.counts.f ?? 0) >= 12 && (stats.counts.f ?? 0) <= 26);
      assert(stats.buildings >= 3 && stats.buildings <= 6);
      assert(stats.hedgeEdges >= 1 && stats.hedgeEdges <= 20);
      assertSmoothEuropeanRoad(mission);
      assertEuropeanForestClusters(mission);
    } else {
      const beachCount = stats.counts.B ?? 0;
      assert(beachCount === 0 || (beachCount >= 5 && beachCount <= 13),
        `${mission.id}: Pacific map must be either a 5..13-cell landing or a beachless inland battle`);
      if (beachCount > 0) pacificLandingMaps++;
      else pacificInlandMaps++;
      assert((stats.counts.T ?? 0) >= 5 && (stats.counts.T ?? 0) <= 15);
      assert((stats.counts.H ?? 0) >= 0 && (stats.counts.H ?? 0) <= 5);
      assert((stats.counts.c ?? 0) >= 12 && (stats.counts.c ?? 0) <= 23);
      assert(stats.buildings >= 4 && stats.buildings <= 7);
      assert.strictEqual(mission.usCasualtyLimit, 10);
      assertPacificTerrainRules(mission, stats);
    }

    const objective = mission.objective;
    assert(!mission.enemies.some(enemy => enemy.kind === 'officer'), `${mission.id}: random enemies exclude officers`);
    const initialThreat = mission.enemies.reduce((sum, enemy) => sum + (threatByKind[enemy.kind] ?? 0), 0);
    assert(initialThreat >= 10 && initialThreat <= 12, `${mission.id}: initial enemy threat must be 10..12`);
    for (const gun of mission.enemies.filter(enemy => enemy.kind === 'at_gun' || enemy.kind === 'heavy_artillery')) {
      assert(gun.at, `${mission.id}: guns must have fixed rid positions`);
      assert(tileAt(mission, gun.at).rid, `${mission.id}: guns must deploy on rid tiles`);
      const allowedFacings = gun.at.row < 3 ? [2, 3] : [3, 4];
      assert(allowedFacings.includes(gun.facing), `${mission.id}: gun facing is invalid for its map half`);
      gunFacingTotal++;
      if (gun.facing === 3) gunFacingThree++;
      if (gun.kind === 'heavy_artillery') {
        let current = adjacentOffset(gun.at, gun.facing);
        while (tileAt(mission, current)) {
          const tile = tileAt(mission, current);
          assert.notStrictEqual(tile.t, 'H', `${mission.id}: heavy artillery line cannot contain rocky high ground`);
          assert.notStrictEqual(tile.bd, 1, `${mission.id}: heavy artillery line cannot contain another building`);
          assert(!mission.enemies.some(enemy => enemy !== gun && enemy.kind === 'heavy_artillery'
            && enemy.at?.col === current.col && enemy.at?.row === current.row),
          `${mission.id}: heavy artillery line cannot contain another heavy artillery unit`);
          current = adjacentOffset(current, gun.facing);
        }
      }
    }
    assert(['destroy_all_enemies', 'destroy_kind_evac', 'destroy_truck'].includes(objective.type));
    if (objective.type === 'destroy_kind_evac') {
      assert.deepStrictEqual(objective.evacAt, { col: 7, row: 2 });
      assert.strictEqual(objective.evacExitDir, 0);
      if (objective.kind) {
        assert(mission.enemies.some(enemy => enemy.kind === objective.kind),
          `${mission.id}: objective target must be present initially`);
      }
    }
    assertHighValueTarget(mission);
    if (objective.type === 'destroy_truck') {
      assert.strictEqual(theater, 'europe');
      assert(mission.enemies.some(enemy => enemy.kind === 'truck' && enemy.at));
      assert.strictEqual(mission.truckPath?.length, 8,
        `${mission.id}: truck interception road must be exactly 8 cells long`);
      assert(pkg.turnEndEvents.some(row => row.effectType === 'german_truck_move'));
    }

    assertEventTable(pkg);
    assertRidPriority(pkg);
    const loaded = loadMission(mission, new RNG(seed));
    for (const gun of loaded.enemies.filter(enemy => enemy.kind === 'at_gun')) {
      assert.strictEqual(gun.atGunCrewAlive, true, `${mission.id}: AT gun must load as a controlled composite unit`);
      assert.strictEqual(gun.atGunCrewKind, 'japanese_infantry', `${mission.id}: AT gun needs its embedded Japanese crew`);
      assert(!loaded.enemies.some(enemy => enemy.kind === 'japanese_infantry'
        && enemy.pos.q === gun.pos.q && enemy.pos.r === gun.pos.r),
      `${mission.id}: AT gun crew must not be a separate infantry unit`);
    }
    assertTankRoute(loaded, mission);
  }
}

assert(gunFacingTotal > 20, 'gun-facing distribution needs enough samples');
assert(pacificLandingMaps > 0 && pacificInlandMaps > 0,
  'Pacific generation must include both landing and inland battles');
const directionThreeShare = gunFacingThree / gunFacingTotal;
assert(directionThreeShare >= 0.55 && directionThreeShare <= 0.77,
  `direction 3 should occur about 66% of the time, got ${directionThreeShare}`);

console.log('random mission generator tests passed');
