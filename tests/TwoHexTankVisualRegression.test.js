const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const rules = Object.assign({}, ...['HexGrid', 'UnitFootprint', 'UnitDB', 'types', 'GameMode', 'FogOfWar', 'TankVisualDB', 'TurretTraverse']
  .map(name => require(`../assets/scripts/core/${name}.ts`)), require('../assets/scripts/view/TankTrackVisual.ts'),
  require('../assets/scripts/view/MachineGunBurstGeometry.ts'));
const GameSession = { gameMode: 'hardcore' };
const easeOutCubic = t => 1 - (1 - t) ** 3;
class Transform {
  setContentSize(w, h) { this.width = w; this.height = h; }
  setAnchorPoint(x, y) { this.anchorX = x; this.anchorY = y; }
}
class Sprite { static SizeMode = { CUSTOM: 1 }; }
function slot() {
  const transform = new Transform();
  return { sprite: {}, node: { getComponent: () => transform, transform,
    setPosition(x, y) { this.x = x; this.y = y; }, setScale() {} } };
}
const Scene = require('./helpers/BattleSceneMethods.cjs')([
  'interpolatedPos', 'facingToScreenUnitVec', 'facingBlendScreenVec', 'directionScreenAngle', 'topDownForwardVec',
  'tankBodyDisplaySizePx', 'applySplitTankHullSprite', 'applySplitTankTurretSprite', 'splitTankTurretPivot',
  'destroyedTankDisplaySize', 'addTankTurnTrack', 'addTankTrack', 'recalculateTankTrackExtensions',
  'beginTankTrackAnimation', 'advanceTankTrackAnimation', 'redrawTankTracks',
  'redrawTurretAimOverlay', 'visibleTurretAimDirection', 'fogTurretAimDirection', 'tryAimShermanTurretAtFogTile',
  'startShermanTurretAim', 'startEnemyTurretAim', 'turretTargetDirection',
  'muzzleFlashPosition', 'splitTankMuzzlePosition', 'turretVisualScreenAngle', 'targetScreenAngle', 'machineGunMuzzlePosition',
  'hullTurnRenderedAngularProgress', 'currentShermanTurretLerp', 'currentEnemyTurretLerp',
  'prepareCampaignExitTurretAlignment', 'finishCampaignExitTurretAlignment',
], { ...rules, GameSession, easeOutCubic, UITransform: Transform, Sprite, clearLockedFire() {},
  easeInOutCubic: t => t < 0.5 ? 4*t*t*t : 1-((-2*t+2)**3)/2,
  startTurretTraverseSound() {}, stopTurretTraverseSound() {},
  isSplitTankKind: kind => rules.SPLIT_TANK_KINDS.includes(kind),
});
const near = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function fixture(facing = 0, sign = 1, camera90 = false) {
  const stats = rules.getUnitStats('maus');
  const unit = { id: 'maus', kind: 'maus', stats, pos: { q: 0, r: 0 }, facing, turretFacing: facing,
    crew: rules.createTankCrew(stats), hatchOpen: true };
  const map = new rules.HexMap(15, 15);
  for (let q = -6; q <= 6; q++) for (let r = -6; r <= 6; r++) map.set({ pos: { q, r }, terrain: 'field' });
  const scene = new Scene();
  const plan = rules.planUnitMove(unit, sign === 1 ? 'cw' : 'ccw');
  const noop = () => {};
  Object.assign(scene, {
    hexSize: 60, mission: { map, sherman: unit, smokeHexes: new Set(), data: {} },
    anim: { unit, kind: 'turn', fromQ: 0, fromR: 0, toQ: plan.pos.q, toR: plan.pos.r,
      turnFrom: facing, turnTo: plan.facing, t: 0 },
    project(q, r) {
      const x = Math.sqrt(3) * 60 * (q + r / 2), y = -90 * r;
      return camera90 ? { x: -y + 17, y: x - 31 } : { x: x + 17, y: y - 31 };
    },
    splitHullDisplayBasis(kind) {
      const geometry = rules.splitTankGeometryConfigOf(kind), visual = rules.splitTankVisualConfigOf(kind);
      return { trimW: geometry.topTrim.w, trimH: geometry.topTrim.h, fitScale: visual.hullFitScale,
        offsetForward: visual.hullOffsetForward, offsetRight: visual.hullOffsetRight };
    },
    tankTurnTracks: [], tankTracks: [], tankTrackSerial: 0, redrawTankTracks: noop,
    splitTankSpritesFor: () => ({ hull: {}, turret: {} }), applyTankConcealmentOpacity: noop,
    registerEngineVibrationVisual: noop, syncTankDamageOverlay: noop, tankRiderRenderer: { draw: noop },
    allUnits: () => [unit], mainGunRecoilOffsetFor: () => ({ x: 0, y: 0 }),
  });
  return { scene, unit, map, plan };
}

