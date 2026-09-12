const assert = require('node:assert/strict');
const fs = require('node:fs');
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
const { SAVE_KEY } = require('../assets/scripts/core/SaveLoad.ts');
const { getActiveSaveKey, readActiveSaveRaw, clearCompletedMissionSave } = require('../assets/scripts/core/SaveSlot.ts');
const { writeCampaignRun, readCampaignRun, clearCompletedCampaignRun } = require('../assets/scripts/core/CampaignRunStore.ts');
const { writeCampaignCheckpoint, readCampaignCheckpoint, clearCampaignCheckpoint } = require('../assets/scripts/core/CampaignCheckpointStore.ts');
const source = { type: 'resource', missionPath: 'missions/one' };

test('completion removes matching current and legacy saves without reviving Continue', () => {
  storage.clear();
  const raw = JSON.stringify({ missionId: 'one', missionSource: source });
  storage.set(getActiveSaveKey(), raw);
  storage.set(SAVE_KEY, raw);
  clearCompletedMissionSave('one', source);
  assert.equal(readActiveSaveRaw(), null);
  clearCompletedMissionSave('one', source);
  assert.equal(storage.size, 0);
});

test('cleanup preserves other missions, custom packages and account slots', () => {
  storage.clear();
  const raw = JSON.stringify({ missionId: 'other' });
  storage.set(getActiveSaveKey(), raw);
  clearCompletedMissionSave('one', source);
  assert.equal(readActiveSaveRaw(), raw);
  const custom = JSON.stringify({ missionId: 'one', missionSource: { type: 'custom', packageId: 'other' } });
  storage.set(getActiveSaveKey(), custom);
  clearCompletedMissionSave('one', { type: 'custom', packageId: 'current' });
  assert.equal(readActiveSaveRaw(), custom);
  storage.set('lone_sherman_auth_session_v1', JSON.stringify({ mode: 'online', username: 'alice' }));
  storage.set(getActiveSaveKey(), JSON.stringify({ missionId: 'one' }));
  storage.set(SAVE_KEY, raw);
  clearCompletedMissionSave('one', source);
  assert.equal(readActiveSaveRaw(), null);
  assert.equal(storage.get(SAVE_KEY), raw);
  storage.delete('lone_sherman_auth_session_v1');
  assert.equal(readActiveSaveRaw(), custom);
});

test('campaign completion clears its run and checkpoint while preserving standalone and other checkpoints', () => {
  storage.clear();
  storage.set(getActiveSaveKey(), 'standalone');
  const run = {
    version: 1, runtime: { campaign: { id: 'campaign' }, segmentMissionData: [{}] },
    segmentIndex: 0, mission: { tiles: [] }, save: { sherman: {} }, upgradeIds: [], chosenSegments: [],
  };
  writeCampaignRun(run);
  writeCampaignCheckpoint({ campaignId: 'campaign', segmentIndex: 0, save: run.save });
  writeCampaignCheckpoint({ campaignId: 'other', segmentIndex: 0, save: run.save });
  clearCompletedCampaignRun('other');
  assert.deepEqual(readCampaignRun(), run);
  clearCompletedCampaignRun('campaign');
  clearCampaignCheckpoint('campaign');
  assert.equal(readCampaignRun(), null);
  assert.equal(readCampaignCheckpoint('campaign'), null);
  assert.ok(readCampaignCheckpoint('other'));
  assert.equal(readActiveSaveRaw(), 'standalone');
});

test('battle only cleans up on non-PvP victory after intermediate campaign advancement', () => {
  const scene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
  const overlay = scene.slice(scene.indexOf('private updateOutcomeOverlay()'));
  assert.match(overlay, /if \(this.canAdvanceCampaignSegment\(\)\) \{\s*this.advanceCampaignSegment\(\);\s*return;/);
  assert.match(overlay, /if \(!GameSession.isPvp && this.outcome === 'victory'\) \{\s*try \{[\s\S]*?clearCompletedCampaignRun\(campaignId\);\s*clearCampaignCheckpoint\(campaignId\);[\s\S]*?clearCompletedMissionSave\(this.missionId, this.missionSource\);/);
});
