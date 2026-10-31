const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),sharp=require('sharp');
const {test}=require('node:test');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const {HexMap,neighbor,offsetToAxial,axialToOffset}=require('../assets/scripts/core/HexGrid.ts');
const {tileHeight,elevationEdges,elevationJoins,isCliffEdge,slopePlacement,slopeSpritePath,SLOPE_SPRITE_PATHS,SLOPE_ART,elevationSurfaceTint,validateElevation,editorCliffState,setEditorCliff,editorElevationTiles}=require('../assets/scripts/core/Elevation.ts');
const {loadMission}=require('../assets/scripts/core/MissionLoader.ts');
const {getUnitStats}=require('../assets/scripts/core/UnitDB.ts');
const {createTankCrew}=require('../assets/scripts/core/types.ts');
const {captureSave,applySave}=require('../assets/scripts/core/SaveLoad.ts');
const {CustomMissionStore}=require('../assets/scripts/core/CustomMissionStore.ts');
function pair(d=0,ha=1,hb=0){const map=new HexMap(5,5),a={pos:{q:0,r:0},terrain:'field',height:ha},b={pos:neighbor(a.pos,d),terrain:'field',height:hb};map.set(a);map.set(b);return{map,a,b};}
function actor(kind,pos,faction='german'){return{id:kind,kind,faction,pos,facing:0,stats:getUnitStats(kind),crew:createTankCrew(getUnitStats(kind))};}
function data(){return{id:'elevation-test',name:'Elevation',description:'Test',theater:'europe',cols:3,rows:3,tiles:Array.from({length:3},()=>Array.from({length:3},()=>({t:'f'}))),sherman:{kind:'sherman',at:{row:0,col:0},facing:0},enemies:[{kind:'infantry',at:{row:2,col:2},facing:3}],objective:{type:'destroy_all_enemies'}};}

test('height defaults to zero; negative/fractional heights work; same-height flags never create slopes',()=>{
  assert.equal(tileHeight({}),0);assert.equal(tileHeight(null),0);
  for(const h of[-3,-.5,0,2.5])validateElevation({height:h});
  for(const height of[NaN,Infinity,-Infinity,'1',null])assert.throws(()=>validateElevation({height}));
  for(const cliff of['1','123456',123456,null])assert.throws(()=>validateElevation({cliff}));
  const p=pair(0,-2,-2);p.a.cliffs=Array(6).fill(true);
  assert.equal(elevationEdges(p.map.all()).length,0);assert.equal(p.map.canTankCrossEdge(p.a.pos,p.b.pos),true);
  p.b.height=-3;const edges=elevationEdges(p.map.all());assert.equal(edges.length,1);assert.equal(edges[0].high,p.a);assert.equal(edges[0].difference,1);
  assert.equal(elevationEdges([p.a]).length,0,'missing tiles are not implicit height-zero terrain');
});

test('all six slopes pass normally; either-side cliffs block both directions for all ground units/factions, including ignoreBreakwater',()=>{
  for(let d=0;d<6;d++)for(const reverseHeight of[false,true])for(const side of['a','b']){
    const p=pair(d,reverseHeight?-2:2,0);
    for(const [kind,faction]of[['sherman','usa'],['panzer4','german'],['type97','japanese'],['t34','soviet'],['truck','german'],['infantry','german'],['american_infantry','usa'],['japanese_infantry','japanese'],['at_gun','german'],['pak38','german']]){
      const u=actor(kind,p.a.pos,faction);assert.equal(p.map.canUnitCrossEdge(p.a.pos,p.b.pos,u),true);
    }
    p[side].cliffs=Array(6).fill(false);p[side].cliffs[side==='a'?d:(d+3)%6]=true;
    assert.equal(p.map.hasCliffBetween(p.a.pos,p.b.pos),true);
    assert.equal(p.map.canTankCrossEdge(p.a.pos,p.b.pos,{ignoreBreakwater:true,faction:'japanese'}),false);
    for(const kind of['sherman','panzer4','truck','infantry','american_infantry','japanese_infantry','at_gun','pak38']){
      const u=actor(kind,p.a.pos);assert.equal(p.map.canUnitCrossEdge(p.a.pos,p.b.pos,u,{ignoreBreakwater:true}),false,`${d} ${side} ${kind}`);
      assert.equal(p.map.canUnitCrossEdge(p.b.pos,p.a.pos,{...u,pos:p.b.pos}),false);
    }
    const edge=elevationEdges(p.map.all())[0];assert.equal(edge.blocked,true);assert.equal(edge.direction,reverseHeight?(d+3)%6:d);
    assert.equal(p.map.hasLineOfSight(p.a.pos,p.b.pos),!reverseHeight,'cliffs do not change height-based sight: only the higher side sees its lower neighbor');
  }
});

