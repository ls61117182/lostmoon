const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),sharp=require('sharp');
const {test}=require('node:test');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const railway=require('../assets/scripts/core/Railway.ts');
const {HexMap,neighbor,offsetToAxial,axialToOffset}=require('../assets/scripts/core/HexGrid.ts');
const {effectiveDiceTerrain,tileForbidsConcealment,tileHasBuilding}=require('../assets/scripts/core/types.ts');
const {tileMoveCost}=require('../assets/scripts/core/MoveCost.ts');
const {actionDicePool}=require('../assets/scripts/core/ActionDice.ts');
const {loadMission}=require('../assets/scripts/core/MissionLoader.ts');
const {CustomMissionStore}=require('../assets/scripts/core/CustomMissionStore.ts');
const {captureSave,applySave}=require('../assets/scripts/core/SaveLoad.ts');
const {infantryHighExplosiveCoverSource}=require('../assets/scripts/core/Combat.ts');
const {roadSpriteTransform}=require('../assets/scripts/core/UrbanTerrain.ts');
const {OUT,SOURCE,GAUGE,A,flags}=require('../tools/prepareRailwayArt.cjs');
const {parseRailway,railwayArtTransform,railwayHasCrossing,setEditorRailwayConnection,clearEditorRailway}=railway;
function data(){return{id:'railway-test',name:'Railway',description:'Test',theater:'europe',cols:4,rows:3,tiles:Array.from({length:3},()=>Array.from({length:4},()=>({t:'f'}))),sherman:{kind:'sherman',at:{row:0,col:0},facing:0},enemies:[{kind:'infantry',at:{row:2,col:3},facing:3}],objective:{type:'destroy_all_enemies'}};}

test('railway overlays preserve movement, dice, concealment, sight and cover on all three base terrains',()=>{
  for(const terrain of['field','road','mud']) {
    const plain={pos:{q:0,r:0},terrain},overlay={...plain,railway:'100100'};
    assert.equal(effectiveDiceTerrain(overlay),terrain);
    assert.equal(tileMoveCost(overlay),tileMoveCost(plain));
    assert.equal(tileForbidsConcealment(overlay),tileForbidsConcealment(plain));
    assert.equal(tileHasBuilding(overlay),false);
    for(const hardcore of[false,true])for(const subPhase of['movement','attack','misc']) {
      const options={subPhase,hardcore,hatchOpen:true,crew:{commander:true,gunner:true,loader:true,driver:true,coDriver:true}};
      assert.equal(actionDicePool({...options,terrain:effectiveDiceTerrain(overlay)}),actionDicePool({...options,terrain}));
    }
    for(const direction of[0,1,2,3,4,5]) {
      const maps=[plain,overlay].map(tile=>{const map=new HexMap(5,5);map.set(tile);for(let d=0;d<6;d++)map.set({pos:neighbor(tile.pos,d),terrain:'field'});return map;});
      for(const faction of['usa','german','soviet','japanese'])assert.equal(maps[1].canTankCrossEdge(neighbor(overlay.pos,direction),overlay.pos,{faction}),maps[0].canTankCrossEdge(neighbor(plain.pos,direction),plain.pos,{faction}));
      assert.equal(maps[1].hasLineOfSight(neighbor(overlay.pos,direction),neighbor(overlay.pos,(direction+3)%6)),maps[0].hasLineOfSight(neighbor(plain.pos,direction),neighbor(plain.pos,(direction+3)%6)));
      const cover=map=>infantryHighExplosiveCoverSource({map,attacker:{kind:'sherman',pos:neighbor(plain.pos,direction),faction:'usa'},target:{kind:'infantry',pos:plain.pos,faction:'german'}});
      assert.equal(cover(maps[1]),cover(maps[0]));
    }
    assert.equal(tileMoveCost(overlay),terrain==='mud'?2:1);
  }
});

test('mission load and custom save roundtrip preserve railway independently of road direction and base terrain',()=>{
  const mission=data();
  for(const [col,t]of['f','r','m'].entries())mission.tiles[1][col]={t,rl:'100100',...(t==='r'?{rd:'010010'}:{})};
  const id=CustomMissionStore.saveTransient('railway-roundtrip',{schemaVersion:2,editorVersion:'1',source:'player',savedAt:0,turnEndEvents:[],mission});
  const pkg=CustomMissionStore.load(id),loaded=loadMission(pkg.mission,()=>.5);
  for(let col=0;col<3;col++) {
    const tile=loaded.map.get(offsetToAxial({row:1,col}));
    assert.equal(tile.railway,'100100');assert.equal(tile.terrain,['field','road','mud'][col]);
    if(col===1)assert.deepEqual(tile.roads,[false,true,false,false,true,false]);
  }
  const save=captureSave({mission:loaded,missionId:mission.id,missionSource:{type:'custom',packageId:id},gameMode:'hardcore',turn:1,phase:'player',movesLeft:0,attacksLeft:0,miscDone:false,playerStep:'movement',hatchChangedThisTurn:false,phaseDice:[]});
  const restored=loadMission(CustomMissionStore.load(id).mission,()=>.5);
  assert.equal(applySave(restored,mission.id,save).ok,true);
  assert.equal(restored.map.get(offsetToAxial({row:1,col:2})).railway,'100100');
  assert.equal(tileMoveCost(restored.map.get(offsetToAxial({row:1,col:2}))),2);
});

