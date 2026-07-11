const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'assets/scripts/view/MainGunRecoil.ts');
assert(fs.existsSync(sourcePath), 'MainGunRecoil.ts should define presentation-only recoil math');

const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const loaded = { exports: {} };
new Function('exports', 'module', 'require', compiled)(loaded.exports, loaded, require);

const {
  MAIN_GUN_RECOIL_BACK_TIME,
  MAIN_GUN_RECOIL_RETURN_TIME,
  MAIN_GUN_RECOIL_DISTANCE_RATIO,
  mainGunRecoilMode,
  mainGunRecoilProgress,
  mainGunRecoilOffset,
} = loaded.exports;

assert.strictEqual(MAIN_GUN_RECOIL_BACK_TIME, 0.07);
assert.strictEqual(MAIN_GUN_RECOIL_RETURN_TIME, 0.16);
assert.strictEqual(MAIN_GUN_RECOIL_DISTANCE_RATIO, 0.06);

assert.strictEqual(mainGunRecoilMode('sherman', false, true, true), 'turret');
assert.strictEqual(mainGunRecoilMode('stug3', false, false, true), 'whole');
assert.strictEqual(mainGunRecoilMode('at_gun', false, false, true), 'whole');
assert.strictEqual(mainGunRecoilMode('type95', false, false, true), 'whole');
assert.strictEqual(mainGunRecoilMode('heavy_artillery', false, false, true), null);
assert.strictEqual(mainGunRecoilMode('infantry', true, false, false), null);
assert.strictEqual(mainGunRecoilMode('truck', false, false, false), null);

assert.strictEqual(mainGunRecoilProgress(0), 0);
assert.strictEqual(mainGunRecoilProgress(MAIN_GUN_RECOIL_BACK_TIME), 1);
const recoveryProgress = mainGunRecoilProgress(MAIN_GUN_RECOIL_BACK_TIME + 0.08);
assert(recoveryProgress > 0 && recoveryProgress < 1, 'recovery should ease between peak and rest');
assert.strictEqual(
  mainGunRecoilProgress(MAIN_GUN_RECOIL_BACK_TIME + MAIN_GUN_RECOIL_RETURN_TIME),
  0,
);

assert.deepStrictEqual(
  mainGunRecoilOffset(MAIN_GUN_RECOIL_BACK_TIME, 100, 0.6, 0.8),
  { x: -3.6, y: -4.8 },
  'peak recoil should move opposite the normalized firing direction by 6% of hex radius',
);
assert.deepStrictEqual(mainGunRecoilOffset(1, 100, 1, 0), { x: 0, y: 0 });

console.log('Main-gun recoil tests passed');
