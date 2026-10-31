const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const facing = require('../assets/scripts/view/InfantryVisualFacing.ts');
const types = require('../assets/scripts/core/types.ts');
const tankConfig = require('../assets/scripts/core/TankVisualDB.ts');
const tracks = require('../assets/scripts/view/TankTrackVisual.ts');
const grid = require('../assets/scripts/core/HexGrid.ts');
const { trenchInfantryOffsets } = require('../assets/scripts/core/Fortification.ts');
const { UnitAnimationCache } = require('../assets/scripts/view/UnitAnimationCache.ts');
const { wreckVisualHex } = require('../assets/scripts/view/TankWreckPush.ts');
let formationSolves = 0;
const Scene = require('./helpers/BattleSceneMethods.cjs')([
  'infantryFormationOffsets', 'infantryFormationKey', 'tankWreckCollisionBody', 'tankBodyDisplaySizePx',
  'splitHullDisplayBasis', 'destroyedTankOffset', 'topDownForwardVec', 'directionScreenAngle',
  'drawInfantry', 'drawSuppressionMarks', 'redrawAnimatedUnits',
  'infantrySharesHexWithOtherUnit',
], { ...facing, ...types, ...tankConfig, ...tracks, ...grid, trenchInfantryOffsets, wreckVisualHex, GameSession: { gameMode: 'hardcore' },
  infantryOffsetsAvoidingHulls(...args) { formationSolves++; return facing.infantryOffsetsAvoidingHulls(...args); },
  isEnemyTopKind: () => true, TIGER_SPLIT_VISUAL_CONFIG: tankConfig.splitTankVisualConfigOf('tiger'),
  BattleScene: { INFANTRY_SPRITES_PER_UNIT: 3,
    TIGER_TOP_TRIM_W: tankConfig.splitTankGeometryConfigOf('tiger').topTrim.w,
    TIGER_TOP_TRIM_H: tankConfig.splitTankGeometryConfigOf('tiger').topTrim.h }, UITransform: 'transform' });
