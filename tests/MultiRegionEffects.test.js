const assert = require('node:assert/strict');
const test = require('node:test');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
class UITransform { setContentSize() {} setAnchorPoint() {} }
class Sprite { static SizeMode = { CUSTOM: 1 }; }
class Color {}
class UIOpacity {}
class Node {
  constructor(name) { this.name = name; this.children = []; this.isValid = true; this.active = true; }
  addComponent(Type) { return new Type(); }
  addChild(node) { this.children.push(node); }
  setPosition() {} setSiblingIndex() {} setScale() {}
  destroy() { this.isValid = false; }
}
let sounds = 0;
const Scene = sceneMethods([
  'isOutsidePlayerRegion', 'canHearBattleAt', 'isUnitVisible', 'registerDestroyWreckVisual',
  'registerImpactDestroyWreckVisual', 'registerAmmoExplosionWreckVisual', 'playTankDestroySoundOnce',
  'spawnDestroyedTurretVisual', 'advanceDestroyedTurretVisuals', 'clearRegionalTransientEffects',
  'playAttackFireCue', 'playMachineGunFireCue', 'playHighExplosiveSuppressionCue',
  'advanceProjectileTraces', 'advanceInfantryRocketTraces', 'advanceSniperBulletTraces',
], { Node, UITransform, Sprite, Color, UIOpacity,
  isSplitTankKind: () => true, isTankUnit: () => true, isFootUnit: () => false,
  playTankExplosion: () => sounds++, playConfiguredAttackSound: () => sounds++,
  playHighExplosiveHit: () => sounds++, playTankHitPenetration: () => sounds++,
  splitTankVisualConfigOf: () => ({ hullFitScale: 1, turretScale: 1, hullOffsetForward: 0, hullOffsetRight: 0,
    turretOffsetForward: 0, turretOffsetRight: 0 }),
  splitTankGeometryConfigOf: () => ({ topTrim: { x: 0, y: 0, w: 100, h: 100 },
    turretTrim: { x: 0, y: 0, w: 50, h: 50 }, pivot: { bodyX: 50, bodyY: 50, spriteX: 25, spriteY: 25 } }),
  easeOutCubic: t => t, WRECK_SINK_DURATION: 5,
});
function fixture() {
  sounds = 0;
  const scene = new Scene();
  Object.assign(scene, { mission: { data: { multiRegion: {} }, sherman: { pos: { q: 0, r: 0 } },
    map: { sameRegion: (a, b) => (a.q < 10) === (b.q < 10) } }, node: { layer: 1 }, hexSize: 60,
    unitEffectNode: new Node('UnitEffects'), destroyedTurretVisualIds: new Set(), destroyWreckVisualIds: new Set(),
    destroyedTurretVisuals: [], firedAttackCueReports: new WeakSet(),
    projectileTraces: [], infantryRocketTraces: [], sniperBulletTraces: [],
    splitTankSpritesFor: () => ({ turret: {} }), project: (q, r) => ({ x: q, y: r }),
    topDownForwardVec: () => ({ ux: 1, uy: 0 }), currentTurretFacingFor: () => 0, directionScreenAngle: () => 0,
    placeUnitEffectLayerAboveUnits() {}, rememberAttackPosition() {},
    startMainGunRecoil() { assert.fail('unexpected recoil'); }, setInfantryVisualFacing() { assert.fail('unexpected facing animation'); },
    spawnMuzzleFlash() { assert.fail('unexpected muzzle flash'); }, spawnMuzzleSmoke() { assert.fail('unexpected muzzle smoke'); },
    spawnMachineGunBurst() { assert.fail('unexpected MG burst'); }, drawProjectileTrace() {},
    drawInfantryRocketTrace() {}, drawSniperBulletTrace() {},
  });
  return scene;
}
const tank = (id, q = 20) => ({ id, pos: { q, r: 0 }, destroyed: true, kind: 'panzer4', stats: { attackSound: '' } });

test('all remote tank destruction paths record the wreck without spawning or later replaying a turret launch', () => {
  const scene = fixture();
  for (const [i, method] of ['registerDestroyWreckVisual', 'registerImpactDestroyWreckVisual', 'registerAmmoExplosionWreckVisual'].entries()) {
    const unit = tank(`remote_${i}`);
    scene[method](unit, null);
    assert(scene.destroyWreckVisualIds.has(unit.id));
    assert(scene.destroyedTurretVisualIds.has(unit.id));
  }
  assert.equal(scene.destroyedTurretVisuals.length, 0);
  assert.equal(scene.unitEffectNode.children.length, 0);
  assert.equal(sounds, 0);
  scene.mission.sherman.pos.q = 20;
  scene.registerImpactDestroyWreckVisual(tank('remote_1'), null);
  assert.equal(scene.destroyedTurretVisuals.length, 0, 'entering the old kill region must not replay the animation');
});

