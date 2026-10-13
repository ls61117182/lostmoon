const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const types = require('../assets/scripts/core/types.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { actionDicePool } = require('../assets/scripts/core/ActionDice.ts');
function unit(kind) { const stats = getUnitStats(kind, 'europe'); return { kind, stats, crew: types.createTankCrew(stats), faction: stats.faction }; }
const previousBaseFirepower = {
  "sherman": 6,
  "sherman76": 6,
  "sherman_jumbo": 6,
  "m26_pershing": 6,
  "t34": 4,
  "t34_85": 6,
  "kv1": 6,
  "is2": 5,
  "su152": 6,
  "tiger": 6,
  "tigerking": 6,
  "maus": 6,
  "panther": 6,
  "panzer4": 6,
  "stug3": 5,
  "panzer3": 6,
  "truck": 0,
  "infantry": 0,
  "german_infantry": 0,
  "soviet_infantry": 0,
  "officer": 0,
  "type95": 3,
  "type97": 4,
  "type4": 6,
  "at_gun": 6,
  "pak38": 6,
  "japanese_infantry": 0,
  "american_infantry": 0,
  "heavy_artillery": 6,
  "german_heavy_artillery": 6,
  "panzer3_m": 6,
  "flak88": 6,
  "panzer3_m_no_schurzen": 6,
  "panzer3_n": 6,
  "panzer3_n_schurzen": 6,
  "sturmtiger": 5,
  "jagdtiger": 6,
  "elefant": 6,
  "jagdpanther": 6,
  "panzer4_f": 6
};
const { PLAYER_HARDCORE_DICE_POOL } = require('../assets/scripts/core/PlayerActionDB.ts');
test('all 40 unit base firepowers shift by four and preserve player attack dice across casualties and terrain', () => {
  for (const [kind, previousBase] of Object.entries(previousBaseFirepower)) {
    const u = unit(kind);
    assert.equal(u.stats.firepower, previousBase - 4, kind);
    for (const terrain of Object.keys(PLAYER_HARDCORE_DICE_POOL.baseByPhaseTerrain.attack)) {
      for (let mask = 0; mask < 8; mask++) {
        const crew = { commander: !!(mask & 1), gunner: !!(mask & 2), loader: !!(mask & 4), driver: false, coDriver: false };
        for (const externalBonus of [0, 1, 2]) {
          const oldCount = Math.max(1, 2 + previousBase - 6 + PLAYER_HARDCORE_DICE_POOL.baseByPhaseTerrain.attack[terrain]
            + Number(crew.commander) + Number(crew.gunner) + Number(crew.loader) + externalBonus);
          const current = actionDicePool({ subPhase: 'attack', terrain, hatchOpen: false, commanderBonusWithoutOpenHatch: true,
            crew, hardcore: true, firepower: u.stats.firepower, externalBonus });
          assert.equal(current, oldCount, kind + ':' + terrain + ':' + mask);
        }
      }
    }
  }
});
test('negative base firepower combines with posts before the minimum and leaves classic mode unchanged', () => {
  const crew = { commander: true, gunner: true, loader: true, driver: false, coDriver: false };
  const opts = { subPhase: 'attack', terrain: 'road', hatchOpen: true, crew, firepower: -1 };
  assert.equal(actionDicePool({ ...opts, hardcore: true }), 2);
  assert.equal(actionDicePool({ ...opts, hardcore: true, terrain: 'beach' }), 1);
  assert.equal(actionDicePool({ ...opts, hardcore: false }), actionDicePool({ ...opts, hardcore: false, firepower: 3 }));
});

const { effectiveAIFirepower, rollHardcoreTankAIDice } = require('../assets/scripts/core/EnemyAI.ts');
const { campaignUpgradeDiceBonus } = require('../assets/scripts/core/CampaignUpgrade.ts');
const { nonPlayerTankFirepowerBonus } = require('../assets/scripts/core/UnitLevel.ts');
test('AI and player share current firepower across actual rosters, casualties, hatch states, terrain and unit upgrades', () => {
  for (const kind of Object.keys(previousBaseFirepower)) {
    if (!types.isTankUnit(unit(kind))) continue;
    for (const terrain of ['road', 'mud', 'trees', 'beach']) {
      for (const hatchOpen of [false, true]) {
        for (let mask = 0; mask < 8; mask++) {
          const actor = unit(kind);
          actor.hatchOpen = hatchOpen;
          if (mask & 1) actor.crew.commander = false;
          if (mask & 2) actor.crew.gunner = false;
          if (mask & 4) actor.crew.loader = false;
          actor.campaignUpgradeIds = ['wide_tracks', 'ready_rack'];
          const expected = actionDicePool({ subPhase: 'attack', terrain, hardcore: true, firepower: actor.stats.firepower,
            crew: types.effectiveTankCrew(actor), hatchOpen, commanderBonusWithoutOpenHatch: true,
            externalBonus: campaignUpgradeDiceBonus(actor.campaignUpgradeIds, terrain, 'attack') });
          assert.equal(effectiveAIFirepower(actor, terrain), expected, kind + ':' + terrain + ':' + mask);
        }
      }
    }
  }
});
test('Panzer IV G gets three attack dice with all posts and responds to casualties and terrain', () => {
  const actor = unit('panzer4');
  function faces(terrain = 'road') { return rollHardcoreTankAIDice({ d6: () => 1 }, actor, terrain).filter(d => d.type === 'attack').map(d => d.attackFirepower); }
  assert.equal(effectiveAIFirepower(actor, 'road'), 5);
  assert.deepEqual(faces(), [6, 6, 3]);
  assert.deepEqual(faces('mud'), [6, 6]);
  actor.crew.gunner = false;
  assert.equal(effectiveAIFirepower(actor, 'road'), 4);
  assert.deepEqual(faces(), [6, 6]);
  actor.crew.loader = false;
  actor.crew.commander = false;
  assert.deepEqual(faces('beach'), [3]);
});
test('AI rank bonuses are combined before the minimum and upgrades belong to the acting unit', () => {
  const actor = unit('panzer4');
  actor.unitLevel = 'veteran';
  assert.equal(effectiveAIFirepower(actor, 'road'), 6);
  actor.unitLevel = 'elite';
  assert.equal(effectiveAIFirepower(actor, 'road'), 7);
  actor.campaignUpgradeIds = ['wide_tracks', 'unknown_upgrade'];
  assert.equal(effectiveAIFirepower(actor, 'mud'), 7);
  const unupgraded = unit('panzer4');
  assert.equal(effectiveAIFirepower(unupgraded, 'mud'), 4);
  const low = unit('type95');
  low.crew.commander = false;
  low.crew.loader = false;
  low.unitLevel = 'elite';
  assert.equal(nonPlayerTankFirepowerBonus(low), 2);
  assert.equal(effectiveAIFirepower(low, 'beach'), 1);
});
