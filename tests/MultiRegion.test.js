const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { generateMultiRegionPackage, MULTI_REGION_POWER } = require('../assets/scripts/core/MultiRegionGenerator.ts');
const { generateRandomMissionPackage } = require('../assets/scripts/core/RandomMissionGenerator.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { RNG } = require('../assets/scripts/core/Dice.ts');
const { HexMap, neighbors, offsetToAxial, axialToOffset, axialToPixel, neighbor } = require('../assets/scripts/core/HexGrid.ts');
const runtime = require('../assets/scripts/core/MultiRegion.ts');
const { canAttack, canMGAttack } = require('../assets/scripts/core/Combat.ts');
const { computePlayerVisibleHexes, computeRadioSharedVisibleHexes } = require('../assets/scripts/core/FogOfWar.ts');
const { checkOutcome } = require('../assets/scripts/core/Objective.ts');
const { applyRegionalReinforcement } = require('../assets/scripts/core/MultiRegionEvents.ts');
const { markAmbushAction } = require('../assets/scripts/core/Ambush.ts');
const { clearLockedFire } = require('../assets/scripts/core/LockedFire.ts');
const { missionWithSelectedPlayerTank } = require('../assets/scripts/core/PlayerTankSelection.ts');
const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
const fixture = (seed = 20261026, count = 4) => loadMission(generateMultiRegionPackage(seed, count).mission, new RNG(1), { hardcore: true });

test('each region exactly matches the ordinary 8-column, 6-row, 36-cell footprint and camera scale', () => {
  const ordinary = generateRandomMissionPackage('europe', 12345).mission;
  const expected = ordinary.tiles.flatMap((row, r) => row.flatMap((tile, col) => tile ? [`${col},${r}`] : [])).sort();
  const Scene = sceneMethods(['mapFitScale'], { axialToPixel, offsetToAxial });
  for (const count of [4, 5, 6]) {
    const m = fixture(20261026, count);
    for (const region of m.data.multiRegion.regions) {
      const positions = region.tileKeys.map(key => { const [q, r] = key.split(',').map(Number); return axialToOffset({ q, r }); });
      const minCol = Math.min(...positions.map(p => p.col)), minRow = Math.min(...positions.map(p => p.row));
      assert.deepEqual(positions.map(p => `${p.col - minCol},${p.row - minRow}`).sort(), expected);
      assert.equal(Math.max(...positions.map(p => p.col)) - minCol + 1, 8);
      assert.equal(Math.max(...positions.map(p => p.row)) - minRow + 1, 6);
      const scene = new Scene();
      scene.cameraReferenceTiles = () => region.tileKeys.map(key => {
        const [q, r] = key.split(',').map(Number); return m.map.get({ q, r });
      });
      assert.equal(scene.mapFitScale(), 1, 'a standard-sized region must not be reduced to fit a taller template');
    }
  }
});

test('new games take a fresh seed and randomize roads, water and terrain; explicit seeds remain reproducible', () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 100; const first = generateMultiRegionPackage();
    Date.now = () => 200; const second = generateMultiRegionPackage();
    assert.equal(first.mission.multiRegion.seed, 100);
    assert.equal(second.mission.multiRegion.seed, 200);
    assert.notDeepEqual(first.mission.tiles, second.mission.tiles);
    const signature = (pkg, terrain) => pkg.mission.tiles.map(row => row.map(tile => tile?.t === terrain ? '1' : '0').join('')).join('/');
    assert.notEqual(signature(first, 'w'), signature(second, 'w'));
    assert.notEqual(signature(first, 'r'), signature(second, 'r'));
    assert.deepEqual(first, generateMultiRegionPackage(100));
  } finally { Date.now = originalNow; }
});

