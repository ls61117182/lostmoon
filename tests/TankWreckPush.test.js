const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, filename);

const { pushTankWrecks, tankWreckPushContact, wreckBodyPolygon, wreckPolygonContact, wreckVisualHex,
  WRECK_PUSH_STEP, WRECK_PUSH_SPEED_SCALE } = require('../assets/scripts/view/TankWreckPush.ts');
const body = (id, x, y = 0, angle = 0) => ({ id, x, y, angle, halfLength: 0.5, halfWidth: 0.3 });
function drive(wrecks, live = [], buildings = [], y = 0, end = 2) {
  const mover = body('mover', -2, y);
  const steps = Math.ceil((end + 2) / WRECK_PUSH_STEP);
  for (let i = 1; i <= steps; i++) {
    mover.x = -2 + (end + 2) * i / steps;
    pushTankWrecks(wrecks, mover, { x: (end + 2) / steps, y: 0 }, live, buildings);
  }
}

test('tank pushes a wreck continuously, including beyond the battlefield', () => {
  const wreck = body('wreck', 0);
  drive([wreck]);
  assert(wreck.x > 2.5, 'wreck must stay ahead of the moving hull, with no board clamp');
  assert(Number.isFinite(wreck.angle));
  const untouched = body('distant', 0, 3);
  drive([untouched]);
  assert.deepEqual(untouched, body('distant', 0, 3));
});

test('off-center contact turns the wreck, reversing away does not tow it', () => {
  const wreck = body('wreck', 0);
  drive([wreck], [], [], 0.25);
  assert(Math.abs(wreck.angle) > 0.01, 'off-center pressure should rotate the hull');
  const before = { ...wreck };
  const mover = body('mover', wreck.x - 0.85, wreck.y);
  pushTankWrecks([wreck], mover, { x: -0.02, y: 0 }, [], []);
  assert.deepEqual(wreck, before);
});

test('wreck slides around live tanks without moving them', () => {
  const wreck = body('wreck', 0);
  const live = body('live', 1.2);
  const before = { ...live };
  drive([wreck], [live]);
  assert.deepEqual(live, before);
  assert(Math.abs(wreck.y) > 0.4, 'a centered obstacle should produce lateral sliding');
  assert.equal(wreckPolygonContact(wreckBodyPolygon(wreck), wreckBodyPolygon(live)), null);
});

test('wrecks push a bounded chain, and tight jams still complete movement', () => {
  const wrecks = Array.from({ length: 12 }, (_, i) => body(`wreck${i}`, i * 0.98));
  const mover = body('mover', -0.97);
  pushTankWrecks(wrecks, mover, { x: 0.025, y: 0 }, [], []);
  assert(wrecks[1].x > 0.98, 'contact should propagate to the next wreck');
  assert.equal(wrecks[11].x, 11 * 0.98, 'one touch must not move an unlimited chain');
  const jam = body('jam', 0);
  const walls = [wreckBodyPolygon({ ...body('top', 0, 0.61), halfLength: 5 }),
    wreckBodyPolygon({ ...body('bottom', 0, -0.61), halfLength: 5 }),
    wreckBodyPolygon({ ...body('end', 1.05), halfWidth: 5 })];
  drive([jam], [], walls);
  assert(jam.x < 0.1, 'the city wall must prevent forward motion even when the mover overlaps');
  assert(walls.every(wall => !wreckPolygonContact(wreckBodyPolygon(jam), wall)));
});

test('city walls remain solid during the whole push and angled sliding', () => {
  const wreck = body('wreck', 0);
  const building = wreckBodyPolygon({ ...body('building', 1.1), halfWidth: 0.8 });
  const mover = body('mover', -2);
  for (let i = 1; i <= 160; i++) {
    mover.x = -2 + i * 0.025;
    pushTankWrecks([wreck], mover, { x: 0.025, y: 0 }, [], [building]);
    assert.equal(wreckPolygonContact(wreckBodyPolygon(wreck), building), null, `building penetrated at step ${i}`);
  }
  assert(Math.abs(wreck.y) > 0.3, 'wreck should slide along the building');
});