test('railway input rejects unsupported terrain and malformed directions without creating new terrain rules',()=>{
  for(const terrain of['field','road','mud'])assert.equal(parseRailway('100100',terrain),'100100');
  assert.equal(parseRailway(undefined,'field'),undefined);assert.equal(parseRailway('000000','field'),undefined);
  for(const value of['',null,12,'10010','1001001','10010x','200100'])assert.throws(()=>parseRailway(value,'field'),/six/);
  for(const terrain of['water','deep_water','forest','urban_road','airstrip','beach'])assert.throws(()=>parseRailway('100100',terrain),/field, road or mud/);
  const mission=data();mission.tiles[0][1]={t:'w',rl:'100100'};assert.throws(()=>loadMission(mission,()=>.5),/Railway/);
});

test('editor synchronizes all six railway ports in both row parities and removes stale neighbours after terrain change',()=>{
  for(const parity of[0,1])for(let dir=0;dir<6;dir++) {
    const grid=Array.from({length:5},()=>Array.from({length:5},()=>({t:'f'}))),center=grid[2][2];
    const n=axialToOffset(neighbor(offsetToAxial({row:2,col:2},parity),dir),parity),other=grid[n.row][n.col],back=(dir+3)%6;
    assert.equal(setEditorRailwayConnection(grid,2,2,dir,true,parity),true);
    assert.equal(center.rl[dir],'1');assert.equal(other.rl[back],'1');
    setEditorRailwayConnection(grid,2,2,dir,false,parity);assert.equal(center.rl,undefined);assert.equal(other.rl,undefined);
    setEditorRailwayConnection(grid,2,2,dir,true,parity);center.t='w';clearEditorRailway(grid,2,2,parity);
    assert.equal(center.rl,undefined);assert.equal(other.rl,undefined);assert.equal(center.t,'w');
    assert.equal(setEditorRailwayConnection(grid,2,2,dir,true,parity),false);
    center.t='m';other.t='F';setEditorRailwayConnection(grid,2,2,dir,true,parity);assert.equal(other.rl,undefined);assert.equal(center.t,'m');
  }
});

test('all 63 nonempty connections reuse road rotations; crossing keeps rails on top of timber',async()=>{
  const uuids=new Set();
  assert.equal(railway.RAILWAY_ART_MASKS.length,13);
  for(const mask of railway.RAILWAY_ART_MASKS)for(const crossing of[false,true]) {
    const art=railwayArtTransform(flags(mask),crossing),name=path.basename(art.surface.replace('/spriteFrame',''))+'.png';
    const m=JSON.parse(fs.readFileSync(path.join(OUT,name+'.meta'),'utf8'));
    assert.equal(uuids.has(m.uuid),false);uuids.add(m.uuid);
    const f=m.subMetas.f9941.userData;assert.equal(f.trimType,'none');assert.equal(f.packable,false);assert.equal(f.pivotX,.5);assert.equal(f.pivotY,.5);
    assert.deepEqual(f.vertices.minPos,[-128,-128,0]);assert.deepEqual(f.vertices.maxPos,[128,128,0]);
    const {data,info}=await sharp(path.join(OUT,name)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,256);assert.equal(info.height,256);assert.equal(data[3],0);
    assert.ok(data.some((v,i)=>i%4===3&&v===255));
  }
  for(let mask=1;mask<64;mask++) {
    const actual=railwayArtTransform(flags(mask)),expected=roadSpriteTransform([...flags(mask)].map(c=>c==='1'));
    assert.equal(actual.rotationDegrees,expected.rotationDegrees);assert.equal(actual.canonicalMask,expected.canonicalMask);
  }
  for(const crossing of[false,true]) {
    const art=railwayArtTransform('100100',crossing),file=path.join(OUT,path.basename(art.surface.replace('/spriteFrame',''))+'.png');
    const raw=await sharp(file).ensureAlpha().raw().toBuffer();
    for(let x=108;x<148;x++)for(const y of[117,139]) {
      const i=(y*256+x)*4;assert.equal(raw[i+3],255);assert.ok(raw[i]+raw[i+1]+raw[i+2]>350,'steel rail remains visible through timber');
    }
  }
});

