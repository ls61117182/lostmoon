const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { loadCampaignShell } = require('../assets/scripts/core/CampaignUpgrade.ts');
const { isMainGunLoaded, mainGunReloadProgress, reloadAIMainGun } = require('../assets/scripts/core/types.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
const { canEnterAmbush, enterAmbush } = require('../assets/scripts/core/Ambush.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const tank = () => ({ stats: { reloadDifficulty: 2 }, loaded: false, loadedShell: null });

test('two actions load a shell, switching shells restarts progress, and progress is capped', () => {
  const u = tank();
  loadCampaignShell(u, 'ap');
  assert.equal(u.reloadProgress, 1); assert.equal(isMainGunLoaded(u, true), false);
  loadCampaignShell(u, 'he');
  assert.equal(u.reloadProgress, 1); assert.equal(u.loadedShell, 'he');
  loadCampaignShell(u, 'he');
  assert.equal(u.reloadProgress, 2); assert.equal(isMainGunLoaded(u, true), true);
  loadCampaignShell(u, 'he'); assert.equal(u.reloadProgress, 2);
  u.loaded = false; u.loadedShell = null; u.reloadProgress = 0;
  assert.equal(isMainGunLoaded(u, true), false);
});

test('HVAP and smoke are charged only on completion, with refunds only for completed rounds', () => {
  const u = { ...tank(), hvapAmmoRemaining: 1, smokeAmmoRemaining: 1 };
  loadCampaignShell(u, 'hvap'); assert.equal(u.hvapAmmoRemaining, 1);
  loadCampaignShell(u, 'he'); assert.equal(u.hvapAmmoRemaining, 1, 'switching a partial round cannot create ammo');
  loadCampaignShell(u, 'hvap'); assert.equal(u.hvapAmmoRemaining, 1);
  assert.equal(loadCampaignShell(u, 'hvap'), true); assert.equal(u.hvapAmmoRemaining, 0);
  loadCampaignShell(u, 'hvap'); assert.equal(u.hvapAmmoRemaining, 0, 'already completed round is not charged twice');
  loadCampaignShell(u, 'smoke'); assert.equal(u.hvapAmmoRemaining, 1); assert.equal(u.smokeAmmoRemaining, 1);
  loadCampaignShell(u, 'ap'); assert.equal(u.smokeAmmoRemaining, 1, 'switching partial smoke cannot create ammo');
  loadCampaignShell(u, 'smoke'); assert.equal(u.smokeAmmoRemaining, 1);
  loadCampaignShell(u, 'smoke'); assert.equal(u.smokeAmmoRemaining, 0); assert.equal(u.loaded, true);
  loadCampaignShell(u, 'ap'); assert.equal(u.smokeAmmoRemaining, 1); assert.equal(u.reloadProgress, 1);
});

test('failed finite-ammo loading leaves chamber and progress unchanged', () => {
  const u = { ...tank(), hvapAmmoRemaining: 0, smokeAmmoRemaining: 0 };
  loadCampaignShell(u, 'ap'); const before = { ...u };
  assert.equal(loadCampaignShell(u, 'hvap'), false); assert.deepEqual(u, before);
  assert.equal(loadCampaignShell(u, 'smoke'), false); assert.deepEqual(u, before);
});

test('upgrade stock initialization distinguishes partial and completed HVAP', () => {
  const { applyCampaignUpgradesToSherman } = require('../assets/scripts/core/CampaignUpgrade.ts');
  for (const progress of [1, 2]) {
    const u = { ...tank(), loadedShell:'hvap', reloadProgress:progress, loaded:progress===2 };
    applyCampaignUpgradesToSherman(u, ['hvap']);
    assert.equal(u.hvapAmmoRemaining, progress===2 ? 1 : 2);
  }
});

test('AI progress ignores shell type and classic readiness only uses loaded', () => {
  const u = tank();
  assert.equal(reloadAIMainGun(u), false);
  assert.equal(reloadAIMainGun(u), true);
  assert.equal(u.loadedShell, null);
  u.loaded = true; u.reloadProgress = 0;
  assert.equal(isMainGunLoaded(u, false), true); assert.equal(isMainGunLoaded(u, true), false);
  assert.equal(isMainGunLoaded({ loaded: true }, true), true);
});

test('AI ambush requires prior loading and cannot reload implicitly', () => {
  const u = { ...tank(), kind: 'sherman', stats: { ...getUnitStats('sherman'), reloadDifficulty: 2 } };
  assert.equal(enterAmbush(u, 'hardcore', true), false);
  assert.equal(u.reloadProgress, undefined);
  reloadAIMainGun(u); assert.equal(enterAmbush(u, 'hardcore', true), false);
  reloadAIMainGun(u); assert.equal(enterAmbush(u, 'hardcore', true), true);
});

test('save roundtrip preserves partial player and AI loading', () => {
  const data = JSON.parse(fs.readFileSync('assets/resources/missions/mission_03.json', 'utf8'));
  const mission = loadMission(data);
  Object.assign(mission.sherman, { loaded: false, loadedShell: 'he', reloadProgress: 1 });
  Object.assign(mission.enemies[0], { loaded: false, loadedShell: null, reloadProgress: 1 });
  const save = captureSave({ gameMode: 'hardcore', missionId: data.id, mission, turn: 1, phase: 'player', movesLeft: 2, attacksLeft: 1, miscDone: false, playerStep: 'choose', hatchChangedThisTurn: false, phaseDice: [] });
  const restored = loadMission(data);
  assert.equal(applySave(restored, data.id, save).ok, true);
  for (const u of [restored.sherman, restored.enemies[0]]) {
    u.stats = { ...u.stats, reloadDifficulty: 2 };
    assert.equal(mainGunReloadProgress(u), 1); assert.equal(isMainGunLoaded(u, true), false);
  }
  assert.equal(restored.sherman.loadedShell, 'he');
  assert.equal(canEnterAmbush(restored.sherman, 'hardcore'), false);
  assert.equal(canEnterAmbush(restored.enemies[0], 'hardcore', true), false);
});

test('partial finite rounds survive save and restore without premature or duplicate deductions', () => {
  const data = JSON.parse(fs.readFileSync('assets/resources/missions/mission_03.json', 'utf8'));
  data.playerTank = undefined;
  data.sherman.kind = 'tigerking';
  for (const shell of ['hvap', 'smoke']) {
    const mission = loadMission(data);
    Object.assign(mission.sherman, { hvapAmmoRemaining:2, smokeAmmoRemaining:7 });
    loadCampaignShell(mission.sherman, shell);
    const params = { gameMode:'hardcore', missionId:data.id, mission, turn:1, phase:'player', movesLeft:2, attacksLeft:1, miscDone:false, playerStep:'choose', hatchChangedThisTurn:false, phaseDice:[] };
    const save = captureSave(params), restored = loadMission(data);
    assert.equal(applySave(restored,data.id,save).ok,true);
    const field = shell==='hvap' ? 'hvapAmmoRemaining' : 'smokeAmmoRemaining';
    const stock = shell==='hvap' ? 2 : 7;
    assert.equal(restored.sherman[field],stock);
    loadCampaignShell(restored.sherman,shell); assert.equal(restored.sherman[field],stock-1);
    const old = JSON.parse(JSON.stringify(save)); old.version=11;
    old.sherman[field]=stock-1; if (old.playerTank) old.playerTank[field]=stock-1;
    const migrated = loadMission(data);
    assert.equal(applySave(migrated,data.id,old).ok,true);
    assert.equal(migrated.sherman[field],stock, 'refund ammo booked by the old partial-loading rule');
    loadCampaignShell(migrated.sherman,shell); assert.equal(migrated.sherman[field],stock-1);
  }
});

test('legacy partially loaded M26 becomes complete after difficulty drops to one without refunding its paid round', () => {
  const data = JSON.parse(fs.readFileSync('assets/resources/missions/mission_03.json', 'utf8'));
  data.playerTank = undefined; data.sherman.kind = 'm26_pershing';
  const mission = loadMission(data);
  Object.assign(mission.sherman, { loaded:false, loadedShell:'hvap', reloadProgress:1, hvapAmmoRemaining:1 });
  const save = captureSave({ gameMode:'hardcore', missionId:data.id, mission, turn:1, phase:'player', movesLeft:2, attacksLeft:1, miscDone:false, playerStep:'choose', hatchChangedThisTurn:false, phaseDice:[] });
  save.version = 11;
  const restored = loadMission(data);
  assert.equal(applySave(restored,data.id,save).ok,true);
  assert.equal(isMainGunLoaded(restored.sherman,true),true);
  assert.equal(restored.sherman.hvapAmmoRemaining,1);
  loadCampaignShell(restored.sherman,'hvap'); assert.equal(restored.sherman.hvapAmmoRemaining,1);
});

test('partial mission-authored smoke retains the full default reserve', () => {
  const data = JSON.parse(fs.readFileSync('assets/resources/missions/mission_03.json', 'utf8'));
  data.playerTank = undefined;
  Object.assign(data.sherman, { kind:'tigerking', loaded:false, loadedShell:'smoke', reloadProgress:1 });
  delete data.sherman.smokeAmmoRemaining;
  const mission = loadMission(data);
  assert.equal(mission.sherman.smokeAmmoRemaining,7);
  loadCampaignShell(mission.sherman,'smoke');
  assert.equal(mission.sherman.smokeAmmoRemaining,6);
});

test('player single and paired loading actions defer charging, and unavailable ammo consumes no dice', () => {
  const scene = fs.readFileSync('assets/scripts/view/BattleScene.ts','utf8');
  const src = ts.createSourceFile('BattleScene.ts',scene,ts.ScriptTarget.Latest,true);
  const cls = src.statements.find(s => ts.isClassDeclaration(s) && s.name?.text==='BattleScene');
  const names=['tryReload','tryDoublesLoaderReload','reloadActionUnavailable','dieStep'];
  const methods=cls.members.filter(m => names.includes(m.name?.getText(src))).map(m=>m.getText(src)).join('\n');
  const { resolvedLoadedShell } = require('../assets/scripts/core/types.ts');
  const code=ts.transpileModule('class Harness {'+methods+'}',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const Harness = new Function('GameSession','isMainGunLoaded','resolvedLoadedShell','loadCampaignShell','classifyAttackDie','playCannonReload','t',code+';return Harness;')(
    {gameMode:'hardcore'},isMainGunLoaded,resolvedLoadedShell,loadCampaignShell,()=> 'reload',()=>{},x=>x);
  for (const action of ['tryReload','tryDoublesLoaderReload']) {
    const u={...tank(),hvapAmmoRemaining:1,smokeAmmoRemaining:0}, h=new Harness(); let spent=0;
    Object.assign(h,{mission:{sherman:u},phaseDice:[{pip:1,used:false}],playerStep:'attack',
      checkCrewAlive:()=>true,campaignUpgradeActive:()=>true,consumeDoubles:()=>{spent+=2;return true;},usePhaseDice:()=>spent++,
      closeDiePopover:()=>{},refreshPhaseUI:()=>{},updateHUD:()=>{},redraw:()=>{},refreshStatusPanel:()=>{},
      completePhaseDiceAction:()=>{},battleLog:()=>{},mainGunLoadingLabel:()=>''});
    h[action](0,'hvap');assert.equal(u.reloadProgress,1);assert.equal(u.hvapAmmoRemaining,1);
    h[action](0,'hvap');assert.equal(u.reloadProgress,2);assert.equal(u.hvapAmmoRemaining,0);
    const spentBefore=spent;
    h[action](0,'smoke');assert.equal(spent,spentBefore,'no smoke ammo must not spend a single or paired die');
  }
});
