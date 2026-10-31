const assert = require('node:assert/strict');
const fs = require('node:fs');
const {test} = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (m,file) => m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText,file);
const types = require('../assets/scripts/core/types.ts');
const hex = require('../assets/scripts/core/HexGrid.ts');
const combat = require('../assets/scripts/core/Combat.ts');
const {getUnitStats} = require('../assets/scripts/core/UnitDB.ts');
const {canExecuteAction,decideEnemyMove} = require('../assets/scripts/core/EnemyAI.ts');
const {limitTurretTraverse} = require('../assets/scripts/core/TurretTraverse.ts');
const {isMainGunSuppressionAttack} = require('../assets/scripts/core/Suppression.ts');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');
const gunKinds = ['at_gun','pak38','pak43','flak88'];
const flags = mask => Array.from({length:6},(_,d)=>(mask>>d)&1).join('');
const unit = (kind,pos={q:3,r:3}) => ({id:kind,kind,pos:{...pos},faction:getUnitStats(kind).faction,
  stats:getUnitStats(kind),facing:0,turretFacing:0});
function context(targetKind='german_infantry') {
  const map = new hex.HexMap(10,10);
  for(let q=0;q<10;q++)for(let r=0;r<10;r++)map.set({pos:{q,r},terrain:'field'});
  const target = unit(targetKind), attacker = unit('sherman',hex.neighbor(target.pos,4));
  attacker.stats={...attacker.stats,highExplosivePower:3};
  return {attacker,target,map,shellType:'he'};
}
function rng(dice=[4,5]) {
  let n=0;return {d6(){assert.ok(n<dice.length,'HE must not consume extra dice');return dice[n++]}};
}

test('HE protects infantry in both earthworks and AT gun bodies only in gun pits, for all 64 masks and six bearings',()=>{
  for(const kind of ['german_infantry',...gunKinds])for(const earthwork of ['trench','gun_pit']) {
    const ctx=context(kind),tile=ctx.map.get(ctx.target.pos);
    for(let mask=0;mask<64;mask++)for(let d=0;d<6;d++) {
      tile.fortification={kind:earthwork,connections:flags(mask)};
      ctx.attacker.pos=hex.neighbor(ctx.target.pos,d);
      const protectedShot=(kind==='german_infantry'||earthwork==='gun_pit') && !(mask&(1<<d));
      const report=combat.rollHighExplosiveAttack(ctx,rng());
      assert.equal(report.fortificationCoverValue,protectedShot?1:0,`${kind}, ${earthwork}, ${flags(mask)}, ${d}`);
      assert.equal(report.destroyThreshold,9+(protectedShot?1:0));
      assert.equal(report.destroyThreshold,combat.highExplosiveDestroyThreshold(ctx),'preview and resolution must agree');
      if(kind==='german_infantry')assert.equal(report.suppressThreshold,3,'trench must not raise suppression difficulty');
      else assert.equal(report.suppressThreshold,undefined,'gun-body HE still has no suppression result');
    }
  }
});

test('HE direction follows actual open arms, including off-axis, same-hex and mounted exceptions',()=>{
  const ctx=context(),tile=ctx.map.get(ctx.target.pos);
  tile.fortification={kind:'gun_pit',connections:'111100'};
  for(let d=0;d<6;d++) {
    ctx.attacker.pos=hex.neighbor(ctx.target.pos,d);
    assert.equal(combat.highExplosiveFortificationCoverValue(ctx),d<4?0:1);
  }
  ctx.attacker.pos={q:5,r:4};assert.equal(combat.highExplosiveFortificationCoverValue(ctx),1,'off-axis fire is not enfilade');
  assert.equal(combat.infantryHasHighExplosiveCover(ctx),true);
  ctx.attacker.pos={...ctx.target.pos};assert.equal(combat.highExplosiveFortificationCoverValue(ctx),0);
  ctx.attacker.pos=hex.neighbor(ctx.target.pos,4);ctx.target.mountedOnUnitId='tank';
  assert.equal(combat.highExplosiveFortificationCoverValue(ctx),0);
});