test('campaign turn exits align the turret with the final hull heading throughout the animation', () => {
  for(const sign of [-1,1])for(const turret of [0,3]) {
    const {scene,unit}=fixture(sign===1?5:1,sign);
    Object.assign(scene,{campaignRuntime:{segments:[{},{}]},activeCampaignSegmentIndex:0,
      enemySupportsSplitTurret:()=>true,shermanTurretFacing:turret});
    unit.turretFacing=turret;scene.anim.evacExit=true;
    scene.prepareCampaignExitTurretAlignment(scene.anim);
    assert.equal(scene.anim.campaignExitTurretTo,0);
    assert.equal(scene.anim.campaignExitTurretSoundPlaying,true);
    for(const t of [0,0.2,0.6,1]) {
      scene.anim.t=t;
      const lerp=scene.currentShermanTurretLerp(unit);
      assert.equal(lerp.from,turret);assert.equal(lerp.to,0);
      near(lerp.t,rules.tankSteeringProgress(t));
    }
    unit.facing=0;unit.turretFacing=4;
    scene.finishCampaignExitTurretAlignment(scene.anim);
    assert.equal(unit.turretFacing,0);assert.equal(scene.shermanTurretFacing,0);
  }
});

test('Maus hull, turret, wreck and treads retain the configured dimensions regardless of footprint length', () => {
  const { scene, unit } = fixture();
  scene.anim = null;
  const visual = rules.splitTankVisualConfigOf('maus'), geometry = rules.splitTankGeometryConfigOf('maus');
  const scale = scene.hexSize * 1.8 * visual.hullFitScale / Math.max(geometry.topTrim.w, geometry.topTrim.h);
  for (const footprintLength of [1, 2]) {
    unit.stats = { ...unit.stats, footprintLength };
    const hull = slot(), turret = slot();
    scene.applySplitTankHullSprite(hull, unit, 'maus', { x: 0, y: 0 });
    scene.applySplitTankTurretSprite(turret, unit, 'maus', { x: 0, y: 0 });
    near(hull.node.transform.width, geometry.topTrim.w * scale);
    near(hull.node.transform.height, geometry.topTrim.h * scale);
    near(turret.node.transform.width, geometry.turretTrim.w * scale * visual.turretScale);
    near(turret.node.transform.height, geometry.turretTrim.h * scale * visual.turretScale);
    const wreck = scene.destroyedTankDisplaySize('maus', 100, 40, scene.hexSize);
    near(wreck.w, hull.node.transform.width * rules.tankVisualConfigOf('maus').destroyedFitScale);
    near(wreck.h, hull.node.transform.height * rules.tankVisualConfigOf('maus').destroyedFitScale);
    const treads = scene.tankBodyDisplaySizePx(unit);
    near(treads.length, hull.node.transform.width * rules.tankVisualConfigOf('maus').trackBodyLengthScale);
    near(treads.width, hull.node.transform.height * rules.tankVisualConfigOf('maus').trackBodyWidthScale);
  }
});