test('random global roads and river are continuous across regions with reciprocal connections and legal bridges', () => {
  const rng = new RNG(712345);
  for (const count of [4, 5, 6]) for (let i = 0; i < 100; i++) {
    const seed = rng.intRange(1, 0xffffffff), m = fixture(seed, count);
    const water = m.map.all().filter(tile => tile.terrain === 'water');
    const waterKeys = new Set(water.map(tile => HexMap.keyOf(tile.pos))), queue = [water[0].pos], seen = new Set();
    for (let j = 0; j < queue.length; j++) {
      const key = HexMap.keyOf(queue[j]); if (seen.has(key)) continue; seen.add(key);
      queue.push(...neighbors(queue[j]).filter(pos => waterKeys.has(HexMap.keyOf(pos)) && !seen.has(HexMap.keyOf(pos))));
    }
    assert.equal(seen.size, water.length, `seed ${seed}: one uninterrupted river`);
    assert(new Set(water.map(tile => runtime.regionAt(m, tile.pos))).size >= 2);
    let crossRegionRoads = 0;
    for (const tile of m.map.all()) for (let d = 0; d < 6; d++) if (tile.roads?.[d]) {
      const next = m.map.get(neighbor(tile.pos, d));
      assert(next?.roads?.[(d + 3) % 6], `seed ${seed}: reciprocal road`);
      if (!m.map.sameRegion(tile.pos, next.pos)) crossRegionRoads++;
    }
    assert(crossRegionRoads > 0);
    for (const tile of water.filter(tile => tile.bridgeEnds)) {
      const [a, b] = tile.bridgeEnds;
      assert.equal((a + 3) % 6, b);
      for (const d of [a, b]) assert(m.map.canTankEnter(neighbor(tile.pos, d)));
    }
    const accessible = new Set(), landQueue = [m.sherman.pos];
    for (let j = 0; j < landQueue.length; j++) {
      const key = HexMap.keyOf(landQueue[j]); if (accessible.has(key)) continue; accessible.add(key);
      landQueue.push(...neighbors(landQueue[j]).filter(pos => m.map.canUnitCrossEdge(landQueue[j], pos, m.sherman) && !accessible.has(HexMap.keyOf(pos))));
    }
    for (const unit of [m.sherman, ...m.allies, ...m.enemies]) {
      assert(accessible.has(HexMap.keyOf(unit.pos)), `seed ${seed}: deployed unit reachable`);
    }
  }
});

test('global generation is deterministic; 4–6 hex regions tile without gaps or overlap', () => {
  for (const count of [4, 5, 6]) for (const seed of [1, 2, 42, 20261026, 987654]) {
    const pkg = generateMultiRegionPackage(seed, count);
    assert.deepEqual(pkg, generateMultiRegionPackage(seed, count));
    const m = loadMission(pkg.mission, new RNG(seed), { hardcore: true });
    assert.equal(m.map.all().length, 36 * count);
    assert.equal(m.map.regions.size, 36 * count);
    const visited = new Set(), queue = [m.sherman.pos];
    for (let i = 0; i < queue.length; i++) {
      const key = HexMap.keyOf(queue[i]); if (visited.has(key)) continue; visited.add(key);
      queue.push(...neighbors(queue[i]).filter(pos => m.map.canUnitCrossEdge(queue[i], pos, m.sherman) && !visited.has(HexMap.keyOf(pos))));
    }
    for (const unit of [m.sherman, ...m.allies, ...m.enemies]) assert(visited.has(HexMap.keyOf(unit.pos)), 'all deployed units reachable');
    assert(m.map.all().some(tile => tile.bridgeEnds));
    const regions = m.data.multiRegion.regions;
    for (const region of regions) {
      const roster = m.enemies.filter(unit => runtime.regionAt(m, unit.pos) === region.id);
      assert.equal(roster.reduce((sum, unit) => sum + MULTI_REGION_POWER[unit.kind], 0), region.enemyBudget);
    }
  }
});

test('first test mission has two companies, exactly four objective tanks, and intended opening control', () => {
  const m = fixture();
  assert.equal(m.allies.length, 15);
  assert.equal(m.enemies.filter(unit => unit.kind === 'panzer4').length, 4);
  assert.equal(missionWithSelectedPlayerTank(m.data, 'panther').playerTank.kind, 'sherman');
  for (const id of ['A1', 'A2']) {
    const units = runtime.regionalCombatants(m, id).filter(unit => unit.sideId === 'player');
    assert.equal(units.length, 8);
    assert.equal(units.filter(unit => unit.kind === 'sherman').length, 2);
    assert.equal(units.filter(unit => unit.kind === 'sherman76').length, 2);
    assert.equal(units.filter(unit => unit.kind === 'american_infantry').length, 4);
  }
  assert.deepEqual(m.multiRegionState.intel.map(intel => intel.state), ['contested', 'contested', 'enemy', 'enemy']);
  assert.equal(m.multiRegionState.intel[2].enemyPower, null);
});