test('connected highlands emit only external shared edges, with stable ownership and width scaling',()=>{
  const map=new HexMap(8,8),high=[{q:0,r:0},{q:1,r:0},{q:0,r:1}];
  for(const pos of high){map.set({pos,terrain:'field',height:2});for(let d=0;d<6;d++){const to=neighbor(pos,d);if(!map.has(to))map.set({pos:to,terrain:'field'});}}
  for(const pos of high)map.get(pos).height=2;
  const edges=elevationEdges(map.all());assert.equal(edges.length,12);
  for(const edge of edges){assert.equal(edge.high.height,2);assert.equal(tileHeight(edge.low),0);assert.equal(edge.blocked,false);}
  const keys=items=>items.map(e=>JSON.stringify([e.high.pos,e.low.pos])).sort();
  assert.deepEqual(keys(elevationEdges(map.all().reverse())),keys(edges));
  const p1=slopePlacement({...edges[0],difference:1},48),p4=slopePlacement({...edges[0],difference:4},48);
  assert.equal(p1.x,p4.x);assert.equal(p1.y,p4.y);assert.equal(p1.width,p4.width);assert.ok(p4.height>p1.height);
});

test('editor edits the physical shared edge in both parities, including a neighbor-only flag; clearing does not erase heights',()=>{
  for(const parity of[0,1])for(let dir=0;dir<6;dir++){
    const grid=Array.from({length:5},()=>Array.from({length:5},()=>({t:'f'})));
    const pos=offsetToAxial({row:2,col:2},parity),n=axialToOffset(neighbor(pos,dir),parity),back=(dir+3)%6;
    grid[2][2].height=-1;grid[n.row][n.col].height=2;
    grid[n.row][n.col].cliff=Array.from({length:6},(_,i)=>i===back?'1':'0').join('');
    assert.equal(editorCliffState(grid,2,2,dir,parity),true);setEditorCliff(grid,2,2,dir,false,parity);
    assert.equal(editorCliffState(grid,2,2,dir,parity),false);assert.equal(grid[2][2].height,-1);assert.equal(grid[n.row][n.col].height,2);
    setEditorCliff(grid,2,2,dir,true,parity);
    const edges=elevationEdges(editorElevationTiles(grid,parity));assert.equal(edges.find(e=>e.high.pos.q===neighbor(pos,dir).q&&e.high.pos.r===neighbor(pos,dir).r&&e.low.pos.q===pos.q&&e.low.pos.r===pos.r).blocked,true);
    assert.equal(setEditorCliff(grid,2,2,6,true,parity),false);
  }
});

test('mission/custom export and save restore retain negative heights and opposite-side cliffs without a new save schema',()=>{
  const d=data();d.tiles[0][0].height=-2;Object.assign(d.tiles[0][1],{height:1,cliff:'000100'});
  const pkg={schemaVersion:2,editorVersion:'elevation-v1',savedAt:1,source:'developer',mission:d,turnEndEvents:[]};
  const id=CustomMissionStore.saveTransient('elevation-test',pkg),roundTrip=CustomMissionStore.load(id);
  const live=loadMission(JSON.parse(JSON.stringify(roundTrip.mission))),a=live.sherman.pos,b=neighbor(a,0);
  assert.equal(live.map.get(a).height,-2);assert.equal(live.map.hasCliffBetween(a,b),true);
  const save=JSON.parse(JSON.stringify(captureSave({mission:live,missionId:d.id,turn:2,phase:'player',gameMode:'hardcore',movesLeft:2,attacksLeft:1,miscDone:false,playerStep:'movement',hatchChangedThisTurn:false,phaseDice:[]})));
  const restored=loadMission(d);assert.equal(applySave(restored,d.id,save).ok,true);
  assert.equal(restored.map.get(a).height,-2);assert.equal(restored.map.hasCliffBetween(a,b),true);
  for(const fields of[{height:Infinity},{height:'2'},{cliff:'200000'}]){const bad=data();Object.assign(bad.tiles[0][0],fields);assert.throws(()=>loadMission(bad));}
});