for (let facing = 0; facing < 6; facing++) for (const sign of [-1, 1]) for (const camera90 of [false, true]) {
  test(`two-hex tread ends follow the rendered translating hull: facing ${facing}, turn ${sign}, camera ${camera90 ? 90 : 0}`, () => {
    const { scene, unit } = fixture(facing, sign, camera90);
    const track = scene.addTankTurnTrack(unit, scene.anim);
    assert(track.steering);
    const from = scene.project(track.steering.from.q, track.steering.from.r);
    const to = scene.project(track.steering.to.q, track.steering.to.r);
    assert(Math.hypot(to.x - from.x, to.y - from.y) > 1, 'steering centre must translate');
    const turnAngle = Math.atan2(Math.sin(track.toAngle - track.fromAngle), Math.cos(track.toAngle - track.fromAngle));
    const signedRadius = Math.sign(turnAngle) * scene.hexSize * 1.5;
    const circleCenter = { x: from.x - Math.sin(track.fromAngle) * signedRadius,
      y: from.y + Math.cos(track.fromAngle) * signedRadius };
    const visual = rules.splitTankVisualConfigOf('maus');
    for (const t of [0, 0.03, 0.17, 0.4, 0.5, 0.81, 0.99, 1]) {
      scene.anim.t = t;
      const paths = rules.tankTrackSteeringPaths(from, to, track.halfBodyLength, track.halfGap,
        track.fromAngle, track.toAngle, rules.tankSteeringProgress(t),
        track.steering.offsetForward * scene.hexSize * Math.sqrt(3),
        track.steering.offsetRight * scene.hexSize * Math.sqrt(3));
      // Compare against actual scene rendering, not a second copy of the path formula.
      const center = scene.interpolatedPos(unit);
      const lerp = { from: scene.anim.turnFrom, to: scene.anim.turnTo, t };
      const body = scene.topDownForwardVec(unit, center, lerp);
      near(Math.hypot(center.x - circleCenter.x, center.y - circleCenter.y), Math.abs(signedRadius));
      if (t > 0 && t < 1) {
        const step = 0.00001;
        scene.anim.t = t - step;
        const before = scene.interpolatedPos(unit);
        scene.anim.t = t + step;
        const after = scene.interpolatedPos(unit);
        scene.anim.t = t;
        const dx = after.x - before.x, dy = after.y - before.y;
        const length = Math.hypot(dx, dy);
        assert(length > 0);
        assert(Math.abs((dx * body.uy - dy * body.ux) / length) < 1e-7,
          'travel must follow the hull heading without sideways drift');
        assert((dx * body.ux + dy * body.uy) / length > 0.999999,
          'the tank must drive forward through the bend');
      }
      const hull = slot();
      scene.applySplitTankHullSprite(hull, unit, 'maus', center, lerp);
      near(hull.node.x, center.x + scene.hexSize * Math.sqrt(3) * (visual.hullOffsetForward * body.ux + visual.hullOffsetRight * body.uy));
      const offsets = [[track.halfBodyLength, track.halfGap], [track.halfBodyLength, -track.halfGap],
        [-track.halfBodyLength, track.halfGap], [-track.halfBodyLength, -track.halfGap]];
      paths.forEach((path, i) => {
        const last = path.at(-1), [forward, lateral] = offsets[i];
        near(last.x, hull.node.x + body.ux * forward - body.uy * lateral);
        near(last.y, hull.node.y + body.uy * forward + body.ux * lateral);
      });
    }
    scene.activeTankTrackAnim = scene.anim;
    scene.activeTankTurnTrack = track;
    scene.anim.t = 0.37;
    scene.advanceTankTrackAnimation(scene.anim);
    near(track.progress, rules.tankSteeringProgress(0.37));
    scene.anim.t = 1;
    const arrival = scene.interpolatedPos(unit);
    const arrivalFacing = scene.topDownForwardVec(unit, arrival, { from: facing, to: scene.anim.turnTo, t: 1 });
    const nextFront = scene.project(scene.anim.toQ, scene.anim.toR);
    near(arrival.x + arrivalFacing.ux * scene.hexSize * Math.sqrt(3) / 2, nextFront.x);
    near(arrival.y + arrivalFacing.uy * scene.hexSize * Math.sqrt(3) / 2, nextFront.y);
    near(arrival.x - arrivalFacing.ux * scene.hexSize * Math.sqrt(3) / 2, scene.project(0, 0).x);
    near(arrival.y - arrivalFacing.uy * scene.hexSize * Math.sqrt(3) / 2, scene.project(0, 0).y);
    unit.pos = { q: scene.anim.toQ, r: scene.anim.toR };
    unit.facing = scene.anim.turnTo;
    scene.anim = null;
    near(scene.interpolatedPos(unit).x, arrival.x);
    near(scene.interpolatedPos(unit).y, arrival.y);
  });
}

