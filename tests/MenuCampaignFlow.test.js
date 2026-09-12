const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, filename);
};
const storage = new Map();
global.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};
const core = '../assets/scripts/core/';
const { GameSession } = require(core + 'GameSession.ts');
const { CAMPAIGNS } = require(core + 'CampaignDB.ts');
const { stitchCampaignMissions } = require(core + 'CampaignRuntime.ts');
const { loadMission } = require(core + 'MissionLoader.ts');
const { RNG } = require(core + 'Dice.ts');
const { captureSave, applySave } = require(core + 'SaveLoad.ts');
const { writeActiveSaveRaw, readActiveSaveRaw, getActiveSaveKey } = require(core + 'SaveSlot.ts');
const { readCampaignRun, writeCampaignRun } = require(core + 'CampaignRunStore.ts');
const { MenuProgress, getChapterLevels, getRandomMissionLevels } = require(core + 'LevelDB.ts');

function runFor(campaign) {
  GameSession.reset();
  GameSession.setGameMode('classic');
  assert.equal(GameSession.selectCampaign(campaign.levelId, campaign.id), true);
  const packages = GameSession.selectedCampaignPackages;
  const missions = packages ? packages.map(pkg => pkg.mission) : campaign.segments.map(segment =>
    JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/resources', segment.missionPath + '.json'), 'utf8').replace(/^\uFEFF/, '')));
  const runtime = stitchCampaignMissions(GameSession.selectedCampaign, missions);
  const data = runtime.segmentMissionData[1];
  const mission = loadMission(data, new RNG(72));
  mission.sherman.fireLevel = 1;
  const save = captureSave({
    gameMode: 'hardcore', missionId: data.id, mission, turn: 7, phase: 'player',
    movesLeft: 0, attacksLeft: 1, miscDone: true, playerStep: 'attack',
    hatchChangedThisTurn: true, phaseDice: [{ pip: 4, used: true }, { pip: 6, used: false }],
  });
  return {
    version: 1, runtime, mission: data, segmentIndex: 1, save, packages,
    upgradeIds: ['wide_tracks', 'commander_ballistic_shield'], chosenSegments: [0, 1],
    checkpoint: { campaignId: campaign.id, segmentIndex: 1, save },
    commanderShieldAvailable: false, paralyzedProtectionAvailable: false, retainedAttackDiePip: 5,
  };
}

test('every campaign forces hardcore without changing the saved standalone mode', () => {
  MenuProgress.setGameMode('classic');
  for (const campaign of CAMPAIGNS) {
    GameSession.reset();
    GameSession.setGameMode('classic');
    GameSession.selectCampaign(campaign.levelId, campaign.id);
    assert.equal(GameSession.gameMode, 'hardcore');
    GameSession.setGameMode('classic');
    assert.equal(GameSession.gameMode, 'hardcore');
    assert.equal(MenuProgress.load().gameMode, 'classic');
    GameSession.selectMission(1, 'missions/mission_01');
    GameSession.setGameMode(MenuProgress.load().gameMode);
    assert.equal(GameSession.gameMode, 'classic');
  }
});

test('campaign saves survive process state reset with maps, stage, upgrades and used dice intact', () => {
  for (const campaign of CAMPAIGNS) {
    const run = runFor(campaign);
    writeActiveSaveRaw('standalone save stays untouched');
    writeCampaignRun(run);
    assert.equal(readActiveSaveRaw(), 'standalone save stays untouched');
    GameSession.reset();
    const stored = readCampaignRun();
    assert.deepEqual(stored, JSON.parse(JSON.stringify(run)));
    GameSession.resumeCampaign(stored);
    assert.equal(GameSession.gameMode, 'hardcore');
    assert.equal(GameSession.selectedCampaignId, campaign.id);
    assert.equal(GameSession.campaignResume.segmentIndex, 1);
    assert.deepEqual(GameSession.selectedCampaignPackages, stored.packages);
    const restored = loadMission(stored.mission, new RNG(321));
    const result = applySave(restored, stored.mission.id, stored.save);
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.turn, 7);
    assert.equal(result.playerStep, 'attack');
    assert.deepEqual(result.phaseDice, [{ pip: 4, used: true }, { pip: 6, used: false }]);
    assert.equal(restored.sherman.fireLevel, 1);
    GameSession.clearResumeFlag();
    assert.equal(GameSession.campaignResume, null);
  }
});

test('new standalone saves do not change the campaign save and account slots stay separate', () => {
  const original = readCampaignRun();
  writeActiveSaveRaw('new standalone');
  assert.deepEqual(readCampaignRun(), original);
  storage.set('lone_sherman_auth_session_v1', JSON.stringify({ mode: 'online', username: 'another-user' }));
  assert.equal(readCampaignRun(), null);
  assert.equal(readActiveSaveRaw(), null);
  storage.delete('lone_sherman_auth_session_v1');
  assert.deepEqual(readCampaignRun(), original);
});

test('invalid campaign saves are rejected without damaging the mission slot', () => {
  const key = `${getActiveSaveKey()}:campaign_run_v1`;
  for (const invalid of ['{', 'null', '{}', JSON.stringify({ version: 1, segmentIndex: -1 })]) {
    storage.set(key, invalid);
    assert.equal(readCampaignRun(), null);
    assert.equal(readActiveSaveRaw(), 'new standalone');
  }
});

test('mission catalog exposes both twelve-level theaters and three ungenerated random choices', () => {
  assert.equal(getChapterLevels('europe').length, 12);
  assert.equal(getChapterLevels('pacific').length, 12);
  const before = new Map(storage);
  assert.equal(getRandomMissionLevels().length, 3);
  assert.deepEqual(storage, before);
});

test('battle exit returns to the matching selector only once', () => {
  GameSession.reset();
  GameSession.selectMission(1, 'missions/mission01');
  GameSession.setMissionMenuTab('pacific');
  GameSession.requestBattleMenuReturn();
  assert.deepEqual(GameSession.consumeBattleMenuReturn(), { kind: 'mission', tab: 'pacific' });
  assert.equal(GameSession.consumeBattleMenuReturn(), null);
  const campaign = CAMPAIGNS.find(c => !c.generator);
  GameSession.selectCampaign(campaign.levelId, campaign.id);
  GameSession.requestBattleMenuReturn();
  assert.equal(GameSession.consumeBattleMenuReturn().kind, 'campaign');
  GameSession.requestBattleMenuReturn();
  GameSession.reset();
  assert.equal(GameSession.consumeBattleMenuReturn(), null);
});
