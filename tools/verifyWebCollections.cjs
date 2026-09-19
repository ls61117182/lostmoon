// Check Set/Map conversions in the actual Cocos release artifact.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const output = process.argv[2] || 'build/web-desktop';
const code = fs.readFileSync(path.join(output, 'assets/main/index.js'), 'utf8');
const trackMethod = code.slice(code.indexOf('.redrawTankTracks=function'));
for (const property of ['lineWidth', 'fadeSteps']) {
  const expression = trackMethod.match(new RegExp('Array\\.from\\(new Set\\(this\\.tankTracks\\.map\\(\\(function\\(e\\)\\{return e\\.' + property + '\\}\\)\\)\\)\\)'))?.[0];
  assert.ok(expression, `Missing safe track grouping for ${property}`);
  const values = vm.runInNewContext(expression, { tankTracks: [
    { lineWidth: 2, fadeSteps: 0 }, { lineWidth: 3, fadeSteps: 1 }, { lineWidth: 2, fadeSteps: 0 },
  ] });
  assert.deepEqual(Array.from(values), property === 'lineWidth' ? [2, 3] : [0, 1]);
}
const waterExpression = code.match(/new Set\(Array\.from\(j\)\.concat\(Y\.filter\(\(function\(r\)\{var n;return m\(r\)!==m\(null!=\(n=b\)\?n:\{col:-1,row:-1\}\)\}\)\)\.map\(m\)\)\)/)?.[0];
assert.ok(waterExpression, 'Missing safe water occupancy conversion');
const occupied = vm.runInNewContext(waterExpression, {
  j: new Set(['1,1', '2,1']), Y: [{ col: 2, row: 1 }, { col: 3, row: 1 }],
  b: { col: 2, row: 1 }, m: p => `${p.col},${p.row}`,
});
assert.deepEqual(Array.from(occupied).sort(), ['1,1', '2,1', '3,1']);
let harness = fs.readFileSync(path.join(__dirname, 'verifyWebCampaign.cjs'), 'utf8');
harness = harness.slice(0, harness.indexOf('const { CAMPAIGNS }'));
const generator = new Function('require', '__dirname', 'process', harness + 'return load("./RandomMissionGenerator.ts");')(
  require, __dirname, { argv: ['node', 'test', output] },
);
let targeted = 0;
for (let seed = 1; seed <= 100; seed++) {
  const mission = generator.generateRandomMissionPackage('pacific', seed).mission;
  if (mission.objective.type === 'destroy_kind_evac' && mission.objective.kind) {
    targeted++;
    assert.ok(mission.enemies.some(enemy => enemy.kind === mission.objective.kind));
  }
}
assert.ok(targeted > 0, 'Target evacuation missions must not all be discarded');
for (let seed = 1; seed <= 100; seed++) {
  const mission = generator.generateRandomMissionPackage('europe', seed).mission;
  assert.ok(mission.tiles.length > 0);
}
console.log(`Release collections passed: numeric track groups, water occupancy, 200 random missions (${targeted} Pacific target missions).`);
