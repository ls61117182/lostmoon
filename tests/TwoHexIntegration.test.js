const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const rules = Object.assign({}, ...['UnitFootprint', 'TwoHexPath', 'TwoHexDeployment', 'HexGrid', 'types', 'UnitDB', 'Combat', 'ActionDice', 'Objective', 'GameMode', 'Ambush', 'LockedFire', 'FogOfWar', 'Suppression', 'EnemyAI', 'TurretTraverse']
  .map(name => require(`../assets/scripts/core/${name}.ts`)));
const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const riding = require('../assets/scripts/core/TankRiding.ts');
const steering = require('../assets/scripts/view/TankTrackVisual.ts');
const wreckMotion = require('../assets/scripts/view/TankWreckPush.ts');
const GameSession = { gameMode: 'hardcore', isPvp: false };
class EffectNode {
  constructor() { this.isValid = true; this.children = []; }
  addComponent(Type) { return new Type(); }
  addChild(node) { this.children.push(node); }
  setPosition(x, y) { this.position = { x, y }; }
  setScale() {} setSiblingIndex() {}
  destroy() { this.isValid = false; }
}
class EffectTransform { setContentSize() {} }
class EffectSprite { static SizeMode = { CUSTOM: 1 }; }
const Scene = require('./helpers/BattleSceneMethods.cjs')([
  'tryTurnSherman', 'tryDoublesCoDriverTurn', 'tryDriveSherman', 'findMoveBlocker', 'canTwoHexTurn', 'isPlayerTurnEvacuation', 'unitsOnTileAxial',
  'interpolatedPos', 'directionScreenAngle', 'tankMachineGunSelection', 'tankMachineGunContext', 'rollHighExplosiveCollateralResults',
  'spawnRepairIndicator', 'advanceRepairIndicators', 'beginCampaignAutoEvac', 'playerTankEvacVisibilityExtension',
  'advanceTankMoveTime',
  'trySmoke', 'smokeActionUnavailable', 'hasSmokeAt', 'deploySmokeAt', 'deployUnitSmoke',
  'clearSmokeAt', 'clearSmokeByOwner', 'smokeHexPos', 'consumeLegacyUnitSmoke', 'applyPvpSmokeSnapshot',
  'ambushGunnerSightKeys', 'drawAmbushSightHighlights', 'tryResolveAmbushAfterMove',
  'drawShermanSpawnEntryArrow',
], { ...rules, ...steering, ...wreckMotion, GameSession, t: key => key, Color: class {}, easeOutCubic: t => 1-(1-t)**3,
  Node: EffectNode, UITransform: EffectTransform, UIOpacity: class {}, Sprite: EffectSprite,
  SMOKE_VISION_LAYER_INTERVAL:1, playSmokeDeploy(){},
  SPAWN_ENTRY_ARROW_STROKE:'stroke',SPAWN_ENTRY_ARROW_FILL:'fill',
  rollHEAttack: rules.rollHighExplosiveAttack });

