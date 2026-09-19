const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  }).outputText;
  module._compile(output, filename);
};

const { prepareTurnEndEvent } = require('../assets/scripts/core/TurnEndEventApply.ts');
const { HexMap } = require('../assets/scripts/core/HexGrid.ts');

function prepare(distances, { hatchOpen = true, shield = false, blocked = false } = {}) {
  const map = new HexMap(8, 8);
  for (let q = 0; q < 8; q++) for (let r = 0; r < 8; r++) {
    map.set({ pos: { q, r }, terrain: blocked && q === 1 ? 'forest' : 'field' });
  }
  const sherman = {
    id: 'player', kind: 'sherman', pos: { q: 0, r: 0 }, hatchOpen,
    crew: { commander: true, gunner: true, loader: true, driver: true, assistant: true },
    campaignCommanderShieldAvailable: shield,
  };
  const enemies = distances.map((distance, index) => ({
    id: `infantry-${index}`, kind: 'german_infantry', pos: { q: distance, r: 0 },
  }));
  const event = prepareTurnEndEvent({ effectType: 'sniper' }, [2, 3], 5, {
    mission: { sherman, enemies, map }, rng: () => 0.5, nextEnemyId: () => 'unused',
  });
  return { event, sherman };
}

test('snipers at 1 and 2 hexes can kill; infantry at 3 hexes cannot', () => {
  for (const distance of [1, 2, 3]) {
    const { event, sherman } = prepare([distance]);
    assert.equal(event.sniperWillKill, distance <= 2);
    assert.equal(event.sniperAttackerId, distance <= 2 ? 'infantry-0' : undefined);
    event.apply();
    assert.equal(sherman.crew.commander, distance > 2);
  }
});

test('out-of-range infantry is skipped when selecting the actual shooter', () => {
  const { event } = prepare([3, 2]);
  assert.equal(event.sniperAttackerId, 'infantry-1');
});

test('closed hatch and blocked sight still prevent sniper casualties', () => {
  for (const options of [{ hatchOpen: false }, { blocked: true }]) {
    const { event, sherman } = prepare([2], options);
    assert.equal(event.sniperWillKill, false);
    event.apply();
    assert.equal(sherman.crew.commander, true);
  }
});

test('out-of-range snipers do not consume the commander shield', () => {
  for (const distance of [2, 3]) {
    const { event, sherman } = prepare([distance], { shield: true });
    event.apply();
    assert.equal(sherman.crew.commander, true);
    assert.equal(sherman.campaignCommanderShieldAvailable, distance > 2);
  }
});
