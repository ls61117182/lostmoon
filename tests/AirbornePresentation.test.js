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
  addChild(node) { this.children.push(node);node.parent=this; }
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
const Scene=sceneMethods(['playAirborneSupport','advanceAirborneSupport','applyMapViewPosition','isBusy','positionMapScreenNode','mapScreenOffset',
  'requestCombatLogReplay','openPendingCombatLogReplayIfReady','finishCombatLogReplay','pauseAIFlowForCombatLogReplay',
  'finishTurnEvent','runNextRoundEvent','endEnemyPhase','onTurnEndConfirmClick','destroyTurnEndEventUI'],{
  Node,UITransform,Sprite,UIOpacity,GameSession,CANVAS_W:1280,CANVAS_H:720,
  getGameModeConfig:()=>({expandedTurretDirections:true}),
  airborneReactionContext,landAirborneUnit,
  rollMGAttack:()=>({dice:[1,0],hitDiceCount:1,hitBonus:0,roll:1,threshold:4,hit:false}),
  t:key=>key,unitDisplayName:kind=>kind,playC47Flyover:()=>{},
  clearLockedFire:()=>{},advanceAttackPositionMemory:()=>{},roundEventConditionMet:()=>true,
});
function unit(id,kind,q,r,side) { const stats=getUnitStats(kind);return {id,kind,stats,faction:stats.faction,sideId:side,pos:{q,r},facing:0,turretFacing:0}; }
function setup(side='friendly', reactions=false, flyoverOnly=false, view={}) {
  const map=new HexMap(7,7);for(let q=0;q<7;q++)for(let r=0;r<7;r++) map.set({pos:{q,r},terrain:'field'});
  const mission={data:{weather:'clear',theater:'europe'},map,smokeHexes:new Set(),sherman:unit('player','sherman',0,0,'player'),allies:[],enemies:[]};
  if(reactions) mission.enemies=[unit('enemy1','infantry',2,3,'enemy'),unit('enemy2','infantry',3,2,'enemy')];
  const plan={side,target:{q:3,r:3},units:[unit('drop1','american_infantry',3,3,side==='friendly'?'player':'enemy'),unit('drop2','american_infantry',4,3,side==='friendly'?'player':'enemy'),unit('drop3','american_infantry',3,4,side==='friendly'?'player':'enemy')]};
  if (flyoverOnly) { mission.data.weather = 'fog'; plan.units = []; }
  const scene=new Scene();const completed=[];const attacks=[];
  const root=new Node('scene'),content=new Node('battlefield'),mapNode=new Node('map'),airSupportLayerNode=new Node('airSupport');
  root.scale=1.5;content.angle=view.rotation??0;mission.data.cameraRotation=view.rotation??0;
  root.addChild(content);content.addChild(mapNode);content.addChild(airSupportLayerNode);
  Object.assign(scene,{mission,node:root,battlefieldContentNode:content,mapNode,airSupportLayerNode,hexSize:50,airborneFlight:null,diceShow:null,airborneReacted:new Set(),c47SpriteFrame:{},parachuteSpriteFrame:{},eventPhase:'round',
    project:(q,r)=>({x:(q+r/2)*50-225,y:r*40-120}),isEffectiveBattleTile:()=>true,canHearBattleAt:()=>true,
    allUnits:()=>[mission.sherman,...mission.allies,...mission.enemies],redraw:()=>{},refreshStatusPanel:()=>{},battleLog:()=>{},battleLogI18n:()=>{},combatLogUnitTone:()=>'',mgDiceExpr:()=>'',
    applyMachineGunAttackResult:()=>{},registerImpactDestroyWreckVisual:()=>{},
    startDiceShow:(_report,_a,_t,onDone,options)=>{attacks.push(options.attacker.id);scene.diceShow={onDone};},
    terrainSpriteBatchReady:true,turnTransition:null,campaignPanAnim:null,campaignUpgradeChoiceRoot:null,campaignUpgradeDetailRoot:null,anim:null,playerDiceRollAnim:null,playerDiceSortAnim:null,turretAimAnim:null,precisionAimHoldCallback:null,enemyDiceSortAnim:null,enemyDiceResultHold:null,turnEndEventUI:null,fireCheckEventUI:null,usCasualtyEventUI:null,tileInspectModalRoot:null,
  });
  scene.applyMapViewPosition(view.panX??0,view.panY??0);
  scene.playAirborneSupport(plan,()=>completed.push(true));return {scene,mission,plan,completed,attacks};
}

