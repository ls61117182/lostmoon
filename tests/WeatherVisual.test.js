const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'assets/scripts/view/WeatherVisual.ts');
assert(fs.existsSync(sourcePath), 'WeatherVisual.ts should define the rain lifecycle sampler');

const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const loaded = { exports: {} };
new Function('exports', 'module', compiled)(loaded.exports, loaded);

const { RAIN_VISUAL_SLOT_COUNT, sampleRainVisual } = loaded.exports;
assert.strictEqual(RAIN_VISUAL_SLOT_COUNT, 96, 'Rain should use a stronger fixed 96-slot budget');
assert.strictEqual(typeof sampleRainVisual, 'function', 'sampleRainVisual() should be exported');

const blankSample = () => ({
  phase: 'idle',
  impactX: 0,
  impactY: 0,
  headX: 0,
  headY: 0,
  streakLength: 0,
  slant: 0,
  alpha: 0,
  fallDistance: 0,
  fallSpeed: 0,
  splashRadius: 0,
  splashRayLength: 0,
  splashRayCount: 0,
  splashRotation: 0,
});

const sample = (slot, time) => {
  const out = blankSample();
  sampleRainVisual(slot, time, 1280, 720, out);
  return out;
};

assert.deepStrictEqual(sample(3, 1.25), sample(3, 1.25), 'Sampling should be deterministic');

const impactKeys = new Set();
for (let slot = 0; slot < RAIN_VISUAL_SLOT_COUNT; slot++) {
  const current = sample(slot, 0.75);
  impactKeys.add(`${current.impactX.toFixed(2)},${current.impactY.toFixed(2)}`);
}
assert(impactKeys.size > 48, 'Rain slots should not form repeated rows or shared impact points');

let totalFallCount = 0;
let totalActiveCount = 0;
const sampleTimes = [0, 0.15, 0.30, 0.45, 0.60, 0.75, 0.90, 1.05];
for (const time of sampleTimes) {
  let fallCount = 0;
  let activeCount = 0;
  for (let slot = 0; slot < RAIN_VISUAL_SLOT_COUNT; slot++) {
    const current = sample(slot, time);
    if (current.phase === 'fall') fallCount++;
    if (current.phase === 'fall' || current.phase === 'splash') activeCount++;
  }
  totalFallCount += fallCount;
  totalActiveCount += activeCount;
}
assert(totalFallCount / sampleTimes.length >= 18, 'Rain should have enough simultaneous falling streaks to be visible');
assert(totalActiveCount / sampleTimes.length >= 45, 'Rain should keep many visible drops or splashes active');

let fall = null;
let earlySplash = null;
let lateSplash = null;
let splashKey = '';
const phaseRuns = [];
let previousPhase = '';
for (let t = 0; t <= 4; t += 0.002) {
  const current = sample(7, t);
  if (current.phase !== previousPhase) {
    phaseRuns.push(current.phase);
    previousPhase = current.phase;
  }
  if (!fall && current.phase === 'fall') fall = current;
  if (current.phase === 'splash') {
    const key = `${current.impactX},${current.impactY}`;
    if (!earlySplash) {
      earlySplash = current;
      splashKey = key;
    } else if (!lateSplash && key === splashKey && current.splashRadius > earlySplash.splashRadius + 1) {
      lateSplash = current;
    }
  }
}

assert(fall, 'A slot should enter a falling phase');
assert(fall.fallDistance >= 75 && fall.fallDistance <= 120, 'Fall distance should stay finite but readable');
assert(fall.fallSpeed >= 850 && fall.fallSpeed <= 1250, 'Rain should fall quickly');
assert(fall.slant >= 0.02 && fall.slant <= 0.06, 'Rain should remain close to vertical');
assert(fall.streakLength >= 20 && fall.streakLength <= 32, 'Falling streaks should be long enough to read');
assert(fall.alpha >= 185 && fall.alpha <= 235, 'Falling streaks should be bright enough to see over the map');
assert(Math.abs(fall.headY - fall.impactY) <= fall.fallDistance + 0.001, 'A streak should not cross the full viewport');
assert(
  phaseRuns.join(',').includes('fall,splash,idle'),
  'Each falling phase should transition through splash and then disappear',
);
assert(earlySplash && lateSplash, 'A splash should remain visible long enough to animate');
assert(lateSplash.splashRadius > earlySplash.splashRadius, 'Splash radius should expand');
assert(lateSplash.alpha < earlySplash.alpha, 'Splash opacity should fade');

console.log('Weather visual lifecycle test passed');
