const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = function transpileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};

const {
  CAMPAIGNS,
  RANDOM_SNOW_CAMPAIGN_ID,
  createRandomSnowCampaign,
} = require('../assets/scripts/core/CampaignDB.ts');
const {
  GameSession,
  createRandomSnowPackages,
} = require('../assets/scripts/core/GameSession.ts');
const { stitchCampaignMissions } = require('../assets/scripts/core/CampaignRuntime.ts');

const allowedWeather = new Set([undefined, 'light_snow', 'heavy_snow']);
const observedWeather = new Set();
for (let seed = 1; seed <= 50; seed++) {
  const packages = createRandomSnowPackages(seed);
  assert.strictEqual(packages.length, 3);
  assert(packages.every(pkg => pkg.mission.theater === 'europe'));
  assert(packages.every(pkg => pkg.mission.season === 'winter'));
  assert(packages.every(pkg => pkg.mission.usCasualtyLimit === undefined),
    'Random Snow must not have a US casualty phase');
  for (const pkg of packages) {
    assert(allowedWeather.has(pkg.mission.weather));
    observedWeather.add(pkg.mission.weather ?? 'clear');
  }
  const campaign = createRandomSnowCampaign(packages.map(pkg => pkg.mission.id));
  assert.doesNotThrow(() => stitchCampaignMissions(campaign, packages.map(pkg => pkg.mission)));
}
assert.deepStrictEqual([...observedWeather].sort(), ['clear', 'heavy_snow', 'light_snow']);

const catalog = CAMPAIGNS.find(campaign => campaign.id === RANDOM_SNOW_CAMPAIGN_ID);
assert(catalog);
assert.strictEqual(catalog.order, 6);
assert.strictEqual(catalog.autoEvacAfterDestroyAll, true);
assert.strictEqual(catalog.segments.length, 0);

assert.strictEqual(GameSession.selectCampaign(6, RANDOM_SNOW_CAMPAIGN_ID), true);
assert.strictEqual(GameSession.selectedCampaignPackages.length, 3);
assert.strictEqual(GameSession.selectedCampaign.autoEvacAfterDestroyAll, true);
assert(GameSession.selectedCampaignPackages.every(pkg => pkg.mission.season === 'winter'));

const battle = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
assert.match(battle, /sherman\.paralyzed = false/);
assert.match(battle, /offsetToAxial\(\{ col: 7, row: 2 \}/);
assert.match(battle, /neighbor\(target, 0\)/);
assert.match(battle, /evacExit: true/);
assert.match(battle, /map\.canTankCrossEdge\(current, next/);

console.log('random snow campaign tests passed');
