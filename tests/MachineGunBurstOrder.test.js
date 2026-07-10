const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'assets/scripts/view/MachineGunBurstOrder.ts');
assert(fs.existsSync(sourcePath), 'MachineGunBurstOrder.ts should define machine-gun endpoint ordering');

const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const loaded = { exports: {} };
new Function('exports', 'module', 'require', compiled)(loaded.exports, loaded, require);

const { orderMachineGunBurstEndpointsByLateralOffset } = loaded.exports;
assert.strictEqual(typeof orderMachineGunBurstEndpointsByLateralOffset, 'function');

const endpoints = [
  { lateralOffset: -4, shotIndex: 0 },
  { lateralOffset: 3, shotIndex: 1 },
  { lateralOffset: 7, shotIndex: 2 },
  { lateralOffset: 0, shotIndex: 3 },
];
const ordered = orderMachineGunBurstEndpointsByLateralOffset(endpoints);
assert.deepStrictEqual(
  ordered.map(point => point.shotIndex),
  [2, 1, 3, 0],
  'the greatest counterclockwise-side lateral offset should fire first',
);
assert.deepStrictEqual(
  new Set(ordered),
  new Set(endpoints),
  'ordering should preserve the exact generated endpoint objects',
);

const sameOffset = [
  { lateralOffset: 2, shotIndex: 4 },
  { lateralOffset: 2, shotIndex: 2 },
];
assert.deepStrictEqual(
  orderMachineGunBurstEndpointsByLateralOffset(sameOffset).map(point => point.shotIndex),
  [2, 4],
  'equal-offset endpoints should retain their original shot order',
);

console.log('Machine-gun burst ordering tests passed');
