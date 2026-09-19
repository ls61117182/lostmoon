// Exercise the actual Cocos release modules, including Babel's generated helpers.
// Usage: node tools/verifyWebCampaign.cjs [web-output-directory]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, 'build/web-desktop'));
const definitions = new Map();
const modules = new Map([['cc', { cclegacy: { _RF: { push() {}, pop() {} } } }]]);
const context = vm.createContext({
  console,
  System: {
    register(name, dependencies, factory) {
      if (typeof name !== 'string') {
        dependencies(() => {}, {}).execute();
        return;
      }
      definitions.set(name, { dependencies, factory });
    },
  },
});
for (const file of ['assets/main/index.js', 'src/chunks/bundle.js']) {
  vm.runInContext(fs.readFileSync(path.join(output, file), 'utf8'), context, { filename: file });
}
function load(name) {
  if (name.startsWith('./')) name = 'chunks:///_virtual/' + name.slice(2);
  if (modules.has(name)) return modules.get(name);
  const definition = definitions.get(name);
  assert.ok(definition, `Missing release module: ${name}`);
  const exports = {};
  modules.set(name, exports);
  const module = definition.factory((key, value) => {
    if (typeof key === 'object') Object.assign(exports, key);
    else exports[key] = value;
    return value;
  }, {});
  definition.dependencies.forEach((dependency, index) => module.setters[index](load(dependency)));
  module.execute();
  return exports;
}
const { CAMPAIGNS } = load('./CampaignDB.ts');
const { stitchCampaignMissions } = load('./CampaignRuntime.ts');
const { loadMission } = load('./MissionLoader.ts');
const { RNG } = load('./Dice.ts');
const campaign = CAMPAIGNS.find(campaign => campaign.id === 'peleliu');
assert.ok(campaign, 'Peleliu campaign must exist');
const missions = campaign.segments.map(segment => {
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources', segment.missionPath + '.json.meta'), 'utf8'));
  const asset = JSON.parse(fs.readFileSync(path.join(output, 'assets/resources/import', meta.uuid.slice(0, 2), meta.uuid + '.json'), 'utf8'));
  return asset[5][0][2];
});
const stitched = stitchCampaignMissions(campaign, missions);
for (const [index, data] of stitched.segmentMissionData.entries()) {
  for (let seed = 1; seed <= 100; seed++) {
    const mission = loadMission(data, new RNG(seed));
    assert.ok(mission.map.all().length > 0);
    assert.ok(mission.sherman);
    // Pacific AT guns also create their infantry crews during loading.
    assert.ok(mission.enemies.length >= missions[index].enemies.length);
    for (const enemy of mission.enemies) assert.ok(mission.map.get(enemy.pos));
  }
}
console.log('Peleliu release regression passed: 3 segments × 100 random seeds.');
