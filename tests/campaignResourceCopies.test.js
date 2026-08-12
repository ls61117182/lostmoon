const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');

const copies = [
  ['mission_pacific_01', 'campaign_tarawa_red_beach_1_01'],
  ['mission_pacific_02', 'campaign_tarawa_red_beach_1_02'],
  ['mission_pacific_03', 'campaign_tarawa_red_beach_1_03'],
  ['mission_pacific_04', 'campaign_saipan_01'],
  ['mission_pacific_05', 'campaign_saipan_02'],
  ['mission_pacific_06', 'campaign_saipan_03'],
  ['mission_pacific_07', 'campaign_tarawa_red_beach_2_01'],
  ['mission_pacific_08', 'campaign_tarawa_red_beach_2_02'],
  ['mission_pacific_09', 'campaign_tarawa_red_beach_2_03'],
  ['mission_pacific_10', 'campaign_peleliu_01'],
  ['mission_pacific_11', 'campaign_peleliu_02'],
  ['mission_pacific_12', 'campaign_peleliu_03'],
];

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8').replace(/^\uFEFF/, ''));
}

function campaignPath(id) {
  return `assets/resources/missions/campaign_pacific/${id}.json`;
}

function normalizedTileGrid(mission) {
  return Array.from({ length: mission.rows }, (_, row) =>
    Array.from({ length: mission.cols }, (_, col) => mission.tiles[row]?.[col] ?? null));
}

const terrainCustomizedCampaigns = new Set([
  'campaign_tarawa_red_beach_1_01',
  'campaign_tarawa_red_beach_1_02',
]);

for (const [sourceId, campaignId] of copies) {
  const source = readJson(`assets/resources/missions/${sourceId}.json`);
  const copy = readJson(campaignPath(campaignId));
  assert.strictEqual(copy.id, campaignId, `${campaignId} should have independent id`);
  assert.strictEqual(copy.theater, 'pacific', `${campaignId} should stay pacific`);
  assert.strictEqual(copy.tiles.length, copy.rows, `${campaignId} tile rows should match rows`);
  assert(copy.tiles.every(row => row.length <= copy.cols), `${campaignId} tile columns should fit cols`);
  if (terrainCustomizedCampaigns.has(campaignId)) {
    const displayOnlyTiles = copy.tiles.flat().filter(tile => tile?.disp === 1 || tile?.disp === true);
    assert(displayOnlyTiles.length > 0, `${campaignId} should retain its campaign-only scenery tiles`);
    assert(
      displayOnlyTiles.every(tile => tile.eid === undefined && tile.rid === undefined),
      `${campaignId} scenery tiles must not contain active unit start markers`,
    );
  } else {
    assert.deepStrictEqual(
      normalizedTileGrid(copy),
      normalizedTileGrid(source),
      `${campaignId} should retain copied terrain`,
    );
  }
  assert.deepStrictEqual(copy.objective, source.objective, `${campaignId} should start from copied objective`);
  assert.strictEqual(copy.eventTableId, source.eventTableId, `${campaignId} should initially reuse event table id`);
}

const campaigns = readJson('assets/resources/campaigns/pacific_campaigns.json');
assert.strictEqual(campaigns.campaigns.length, 5, 'campaign resource should define five campaigns');
assert.deepStrictEqual(
  campaigns.campaigns.slice(0, 4).map(c => c.title),
  ['塔拉瓦红滩1', '塞班岛', '塔拉瓦红滩2', '贝里琉'],
);
const randomIsland = campaigns.campaigns[4];
assert.strictEqual(randomIsland.id, 'random_island');
assert.strictEqual(randomIsland.title, '随机岛屿');
assert.deepStrictEqual(
  randomIsland.segmentGeneration.map(segment => segment.pacificBattleType),
  ['landing', 'inland', 'inland'],
);
assert.deepStrictEqual(
  randomIsland.segmentGeneration.map(segment => segment.objectiveKinds),
  [['direct_evac', 'target_evac'], ['direct_evac', 'target_evac'], ['destroy_all']],
);
assert.deepStrictEqual(
  randomIsland.segmentGeneration.map(segment => segment.enemyThreatPoints),
  [10, 13, 16],
);
assert.strictEqual(randomIsland.segmentCount, 3);

const lang = fs.readFileSync(path.join(repo, 'data/lang.csv'), 'utf8');
for (const key of [
  'chapter.campaign.title',
  'chapter.campaign.subtitle',
  'campaign.tarawaRedBeach1.title',
  'campaign.saipan.title',
  'campaign.tarawaRedBeach2.title',
  'campaign.peleliu.title',
  'campaign.randomIsland.title',
]) {
  assert(lang.includes(key), `data/lang.csv should contain ${key}`);
}

console.log('campaign resource copy tests passed');
