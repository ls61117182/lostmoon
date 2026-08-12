const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert.match(
  source,
  /new Node\('SmokeScreenEffects'\)[\s\S]*?smokeScreenEffectGraphics[\s\S]*?gNode\.addChild\(smokeScreenEffectNode\)/,
  'smoke screens should use a layer separate from fog-hidden unit effects',
);
assert.match(
  source,
  /private placeSmokeScreenEffectLayerAboveFog[\s\S]*?smokeNode\.setSiblingIndex\(fogNode\.getSiblingIndex\(\) \+ 1\)/,
  'the smoke-screen layer should be placed immediately above fog',
);
assert.doesNotMatch(
  source,
  /private drawSmokeScreenEffects[\s\S]*?visibleHexKeys\.size > 0[\s\S]*?visibleHexKeys\.has\(key\)/,
  'smoke-screen effects should not disappear just because their hex is obscured',
);

console.log('BattleScene smoke-above-fog tests passed');