test('cross-region shooting, MG and shared radio vision are blocked while movement remains legal', () => {
  const m = fixture();
  const border = m.map.all().flatMap(tile => neighbors(tile.pos).map(pos => [tile.pos, pos]))
    .find(([a, b]) => m.map.has(b) && !m.map.sameRegion(a, b) && m.map.canUnitCrossEdge(a, b, m.sherman));
  assert(border);
  m.sherman.pos = border[0]; m.enemies[0].pos = border[1];
  assert.equal(canAttack({ attacker: m.sherman, target: m.enemies[0], map: m.map }).ok, false);
  const infantry = m.enemies.find(unit => unit.kind === 'german_infantry') ?? { ...m.enemies[0], kind: 'german_infantry' };
  infantry.pos = border[1];
  assert.equal(canMGAttack({ attacker: m.sherman, target: infantry, map: m.map }).ok, false);
  m.allies[0].pos = border[1];
  for (const visible of [computePlayerVisibleHexes(m.map, m.sherman, m.allies, true), computeRadioSharedVisibleHexes(m.map, m.sherman, m.allies)]) {
    for (const key of visible) assert.equal(m.map.regions.get(key), runtime.regionAt(m, m.sherman.pos));
  }
});

test('minimap remains a start-of-turn snapshot and does not disclose enemy-held strength', () => {
  const m = fixture(); const original = JSON.stringify(m.multiRegionState.intel);
  m.enemies.filter(unit => runtime.regionAt(m, unit.pos) === 'A2').forEach(unit => { unit.destroyed = true; });
  runtime.refreshRegionIntel(m, 1); assert.equal(JSON.stringify(m.multiRegionState.intel), original);
  runtime.refreshRegionIntel(m, 2);
  assert.equal(m.multiRegionState.intel[1].state, 'friendly');
  assert.equal(m.multiRegionState.intel[2].enemyPower, null);
});

test('reinforcement gating uses actual control, the event side and strict N > X', () => {
  const m = fixture(); const region = m.data.multiRegion.regions[0];
  const allies = runtime.regionalCombatants(m, region.id).filter(unit => unit.sideId === 'player');
  for (let i = 8; i < 10; i++) m.allies.push({ ...allies[0], id: `test_${i}` });
  assert.equal(runtime.regionalReinforcementAllowed(m, 'A1', 'player'), true);
  m.allies.push({ ...allies[0], id: 'test_11' });
  assert.equal(runtime.regionalReinforcementAllowed(m, 'A1', 'player'), false);
  assert.equal(runtime.regionalReinforcementAllowed(m, 'A3', 'player'), false);
  assert.equal(runtime.regionalReinforcementAllowed(m, 'A3', 'enemy'), true);
  assert.equal(runtime.regionalReinforcementAllowed(m, 'A3', 'player', true), true);
  const spawned = applyRegionalReinforcement(m, m.data.multiRegion.regions[2], { side: 'player', kind: 'sherman' }, new RNG(2), () => 'denied', true);
  assert.equal(spawned.length, 0);
});

test('route support ignores empty destinations, crosses empty regions and retains a valid target', () => {
  const m = fixture();
  const actor = m.enemies.find(unit => runtime.regionAt(m, unit.pos) === 'A4');
  // Remove all other enemy occupants from A3/A4; A1/A2 remain contested.
  m.enemies.forEach(unit => { if (unit !== actor && ['A3', 'A4'].includes(runtime.regionAt(m, unit.pos))) unit.destroyed = true; });
  assert(runtime.regionalSupportStep(m, actor));
  const target = m.multiRegionState.supportTargets[actor.id];
  assert(['A1', 'A2'].includes(target));
  assert.notEqual(target, 'A3');
  assert(runtime.regionalSupportStep(m, actor));
  assert.equal(m.multiRegionState.supportTargets[actor.id], target);
});

const OutcomeScene = sceneMethods(['computeOutcome'], {
  GameSession: { isPvp: false }, checkOutcome, updateRegionalVictory: runtime.updateRegionalVictory,
});
function outcomeScene(m) { const scene = new OutcomeScene(); scene.mission = m; scene.multiRegionRoundEndCheck = false; return scene; }

test('off-region victory waits for round end and player destruction still defeats; changing region does not bypass', () => {
  const m = fixture(); const scene = outcomeScene(m);
  const targets = m.enemies.filter(unit => unit.kind === 'panzer4');
  const local = targets.find(unit => runtime.regionAt(m, unit.pos) === 'A1');
  local.destroyed = true; assert.equal(scene.computeOutcome(), 'ongoing');
  targets.filter(unit => unit !== local).forEach(unit => { unit.destroyed = true; });
  assert.equal(scene.computeOutcome(), 'ongoing');
  m.sherman.pos = { ...targets[3].pos };
  assert.equal(scene.computeOutcome(), 'ongoing');
  scene.multiRegionRoundEndCheck = true; assert.equal(scene.computeOutcome(), 'victory');
  m.sherman.destroyed = true; assert.equal(scene.computeOutcome(), 'defeat');
});

