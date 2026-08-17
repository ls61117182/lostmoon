const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/core/TurretTraverse.ts'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function('exports', 'module', 'require', compiled)(
  moduleUnderTest.exports,
  moduleUnderTest,
  require,
);

const {
  fireDirectionFromStep,
  fireDirectionStep,
  limitTurretTraverse,
  turretFacingAfterHullTurn,
  turretTraverseAnimationDuration,
  turretTurnDistance,
} = moduleUnderTest.exports;

for (let direction = 0; direction < 12; direction++) {
  assert.strictEqual(fireDirectionFromStep(fireDirectionStep(direction)), direction);
}

assert.strictEqual(turretTurnDistance(0, 2), 4, '120 degrees is four 30-degree steps');
assert.deepStrictEqual(limitTurretTraverse(0, 2, 3), {
  direction: 7,
  distance: 4,
  reached: false,
}, 'speed 3 rotates 90 degrees toward a target 120 degrees clockwise');
assert.deepStrictEqual(limitTurretTraverse(7, 2, 3), {
  direction: 2,
  distance: 1,
  reached: true,
}, 'the next action reaches the remaining 30-degree direction');
assert.deepStrictEqual(limitTurretTraverse(0, 3, 0), {
  direction: 0,
  distance: 6,
  reached: false,
}, 'speed zero cannot rotate');
assert.strictEqual(limitTurretTraverse(0, 3, 6).reached, true, 'speed six reaches 180 degrees');
assert.strictEqual(
  turretTraverseAnimationDuration(0, 7, 3),
  1,
  'speed 3 takes 1 second to traverse three 30-degree steps (90 degrees)',
);
assert.ok(
  Math.abs(turretTraverseAnimationDuration(0, 6, 3) - 1 / 3) < 1e-9,
  'speed 3 takes one third of a second to traverse one 30-degree step',
);
assert.strictEqual(
  turretTraverseAnimationDuration(0, 3, 6),
  1,
  'speed 6 takes 1 second to traverse 180 degrees',
);
assert.strictEqual(
  turretTraverseAnimationDuration(0, 3, 0),
  0,
  'speed zero has no legal traverse animation duration',
);

assert.strictEqual(
  turretFacingAfterHullTurn(6, 0, 1),
  7,
  'a 60-degree clockwise hull turn carries a halfway-facing turret by 60 degrees',
);
assert.strictEqual(
  turretFacingAfterHullTurn(6, 0, 5),
  11,
  'a counter-clockwise hull turn preserves the same turret-to-hull angle',
);

console.log('Turret traverse tests passed');