test('HE destruction changes at the boundary while ordinary infantry and gun crew suppression stay unchanged',()=>{
  for(const attached of [false,true])for(const earthwork of ['trench','gun_pit']) {
    const ctx=context(),tile=ctx.map.get(ctx.target.pos);
    if(attached)ctx.target.attachedToATGunId='gun';
    for(let a=1;a<=6;a++)for(let b=1;b<=6;b++) {
      delete tile.fortification;const plain=combat.rollHighExplosiveAttack(ctx,rng([a,b]));
      tile.fortification={kind:earthwork,connections:'100100'};
      const protectedReport=combat.rollHighExplosiveAttack(ctx,rng([a,b]));
      assert.equal(protectedReport.destroyThreshold,plain.destroyThreshold+1);
      assert.equal(protectedReport.suppressThreshold,plain.suppressThreshold);
      if(a+b===plain.destroyThreshold) {
        assert.equal(plain.outcome,'destroyed');assert.equal(protectedReport.outcome,'suppressed');
      }
      if(a+b<plain.suppressThreshold)assert.equal(protectedReport.outcome,'none');
      if(a+b===plain.suppressThreshold)assert.equal(protectedReport.outcome,'suppressed');
    }
  }
});

test('new HE earthwork cover leaves existing shared terrain cover and its suppression modifier unchanged',()=>{
  for(const terrain of ['field','forest','trees','urban_indestructible']) {
    const ctx=context(),tile=ctx.map.get(ctx.target.pos);tile.terrain=terrain;
    const plain=combat.rollHighExplosiveAttack(ctx,rng());
    tile.fortification={kind:'gun_pit',connections:'100100'};
    const report=combat.rollHighExplosiveAttack(ctx,rng());
    assert.equal(report.destroyThreshold,plain.destroyThreshold+1);
    assert.equal(report.suppressThreshold,plain.suppressThreshold);
    assert.equal(report.infantryCoverValue,plain.infantryCoverValue);
    tile.fortification.connections='000010';
    const aligned=combat.rollHighExplosiveAttack(ctx,rng());
    assert.equal(aligned.destroyThreshold,plain.destroyThreshold);
    assert.equal(aligned.suppressThreshold,plain.suppressThreshold);
  }
});

test('infantry in a gun pit also retains rifle and MG trench protection with the existing triangle formation',()=>{
  const ctx=context(),tile=ctx.map.get(ctx.target.pos);
  const plain=combat.mgHitBreakdown({...ctx,hardcoreTankMachineGuns:true});
  tile.fortification={kind:'gun_pit',connections:'100100'};
  assert.equal(combat.mgHitBreakdown({...ctx,hardcoreTankMachineGuns:true}).threshold,plain.threshold+2);
  ctx.attacker=unit('american_infantry',ctx.attacker.pos);
  assert.equal(combat.hitBreakdown(ctx).trench,2);
});

test('HE collateral independently protects the gun body, its attached crew and other infantry in the same pit',()=>{
  const BlastScene=sceneMethods(['rollHighExplosiveCollateralResults'],{...types,rollHEAttack:combat.rollHighExplosiveAttack});
  for(const aligned of [false,true]) {
    const ctx=context('pak38'),gun=ctx.target,crew=unit('german_infantry',gun.pos),other=unit('german_infantry',gun.pos);
    crew.id='attached-crew';crew.attachedToATGunId=gun.id;other.id='other-infantry';
    ctx.map.get(gun.pos).fortification={kind:'gun_pit',connections:aligned?'000010':'100100'};
    const dice=rng([4,5,4,5,4,5]);
    const body=combat.rollHighExplosiveAttack(ctx,dice),scene=new BlastScene();
    Object.assign(scene,{mission:{map:ctx.map,data:{}},allUnits:()=>[ctx.attacker,gun,crew,other],rng:dice});
    const collateral=scene.rollHighExplosiveCollateralResults(ctx.attacker,gun);
    assert.equal(collateral.length,2);assert.equal(body.destroyThreshold,aligned?9:10);
    assert.equal(body.outcome,aligned?'destroyed':'none');
    for(const result of collateral) {
      assert.equal(result.report.destroyThreshold,body.destroyThreshold);
      assert.equal(result.report.outcome,aligned?'destroyed':'suppressed');
      assert.equal(result.report.suppressThreshold,result.target===crew?5:3);
    }
  }
});

