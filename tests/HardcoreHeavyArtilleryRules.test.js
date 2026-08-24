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
const {
  computeRadioSharedVisibleHexes,
  computeUnitVisibleHexes,
  HEAVY_ARTILLERY_VISION_RANGE,
} = require('../assets/scripts/core/FogOfWar.ts');

const map = new HexMap(9, 9);
for (let q = -1; q <= 7; q++) {
  for (let r = -1; r <= 7; r++) map.set({ pos: { q, r }, terrain: 'field' });
}
const sees = (visible, q, r) => visible.has(HexMap.keyOf({ q, r }));

for (const kind of ['heavy_artillery', 'german_heavy_artillery']) {
  const artillery = {
    id: kind,
    kind,
    faction: kind === 'heavy_artillery' ? 'japanese' : 'german',
    pos: { q: 0, r: 0 },
    facing: 0,
    hatchOpen: true,
    visionRange: 99,
    stats: { visionType: 'turreted', visionRange: 99, hasRadio: true },
  };
  const visible = computeUnitVisibleHexes(map, artillery, 'clear');
  assert.strictEqual(HEAVY_ARTILLERY_VISION_RANGE, 4);
  for (let q = 1; q <= 4; q++) assert(sees(visible, q, 0), `${kind} must see forward hex ${q}`);
  assert(!sees(visible, 5, 0), `${kind} must not see beyond four hexes`);
  assert(!sees(visible, 0, 1), `${kind} must not gain off-axis or open-hatch vision`);

  const spotter = {
    id: 'spotter', kind: 'japanese_infantry', faction: artillery.faction,
    pos: { q: 0, r: 2 }, facing: null, stats: { visionType: 'infantry', visionRange: 4, hasRadio: true },
  };
  const shared = computeRadioSharedVisibleHexes(map, artillery, [spotter], 'clear');
  assert(!sees(shared, 0, 2), `${kind} must not receive off-axis radio vision`);
}

const scene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const beginTurn = scene.match(/private\s+beginCurrentEnemyTurn\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(beginTurn, 'enemy turn entry should exist');
assert.match(beginTurn[0], /GameSession\.gameMode === 'hardcore' && isHeavyArtilleryUnit\(enemy\)[\s\S]*?this\.enemyDice = \[\][\s\S]*?runHardcoreHeavyArtilleryTurn\(enemy\)/,
  'hardcore heavy artillery must bypass action dice');

const turn = scene.match(/private\s+runHardcoreHeavyArtilleryTurn\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(turn, 'deterministic heavy-artillery turn should exist');
assert.match(turn[0], /selectHardcoreHeavyArtilleryTarget[\s\S]*?tryEnemyAttack\(artillery, \{ selectedTarget: target \}\)/,
  'heavy artillery should execute one attack against its selected legal target');

const select = scene.match(/private\s+selectHardcoreHeavyArtilleryTarget\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(select, 'heavy-artillery target selector should exist');
assert.match(select[0], /distance > HEAVY_ARTILLERY_VISION_RANGE/);
assert.match(select[0], /fireDirectionTo\(artillery\.pos, target\.pos\) !== artillery\.facing/);
assert.match(select[0], /visible\.has\(HexMap\.keyOf\(target\.pos\)\)/);
assert.match(select[0], /canAttack\(\{/);

console.log('Hardcore heavy-artillery deterministic action and vision tests passed');
