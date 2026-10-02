const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/view/BattleScene.ts'), 'utf8');
const ast = ts.createSourceFile('BattleScene.ts', source, ts.ScriptTarget.Latest, true);
const sceneClass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'BattleScene');
const method = name => sceneClass.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(ast) === name);
const names = ['splitTankTurretPivot', 'turretVisualScreenAngle', 'splitTankMuzzlePosition',
  'topDownForwardVec', 'targetScreenAngle', 'beginTurretAimAnim', 'startShermanTurretAimDirection',
  'startEnemyTurretAim', 'currentShermanTurretLerp', 'currentEnemyTurretLerp', 'currentTurretFacingFor'];
const tick = method('update').body.statements.find(n => ts.isIfStatement(n)
  && n.expression.getText(ast) === 'this.turretAimAnim').getText(ast);
const compiled = ts.transpile(`class Scene {
  ${names.map(name => method(name).getText(ast)).join('\n')}
  tick(dt) { ${tick} }
}`, { target: ts.ScriptTarget.ES2020 });
const cfg = { hullFitScale: 1, turretScale: 1, hullOffsetForward: 0.1, hullOffsetRight: 0.05,
  turretOffsetForward: 0, turretOffsetRight: 0 };
const geometry = { topTrim: { x: 0, y: 0, w: 100, h: 50 }, turretTrim: { w: 50, h: 30 },
  pivot: { bodyX: 40, bodyY: 20, spriteX: 40, spriteY: 15 }, muzzle: { spriteX: 0, spriteY: 15 } };
let motorStarts = 0;
const deps = {
  isSplitTankKind: kind => kind === 'tank', isTankUnit: u => u.kind === 'tank',
  isAntiTankGunUnit: () => false, isHeavyArtilleryUnit: () => false,
  splitTankVisualConfigOf: () => cfg, splitTankGeometryConfigOf: () => geometry,
  startTurretTraverseSound: () => motorStarts++, stopTurretTraverseSound: () => {},
  axialEquals: (a, b) => a.q === b.q && a.r === b.r,
  turretTraverseAnimationDuration: () => 0,
  diagonalMainGunDirectionForHex: () => 0, fireDirectionTo: () => 0, approximateFireDirection: () => 0,
  limitTurretTraverse: from => ({ direction: from, reached: true }),
  easeInOutCubic: t => t,
};
const Scene = new Function(...Object.keys(deps), `${compiled}; return Scene;`)(...Object.values(deps));
const unit = () => ({ id: 'tank', kind: 'tank', pos: { q: 0, r: 0 }, facing: 0, turretFacing: 0,
  stats: { visionType: 'turreted', turretTraverseSpeed: 2 } });
const host = new Scene();
const player = unit();
Object.assign(host, {
  hexSize: 100, mission: { sherman: player, map: {} }, shermanTurretFacing: 0,
  enemyTurretFacing: new Map(), project: (q, r) => ({ x: q * 100, y: r * 100 }),
  directionScreenAngle: (_pos, _c, dir) => dir * Math.PI / 3,
  enemySupportsSplitTurret: () => true, currentWeather: () => 'clear', redraw: () => {},
});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const target = { q: 2, r: 1 };
const pivot = host.splitTankTurretPivot(player, { x: 0, y: 0 }, cfg, geometry);
assert.ok(Math.hypot(pivot.x, pivot.y) > 1, 'fixture must have a displaced rotation pivot');
const expected = Math.atan2(100 - pivot.y, 200 - pivot.x);
close(host.turretVisualScreenAngle(player, target), expected);
assert.notEqual(expected, host.targetScreenAngle(player.pos, target), 'aim must originate at the pivot');

let shots = 0;
host.startShermanTurretAimDirection(0, () => {
  shots++;
  const visual = host.topDownForwardVec(player, { x: 0, y: 0 }, host.currentShermanTurretLerp(player));
  close(Math.atan2(visual.uy, visual.ux), expected);
}, target, true);
assert.equal(shots, 0, 'firing callback must wait for rotation');
assert.ok(host.turretAimAnim.dur > 0.01, 'same rules heading still requires visible rotation');
assert.equal(motorStarts, 1, 'visual-only rotation must play the turret motor');
host.tick(host.turretAimAnim.dur / 2);
assert.equal(shots, 0, 'firing must not occur halfway through rotation');
host.tick(host.turretAimAnim.dur);
assert.equal(shots, 1);
assert.equal(player.turretFacing, 0, 'visual aiming must preserve rules heading when requested');
assert.deepEqual(player.turretVisualTarget, target, 'attack heading must persist after firing');
host.tick(1);
assert.deepEqual(player.turretVisualTarget, target, 'idle updates must not recenter the turret');
const muzzle = host.splitTankMuzzlePosition(player, { x: 0, y: 0 }, cfg, geometry,
  { ux: Math.cos(expected), uy: Math.sin(expected) });
close(Math.atan2(100 - muzzle.y, 200 - muzzle.x), expected);

// A second target inside the same rules direction must rotate from the retained visual angle.
host.startShermanTurretAimDirection(0, () => shots++, { q: 2, r: -1 }, true);
const start = host.topDownForwardVec(player, { x: 0, y: 0 }, host.currentShermanTurretLerp(player));
close(Math.atan2(start.uy, start.ux), expected);
host.tick(host.turretAimAnim.dur);
assert.equal(shots, 2);
host.startShermanTurretAimDirection(0, () => {}, undefined);
assert.ok(host.turretAimAnim, 'explicit rotation back to the same rules heading must still animate');
host.tick(host.turretAimAnim.dur);
assert.equal(player.turretVisualTarget, undefined, 'explicit direction selection replaces visual target');

const enemy = unit();
enemy.id = 'enemy';
let enemyFired = false;
host.startEnemyTurretAim(enemy, { pos: target }, () => { enemyFired = true; });
assert.equal(enemyFired, false);
host.tick(host.turretAimAnim.dur);
assert.equal(enemyFired, true);
assert.equal(enemy.turretFacing, 0);
assert.deepEqual(enemy.turretVisualTarget, target);
const enemyHeading = host.topDownForwardVec(enemy, { x: 0, y: 0 }, host.currentEnemyTurretLerp(enemy));
close(Math.atan2(enemyHeading.uy, enemyHeading.ux), expected);
console.log('Turret pivot aim, firing order, retained heading and explicit rotation tests passed');
