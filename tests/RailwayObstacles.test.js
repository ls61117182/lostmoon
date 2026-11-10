const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),sharp=require('sharp');
const {test}=require('node:test');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const railway=require('../assets/scripts/core/Railway.ts');
const hedges=require('../assets/scripts/core/RailwayHedges.ts');
const hex=require('../assets/scripts/core/HexGrid.ts');
const rural=require('../assets/scripts/core/RuralBuildings.ts');
const urban=require('../assets/scripts/core/UrbanTerrain.ts');
const raster=require('../assets/scripts/view/TerrainGroundRaster.ts');
const {CustomMissionStore}=require('../assets/scripts/core/CustomMissionStore.ts');
const {OUT,flags}=require('../tools/prepareRailwayArt.cjs');
const Scene=require('./helpers/BattleSceneMethods.cjs')(['ruralBuildingsFor','ruralRoadClearanceFor','ruralPropsFor'],{
  ...rural,...urban,...raster,...railway,
});
function scene(){const s=new Scene();Object.assign(s,{ruralLayoutCache:new Map(),ruralPropCache:new Map(),missionId:'test',usesEuropeanSummerVisuals:()=>true,usesWinterTerrainVisuals:()=>false});return s;}
function grid(){return Array.from({length:5},()=>Array.from({length:5},()=>({t:'f'})));}

test('all six rail edges remove both hedges immediately and reject replacement from either side in both parities',()=>{
  for(const parity of[0,1])for(let d=0;d<6;d++) {
    const tiles=grid(),n=hex.axialToOffset(hex.neighbor(hex.offsetToAxial({row:2,col:2},parity),d),parity),back=(d+3)%6;
    const a=tiles[2][2],b=tiles[n.row][n.col];
    a.h=flags((1<<d)|(1<<((d+1)%6)));b.h=flags((1<<back)|(1<<((back+1)%6)));
    assert.equal(railway.setEditorRailwayConnection(tiles,2,2,d,true,parity),true);
    assert.equal(a.h[d],'0');assert.equal(b.h[back],'0');
    assert.equal(a.h[(d+1)%6],'1');assert.equal(b.h[(back+1)%6],'1');
    assert.equal(hedges.setEditorRailwaySafeHedge(tiles,2,2,d,true,parity),false);
    assert.equal(hedges.setEditorRailwaySafeHedge(tiles,n.row,n.col,back,true,parity),false);
    assert.equal(hedges.setEditorRailwaySafeHedge(tiles,2,2,(d+2)%6,true,parity),true);
    railway.clearEditorRailway(tiles,2,2,parity);
    assert.equal(hedges.setEditorRailwaySafeHedge(tiles,2,2,d,true,parity),true);
  }
});

test('save repair handles neighbour-only rail/hedge flags, preserves unrelated data and is idempotent',()=>{
  for(const parity of[0,1])for(let d=0;d<6;d++)for(const side of['a','b']) {
    const tiles=grid(),n=hex.axialToOffset(hex.neighbor(hex.offsetToAxial({row:2,col:2},parity),d),parity),back=(d+3)%6;
    const a=tiles[2][2],b=tiles[n.row][n.col];
    a.h=flags(1<<d);b.h=flags((1<<back)|(1<<((back+1)%6)));
    if(side==='a')a.rl=flags(1<<d);else b.rl=flags(1<<back);
    a.bd=1;a.height=2;a._note='retain';a.rd='010010';
    const before=structuredClone(tiles),safe=hedges.railwaySafeTiles(tiles,parity);
    assert.deepEqual(tiles,before);assert.equal(safe[2][2].h,undefined);assert.equal(safe[n.row][n.col].h,flags(1<<((back+1)%6)));
    assert.equal(safe[2][2].height,2);assert.equal(safe[2][2].bd,1);assert.equal(safe[2][2]._note,'retain');assert.equal(safe[2][2].rd,'010010');
    assert.equal(hedges.removeRailwayHedgeConflicts(safe,parity),0);
  }
  const tiles=[[{t:'f',h:'100000',rl:'100000'},null]];assert.equal(hedges.removeRailwayHedgeConflicts(tiles),1);assert.equal(tiles[0][0].h,undefined);
});

test('custom and transient package saving both clean conflicts without changing the caller draft',()=>{
  const storage=new Map();global.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  try {
    for(const method of['save','saveTransient']) {
      const pkg={schemaVersion:2,editorVersion:'test',source:'player',savedAt:0,turnEndEvents:[],mission:{id:'hedge-test',name:'Test',rowParityOffset:1,tiles:[[{t:'r',rl:'100000',h:'110000',bd:1},{t:'f',h:'000100'}]]}};
      const id=CustomMissionStore[method](`railway-hedge-${method}`,pkg),saved=CustomMissionStore.load(id);
      assert.equal(saved.mission.tiles[0][0].h,'010000');assert.equal(saved.mission.tiles[0][1].h,undefined);
      assert.equal(saved.mission.tiles[0][0].bd,1);assert.equal(pkg.mission.tiles[0][0].h,'110000');CustomMissionStore.remove(id);
    }
  } finally {delete global.localStorage;}
});