test('the already-laid portion of a steering trail stays stable as the animation advances', () => {
  const args = [{ x: 0, y: 0 }, { x: 70, y: 80 }, 40, 15, 0, -Math.PI / 3];
  const early = rules.tankTrackSteeringPaths(...args, 0.35);
  const later = rules.tankTrackSteeringPaths(...args, 0.71);
  early.forEach((path, i) => assert.deepEqual(later[i].slice(0, path.length - 1), path.slice(0, -1)));
});

test('two-hex steering eases symmetrically into and out of the bend', () => {
  const progress = rules.tankSteeringProgress;
  near(progress(-1), 0); near(progress(0), 0); near(progress(0.5), 0.5);
  near(progress(1), 1); near(progress(2), 1);
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    near(progress(t) + progress(1 - t), 1);
    if (i > 0) assert(progress(t) >= progress(t - 0.01));
  }
  const startDistance = progress(0.01), endDistance = 1 - progress(0.99);
  const middleDistance = progress(0.505) - progress(0.495);
  assert(startDistance < middleDistance / 1000);
  near(startDistance, endDistance);
});

test('player and AI turrets preserve their hull-relative angle throughout circular turns', () => {
  for (let facing = 0; facing < 6; facing++) for (const sign of [-1, 1]) for (const player of [true, false]) {
    const { scene, unit } = fixture(facing, sign);
    unit.turretFacing = ((facing + 1) % 6);
    scene.enemyTurretFacing = new Map([[unit.id, unit.turretFacing]]);
    scene.shermanTurretFacing = unit.turretFacing;
    if (!player) scene.mission.sherman = {};
    for (const t of [0, 0.01, 0.17, 0.5, 0.83, 0.99, 1]) {
      scene.anim.t = t;
      const center = scene.interpolatedPos(unit);
      const bodyLerp = { from: scene.anim.turnFrom, to: scene.anim.turnTo, t };
      const body = scene.topDownForwardVec(unit, center, bodyLerp);
      const turretLerp = player ? scene.currentShermanTurretLerp(unit) : scene.currentEnemyTurretLerp(unit);
      near(turretLerp.t, rules.tankSteeringProgress(t));
      const turret = scene.topDownForwardVec(unit, center, turretLerp);
      const relativeAngle = Math.atan2(body.ux * turret.uy - body.uy * turret.ux, body.ux * turret.ux + body.uy * turret.uy);
      near(relativeAngle, -Math.PI / 3);
      const sprite = slot();
      scene.applySplitTankTurretSprite(sprite, unit, 'maus', center, bodyLerp, turretLerp);
      const pivot = scene.splitTankTurretPivot(unit, center, rules.splitTankVisualConfigOf('maus'),
        rules.splitTankGeometryConfigOf('maus'), bodyLerp);
      near(sprite.node.x, pivot.x); near(sprite.node.y, pivot.y);
    }
  }
});

test('single-hex pivots retain their original position and facing animation', () => {
  const { scene, unit } = fixture();
  unit.stats = { ...unit.stats, footprintLength: 1 };
  const origin = scene.project(unit.pos.q, unit.pos.r);
  for (const t of [0, 0.17, 0.5, 0.83, 1]) {
    scene.anim.t = t;
    const position = scene.interpolatedPos(unit);
    near(position.x, origin.x); near(position.y, origin.y);
    const body = scene.topDownForwardVec(unit, position, { from: scene.anim.turnFrom, to: scene.anim.turnTo, t });
    const expected = scene.facingBlendScreenVec(unit.pos, scene.anim.turnFrom, scene.anim.turnTo, t);
    near(body.ux, expected.ux); near(body.uy, expected.uy);
  }
});