test('all AT gun kinds cannot enter ordinary trenches or actively leave gun pits; infantry and tanks can cross',()=>{
  for(const kind of gunKinds)for(let d=0;d<6;d++) {
    const ctx=context(kind),gun=ctx.target,origin=ctx.map.get(gun.pos),to=hex.neighbor(gun.pos,d),destination=ctx.map.get(to);
    destination.fortification={kind:'trench',connections:'111111'};
    assert.equal(ctx.map.canUnitCrossEdge(gun.pos,to,gun),false);
    destination.fortification.kind='gun_pit';
    assert.equal(ctx.map.canUnitCrossEdge(gun.pos,to,gun),true,'approaching a gun pit is allowed');
    origin.fortification={kind:'gun_pit',connections:'111111'};
    assert.equal(ctx.map.canUnitCrossEdge(gun.pos,to,gun),false,'an open exit does not let a gun actively move out');
    for(const moverKind of ['german_infantry','sherman']) {
      const mover=unit(moverKind,gun.pos);
      assert.equal(ctx.map.canUnitCrossEdge(gun.pos,to,mover),true);
      destination.fortification.kind='trench';assert.equal(ctx.map.canUnitCrossEdge(gun.pos,to,mover),true);
    }
  }
});

test('classic AI disallows translation inside gun pits while retaining turns and attacks',()=>{
  for(const kind of ['at_gun','pak38','pak43']) {
    const ctx=context(kind),gun=ctx.target;ctx.map.get(gun.pos).fortification={kind:'gun_pit',connections:'111111'};
    for(const action of ['advance','reverse','advance_to_building'])assert.equal(canExecuteAction(gun,action,ctx.attacker,ctx.map,new Set()),false);
    assert.equal(canExecuteAction(gun,'turn',ctx.attacker,ctx.map,new Set()),true);
    assert.equal(canExecuteAction(gun,'shoot',ctx.attacker,ctx.map,new Set()),true);
    assert.equal(decideEnemyMove(gun,ctx.attacker,ctx.map,[],10),null);
  }
});

const Scene=sceneMethods(['tryHardcoreATGunForwardMove','runHardcoreATGunTurn','executeEnemyAction','aiMoveDestinationForAction'],{
  ...types,...hex,limitTurretTraverse,markAmbushAction:()=>{},unitDisplayName:k=>k,
});
function sceneFor(ctx) {
  const scene=new Scene();Object.assign(scene,{
    mission:{map:ctx.map,data:{}},canMoveToBattleTile:()=>true,findMoveBlocker:()=>null,
    breakConcealment:()=>{},battleLog:()=>{},redraw:()=>{},moveDuration:.1,currentTurretFacingFor:()=>0,
    finishHardcoreATGunTurn:()=>{},isAIReverseMoveFilterEnabled:()=>false,
  });return scene;
}

test('hardcore gun movement uses the same restriction and can enter a gun pit from ordinary terrain',()=>{
  for(const kind of ['at_gun','pak38','pak43']) {
    const ctx=context(kind),gun=ctx.target,scene=sceneFor(ctx),to=hex.neighbor(gun.pos,0),tile=ctx.map.get(to);
    tile.fortification={kind:'trench',connections:'100100'};
    assert.equal(scene.tryHardcoreATGunForwardMove(gun,0),false);assert.equal(scene.anim,undefined);
    tile.fortification.kind='gun_pit';
    assert.equal(scene.tryHardcoreATGunForwardMove(gun,0),true);
    assert.deepEqual({q:scene.anim.toQ,r:scene.anim.toR},to);
    scene.anim=null;ctx.map.get(gun.pos).fortification={kind:'gun_pit',connections:'111111'};
    assert.equal(scene.tryHardcoreATGunForwardMove(gun,0),false);assert.equal(scene.anim,null);
  }
});