test('local turret launches still work and an in-flight turret disappears when the player changes region', () => {
  const scene = fixture();
  scene.registerImpactDestroyWreckVisual(tank('local', 0), null);
  assert.equal(sounds, 1);
  assert.equal(scene.destroyedTurretVisuals.length, 1);
  const node = scene.destroyedTurretVisuals[0].node;
  scene.advanceDestroyedTurretVisuals(.1);
  assert(node.isValid);
  scene.mission.sherman.pos.q = 20;
  scene.advanceDestroyedTurretVisuals(.1);
  assert.equal(node.isValid, false);
  assert.equal(scene.destroyedTurretVisuals.length, 0);
  assert(scene.destroyedTurretVisualIds.has('local'));
});

test('ordinary missions retain their existing turret launch behavior', () => {
  const scene = fixture();
  scene.mission.data = {};
  scene.registerAmmoExplosionWreckVisual(tank('ordinary'));
  assert.equal(scene.destroyedTurretVisuals.length, 1);
});

test('region changes clear cosmetic effects and hide pending impacts without discarding damage callbacks', () => {
  const scene = fixture(), cleared = [];
  for (const name of ['clearMuzzleFlashes', 'clearMuzzleSmokes', 'clearHighExplosiveBlasts', 'clearMachineGunBursts',
    'clearInfantryBulletVolleys', 'clearTankEngineExhaust', 'clearFloaters']) scene[name] = () => cleared.push(name);
  scene.destroyedTurretVisualIds.add('old');
  const oldTurret = new Node('old turret'); scene.destroyedTurretVisuals.push({ node: oldTurret });
  let resolved = 0;
  const impactHex = { q: 0, r: 0 }, node = () => new Node('tracer');
  scene.projectileTraces = [{ impactHex, node: node(), phase: 'flight', mode: 'penetration', t: 0, dur: .1,
    onPenetrationImpact: () => resolved++ }];
  scene.infantryRocketTraces = [{ impactHex, node: node(), mode: 'penetration', t: 0, flightDur: .1, dur: 1,
    onPenetrationImpact: () => resolved++ }];
  scene.sniperBulletTraces = [{ impactHex, node: node(), t: 0, dur: 1, impacted: false, onImpact: () => resolved++ }];
  scene.mission.sherman.pos.q = 20;
  scene.clearRegionalTransientEffects();
  assert.equal(oldTurret.isValid, false);
  assert.equal(cleared.length, 7);
  assert(scene.destroyedTurretVisualIds.has('old'));
  assert([...scene.projectileTraces, ...scene.infantryRocketTraces, ...scene.sniperBulletTraces].every(v => !v.node.active));
  scene.advanceProjectileTraces(.2); scene.advanceInfantryRocketTraces(.2); scene.advanceSniperBulletTraces(.8);
  assert.equal(resolved, 3);
  assert.equal(sounds, 0);
});

test('remote fire cues skip cosmetic animation while successful impacts resolve once and misses do not hit', () => {
  const scene = fixture(), attacker = tank('attacker'), target = tank('target');
  let resolved = 0;
  scene.playAttackFireCue(attacker, target, false, '', { hit: true, penetrated: true }, () => resolved++);
  scene.playAttackFireCue(attacker, target, false, '', { hit: false }, () => assert.fail('miss impact'));
  scene.playMachineGunFireCue(attacker, target, true);
  scene.playHighExplosiveSuppressionCue(attacker, target, { hit: true }, () => resolved++);
  scene.playHighExplosiveSuppressionCue(attacker, target, { hit: false }, () => assert.fail('HE miss impact'));
  assert.equal(resolved, 2);
  assert.equal(sounds, 0);
});

test('a remembered pushed wreck outside the player region cannot bypass the regional effect visibility rule', () => {
  const scene = fixture(), unit = tank('wreck'); unit.wreckPose = { x: 0, y: 0 };
  scene.usesPushedWreckVision = () => assert.fail('remote wreck must be rejected before reveal continuity');
  assert.equal(scene.isUnitVisible(unit), false);
});

test('an HE shell already in flight cannot create an old-region explosion after crossing, while damage resolves once', () => {
  const scene = fixture(), attacker = tank('attacker', 0), target = tank('target', 0);
  let impact, resolved = 0, blasts = 0;
  scene.hashStringToSeed = () => 1;
  scene.startMainGunRecoil = scene.spawnMuzzleSmoke = scene.spawnMuzzleFlash = () => {};
  scene.spawnProjectileTrace = (_attacker, _target, _report, options) => {
    scene.projectileTraces.push({}); impact = options.onPenetrationImpact;
  };
  scene.spawnHighExplosiveBlast = () => blasts++;
  scene.playHighExplosiveSuppressionCue(attacker, target, { hit: true }, () => resolved++);
  scene.mission.sherman.pos.q = 20;
  impact(0, 0); impact(0, 0);
  assert.equal(blasts, 0);
  assert.equal(resolved, 1);
});