test('rail clearance encloses the actual PNG ballast and timber after every runtime rotation',async()=>{
  for(let mask=1;mask<64;mask++)for(const crossing of[false,true]) {
    const art=railway.railwayArtTransform(flags(mask),crossing),clearance=railway.railwaySurfaceClearance(flags(mask),crossing);
    const file=path.join(OUT,path.basename(art.surface.replace('/spriteFrame',''))+'.png');
    const rotated=await sharp(file).rotate(-art.rotationDegrees,{background:'#00000000'}).png().toBuffer(),m=await sharp(rotated).metadata();
    const raw=await sharp(rotated).extract({left:Math.floor((m.width-256)/2),top:Math.floor((m.height-256)/2),width:256,height:256}).ensureAlpha().raw().toBuffer();
    for(let y=2;y<254;y+=6)for(let x=2;x<254;x+=6) if(raw[(y*256+x)*4+3]>220) {
      assert.ok(clearance((x-127.5)/128,(127.5-y)/128)<.015,`mask ${flags(mask)} crossing ${crossing} omitted visible art at ${x},${y}`);
    }
  }
});

test('all railway shapes retain at least three non-overlapping buildings clear of rails and roads',()=>{
  const s=scene();
  for(const [q,r] of[[0,0],[7,-4],[-3,2]])for(let mask=1;mask<64;mask++)for(const roadMask of[0,9,18,7,63]) {
    const tile={pos:{q,r},terrain:roadMask?'road':'field',railway:flags(mask),...(roadMask?{roads:[...flags(roadMask)].map(c=>c==='1')}:{})};
    const buildings=s.ruralBuildingsFor(tile),clearance=s.ruralRoadClearanceFor(tile);
    assert.ok(buildings.length>=3,`${q},${r} rail ${flags(mask)} road ${flags(roadMask)}`);
    assert.ok(buildings.length<=4);
    for(const b of buildings)for(let iu=0;iu<=4;iu++)for(let iv=0;iv<=4;iv++) {
      const u=iu/4-.5,v=iv/4-.5,c=Math.cos(b.angle),sn=Math.sin(b.angle);
      const x=b.x+u*b.width*c-v*b.height*sn,y=b.y+u*b.width*sn+v*b.height*c;
      assert.ok(clearance(x,y)>=.024,`roof intersects railway/road: ${q},${r} rail ${flags(mask)} road ${flags(roadMask)} clearance ${clearance(x,y)}`);
    }
    for(let i=0;i<buildings.length;i++)for(let j=i+1;j<buildings.length;j++)assert.equal(rural.ruralBuildingsOverlap(buildings[i],buildings[j]),false);
  }
});

test('changing only railway ports invalidates roof and prop layouts, and map/inspector use the same cached layout',()=>{
  const s=scene(),tile={pos:{q:2,r:3},terrain:'field',hasBuilding:true};
  const plain=s.ruralBuildingsFor(tile),props=s.ruralPropsFor(tile);tile.railway='100100';
  const rail=s.ruralBuildingsFor(tile),railProps=s.ruralPropsFor(tile);
  assert.notEqual(plain,rail);assert.notEqual(props,railProps);assert.equal(rail,s.ruralBuildingsFor(tile));
  const clearance=s.ruralRoadClearanceFor(tile);
  for(const p of railProps)assert.ok(clearance(p.x,p.y)>p.size*.71+.024);
  tile.railway='010010';assert.notEqual(s.ruralBuildingsFor(tile),rail);
});

test('vector fallback also renders at least three roofs using the same railway-safe footprints',()=>{
  const {RNG}=require('../assets/scripts/core/Dice.ts');
  const FallbackScene=require('./helpers/BattleSceneMethods.cjs')(['drawBuildingOverlay','ruralBuildingsFor','ruralRoadClearanceFor'],{
    ...rural,...urban,...raster,...railway,RNG,
    BUILDING_ROOF_PALETTE:['roof','roof','roof','roof'],BUILDING_SHADE_PALETTE:['shade','shade','shade','shade'],
    BUILDING_RIDGE_PALETTE:['ridge','ridge','ridge','ridge'],BUILDING_RIB_STROKE:'rib',BUILDING_OUTLINE:'outline',
  });
  const s=new FallbackScene(),g={moveTo(){},lineTo(){},close(){},fill(){},stroke(){}};
  Object.assign(s,{g,mapOcclusionGraphics:g,occlusionShapes:[],ruralLayoutCache:new Map(),missionId:'test',
    usesEuropeanSummerVisuals:()=>true,usesWinterTerrainVisuals:()=>false,hasBunkerAt:()=>false,ruralRoofFrame:()=>null});
  const tile={pos:{q:0,r:0},terrain:'road',roads:[false,true,false,false,true,false],railway:'010100',hasBuilding:true};
  s.drawBuildingOverlay(0,0,48,tile);
  assert.ok(s.occlusionShapes.length>=3);
  const clearance=s.ruralRoadClearanceFor(tile);
  for(const shape of s.occlusionShapes)for(const [x,y]of shape.polygon)assert.ok(clearance(x/48,y/48)>=.024);
});
