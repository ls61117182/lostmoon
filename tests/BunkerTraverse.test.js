const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const sharp = require('sharp');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const types = require('../assets/scripts/core/types.ts');
const grid = require('../assets/scripts/core/HexGrid.ts');
const traverse = require('../assets/scripts/core/TurretTraverse.ts');
const fog = require('../assets/scripts/core/FogOfWar.ts');
const { canAttack } = require('../assets/scripts/core/Combat.ts');
const { canExecuteAction } = require('../assets/scripts/core/EnemyAI.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const visuals = require('../assets/scripts/core/TankVisualDB.ts');
const kinds = ['heavy_artillery', 'german_heavy_artillery'];
function mapOf() {
  const map = new grid.HexMap(30,30);
  for(let q=0;q<30;q++) for(let r=0;r<30;r++) map.set({pos:{q,r},terrain:'field'});
  return map;
}
const unit = (kind, facing=0) => ({id:kind,kind,facing,pos:{q:15,r:15},faction:getUnitStats(kind).faction,stats:getUnitStats(kind)});
function targetAt(direction, multiplier=1) {
  const v = grid.fireDirectionVector(direction);
  return {...unit('sherman'),pos:{q:15+v.q*multiplier,r:15+v.r*multiplier}};
}
test('both bunkers see and attack exactly forward and +/-30 rays for all six body headings, in either mode',()=>{
  const map=mapOf();
  for(const kind of kinds) for(let facing=0;facing<6;facing++) {
    const bunker=unit(kind,facing);
    bunker.turretFacing=traverse.rotateFireDirection(facing,-1);
    const visible=fog.computeUnitVisibleHexes(map,bunker,'clear');
    for(let direction=0;direction<12;direction++) {
      const target=targetAt(direction);
      const expected=traverse.turretTurnDistance(facing,direction)<=1;
      assert.equal(visible.has(grid.HexMap.keyOf(target.pos)),expected,`${kind} visibility ${facing}/${direction}`);
      for(const expandedTurretDirections of [false,true]) assert.equal(canAttack({attacker:bunker,target,map,expandedTurretDirections}).ok,expected);
    }
    for(const action of ['turn','advance','reverse','advance_to_building','infantry_move'])
      assert.equal(canExecuteAction(bunker,action,targetAt(facing),map,new Set()),false);
  }
});
test('diagonal range remains four hexes and smoke/terrain block a firing path',()=>{
  const map=mapOf(), attacker=unit(kinds[1]), target=targetAt(6,2), block=targetAt(6).pos;
  assert.equal(grid.hexDistance(attacker.pos,target.pos),4);
  assert(fog.computeUnitVisibleHexes(map,attacker).has(grid.HexMap.keyOf(target.pos)));
  assert(!fog.computeUnitVisibleHexes(map,attacker).has(grid.HexMap.keyOf(targetAt(6,3).pos)));
  const smokeHexes=new Set([grid.HexMap.keyOf(block)]);
  assert.equal(canAttack({attacker,target,map,smokeHexes,expandedTurretDirections:true}).ok,false);
  assert(!fog.computeUnitVisibleHexes(map,attacker,'clear',smokeHexes).has(grid.HexMap.keyOf(target.pos)));
  map.set({pos:block,terrain:'field',hasBuilding:true});
  assert.equal(canAttack({attacker,target,map,expandedTurretDirections:true}).ok,false);
});
const source=ts.createSourceFile('BattleScene.ts',fs.readFileSync('assets/scripts/view/BattleScene.ts','utf8'),ts.ScriptTarget.Latest,true);
const sceneClass=source.statements.find(s=>ts.isClassDeclaration(s)&&s.name?.text==='BattleScene');
function sceneMethods(names,globals={}) {
  const methods=[...new Set([...names,'turretTargetDirection'])].map(name=>sceneClass.members.find(m=>m.name?.getText(source)===name).getText(source));
  const js=ts.transpileModule(`class Scene {${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  return vm.runInNewContext(js+'\nScene',{...types,...grid,...traverse,...fog,...visuals,canAttack,...globals});
}
test('barrel animation updates aim independently of the body',()=>{
  const Scene=sceneMethods(['selectHardcoreHeavyArtilleryTarget','startEnemyTurretAim'],{
    GameSession:{gameMode:'hardcore'},getGameModeConfig:()=>({expandedTurretDirections:true}),aiTargetPriorityForActor:()=>0,
  });
  for(const kind of kinds) {
    const scene=new Scene(), bunker=unit(kind), target=targetAt(6);
    target.faction='usa'; target.crew={commander:true}; bunker.turretFacing=11;
    Object.assign(scene,{mission:{map:mapOf()},currentWeather:()=> 'clear',aiMissionTargetsFor:()=>[],aiTargetsFor:()=>[target],
      currentTurretFacingFor:u=>u.turretFacing,enemySupportsSplitTurret:()=>true,redraw:()=>{},beginTurretAimAnim:a=>scene.aim=a});
    assert.equal(scene.selectHardcoreHeavyArtilleryTarget(bunker),target);
    let fired=false; scene.startEnemyTurretAim(bunker,target,()=>{fired=true;});
    assert.equal(fired,false);assert.equal(bunker.facing,0);
    assert.equal(scene.aim.from,11);assert.equal(scene.aim.to,6);assert.equal(scene.aim.dur,1);
    scene.aim.onDone();assert.equal(fired,true);
  }
});

test('bunker chooses aligned targets first, then the smallest turn before target priority or distance',()=>{
  const Scene=sceneMethods(['selectHardcoreHeavyArtilleryTarget'],{
    GameSession:{gameMode:'hardcore'},getGameModeConfig:()=>({expandedTurretDirections:true}),aiTargetPriorityForActor:(_a,t)=>t.priority,
  });
  for(const kind of kinds) {
    const scene=new Scene(),bunker=unit(kind);bunker.turretFacing=11;
    const target=(dir,n,priority)=>({...targetAt(dir,n),priority,faction:'usa',crew:{commander:true}});
    const aligned=target(11,2,9),nearTurn=target(0,3,5),farTurn=target(6,1,0);
    let targets=[farTurn,nearTurn,aligned];
    Object.assign(scene,{mission:{map:mapOf()},currentWeather:()=> 'clear',aiMissionTargetsFor:()=>[],aiTargetsFor:()=>targets,
      currentTurretFacingFor:u=>u.turretFacing});
    assert.equal(scene.selectHardcoreHeavyArtilleryTarget(bunker),aligned);
    targets=[farTurn,nearTurn];
    assert.equal(scene.selectHardcoreHeavyArtilleryTarget(bunker),nearTurn);
    nearTurn.destroyed=true;
    assert.equal(scene.selectHardcoreHeavyArtilleryTarget(bunker),farTurn);
    targets=[target(3,1,0)];
    assert.equal(scene.selectHardcoreHeavyArtilleryTarget(bunker),null);
  }
});

test('traverse consumes an attack action and its callback advances without firing in both modes',()=>{
  for(const mode of ['classic','hardcore']) for(const kind of kinds) {
    const Scene=sceneMethods(['tryEnemyAttack','tryHeavyArtilleryTraverse'],{
      GameSession:{gameMode:mode},unitDisplayName:k=>k,
    });
    const scene=new Scene(),bunker=unit(kind),target=targetAt(6);bunker.turretFacing=0;
    let next=0,finished=0,callback;
    Object.assign(scene,{mission:{map:mapOf()},outcome:'ongoing',currentWeather:()=> 'clear',battleLog:()=>{},
      currentTurretFacingFor:u=>u.turretFacing,startEnemyTurretAim:(_u,_t,done)=>{callback=done;},
      runNextEnemyStep:()=>next++,finishHardcoreHeavyArtilleryTurn:()=>finished++});
    // Execute the real attack entry: it must return before damage/dice presentation.
    assert.equal(scene.tryEnemyAttack(bunker,{selectedTarget:target}),true);
    assert.equal(next+finished,0);callback();
    assert.equal(next,mode==='classic'?1:0);assert.equal(finished,mode==='hardcore'?1:0);
    assert.equal(bunker.facing,0);
    bunker.turretFacing=6;callback=undefined;
    assert.equal(scene.tryHeavyArtilleryTraverse(bunker,target),false);
    assert.equal(callback,undefined);
  }
});

test('hardcore invalid attack die cannot rotate; a valid die pays for exactly one traverse',()=>{
  const Scene=sceneMethods(['runHardcoreHeavyArtilleryTurn','tryEnemyAttack','tryHeavyArtilleryTraverse'],{
    GameSession:{gameMode:'hardcore'},unitDisplayName:k=>k,
  });
  const scene=new Scene(),bunker=unit(kinds[0]),target=targetAt(6);bunker.turretFacing=0;
  let allowed=false,checks=0,finished=0,turns=0,callback;
  Object.assign(scene,{mission:{map:mapOf()},outcome:'ongoing',currentWeather:()=> 'clear',battleLog:()=>{},selectHardcoreHeavyArtilleryTarget:()=>target,
    supportGunFirepowerAllows:()=>{checks++;return allowed;},currentTurretFacingFor:u=>u.turretFacing,
    startEnemyTurretAim:(_u,_t,done)=>{turns++;callback=done;},finishHardcoreHeavyArtilleryTurn:()=>finished++});
  scene.runHardcoreHeavyArtilleryTurn(bunker);
  assert.equal(checks,1);assert.equal(turns,0);assert.equal(finished,1);
  allowed=true;scene.runHardcoreHeavyArtilleryTurn(bunker);
  assert.equal(checks,2);assert.equal(turns,1);assert.equal(finished,1);
  callback();assert.equal(finished,2);assert.equal(checks,2);assert.equal(turns,1);
});
test('split layers share canvas, scale and pivot; composite matches the registered top sprite',async()=>{
  for(const kind of kinds) {
    const prefix=kind==='heavy_artillery'?'heavy_artillery':'german_coastal_bunker';
    const path='assets/resources/textures/units/'+prefix+'_top';
    assert(visuals.SPLIT_TANK_KINDS.includes(kind));
    const cfg=visuals.splitTankGeometryConfigOf(kind);
    assert.equal(cfg.pivot.bodyX,cfg.pivot.spriteX);assert.equal(cfg.pivot.bodyY,cfg.pivot.spriteY);
    assert.equal(visuals.splitTankVisualConfigOf(kind).turretScale,1);
    for(const suffix of ['','_hull','_turret']) {const m=await sharp(path+suffix+'.png').metadata();assert.equal(m.width,100);assert.equal(m.height,70);assert(m.hasAlpha);}
    assert.deepEqual(await sharp(path+'_hull.png').composite([{input:path+'_turret.png'}]).raw().toBuffer(),await sharp(path+'.png').raw().toBuffer());
  }
});

test('battle renderer applies aim interpolation to barrel only',()=>{
  const Scene=sceneMethods(['drawUnit'],{
    isEnemyTopKind:k=>kinds.includes(k),isSplitTankKind:k=>visuals.SPLIT_TANK_KINDS.includes(k),commanderHatchVisualState:()=> 'hidden',
  });
  for(const kind of kinds) {
    const scene=new Scene(), bunker=unit(kind), aim={from:11,to:6,t:0.5,angular:true};
    Object.assign(scene,{hexSize:64,mission:{},project:()=>({x:0,y:0}),enemyTopPoolNext:0,enemyTopSpritePool:[{},{}],
      commanderHatchSpriteFrames:{},enemySupportsSplitTurret:()=>true,currentEnemyTurretLerp:()=>aim});
    let bodyAim,barrelAim;
    scene.applySplitTankHullSprite=(...args)=>{bodyAim=args[4];};
    scene.applySplitTankTurretSprite=(...args)=>{barrelAim=args[5];};
    scene.drawUnit(bunker);
    assert.equal(bodyAim,undefined);assert.equal(barrelAim,aim);assert.equal(bunker.facing,0);
  }
});

test('screenshot regression: an off-ray target inside the bunker cone is acquired and visibly aimed at',()=>{
  const Scene=sceneMethods(['selectHardcoreHeavyArtilleryTarget','tryEnemyAttack','tryHeavyArtilleryTraverse',
    'startEnemyTurretAim','currentEnemyTurretLerp','topDownForwardVec','directionScreenAngle','targetScreenAngle'],{
    GameSession:{gameMode:'hardcore'},getGameModeConfig:()=>({expandedTurretDirections:true}),
    aiTargetPriorityForActor:()=>0,unitDisplayName:k=>k,easeInOutCubic:t=>t,
  });
  for(const kind of kinds) {
    const scene=new Scene(),bunker=unit(kind,2);
    const target={...unit('t34_85'),pos:{q:12,r:17},faction:'usa',crew:{commander:true}};
    assert.equal(grid.fireDirectionTo(bunker.pos,target.pos),null,'the old three-ray implementation discarded this target');
    const map=mapOf();
    assert.equal(fog.diagonalMainGunDirectionForHex(map,bunker,target.pos),
      fog.diagonalMainGunDirectionForHex(map,{...bunker,kind:'sherman',stats:{...bunker.stats,visionType:'turreted'}},target.pos));
    assert(canAttack({attacker:bunker,target,map,expandedTurretDirections:true}).ok);
    let finished=0;
    Object.assign(scene,{mission:{map},outcome:'ongoing',currentWeather:()=> 'clear',aiMissionTargetsFor:()=>[],aiTargetsFor:()=>[target],
      currentTurretFacingFor:u=>u.turretFacing??u.facing,enemySupportsSplitTurret:()=>true,
      enemyTurretFacing:new Map(),redraw:()=>{},battleLog:()=>{},beginTurretAimAnim:a=>scene.turretAimAnim=a,
      finishHardcoreHeavyArtilleryTurn:()=>finished++,project:(q,r)=>grid.axialToPixel({q,r},64)});
    assert.equal(scene.selectHardcoreHeavyArtilleryTarget(bunker),target);
    scene.tryEnemyAttack(bunker,{selectedTarget:target});
    const animation=scene.turretAimAnim;
    assert.equal(animation.dur,0.5,'one 30-degree tank traverse step');
    const center=scene.project(bunker.pos.q,bunker.pos.r);
    const body=scene.topDownForwardVec(bunker,center);
    animation.t=0.5;
    const midway=scene.topDownForwardVec(bunker,center,scene.currentEnemyTurretLerp(bunker));
    assert(Math.abs(body.ux-midway.ux)>0.01);
    animation.t=1;
    const aimed=scene.topDownForwardVec(bunker,center,scene.currentEnemyTurretLerp(bunker));
    const angle=scene.targetScreenAngle(bunker.pos,target.pos);
    assert(Math.abs(aimed.ux-Math.cos(angle))<1e-9);assert(Math.abs(aimed.uy-Math.sin(angle))<1e-9);
    // Commit the same state as the production animation completion path.
    bunker.turretFacing=animation.to;bunker.turretVisualTarget=animation.toVisualTarget;
    scene.turretAimAnim=null;animation.onDone();
    assert.equal(finished,1);assert.equal(bunker.facing,2);
    assert.equal(scene.tryHeavyArtilleryTraverse(bunker,target),false,'next action may shoot instead of turning forever');
    const outside={q:12,r:16};
    assert.equal(fog.diagonalMainGunDirectionForHex(map,bunker,outside),fog.diagonalMainGunDirectionForHex(map,{...bunker,kind:'sherman',stats:{...bunker.stats,visionType:'turreted'}},outside),'same flank direction as tank rules');
  }
});