// Run the production completion branch after the move has committed its position.
const sceneAst = ts.createSourceFile('BattleScene.ts', fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8'), ts.ScriptTarget.Latest, true);
let completion;
function findCompletion(node) {
  if (ts.isIfStatement(node) && node.expression.getText(sceneAst).startsWith('anim.evacExit')
    && node.thenStatement.getText(sceneAst).includes('this.mission.playerTankEvacuated = true')) completion = node;
  ts.forEachChild(node, findCompletion);
}
findCompletion(sceneAst);
assert(completion);
const finishEvac = new Function('anim', 'finishedUnit', 'isTwoHexUnit', 'unitOccupiedHexes', ts.transpileModule(
  `if (${completion.expression.getText(sceneAst)}) ${completion.thenStatement.getText(sceneAst)}`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText);
// Exercise pose commit, hull-carried turret update and evacuation in their production order.
const sceneSource = sceneAst.text;
const completionStart = sceneSource.indexOf('    const anim = this.anim;', sceneSource.indexOf('this.advanceTankMoveTime(this.anim, dt)'));
const completionEnd = sceneSource.indexOf('    const finishManeuverSound', completionStart);
assert(completionStart > 0 && completionEnd > completionStart);
const completionGlobals = { ...rules, ...riding };
const commitManeuver = new Function(...Object.keys(completionGlobals), ts.transpileModule(
  sceneSource.slice(completionStart, completionEnd),
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText);

function tank(kind = 'maus', pos = { q: 0, r: 0 }, sideId = 'player') {
  const stats = rules.getUnitStats(kind);
  return { id: kind, kind, stats, pos, facing: 0, turretFacing: 0, crew: rules.createTankCrew(stats), faction: stats.faction, sideId, controller: 'local_player' };
}
function sceneFixture() {
  const map = new rules.HexMap(8, 8);
  for (let q=-4;q<=4;q++) for(let r=-4;r<=4;r++) map.set({pos:{q,r},terrain:'field'});
  const unit = tank();
  const scene = new Scene();
  const noop = () => {};
  Object.assign(scene, { mission: { map, sherman:unit, playerTank:unit, allies:[], enemies:[], smokeHexes:new Set(), data:{objective:{type:'destroy_all_enemies'}} },
    moveDuration:0.3, phaseDice:[{pip:4,used:false}], dieStep:()=> 'movement', currentWeather:()=> 'sunny',
    allUnits:()=>[unit,...scene.mission.allies,...scene.mission.enemies],
    canMoveToBattleTile: p=>map.has(p), isBlockingMoveOccupant: (m,o)=>!o.destroyed && !rules.isFootUnit(o),
    usePhaseDice: indices=>indices.forEach(i=>scene.phaseDice[i].used=true), closeDiePopover:noop,
    breakConcealment:noop, refreshPhaseUI:noop,updateHUD:noop,redraw:noop,battleLogI18n:noop,spawnFloater:noop,
    project:(q,r)=>({x:Math.sqrt(3)*(q+r/2),y:1.5*r}),currentTurretFacingFor:u=>u.turretFacing,
    canTurretReachDirection:()=>true, rng:{d6:()=>6},checkCrewAlive:()=>true,
    isCampaignNextSegmentEntry:()=>false,
    consumeDoubles:i=>{scene.phaseDice[i].used=true;return true;},
  });
  return {scene,map,unit};
}

test('fixed and rolled spawn markers retain their map cell when Maus deployment needs two cells', () => {
  for (const rolled of [false,true]) for (const placementKey of ['playerTank','sherman']) {
    const markers=[];
    for (const kind of ['sherman','tiger','maus']) {
      const placement={kind,at:{col:0,row:1},facing:0};
      const data={id:'fixed_spawn_marker',name:'Spawn marker',cols:4,rows:3,rowParityOffset:0,
        tiles:Array.from({length:3},()=>Array.from({length:4},()=>({t:'f'}))),
        [placementKey]:placement,allies:[],enemies:[],objective:{type:'destroy_all_enemies'}};
      if (rolled) {
        data.shermanStartByDice=true;data.enemyStartByDice=true;delete placement.at;
        data.tiles[1][0].eid=1;data.tiles[1][0].ef=0;
      }
      const mission=loadMission(data,{d6:()=>1});
      const expected=rules.offsetToAxial({col:0,row:1},0);
      assert.deepEqual(mission.playerSpawnMarker,{pos:expected,facing:0});
      if (kind==='maus') assert.notDeepEqual(mission.playerTank.pos,expected,'the tank moves to a legal footprint while its marker stays put');
      markers.push(mission.playerSpawnMarker);
      mission.playerTank.pos.q+=2;mission.playerTank.facing=3;
      assert.deepEqual(mission.playerSpawnMarker,{pos:expected,facing:0},'unit movement cannot mutate the map marker');
    }
    assert.deepEqual(markers[0],markers[1]);assert.deepEqual(markers[1],markers[2]);
  }
});

test('spawn arrow geometry remains fixed across vehicle dimensions, footprints and later moves', () => {
  const {scene}=sceneFixture();const commands=[];
  Object.assign(scene,{hexSize:60,shermanSpawnQr:{q:0,r:0},shermanSpawnFacing:0,
    project:(q,r)=>({x:Math.sqrt(3)*60*(q+r/2),y:-90*r}),
    g:Object.fromEntries(['moveTo','lineTo','stroke','close','fill'].map(name=>[name,(...args)=>commands.push([name,...args])]))});
  let expected;
  for (const kind of ['sherman','tiger','maus']) {
    const unit=tank(kind);scene.mission.playerTank=scene.mission.sherman=unit;
    for (const moved of [false,true]) {
      if (moved) {unit.pos={q:3,r:2};unit.facing=4;}
      commands.length=0;scene.drawShermanSpawnEntryArrow();
      assert(commands.length>0);
      if (!expected) expected=commands.slice();else assert.deepEqual(commands,expected);
    }
  }
});

function smokeFixture(kind='maus',facing=0) {
  const {scene,map}=sceneFixture();const unit=tank(kind);unit.facing=facing;
  scene.mission.sherman=scene.mission.playerTank=unit;
  const transitions=[],submitted=[],unavailable=[];
  Object.assign(scene,{playerStep:'misc',phaseDice:[{pip:3,used:false}],smokeScreenAges:new Map(),
    miscDieCanDeploySmoke:()=>true,canHearBattleAt:()=>false,allUnits:()=>[unit,...scene.mission.allies,...scene.mission.enemies],
    displayedFogVisionSnapshot:()=>new Set(scene.mission.smokeHexes),
    startFogVisionTransition(before,expanding,interval){transitions.push({before:Array.from(before),after:Array.from(scene.mission.smokeHexes),expanding,interval});},
    showDieActionUnavailable:reason=>unavailable.push(reason),sendPvpActionResult:(_,event)=>submitted.push(event),
    refreshStatusPanel(){},completePhaseDiceAction(){}});
  scene.mission.smokeHexOwners=new Map();
  return {scene,map,unit,transitions,submitted,unavailable};
}

test('one grenade action covers every occupied cell, consumes one die and starts one complete vision transition', () => {
  for (const kind of ['maus','sherman']) for (let facing=0;facing<6;facing++) {
    const {scene,unit,transitions,submitted,unavailable}=smokeFixture(kind,facing);
    assert.equal(scene.smokeActionUnavailable(),null);
    scene.trySmoke(0);
    const keys=rules.unitOccupiedHexes(unit).map(rules.HexMap.keyOf);
    assert.deepEqual(Array.from(scene.mission.smokeHexes).sort(),keys.slice().sort());
    for (const key of keys) {
      assert.equal(scene.mission.smokeHexOwners.get(key),'friendly');
      assert.equal(scene.smokeScreenAges.get(key),0);
    }
    assert.equal(scene.phaseDice[0].used,true);
    assert.equal(submitted.length,1);
    assert.equal(transitions.length,1);
    assert.deepEqual(transitions[0].before,[]);
    assert.equal(transitions[0].after.length,keys.length);
    assert.equal(transitions[0].interval,1);
    assert.equal(scene.smokeActionUnavailable(),'floater.alreadySmoked');
    scene.phaseDice=[{pip:3,used:false}];scene.trySmoke(0);
    assert.equal(scene.phaseDice[0].used,false,'full coverage must not consume another smoke die');
    assert.equal(submitted.length,1);assert.equal(unavailable.length,1);
  }
});

test('partial smoke coverage permits filling the other cell for player and AI', () => {
  for (const existing of ['front','rear']) {
    const {scene,map,unit,transitions}=smokeFixture();
    unit.crewSkills={commander:['use_smoke_grenade']};
    scene.deploySmokeAt(existing==='front'?unit.pos:rules.unitRearHex(unit),'friendly');
    assert.equal(scene.smokeActionUnavailable(),null);
    assert.equal(rules.canExecuteAction(unit,'smoke',tank('sherman'),map,new Set(),scene.mission.smokeHexes),true);
    scene.trySmoke(0);
    assert.equal(scene.mission.smokeHexes.size,2);
    assert.equal(transitions[0].before.length,1);assert.equal(transitions[0].after.length,2);
    assert.equal(rules.canExecuteAction(unit,'smoke',tank('sherman'),map,new Set(),scene.mission.smokeHexes),false);
  }
});

test('unit smoke ownership, clearing, legacy conversion and PVP snapshots retain both cells', () => {
  const {scene,unit}=smokeFixture();
  const enemy=tank('maus',{q:3,r:0},'enemy');enemy.id='enemy-maus';
  unit.smoked=true;enemy.smoked=true;scene.mission.enemies=[enemy];
  scene.consumeLegacyUnitSmoke();
  assert.equal(unit.smoked,false);assert.equal(enemy.smoked,false);
  for (const key of rules.unitOccupiedHexes(unit).map(rules.HexMap.keyOf)) assert.equal(scene.mission.smokeHexOwners.get(key),'friendly');
  for (const key of rules.unitOccupiedHexes(enemy).map(rules.HexMap.keyOf)) assert.equal(scene.mission.smokeHexOwners.get(key),'enemy');
  assert.equal(scene.mission.smokeHexes.size,4);
  const remote=smokeFixture();
  remote.scene.applyPvpSmokeSnapshot({smokeHexes:Array.from(scene.mission.smokeHexes),smokeHexOwners:Object.fromEntries(scene.mission.smokeHexOwners)});
  assert.deepEqual(Array.from(remote.scene.mission.smokeHexes).sort(),Array.from(scene.mission.smokeHexes).sort());
  assert.equal(remote.transitions.length,1,'all incoming enemy smoke cells animate together');
  const cleared=scene.clearSmokeByOwner('friendly',true);
  assert.equal(cleared.length,2);assert.equal(scene.mission.smokeHexes.size,2);
  for (const pos of rules.unitOccupiedHexes(enemy)) assert(scene.hasSmokeAt(pos));
});

test('ambush sight, red previews and reaction triggers exclude both own hull cells in every heading', () => {
  for (let facing=0;facing<6;facing++) {
    const {scene,map,unit}=sceneFixture();unit.facing=facing;unit.turretFacing=facing;
    unit.loaded=true;unit.loadedShell='ap';unit.ambushReadyThisTurn=true;
    const occupied=rules.unitOccupiedHexes(unit), ownKeys=occupied.map(rules.HexMap.keyOf);
    const raw=rules.computeUnitVisibleHexes(map,{...unit,hatchOpen:false,interiorVisionRange:0},'sunny',new Set());
    const sight=scene.ambushGunnerSightKeys(unit);
    for (const key of ownKeys) assert(!sight.has(key));
    const expected=Array.from(raw).filter(key=>!ownKeys.includes(key)).sort();
    assert.deepEqual(Array.from(sight).sort(),expected);assert(expected.length>0);
    const drawn=[];
    Object.assign(scene,{ambushSightOverlayGraphics:{clear(){drawn.length=0;},fill(){},stroke(){}},
      ambushSightHighlightUntil:new Map([[unit.id,Date.now()+10000]]),isUnitVisible:()=>true,
      isHexVisible:()=>true,isDeepShadowTile:()=>false,
      traceHexPathOn:(_,x,y)=>drawn.push({x,y})});
    // Even a caller supplying unfiltered vision must not paint either own cell.
    scene.ambushGunnerSightKeys=()=>raw;scene.drawAmbushSightHighlights();
    for (const pos of occupied) {
      const point=scene.project(pos.q,pos.r);
      assert(!drawn.some(p=>p.x===point.x&&p.y===point.y));
    }
    assert.equal(drawn.length,expected.length);
    delete scene.ambushGunnerSightKeys;
    for (const pos of occupied) {
      const mover=tank('sherman',pos,'enemy');scene.mission.enemies=[mover];
      assert.equal(rules.canAttack({attacker:unit,target:mover,map,smokeHexes:new Set(),shellType:'ap'}).reason,'attack.reason.overlap');
      assert.equal(scene.tryResolveAmbushAfterMove(mover,()=>assert.fail('no shot to resume')),false);
      assert.equal(unit.ambushReadyThisTurn,true);
    }
  }
});

test('player turns move the front anchor; blocked turns retain the action die', () => {
  let f=sceneFixture(); f.scene.tryTurnSherman(0,1);
  assert.equal(f.scene.phaseDice[0].used,true);
  assert.deepEqual([f.scene.anim.toQ,f.scene.anim.toR,f.scene.anim.turnTo],[0,1,1]);
  f=sceneFixture();f.map.get({q:0,r:1}).terrain='water';f.scene.tryTurnSherman(0,1);
  assert.equal(f.scene.phaseDice[0].used,false);assert.equal(f.scene.anim,undefined);
});

test('player reverse rejects water or vehicles in the new rear hex before consuming a die', () => {
  for(const blocker of ['water','tank']) {
    const {scene,map}=sceneFixture();scene.phaseDice[0].pip=1;
    if(blocker==='water')map.get({q:-2,r:0}).terrain='water';
    else scene.mission.enemies.push(tank('tiger',{q:-2,r:0},'enemy'));
    scene.tryDriveSherman(0,-1);
    assert.equal(scene.phaseDice[0].used,false,blocker);assert.equal(scene.anim,undefined,blocker);
  }
  const {scene}=sceneFixture();scene.phaseDice[0].pip=1;scene.tryDriveSherman(0,-1);
  assert.equal(scene.phaseDice[0].used,true);assert.deepEqual([scene.anim.toQ,scene.anim.toR],[-1,0]);
});

test('both hexes are selectable and block other vehicles', () => {
  const {scene,unit}=sceneFixture();const mover=tank('tiger',{q:-3,r:0},'enemy');scene.mission.enemies.push(mover);
  assert.equal(scene.unitsOnTileAxial({q:-1,r:0})[0].id,unit.id);
  assert.equal(scene.findMoveBlocker(mover,{q:-1,r:0}).id,unit.id);
});

test('drawing centers the hull between both hexes and interpolates turning displacement', () => {
  const {scene,unit}=sceneFixture();
  assert.equal(scene.interpolatedPos(unit).x,-Math.sqrt(3)/2);
  scene.anim={unit,kind:'turn',fromQ:0,fromR:0,toQ:0,toR:1,turnFrom:0,turnTo:1,t:1};
  const end=scene.interpolatedPos(unit);
  assert(Math.abs(end.x-Math.sqrt(3)/4)<1e-12);assert.equal(end.y,0.75);
});

test('Maus movement runs at 60% and turning at 40% for player and AI, preserving mud slowdown', () => {
  for (const role of ['player','ally','enemy']) for (const action of ['advance','reverse','cw','ccw']) for (const muddy of [false,true]) {
    const {scene,map}=sceneFixture();const unit=tank();
    scene.hexSize=1;
    if (muddy) for (const tile of map.all()) tile.terrain='mud';
    if (role==='player') scene.mission.playerTank=scene.mission.sherman=unit;
    else scene.mission[role==='ally'?'allies':'enemies']=[unit];
    const plan=rules.planUnitMove(unit,action);
    const turning=action==='cw'||action==='ccw';
    const anim={unit,kind:turning?'turn':'move',fromQ:unit.pos.q,fromR:unit.pos.r,
      toQ:plan.pos.q,toR:plan.pos.r,turnFrom:unit.facing,turnTo:plan.facing,t:0,dur:0.4};
    const speed=(turning?0.4:0.6)*(muddy?0.5:1);
    const duration=anim.dur/speed;
    scene.advanceTankMoveTime(anim,duration*0.5);
    assert(Math.abs(anim.t-0.5)<1e-9,`${role} ${action} midpoint`);
    scene.advanceTankMoveTime(anim,duration*0.49);
    assert(Math.abs(anim.t-0.99)<1e-9,`${role} ${action} before arrival`);
    scene.advanceTankMoveTime(anim,duration*0.01);
    assert(Math.abs(anim.t-1)<1e-9,`${role} ${action} arrival`);
    assert.equal(anim.dur,0.4,'the configured base duration is not mutated or scaled twice');
  }
});

test('other tank models retain their existing movement and pivot speeds', () => {
  for (const kind of ['sherman','tiger']) for (const action of ['advance','reverse','cw','ccw']) {
    const {scene}=sceneFixture();const unit=tank(kind);scene.hexSize=1;
    const plan=rules.planUnitMove(unit,action);
    const anim={unit,kind:action==='cw'||action==='ccw'?'turn':'move',fromQ:unit.pos.q,fromR:unit.pos.r,
      toQ:plan.pos.q,toR:plan.pos.r,turnFrom:unit.facing,turnTo:plan.facing,t:0,dur:0.4};
    scene.advanceTankMoveTime(anim,0.2);
    assert(Math.abs(anim.t-0.5)<1e-9,`${kind} ${action}`);
  }
});

test('MG selection independently checks hull range and coaxial origin', () => {
  const {scene,unit}=sceneFixture();
  const infantry=pos=>({id:'foot',kind:'american_infantry',pos,faction:'usa',sideId:'enemy',stats:rules.getUnitStats('american_infantry')});
  assert.equal(scene.tankMachineGunSelection(unit,infantry({q:1,r:0})).weapon,'hull');
  assert.equal(scene.tankMachineGunSelection(unit,infantry({q:2,r:0})),null);
  unit.turretFacing=1;
  assert.equal(scene.tankMachineGunSelection(unit,infantry({q:-1,r:1})).weapon,'coaxial');
  assert.equal(scene.tankMachineGunSelection(unit,infantry({q:0,r:0})),null);
});

test('HE collateral excludes a primary vehicle hit view and does not spill into its other half', () => {
  const {scene,unit}=sceneFixture();
  const target=tank('maus',{q:2,r:0},'enemy'); target.id='enemy_maus';scene.mission.enemies.push(target);
  const foot=pos=>({id:`foot_${pos.q}`,kind:'american_infantry',pos,stats:rules.getUnitStats('american_infantry'),faction:'usa',sideId:'enemy'});
  scene.mission.enemies.push(foot({q:2,r:0}),foot({q:1,r:0}));
  const hits=scene.rollHighExplosiveCollateralResults(unit,rules.unitHitView(target,{q:2,r:0}));
  assert.deepEqual(Array.from(hits,h=>h.target.id),['foot_2']);
});

test('deployment adapts a legacy boundary spawn to a complete legal footprint', () => {
  const map=new rules.HexMap(4,2);for(let q=0;q<4;q++)map.set({pos:{q,r:0},terrain:'field'});
  const unit=tank();rules.fitTwoHexDeployment(map,unit,[unit]);
  assert.deepEqual(unit.pos,{q:1,r:0});assert.equal(rules.canDeployTwoHexUnit(map,unit,[unit]),true);
});

test('pathfinding includes heading and never emits an in-place two-hex turn', () => {
  const {map,unit}=sceneFixture();
  const route=rules.findTwoHexRoute(map,unit,u=>u.pos.q===1 && u.pos.r===1 && u.facing===1);
  assert(route?.length);
  for(const {from,action,plan}of route){
    assert.equal(map.canUnitCrossEdge(plan.entryFrom,plan.entryTo,from),true);
    if(action==='cw'||action==='ccw')assert.notDeepEqual(plan.pos,from.pos);
  }
});

test('front-first and rear-first exits win after the first cell crosses the designated exit', () => {
  for (const reverse of [false, true]) {
    const {scene,map,unit}=sceneFixture();
    scene.mission.data.objective={type:'destroy_kind_evac',evacAt:rules.axialToOffset({q:4,r:0}),evacExitDir:0};
    finishEvac.call(scene,{evacExit:false},unit,rules.isTwoHexUnit,rules.unitOccupiedHexes);
    assert(!scene.mission.playerTankEvacuated,'an ordinary move must not complete evacuation');
    unit.pos={q:reverse ? 3 : 4,r:0}; unit.facing=reverse ? 3 : 0;
    const plan=rules.planUnitMove(unit,reverse ? 'reverse' : 'advance');
    assert.equal(rules.isPlayerTankEvacDrive(scene.mission,unit.pos,unit.facing,reverse ? -1 : 1,plan.pos),true);
    scene.anim={unit,evacExit:true,toQ:plan.pos.q,toR:plan.pos.r};
    assert.deepEqual({...scene.playerTankEvacVisibilityExtension()},{q:5,r:0});
    unit.pos=plan.pos;
    assert(rules.unitOccupiedHexes(unit).some(pos=>map.has(pos)),'the other half is still on the map');
    scene.computeOutcome=()=>rules.checkOutcome(scene.mission);
    scene.updateOutcomeOverlay=()=>{};
    finishEvac.call(scene,scene.anim,unit,rules.isTwoHexUnit,rules.unitOccupiedHexes);
    assert.equal(scene.mission.playerTankEvacuated,true);
    assert.equal(scene.mission.shermanEvacuated,true);
    assert.equal(scene.outcome,'victory');
    scene.anim=null;
    assert.deepEqual({...scene.playerTankEvacVisibilityExtension()},{q:5,r:0});
  }
});

test('evacuation still requires the designated edge, completed prerequisites and a legal bridge exit', () => {
  const {scene,map,unit}=sceneFixture();
  const exit={q:4,r:0};
  scene.mission.data.objective={type:'destroy_kind_evac',kind:'truck',evacAt:rules.axialToOffset(exit),evacExitDir:0};
  unit.pos=exit;
  scene.mission.enemies=[{kind:'truck',destroyed:false}];
  assert.equal(rules.isPlayerTankEvacDrive(scene.mission,unit.pos,0,1,{q:5,r:0}),false);
  scene.mission.enemies[0].destroyed=true;
  assert.equal(rules.isPlayerTankEvacDrive(scene.mission,unit.pos,0,1,{q:5,r:0}),true);
  unit.pos={q:4,r:1};
  assert.equal(rules.isPlayerTankEvacDrive(scene.mission,unit.pos,0,1,{q:5,r:1}),false);
  unit.pos=exit;
  const tile=map.get(exit);tile.terrain='water';tile.bridgeEnds=[1,4];
  assert.equal(rules.isPlayerTankEvacDrive(scene.mission,unit.pos,0,1,{q:5,r:0}),false);
  tile.bridgeEnds=[0,3];
  assert.equal(rules.isPlayerTankEvacDrive(scene.mission,unit.pos,0,1,{q:5,r:0}),true);
});

function turnExitFixture(sign=1) {
  const f=sceneFixture();
  f.unit.pos={q:4,r:0};f.unit.facing=sign===1?5:1;
  f.scene.mission.data.objective={type:'destroy_kind_evac',evacAt:rules.axialToOffset(f.unit.pos),evacExitDir:0};
  return f;
}

test('both turn directions evacuate through the exit with movement, misc and doubles actions', () => {
  for (const sign of [-1,1]) for (const action of ['movement','misc','doubles']) {
    const {scene,map,unit}=turnExitFixture(sign);
    if(action==='misc') {scene.dieStep=()=> 'misc';scene.phaseDice[0].pip=5;}
    assert.equal(scene.canTwoHexTurn(unit,sign),true);
    if(action==='doubles')scene.tryDoublesCoDriverTurn(0,sign);else scene.tryTurnSherman(0,sign);
    assert.equal(scene.phaseDice[0].used,true);
    assert.equal(scene.anim.kind,'turn');assert.equal(scene.anim.evacExit,true);
    assert.deepEqual([scene.anim.toQ,scene.anim.toR,scene.anim.turnTo],[5,0,0]);
    assert.equal(scene.mission.playerTankEvacuated,undefined,'the exit animation must finish first');
    assert.deepEqual({...scene.playerTankEvacVisibilityExtension()},{q:5,r:0});
    Object.assign(scene,{finishTankTrackAnimation(){},crushEnemyATGunsAt(){},finishCampaignExitTurretAlignment(){},
      computeOutcome:()=>rules.checkOutcome(scene.mission),updateOutcomeOverlay(){}});
    commitManeuver.call(scene,...Object.values(completionGlobals));
    assert.deepEqual(unit.pos,{q:5,r:0});assert.equal(unit.facing,0);
    assert.deepEqual(rules.unitRearHex(unit),{q:4,r:0});assert(map.has(rules.unitRearHex(unit)));
    assert.equal(scene.mission.playerTankEvacuated,true);assert.equal(scene.mission.shermanEvacuated,true);
    assert.equal(scene.outcome,'victory');
  }
});

test('turn evacuation checks all six final headings rather than the pre-turn heading', () => {
  for(let heading=0;heading<6;heading++)for(const sign of [-1,1]) {
    const {scene,map,unit}=sceneFixture();unit.facing=(heading-sign+6)%6;
    scene.mission.data.objective={type:'destroy_kind_evac',evacAt:rules.axialToOffset(unit.pos),evacExitDir:heading};
    const exit=rules.neighbor(unit.pos,heading),has=map.has.bind(map);
    map.has=p=>!rules.axialEquals(p,exit)&&has(p);
    assert.equal(rules.isPlayerTankEvacTurn(scene.mission,sign),true);
    scene.mission.data.objective.evacExitDir=unit.facing;
    assert.equal(rules.isPlayerTankEvacTurn(scene.mission,sign),false);
  }
});

test('turn exit exceptions preserve prerequisites, exit geometry, bridge rules and player-only restrictions', () => {
  for(const blocked of ['direction','tile','prerequisite','bridge','paralyzed','pvp','other-unit']) {
    const {scene,map,unit}=turnExitFixture();
    if(blocked==='direction')scene.mission.data.objective.evacExitDir=1;
    if(blocked==='tile')scene.mission.data.objective.evacAt=rules.axialToOffset({q:4,r:1});
    if(blocked==='prerequisite') {scene.mission.data.objective.kind='truck';scene.mission.enemies=[{kind:'truck',destroyed:false}];}
    if(blocked==='bridge')Object.assign(map.get(unit.pos),{terrain:'water',bridgeEnds:[1,4]});
    if(blocked==='paralyzed')unit.paralyzed=true;
    if(blocked==='other-unit')scene.mission.playerTank=scene.mission.sherman=tank('sherman');
    try {
      GameSession.isPvp=blocked==='pvp';
      assert.equal(scene.canTwoHexTurn(unit,1),false,blocked);
      if(blocked!=='other-unit') {
        scene.tryTurnSherman(0,1);
        assert.equal(scene.phaseDice[0].used,false,blocked);assert.equal(scene.anim,undefined,blocked);
      }
    } finally {GameSession.isPvp=false;}
  }
  const {scene,map,unit}=turnExitFixture();
  Object.assign(map.get(unit.pos),{terrain:'water',bridgeEnds:[0,3]});
  assert.equal(scene.canTwoHexTurn(unit,1),true);
  unit.stats={...unit.stats,footprintLength:1};
  assert.equal(rules.isPlayerTankEvacTurn(scene.mission,1),false,'ordinary turns do not travel through an exit');
});

test('turn evacuation can cross into a connected campaign segment only through its entry', () => {
  const {scene,map}=turnExitFixture();const entry={q:5,r:0};
  map.set({pos:entry,terrain:'field'});scene.canMoveToBattleTile=()=>false;
  assert.equal(scene.canTwoHexTurn(scene.mission.sherman,1),false);
  scene.isCampaignNextSegmentEntry=p=>rules.axialEquals(p,entry);
  assert.equal(scene.canTwoHexTurn(scene.mission.sherman,1),true);
  scene.tryTurnSherman(0,1);assert.equal(scene.anim.evacExit,true);
});

test('campaign auto evacuation can finish directly with either translating turn', () => {
  for(const sign of [-1,1]) {
    const {scene}=turnExitFixture(sign);
    Object.assign(scene,{campaignAutoEvacActive:true,activeCampaignSegmentIndex:0,
      campaignRuntime:{segments:[{axialQOffset:-2,axialROffset:-2}]},
      clearGunSelection(){},refreshStatusPanel(){}});
    scene.beginCampaignAutoEvac();
    assert.equal(scene.animQueue.length,0);assert.equal(scene.anim.kind,'turn');
    assert.equal(scene.anim.evacExit,true);assert.equal(scene.anim.turnTo,0);
    assert.deepEqual([scene.anim.toQ,scene.anim.toR],[5,0]);
  }
});

test('campaign auto evacuation queues one exit move and can reverse out with the rear cell first', () => {
  for (const reverse of [false,true]) {
    const {scene,map,unit}=sceneFixture();
    unit.pos={q:3,r:0};unit.facing=reverse ? 3 : 0;
    Object.assign(scene,{campaignAutoEvacActive:true,activeCampaignSegmentIndex:0,
      campaignRuntime:{segments:[{axialQOffset:-2,axialROffset:-2}]},
      clearGunSelection(){},refreshStatusPanel(){}});
    scene.beginCampaignAutoEvac();
    const queue=[scene.anim,...scene.animQueue];
    const exits=queue.filter(anim=>anim.evacExit);
    assert.equal(exits.length,1);
    assert.equal(queue.length,reverse ? 1 : 2);
    const exit=exits[0];
    const final={...unit,pos:{q:exit.toQ,r:exit.toR},facing:reverse ? 3 : 0};
    assert(rules.unitOccupiedHexes(final).some(pos=>map.has(pos)));
    assert(rules.unitOccupiedHexes(final).some(pos=>!map.has(pos)));
    assert.equal(reverse ? rules.unitRearHex(final).q : final.pos.q,5);
  }
});

test('repair effects stay at the hull midpoint and use occupied cells for fog checks', () => {
  for (const kind of ['maus','sherman']) for (let facing=0;facing<6;facing++) {
    const {scene}=sceneFixture();const unit=tank(kind,{q:1,r:1});unit.facing=facing;
    const cells=rules.unitOccupiedHexes(unit), visible=cells[cells.length-1];
    Object.assign(scene,{node:{layer:1},mapNode:{children:[],addChild(node){this.children.push(node);}},
      hexSize:60,repairIconSpriteFrame:{},repairIconMaterial:{},repairIndicators:[],
      isHexVisible:pos=>pos.q===visible.q&&pos.r===visible.r});
    scene.spawnRepairIndicator(unit.pos.q,unit.pos.r,unit);
    assert.equal(scene.repairIndicators.length,1);
    const effect=scene.repairIndicators[0], center=rules.unitCenterHex(unit);
    const expected=scene.project(center.q,center.r);
    assert.equal(effect.q,center.q);assert.equal(effect.r,center.r);
    assert.equal(effect.node.position.x,expected.x);assert.equal(effect.node.position.y,expected.y);
    scene.advanceRepairIndicators(0.2);
    assert.equal(scene.repairIndicators.length,1,'a fractional midpoint must not be queried as a map hex');
    assert.equal(effect.node.position.x,expected.x);assert.equal(effect.node.position.y,expected.y);
    scene.isHexVisible=()=>false;scene.advanceRepairIndicators(0.1);
    assert.equal(scene.repairIndicators.length,0);
  }
});

test('riding stays one squad, boards either half and follows the rear hex', () => {
  const carrier=tank();const stats=rules.getUnitStats('german_infantry');
  const foot={id:'rider',kind:'german_infantry',stats,faction:carrier.faction,sideId:carrier.sideId,pos:{...carrier.pos}};
  assert(riding.mountTank(foot,carrier,[carrier,foot],()=>0));
  assert.deepEqual(foot.pos,rules.unitRearHex(carrier));
  const next=rules.planUnitMove(carrier,'cw');carrier.pos=next.pos;carrier.facing=next.facing;riding.syncTankRiders([carrier,foot]);
  assert.deepEqual(foot.pos,rules.unitRearHex(carrier));
});

test('mission save roundtrip derives both occupied hexes and rear turret from kind, front and facing', () => {
  const data=JSON.parse(fs.readFileSync('assets/resources/missions/mission_01.json','utf8'));
  data.enemyStartByDice=false;data.enemies=[];data.sherman={...data.sherman,kind:'maus'};delete data.playerTank;
  const mission=loadMission(data,undefined,{hardcore:true});mission.sherman.facing=1;
  for (const pos of rules.unitOccupiedHexes(mission.sherman)) {
    const key=rules.HexMap.keyOf(pos);mission.smokeHexes.add(key);mission.smokeHexOwners.set(key,'friendly');
  }
  const saved=JSON.parse(JSON.stringify(captureSave({mission,missionId:data.id,gameMode:'hardcore',turn:2,phase:'player',movesLeft:1,attacksLeft:1,miscDone:false,playerStep:'choose',phaseDice:[]})));
  const restored=loadMission(data,undefined,{hardcore:true});assert.equal(applySave(restored,data.id,saved).ok,true);
  assert.deepEqual(rules.unitOccupiedHexes(restored.sherman),rules.unitOccupiedHexes(mission.sherman));
  assert.deepEqual(rules.unitTurretHex(restored.sherman),rules.unitRearHex(mission.sherman));
  assert.deepEqual(Array.from(restored.smokeHexes).sort(),Array.from(mission.smokeHexes).sort());
  for (const key of mission.smokeHexes) assert.equal(restored.smokeHexOwners.get(key),'friendly');
  // Old Maus saves held a single-cell boundary anchor. They are fitted once on migration.
  delete saved.twoHexFootprintVersion;
  const legacy=rules.offsetToAxial(data.sherman.at);
  for(const snapshot of [saved.playerTank,saved.sherman])Object.assign(snapshot,{q:legacy.q,r:legacy.r,facing:data.sherman.facing});
  const migrated=loadMission(data,undefined,{hardcore:true});
  assert.equal(applySave(migrated,data.id,saved).ok,true);
  assert(rules.canDeployTwoHexUnit(migrated.map,migrated.sherman,[migrated.sherman]));
});
