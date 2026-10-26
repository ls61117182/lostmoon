const assert = require('assert');
const Scene = require('./helpers/BattleSceneMethods.cjs')(['syncUnitEffects', 'drawUnitEffects']);
const sync = Scene.prototype.syncUnitEffects;
const draw = Scene.prototype.drawUnitEffects;
const bunker = { id: 'heavy-bunker', fireLevel: 1, destroyed: false };
let visible = true;
let draws = 0;
const scene = {
  mission: { smokeHexes: new Set() },
  unitEffectVisuals: new Map(), smokeScreenAges: new Map(), smokeScreenFadeElapsed: new Map(),
  consumeLegacyUnitSmoke() {}, allUnits: () => [bunker],
  isUnitVisible: () => visible,
  fireEffectLevel: unit => unit.destroyed ? 0 : unit.fireLevel,
  hashStringToSeed: () => 1,
  approachEffectAlpha(value, target, step) {
    return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
  },
  unitEffectGraphics: { clear() {} },
  interpolatedPos: () => ({ x: 0, y: 0 }),
  drawFireEffect() { draws++; }, drawAmbushMuzzleReticles() {},
  drawLockedFireReticles() {}, drawWreckWaterRipples() {},
};
function frame(dt) { sync.call(scene, dt); draw.call(scene); }
frame(0);
assert.equal(draws, 1, 'visible burning bunker emits smoke immediately');
for (let turn = 0; turn < 20; turn++) {
  visible = false;
  const before = draws;
  frame(0);
  frame(60);
  assert.equal(draws, before, 'hidden bunker emits no visible smoke');
  assert.equal(scene.unitEffectVisuals.size, 0, 'hidden effect is discarded');
  visible = true;
  frame(0);
  assert.equal(draws, before + 1, 'restored vision immediately recreates smoke');
  assert.equal(bunker.fireLevel, 1, 'visibility changes preserve fire state');
}
visible = false;
frame(0);
bunker.fireLevel = 0;
visible = true;
const before = draws;
frame(0);
assert.equal(draws, before, 'extinguished bunker stays smoke-free when revealed');
console.log('Burning bunker vision recovery tests passed');
