const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'assets/scripts/view/InfantryVisualFacing.ts');
assert(fs.existsSync(sourcePath), 'InfantryVisualFacing.ts should define infantry facing geometry');

const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const loaded = { exports: {} };
const HEX_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];
const directionTo = (from, to) => {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  if (dq === 0 && dr === 0) return null;
  for (let direction = 0; direction < HEX_DIRECTIONS.length; direction++) {
    const axis = HEX_DIRECTIONS[direction];
    if (axis.q === 0 && dq === 0 && Math.sign(dr) === Math.sign(axis.r)) return direction;
    if (axis.r === 0 && dr === 0 && Math.sign(dq) === Math.sign(axis.q)) return direction;
    if (axis.q !== 0 && axis.r !== 0
      && dq * axis.r === dr * axis.q && Math.sign(dq) === Math.sign(axis.q)) return direction;
  }
  return null;
};
const approximateDirection = (from, to) => {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  const ds = -dq - dr;
  const cube = [[1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1], [1, -1, 0]];
  let best = 0;
  let bestScore = -Infinity;
  cube.forEach(([cq, cr, cs], direction) => {
    const score = dq * cq + dr * cr + ds * cs;
    if (score > bestScore) {
      best = direction;
      bestScore = score;
    }
  });
  return best;
};
const hexGrid = {
  HEX_DIRECTIONS,
  directionTo,
  approximateDirection,
  axialToPixel: (a, size) => ({
    x: size * Math.sqrt(3) * (a.q + a.r / 2),
    y: size * 1.5 * a.r,
  }),
};
const requireModule = request => {
  if (request === '../core/HexGrid') return hexGrid;
  throw new Error(`Unexpected dependency: ${request}`);
};
new Function('exports', 'module', 'require', compiled)(loaded.exports, loaded, requireModule);

const { infantryVisualDirection, infantrySpriteAngle, infantrySquadOffsets } = loaded.exports;
assert.strictEqual(typeof infantryVisualDirection, 'function');
assert.strictEqual(typeof infantrySpriteAngle, 'function');
assert.strictEqual(typeof infantrySquadOffsets, 'function');

assert.strictEqual(infantryVisualDirection({ q: 2, r: 3 }, { q: 2, r: 3 }), null);

const neighbors = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];
neighbors.forEach((target, direction) => {
  assert.strictEqual(
    infantryVisualDirection({ q: 0, r: 0 }, target),
    direction,
    `neighbor ${direction} should preserve the hex direction index`,
  );
});

assert.strictEqual(
  infantryVisualDirection({ q: 0, r: 0 }, { q: 2, r: 1 }),
  0,
  'off-axis attacks should use the closest six-direction facing',
);

assert.deepStrictEqual(
  neighbors.map((_, direction) => infantrySpriteAngle(direction)),
  [90, 30, -30, -90, -150, 150],
  'downward-facing source art should rotate toward the six projected screen directions',
);

const roundOffset = p => ({ ox: Math.round(p.ox * 1_000_000) / 1_000_000, oy: Math.round(p.oy * 1_000_000) / 1_000_000 });
assert.deepStrictEqual(
  infantrySquadOffsets(100, false).map(roundOffset),
  [
    { ox: 0, oy: 27.3 },
    { ox: 23.642494, oy: -13.65 },
    { ox: -23.642494, oy: -13.65 },
  ],
  'normal infantry squads should place three blood/decal anchors on the same compact triangle used by the sprites',
);
assert.deepStrictEqual(
  infantrySquadOffsets(100, true).map(roundOffset),
  [
    { ox: 0, oy: 58 },
    { ox: 50.229473, oy: -29 },
    { ox: -50.229473, oy: -29 },
  ],
  'squads sharing a vehicle hex should use the wider three-soldier anchor triangle',
);

console.log('Infantry visual facing tests passed');