test('the final objective destroyed in the player region wins immediately, including an ally kill', () => {
  const m = fixture(); const scene = outcomeScene(m);
  const targets = m.enemies.filter(unit => unit.kind === 'panzer4');
  const local = targets.find(unit => runtime.regionAt(m, unit.pos) === 'A1');
  targets.filter(unit => unit !== local).forEach(unit => { unit.destroyed = true; });
  assert.equal(scene.computeOutcome(), 'ongoing');
  local.destroyed = true; assert.equal(scene.computeOutcome(), 'victory');
});

test('save/load restores offscreen positions, support targets, minimap snapshot and pending victory', () => {
  const m = fixture(); const scene = outcomeScene(m);
  const targets = m.enemies.filter(unit => unit.kind === 'panzer4');
  targets.find(unit => runtime.regionAt(m, unit.pos) === 'A1').destroyed = true;
  scene.computeOutcome(); targets.forEach(unit => { unit.destroyed = true; }); scene.computeOutcome();
  m.multiRegionState.supportTargets.example = 'A2';
  const save = captureSave({ mission: m, missionId: m.data.id, gameMode: 'hardcore', turn: 3, phase: 'player',
    movesLeft: 2, attacksLeft: 1, miscDone: false, playerStep: 'choose', hatchChangedThisTurn: false, phaseDice: [] });
  const fresh = fixture();
  assert.equal(applySave(fresh, fresh.data.id, JSON.parse(JSON.stringify(save))).ok, true);
  assert.deepEqual(fresh.multiRegionState, m.multiRegionState);
  assert.equal(outcomeScene(fresh).computeOutcome(), 'ongoing');
});

test('regional event stage rolls all four regions, records only local results and then reaches the final check', () => {
  const m = fixture(); let rolls = 0, finalChecks = 0, ids = 0;
  const Scene = sceneMethods(['runMultiRegionEvents', 'computeOutcome'], {
    GameSession: { isPvp: false, gameMode: 'hardcore' },
    ...runtime, applyRegionalReinforcement,
    rollRegionalEvent: require('../assets/scripts/core/MultiRegionEvents.ts').rollRegionalEvent,
    unitDisplayName: kind => kind, Color: class {}, checkOutcome,
  });
  const scene = new Scene(); const recorded = [];
  Object.assign(scene, { mission: m, outcome: 'ongoing', rng: { d6: () => { rolls++; return 1; }, pick: xs => xs[0] },
    nextTurnEndUnitId: () => `reinforcement_${ids++}`, clearActiveActingUnit() {}, destroyEnemyDiceTray() {},
    updateOutcomeOverlay() {}, spawnFloater() {}, battleLogI18n: (_key, params) => recorded.push(params.result),
    endEnemyPhase: () => { finalChecks++; },
  });
  scene.runMultiRegionEvents();
  assert.equal(rolls, 8);
  assert.equal(finalChecks, 1);
  assert.equal(m.allies.length, 17, 'A1 and A2 both received their independently rolled friendly reinforcements');
  assert.equal(recorded.length, 1, 'A2 spawned silently and enemy-held A3/A4 denied friendly ground reinforcements');
});

test('combat history appends only the region occupied at action time and retains previously experienced regions', () => {
  const Scene = sceneMethods(['pushCombatLogEntry', 'isOutsidePlayerRegion'], { ...runtime, console: { log() {} } });
  const scene = new Scene(), m = fixture();
  const actor = m.enemies.find(unit => runtime.regionAt(m, unit.pos) === 'A2');
  Object.assign(scene, { mission: m, phase: 'enemy', enemyOrder: [actor], enemyIndex: 0, turn: 10,
    combatLogLines: [], combatLogContent: null, combatLogText: () => '',
  });
  scene.pushCombatLogEntry({ key: 'battleLog.combat.miss' });
  assert.equal(scene.combatLogLines.length, 0);
  actor.pos = { ...m.sherman.pos };
  scene.pushCombatLogEntry({ key: 'battleLog.combat.miss' });
  m.sherman.pos = { ...m.data.multiRegion.regions[1].center };
  scene.phase = 'player'; scene.turn = 11;
  scene.pushCombatLogEntry({ key: 'battleLog.playerTurnStart' });
  assert.deepEqual(scene.combatLogLines.map(entry => [entry.regionId, entry.regionTurn]), [['A1', 10], ['A2', 11]]);
});

