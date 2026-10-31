const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (m,file) => m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText,file);
const {HexMap,neighbor,offsetToAxial,axialToOffset}=require('../assets/scripts/core/HexGrid.ts');
const {loadMission}=require('../assets/scripts/core/MissionLoader.ts');
const {getUnitStats}=require('../assets/scripts/core/UnitDB.ts');
const {hitBreakdown,mgHitBreakdown,rollAttack,rollMGAttack,mgHitThreshold}=require('../assets/scripts/core/Combat.ts');
const {trenchCoverModifier,trenchFormationDirections,trenchInfantryOffsets,setEditorFortification,setEditorFortificationConnection}=require('../assets/scripts/core/Fortification.ts');
const {CustomMissionStore}=require('../assets/scripts/core/CustomMissionStore.ts');
const {captureSave,applySave}=require('../assets/scripts/core/SaveLoad.ts');
const {geometry}=require('../tools/prepareFortificationArt.cjs');
const flags=m=>Array.from({length:6},(_,d)=>(m>>d)&1).join('');
const unit=(kind,pos)=>({id:kind,kind,pos,faction:getUnitStats(kind).faction,stats:getUnitStats(kind),facing:0,turretFacing:0});
function context(kind='american_infantry') {
  const target=unit('infantry',{q:0,r:0}),attacker=unit(kind,{q:0,r:-1});
  const map=new HexMap(12,12);
  for(let q=-5;q<=5;q++)for(let r=-5;r<=5;r++)map.set({pos:{q,r},terrain:'field'});
  return {map,target,attacker,hardcoreTankMachineGuns:true};
}
function data() {
  return {id:'trench-test',name:'Trenches',description:'Test',theater:'europe',cols:5,rows:5,
    tiles:Array.from({length:5},()=>Array.from({length:5},()=>({t:'f'}))),
    sherman:{kind:'sherman',at:{col:0,row:0},facing:0},enemies:[{kind:'infantry',at:{col:4,row:4},facing:3}],
    objective:{type:'destroy_all_enemies'}};
}

test('rifles and tank machine guns recognize every open arm for all 64 configurations at multiple ranges',()=>{
  for(const attackerKind of ['american_infantry','sherman']) {
    const ctx=context(attackerKind),tile=ctx.map.get(ctx.target.pos),breakdown=attackerKind==='sherman'?mgHitBreakdown:hitBreakdown;
    for(let mask=0;mask<64;mask++)for(let dir=0;dir<6;dir++)for(const range of [1,3]) {
      const n=neighbor(ctx.target.pos,dir);ctx.attacker.pos={q:n.q*range,r:n.r*range};
      delete tile.fortification;const plain=breakdown(ctx);
      tile.fortification={kind:'trench',connections:flags(mask)};
      const actual=breakdown(ctx),bonus=(mask&(1<<dir))?0:2;
      assert.equal(actual.trench,bonus,`${attackerKind}, ${flags(mask)}, incoming ${dir}`);
      assert.equal(actual.threshold,plain.threshold+bonus);
    }
  }
});

test('the four arrows in the reference are unprotected, while off-axis and closed-side shots gain cover',()=>{
  const ctx=context(),tile=ctx.map.get(ctx.target.pos);
  tile.fortification={kind:'trench',connections:'111100'};
  for(let dir=0;dir<6;dir++)assert.equal(trenchCoverModifier(tile,neighbor(ctx.target.pos,dir),ctx.target.pos),dir<4?0:2);
  assert.equal(trenchCoverModifier(tile,{q:2,r:1},ctx.target.pos),2,'do not round an off-axis shot onto an open arm');
  assert.equal(trenchCoverModifier(tile,ctx.target.pos,ctx.target.pos),0,'a same-hex assault gains no trench cover');
});

test('trench protection takes the highest individual cover, without adding smoke, concealment, forest, buildings or hedges',()=>{
  const ctx=context('sherman'),tile=ctx.map.get(ctx.target.pos);
  tile.fortification={kind:'trench',connections:'100100'};
  const base=mgHitBreakdown(ctx);
  tile.terrain='forest';ctx.target.hidden=true;ctx.target.smoked=true;
  let b=mgHitBreakdown(ctx);
  assert.equal(b.threshold,base.threshold);assert.equal(b.trench,2);
  assert.equal(b.forest+b.smoke+b.concealed,0);
  tile.terrain='urban_indestructible';b=mgHitBreakdown(ctx);
  assert.equal(b.building,3);assert.equal(b.trench,0);assert.equal(b.smoke+b.concealed,0);
  assert.equal(b.threshold,base.threshold+1,'stronger building cover beats trench cover');
  tile.terrain='field';ctx.map.countHedgesAlong=()=>4;b=mgHitBreakdown(ctx);
  assert.equal(b.hedges,4);assert.equal(b.trench+b.smoke+b.concealed,0);
  assert.equal(b.threshold,base.threshold+2);
});

test('aligned fire keeps normal cover rules; guns, tank targets, mounted infantry and same-hex attacks get no new bonus',()=>{
  const ctx=context('sherman'),tile=ctx.map.get(ctx.target.pos);
  tile.fortification={kind:'trench',connections:'000010'};tile.terrain='forest';ctx.target.smoked=true;ctx.target.hidden=true;
  assert.equal(mgHitBreakdown(ctx).trench,0);assert.equal(mgHitBreakdown(ctx).forest,1);
  assert.equal(mgHitBreakdown(ctx).concealed,2,'an open arm removes only the trench bonus');
  tile.fortification.connections='000000';tile.terrain='field';delete ctx.target.smoked;delete ctx.target.hidden;
  assert.equal(hitBreakdown(ctx).trench,0,'tank main guns retain their existing rules');
  ctx.target.mountedOnUnitId='carrier';assert.equal(mgHitBreakdown(ctx).trench,0);delete ctx.target.mountedOnUnitId;
  ctx.target=unit('panzer4',{q:0,r:0});assert.equal(mgHitBreakdown(ctx).trench,0);
  ctx.target=unit('infantry',{q:0,r:0});ctx.attacker.pos={q:0,r:0};assert.equal(mgHitBreakdown(ctx).trench,0);
});