test('production art has 24 independent RGBA resources, explicit untrimmed metadata, and fixed-screen directional lighting',async()=>{
  assert.equal(new Set(SLOPE_SPRITE_PATHS).size,24);const hashes=new Set();
  for(const sprite of SLOPE_SPRITE_PATHS){
    const file=path.join('assets/resources',sprite.replace('/spriteFrame','.png')),meta=JSON.parse(fs.readFileSync(file+'.meta'));
    const result=await sharp(file).raw().toBuffer({resolveWithObject:true});
    assert.equal(result.info.channels,4);assert.equal(result.info.width,SLOPE_ART.width);assert.equal(result.info.height,SLOPE_ART.height);
    assert.equal(meta.subMetas.f9941.userData.trimType,'none');assert.equal(meta.subMetas.f9941.userData.rawWidth,SLOPE_ART.width);
    hashes.add(require('node:crypto').createHash('sha256').update(result.data).digest('hex'));
    assert.ok(result.data.some((v,i)=>i%4===3&&v>0));assert.equal(result.data[3],0,'outside strip remains transparent');
  }
  assert.equal(hashes.size,24,'no direction/camera uses a rotated duplicate of one prelit sprite');
  const manifest=JSON.parse(fs.readFileSync('source_art/terrain/elevation-v1/manifest.json','utf8'));
  const entry=(direction,camera)=>manifest.assets.find(a=>a.direction===direction&&a.camera===camera&&a.blocked);
  assert.ok(entry(0,0).lightLocal[1]<0);assert.ok(entry(3,0).lightLocal[1]>0);
  assert.ok(entry(0,90).lightLocal[1]>0,'map rotation changes the light into map space, keeping it fixed on screen');
});

test('highland surface contrast survives a rain/fog wash and the shoulder remains on the high side',()=>{
  const high=elevationSurfaceTint(1),low=elevationSurfaceTint(-1),ground=120,fog=.76;
  const blend=t=>ground+(t.value-ground)*t.alpha/255;
  assert.ok((blend(high)-ground)*fog>=12,'elevated interior must remain distinguishable after a 24% visibility wash');
  assert.ok((ground-blend(low))*fog>=11,'negative heights must also retain a readable lower plane');
  assert.equal(elevationSurfaceTint(0),null);
  assert.equal(SLOPE_ART.anchorY,.5,'high and low cells share the visible slope face equally');
  assert.ok(SLOPE_ART.heightScale>1,'normal zoom needs a broad contour footprint, not a thin strip');
});

test('normal-zoom grass sprites retain a visible crest-to-foot lightness step after a rain/fog wash',async()=>{
  for(const camera of[0,90])for(let direction=0;direction<6;direction++){
    const file=path.join('assets/resources',slopeSpritePath(direction,false,camera).replace('/spriteFrame','.png'));
    const {data,info}=await sharp(file).resize(96,64).raw().toBuffer({resolveWithObject:true});
    const band=(top,bottom)=>{let sum=0,count=0;for(let y=top;y<bottom;y++)for(let x=34;x<62;x++){
      const i=(y*info.width+x)*4,a=data[i+3]/255,lum=data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722;
      sum+=(lum*a+140*(1-a))*.76;count++;
    }return sum/count;};
    const crest=band(14,21),foot=band(42,50);
    assert.ok(crest-foot>=14,`${direction}/${camera}: crest ${crest.toFixed(1)} vs foot ${foot.toFixed(1)} must be readable at 48px hex radius`);
  }
});