test('the scene draws translating turn paths through its normal tread renderer', () => {
  const { scene, unit } = fixture(2, -1, true);
  const track = scene.addTankTurnTrack(unit, scene.anim);
  track.progress = 0.63;
  const drawn = [];
  scene.tankTrackGraphics = { clear() {} };
  scene.appendTankTrackSegment = (_g, x1, y1, x2, y2) => drawn.push([x1, y1, x2, y2]);
  Scene.prototype.redrawTankTracks.call(scene);
  const expected = rules.tankTrackSteeringPaths(
    scene.project(track.steering.from.q, track.steering.from.r),
    scene.project(track.steering.to.q, track.steering.to.r),
    track.halfBodyLength, track.halfGap, track.fromAngle, track.toAngle, track.progress,
    track.steering.offsetForward * scene.hexSize * Math.sqrt(3),
    track.steering.offsetRight * scene.hexSize * Math.sqrt(3),
  ).flatMap(path => path.slice(1).map((p, i) => [path[i].x, path[i].y, p.x, p.y]));
  assert(drawn.length > 0);
  assert.deepEqual(drawn, expected);
});

test('straight two-hex trails start at the rendered midpoint, with configured hull offsets', () => {
  const { scene, unit } = fixture();
  scene.anim = { unit, kind: 'move', fromQ: 0, fromR: 0, toQ: 1, toR: 0, t: 0 };
  const track = scene.addTankTrack(unit, scene.anim);
  const center = rules.unitCenterHex(unit);
  near(track.fromQ + track.centerOffset.q, center.q);
  near(track.fromR + track.centerOffset.r, center.r);
  near(track.bodyOffset.forward, rules.splitTankVisualConfigOf('maus').hullOffsetForward);
  near(track.bodyOffset.right, rules.splitTankVisualConfigOf('maus').hullOffsetRight);
});

test('turret ring, excluded origin hex and blue target directions start at the rear turret hex', () => {
  const { scene, unit, map } = fixture();
  scene.anim = null;
  const noop = () => {}, considered = [];
  Object.assign(scene, {
    outsideMapTurretInputNodes: [], turretAimOverlayGraphics: { clear: noop }, turretAimOverlayNode: {},
    selectedGunDieIdx: 0, selectedGunHitThresholdModifier: 0, selectedMGDieIdx: -1,
    playerTurretCanRotate: () => true, playerHasFixedWeaponArc: () => false,
    hasTurretReconGunSelection: () => true, playerWeaponTargetHexKeys: () => new Set(),
    isDeepShadowTile: () => false, isHexVisible: () => true,
    visibleTurretAimDirection: p => { considered.push(p); return null; },
    outsideMapTurretAimPositions: () => [], currentTurretFacingFor: () => 0,
    drawTurretTraverseAngleRing: (_g, x, y) => { scene.ring = { x, y }; },
  });
  scene.redrawTurretAimOverlay();
  const rear = rules.unitTurretHex(unit), expected = scene.project(rear.q, rear.r);
  near(scene.ring.x, expected.x); near(scene.ring.y, expected.y);
  assert(!considered.some(pos => rules.axialEquals(pos, rear)), 'the turret origin must not be offered as a target');
  assert(considered.some(pos => rules.axialEquals(pos, unit.pos)), 'the front hex must not be mistaken for the origin');
});

test('player and AI aiming derive the direction from the turret cell, not the front anchor', () => {
  const { scene, unit } = fixture();
  const target = { pos: { q: -1, r: -2 } };
  const expected = rules.fireDirectionTo(rules.unitTurretHex(unit), target.pos);
  assert.notEqual(expected, rules.fireDirectionTo(unit.pos, target.pos));
  let aimed;
  Object.assign(scene, { currentWeather: () => 'sunny', startShermanTurretAimDirection: direction => { aimed = direction; } });
  scene.startShermanTurretAim(target, () => {});
  assert.equal(aimed, expected);
  scene.currentTurretFacingFor = () => expected;
  scene.turretTraverseSpeedFor = () => 6;
  scene.enemySupportsSplitTurret = () => true;
  scene.beginTurretAimAnim = anim => { aimed = anim.to; };
  scene.redraw = () => {};
  scene.enemyTurretFacing = new Map();
  scene.startEnemyTurretAim(unit, target, () => {});
  assert.equal(aimed, expected);
});

