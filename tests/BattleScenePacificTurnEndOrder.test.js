const assert = require('node:assert/strict');
const test = require('node:test');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
const Scene = sceneMethods(['maybeBeginTurnEndEventOrEndEnemyPhase','continueAfterTurnEndEvent','runNextRoundEvent','finishTurnEvent','onUsCasualtyConfirmClick'], {
  GameSession:{ isPvp:false },
  roundEventsForTurn:(events,turn)=>(events??[]).filter(e=>!e.turns||e.turns==='every'||e.turns.includes(turn)),
  roundEventConditionMet:(e,weather)=> e.effectType !== 'airborne_support' || weather === 'clear',
});
function fixture(events=[], pacific=false) {
  const scene=new Scene(); const calls=[];
  Object.assign(scene,{mission:{data:{weather:'clear',roundEvents:events}},turn:1,outcome:'ongoing',casualtyCheckedTurn:-1,airborneReactionTurn:-1,airborneReacted:new Set(), roundEventQueue:[],roundEventDone:null,
    pauseAIFlowForCombatLogReplay:()=>false, clearActiveActingUnit:()=>{},redraw:()=>{},updateHUD:()=>{},updateOutcomeOverlay:()=>{},computeOutcome:()=> 'ongoing',currentTurnEndMissionId:()=> 'mission',
    turnEndEventProvider:{has:()=>true}, endEnemyPhase:()=>calls.push('next round'),
    startTurnEndEventFlow:(_id,event)=>calls.push(event?.effectType??'random'),
    beginPacificUsCasualtyCheckOrContinue:()=>{if(pacific) calls.push('casualty');return pacific;},
  });return {scene,calls};
}
test('Pacific casualty confirmation continues through random and all scheduled events',()=>{
  const {scene,calls}=fixture([{effectType:'none'},{effectType:'airborne_support',turns:[1,3,5]},{effectType:'none',turns:[2]}],true);
  scene.maybeBeginTurnEndEventOrEndEnemyPhase(); assert.deepEqual(calls,['casualty']);
  scene.usCasualtyEventUI={stage:'hold'};
  scene.applyUsCasualtyEventUI=()=>{};scene.destroyUsCasualtyEventUI=()=>{};
  scene.onUsCasualtyConfirmClick();assert.deepEqual(calls,['casualty','random']);
  scene.finishTurnEvent();assert.deepEqual(calls,['casualty','random','none']);
  scene.finishTurnEvent();assert.deepEqual(calls,['casualty','random','none','airborne_support']);
  scene.finishTurnEvent();assert.deepEqual(calls,['casualty','random','none','airborne_support','next round']);
});
test('no random table and no round events skips directly to next round',()=>{
  const {scene,calls}=fixture();scene.turnEndEventProvider.has=()=>false;
  scene.maybeBeginTurnEndEventOrEndEnemyPhase();assert.deepEqual(calls,['next round']);
});
test('unsuitable weather skips airborne but executes other matching events',()=>{
  const {scene,calls}=fixture([{effectType:'airborne_support'},{effectType:'none'}]);scene.mission.data.weather='rain';
  scene.continueAfterTurnEndEvent();assert.deepEqual(calls,['none']);
  scene.finishTurnEvent();assert.deepEqual(calls,['none','next round']);
});