const { urbanBuildingState } = require('../assets/scripts/core/UrbanTerrain.ts');
const { isTankUnit, effectiveDiceTerrain } = require('../assets/scripts/core/types.ts');
const Scene = require('./helpers/BattleSceneMethods.cjs')([
  'advanceTankMoveTime', 'advanceTankWreckPush', 'updateTankWreckPose', 'interpolatedPos', 'drawUnitMaybeAnim',
], { pushTankWrecks, tankWreckPushContact, wreckVisualHex, WRECK_PUSH_STEP, WRECK_PUSH_SPEED_SCALE, isTankUnit, effectiveDiceTerrain, urbanBuildingState,
  easeOutCubic: t => 1 - (1 - t) ** 3 });
function fixture(tiles = []) {
  const scene = new Scene();
  scene.syncTankWreckWater = () => false;
  scene.knownPushedWreckPoses = new WeakMap();
  scene.pushedWreckVisionMoves = new WeakMap();
  scene.isUnitVisible = () => true;
  scene.hexSize = 100;
  scene.project = (q, r) => ({ x: Math.sqrt(3) * (q + r / 2) * scene.hexSize, y: -1.5 * r * scene.hexSize });
  const tank = (id, q, destroyed = false, kind = 'sherman') => ({ id, kind, pos: { q, r: 0 }, facing: 0, destroyed });
  const mover = tank('mover', 0);
  const wreck = tank('wreck', 1, true);
  scene.mission = { sherman: mover, allies: [], enemies: [wreck], map: {
    all: () => tiles, get: pos => tiles.find(tile => tile.pos.q === pos.q && tile.pos.r === pos.r),
  } };
  scene.tankWreckCollisionBody = unit => {
    const c = scene.interpolatedPos(unit);
    return body(unit.id, c.x / scene.hexSize, c.y / scene.hexSize, unit.wreckPose?.angle ?? 0);
  };
  scene.anim = { unit: mover, kind: 'move', fromQ: 0, fromR: 0, toQ: 1, toR: 0, t: 0, dur: 1 };
  return { scene, mover, wreck };
}

test('scene uses deterministic spatial steps across frame rates, drawing and board resizing', () => {
  const run = frameCount => {
    const f = fixture();
    for (let i = 1; i <= frameCount; i++) {
      f.scene.anim.t = i / frameCount;
      f.scene.advanceTankWreckPush(f.scene.anim);
      const pose = JSON.stringify(f.wreck.wreckPose);
      f.scene.advanceTankWreckPush(f.scene.anim);
      assert.equal(JSON.stringify(f.wreck.wreckPose), pose, 'repeated frame must not push again');
    }
    return f;
  };
  const slow = run(12), fast = run(144), dropped = run(1);
  assert.deepEqual(slow.wreck.wreckPose, fast.wreck.wreckPose);
  assert.deepEqual(slow.wreck.wreckPose, dropped.wreck.wreckPose);
  assert(slow.wreck.wreckPose.x > 0.9);
  assert.deepEqual(slow.wreck.pos, { q: 1, r: 0 }, 'visual pushing preserves game-rule positions');
  let drawn;
  slow.scene.drawUnit = (unit, x, y) => { drawn = { x, y }; };
  slow.scene.drawUnitMaybeAnim(slow.wreck);
  assert.deepEqual(drawn, { ...slow.scene.interpolatedPos(slow.wreck) });
  slow.scene.hexSize = 200;
  assert.equal(slow.scene.interpolatedPos(slow.wreck).x, drawn.x * 2);
});

test('pushing uses 30 percent speed and releasing contact restores normal speed', () => {
  const { scene, wreck } = fixture();
  wreck.pos.q = 0.8 / Math.sqrt(3);
  scene.advanceTankMoveTime(scene.anim, 0.2);
  assert(Math.abs(scene.anim.t - 0.06) < 1e-9, '0.2 seconds of pushing should advance 0.06 of a one-second animation');
  assert(wreck.wreckPose.x > 0, 'the slower motion must still advance the wreck solver');
  const before = scene.anim.t;
  wreck.pos.r = 20;
  scene.advanceTankMoveTime(scene.anim, 0.1);
  assert(Math.abs(scene.anim.t - before - 0.1) < 1e-9, 'speed must recover immediately after contact ends');
});

