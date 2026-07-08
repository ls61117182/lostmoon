const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(repo, rel), 'utf8');
}

function assertContains(file, text) {
  const body = read(file);
  assert(
    body.includes(text),
    `${file} should contain ${text}`,
  );
}

function assertNotContainsInPacificBlock() {
  const body = read('assets/scripts/core/LevelDB.ts');
  const pacificStart = body.indexOf("id: 'pacific'");
  const testStart = body.indexOf("id: 'test'");
  assert(pacificStart >= 0, 'LevelDB should still contain pacific chapter');
  assert(testStart > pacificStart, 'LevelDB test chapter should follow pacific');
  const pacificBlock = body.slice(pacificStart, testStart);
  assert(!pacificBlock.includes('campaign_pacific'), 'Pacific chapter must not point to campaign resources');
  for (let i = 1; i <= 12; i++) {
    const nn = String(i).padStart(2, '0');
    assert(
      pacificBlock.includes(`missions/mission_pacific_${nn}`),
      `Pacific chapter should keep mission_pacific_${nn}`,
    );
  }
}

assertContains('assets/scripts/core/CampaignDB.ts', "export const CAMPAIGN_CHAPTER_ID = 'campaign'");
assertContains('assets/scripts/core/CampaignDB.ts', "id: 'tarawa_red_beach_1'");
assertContains('assets/scripts/core/CampaignDB.ts', "titleKey: 'campaign.tarawaRedBeach1.title'");
assertContains('assets/scripts/core/CampaignDB.ts', "id: 'saipan'");
assertContains('assets/scripts/core/CampaignDB.ts', "id: 'tarawa_red_beach_2'");
assertContains('assets/scripts/core/CampaignDB.ts', "id: 'peleliu'");
assertContains('assets/scripts/core/LevelDB.ts', "id: CAMPAIGN_CHAPTER_ID");
assertContains('assets/scripts/core/LevelDB.ts', "entryKind: 'campaign'");
assertContains('assets/scripts/core/GameSession.ts', 'selectCampaign(levelId: number, campaignId: string)');
assertContains('assets/scripts/core/GameSession.ts', 'get isCampaign()');
assertContains('assets/scripts/view/MainMenuScene.ts', "meta.entryKind === 'campaign'");
assertContains('assets/scripts/view/MainMenuScene.ts', 'GameSession.selectCampaign(meta.id, meta.campaignId)');
assertNotContainsInPacificBlock();

console.log('campaignDB tests passed');
