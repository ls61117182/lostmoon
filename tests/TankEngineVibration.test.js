const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'assets/scripts/view/TankEngineVibration.ts');
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
  TANK_ENGINE_VIBRATION_DEFAULT_ENABLED,
  TANK_ENGINE_VIBRATION_FREQUENCY_HZ,
  tankEngineVibrationPhaseOffset,
  tankEngineVibrationSample,
  unitKindHasEngineVibration,
} = loaded.exports;

assert.strictEqual(TANK_ENGINE_VIBRATION_DEFAULT_ENABLED, false, 'engine vibration should ship disabled');
assert.strictEqual(TANK_ENGINE_VIBRATION_FREQUENCY_HZ, 4.75, 'preview frequency should be halved');
for (const kind of [
  'sherman', 'sherman76', 't34', 'tiger', 'tigerking', 'maus', 'panther',
  'panzer4', 'stug3', 'panzer3', 'type95', 'type97', 'type4', 'truck',
]) {
  assert.strictEqual(unitKindHasEngineVibration(kind), true, `${kind} should vibrate while alive`);
}
for (const kind of ['at_gun', 'heavy_artillery', 'german_heavy_artillery', 'infantry', 'officer']) {
  assert.strictEqual(unitKindHasEngineVibration(kind), false, `${kind} must remain still`);
}
assert.strictEqual(tankEngineVibrationPhaseOffset('tank-a'), tankEngineVibrationPhaseOffset('tank-a'));
assert.notStrictEqual(tankEngineVibrationPhaseOffset('tank-a'), tankEngineVibrationPhaseOffset('tank-b'));

assert.deepStrictEqual(
  tankEngineVibrationSample(0.1, 0, false),
  { x: 0, y: 0, angleDeg: 0 },
  'disabled or destroyed previews must remain completely still',
);

const facingRight = tankEngineVibrationSample(0.137, 0, true);
const facingUp = tankEngineVibrationSample(0.137, 90, true);
assert(
  Math.hypot(facingRight.x, facingRight.y) > 0.05,
  'an active engine should visibly move the preview',
);
assert(
  Math.abs(facingRight.x - facingUp.y) < 1e-9
    && Math.abs(facingRight.y + facingUp.x) < 1e-9,
  'the vibration vector should rotate with the tank body',
);

const menuSource = fs.readFileSync(path.join(root, 'assets/scripts/view/MainMenuScene.ts'), 'utf8');
assert(menuSource.includes("new Node('TankEngineVibrationPreview')"));
assert(menuSource.includes('let engineVibrationEnabled = TANK_ENGINE_VIBRATION_DEFAULT_ENABLED'));
assert(menuSource.includes('engineVibrationEnabled && !showDestroyed'));
assert(menuSource.includes("? '击毁时停机'"));

const battleSource = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');
assert(battleSource.includes('this.advanceEngineVibration(dt);'));
assert(battleSource.includes('if (!TANK_ENGINE_VIBRATION_DEFAULT_ENABLED'));
assert(battleSource.includes('|| u.destroyed'));
assert(battleSource.includes('|| !unitKindHasEngineVibration(u.kind)'));
assert(battleSource.includes('this.registerEngineVibrationVisual(node, u'));

console.log('Tank engine vibration preview tests passed');
