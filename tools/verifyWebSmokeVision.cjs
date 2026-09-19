// Verify the actual minified release transition, not just the TypeScript source.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const output = process.argv[2] || 'build/web-desktop';
const code = fs.readFileSync(path.join(output, 'assets/main/index.js'), 'utf8');
function method(name, next) {
  const start = code.indexOf('.' + name + '=function');
  assert.ok(start >= 0, `Missing ${name}`);
  const end = code.indexOf('.' + next + '=function', start);
  assert.ok(end > start, `Missing ${next}`);
  const expression = code.slice(start + name.length + 2, end).replace(/,[\w$]+$/, '');
  return vm.runInNewContext('(' + expression + ')', {
    tt: () => true, bt: { gameMode: 'hardcore' },
    r: values => { const iterator = values[Symbol.iterator](); return () => iterator.next(); },
    U: (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r)),
  });
}
const start = method('startFogVisionTransition', 'advanceFogVisionTransition');
const advance = method('advanceFogVisionTransition', 'fogOverlayAlpha');
const actor = {
  mission: { sherman: { pos: { q: 0, r: 0 } } },
  visibleHexKeys: new Set(['0,0']),
  refreshPlayerVisibility() {}, redraw() {}, redrawFogOverlay() {},
  smokeHexPos: key => { const [q, r] = key.split(',').map(Number); return { q, r }; },
};
const before = new Set(['0,0', '1,0', '2,0']);
start.call(actor, before, false, 0.2);
assert.deepEqual([...actor.fogVisionTransition.displayedHexKeys].sort(), [...before].sort());
advance.call(actor, 0.2);
assert.ok(actor.fogVisionTransition.displayedHexKeys.has('0,0'), 'Retained vision must never disappear');
assert.ok(actor.fogVisionTransition.displayedHexKeys.has('1,0'));
assert.ok(!actor.fogVisionTransition.displayedHexKeys.has('2,0'), 'Outer ring should disappear first');
advance.call(actor, 0.2);
assert.equal(actor.fogVisionTransition, null);
assert.deepEqual([...actor.visibleHexKeys], ['0,0']);
actor.visibleHexKeys = before;
start.call(actor, new Set(['0,0']), true, 0.2);
assert.deepEqual([...actor.fogVisionTransition.displayedHexKeys], ['0,0']);
advance.call(actor, 0.2);
assert.ok(actor.fogVisionTransition.displayedHexKeys.has('1,0'), 'Clearing smoke restores inner ring first');
assert.ok(!actor.fogVisionTransition.displayedHexKeys.has('2,0'));
advance.call(actor, 0.2);
assert.equal(actor.fogVisionTransition, null);
console.log('Release smoke vision passed: gradual contraction and expansion, retained visibility preserved.');