test('rotation-only clicks use the rear-cell distance limit, including a boundary rejected from the front', () => {
  const { scene, unit } = fixture();
  const target = { q: -5, r: 0 };
  unit.gunnerVisionRange = 4;
  assert.equal(rules.hexDistance(unit.pos, target), 5);
  assert.equal(rules.hexDistance(rules.unitTurretHex(unit), target), 4);
  let aimed;
  Object.assign(scene, {
    selectedGunDieIdx: 0, selectedMGDieIdx: -1, selectedGunDoublesIdx: -1, phaseDice: [{ used: false }],
    currentWeather: () => 'sunny', currentTurretFacingFor: () => 0,
    playerHasFixedWeaponArc: () => false, playerTurretCanRotate: () => true,
    hideTurretTargetOverlayForCommittedAction() {}, showGunAimWarning: key => assert.fail(key),
    refreshPhaseUI() {}, updateHUD() {}, redraw() {},
    startShermanTurretAimDirection: direction => { aimed = direction; },
  });
  scene.tryAimShermanTurretAtFogTile(3, target);
  assert.equal(aimed, 3);
});

test('Maus cannon effects start at the rendered barrel tip for player and AI in all six hull headings', () => {
  for (let facing = 0; facing < 6; facing++) for (const player of [true, false]) {
    const { scene, unit } = fixture(facing);
    scene.anim = null;
    if (!player) scene.mission.sherman = {};
    const cfg = rules.splitTankVisualConfigOf('maus'), geometry = rules.splitTankGeometryConfigOf('maus');
    const target = { pos: { q: 4, r: -3 } };
    const angle = scene.turretVisualScreenAngle(unit, target.pos);
    const sprite = slot();
    scene.applySplitTankTurretSprite(sprite, unit, 'maus', scene.interpolatedPos(unit), null,
      { from: 0, to: 0, t: 1, angular: true, fromVisualTarget: target.pos, toVisualTarget: target.pos });
    const scaleX = sprite.node.transform.width / geometry.turretTrim.w;
    const scaleY = sprite.node.transform.height / geometry.turretTrim.h;
    const localX = (geometry.muzzle.spriteX - geometry.turretTrim.x
      - sprite.node.transform.anchorX * geometry.turretTrim.w) * scaleX;
    const localY = (geometry.turretTrim.y + (1 - sprite.node.transform.anchorY) * geometry.turretTrim.h
      - geometry.muzzle.spriteY) * scaleY;
    const rotation = (sprite.node.angle ?? 0) * Math.PI / 180;
    const expected = { x: sprite.node.x + localX * Math.cos(rotation) - localY * Math.sin(rotation),
      y: sprite.node.y + localX * Math.sin(rotation) + localY * Math.cos(rotation) };
    const shot = scene.muzzleFlashPosition(unit, target);
    near(shot.x, expected.x); near(shot.y, expected.y);
    near(shot.ux, Math.cos(angle)); near(shot.uy, Math.sin(angle));
    scene.currentShermanTurretLerp = scene.currentEnemyTurretLerp = () => ({
      from: 0, to: 0, t: 1, angular: true, fromVisualTarget: target.pos, toVisualTarget: target.pos,
    });
    const visual = rules.tankVisualConfigOf('maus');
    const coaxLocalX = (visual.coaxialMuzzleSpriteX - geometry.turretTrim.x
      - sprite.node.transform.anchorX * geometry.turretTrim.w) * scaleX;
    const coaxLocalY = (geometry.turretTrim.y + (1 - sprite.node.transform.anchorY) * geometry.turretTrim.h
      - visual.coaxialMuzzleSpriteY) * scaleY;
    const coax = scene.machineGunMuzzlePosition(unit, 'coaxial');
    near(coax.x, sprite.node.x + coaxLocalX * Math.cos(rotation) - coaxLocalY * Math.sin(rotation));
    near(coax.y, sprite.node.y + coaxLocalX * Math.sin(rotation) + coaxLocalY * Math.cos(rotation));
    const wrongFront = scene.splitTankMuzzlePosition(unit, scene.project(unit.pos.q, unit.pos.r), cfg, geometry,
      { ux: Math.cos(angle), uy: Math.sin(angle) });
    near(Math.hypot(wrongFront.x - shot.x, wrongFront.y - shot.y), scene.hexSize * Math.sqrt(3) / 2);
  }
});