test('distant wrecks, turning, infantry and trucks retain normal animation speed', () => {
  for (const mode of ['distant', 'turn', 'infantry', 'truck', 'destroyed']) {
    const { scene, mover, wreck } = fixture();
    if (mode === 'distant') wreck.pos.r = 20;
    else if (mode === 'turn') scene.anim.kind = 'turn';
    else if (mode === 'destroyed') mover.destroyed = true;
    else mover.kind = mode;
    scene.advanceTankMoveTime(scene.anim, 0.2);
    assert(Math.abs(scene.anim.t - 0.2) < 1e-9, mode);
  }
  const { scene } = fixture();
  scene.mission.enemies = [];
  scene.advanceTankMoveTime(scene.anim, 0.2);
  assert.equal(scene.anim.t, 0.2);
});

test('mud and wreck pushing use the lower speed without stacking, then recover on release', () => {
  const { scene, wreck } = fixture([
    { pos: { q: 0, r: 0 }, terrain: 'mud' }, { pos: { q: 1, r: 0 }, terrain: 'mud' },
  ]);
  wreck.pos.q = 0.8 / Math.sqrt(3);
  scene.advanceTankMoveTime(scene.anim, 0.2);
  assert(Math.abs(scene.anim.t - 0.06) < 1e-9, 'mud pushing must stay at 30%, not 15%');
  assert(wreck.wreckPose.x > 0);
  const before = scene.anim.t;
  wreck.pos.r = 20;
  scene.advanceTankMoveTime(scene.anim, 0.1);
  assert(Math.abs(scene.anim.t - before - 0.05) < 1e-9, 'releasing the wreck restores the 50% mud speed');
});

test('driving away from an overlapping wreck does not create resistance', () => {
  const { scene, wreck } = fixture();
  wreck.pos.q = -0.8 / Math.sqrt(3);
  scene.advanceTankMoveTime(scene.anim, 0.1);
  assert(Math.abs(scene.anim.t - 0.1) < 1e-9);
  assert.equal(wreck.wreckPose, undefined);
});

test('contact partway through a frame slows only the pushing portion, independently of frame rate', () => {
  const run = frames => {
    const { scene, wreck } = fixture();
    for (let i = 0; i < frames; i++) scene.advanceTankMoveTime(scene.anim, 0.9 / frames);
    return { t: scene.anim.t, pose: wreck.wreckPose };
  };
  const dropped = run(1);
  assert(dropped.t > 0.27 && dropped.t < 0.9, 'approach must stay at normal speed until contacting the wreck');
  for (const frames of [12, 60, 144]) {
    const actual = run(frames);
    assert(Math.abs(actual.t - dropped.t) < 1e-9);
    assert.deepEqual(actual.pose, dropped.pose);
  }
});

test('a full-duration push takes normal duration divided by 0.3 and still finishes', () => {
  const { scene, wreck } = fixture();
  wreck.pos.q = 0.8 / Math.sqrt(3);
  scene.advanceTankMoveTime(scene.anim, 1);
  assert(Math.abs(scene.anim.t - 0.3) < 1e-9, 'pushing for the normal duration must leave the move incomplete');
  scene.advanceTankMoveTime(scene.anim, 1 / 0.3 - 1 + 1e-8);
  assert.equal(scene.anim.t, 1);
});

test('only intact/damaged urban buildings obstruct wrecks; other terrain is ignored', () => {
  const obstacle = { pos: { q: 2, r: 0 }, terrain: 'urban_destructible', urbanKind: 'destructible' };
  const run = tile => {
    const { scene, wreck } = fixture([tile]);
    scene.anim.toQ = 2;
    scene.anim.t = 1;
    scene.advanceTankWreckPush(scene.anim);
    return wreck.wreckPose;
  };
  const free = run({ ...obstacle, urbanKind: undefined, terrain: 'field' });
  for (const tile of [
    { ...obstacle, terrain: 'urban_rubble', urbanStructure: 0 },
    { ...obstacle, urbanKind: undefined, terrain: 'forest' },
    { ...obstacle, urbanKind: undefined, terrain: 'trees' },
    { ...obstacle, urbanKind: undefined, terrain: 'building', hasBuilding: true },
    { ...obstacle, urbanKind: undefined, terrain: 'water' },
  ]) assert.deepEqual(run(tile), free, `terrain ${tile.terrain} should not obstruct wrecks`);
  for (const tile of [obstacle, { ...obstacle, urbanStructure: 1 }, { ...obstacle, urbanKind: 'indestructible' }]) {
    const blocked = run(tile);
    assert(Math.abs(blocked.y) > 0.1 || blocked.x < free.x - 0.5);
  }
});

