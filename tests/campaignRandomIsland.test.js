const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = function transpileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  module._compile(output, filename);
};

const {
  CAMPAIGNS,
  RANDOM_ISLAND_CAMPAIGN_ID,
  createRandomIslandCampaign,
  getCampaign,
} = require('../assets/scripts/core/CampaignDB.ts');
const {
  GameSession,
  createRandomIslandPackages,
} = require('../assets/scripts/core/GameSession.ts');
const { stitchCampaignMissions } = require('../assets/scripts/core/CampaignRuntime.ts');

function beachCount(mission) {
  return mission.tiles.flat().filter(tile => tile?.t === 'B').length;
}

const pacificThreat = {
  japanese_infantry: 1,
  type95: 2,
  type97: 3,
  at_gun: 3,
  heavy_artillery: 4,
};

function initialEnemyThreat(mission) {
  return mission.enemies.reduce((sum, enemy) => sum + (pacificThreat[enemy.kind] ?? 0), 0);
}

const packages = createRandomIslandPackages(123456);
assert.strictEqual(packages.length, 3);
assert(packages.every(pkg => pkg.mission.theater === 'pacific'));
assert(beachCount(packages[0].mission) >= 5, 'first generated mission must be a Pacific landing battle');
assert.strictEqual(beachCount(packages[1].mission), 0, 'second generated mission must be inland');
assert.strictEqual(beachCount(packages[2].mission), 0, 'third generated mission must be inland');
for (const pkg of packages.slice(0, 2)) {
  assert.strictEqual(pkg.mission.objective.type, 'destroy_kind_evac');
  assert.deepStrictEqual(pkg.mission.objective.evacAt, { col: 7, row: 2 });
  assert.strictEqual(pkg.mission.objective.evacExitDir, 0);
}
assert.strictEqual(packages[2].mission.objective.type, 'destroy_all_enemies',
  'third generated mission must require destroying every enemy');
assert.deepStrictEqual(packages.map(pkg => initialEnemyThreat(pkg.mission)), [10, 13, 16],
  'Random Island stages must use their configured initial enemy threat totals');
assert(packages.every(pkg => pkg.mission.id.startsWith('random_pacific_')),
  'Random Island must use newly generated missions, not bundled Pacific missions');
assert.strictEqual(new Set(packages.map(pkg => pkg.mission.id)).size, 3, 'generated mission ids must be distinct');
assert(packages.every(pkg => pkg.turnEndEvents.every(row => row.missionId === pkg.mission.id)),
  'each generated mission must retain its generated turn-end event table');

const firstTwoObjectiveKinds = new Set();
for (let seed = 1; seed <= 50; seed++) {
  const generated = createRandomIslandPackages(seed);
  assert.deepStrictEqual(generated.map(pkg => initialEnemyThreat(pkg.mission)), [10, 13, 16],
    `seed ${seed}: initial enemy threat totals must remain exact`);
  for (const pkg of generated.slice(0, 2)) {
    const objective = pkg.mission.objective;
    assert.strictEqual(objective.type, 'destroy_kind_evac');
    firstTwoObjectiveKinds.add(objective.kind ? 'target_evac' : 'direct_evac');
  }
  assert.strictEqual(generated[2].mission.objective.type, 'destroy_all_enemies');
}
assert.deepStrictEqual([...firstTwoObjectiveKinds].sort(), ['direct_evac', 'target_evac'],
  'the first two stages must randomize between direct evacuation and target-then-evacuation');

const campaign = createRandomIslandCampaign(packages.map(pkg => pkg.mission.id));
assert.strictEqual(campaign.segments.length, 3);
assert(campaign.segments.every(segment => segment.missionPath === ''),
  'generated campaign stages should be loaded from memory, not official mission resources');
assert.deepStrictEqual(
  campaign.segments.map(segment => segment.sourcePacificMissionId),
  packages.map(pkg => pkg.mission.id),
);
assert.doesNotThrow(() => stitchCampaignMissions(campaign, packages.map(pkg => pkg.mission)));
assert.throws(() => createRandomIslandCampaign(['only_one']), /exactly 3 generated missions/);

const catalogEntry = CAMPAIGNS.find(entry => entry.id === RANDOM_ISLAND_CAMPAIGN_ID);
assert(catalogEntry, 'campaign menu catalog should contain Random Island');
assert.strictEqual(catalogEntry.order, 5);
assert.strictEqual(getCampaign(RANDOM_ISLAND_CAMPAIGN_ID).segments.length, 0,
  'catalog entry should not preselect bundled missions');

assert.strictEqual(GameSession.selectCampaign(5, RANDOM_ISLAND_CAMPAIGN_ID), true);
assert.strictEqual(GameSession.selectedCampaign.segments.length, 3);
assert.strictEqual(GameSession.selectedCampaignPackages.length, 3);
assert.deepStrictEqual(
  GameSession.selectedCampaign.segments.map(segment => segment.sourcePacificMissionId),
  GameSession.selectedCampaignPackages.map(pkg => pkg.mission.id),
  'the generated maps must stay fixed in the active campaign session',
);

console.log('random island generated campaign tests passed');
