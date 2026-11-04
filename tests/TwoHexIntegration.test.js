const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const rules = Object.assign({}, ...['UnitFootprint', 'TwoHexPath', 'TwoHexDeployment', 'HexGrid', 'types', 'UnitDB', 'Combat', 'ActionDice', 'Objective', 'GameMode', 'Ambush', 'LockedFire', 'FogOfWar', 'Suppression']
  .map(name => require(`../assets/scripts/core/${name}.ts`)));
const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const riding = require('../assets/scripts/core/TankRiding.ts');
const GameSession = { gameMode: 'hardcore', isPvp: false };
const Scene = require('./helpers/BattleSceneMethods.cjs')([
  'tryTurnSherman', 'tryDriveSherman', 'findMoveBlocker', 'canTwoHexTurn', 'unitsOnTileAxial',
  'interpolatedPos', 'tankMachineGunSelection', 'tankMachineGunContext', 'rollHighExplosiveCollateralResults',
], { ...rules, GameSession, t: key => key, Color: class {}, easeOutCubic: t => 1-(1-t)**3,
  rollHEAttack: rules.rollHighExplosiveAttack });

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
    canTurretReachDirection:()=>true, rng:{d6:()=>6},
  });
  return {scene,map,unit};
}

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
  scene.anim={unit,kind:'turn',toQ:0,toR:1,turnTo:1,t:1};
  const end=scene.interpolatedPos(unit);
  assert(Math.abs(end.x-Math.sqrt(3)/4)<1e-12);assert.equal(end.y,0.75);
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

test('evacuation allows two consecutive steps and keeps the tank present until the trailing hex leaves', () => {
  const {scene,map,unit}=sceneFixture();
  scene.mission.data.objective={type:'destroy_kind_evac',evacAt:rules.axialToOffset({q:4,r:0}),evacExitDir:0};
  unit.pos={q:4,r:0};let to={q:5,r:0};
  assert.equal(rules.isPlayerTankEvacDrive(scene.mission,unit.pos,0,1,to),true);
  unit.pos=to;assert(rules.unitOccupiedHexes(unit).some(pos=>map.has(pos)));
  to={q:6,r:0};assert.equal(rules.isPlayerTankEvacDrive(scene.mission,unit.pos,0,1,to),true);
  unit.pos=to;assert(rules.unitOccupiedHexes(unit).every(pos=>!map.has(pos)));
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
  const saved=JSON.parse(JSON.stringify(captureSave({mission,missionId:data.id,gameMode:'hardcore',turn:2,phase:'player',movesLeft:1,attacksLeft:1,miscDone:false,playerStep:'choose',phaseDice:[]})));
  const restored=loadMission(data,undefined,{hardcore:true});assert.equal(applySave(restored,data.id,saved).ok,true);
  assert.deepEqual(rules.unitOccupiedHexes(restored.sherman),rules.unitOccupiedHexes(mission.sherman));
  assert.deepEqual(rules.unitTurretHex(restored.sherman),rules.unitRearHex(mission.sherman));
  // Old Maus saves held a single-cell boundary anchor. They are fitted once on migration.
  delete saved.twoHexFootprintVersion;
  const legacy=rules.offsetToAxial(data.sherman.at);
  for(const snapshot of [saved.playerTank,saved.sherman])Object.assign(snapshot,{q:legacy.q,r:legacy.r,facing:data.sherman.facing});
  const migrated=loadMission(data,undefined,{hardcore:true});
  assert.equal(applySave(migrated,data.id,saved).ok,true);
  assert(rules.canDeployTwoHexUnit(migrated.map,migrated.sherman,[migrated.sherman]));
});