test('real rifle and MG hit rolls use the directional protection threshold',()=>{
  for(const kind of ['american_infantry','sherman']) {
    const ctx=context(kind),tile=ctx.map.get(ctx.target.pos);
    const threshold=kind==='sherman'?mgHitThreshold(ctx):hitBreakdown(ctx).threshold;
    tile.fortification={kind:'trench',connections:'100100'};
    const roll=kind==='sherman'?rollMGAttack(ctx,{d6:()=>threshold}):rollAttack(ctx,{d6:()=>threshold/2});
    assert.equal(roll.hit,false);assert.equal(roll.threshold,threshold+2);assert.equal(roll.hitBreakdown.trench,2);
    tile.fortification.connections='000010';
    const aligned=kind==='sherman'?rollMGAttack(ctx,{d6:()=>threshold}):rollAttack(ctx,{d6:()=>threshold/2});
    assert.equal(aligned.hit,true);assert.equal(aligned.threshold,threshold);
  }
});

test('all formations select the most separated arms and remain on the exported trench floor',()=>{
  for(let mask=0;mask<64;mask++) {
    const connections=flags(mask),directions=trenchFormationDirections(connections);
    const tile={fortification:{kind:'trench',connections}};
    const offsets=trenchInfantryOffsets(tile,128),floor=geometry('trench',mask).sdf;
    assert.deepEqual(offsets[0],{ox:0,oy:0});assert.equal(offsets.length,3);
    for(const off of offsets)assert.ok(floor(off.ox,-off.oy)<=0,`${connections}: soldier must stand on the trench floor`);
    if(directions.length===2) {
      const separation=(a,b)=>Math.min(Math.abs(a-b),6-Math.abs(a-b));
      const chosen=separation(...directions);
      for(let a=0;a<6;a++)for(let b=a+1;b<6;b++)if(connections[a]==='1'&&connections[b]==='1')assert.ok(chosen>=separation(a,b));
    }
  }
  assert.equal(trenchInfantryOffsets({fortification:{kind:'gun_pit',connections:'100100'}},128),null,'gun pits keep the existing triangle');
});

test('editor connections, mission import/export and battle save/load preserve static earthworks',()=>{
  for(const parity of [0,1])for(let d=0;d<6;d++) {
    const mission=data(),grid=mission.tiles,start={row:2,col:2};
    const other=axialToOffset(neighbor(offsetToAxial(start,parity),d),parity);
    setEditorFortification(grid,2,2,'trench');setEditorFortification(grid,other.row,other.col,'gun_pit');
    setEditorFortificationConnection(grid,2,2,d,true,parity);
    assert.equal(grid[other.row][other.col].fort.connections[(d+3)%6],'1');
    setEditorFortificationConnection(grid,2,2,d,false,parity);
    assert.equal(grid[other.row][other.col].fort.connections[(d+3)%6],'0');
  }
  const mission=data();mission.tiles[2][2].rid=1;
  setEditorFortification(mission.tiles,2,2,'trench');setEditorFortificationConnection(mission.tiles,2,2,0,true);
  const storage=new Map();global.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  CustomMissionStore.save('trench-test',{schemaVersion:2,editorVersion:'1',savedAt:0,source:'player',mission,turnEndEvents:[]});
  const imported=JSON.parse(JSON.stringify(CustomMissionStore.load('trench-test'))).mission;
  const loaded=loadMission(imported),pos=offsetToAxial({row:2,col:2});
  assert.deepEqual(loaded.map.get(pos).fortification,{kind:'trench',connections:'100000'});
  assert.equal(loaded.map.get(pos).reinforceId,1);
  const save=JSON.parse(JSON.stringify(captureSave({mission:loaded,missionId:mission.id,turn:2,phase:'player',gameMode:'hardcore',movesLeft:2,attacksLeft:1,miscDone:false,playerStep:'movement',hatchChangedThisTurn:false,phaseDice:[]})));
  const restored=loadMission(imported);assert.equal(applySave(restored,mission.id,save).ok,true);
  assert.deepEqual(restored.map.get(pos).fortification,loaded.map.get(pos).fortification);
  for(const bad of [{kind:'trench',connections:'1'},{kind:'invalid',connections:'000000'},null]) {
    const broken=data();broken.tiles[2][2].fort=bad;assert.throws(()=>loadMission(broken));
  }
  const wet=data();wet.tiles[2][2]={t:'w',fort:{kind:'trench',connections:'000000'}};assert.throws(()=>loadMission(wet),/dry land/);
});

test('earthworks do not change sight blocking or tank/infantry entry permissions',()=>{
  const ctx=context(),tile=ctx.map.get({q:0,r:0});
  assert.equal(ctx.map.hasLineOfSight({q:-2,r:0},{q:2,r:0}),true);
  tile.fortification={kind:'trench',connections:'111111'};
  assert.equal(ctx.map.hasLineOfSight({q:-2,r:0},{q:2,r:0}),true);
  assert.equal(ctx.map.canTankEnter(tile.pos),true);assert.equal(ctx.map.canUnitEnter(tile.pos),true);
  tile.fortification.kind='gun_pit';assert.equal(ctx.map.lineOfSightBlockedByTile(tile),false);
  tile.terrain='forest';assert.equal(ctx.map.lineOfSightBlockedByTile(tile),true,'underlying forest still blocks sight');
});