test('infantry, trucks, and turning tanks do not push wrecks', () => {
  for (const mode of ['infantry', 'truck', 'turn', 'destroyed']) {
    const { scene, mover, wreck } = fixture();
    if (mode === 'turn') scene.anim.kind = 'turn';
    else if (mode === 'destroyed') mover.destroyed = true;
    else mover.kind = mode;
    scene.anim.t = 1;
    scene.advanceTankWreckPush(scene.anim);
    assert.equal(wreck.wreckPose, undefined);
  }
});

test('backward motion and all six travel directions push wrecks', () => {
  for (let direction = 0; direction < 6; direction++) {
    const angle = direction * Math.PI / 3;
    const wreck = body('wreck', 0, 0, angle);
    const mover = body('mover', -2 * Math.cos(angle), -2 * Math.sin(angle), angle + Math.PI);
    for (let i = 1; i <= 120; i++) {
      mover.x = (-2 + i * 0.025) * Math.cos(angle);
      mover.y = (-2 + i * 0.025) * Math.sin(angle);
      pushTankWrecks([wreck], mover, { x: 0.025 * Math.cos(angle), y: 0.025 * Math.sin(angle) }, [], []);
    }
    assert(wreck.x * Math.cos(angle) + wreck.y * Math.sin(angle) > 1.5);
  }
});

test('wreck fire and off-map mask follow its visual location without revealing hidden map tiles', () => {
  const { neighbors } = require('../assets/scripts/core/HexGrid.ts');
  const MaskScene = require('./helpers/BattleSceneMethods.cjs')([
    'redrawVisibleHexMask', 'isUnitVisible', 'drawUnitEffects',
  ], { wreckVisualHex, neighbors, WRECK_SINK_DURATION: 1, Color: class {} });
  const scene = new MaskScene();
  const wreck = { id: 'wreck', destroyed: true, pos: { q: 0, r: 0 }, wreckPose: { x: Math.sqrt(3) * 4, y: 0, angle: 0 } };
  const tiles = [{ pos: { q: 0, r: 0 } }, { pos: { q: 3, r: 1 } }];
  scene.hexSize = 1;
  scene.mission = { sherman: {}, enemies: [wreck], allies: [], map: {
    all: () => tiles, has: pos => tiles.some(tile => tile.pos.q === pos.q && tile.pos.r === pos.r),
  } };
  scene.isHexVisible = pos => pos.q === 0 && pos.r === 0;
  scene.project = (q, r) => ({ x: q, y: r });
  scene.playerTankEvacVisibilityExtension = () => null;
  let drawn = [];
  scene.traceHexPathOn = (_, x, y) => drawn.push(`${x},${y}`);
  const mask = { clear() { drawn = []; }, fill() {} };
  scene.redrawVisibleHexMask(mask, true);
  assert(drawn.includes('4,0'), 'far off-map wrecks must remain renderable');
  assert(!drawn.includes('3,1'), 'a real hidden tile must not be revealed by a wreck stencil');
  scene.redrawVisibleHexMask(mask, false);
  assert(!drawn.includes('4,0'), 'ground tracks should not inherit the wreck stencil');
  scene.interpolatedPos = () => ({ x: 4, y: 0 });
  scene.unitEffectGraphics = { clear() {} };
  scene.unitEffectVisuals = new Map([['wreck', { unit: wreck, fireAlpha: 1, smokeAlpha: 0 }]]);
  let fireOrigin;
  scene.drawFireEffect = (_, x, y) => { fireOrigin = { x, y }; };
  scene.drawAmbushMuzzleReticles = () => {};
  scene.drawLockedFireReticles = () => {};
  scene.drawWreckWaterRipples = () => {};
  scene.drawUnitEffects();
  assert.deepEqual(fireOrigin, { x: 4, y: 0 });
  wreck.wreckPose = { x: Math.sqrt(3) * 3.5, y: -1.5, angle: 0 };
  assert.equal(scene.isUnitVisible(wreck), false, 'wreck fire must disappear when moved into a hidden map tile');
});

