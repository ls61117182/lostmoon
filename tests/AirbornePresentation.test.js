const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions:{ target:ts.ScriptTarget.ES2019,module:ts.ModuleKind.CommonJS } }).outputText, filename);
const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { airborneReactionContext, landAirborneUnit } = require('../assets/scripts/core/AirborneSupport.ts');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
class Node {
  constructor(name) { this.name=name;this.children=[];this.components=new Map();this.position={x:0,y:0};this.isValid=true;this.active=true; }
  addChild(node) { this.children.push(node); }
  addComponent(Type) { const component=new Type();this.components.set(Type,component);return component; }
  getComponent(Type) { return this.components.get(Type); }
  setPosition(x,y) { this.position={x,y}; }
  setSiblingIndex() {}
  destroy() { this.isValid=false; }
}
class UITransform { setContentSize(width,height) { this.width=width;this.height=height; } }
class Sprite { static SizeMode={CUSTOM:1}; }
class UIOpacity { opacity=255; }
const GameSession={gameMode:'hardcore'};
const Scene=sceneMethods(['playAirborneSupport','advanceAirborneSupport','isBusy','positionMapScreenNode','mapScreenOffset'],{
  Node,UITransform,Sprite,UIOpacity,GameSession,CANVAS_W:1280,CANVAS_H:720,
  getGameModeConfig:()=>({expandedTurretDirections:true}),
  airborneReactionContext,landAirborneUnit,
  rollMGAttack:()=>({dice:[1,0],hitDiceCount:1,hitBonus:0,roll:1,threshold:4,hit:false}),
  t:key=>key,unitDisplayName:kind=>kind,playC47Flyover:()=>{},
});
function unit(id,kind,q,r,side) { const stats=getUnitStats(kind);return {id,kind,stats,faction:stats.faction,sideId:side,pos:{q,r},facing:0,turretFacing:0}; }
function setup(side='friendly', reactions=false, flyoverOnly=false) {
  const map=new HexMap(7,7);for(let q=0;q<7;q++)for(let r=0;r<7;r++) map.set({pos:{q,r},terrain:'field'});
  const mission={data:{weather:'clear',theater:'europe'},map,smokeHexes:new Set(),sherman:unit('player','sherman',0,0,'player'),allies:[],enemies:[]};
  if(reactions) mission.enemies=[unit('enemy1','infantry',2,3,'enemy'),unit('enemy2','infantry',3,2,'enemy')];
  const plan={side,target:{q:3,r:3},units:[unit('drop1','american_infantry',3,3,side==='friendly'?'player':'enemy'),unit('drop2','american_infantry',4,3,side==='friendly'?'player':'enemy'),unit('drop3','american_infantry',3,4,side==='friendly'?'player':'enemy')]};
  if (flyoverOnly) { mission.data.weather = 'fog'; plan.units = []; }
  const scene=new Scene();const completed=[];const attacks=[];
  Object.assign(scene,{mission,node:new Node('scene'),mapNode:new Node('map'),hexSize:50,airborneFlight:null,diceShow:null,airborneReacted:new Set(),c47SpriteFrame:{},parachuteSpriteFrame:{},eventPhase:'round',
    project:(q,r)=>({x:(q+r/2)*50-225,y:r*40-120}),isEffectiveBattleTile:()=>true,
    allUnits:()=>[mission.sherman,...mission.allies,...mission.enemies],redraw:()=>{},refreshStatusPanel:()=>{},battleLog:()=>{},battleLogI18n:()=>{},combatLogUnitTone:()=>'',mgDiceExpr:()=>'',
    applyMachineGunAttackResult:()=>{},registerImpactDestroyWreckVisual:()=>{},
    startDiceShow:(_report,_a,_t,onDone,options)=>{attacks.push(options.attacker.id);scene.diceShow={onDone};},
    terrainSpriteBatchReady:true,turnTransition:null,campaignPanAnim:null,campaignUpgradeChoiceRoot:null,campaignUpgradeDetailRoot:null,anim:null,playerDiceRollAnim:null,playerDiceSortAnim:null,turretAimAnim:null,precisionAimHoldCallback:null,enemyDiceSortAnim:null,enemyDiceResultHold:null,turnEndEventUI:null,fireCheckEventUI:null,usCasualtyEventUI:null,tileInspectModalRoot:null,
  });
  scene.playAirborneSupport(plan,()=>completed.push(true));return {scene,mission,plan,completed,attacks};
}
test('flight reverses for enemy; drops start from moving aircraft, 0.3 seconds apart',()=>{
  for(const side of ['friendly','enemy']) {
    const {scene,mission,completed}=setup(side);
    const flight=scene.airborneFlight;
    assert(side==='friendly'?flight.fromX<flight.toX:flight.fromX>flight.toX);
    assert.equal(flight.plane.angle,side==='friendly'?-90:90);
    assert(scene.isBusy());assert.equal(mission.allies.length+mission.enemies.length,0);
    scene.advanceAirborneSupport(flight.dropT+0.61);
    assert.equal(flight.drops.length,3);
    assert(Math.abs(flight.drops[1].startT-flight.drops[0].startT-0.3)<1e-9);
    assert(Math.abs(flight.drops[2].startT-flight.drops[1].startT-0.3)<1e-9);
    assert.notEqual(flight.drops[0].startX,flight.drops[1].startX);
    for(let i=0;i<80 && scene.airborneFlight;i++) scene.advanceAirborneSupport(0.1);
    assert.equal(completed.length,1);
    assert.equal((side==='friendly'?mission.allies:mission.enemies).length,3);
    assert.equal(flight.root.isValid,false);
  }
});
test('each enemy reacts once; next event waits for final MG resolution and fade',()=>{
  const {scene,completed,attacks,mission}=setup('friendly',true);
  const before=JSON.stringify(mission.enemies);
  for(let i=0;i<80;i++) scene.advanceAirborneSupport(0.1);
  assert.equal(completed.length,0,'cannot advance while a landing attack is unresolved');
  assert.equal(mission.allies.length,3);assert.equal(attacks.length,1);
  for(let i=0;i<50 && scene.airborneFlight;i++) {
    if(scene.diceShow) { const done=scene.diceShow.onDone;scene.diceShow=null;done(); }
    scene.advanceAirborneSupport(0.1);
  }
  assert.equal(completed.length,1);
  assert.equal(new Set(attacks).size,2);assert.equal(attacks.length,2);
  assert.equal(JSON.stringify(mission.enemies),before,'reaction does not spend actions, ammunition or turn turret');
});

test('bad-weather transport flies across the map with no parachutes, landings or reactions',()=>{
  for (const side of ['friendly', 'enemy']) {
    const {scene,mission,completed,attacks}=setup(side,true,true);
    const flight=scene.airborneFlight;
    const before=JSON.stringify([mission.sherman,mission.allies,mission.enemies]);
    const startX=flight.plane.position.x;
    scene.advanceAirborneSupport(2);
    assert.notEqual(flight.plane.position.x,startX);
    assert.equal(completed.length,0);
    assert.equal(flight.drops.length,0);
    assert.equal(flight.root.children.length,1,'only the aircraft is drawn');
    scene.advanceAirborneSupport(2);
    assert.equal(completed.length,1);
    assert.equal(flight.root.isValid,false);
    assert.deepEqual(attacks,[]);
    assert.equal(JSON.stringify([mission.sherman,mission.allies,mission.enemies]),before);
  }
});