test('dedicated gun turns remain available in a gun pit, including the fixed-base Flak 88 aiming mechanism',()=>{
  for(const kind of gunKinds) {
    const ctx=context(kind),gun=ctx.target,scene=sceneFor(ctx);
    ctx.map.get(gun.pos).fortification={kind:'gun_pit',connections:'000000'};
    let turns=0,finished=0;
    scene.selectHardcoreATGunTarget=()=>({direction:1,attackable:false,terrainBlocked:true,target:ctx.attacker});
    scene.startHardcoreATGunAim=(actor,direction,_target,done)=>{assert.equal(actor,gun);assert.notEqual(direction,0);turns++;done()};
    scene.finishHardcoreATGunTurn=()=>finished++;
    scene.runHardcoreATGunTurn(gun);assert.equal(turns,1);assert.equal(finished,1);assert.equal(scene.anim,undefined);
    scene.selectHardcoreATGunTarget=()=>({direction:0,attackable:false,terrainBlocked:true,target:ctx.attacker});
    scene.runHardcoreATGunTurn(gun);assert.equal(finished,2);assert.equal(scene.anim,undefined);
  }
});

test('queued classic and off-region moves cannot bypass restrictions at execution time',()=>{
  for(const offRegion of [false,true])for(const insidePit of [false,true]) {
    const ctx=context('pak38'),gun=ctx.target,scene=sceneFor(ctx);
    const tile=ctx.map.get(insidePit?gun.pos:hex.neighbor(gun.pos,0));
    tile.fortification={kind:insidePit?'gun_pit':'trench',connections:'111111'};
    scene.mission.data.multiRegion=offRegion;scene.isOutsidePlayerRegion=()=>true;
    assert.equal(scene.executeEnemyAction(gun,'advance'),'done');
    assert.equal(scene.anim,undefined);assert.deepEqual(gun.pos,{q:3,r:3});
  }
});

const PreviewScene=sceneMethods(['drawAttackableHighlights','diceRuleModalSpec'],{
  ...types,...hex,...combat,GameSession:{gameMode:'hardcore'},t:key=>key,
  getGameModeConfig:()=>({expandedTurretDirections:false}),ambushHitThresholdModifier:()=>0,isMainGunSuppressionAttack,
});
test('actual HE map previews and dice details show the directional destruction-only modifier',()=>{
  for(const targetKind of ['german_infantry','pak38']) {
    const ctx=context(targetKind),scene=new PreviewScene(),labels=[];
    ctx.attacker.loadedShell='he';ctx.attacker.facing=1;ctx.attacker.turretFacing=1;
    ctx.map.get(ctx.target.pos).fortification={kind:'gun_pit',connections:'100100'};
    Object.assign(scene,{
      g:{},mission:{sherman:ctx.attacker,map:ctx.map,data:{},smokeHexes:new Set()},selectedGunHitThresholdModifier:0,
      playerMainGunHexTargets:()=>[ctx.target],isUnitVisible:()=>true,allUnits:()=>[ctx.attacker,ctx.target],currentWeather:()=>undefined,
      campaignMainGunHitThresholdModifier:()=>0,playerMainGunHitThresholdModifierDetails:()=>[],canTurretReachDirection:()=>true,
      turretTargetDirection:()=>1,project:()=>({x:0,y:0}),canDirectlyAttackUrbanBuilding:()=>false,
      spawnPreviewLabel:(_x,_y,need,probability)=>labels.push({need,probability}),
    });
    scene.drawAttackableHighlights();assert.equal(labels[0].need,10);assert.equal(labels[0].probability,combat.probHit2d6(10));
    const he=combat.rollHighExplosiveAttack(ctx,rng()),spec=scene.diceRuleModalSpec({report:{},highExplosiveReport:he},'he');
    assert.ok(spec.rows.some(([key,value])=>key==='dice.rule.heTrenchCover'&&value==='1'));
    assert.ok(spec.totals.some(([key,value])=>key==='dice.rule.heDestroyNeed'&&value==='10'));
    if(types.isFootUnit(ctx.target))assert.ok(spec.totals.some(([key,value])=>key==='dice.rule.heSuppressNeed'&&value==='3'));
  }
});
