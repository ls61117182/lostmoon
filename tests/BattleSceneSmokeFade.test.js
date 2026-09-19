const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const ast = ts.createSourceFile('BattleScene.ts', source, ts.ScriptTarget.Latest, true);
const methods = new Map();
function visit(node) {
  if (ts.isMethodDeclaration(node) && node.name) methods.set(node.name.getText(ast), node);
  ts.forEachChild(node, visit);
}
visit(ast);
function method(name) {
  const node = methods.get(name);
  const params = node.parameters.map(p => p.getText(ast)).join(', ');
  return vm.runInNewContext(ts.transpile(`function ${name}(${params}) ${node.body.getText(ast)}`,
    { target: ts.ScriptTarget.ES2020 })
    + `\n${name};`, {
      HexMap: { keyOf: p => `${p.q},${p.r}` },
      Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } },
    });
}

const actor = {
  mission: { smokeHexes: new Set(['0,0']), smokeHexOwners: new Map([['0,0', 'friendly']]) },
  smokeScreenAges: new Map([['0,0', 2]]),
  smokeScreenFadeElapsed: new Map(),
  unitEffectVisuals: new Map(),
  consumeLegacyUnitSmoke() {}, allUnits: () => [],
  smokeHexPos: () => ({ q: 0, r: 0 }), project: () => ({ x: 0, y: 0 }),
  hashStringToSeed: () => 1,
};
const sync = method('syncUnitEffects');
const draw = method('drawSmokeScreenEffects');
const clear = method('clearSmokeAt');
let cutoffs;
actor.drawSmokeScreenEffect = (_g, _x, _y, v) => cutoffs.push(v.smokeEmissionEndAge);
function emissionCutoffs() { cutoffs = []; draw.call(actor, {}); return cutoffs; }

assert.equal(clear.call(actor, { q: 0, r: 0 }), true);
assert.equal(actor.mission.smokeHexes.size, 0, 'gameplay smoke clears immediately');
assert.deepEqual(emissionCutoffs(), [2], 'removal stops emission at the current smoke age');
sync.call(actor, 1.5);
assert.deepEqual(emissionCutoffs(), [2], 'emission cutoff stays fixed while particles age');
sync.call(actor, 1.5);
assert.deepEqual(emissionCutoffs(), [], 'smoke disappears after three seconds');
assert.equal(actor.smokeScreenFadeElapsed.size, 0, 'expired fade state is released');

actor.mission.smokeHexes.add('0,0');
sync.call(actor, 0.6);
actor.mission.smokeHexes = new Set();
sync.call(actor, 1);
assert.ok(Math.abs(emissionCutoffs()[0] - 0.6) < 1e-9, 'snapshot removal also stops emission');
actor.mission.smokeHexes.add('0,0');
sync.call(actor, 0.1);
assert.deepEqual(emissionCutoffs(), [undefined], 'redeployed smoke resumes emission');
actor.mission = null;
sync.call(actor, 0);
assert.equal(actor.smokeScreenAges.size, 0);
assert.equal(actor.smokeScreenFadeElapsed.size, 0);
const render = method('drawSmokeScreenEffect');
function particles(age, endAge) {
  const ellipses = [];
  const g = {
    ellipse(x, y, rx, ry) { ellipses.push({ x, y, rx, ry, alpha: this.fillColor.a / 255 }); },
    fill() {},
  };
  render.call({ hexSize: 100 }, g, 0, 0, {
    seed: 127, smokeAlpha: 1, smokeAge: age, smokeEmissionEndAge: endAge,
  });
  return ellipses;
}
const beforeClear = particles(4);
assert.deepEqual(particles(4, 4), beforeClear, 'clearing must not change existing particles');
assert.ok(particles(4.5).length > particles(0.5).length, 'smoke builds up from ongoing emission');
assert.ok(particles(5, 4).length < beforeClear.length, 'particles expire without being replaced');
assert.ok(particles(6, 4).length < particles(5, 4).length);
assert.equal(particles(7, 4).length, 0, 'all remaining smoke expires within three seconds');
assert.notDeepEqual(particles(8), beforeClear, 'active smoke keeps producing new shapes');
console.log('BattleScene smoke emission and fade tests passed');
