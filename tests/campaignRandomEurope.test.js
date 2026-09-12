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
  RANDOM_EUROPE_CAMPAIGN_ID,
  createRandomEuropeCampaign,
} = require('../assets/scripts/core/CampaignDB.ts');
const {
  GameSession,
  createRandomEuropePackages,
} = require('../assets/scripts/core/GameSession.ts');
const { stitchCampaignMissions } = require('../assets/scripts/core/CampaignRuntime.ts');

const allowedWeather = new Set([undefined, 'rain']);
const observedWeather = new Set();
for (let seed = 1; seed <= 50; seed++) {
  const packages = createRandomEuropePackages(seed);
  assert.strictEqual(packages.length, 3);
  const threat = { infantry: 1, german_infantry: 1, officer: 1, truck: 0, panzer3: 2, panzer3_m: 2, panzer4: 3, stug3: 3, panther: 4, tiger: 5, tigerking: 6, maus: 6, pak38: 3, german_heavy_artillery: 4 };
  assert.deepStrictEqual(packages.map(pkg => pkg.mission.enemies.reduce(
    (sum, enemy) => sum + (threat[enemy.kind] ?? 0), 0)), [7, 10, 13]);
  assert(packages.every(pkg => pkg.mission.theater === 'europe'));
  assert(packages.every(pkg => pkg.mission.season === 'summer'));
  assert(packages.every(pkg => pkg.mission.usCasualtyLimit === undefined),
    'Random Europe must not have a US casualty phase');
  for (const pkg of packages) {
    assert(allowedWeather.has(pkg.mission.weather));
    observedWeather.add(pkg.mission.weather ?? 'clear');
  }
  const campaign = createRandomEuropeCampaign(packages.map(pkg => pkg.mission.id));
  assert.doesNotThrow(() => stitchCampaignMissions(campaign, packages.map(pkg => pkg.mission)));
}
assert.deepStrictEqual([...observedWeather].sort(), ['clear', 'rain']);

const catalog = CAMPAIGNS.find(campaign => campaign.id === RANDOM_EUROPE_CAMPAIGN_ID);
assert(catalog);
assert.strictEqual(catalog.order, 7);
assert.strictEqual(catalog.autoEvacAfterDestroyAll, true);
assert.strictEqual(catalog.segments.length, 0);

assert.strictEqual(GameSession.selectCampaign(7, RANDOM_EUROPE_CAMPAIGN_ID), true);
assert.strictEqual(GameSession.selectedCampaignPackages.length, 3);
assert.strictEqual(GameSession.selectedCampaign.autoEvacAfterDestroyAll, true);
assert(GameSession.selectedCampaignPackages.every(pkg => pkg.mission.season === 'summer'));

console.log('random Europe campaign tests passed');
