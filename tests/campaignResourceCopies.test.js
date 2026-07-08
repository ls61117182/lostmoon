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

for (const [sourceId, campaignId] of copies) {
  const source = readJson(`assets/resources/missions/${sourceId}.json`);
  const copy = readJson(campaignPath(campaignId));
  assert.strictEqual(copy.id, campaignId, `${campaignId} should have independent id`);
  assert.strictEqual(copy.theater, 'pacific', `${campaignId} should stay pacific`);
  assert.deepStrictEqual(copy.tiles, source.tiles, `${campaignId} should start from copied terrain`);
  assert.deepStrictEqual(copy.objective, source.objective, `${campaignId} should start from copied objective`);
  assert.strictEqual(copy.eventTableId, source.eventTableId, `${campaignId} should initially reuse event table id`);
}

const campaigns = readJson('assets/resources/campaigns/pacific_campaigns.json');
assert.strictEqual(campaigns.campaigns.length, 4, 'campaign resource should define four campaigns');
assert.deepStrictEqual(
  campaigns.campaigns.map(c => c.title),
  ['塔拉瓦红滩1', '塞班岛', '塔拉瓦红滩2', '贝里琉'],
);

const lang = fs.readFileSync(path.join(repo, 'data/lang.csv'), 'utf8');
for (const key of [
  'chapter.campaign.title',
  'chapter.campaign.subtitle',
  'campaign.tarawaRedBeach1.title',
  'campaign.saipan.title',
  'campaign.tarawaRedBeach2.title',
  'campaign.peleliu.title',
]) {
  assert(lang.includes(key), `data/lang.csv should contain ${key}`);
}

console.log('campaign resource copy tests passed');
