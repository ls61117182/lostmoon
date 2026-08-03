const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'assets/scripts/view/MachineGunBurstGeometry.ts');
assert(fs.existsSync(sourcePath), 'MachineGunBurstGeometry.ts should define machine-gun burst geometry');

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
  MACHINE_GUN_MUZZLE_FORWARD_HEXES,
  machineGunBurstStartPoint,
  clampMachineGunTracerTail,
} = loaded.exports;

assert.strictEqual(MACHINE_GUN_MUZZLE_FORWARD_HEXES, 0.52);
assert.deepStrictEqual(
  machineGunBurstStartPoint({ x: 100, y: 80 }, 1, 0, 60),
  { x: 131.2, y: 80 },
  'MG muzzle should sit near the forward turret edge',
);
assert.deepStrictEqual(
  machineGunBurstStartPoint({ x: 100, y: 80 }, 0, -1, 20),
  { x: 100, y: 68 },
  'small map scales should retain the minimum forward offset',
);
assert.strictEqual(clampMachineGunTracerTail(40, 9), 9, 'a new tracer must not extend behind its muzzle');
assert.strictEqual(clampMachineGunTracerTail(40, 55), 40, 'a travelled tracer should retain its authored tail length');

console.log('Machine-gun burst geometry tests passed');