const radii = [0.6, 0.6, 0.69].map(scale => 0.29 * scale * Math.hypot(40, 60) / 60);
const footprints = [0.6, 0.6, 0.69].map(scale => ({ halfWidth: 0.29 * scale * 40 / 60, halfHeight: 0.29 * scale, angle: 0 }));
const plain = value => JSON.parse(JSON.stringify(value));
function setup(kind = 'sherman', direction = 0) {
  const scene = new Scene(), hexSize = 100;
  const tank = { id: 'tank', kind, pos: { q: 0, r: 0 }, facing: direction };
  const squad = { id: 'squad', kind: 'american_infantry', pos: { q: 0, r: 0 }, suppressed: true };
  const map = { get: () => undefined };
  Object.assign(scene, { hexSize, mission: { map, sherman: tank, allies: [squad], enemies: [], data: {} },
    project: (q, r) => { const p = grid.axialToPixel({ q, r }, hexSize); return { x: p.x, y: -p.y }; },
    infantrySharesHexWithOtherUnit: () => true, infantryVisualAngle: () => 0, enemyTankSharingInfantryHex: () => null,
    isUnitVisible: () => true,
    infantryVisualsFor: () => ({ frames: Array(3).fill({ width: 40, height: 60 }),
      dims: Array(3).fill({ dw: 40, dh: 60 }), scales: [0.6, 0.6, 0.69] }),
    tankTopMetaFor: () => ({ sf: { width: 180, height: 100 }, dw: 180, dh: 100 }),
    facingBlendScreenVec: (pos, from, to, t) => {
      const a = scene.directionScreenAngle(pos, {}, from), b = scene.directionScreenAngle(pos, {}, to);
      return { ux: Math.cos(a + (b - a) * t), uy: Math.sin(a + (b - a) * t) };
    },
  });
  scene.interpolatedPos = unit => {
    const c = scene.project(unit.pos.q, unit.pos.r);
    return { x: c.x + (unit.wreckPose?.x ?? 0) * hexSize, y: c.y + (unit.wreckPose?.y ?? 0) * hexSize };
  };
  return { scene, squad, tank };
}
function clearance(point, body) {
  const dx = point.ox / 100 - body.x, dy = point.oy / 100 - body.y;
  const a = Math.abs(dx * Math.cos(body.angle) + dy * Math.sin(body.angle)) - body.halfLength;
  const b = Math.abs(-dx * Math.sin(body.angle) + dy * Math.cos(body.angle)) - body.halfWidth;
  return Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(0, Math.max(a, b));
}
function insideHex(offsets, rectangles = false) {
  offsets.forEach((p, i) => {
    const x = p.ox / 100, y = p.oy / 100;
    for (const [nx, ny] of [[1, 0], [0.5, Math.sqrt(3) / 2], [-0.5, Math.sqrt(3) / 2]]) {
      const extent = rectangles ? Math.abs(nx) * footprints[i].halfWidth + Math.abs(ny) * footprints[i].halfHeight : radii[i];
      assert.ok(Math.abs(x * nx + y * ny) + extent <= Math.sqrt(3) / 2 + 1e-9, 'the entire soldier must stay in the hex');
    }
  });
}
function boxCorners(x, y, halfWidth, halfHeight, angle) {
  return [[-1,-1],[-1,1],[1,1],[1,-1]].map(([a,b]) => ({
    x: x + a * halfWidth * Math.cos(angle) - b * halfHeight * Math.sin(angle),
    y: y + a * halfWidth * Math.sin(angle) + b * halfHeight * Math.cos(angle),
  }));
}
function spriteCorners(offset, index, hexSize = 100, angle = 0) {
  const { halfWidth, halfHeight } = footprints[index];
  return boxCorners(offset.ox / hexSize, offset.oy / hexSize, halfWidth, halfHeight, angle);
}
function polygonGap(a, b) {
  let separated = false;
  for (const points of [a, b]) for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length], dx = next.x - points[i].x, dy = next.y - points[i].y;
    const pa = a.map(p => p.x * dy - p.y * dx), pb = b.map(p => p.x * dy - p.y * dx);
    if (Math.min(...pa) > Math.max(...pb) || Math.min(...pb) > Math.max(...pa)) separated = true;
  }
  if (!separated) return -1;
  let best = Infinity;
  for (const [points, edges] of [[a,b],[b,a]]) for (const p of points) for (let i = 0; i < edges.length; i++) {
    const from = edges[i], to = edges[(i + 1) % edges.length], dx = to.x - from.x, dy = to.y - from.y;
    const t = Math.max(0, Math.min(1, ((p.x - from.x) * dx + (p.y - from.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - from.x - t * dx, p.y - from.y - t * dy));
  }
  return best;
}

test('all six headings clear real Sherman, Tiger and light-tank hull sizes without leaving the hex', () => {
  for (const kind of ['sherman', 'tiger', 'type95']) for (let direction = 0; direction < 6; direction++) {
    const { scene, squad, tank } = setup(kind, direction);
    const offsets = scene.infantryFormationOffsets(squad), body = scene.tankWreckCollisionBody(tank);
    const hull = boxCorners(body.x, body.y, body.halfLength, body.halfWidth, body.angle);
    offsets.forEach((p, i) => {
      const gap = polygonGap(spriteCorners(p, i), hull) * 100;
      assert.ok(gap >= 1 && gap <= 2, `${kind}/${direction}: soldier ${i} hull gap ${gap} px should be 1–2 px`);
    });
    for (let i = 0; i < 3; i++) for (let j = 0; j < i; j++) {
      assert.ok(polygonGap(spriteCorners(offsets[i], i), spriteCorners(offsets[j], j)) >= 0);
    }
    insideHex(offsets, true);
  }
});

test('open ground without a tank keeps the old formation, while wreck translation and rotation affect avoidance', () => {
  const { scene, squad, tank } = setup();
  const originalPos = { ...tank.pos };
  tank.destroyed = true;
  tank.wreckPose = { x: 0.1, y: 0, angle: 0.2 };
  const before = scene.infantryFormationKey(squad);
  tank.wreckPose = { x: 0.15, y: 0, angle: 0.4 };
  assert.notEqual(scene.infantryFormationKey(squad), before);
  assert.deepEqual(tank.pos, originalPos, 'visual avoidance never changes the rules position');
  tank.wreckWater = { sink: { elapsed: 0 } };
  assert.deepEqual(plain(scene.infantryFormationOffsets(squad)), facing.infantrySquadOffsets(100, true));
  scene.infantrySharesHexWithOtherUnit = () => false;
  assert.deepEqual(plain(scene.infantryFormationOffsets(squad)), facing.infantrySquadOffsets(100, false));
});

test('crowded oversized hulls choose bounded deterministic positions with less overlap', () => {
  const offsets = facing.infantrySquadOffsets(100, true);
  const hulls = [{ id: 'large', x: 0, y: 0, angle: 0, halfLength: 0.95, halfWidth: 0.6 },
    { id: 'second', x: 0.5, y: 0, angle: Math.PI / 3, halfLength: 0.7, halfWidth: 0.4 }];
  const result = facing.infantryOffsetsAvoidingHulls(100, offsets, hulls, radii);
  assert.deepEqual(result, facing.infantryOffsetsAvoidingHulls(100, offsets, hulls, radii));
  insideHex(result);
  const overlap = points => points.reduce((sum, p, i) => sum + hulls.reduce((n, hull) => n + Math.max(0, radii[i] - clearance(p, hull)) ** 2, 0), 0);
  assert.ok(overlap(result) < overlap(offsets));
});

test('unseen tanks do not affect visible soldier positions', () => {
  const { scene, squad } = setup();
  scene.isUnitVisible = () => false;
  assert.deepEqual(plain(scene.infantryFormationOffsets(squad)), facing.infantrySquadOffsets(100, true));
});

test('a tank moving through any neighbouring hex never rearranges the squad', () => {
  for (const pos of grid.HEX_DIRECTIONS) {
    const { scene, squad, tank } = setup();
    tank.pos = { ...pos };
    scene.infantrySharesHexWithOtherUnit = () => false;
    const expected = facing.infantrySquadOffsets(100, false);
    // Interpolate close enough that the passing hull would overlap some old
    // soldier anchors. The tank still belongs to a different hex.
    scene.interpolatedPos = unit => unit === tank
      ? { x: (70 * pos.q + 35 * pos.r) * (1 + scene.anim.t * 0.7), y: -60 * pos.r * (1 + scene.anim.t * 0.7) }
      : { x: 0, y: 0 };
    for (let frame = 0; frame <= 60; frame++) {
      scene.anim = { unit: tank, kind: 'move', t: frame / 60 };
      assert.deepEqual(plain(scene.infantryFormationOffsets(squad)), expected);
    }
  }
});

test('neighbouring tanks do not disturb avoidance around a tank already sharing the hex', () => {
  const { scene, squad } = setup();
  const before = scene.infantryFormationKey(squad);
  const neighbour = { id: 'neighbour', kind: 'tiger', pos: { q: 1, r: 0 }, facing: 0 };
  scene.mission.enemies.push(neighbour);
  const interpolatedPos = scene.interpolatedPos;
  scene.interpolatedPos = unit => unit === neighbour ? { x: 60, y: 0 } : interpolatedPos(unit);
  assert.equal(scene.infantryFormationKey(squad), before);
});

test('a pushed wreck influences only the hex containing its visual centre', () => {
  const { scene, squad, tank } = setup();
  tank.destroyed = true;
  tank.wreckPose = { x: 1, y: 0, angle: 0 };
  assert.deepEqual(plain(scene.infantryFormationOffsets(squad)), facing.infantrySquadOffsets(100, true));
  tank.pos = { q: 1, r: 0 };
  tank.wreckPose = { x: -Math.sqrt(3), y: 0, angle: 0 };
  const body = scene.tankWreckCollisionBody(tank);
  const offsets = scene.infantryFormationOffsets(squad);
  const hull = boxCorners(body.x, body.y, body.halfLength, body.halfWidth, body.angle);
  offsets.forEach((p, i) => assert.ok(polygonGap(spriteCorners(p, i), hull) > 0));
  assert.notDeepEqual(plain(offsets), facing.infantrySquadOffsets(100, true));
});

test('live sprites and suppression marks use the same adjusted offsets', () => {
  const { scene, squad } = setup();
  const expected = scene.infantryFormationOffsets(squad), positions = [], marks = [];
  Object.assign(scene, { g: {}, infantryTopPoolNext: 0, infantryTopSpritePool: [0, 1, 2].map(i => ({ sprite: {}, node: {
    getComponent: () => ({ setContentSize() {} }), setPosition: (x, y) => { positions[i] = { ox: x - 10, oy: y - 20 }; }, setScale() {},
  } })), suppressionMarkPoolNext: 0, suppressionMarkPool: Array.from({ length: 3 }, () => ({ graphics: {}, node: { setScale() {} } })),
    drawSuppressionExclamation() {}, positionMapScreenNode: (_node, x, y) => marks.push({ ox: x - 10, oy: y - 20 }),
  });
  scene.drawInfantry(squad, 10, 20);
  scene.drawSuppressionMarks(squad, 10, 20);
  for (let i = 0; i < 3; i++) for (const key of ['ox', 'oy']) {
    assert.ok(Math.abs(positions[i][key] - expected[i][key]) < 1e-9);
    assert.ok(Math.abs(marks[i][key] - expected[i][key]) < 1e-9);
  }
});

test('turning a tank refreshes stationary squad positions despite unchanged hex occupancy', () => {
  const { scene, squad, tank } = setup(), cache = new UnitAnimationCache(), replays = [];
  const cursor = { tank: 0, hatch: 0, infantry: 0, officer: 0, suppression: 0 };
  for (const unit of [tank, squad]) cache.record(unit, scene.interpolatedPos(unit), [], { start: cursor, end: cursor });
  const entry = cache.entries.get(squad);
  entry.infantryCoLocated = true;
  entry.infantryFormationKey = scene.infantryFormationKey(squad);
  const initialKey = entry.infantryFormationKey;
  Object.assign(scene, { sceneryCacheMap: scene.mission.map, unitAnimationCache: cache,
    anim: { unit: tank, kind: 'turn', turnFrom: 0, turnTo: 1, t: 0.5 }, mainGunRecoils: new Map(), engineVibrationVisuals: [],
    isUnitVisible: () => true, isOutsidePlayerRegion: () => false,
    replayAnimatedUnit: entry => { replays.push(entry.unit.id); return true; },
    redraw: () => assert.fail('hull avoidance must not rebuild scenery'),
    syncUnitOcclusion() {}, redrawObjectShadows() {}, syncActiveActingUnitFrame() {},
  });
  scene.redrawAnimatedUnits();
  assert.deepEqual(replays, ['tank', 'squad']);
  assert.notEqual(entry.infantryFormationKey, initialKey);
  replays.length = 0;
  scene.redrawAnimatedUnits();
  assert.deepEqual(replays, ['tank'], 'unchanged positions retain the squad cache');
});

test('source and destination squads keep pre-move offsets until arrival, including cache rebuilds', () => {
  for (const logicalPositionAlreadyAdvanced of [false, true]) {
    const { scene, squad: source, tank } = setup();
    const target = { ...source, id: 'target', pos: { q: 1, r: 0 } };
    scene.mission.allies.push(target);
    scene.infantrySharesHexWithOtherUnit = Scene.prototype.infantrySharesHexWithOtherUnit;
    const cache = scene.unitAnimationCache = new UnitAnimationCache();
    const before = [source, target].map(unit => plain(scene.infantryFormationOffsets(unit)));
    const cursor = { tank: 0, hatch: 0, infantry: 0, officer: 0, suppression: 0 };
    for (const [i, unit] of [source, target].entries()) {
      cache.record(unit, scene.interpolatedPos(unit), [], { start: cursor, end: cursor });
      cache.entries.get(unit).infantryOffsets = before[i];
    }
    scene.anim = { unit: tank, kind: 'move', fromQ: 0, fromR: 0, toQ: 1, toR: 0, t: 0 };
    if (logicalPositionAlreadyAdvanced) tank.pos = { q: 1, r: 0 };
    const originalPosition = scene.interpolatedPos;
    scene.interpolatedPos = unit => unit === tank
      ? { x: Math.sqrt(3) * 100 * scene.anim.t, y: 0 } : originalPosition(unit);
    for (let frame = 0; frame <= 60; frame++) {
      scene.anim.t = frame / 60;
      if (frame === 30) cache.clear();
      for (const [i, unit] of [source, target].entries()) {
        assert.deepEqual(plain(scene.infantryFormationOffsets(unit)), before[i], `frame ${frame}: ${unit.id} moved before tank arrival`);
      }
    }
    scene.anim = null;
    tank.pos = { q: 1, r: 0 };
    scene.interpolatedPos = originalPosition;
    assert.deepEqual(plain(scene.infantryFormationOffsets(source)), facing.infantrySquadOffsets(100, false));
    assert.notDeepEqual(plain(scene.infantryFormationOffsets(target)), before[1], 'target squad adjusts after arrival');
  }
});

test('a move first rendered mid-animation reconstructs the pre-move formation', () => {
  const { scene, squad, tank } = setup();
  scene.infantrySharesHexWithOtherUnit = Scene.prototype.infantrySharesHexWithOtherUnit;
  const expected = plain(scene.infantryFormationOffsets(squad));
  tank.pos = { q: 1, r: 0 };
  scene.anim = { unit: tank, kind: 'move', fromQ: 0, fromR: 0, toQ: 1, toR: 0, t: 0.7 };
  scene.interpolatedPos = unit => unit === tank ? { x: Math.sqrt(3) * 70, y: 0 } : { x: 0, y: 0 };
  assert.deepEqual(plain(scene.infantryFormationOffsets(squad)), expected);
});

test('tank travel and pushed wrecks skip formation queries until arrival, then solve the final layout once', () => {
  const { scene, squad: source, tank } = setup(), cache = new UnitAnimationCache();
  const target = { ...source, id: 'target', pos: { q: 1, r: 0 } };
  const wreck = { id: 'wreck', kind: 'sherman', destroyed: true, pos: { q: 3, r: 0 } };
  scene.mission.allies.push(target); scene.mission.enemies.push(wreck);
  scene.infantrySharesHexWithOtherUnit = Scene.prototype.infantrySharesHexWithOtherUnit;
  const squads = [source, target];
  const before = squads.map(unit => scene.infantryFormationOffsets(unit));
  for (const unit of [tank, wreck, ...squads]) {
    cache.record(unit, scene.interpolatedPos(unit), [], {});
    if (!squads.includes(unit)) continue;
    const entry = cache.entries.get(unit);
    entry.infantryCoLocated = scene.infantrySharesHexWithOtherUnit(unit);
    entry.infantryFormationKey = scene.infantryFormationKey(unit);
    entry.infantryOffsets = before[squads.indexOf(unit)];
  }
  let formationReads = 0;
  const offsets = scene.infantryFormationOffsets.bind(scene), position = scene.interpolatedPos;
  Object.assign(scene, { unitAnimationCache: cache, sceneryCacheMap: scene.mission.map,
    mainGunRecoils: new Map(), engineVibrationVisuals: [], isOutsidePlayerRegion: () => false,
    anim: { unit: tank, kind: 'move', fromQ: 0, fromR: 0, toQ: 1, toR: 0, t: 0 },
    infantryFormationOffsets(...args) { formationReads++; return offsets(...args); },
    interpolatedPos: unit => unit === tank ? { x: Math.sqrt(3) * 100 * scene.anim.t, y: 0 } : position(unit),
    replayAnimatedUnit(entry) { assert.equal(entry.unit, wreck, 'stationary infantry must retain their sprites'); return true; },
    redraw: () => assert.fail('tank travel must not rebuild the scene'),
    syncUnitOcclusion() {}, redrawObjectShadows() {}, syncActiveActingUnitFrame() {}, redrawUnitVisibilityMask() {},
  });
  formationSolves = 0;
  for (let frame = 1; frame <= 60; frame++) {
    scene.anim.t = frame / 60;
    wreck.wreckPose = { x: frame / 60, y: 0, angle: frame / 100 };
    scene.redrawAnimatedUnits();
    squads.forEach((unit, i) => assert.equal(cache.entries.get(unit).infantryOffsets, before[i]));
  }
  assert.equal(formationReads, 0, 'moving tanks must not even query stationary formations');
  assert.equal(formationSolves, 0);

  // The arrival redraw uses the committed position after releasing the move.
  tank.pos = { q: 1, r: 0 }; scene.anim = null; scene.interpolatedPos = position;
  scene.infantryFormationCache.clear();
  const after = squads.map(unit => scene.infantryFormationOffsets(unit));
  assert.deepEqual(plain(after[0]), facing.infantrySquadOffsets(100, false));
  assert.notDeepEqual(plain(after[1]), plain(before[1]));
  for (let repeat = 0; repeat < 3; repeat++) {
    squads.forEach((unit, i) => assert.deepEqual(plain(scene.infantryFormationOffsets(unit)), plain(after[i])));
  }
  assert.equal(formationSolves, 1, 'only the destination squad needs one hull-avoidance solve after arrival');
});

test('an unrelated tank turning reuses stationary infantry geometry across animation frames', () => {
  const { scene, squad, tank } = setup(), cache = new UnitAnimationCache();
  const actor = { ...tank, id: 'remote-turn', pos: { q: 6, r: 0 } };
  scene.mission.enemies.push(actor);
  for (const unit of [actor, squad]) cache.record(unit, scene.interpolatedPos(unit), [], {});
  const entry = cache.entries.get(squad);
  entry.infantryCoLocated = true;
  entry.infantryFormationKey = scene.infantryFormationKey(squad);
  entry.infantryOffsets = scene.infantryFormationOffsets(squad);
  Object.assign(scene, { unitAnimationCache: cache, sceneryCacheMap: scene.mission.map,
    anim: { unit: actor, kind: 'turn', turnFrom: 0, turnTo: 1, t: 0 }, mainGunRecoils: new Map(), engineVibrationVisuals: [],
    isOutsidePlayerRegion: () => false,
    replayAnimatedUnit(entry) { assert.equal(entry.unit, actor); return true; },
    redraw: () => assert.fail('turning must not rebuild the scene'),
    syncUnitOcclusion() {}, redrawObjectShadows() {}, syncActiveActingUnitFrame() {},
  });
  formationSolves = 0;
  for (let frame = 1; frame <= 60; frame++) { scene.anim.t = frame / 60; scene.redrawAnimatedUnits(); }
  assert.equal(formationSolves, 0, 'unchanged hulls must retain their computed formations');
});

test('hull clearance stays 1–2 pixels at different board sizes and when soldiers face inward', () => {
  for (const size of [64, 128, 160]) for (const inward of [false, true]) {
    const { scene, squad, tank } = setup();
    scene.hexSize = size;
    if (inward) scene.enemyTankSharingInfantryHex = () => tank;
    const offsets = scene.infantryFormationOffsets(squad), body = scene.tankWreckCollisionBody(tank);
    const hull = boxCorners(body.x, body.y, body.halfLength, body.halfWidth, body.angle);
    offsets.forEach((p, i) => {
      const angle = inward ? Math.atan2(-p.oy, -p.ox) + Math.PI / 2 : 0;
      const gap = polygonGap(spriteCorners(p, i, size, angle), hull) * size;
      assert.ok(gap >= 1 && gap <= 2, `${size}px inward=${inward}: soldier ${i} gap ${gap}`);
    });
  }
});

function assertOnBridge(offsets, axis, size = 100) {
  const angle = -axis * Math.PI / 3, ux = Math.cos(angle), uy = Math.sin(angle);
  offsets.forEach((p, i) => {
    const forward = (p.ox * ux + p.oy * uy) / size, side = (-p.ox * uy + p.oy * ux) / size;
    const extentForward = Math.abs(ux) * footprints[i].halfWidth + Math.abs(uy) * footprints[i].halfHeight;
    const extentSide = Math.abs(uy) * footprints[i].halfWidth + Math.abs(ux) * footprints[i].halfHeight;
    assert.ok(Math.abs(forward) + extentForward <= Math.sqrt(3) / 2 + 1e-8, 'soldier must stay between the bridge ends');
    if (extentSide <= 0.205) {
      assert.ok(Math.abs(side) + extentSide <= 0.205 + 1e-8, 'the complete soldier must stay on the deck where it fits');
    } else {
      assert.ok(Math.abs(side) < 1e-8, 'an unusually wide sprite must stay on the bridge centreline');
    }
  });
}

test('all bridge axes constrain infantry to the deck even without a tank', () => {
  for (let axis = 0; axis < 3; axis++) for (const size of [64, 128]) {
    const { scene, squad, tank } = setup();
    scene.hexSize = size;
    tank.pos = { q: 3, r: 0 };
    scene.mission.map.get = () => ({ terrain: 'water', bridgeEnds: [axis, axis + 3] });
    scene.infantrySharesHexWithOtherUnit = () => false;
    const offsets = scene.infantryFormationOffsets(squad);
    assert.equal(offsets.length, 3);
    assertOnBridge(offsets, axis, size);
    assert.deepEqual(plain(scene.infantryFormationOffsets(squad)), plain(offsets));
  }
});

test('dismounted infantry stay on narrow bridges and may overlap a tank instead of standing in water', () => {
  for (let axis = 0; axis < 3; axis++) {
    const { scene, squad, tank } = setup('sherman', axis);
    scene.mission.map.get = () => ({ terrain: 'water', bridgeEnds: [axis, axis + 3] });
    const offsets = scene.infantryFormationOffsets(squad), body = scene.tankWreckCollisionBody(tank);
    const hull = boxCorners(body.x, body.y, body.halfLength, body.halfWidth, body.angle);
    assert.equal(offsets.length, 3);
    assertOnBridge(offsets, axis);
    assert.ok(offsets.some((p, i) => polygonGap(spriteCorners(p, i), hull) < 0), 'occupied bridge space may overlap the tank');
    for (let i = 0; i < offsets.length; i++) for (let j = 0; j < i; j++) {
      assert.ok(polygonGap(spriteCorners(offsets[i], i), spriteCorners(offsets[j], j)) >= 0,
        'tank overlap must not pack the three soldiers on top of one another');
    }
  }
});

test('bridge soldiers use free space around a small tank when it is available', () => {
  const { scene, squad, tank } = setup('type95');
  scene.mission.map.get = () => ({ terrain: 'water', bridgeEnds: [0, 3] });
  const offsets = scene.infantryFormationOffsets(squad), body = scene.tankWreckCollisionBody(tank);
  const hull = boxCorners(body.x, body.y, body.halfLength, body.halfWidth, body.angle);
  assertOnBridge(offsets, 0);
  assert.ok(offsets.some((p, i) => polygonGap(spriteCorners(p, i), hull) > 0), 'prefer available deck outside the tank');
});

test('bridge soldiers facing an enemy tank keep their rotated footprints on the deck', () => {
  for (let axis = 0; axis < 3; axis++) {
    const { scene, squad, tank } = setup('sherman', axis);
    scene.mission.map.get = () => ({ terrain: 'water', bridgeEnds: [axis, axis + 3] });
    scene.enemyTankSharingInfantryHex = () => tank;
    const offsets = scene.infantryFormationOffsets(squad), ux = Math.cos(-axis * Math.PI / 3), uy = Math.sin(-axis * Math.PI / 3);
    assert.equal(offsets.length, 3);
    offsets.forEach((p, i) => {
      const angle = Math.atan2(-p.oy, -p.ox) + Math.PI / 2;
      for (const corner of spriteCorners(p, i, 100, angle)) {
        assert.ok(Math.abs(-corner.x * uy + corner.y * ux) <= 0.205 + 1e-7, 'inward-facing soldier must not stand in the water');
      }
    });
  }
});

test('ordinary infantry walking onto or off any bridge axis keep a deck-constrained formation', () => {
  for (let axis = 0; axis < 3; axis++) for (const leaving of [false, true]) for (const advanced of [false, true]) {
    const { scene, squad, tank } = setup();
    const bridgePos = { q: 0, r: 0 }, landPos = grid.HEX_DIRECTIONS[axis];
    const from = leaving ? bridgePos : landPos, to = leaving ? landPos : bridgePos;
    tank.pos = { q: 6, r: 6 };
    squad.pos = { ...(advanced ? to : from) };
    scene.mission.map.get = pos => pos.q === 0 && pos.r === 0
      ? { terrain: 'water', bridgeEnds: [axis, axis + 3] } : { terrain: 'field' };
    scene.infantrySharesHexWithOtherUnit = () => false;
    scene.anim = { unit: squad, kind: 'move', fromQ: from.q, fromR: from.r, toQ: to.q, toR: to.r, t: 0 };
    for (let frame = 0; frame <= 60; frame++) {
      scene.anim.t = frame / 60;
      const offsets = scene.infantryFormationOffsets(squad);
      assert.equal(offsets.length, 3);
      assertOnBridge(offsets, axis);
    }
    squad.pos = { ...to };scene.anim = null;
    const arrived = scene.infantryFormationOffsets(squad);
    if (leaving) assert.deepEqual(plain(arrived), facing.infantrySquadOffsets(100, false), 'restore the land formation after leaving the bridge');
    else assertOnBridge(arrived, axis);
  }
});

test('walking animation updates a cached land squad to the bridge formation before arrival', () => {
  const { scene, squad, tank } = setup(), cache = new UnitAnimationCache();
  tank.pos = { q: 6, r: 6 };squad.pos = { q: -1, r: 0 };
  scene.mission.map.get = pos => pos.q === 0 && pos.r === 0
    ? { terrain: 'water', bridgeEnds: [0, 3] } : { terrain: 'field' };
  scene.infantrySharesHexWithOtherUnit = () => false;
  let rendered = scene.infantryFormationOffsets(squad), replays = 0;
  cache.record(squad, scene.interpolatedPos(squad), [], {});
  const entry = cache.entries.get(squad);
  entry.infantryCoLocated = false;entry.infantryOffsets = rendered;entry.infantryFormationKey = scene.infantryFormationKey(squad);
  Object.assign(scene, { sceneryCacheMap: scene.mission.map, unitAnimationCache: cache,
    anim: { unit: squad, kind: 'move', fromQ: -1, fromR: 0, toQ: 0, toR: 0, t: 0 },
    mainGunRecoils: new Map(), engineVibrationVisuals: [], isOutsidePlayerRegion: () => false,
    replayAnimatedUnit: () => { rendered = scene.infantryFormationOffsets(squad);replays++;return true; },
    redraw: () => assert.fail('walking onto a bridge must not rebuild scenery'),
    syncUnitOcclusion() {}, redrawObjectShadows() {}, syncActiveActingUnitFrame() {},
  });
  const originalPosition = scene.interpolatedPos;
  scene.interpolatedPos = unit => unit === squad
    ? { x: -Math.sqrt(3) * 100 * Math.pow(1 - scene.anim.t, 3), y: 0 } : originalPosition(unit);
  for (let frame = 1; frame <= 60; frame++) {
    scene.anim.t = frame / 60;
    scene.redrawAnimatedUnits();
    assertOnBridge(rendered, 0);
  }
  assert.equal(replays, 1, 'switch formation once and retain it for the rest of the walk');
  assert.deepEqual(squad.pos, { q: -1, r: 0 }, 'do not commit logical movement early');
});