function world(node,local={x:0,y:0}) {
  let point={...local};
  for(let current=node;current;current=current.parent) {
    const angle=(current.angle??0)*Math.PI/180,scale=current.scale??1;
    const x=point.x*scale,y=point.y*scale;
    point={x:current.position.x+x*Math.cos(angle)-y*Math.sin(angle),
      y:current.position.y+x*Math.sin(angle)+y*Math.cos(angle)};
  }
  return point;
}
function nearPoint(actual,expected,message) {
  assert(Math.hypot(actual.x-expected.x,actual.y-expected.y)<1e-8,message);
}

test('transport and parachutes remain anchored to the map during repeated pans, including rotated views',()=>{
  for(const rotation of [0,90]) for(const side of ['friendly','enemy']) {
    const {scene,plan}=setup(side,false,false,{rotation,panX:80,panY:-45});
    const flight=scene.airborneFlight;
    assert.equal(flight.root.parent,scene.airSupportLayerNode);
    assert.equal(flight.y,scene.project(plan.target.q,plan.target.r).y,'flight uses map-local height');
    scene.advanceAirborneSupport(flight.dropT+0.61);
    const actors=[flight.plane,...flight.drops.map(drop=>drop.node)];
    const localPositions=actors.map(actor=>({...actor.position}));
    const target=scene.project(plan.target.q,plan.target.r);
    const relative=actor=>{
      const a=world(actor),b=world(scene.mapNode,target);
      return {x:a.x-b.x,y:a.y-b.y};
    };
    const relativePositions=actors.map(relative);
    for(const [x,y] of [[-170,95],[240,-130],[80,-45]]) {
      scene.applyMapViewPosition(x,y);
      actors.forEach((actor,i)=>nearPoint(relative(actor),relativePositions[i],'camera movement preserves the actor offset from terrain immediately'));
      scene.advanceAirborneSupport(0);
      actors.forEach((actor,i)=>{
        nearPoint(actor.position,localPositions[i],'a stationary animation frame cannot drift when panning');
        nearPoint(relative(actor),relativePositions[i],'the next animation update keeps map alignment');
      });
    }
    const first=flight.drops[0];
    scene.advanceAirborneSupport(first.startT+1.8-flight.t+1e-6);
    assert.equal(first.landed,true);
    nearPoint(world(first.node),world(scene.mapNode,scene.project(first.unit.pos.q,first.unit.pos.r)),
      'the parachute meets the actual landing hex after panning');
  }
});
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

function historySetup(reactions=false,flyoverOnly=false) {
  const fixture=setup('friendly',reactions,flyoverOnly);
  const {scene}=fixture;
  const scheduled=[];
  const nextEvents=[];
  const attack=scene.startDiceShow;
  Object.assign(scene,{
    phase:'enemy',outcome:'ongoing',turn:1,pendingCombatLogReplay:null,combatLogReplayOpen:false,combatLogAIResume:null,
    roundEventQueue:[],roundEventDone:()=>scene.runNextRoundEvent(),
    isOutcomeBattlefieldReview:()=>false,computeOutcome:()=> 'ongoing',
    scheduleOnce:fn=>scheduled.push(fn),
    startDiceShow(report,a,target,done,options) {
      if (!options.showSettled) { attack(report,a,target,done,options); return; }
      scene.diceShow={onDone:done,historyReplay:true};
    },
    buildTurnEndEventPanel:()=>({root:new Node('History'),dieLabels:[{},{}],eventVerdictLabel:{},bodyLabel:{},confirmButton:{},extraRows:[]}),
    setDieLabelFace:()=>{},turnEndBodyText:()=> 'previous event',
    currentTurnEndMissionId:()=> 'mission',updateHUD:()=>{},
    startTurnEndEventFlow:(_id,event)=>nextEvents.push(event),
    clearDestroyWreckVisuals:()=>{},clearAIMoveState:()=>{},clearActiveActingUnit:()=>{},destroyEnemyDiceTray:()=>{},
    updateOutcomeOverlay:()=>{},writeCurrentSave:()=>{},
    showTurnTransition:(_faction,_phase,done)=>done(),beginPlayerPhaseForNewTurn:()=>{scene.phase='player';},
  });
  scene.airborneFlight.onDone=()=>scene.finishTurnEvent();
  const frame=()=>scheduled.splice(0).forEach(fn=>fn());
  const closeHistory=()=>{
    if(scene.turnEndEventUI) {
      assert.equal(scene.turnEndEventUI.historyReplay,true);
      scene.onTurnEndConfirmClick();
    } else {
      assert.equal(scene.diceShow?.historyReplay,true,'history result must be open');
      const done=scene.diceShow.onDone;
      scene.diceShow=null;
      done();
    }
    frame();
  };
  return {...fixture,scheduled,nextEvents,frame,closeHistory};
}