test('all centered slope faces split evenly across the border, and three-height vertices expose all incident materials',()=>{
  for(const blocked of[false,true]) {
    const depth=blocked?SLOPE_ART.cliffDepth:SLOPE_ART.slopeDepth;
    assert.equal(SLOPE_ART.center-(SLOPE_ART.center-depth/2),SLOPE_ART.center+depth/2-SLOPE_ART.center);
  }
  const tiles=[{pos:{q:0,r:0},terrain:'field',height:2},{pos:{q:1,r:0},terrain:'field',height:1},{pos:{q:0,r:1},terrain:'field',height:0}];
  const joins=elevationJoins(elevationEdges(tiles));
  assert.equal(joins.length,3);assert.ok(joins.every(join=>join.neighbors.length===2));
  // A vertex maps to exactly the same geometric point in both sprites, even with unequal height deltas.
  for(const join of joins)for(const neighbor of join.neighbors){
    const back=joins.find(j=>j.edge===neighbor.edge).neighbors.find(n=>n.edge===join.edge);
    const u=.5,v=.5;
    const nu=neighbor.rowU[0]*u+neighbor.rowU[1]*v+neighbor.rowU[2],nv=neighbor.rowV[0]*u+neighbor.rowV[1]*v+neighbor.rowV[2];
    assert.ok(Math.abs(back.rowU[0]*nu+back.rowU[1]*nv+back.rowU[2]-u)<1e-8);
    assert.ok(Math.abs(back.rowV[0]*nu+back.rowV[1]*nv+back.rowV[2]-v)<1e-8);
  }
});

test('the development visual-check entry loads real connected elevation terrain in rain',()=>{
  const mission=JSON.parse(fs.readFileSync('assets/resources/missions/elevation_visual_test.json','utf8'));
  const loaded=loadMission(mission),edges=elevationEdges(loaded.map.all());
  assert.equal(mission.weather,'rain');assert.ok(edges.some(edge=>edge.blocked));assert.ok(edges.some(edge=>!edge.blocked));
  assert.ok(loaded.map.all().filter(tile=>tileHeight(tile)>0).length>6);
  const level=require('../assets/scripts/core/LevelDB.ts').getChapterLevels('test').find(level=>level.missionId===mission.id);
  assert.equal(level.missionPath,'missions/elevation_visual_test');assert.equal(level.alwaysUnlocked,true);
});

test('queued tank moves and off-region movement cannot cross a cliff at execution time',()=>{
  const types=require('../assets/scripts/core/types.ts'),hex=require('../assets/scripts/core/HexGrid.ts');
  const Scene=require('./helpers/BattleSceneMethods.cjs')(['executeEnemyAction'],{...types,...hex});
  for(const regional of[false,true]){
    const {map,a,b}=pair();a.cliffs=[true,false,false,false,false,false];
    const scene=new Scene(),tank=actor('panzer4',a.pos);
    Object.assign(scene,{mission:{map,data:{multiRegion:regional}},canMoveToBattleTile:()=>true,findMoveBlocker:()=>null,
      isOutsidePlayerRegion:()=>true,aiMoveDestinationForAction:()=>b.pos});
    assert.equal(scene.executeEnemyAction(tank,'advance'),'done');assert.equal(scene.anim,undefined);
    assert.deepEqual(tank.pos,a.pos);
  }
});

test('scripted truck route events stop at a cliff but keep ordinary grassy slope movement',()=>{
  const {prepareTurnEndEvent}=require('../assets/scripts/core/TurnEndEventApply.ts'),{RNG}=require('../assets/scripts/core/Dice.ts');
  for(const blocked of[false,true]){
    const d=data();d.sherman.at={row:2,col:0};d.enemies.push({kind:'truck',at:{row:0,col:0},facing:0});
    d.truckPath=[{row:0,col:0},{row:0,col:1}];d.tiles[0][0].t='r';Object.assign(d.tiles[0][1],{t:'r',height:1,...(blocked?{cliff:'000100'}:{})});
    const mission=loadMission(d),truck=mission.enemies.find(u=>u.kind==='truck'),before={...truck.pos};
    const event=prepareTurnEndEvent({missionId:d.id,effectType:'german_truck_move',sumMin:2,sumMax:12,diceCount:2},[3,4],7,{mission,rng:new RNG(1),nextEnemyId:()=>''});
    event.apply();
    if(blocked){assert.equal(event.bodyKey,'tileInspect.cliff');assert.equal(event.germanTruckMoveSegments,undefined);assert.deepEqual(truck.pos,before);}
    else{assert.ok(event.germanTruckMoveSegments.some(s=>s.type==='move'));assert.deepEqual(truck.pos,neighbor(before,0));}
  }
});
