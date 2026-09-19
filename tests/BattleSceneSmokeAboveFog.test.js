const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert.match(
  source,
  /new Node\('SmokeScreenEffects'\)[\s\S]*?smokeScreenEffectGraphics[\s\S]*?gNode\.addChild\(smokeScreenEffectNode\)/,
  'smoke screens should use a layer separate from fog-hidden unit effects',
);
assert.doesNotMatch(
  source,
  /private drawSmokeScreenEffects[\s\S]*?visibleHexKeys\.size > 0[\s\S]*?visibleHexKeys\.has\(key\)/,
  'smoke-screen effects should not disappear just because their hex is obscured',
);

console.log('BattleScene smoke layer ordering tests passed');

// Exercise real sibling moves: pooled UI starts below fog and must remain
// above smoke after both a fog redraw and repeated animation frames.
const ts = require('typescript');
const vm = require('vm');
const start = source.indexOf('  private placeSmokeScreenEffectLayerBelowFog()');
const end = source.indexOf('\n  private drawFireEffect(', start);
const place = vm.runInNewContext(ts.transpile(
  source.slice(start, end).replace('private placeSmokeScreenEffectLayerBelowFog', 'function place'),
  { target: ts.ScriptTarget.ES2020 },
) + '\nplace;');
const map = { children: [] };
function node(name) {
  const n = {
    name, parent: map,
    getSiblingIndex() { return map.children.indexOf(this); },
    setSiblingIndex(index) {
      map.children.splice(this.getSiblingIndex(), 1);
      map.children.splice(Math.min(index, map.children.length), 0, this);
    },
  };
  map.children.push(n);
  return n;
}
const terrain = node('terrain');
const status = node('status');
const badge = node('badge');
const name = node('name');
const preview = node('hit chance');
const smoke = node('smoke');
const fog = node('fog');
const icon = node('smoke target');
const actor = {
  mapNode: map, smokeScreenEffectNode: smoke, fogNode: fog,
  statusLabels: [status], statusBadgeNodes: [badge], nameLabels: [name],
  previewLabels: [preview], smokeTargetIconNode: icon,
};
for (let frame = 0; frame < 6; frame++) {
  if (frame === 1) smoke.setSiblingIndex(map.children.length - 1);
  if (frame === 3) fog.setSiblingIndex(map.children.length - 1);
  place.call(actor);
  assert.ok(terrain.getSiblingIndex() < fog.getSiblingIndex());
  assert.equal(smoke.getSiblingIndex() + 1, fog.getSiblingIndex());
  for (const ui of [status, badge, name, preview, icon]) {
    assert.ok(ui.getSiblingIndex() > fog.getSiblingIndex(), `${ui.name} must render above fog and smoke`);
  }
}
