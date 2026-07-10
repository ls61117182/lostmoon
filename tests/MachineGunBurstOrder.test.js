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

const { orderMachineGunBurstEndpointsClockwise } = loaded.exports;
assert.strictEqual(typeof orderMachineGunBurstEndpointsClockwise, 'function');

const endpoints = [
  { x: 0, y: -1, shotIndex: 0 },
  { x: 1, y: 0, shotIndex: 1 },
  { x: 0, y: 1, shotIndex: 2 },
  { x: -1, y: 0, shotIndex: 3 },
];
const ordered = orderMachineGunBurstEndpointsClockwise(endpoints, 0, 0);
assert.deepStrictEqual(
  ordered.map(point => point.shotIndex),
  [3, 2, 1, 0],
  'the greatest counterclockwise angle should fire first, then descend clockwise',
);
assert.deepStrictEqual(
  new Set(ordered),
  new Set(endpoints),
  'ordering should preserve the exact generated endpoint objects',
);

const sameAngle = [
  { x: 2, y: 2, shotIndex: 4 },
  { x: 1, y: 1, shotIndex: 2 },
];
assert.deepStrictEqual(
  orderMachineGunBurstEndpointsClockwise(sameAngle, 0, 0).map(point => point.shotIndex),
  [2, 4],
  'equal-angle endpoints should retain their original shot order',
);

console.log('Machine-gun burst ordering tests passed');
