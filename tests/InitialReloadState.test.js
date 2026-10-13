const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { initialMainGunLoadingState, isMainGunLoaded, reloadAIMainGun } = require('../assets/scripts/core/types.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { carryPlayerTankToNextSegment } = require('../assets/scripts/core/CampaignRuntime.ts');
const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
const { prepareTurnEndEvent } = require('../assets/scripts/core/TurnEndEventApply.ts');
function data() {
  const d = JSON.parse(fs.readFileSync('assets/resources/missions/mission_03.json','utf8'));
  delete d.playerTank; d.enemyStartByDice=false;
  d.enemies=[{kind:'is2',at:{col:6,row:4},facing:3}];
  d.allies=[{kind:'tigerking',at:{col:7,row:4},facing:3}];
  d.sherman.kind='sturmtiger';
  return d;
}

test('initial loading follows projectile strengths with AP winning ties', () => {
  assert.deepEqual(initialMainGunLoadingState(getUnitStats('sturmtiger')), { loaded:false, loadedShell:'he', reloadProgress:7 });
  assert.deepEqual(initialMainGunLoadingState(getUnitStats('sherman')), { loaded:false, loadedShell:'ap', reloadProgress:0 });
  assert.equal(initialMainGunLoadingState(getUnitStats('tigerking')).loadedShell,'ap');
});

test('hardcore starts player, allied, and enemy units one loading action short without spending ammo', () => {
  const d=data(); Object.assign(d.sherman,{loaded:true,loadedShell:'hvap',reloadProgress:8,hvapAmmoRemaining:2});
  const mission=loadMission(d,undefined,{hardcore:true});
  for (const u of [mission.sherman,...mission.allies,...mission.enemies]) {
    assert.equal(u.reloadProgress,u.stats.reloadDifficulty-1); assert.equal(isMainGunLoaded(u,true),false);
    const initialShell=u.loadedShell;
    assert.equal(reloadAIMainGun(u),true,'exactly one additional loading action completes the round');
    assert.equal(u.loadedShell,initialShell,'AI loading does not change the selected initial shell');
  }
  assert.equal(mission.sherman.hvapAmmoRemaining,2);
});

test('campaign continuation preserves empty, partial, and complete player chambers while initializing other entrants', () => {
  for (const [progress,shell] of [[0,null],[1,'hvap'],[2,'he'],[4,'smoke']]) {
    const d=data();
    const current={kind:'su152',at:d.sherman.at,facing:0,loaded:progress===4,loadedShell:shell,reloadProgress:progress,smokeAmmoRemaining:6};
    d.sherman=carryPlayerTankToNextSegment(current,d.sherman);
    const mission=loadMission(d,undefined,{hardcore:true,preservePlayerReload:true});
    assert.equal(mission.sherman.reloadProgress,progress);assert.equal(mission.sherman.loadedShell,shell);
    assert.equal(mission.sherman.loaded,progress===4); assert.equal(mission.sherman.smokeAmmoRemaining,6);
    assert.equal(mission.enemies[0].reloadProgress,2);
    assert.equal(mission.allies[0].reloadProgress,1);
  }
});

test('save restoration overrides the fresh entrant default with the saved progress', () => {
  const mission=loadMission(data(),undefined,{hardcore:true});
  Object.assign(mission.sherman,{reloadProgress:1,loadedShell:'ap',loaded:false});
  const save=captureSave({gameMode:'hardcore',missionId:mission.data.id,mission,turn:1,phase:'player',movesLeft:2,attacksLeft:1,miscDone:false,playerStep:'choose',hatchChangedThisTurn:false,phaseDice:[]});
  const restored=loadMission(data(),undefined,{hardcore:true});
  assert.equal(restored.sherman.reloadProgress,7);
  assert.equal(applySave(restored,restored.data.id,save).ok,true);
  assert.equal(restored.sherman.reloadProgress,1);assert.equal(restored.sherman.loadedShell,'ap');
});

test('both friendly and hostile event reinforcements receive initial loading state', () => {
  for (const side of ['friendly','enemy']) {
    const tile={pos:{q:0,r:0},terrain:'field',enemyStartId:1,enemyStartFacing:0};
    const mission={data:{id:'mission_01',theater:'europe'},map:{all:()=>[tile],has:()=>false,canTankEnter:()=>false},sherman:{pos:{q:4,r:0},stats:getUnitStats('sherman')},allies:[],enemies:[]};
    const prepared=prepareTurnEndEvent({missionId:'mission_01',sumMin:1,sumMax:12,diceCount:2,effectType:'tiger_spawn',reinforcementSide:side},[1,1],2,{mission,rng:{d6:()=>1},nextEnemyId:()=> 'new-tiger',hardcoreReload:true});
    prepared.apply();
    const u=(side==='friendly'?mission.allies:mission.enemies)[0];
    assert.ok(u);assert.equal(u.reloadProgress,u.stats.reloadDifficulty-1);
    assert.equal(u.loadedShell,'ap');assert.equal(u.loaded,false);
  }
});

test('classic mission loading keeps authored chamber state', () => {
  const d=data();Object.assign(d.sherman,{loaded:true,loadedShell:'ap',reloadProgress:8});
  const u=loadMission(d,undefined,{hardcore:false}).sherman;
  assert.equal(u.loaded,true);assert.equal(u.reloadProgress,8);assert.equal(u.loadedShell,'ap');
});

test('scene campaign transition requests chamber preservation and PVP initialization uses fresh entry rules', () => {
  const scene=fs.readFileSync('assets/scripts/view/BattleScene.ts','utf8');
  const source=ts.createSourceFile('BattleScene.ts',scene,ts.ScriptTarget.Latest,true);
  const cls=source.statements.find(s=>ts.isClassDeclaration(s)&&s.name?.text==='BattleScene');
  const methods=['advanceCampaignSegment','pvpInitialUnit'].map(name=>cls.members.find(m=>m.name?.getText(source)===name).getText(source)).join('\n');
  const code=ts.transpileModule('class Harness {'+methods+'}',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const Harness=new Function('GameSession','carryPlayerTankToNextSegment','initialMainGunLoadingState','getUnitStats',code+';return Harness;')({gameMode:'hardcore'},carryPlayerTankToNextSegment,initialMainGunLoadingState,getUnitStats);
  const h=new Harness();h.mission={};h.activeCampaignSegmentIndex=0;h.campaignRuntime={segmentMissionData:[{},data()]};
  h.currentShermanCampaignPlacement=()=>({kind:'su152',reloadProgress:1,loadedShell:'hvap',loaded:false});
  h.campaignUpgradeActive=()=>false;h.cloneMissionData=d=>JSON.parse(JSON.stringify(d));
  h.battleLogI18n=()=>{};h.startCampaignPanToSegment=()=>{};
  h.loadAndDraw=(next,opts)=>{assert.equal(opts.preservePlayerReload,true);assert.equal(next.sherman.reloadProgress,1);assert.equal(next.sherman.loadedShell,'hvap');};
  h.advanceCampaignSegment();
  const pvp=h.pvpInitialUnit('new-support','odd','germany','support','sturmtiger',0,0,0);
  assert.equal(pvp.reloadProgress,7);assert.equal(pvp.loadedShell,'he');assert.equal(pvp.loaded,false);
});
