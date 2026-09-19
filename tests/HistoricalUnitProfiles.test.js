const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const types = require('../assets/scripts/core/types.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { actionDicePool } = require('../assets/scripts/core/ActionDice.ts');
const { actionForHardcoreTankDie, hardcoreAttackDieIsInvalid } = require('../assets/scripts/core/EnemyAI.ts');
const { resolveCrewCheck, killCrewSlot } = require('../assets/scripts/core/Combat.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
function unit(kind) { const stats = getUnitStats(kind, 'europe'); return { kind, stats, crew: types.createTankCrew(stats), faction: stats.faction }; }
function pool(kind, terrain='road') { const u=unit(kind); return actionDicePool({ subPhase:'attack', terrain, hatchOpen:true, hardcore:true, crew:types.effectiveTankCrew(u), firepower:u.stats.firepower }); }
test('player firepower changes dice count, preserving terrain and a one-die minimum', () => {
  assert.equal(pool('sherman'), 5);
  assert.equal(pool('sherman', 'mud'), 4);
  assert.equal(pool('m26_pershing'), 4);
  assert.equal(pool('m26_pershing', 'mud'), 3);
  assert.equal(pool('su152'), 2);
  assert.equal(pool('su152', 'beach'), 1);
  assert.equal(pool('t34'), 3, 'combined commander/gunner is an available duty; no extra efficiency penalty');
});
test('AI invalidates high faces without changing movement/misc actions', () => {
  for(let pip=1;pip<=6;pip++) assert.equal(hardcoreAttackDieIsInvalid(pip,-1,5), pip>4);
  const tiger=unit('tiger');
  assert.equal(actionForHardcoreTankDie(tiger,'attack',6).primary,'none');
  assert.equal(actionForHardcoreTankDie(tiger,'attack',5).primary,'shoot');
  assert.equal(actionForHardcoreTankDie(tiger,'attack',5,-1).primary,'none');
  assert.notEqual(actionForHardcoreTankDie(tiger,'move',6,-2).primary,'none');
  assert.equal(hardcoreAttackDieIsInvalid(1,-2,1),true);
  assert.equal(hardcoreAttackDieIsInvalid(6,2,6),false);
});
test('real physical rosters and shared duties survive casualties', () => {
  for(const [kind,count] of Object.entries({sherman:5,t34:4,t34_85:5,type95:3,type97:4,stug3:4,su152:5,maus:6})) {
    const u=unit(kind); assert.equal(u.stats.crewMembers.length,count); assert.equal(Object.values(u.crew).filter(Boolean).length,count);
  }
  const ha=unit('type95');
  assert.equal(ha.crew.gunner,false); assert.equal(types.crewRoleAlive(ha,'gunner'),true); assert.equal(types.crewRoleAlive(ha,'loader'),true);
  killCrewSlot(ha.crew,1);
  assert.equal(types.crewRoleAlive(ha,'gunner'),false); assert.equal(types.crewRoleAlive(ha,'loader'),false);
  const su=unit('su152'); assert.equal(su.crew.coDriver,false);
  killCrewSlot(su.crew,3); assert.equal(types.crewRoleAlive(su,'loader'),true);
  killCrewSlot(su.crew,6); assert.equal(types.crewRoleAlive(su,'loader'),false);
});
test('sixth person can be hit and keep a tank crewed; absent slots are not casualties', () => {
  const maus=unit('maus'); assert.equal(resolveCrewCheck(maus,{d6:()=>6}).slot,6);
  for(const slot of [1,2,3,4,5]) killCrewSlot(maus.crew,slot);
  assert.equal(types.hasLivingTankCrew(maus),true);
  killCrewSlot(maus.crew,6); assert.equal(types.hasLivingTankCrew(maus),false);
  const ha=unit('type95'); const dice=[2,3,4]; assert.equal(resolveCrewCheck(ha,{d6:()=>dice.shift()}).slot,4);
});
function scenario() {
 const data=JSON.parse(fs.readFileSync('assets/resources/missions/mission_03.json','utf8'));
 data.id='historical_unit_test';data.theater='europe';data.enemyStartByDice=false;
 data.enemies=[{kind:'type95',at:{col:6,row:4},facing:3},{kind:'maus',at:{col:7,row:4},facing:3}];
 return loadMission(data);
}
test('mission loading and save roundtrip retain physical crews and second loader deaths', () => {
 const mission=scenario(); const ha=mission.enemies.find(u=>u.kind==='type95'), maus=mission.enemies.find(u=>u.kind==='maus');
 assert.equal(Object.values(ha.crew).filter(Boolean).length,3);killCrewSlot(ha.crew,1);killCrewSlot(maus.crew,6);
 const save=captureSave({gameMode:'hardcore',missionId:mission.data.id,mission,turn:1,phase:'player',movesLeft:2,attacksLeft:1,miscDone:false,playerStep:'choose',hatchChangedThisTurn:false,phaseDice:[]});
 const restored=scenario(); assert.equal(applySave(restored,restored.data.id,save).ok,true);
 assert.equal(restored.enemies.find(u=>u.kind==='maus').crew.secondLoader,false);
 assert.equal(types.crewRoleAlive(restored.enemies.find(u=>u.kind==='type95'),'gunner'),false);
});
test('ordinary European M26 and Sherman baseline are preserved in generated profiles', () => {
 const m=getUnitStats('m26_pershing');assert.deepEqual([m.penetration,m.highExplosivePower,m.effectiveRange,m.firepower],[5,3,4,5]);
 for(const theater of ['europe','pacific']) { const s=getUnitStats('sherman',theater);assert.deepEqual([s.armorFront,s.armorFrontSide,s.armorRearSide,s.armorRear,s.penetration,s.firepower],[11,10,9,8,2,6]); }
});
test('player scene feeds firepower to the pool and does not discard high dice', () => {
 const scene=fs.readFileSync('assets/scripts/view/BattleScene.ts','utf8');
 assert.match(scene,/firepower: sherman.stats.firepower/);assert.doesNotMatch(scene,/playerAttackDieInvalid/);
});

test('support artillery firepower gate uses the same AI threshold', () => {
 const vm=require('node:vm');const source=ts.createSourceFile('BattleScene.ts',fs.readFileSync('assets/scripts/view/BattleScene.ts','utf8'),ts.ScriptTarget.Latest,true);
 const cls=source.statements.find(s=>ts.isClassDeclaration(s)&&s.name?.text==='BattleScene');
 const method=cls.members.find(m=>m.name?.getText(source)==='supportGunFirepowerAllows').getText(source);
 const js=ts.transpileModule('class Host {'+method+'}',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const Host=vm.runInNewContext(js+';Host',{hardcoreAttackDieIsInvalid,effectiveDiceTerrain:tile=>tile.terrain,PLAYER_HARDCORE_DICE_POOL:{baseByPhaseTerrain:{attack:{field:0,mud:-1}}},t:()=>'',unitDisplayName:k=>k});
 const host=new Host();let terrain='field',pip=4;
 host.mission={map:{get:()=>({terrain})}};host.rng={d6:()=>pip};host.battleLog=()=>{};
 const gun=unit('heavy_artillery');assert.equal(host.supportGunFirepowerAllows(gun),false);
 pip=3;assert.equal(host.supportGunFirepowerAllows(gun),true);
 terrain='mud';assert.equal(host.supportGunFirepowerAllows(gun),false);
});