test('rotated PNG rail mouths align to both railheads on every configured hex edge',async()=>{
  for(let mask=1;mask<64;mask++) {
    const art=railwayArtTransform(flags(mask)),name=path.basename(art.surface.replace('/spriteFrame',''))+'.png';
    const rotated=await sharp(path.join(OUT,name)).rotate(-art.rotationDegrees,{background:'#00000000'}).png().toBuffer();
    const m=await sharp(rotated).metadata();
    const raw=await sharp(rotated).extract({left:Math.floor((m.width-256)/2),top:Math.floor((m.height-256)/2),width:256,height:256}).ensureAlpha().raw().toBuffer();
    for(let d=0;d<6;d++) {
      const a=d*Math.PI/3;
      for(const v of[-GAUGE/2,GAUGE/2]) {
        const x=Math.round(127.5+Math.cos(a)*(A-2)-Math.sin(a)*v),y=Math.round(127.5+Math.sin(a)*(A-2)+Math.cos(a)*v),i=(y*256+x)*4;
        if(mask&(1<<d))assert.ok(raw[i+3]>210,`mask ${flags(mask)}, port ${d}, rail ${v} has a gap`);
        else assert.ok(raw[i+3]<20,`mask ${flags(mask)} leaks into unused port ${d}`);
      }
    }
  }
});

test('crossing appearance distinguishes parallel road and rail without changing the underlying road rules',()=>{
  assert.equal(railwayHasCrossing({terrain:'field',railway:'100100'}),false);
  assert.equal(railwayHasCrossing({terrain:'road',railway:'100100'}),true);
  assert.equal(railwayHasCrossing({terrain:'road',railway:'100100',roads:[true,false,false,true,false,false]}),false);
  assert.equal(railwayHasCrossing({terrain:'road',railway:'100100',roads:[false,true,false,false,true,false]}),true);
});

test('standalone configurator embeds all production assets and contains valid JavaScript',()=>{
  const html=fs.readFileSync(path.join(SOURCE,'configurator.html'),'utf8');
  assert.equal((html.match(/data:image\/png;base64,/g)||[]).length,29);
  assert.doesNotThrow(()=>new(require('node:vm').Script)(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
});

test('battle renderer reuses pooled square sprites with the road rotation convention and crossing artwork',()=>{
  class UITransform {}
  const Scene=require('./helpers/BattleSceneMethods.cjs')(['drawRailwayOverlay'],{
    railwayArtTransform,railwayHasCrossing,UITransform,BattleScene:{TERRAIN_SPRITE_POOL:100},
  });
  const scene=new Scene(),calls=[];
  const node={getComponent:()=>({setContentSize:(...args)=>calls.push(['size',...args])}),setPosition:(...args)=>calls.push(['position',...args]),setRotationFromEuler:(...args)=>calls.push(['rotation',...args]),setScale(){},active:false};
  const slot={node,sprite:{}};
  scene.railwaySpritePool=[slot];scene.railwaySpritePoolNext=0;
  scene.ensureScenerySlot=()=>true;
  const art=railwayArtTransform('010010',true),frame={};scene.urbanOverlaySpriteFrames={[art.surface]:frame};
  scene.drawRailwayOverlay(42,63,48,{terrain:'road',railway:'010010',roads:[true,false,false,true,false,false]});
  assert.equal(slot.sprite.spriteFrame,frame);assert.equal(node.active,true);assert.equal(scene.railwaySpritePoolNext,1);
  assert.deepEqual(calls,[['size',96,96],['position',42,63,0],['rotation',0,0,art.rotationDegrees]]);
  scene.drawRailwayOverlay(0,0,48,{terrain:'field'});assert.equal(scene.railwaySpritePoolNext,1);
  scene.drawRailwayOverlay(0,0,48,{terrain:'field',railway:'100100'});assert.equal(scene.railwaySpritePoolNext,1,'missing frames do not consume slots');
});

test('the importable demonstration mission uses reciprocal rails on supported terrain with road crossings',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(SOURCE,'railway-demo-mission.json'),'utf8'));
  const loaded=loadMission(pkg.mission,()=>.5);
  const rails=loaded.map.all().filter(tile=>tile.railway);
  assert.ok(rails.length>10);assert.ok(rails.some(railwayHasCrossing));
  assert.ok(rails.some(tile=>tile.terrain==='mud'));
  for(const tile of rails)for(let d=0;d<6;d++)if(tile.railway[d]==='1') {
    const next=loaded.map.get(neighbor(tile.pos,d));
    assert.equal(next?.railway?.[(d+3)%6],'1');
    assert.ok(['field','road','mud'].includes(tile.terrain));
  }
});
