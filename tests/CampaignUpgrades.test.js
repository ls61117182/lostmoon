const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const scene = read('assets/scripts/view/BattleScene.ts');
const combat = read('assets/scripts/core/Combat.ts');
const runtime = read('assets/scripts/core/CampaignUpgrade.ts');
const csvLines = read('data/campaign_upgrades.csv').trim().split(/\r?\n/);

assert.strictEqual(csvLines.length, 11, 'upgrade table should contain exactly 10 upgrades plus its header');
assert(scene.includes("GameSession.gameMode === 'hardcore'"), 'campaign upgrades must be gated to hardcore mode');
assert(scene.includes('campaignUpgradeSelectedIndex = 1'), 'the middle card should be selected by default');
assert(scene.includes("t('campaignUpgrade.confirm')"), 'selection should use an explicit confirmation button');
assert(scene.includes('openCampaignUpgradeDetail(id)'), 'acquired upgrade slots should open the detail card');
assert(scene.includes('campaignUpgradeStatusRoot'), 'Sherman status should expose acquired upgrades');
assert(scene.includes('campaignMainGunHitThresholdModifier()'), 'improved optics should modify main-gun attacks');
assert(scene.includes("campaignUpgradeActive('automatic_extinguisher')"), 'repair dice should support the extinguisher');
assert(scene.includes("campaignUpgradeActive('improved_transmission')"), 'advance dice should support transmission turns');
assert(scene.includes("a !== 'turn' && !transmissionTurnsDrive"), 'transmission turns should replace duplicate same-pip turn actions');
assert(scene.includes("classifyMiscDie(pip) === 'smoke_or_repair'"), 'the base smoke die should remain initially available');
assert(scene.includes('pip !== 2 && pip !== 4')
  && scene.includes("campaignUpgradeActive('smoke_launcher')")
  && scene.includes("campaignUpgradeDefinition('smoke_launcher').smokeOnMiscPips2And4"),
  'the smoke launcher should add smoke to misc pips 2 and 4');
assert(!scene.includes('campaignSmokeUnlocked()'), 'the base smoke action should no longer be upgrade-gated');
assert(scene.includes('campaignUpgradeDiceBonus('), 'wide tracks and intercom should feed the action dice pool');
assert(scene.includes('upgrade_icons_atlas_v1/spriteFrame'), 'upgrade cards should load the illustrated icon atlas');
assert(fs.existsSync(path.join(root, 'assets/resources/textures/ui/campaign_upgrades/upgrade_icons_atlas_v1.png')),
  'illustrated upgrade icon atlas should exist');
assert(combat.includes('isDamageEffectSuppressed'), 'damage resolution should honor protected damage results');
assert(runtime.includes('armorFrontSideBonus') && runtime.includes('armorRearSideBonus'), 'side skirts should modify both side armor faces');

console.log('Campaign upgrade tests passed');
