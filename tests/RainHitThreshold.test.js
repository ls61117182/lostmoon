const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  }).outputText;
  module._compile(output, filename);
};

const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { hitBreakdown, mgHitBreakdown, mgHitThreshold, rollMGAttack } = require('../assets/scripts/core/Combat.ts');

const map = new HexMap(3, 3);
map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
map.set({ pos: { q: 1, r: 0 }, terrain: 'field' });

const tank = {
  id: 'tank', kind: 'sherman', faction: 'usa', pos: { q: 0, r: 0 }, facing: 0,
  stats: { size: 4, visionType: 'turreted' },
};
const infantry = {
  id: 'infantry', kind: 'german_infantry', faction: 'german',
  pos: { q: 1, r: 0 }, facing: null,
  stats: { size: 2, visionType: 'infantry' },
};
const mainTarget = { ...infantry, kind: 'panzer4', stats: { size: 4, visionType: 'turreted' } };

const mainClear = hitBreakdown({ attacker: tank, target: mainTarget, map, weather: 'clear' });
const mainRain = hitBreakdown({ attacker: tank, target: mainTarget, map, weather: 'rain' });
assert.strictEqual(mainRain.weather, 1);
assert.strictEqual(mainRain.threshold, mainClear.threshold + 1);

for (const attacker of [tank, { ...infantry, pos: tank.pos, faction: 'usa' }]) {
  const clear = { attacker, target: infantry, map, weather: 'clear' };
  const rain = { ...clear, weather: 'rain' };
  assert.strictEqual(mgHitBreakdown(rain).weather, 0);
  assert.strictEqual(mgHitThreshold(rain), mgHitThreshold(clear));
  const clearRoll = rollMGAttack(clear, { d6: () => 4 });
  const rainRoll = rollMGAttack(rain, { d6: () => 4 });
  assert.strictEqual(rainRoll.hit, clearRoll.hit);
  assert.strictEqual(rainRoll.threshold, clearRoll.threshold);
}

const infantryMainClear = hitBreakdown({ attacker: { ...infantry, pos: tank.pos }, target: mainTarget, map, weather: 'clear' });
const infantryMainRain = hitBreakdown({ attacker: { ...infantry, pos: tank.pos }, target: mainTarget, map, weather: 'rain' });
assert.strictEqual(infantryMainRain.weather, 0);
assert.strictEqual(infantryMainRain.threshold, infantryMainClear.threshold);

console.log('Rain hit threshold test passed');
