const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'assets/scripts/view/TankEngineExhaust.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const loaded = { exports: {} };
new Function('exports', 'module', compiled)(loaded.exports, loaded);

const {
  TANK_EXHAUST_LIFETIME_SCALE,
  TANK_EXHAUST_MAX_PARTICLES,
  TANK_EXHAUST_IDLE_RATE,
  TANK_EXHAUST_MOVING_RATE,
  TANK_EXHAUST_RADIUS_SCALE,
  advanceTankExhaustParticle,
  resetTankExhaustParticle,
  sampleTankExhaustTrailFractions,
  tankExhaustParticleAlpha,
  tankExhaustParticleRadius,
  tankExhaustPortWorldPosition,
} = loaded.exports;

assert.strictEqual(TANK_EXHAUST_RADIUS_SCALE, 2.5, 'exhaust radius should be 2.5 times the original');
assert.strictEqual(TANK_EXHAUST_LIFETIME_SCALE, 1.5, 'exhaust lifetime should be 150% of the original');
assert.strictEqual(TANK_EXHAUST_IDLE_RATE, 2.75, 'idle emission frequency should remain at 100% of the original');
assert.strictEqual(TANK_EXHAUST_MOVING_RATE, 15, 'distance sampling should replace the former 45-cycle particle flood');
assert.strictEqual(TANK_EXHAUST_MAX_PARTICLES, 384, 'the fixed pool should cover simultaneous twin-port smoke');

assert.deepStrictEqual(
  tankExhaustPortWorldPosition(100, 50, 1, 0, { forward: -0.4, right: 0.1 }, 100),
  { x: 60, y: 40 },
  'forward/right local coordinates should map behind and to the screen-right side of a right-facing hull',
);
assert.deepStrictEqual(
  tankExhaustPortWorldPosition(100, 50, 0, 1, { forward: -0.4, right: 0.1 }, 100),
  { x: 110, y: 10 },
  'the same exhaust coordinate should rotate with the hull',
);

const particle = {
  active: false,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  age: 0,
  lifetime: 1,
  startRadius: 1,
  endRadius: 2,
  shade: 72,
  moving: false,
};
resetTankExhaustParticle(particle, { x: 20, y: 30 }, 1, 0, 60, true, 17);
assert.strictEqual(particle.active, true);
assert.strictEqual(particle.moving, true);
assert(particle.vx < 0, 'exhaust should drift behind a right-facing tank');
const initialX = particle.x;
const initialRadius = tankExhaustParticleRadius(particle);
advanceTankExhaustParticle(particle, particle.lifetime * 0.5);
assert(particle.x < initialX, 'spawned smoke must remain in world space and drift away from the port');
assert(tankExhaustParticleRadius(particle) > initialRadius, 'smoke should expand over its lifetime');
assert(tankExhaustParticleAlpha(particle) > 0, 'mid-life smoke should remain visible');
advanceTankExhaustParticle(particle, particle.lifetime);
assert.strictEqual(particle.active, false, 'expired particles must return to the fixed pool');

const fractions = [];
let carried = sampleTankExhaustTrailFractions(6, 10, 0, fractions);
assert.deepStrictEqual(fractions, [], 'a short first frame should carry distance without emitting early');
assert.strictEqual(carried, 6);
carried = sampleTankExhaustTrailFractions(6, 10, carried, fractions);
assert.deepStrictEqual(fractions, [4 / 6], 'the next frame should interpolate the missing spatial sample');
assert.strictEqual(carried, 2);
carried = sampleTankExhaustTrailFractions(28, 10, carried, fractions);
assert.deepStrictEqual(fractions, [8 / 28, 18 / 28, 1], 'large frame movement should be filled at even distances');
assert.strictEqual(carried, 0);

const dbSource = fs.readFileSync(path.join(root, 'assets/scripts/core/TankVisualDB.ts'), 'utf8');
assert(dbSource.includes('exhaustPorts: readonly { forward: number; right: number }[];'));
assert(dbSource.includes('sherman: { fitScale: 0.76'));
assert(dbSource.includes('exhaustPorts: [{ forward: -0.36, right: 0.07 }, { forward: -0.36, right: -0.07 }]'));
assert(dbSource.includes('at_gun: { fitScale: 0.6'));
assert(dbSource.includes('exhaustPorts: [{ forward: 0, right: 0 }, { forward: 0, right: 0 }]'));

const menuSource = fs.readFileSync(path.join(root, 'assets/scripts/view/MainMenuScene.ts'), 'utf8');
for (const key of [
  'exhaustPort1Forward',
  'exhaustPort1Right',
  'exhaustPort2Forward',
  'exhaustPort2Right',
]) {
  assert(menuSource.includes(`| '${key}'`) || menuSource.includes(`key: '${key}'`), `${key} should be editable`);
}
assert(menuSource.includes("new Node('TankEngineExhaustPreview')"));
assert(menuSource.includes('addExhaustPortDots(previewRoot)'));
assert(menuSource.includes('].filter(port => port.forward !== 0)'));
assert(!menuSource.includes("| 'exhaustPortCount'"), 'the redundant port-count control should be removed');

const battleSource = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');
assert(battleSource.includes("new Node('TankEngineExhaust')"));
assert(battleSource.includes('this.advanceTankEngineExhaust(dt);'));
assert(battleSource.includes("this.anim?.unit === unit && this.anim.kind === 'move'"));
assert(battleSource.includes('|| isAbandonedTank(unit)'));
assert(battleSource.includes('sampleTankExhaustTrailFractions('));
assert(battleSource.includes('const particleIndex = this.tankExhaustFreeIndices.pop();'));
assert(!battleSource.includes('this.tankExhaustParticles.find(candidate => !candidate.active)'), 'spawning must not scan the whole pool');
assert(battleSource.includes('this.tankExhaustDrawBuckets[bucketIndex]!.push(particleIndex)'));
assert(battleSource.includes('g.fillColor = this.tankExhaustBodyColors[bucketIndex]!'));
assert(
  !battleSource.includes('g.fillColor = new Color(shade, shade, Math.max(0, shade - 7), alpha);'),
  'exhaust draw loop should reuse prebuilt colors',
);

console.log('Tank engine exhaust tests passed');