const historyAttack={kind:'attack',report:{hit:false},attackerKind:'infantry',targetKind:'american_infantry',mg:true};
const historyEvent={kind:'turnEnd',dice:[1,2],extraPhases:[],bodyKey:'previous',bodyParams:{},effectKey:'none'};

test('a history click during an airdrop opens after landing and resumes the next turn',()=>{
  for(const replay of [historyAttack,historyEvent]) for(const flyoverOnly of [false,true]) {
    const {scene,mission,closeHistory}=historySetup(false,flyoverOnly);
    scene.requestCombatLogReplay(replay);
    assert.equal(scene.combatLogReplayOpen,false,'wait for the flight and parachutes');
    for(let i=0;i<80 && scene.airborneFlight;i++) scene.advanceAirborneSupport(0.1);
    assert.equal(mission.allies.length,flyoverOnly?0:3);
    assert.equal(scene.airborneFlight,null);
    assert.equal(scene.combatLogReplayOpen,true,'event-phase context must not block history at the completed-event boundary');
    assert.equal(scene.turn,1,'next turn waits for history to close');
    assert.equal(scene.isBusy(),true,'normal game input remains blocked');
    closeHistory();
    assert.equal(scene.turn,2);
    assert.equal(scene.phase,'player');
    assert.equal(scene.eventPhase,null);
    assert.equal(scene.combatLogAIResume,null);
  }
});

test('history waits for all landing reactions and preserves the next scheduled event',()=>{
  const {scene,attacks,nextEvents,closeHistory}=historySetup(true);
  const nextEvent={effectType:'none'};
  scene.roundEventQueue.push(nextEvent);
  scene.requestCombatLogReplay(historyAttack);
  for(let i=0;i<100 && scene.airborneFlight;i++) {
    if(scene.diceShow) {
      assert.notEqual(scene.diceShow.historyReplay,true,'landing reactions finish before history opens');
      const done=scene.diceShow.onDone;scene.diceShow=null;done();
    }
    scene.advanceAirborneSupport(0.1);
    scene.openPendingCombatLogReplayIfReady();
  }
  assert.equal(attacks.length,2);
  assert.deepEqual(nextEvents,[],'next event must not start over the history panel');
  closeHistory();
  assert.deepEqual(nextEvents,[nextEvent]);
  assert.equal(scene.turn,1);
  scene.finishTurnEvent();
  assert.equal(scene.turn,2,'remaining queue completes exactly once');
});

test('closing event history retains its continuation while another animation is busy',()=>{
  const {scene,scheduled,frame,closeHistory}=historySetup();
  scene.requestCombatLogReplay(historyAttack);
  for(let i=0;i<80 && scene.airborneFlight;i++) scene.advanceAirborneSupport(0.1);
  scene.anim={};
  closeHistory();
  assert.equal(scene.turn,1);
  assert.equal(scheduled.length,1,'retry instead of dropping the saved continuation');
  scene.anim=null;
  frame();
  assert.equal(scene.turn,2);
  frame();
  assert.equal(scene.turn,2);
});
