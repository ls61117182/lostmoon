const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText, filename);
const { UnitAnimationCache } = require('../assets/scripts/view/UnitAnimationCache.ts');
const { PlayerVisionCache } = require('../assets/scripts/core/PlayerVisionCache.ts');
const { generateMultiRegionPackage } = require('../assets/scripts/core/MultiRegionGenerator.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { RNG } = require('../assets/scripts/core/Dice.ts');
const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { computePlayerVisibleHexes } = require('../assets/scripts/core/FogOfWar.ts');
const { isTankUnit } = require('../assets/scripts/core/types.ts');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
const fixture = () => loadMission(generateMultiRegionPackage(20261026).mission, new RNG(1), { hardcore: true });
class Node {
  constructor(x = 0, y = 0, parent = null) { this.position = { x, y, z: 0 }; this.parent = parent; this.isValid = true; }
  setPosition(x, y, z) { this.position = { x, y, z }; }
}
const cursor = () => ({ tank: 0, hatch: 0, infantry: 0, officer: 0, suppression: 0 });
const pass = () => ({ start: cursor(), end: cursor(), crewOnly: false });

test('60 movement frames translate only cached unit nodes, labels and engine origins without scene or visibility rebuilds', () => {
  const Scene = sceneMethods(['redrawAnimatedUnits'], { isTankUnit });
  const scene = new Scene(), unit = { id: 'tank' }, other = { id: 'other' }, map = {}, cache = new UnitAnimationCache();
  const hull = new Node(), turret = new Node(1, 2), commander = new Node(3, 4, turret), label = new Node(10, -20), stationary = new Node(100, 100);
  cache.record(unit, { x: 0, y: 0 }, [hull, turret, commander, label], pass());
  cache.record(other, { x: 100, y: 100 }, [stationary], pass());
  let center = { x: 0, y: 0 }, shadows = 0;
  Object.assign(scene, { mission: { map }, sceneryCacheMap: map, unitAnimationCache: cache,
    anim: { unit, kind: 'move' }, mainGunRecoils: new Map(), engineVibrationVisuals: [{ node: hull, baseX: 0, baseY: 0 }],
    interpolatedPos: value => value === unit ? center : { x: 100, y: 100 }, isOutsidePlayerRegion: () => false,
    redraw: () => assert.fail('full scene redraw during motion'), replayAnimatedUnit: () => assert.fail('translation rebuilt sprites'),
    refreshPlayerVisibility: () => assert.fail('interpolation recalculated rules sight'), syncUnitOcclusion() {},
    redrawObjectShadows: unitsOnly => { assert.equal(unitsOnly, true); shadows++; }, syncActiveActingUnitFrame() {}, drawUnitEffects() {},
  });
  for (let i = 1; i <= 60; i++) { center = { x: i * 1.5, y: -i / 2 }; scene.redrawAnimatedUnits(); }
  assert.deepEqual(hull.position, { x: 90, y: -30, z: 0 });
  assert.deepEqual(turret.position, { x: 91, y: -28, z: 0 });
  assert.deepEqual(commander.position, { x: 3, y: 4, z: 0 }, 'a child inherits its parent translation exactly once');
  assert.deepEqual(label.position, { x: 100, y: -50, z: 0 });
  assert.deepEqual(stationary.position, { x: 100, y: 100, z: 0 });
  assert.equal(scene.engineVibrationVisuals[0].baseX, 90);
  assert.equal(shadows, 60);
});

test('rotating units replay only their reserved sprite slots and restore the shared pool cursors', () => {
  const Scene = sceneMethods(['replayAnimatedUnit', 'unitSpriteCursor', 'restoreUnitSpriteCursor']);
  const scene = new Scene(), unit = { id: 'rotating' }, node = new Node();
  const cache = new UnitAnimationCache();
  cache.record(unit, { x: 0, y: 0 }, [node], { start: { ...cursor(), tank: 4 }, end: { ...cursor(), tank: 6 }, crewOnly: false });
  const entry = cache.entries.get(unit);
  let draws = 0;
  Object.assign(scene, { enemyTopPoolNext: 20, commanderHatchPoolNext: 2, infantryTopPoolNext: 9, officerTopPoolNext: 1, suppressionMarkPoolNext: 3,
    g: {}, vectorSilhouettes: [], infantryVectorSilhouettes: [], engineVibrationVisuals: [],
    unitFallbackGraphics: new Map([[unit.id, { clear() {}, node: new Node() }]]),
    usesPushedWreckVision: () => false, isUnitVisible: () => true,
    drawUnitMaybeAnim: value => { assert.equal(value, unit); assert.equal(scene.enemyTopPoolNext, 4); scene.enemyTopPoolNext += 2; draws++; },
  });
  const before = scene.unitSpriteCursor();
  for (let i = 0; i < 60; i++) { assert.equal(scene.replayAnimatedUnit(entry), true); assert.deepEqual(scene.unitSpriteCursor(), before); }
  assert.equal(draws, 60);
  assert.equal(cache.entries.size, 1);
});

test('a pushed wreck updates its existing presentation and visibility mask without rebuilding scenery', () => {
  const Scene = sceneMethods(['redrawAnimatedUnits']);
  const scene = new Scene(), map = {}, unit = { id: 'wreck' }, cache = new UnitAnimationCache(), node = new Node();
  cache.record(unit, { x: 0, y: 0 }, [node], pass());
  const entry = cache.entries.get(unit); entry.visible = true;
  let replays = 0, masks = 0;
  Object.assign(scene, { mission: { map }, sceneryCacheMap: map, unitAnimationCache: cache, mainGunRecoils: new Map(), engineVibrationVisuals: [],
    isUnitVisible: () => true, interpolatedPos: () => ({ x: 15, y: 5 }),
    replayAnimatedUnit: value => { assert.equal(value, entry); replays++; return true; },
    redraw: () => assert.fail('pushing a wreck rebuilt scenery'), redrawUnitVisibilityMask: () => masks++,
    syncUnitOcclusion() {}, redrawObjectShadows() {}, syncActiveActingUnitFrame() {}, drawUnitEffects() {},
  });
  unit.wreckPose = { x: 1, y: 0, angle: .5 };
  scene.redrawAnimatedUnits();
  assert.deepEqual(node.position, { x: 15, y: 5, z: 0 });
  assert.equal(replays, 1); assert.equal(masks, 1);
  assert.equal(entry.wreckPose, unit.wreckPose);
});

test('unit visibility changes fall back to a rules redraw instead of retaining stale sprites', () => {
  const Scene = sceneMethods(['redrawAnimatedUnits']);
  const scene = new Scene(), map = {}, unit = { id: 'sunk' }, cache = new UnitAnimationCache();
  cache.record(unit, { x: 0, y: 0 }, [], pass()); cache.entries.get(unit).visible = true;
  let redraws = 0;
  Object.assign(scene, { mission: { map }, sceneryCacheMap: map, unitAnimationCache: cache, mainGunRecoils: new Map(),
    isUnitVisible: () => false, redraw: () => redraws++,
  });
  unit.wreckPose = { x: 0, y: 1 };
  scene.redrawAnimatedUnits();
  assert.equal(redraws, 1);
});

test('pushed wrecks refresh changed infantry formations during motion without rebuilding the scene', () => {
  const { isFootUnit, isTankUnit, isHeavyArtilleryUnit } = require('../assets/scripts/core/types.ts');
  const { wreckVisualHex } = require('../assets/scripts/view/TankWreckPush.ts');
  const Scene = sceneMethods(['redrawAnimatedUnits', 'cacheUnitAnimation', 'unitSpriteCursor', 'infantrySharesHexWithOtherUnit'], {
    isFootUnit, isTankUnit, isHeavyArtilleryUnit, wreckVisualHex, GameSession: { gameMode: 'hardcore' },
  });
  const scene = new Scene(), map = {}, cache = new UnitAnimationCache();
  const squad = (id, q) => ({ id, kind: 'american_infantry', pos: { q, r: 0 }, destroyed: false });
  const source = squad('source', 0), destination = squad('destination', 2), remote = squad('remote', 6);
  const wreck = { id: 'wreck', kind: 'sherman', pos: { q: 0, r: 0 }, destroyed: true };
  const mover = { id: 'mover', kind: 'sherman', pos: { q: 10, r: 0 }, destroyed: false };
  const squads = [source, destination, remote], replays = [];
  Object.assign(scene, {
    mission: { map, sherman: mover, allies: squads, enemies: [wreck] }, sceneryCacheMap: map, unitAnimationCache: cache,
    mainGunRecoils: new Map(), engineVibrationVisuals: [], tankDamageTrackNodes: new Map(), vectorSilhouettes: [],
    unitFallbackGraphics: new Map(squads.map(unit => [unit.id, { node: new Node() }])),
    enemyTopSpritePool: [], commanderHatchSpritePool: [], infantryTopSpritePool: [], officerTopSpritePool: [], suppressionMarkPool: [],
    enemyTopPoolNext: 0, commanderHatchPoolNext: 0, infantryTopPoolNext: 0, officerTopPoolNext: 0, suppressionMarkPoolNext: 0,
    interpolatedPos: unit => ({ x: unit.pos.q * Math.sqrt(3) + (unit.wreckPose?.x ?? 0), y: 0 }),
    isUnitVisible: () => true, isOutsidePlayerRegion: () => false,
    infantryFormationKey: unit => String(scene.infantrySharesHexWithOtherUnit(unit)),
    infantryFormationOffsets: () => [{ ox: 0, oy: 0 }],
    redraw: () => assert.fail('a changed infantry formation rebuilt the scene'),
    replayAnimatedUnit: entry => { replays.push(entry.unit.id); return true; },
    redrawUnitVisibilityMask() {}, syncUnitOcclusion() {}, redrawObjectShadows() {}, syncActiveActingUnitFrame() {},
  });
  for (const unit of squads) scene.cacheUnitAnimation(unit, false, {}, cursor(), 0);
  cache.record(wreck, scene.interpolatedPos(wreck), [new Node()], pass());
  assert.equal(cache.entries.get(source).infantryCoLocated, true);
  assert.equal(cache.entries.get(destination).infantryCoLocated, false);

  wreck.wreckPose = { x: Math.sqrt(3) * 2, y: 0, angle: 0 };
  scene.redrawAnimatedUnits();
  assert.deepEqual(replays, ['wreck', 'source', 'destination']);
  assert.equal(cache.entries.get(source).infantryCoLocated, false, 'the old hex must reform immediately');
  assert.equal(cache.entries.get(destination).infantryCoLocated, true, 'the new hex must spread immediately');
  assert.equal(cache.entries.get(remote).infantryCoLocated, false);

  replays.length = 0;
  wreck.wreckPose = { x: Math.sqrt(3) * 2 + 0.1, y: 0, angle: 0.1 };
  scene.redrawAnimatedUnits();
  assert.deepEqual(replays, ['wreck'], 'unchanged formations must retain their cached sprites');

  const otherWreck = { id: 'other-wreck', kind: 'sherman', pos: { ...destination.pos }, destroyed: true };
  scene.mission.enemies.push(otherWreck);
  replays.length = 0;
  wreck.wreckPose = { x: Math.sqrt(3) * 12, y: 0, angle: 0 };
  scene.redrawAnimatedUnits();
  assert.deepEqual(replays, ['wreck'], 'another wreck in the hex must keep the squad spread');
  assert.equal(cache.entries.get(destination).infantryCoLocated, true);
  assert.deepEqual(wreck.pos, { q: 0, r: 0 }, 'visual updates must preserve the rules position');
});

test('rules redraws reuse static scenery until terrain or resource state changes', () => {
  const Scene = sceneMethods(['redraw', 'requestResourceRedraw'], {
    syncTankRiders() {}, europeanTerrainLook: () => 'summer', GameSession: { gameMode: 'hardcore' },
    isHeavyArtilleryUnit: () => false, isTankUnit: () => true, isControlledATGun: () => false,
    drawBeachOverlays() {}, drawSeawallJoints() {},
  });
  const graphics = () => ({ clear() {} });
  const unit = { pos: { q: 0, r: 0 } }, tile = { pos: { q: 0, r: 0 }, terrain: 'forest', hasBuilding: true };
  const map = { all: () => [tile] }; let ground = 0, trees = 0, buildings = 0;
  const scene = new Proxy(new Scene(), { get(target, key) {
    const value = Reflect.get(target, key);
    if (value !== undefined) return value;
    if (typeof key === 'string' && /^(draw|redraw|sync|clear|refresh|prepare|maybe|place|reserve|spawn)/.test(key)) return () => {};
  } });
  Object.assign(scene, { isValid: true, mission: { map, data: { theater: 'europe' }, sherman: unit, allies: [], enemies: [] },
    g: graphics(), mapOcclusionGraphics: graphics(), mapDeepShadowGraphics: graphics(), unitGraphics: graphics(), tankGraphics: graphics(),
    buildingGraphics: graphics(), battlefieldOverlayGraphics: graphics(), unitFallbackGraphics: new Map(),
    tankDamageTrackNodes: new Map(), silhouetteSources: new Map(), silhouetteClaimed: new Set(),
    bunkerOcclusionSprites: new Map(), infantryOcclusionSprites: new Map(), infantryVectorSilhouettes: [],
    occlusionShapes: [], vectorSilhouettes: [], engineVibrationVisuals: [], terrainSpriteBatchReady: true,
    pendingSeasonTerrainLoads: 0, continuousTerrain: { loading: false }, tankRiderRenderer: { begin() {} },
    allUnits: () => [unit], project: () => ({ x: 0, y: 0 }), hasBunkerAt: () => false,
    drawContinuousTerrain: () => { ground++; return true; }, drawForestCanopy: () => trees++, drawBuildingOverlay: () => buildings++,
    anim: null, phase: 'player', playerStep: 'choose', selectedGunDieIdx: -1, selectedMGDieIdx: -1,
  });
  for (const name of ['terrainSpritePool', 'fortificationSpritePool', 'fortificationRimPool', 'rockySpritePool', 'bridgeSpritePool', 'urbanBuildingSpritePool', 'urbanRubbleSpritePool',
    'ruralPropSpritePool', 'foliageSpritePool', 'enemyTopSpritePool', 'commanderHatchSpritePool', 'infantryTopSpritePool',
    'officerTopSpritePool', 'suppressionMarkPool']) scene[name] = [];
  scene.redraw();
  for (let i = 0; i < 10; i++) { unit.pos.q++; scene.redraw(); }
  assert.deepEqual([ground, trees, buildings], [1, 1, 1], 'moving a unit never rebuilds the background');
  tile.hasBuilding = false; scene.redraw();
  assert.deepEqual([ground, trees, buildings], [2, 2, 1], 'destroyed scenery invalidates its cached layer');
  scene.requestResourceRedraw(); scene.redraw();
  assert.deepEqual([ground, trees, buildings], [3, 3, 1], 'late artwork invalidates scenery even when terrain rules are unchanged');
});

test('vision cache ignores ammo, interpolation, UI and off-region changes, and isolates timed reveal copies', () => {
  const mission = fixture(); let computations = 0;
  const cache = new PlayerVisionCache((...args) => { computations++; assert.equal(args[0].all().length, 36); return computePlayerVisibleHexes(...args); });
  const read = () => cache.get(mission, 'clear', true, true);
  const first = read();
  for (let i = 0; i < 100; i++) { mission.sherman.reloadProgress = i; mission.sherman.fire = i % 2; read(); }
  const offscreen = mission.allies.find(unit => !mission.map.sameRegion(unit.pos, mission.sherman.pos));
  offscreen.hatchOpen = !offscreen.hatchOpen; offscreen.radioDamaged = true;
  read();
  first.add('transient-reveal');
  assert(!read().has('transient-reveal'));
  assert.equal(computations, 1);
});

test('position, facing, crew, hatch, radio, range, weather, smoke and sight-blocking terrain invalidate cached vision', () => {
  const mission = fixture(); let computations = 0, weather = 'clear';
  const cache = new PlayerVisionCache((...args) => { computations++; return computePlayerVisibleHexes(...args); });
  const read = () => cache.get(mission, weather, true, true);
  read();
  const unit = mission.sherman, tile = mission.map.all().find(tile => tile.terrain === 'field' && mission.map.sameRegion(tile.pos, unit.pos));
  for (const mutate of [
    () => unit.hatchOpen = !unit.hatchOpen,
    () => unit.facing = (unit.facing + 1) % 6,
    () => unit.turretFacing = (unit.turretFacing + 1) % 6,
    () => unit.radioDamaged = !unit.radioDamaged,
    () => unit.crew.commander = false,
    () => unit.gunnerVisionRange = 2,
    () => weather = 'fog',
    () => mission.smokeHexes.add(HexMap.keyOf(tile.pos)),
    () => tile.hasBuilding = true,
    () => unit.pos = { ...tile.pos },
    () => unit.pos = { ...mission.data.multiRegion.regions[1].center },
  ]) {
    const before = computations; mutate(); read(); read(); assert.equal(computations, before + 1);
  }
});

test('cached sight agrees with direct rules calculation for ordinary and regional missions', () => {
  const mission = fixture(), cache = new PlayerVisionCache();
  for (const weather of ['clear', 'rain', 'fog']) for (const radio of [false, true]) {
    assert.deepEqual(cache.get(mission, weather, true, radio), computePlayerVisibleHexes(mission.map, mission.sherman, mission.allies, radio, weather, mission.smokeHexes));
  }
  delete mission.data.multiRegion; mission.map.regions.clear();
  assert.deepEqual(cache.get(mission, 'clear', true, true), computePlayerVisibleHexes(mission.map, mission.sherman, mission.allies, true, 'clear', mission.smokeHexes));
});

test('stationary dice and result holds never rebuild unit shadows or occlusion', () => {
  const Scene = sceneMethods(['redrawAnimatedUnits'], { isTankUnit });
  const scene = new Scene(), unit = { id: 'held-actor' }, map = {}, cache = new UnitAnimationCache();
  cache.record(unit, { x: 12, y: 4 }, [new Node(12, 4)], pass());
  Object.assign(scene, { mission: { map }, sceneryCacheMap: map, unitAnimationCache: cache,
    anim: { unit, kind: 'move' }, mainGunRecoils: new Map(), isOutsidePlayerRegion: () => false,
    interpolatedPos: () => ({ x: 12, y: 4 }),
    redraw: () => assert.fail('stationary actor rebuilt the scene'),
    syncUnitOcclusion: () => assert.fail('stationary actor rebuilt occlusion'),
    redrawObjectShadows: () => assert.fail('stationary actor rebuilt shadows'),
  });
  for (let frame = 0; frame < 60; frame++) scene.redrawAnimatedUnits();
});

test('moving effects draw once per frame after the current position is applied', () => {
  const Scene = sceneMethods(['redrawAnimatedUnits', 'advanceUnitEffects', 'lateUpdate'], { isTankUnit });
  const scene = new Scene(), unit = { id: 'actor' }, map = {}, cache = new UnitAnimationCache(), node = new Node();
  cache.record(unit, { x: 0, y: 0 }, [node], pass());
  let x = 0, draws = 0;
  Object.assign(scene, { mission: { map }, sceneryCacheMap: map, unitAnimationCache: cache, unitEffectTime: 0,
    anim: { unit, kind: 'move' }, mainGunRecoils: new Map(), engineVibrationVisuals: [], isOutsidePlayerRegion: () => false,
    interpolatedPos: () => ({ x, y: 0 }), advanceDestroyedTurretVisuals() {}, syncUnitEffects() {},
    syncUnitOcclusion() {}, redrawObjectShadows() {}, syncActiveActingUnitFrame() {}, drawWeatherEffects() {},
    drawUnitEffects: () => { draws++; assert.equal(node.position.x, x); },
  });
  for (let frame = 1; frame <= 60; frame++) {
    scene.advanceUnitEffects(1 / 60);
    x = frame; scene.redrawAnimatedUnits(); scene.lateUpdate();
    assert.equal(draws, frame, 'fire, reticles and ripples share one final-position draw');
  }
});

test('enemy dice visual animation retains subtitles without rerunning AI action selection', () => {
  const Scene = sceneMethods(['refreshEnemyDiceTray'], {
    Color: class { constructor(...values) { this.values = values; } }, DICE_DIE_BORDER: {}, DICE_CYCLE_INTERVAL: .1,
  });
  const scene = new Scene(), count = 6;
  let decisions = 0, pips = 0;
  Object.assign(scene, { enemyDiceTrayRoot: {}, enemyTrayMetrics: { dieSize: 36 }, enemyDiceTraySubject: {},
    enemyDiceTrayLabels: Array.from({ length: count }, () => ({ node: {} })), enemyDiceTraySubtitleLabels: Array.from({ length: count }, () => ({})),
    enemyDiceTrayTileGraphics: Array.from({ length: count }, () => ({ clear() {} })), enemyDiceUsed: [],
    enemyDice: [1, 2, 3, 4, 5, 6], enemyDiceHighlightIdx: -1, enemyDiceSortAnim: { t: 0 },
    enemyDieActionSubtitle: () => { decisions++; return 'advance'; }, enemyDieFillColor: () => ({}),
    drawDieBody() {}, drawDiePips() { pips++; },
  });
  scene.refreshEnemyDiceTray();
  for (let frame = 0; frame < 60; frame++) { scene.enemyDiceSortAnim.t = frame / 60; scene.refreshEnemyDiceTray(false); }
  assert.equal(decisions, count, 'animation must not perform 360 additional target/path queries');
  assert.equal(pips, 61 * count, 'visual dice still animate');
  assert(scene.enemyDiceTraySubtitleLabels.every(label => label.string === 'advance'));
  scene.enemyDiceUsed[0] = true;
  scene.refreshEnemyDiceTray();
  assert.equal(decisions, count * 2, 'rules changes still refresh action text');
});