test('crossing regions pans to the entered board and delays the remaining player action until pan completion', () => {
  let stoppedAudio = 0, clearedEffects = 0;
  const Scene = sceneMethods(['cameraReferenceTiles', 'tileBoundsCenter', 'startMultiRegionPan', 'advanceCampaignPanAnim'], {
    ...runtime, axialToPixel: require('../assets/scripts/core/HexGrid.ts').axialToPixel,
    BOARD_CENTER_OFFSET_Y: 20, easeInOutCubic: value => value,
    stopBattleSfx: () => stoppedAudio++,
  });
  const scene = new Scene(), m = fixture(); let completed = 0, viewPosition;
  Object.assign(scene, { mission: m, multiRegionCameraId: 'A1', hexSize: 1, offsetX: 0, offsetY: 20,
    mapNode: { position: { x: 0, y: 0 } }, applyMapViewPosition: (x, y) => { viewPosition = { x, y }; },
    refreshPlayerVisibility() {}, redraw() {},
    clearRegionalTransientEffects() { clearedEffects++; },
  });
  m.sherman.pos = { ...m.data.multiRegion.regions[1].center };
  assert.equal(scene.startMultiRegionPan(() => completed++), true);
  assert.equal(stoppedAudio, 1, 'crossing cancels old-region sounds and pending audio loads');
  assert.equal(clearedEffects, 1, 'crossing clears old-region transient presentation');
  assert.equal(scene.campaignTransitionActive, true);
  assert.equal(completed, 0);
  scene.advanceCampaignPanAnim(.5);
  assert.equal(completed, 1);
  assert.equal(scene.campaignTransitionActive, false);
  assert.equal(scene.multiRegionCameraId, 'A2');
  assert(Number.isFinite(viewPosition.x) && Number.isFinite(viewPosition.y));
});

test('offscreen movement applies instantly but entry into the player region uses the ordinary movement animation', () => {
  const grid = require('../assets/scripts/core/HexGrid.ts');
  const Scene = sceneMethods(['executeEnemyAction', 'isOutsidePlayerRegion', 'aiMoveDestinationForAction'], {
    ...grid, markAmbushAction, clearLockedFire, isImmobileGunUnit: () => false,
    syncTankRiders() {}, unitDisplayName: kind => kind, GameSession: { gameMode: 'hardcore' },
  });
  const m = fixture(), scene = new Scene();
  const border = m.map.all().flatMap(tile => neighbors(tile.pos).map(pos => [tile.pos, pos]))
    .find(([a, b]) => runtime.regionAt(m, a) === 'A2' && runtime.regionAt(m, b) === 'A1'
      && m.map.canUnitCrossEdge(a, b, m.sherman));
  const actor = m.enemies.find(unit => runtime.regionAt(m, unit.pos) === 'A2');
  Object.assign(scene, { mission: m, moveDuration: .25, breakConcealment() {},
    captureAbandonedATGunsAt() {}, captureAbandonedTanksAt() {}, crushEnemyATGunsAt() {},
    allUnits: () => [m.sherman, ...m.allies, ...m.enemies], canMoveToBattleTile: () => true,
    findMoveBlocker: () => null, isAIReverseMoveFilterEnabled: () => false, battleLog() {}, redraw() {},
  });
  actor.pos = { ...border[0] }; actor.facing = grid.directionTo(border[0], border[1]);
  assert.equal(scene.executeEnemyAction(actor, 'advance'), 'animating');
  assert.deepEqual(actor.pos, border[0]);
  assert.equal(scene.anim.toQ, border[1].q);
  actor.pos = { ...m.data.multiRegion.regions[3].center }; actor.facing = 0;
  scene.anim = null;
  const expected = grid.neighbor(actor.pos, 0);
  assert.equal(scene.executeEnemyAction(actor, 'advance'), 'done');
  assert.deepEqual({ ...actor.pos }, expected);
  assert.equal(scene.anim, null);
});

test('automatic continue applies the save while terrain streams; a manual load remains blocked when busy', () => {
  let restored = 0;
  const Scene = sceneMethods(['onLoad_Save'], {
    readActiveSaveRaw: () => JSON.stringify({ turn: 2 }),
    applySave: (_mission, _id, save) => ({ ok: true, turn: save.turn }),
    t: key => key,
  });
  const scene = new Scene();
  Object.assign(scene, { mission: { data: {} }, missionId: 'test', isBusy: () => true,
    flashBattleSettingsHint() {}, restoreAppliedSave: result => { restored = result.turn; },
  });
  scene.onLoad_Save(false); assert.equal(restored, 0);
  scene.onLoad_Save(true); assert.equal(restored, 2);
});
