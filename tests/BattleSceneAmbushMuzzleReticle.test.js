const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const source = ts.createSourceFile('BattleScene.ts', fs.readFileSync(
  require('node:path').join(__dirname, '../assets/scripts/view/BattleScene.ts'), 'utf8'),
  ts.ScriptTarget.Latest, true);
const sceneClass = source.statements.find(s => ts.isClassDeclaration(s) && s.name.text === 'BattleScene');
const methods = ['collectTankStatusBadgeKinds', 'drawAmbushMuzzleReticles', 'ambushMuzzlePosition',
  'topDownForwardVec', 'splitTankTurretPivot', 'splitTankMuzzlePosition', 'topSpriteMuzzlePosition'];
const geometry = {
  topTrim: { x: 0, y: 0, w: 100, h: 100 },
  turretTrim: { x: 0, y: 0, w: 100, h: 100 },
  pivot: { bodyX: 50, bodyY: 50, spriteX: 50, spriteY: 50 },
  muzzle: { spriteX: 0, spriteY: 50 },
};
const config = {
  hullFitScale: 1, turretScale: 1, hullOffsetForward: 0, hullOffsetRight: 0,
  turretOffsetForward: 0, turretOffsetRight: 0, muzzle: { spriteX: 0, spriteY: 0 },
};
const context = {
  GameSession: { gameMode: 'hardcore' },
  isTankUnit: u => u.kind === 'sherman' || u.kind === 'tank',
  isFootUnit: u => u.kind === 'infantry',
  splitTankVisualConfigOf: () => config,
  splitTankGeometryConfigOf: () => geometry,
  tankVisualConfigOf: () => config,
  Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } },
};
vm.createContext(context);
vm.runInContext(ts.transpileModule(`class Scene { ${methods.map(name =>
  sceneClass.members.find(m => m.name?.getText(source) === name).getText(source)).join('\n')} }
  globalThis.Scene = Scene;`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);

function unit(id, extra = {}) {
  return { id, kind: 'tank', pos: { q: 0, r: 0 }, facing: 0,
    stats: { visionType: 'turreted' }, ambushReadyThisTurn: true, ...extra };
}
function host(units) {
  return Object.assign(new context.Scene(), {
    mission: { sherman: units[0] }, hexSize: 50, unitEffectTime: 0, enemyTopMeta: {},
    allUnits: () => units, isUnitVisible: u => u.visible !== false,
    interpolatedPos: () => ({ x: 100, y: 200 }),
    currentShermanTurretLerp: () => ({ from: 0, to: 1, t: 0.5, angular: true }),
    currentEnemyTurretLerp: () => ({ from: 2, to: 2, t: 1, angular: true }),
    directionScreenAngle: (_pos, _center, dir) => dir * Math.PI / 2,
    enemySupportsSplitTurret: u => u.split === true,
  });
}
function graphics() {
  return { circles: [], colors: [], circle(x, y, radius) { this.circles.push({ x, y, radius }); },
    moveTo() {}, lineTo() {}, stroke() { this.colors.push(this.strokeColor); }, fill() {} };
}

test('reticle follows the rendered player turret during rotation and visible enemy turrets', () => {
  const player = unit('player', { split: true });
  const enemy = unit('enemy', { split: true });
  const scene = host([player, enemy]);
  const p = scene.ambushMuzzlePosition(player);
  assert.ok(Math.abs(p.x - (100 + 45 / Math.sqrt(2))) < 1e-6);
  assert.ok(Math.abs(p.y - (200 + 45 / Math.sqrt(2))) < 1e-6);
  const e = scene.ambushMuzzlePosition(enemy);
  assert.ok(Math.abs(e.x - 55) < 1e-6);
  assert.ok(Math.abs(e.y - 200) < 1e-6);
});

test('fixed-gun and sprite fallback reticles use the hull barrel direction', () => {
  const fixed = unit('fixed', { split: true, facing: 1, stats: { visionType: 'fixed' } });
  const fallback = unit('fallback', { facing: 2, stats: { visionType: 'fixed' } });
  const scene = host([fixed, fallback]);
  assert.ok(Math.abs(scene.ambushMuzzlePosition(fixed).y - 245) < 1e-6);
  assert.ok(Math.abs(scene.ambushMuzzlePosition(fallback).x - 64) < 1e-6);
});

test('only active visible ambushers draw; expiry, destruction, damage and fog remove the reticle', () => {
  const player = unit('player');
  const enemy = unit('enemy');
  const scene = host([player, enemy, unit('hidden', { visible: false }),
    unit('expired', { ambushReadyThisTurn: false }), unit('dead', { destroyed: true }),
    unit('damaged', { turretDamaged: true }), unit('infantry', { kind: 'infantry' })]);
  const drawn = [];
  scene.ambushMuzzlePosition = u => { drawn.push(u.id); return { x: 0, y: 0, ux: 1, uy: 0 }; };
  scene.drawAmbushMuzzleReticles(graphics());
  assert.deepEqual(drawn, ['player', 'enemy']);
  player.ambushReadyThisTurn = false;
  enemy.visible = false;
  drawn.length = 0;
  scene.drawAmbushMuzzleReticles(graphics());
  assert.deepEqual(drawn, []);
  assert.deepEqual(Array.from(scene.collectTankStatusBadgeKinds(unit('ready', { paralyzed: true }))), ['paralyzed']);
});

test('reticle smoothly contracts and brightens, and remains absent in classic mode', () => {
  const scene = host([unit('ready')]);
  const bright = graphics();
  scene.drawAmbushMuzzleReticles(bright);
  scene.unitEffectTime = 0.6;
  const dim = graphics();
  scene.drawAmbushMuzzleReticles(dim);
  assert.ok(bright.circles[1].radius < dim.circles[1].radius);
  assert.ok(bright.colors[2].a > dim.colors[2].a);
  context.GameSession.gameMode = 'classic';
  const classic = graphics();
  scene.drawAmbushMuzzleReticles(classic);
  assert.equal(classic.circles.length, 0);
  context.GameSession.gameMode = 'hardcore';
});
