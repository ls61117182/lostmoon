const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const scene = read('assets/scripts/view/BattleScene.ts');
const combat = read('assets/scripts/core/Combat.ts');
const runtime = read('assets/scripts/core/CampaignUpgrade.ts');
const turnEnd = read('assets/scripts/core/TurnEndEventApply.ts');
const csvLines = read('data/campaign_upgrades.csv').trim().split(/\r?\n/);

assert.strictEqual(csvLines.length, 18, 'upgrade table should contain exactly 17 upgrades plus its header');
assert(scene.includes("GameSession.gameMode === 'hardcore'"), 'campaign upgrades must be gated to hardcore mode');
assert(scene.includes('campaignUpgradeSelectedIndex = 1'), 'the middle card should be selected by default');
assert(scene.includes("t('campaignUpgrade.confirm')"), 'selection should use an explicit confirmation button');
assert(scene.includes('openCampaignUpgradeDetail(id)'), 'acquired upgrade slots should open the detail card');
assert(scene.includes('campaignUpgradeStatusRoot'), 'Sherman status should expose acquired upgrades');
assert(scene.includes('campaignMainGunHitThresholdModifier()'), 'improved optics should modify main-gun attacks');
assert(scene.includes("campaignUpgradeActive('automatic_extinguisher')"), 'repair dice should support the extinguisher');
assert(scene.includes("const transmissionAllowsBothDirections = (a === 'drive' || a === 'reverse')")
  && scene.includes("if (dirSign !== nativeDirection && !this.campaignMovementDiceCanReverseDirection()) return;")
  && scene.includes("campaignUpgradeDefinition('improved_transmission').movementDiceCanReverseDirection"),
  'improved transmission should let advance and reverse dice move in either direction');
assert(scene.includes("if (action !== 'turn') return;"),
  'improved transmission should no longer let advance dice execute turn actions');
assert(scene.includes("classifyMiscDie(pip) === 'smoke_or_repair'"), 'the base smoke die should remain initially available');
assert(scene.includes('pip !== 2 && pip !== 4')
  && scene.includes("campaignUpgradeActive('smoke_launcher')")
  && scene.includes("campaignUpgradeDefinition('smoke_launcher').smokeOnMiscPips2And4"),
  'the smoke launcher should add smoke to misc pips 2 and 4');
assert(!scene.includes('campaignSmokeUnlocked()'), 'the base smoke action should no longer be upgrade-gated');
assert(scene.includes('campaignUpgradeDiceBonus('), 'wide tracks and intercom should feed the action dice pool');
assert(scene.includes("campaignUpgradeActive('ready_rack')")
  && scene.includes('shootingDiceCanReload'), 'ready rack should let shooting dice reload');
assert(scene.includes("campaignUpgradeActive('ammo_handling_optimization')")
  && scene.includes('retainedCampaignAttackDiePip'), 'ammo handling should retain the lowest unused attack die');
assert(scene.includes("id === 'emergency_medical_kit'")
  && scene.includes('reviveFirstCampaignCrewMember'), 'medical kit should revive crew at segment entry/acquisition');
assert(scene.includes('upgrade_icons_atlas_v1/spriteFrame'), 'upgrade cards should load the illustrated icon atlas');
assert(scene.includes('upgrade_icons_atlas_v2/spriteFrame'), 'new upgrade cards should load the extension icon atlas');
assert(fs.existsSync(path.join(root, 'assets/resources/textures/ui/campaign_upgrades/upgrade_icons_atlas_v1.png')),
  'illustrated upgrade icon atlas should exist');
assert(fs.existsSync(path.join(root, 'assets/resources/textures/ui/campaign_upgrades/upgrade_icons_atlas_v2.png')),
  'extension upgrade icon atlas should exist');
assert(combat.includes('isDamageEffectSuppressed'), 'damage resolution should honor protected damage results');
assert(combat.includes('campaignHiddenCloseRangeUntargetable')
  && combat.includes('campaignParalyzedProtectionAvailable')
  && combat.includes('commanderShieldBlocked'), 'combat should enforce camouflage, paralysis, and commander protections');
assert(runtime.includes('armorFrontSideBonus') && runtime.includes('armorRearSideBonus'), 'side skirts should modify both side armor faces');
assert(turnEnd.includes('campaignMineDamageImmune')
  && turnEnd.includes("'turnEnd.mine.protected'")
  && turnEnd.includes("'turnEnd.clearMine.protected'"), 'mine roller should block both mine event types');
assert(turnEnd.includes('campaignMechanicalFailureImmune')
  && turnEnd.includes("'turnEnd.mechanical.protected'"), 'reinforced transmission should block mechanical events');
assert(turnEnd.includes('campaignCommanderShieldAvailable')
  && turnEnd.includes("'turnEnd.sniper.shielded'"), 'commander shield should block the first sniper death');

console.log('Campaign upgrade tests passed');