test('scene preserves the solver hull center when an offset sprite rotates', () => {
  const HullScene = require('./helpers/BattleSceneMethods.cjs')([
    'advanceTankWreckPush', 'updateTankWreckPose', 'interpolatedPos', 'tankWreckCollisionBody', 'topDownForwardVec',
  ], { pushTankWrecks, WRECK_PUSH_STEP, isTankUnit, urbanBuildingState,
    tankVisualConfigOf: () => ({ offsetForward: 0.07, offsetRight: 0.02 }),
    easeOutCubic: t => 1 - (1 - t) ** 3 });
  const { scene: base, mover, wreck } = fixture();
  const scene = new HullScene();
  scene.syncTankWreckWater = () => false;
  scene.knownPushedWreckPoses = new WeakMap();
  scene.pushedWreckVisionMoves = new WeakMap();
  scene.isUnitVisible = () => true;
  scene.hexSize = 100;
  scene.project = base.project;
  scene.mission = base.mission;
  scene.anim = { ...base.anim, toQ: 0.025 / Math.sqrt(3), t: 1 };
  wreck.pos.q = 0.8 / Math.sqrt(3);
  wreck.pos.r = 0.14;
  scene.directionScreenAngle = (_, __, dir) => -dir * Math.PI / 3;
  scene.splitHullDisplayBasis = () => null;
  scene.tankBodyDisplaySizePx = () => ({ length: 100, width: 60 });
  scene.destroyedTankOffset = (_, size) => ({ forward: size * 0.12, right: size * 0.03 });
  const expectedWreck = scene.tankWreckCollisionBody(wreck);
  const expectedMover = scene.tankWreckCollisionBody(mover);
  // The actual moving hull is sampled at the final 0.025-radius position.
  pushTankWrecks([expectedWreck], expectedMover, { x: 0.025, y: 0 }, [], []);
  scene.advanceTankWreckPush(scene.anim);
  const actual = scene.tankWreckCollisionBody(wreck);
  assert(wreck.wreckPose && Math.abs(wreck.wreckPose.angle) > 0, 'fixture must exercise rotation');
  for (const field of ['x', 'y', 'angle']) assert(Math.abs(actual[field] - expectedWreck[field]) < 1e-9, field);
});

test('save/load round-trip retains each wreck pose and clears it for older checkpoints', () => {
  const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
  const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
  const data = JSON.parse(fs.readFileSync('assets/resources/missions/mission_03.json', 'utf8'));
  const mission = loadMission(data);
  const units = [mission.sherman, ...mission.allies, ...mission.enemies];
  units.forEach((unit, i) => {
    unit.destroyed = true;
    unit.wreckPose = { x: i + 0.25, y: -i - 0.5, angle: i * 0.2 };
  });
  const saved = captureSave({ gameMode: 'hardcore', missionId: data.id, mission, turn: 1,
    phase: 'player', movesLeft: 2, attacksLeft: 1, miscDone: false, playerStep: 'choose',
    hatchChangedThisTurn: false, phaseDice: [] });
  const cleanSave = JSON.parse(JSON.stringify(saved));
  const restored = loadMission(data);
  assert.equal(applySave(restored, data.id, cleanSave).ok, true);
  const restoredUnits = [restored.sherman, ...restored.allies, ...restored.enemies];
  restoredUnits.forEach((unit, i) => assert.deepEqual(unit.wreckPose, units[i].wreckPose));
  units[0].wreckPose.x = 999;
  assert.equal(saved.sherman.wreckPose.x, 0.25, 'snapshot must own a copy');
  restored.sherman.wreckPose.x = 555;
  assert.equal(cleanSave.sherman.wreckPose.x, 0.25, 'restored pose must own a copy');
  for (const unit of [cleanSave.sherman, cleanSave.playerTank, ...(cleanSave.allies ?? []), ...cleanSave.enemies]) delete unit.wreckPose;
  assert.equal(applySave(restored, data.id, cleanSave).ok, true);
  restoredUnits.forEach(unit => assert.equal(unit.wreckPose, undefined));
});
