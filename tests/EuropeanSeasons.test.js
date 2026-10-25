const assert = require('node:assert/strict'), test = require('node:test');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), sharp = require('sharp'), crypto = require('node:crypto');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText, filename);
const seasons = require('../assets/scripts/core/TerrainSeason.ts');
const {generateRandomMissionPackage} = require('../assets/scripts/core/RandomMissionGenerator.ts');
const {loadMission} = require('../assets/scripts/core/MissionLoader.ts');
const {captureSave,applySave} = require('../assets/scripts/core/SaveLoad.ts');
const raster = require('../assets/scripts/view/TerrainGroundRaster.ts');
const gpu = require('../assets/scripts/view/TerrainGroundGpuData.ts');
const root=path.resolve(__dirname,'..'), live=path.join(root,'assets/resources/textures/terrain');
const base=JSON.parse(fs.readFileSync(path.join(live,'redesign_v3/materials.json')));
const styles=[['spring','none','spring'],['summer','none','summer'],['autumn','none','autumn'],['winter','none','winter_bare'],['winter','snow','winter_snow']];
const packs=Object.fromEntries(seasons.EXTRA_EUROPEAN_LOOKS.map(id=>[id,JSON.parse(fs.readFileSync(path.join(live,`seasons/${id}/materials.json`)))]));

test('four seasons resolve five appearances; legacy winter keeps snow and weather is independent',()=>{
  assert.equal(seasons.europeanTerrainLook(), 'summer');
  assert.equal(seasons.europeanTerrainLook({season:'winter'}), 'winter_snow');
  assert.equal(seasons.europeanTerrainLook({season:'winter',snowCover:'invalid'}), 'winter_snow');
  for(const [season,snowCover,look] of styles)for(const weather of ['clear','rain','fog','light_snow','heavy_snow']) {
    assert.equal(seasons.europeanTerrainLook({season,snowCover,weather}),look);
    assert.equal(seasons.europeanTerrainLook({theater:'pacific',season,snowCover}), 'summer');
    assert.equal(seasons.usesSnowTerrain({season,snowCover}),look==='winter_snow');
  }
  assert.equal(seasons.europeanTerrainLook({season:'autumn',snowCover:'snow'}),'autumn');
  assert.equal(seasons.europeanTerrainLook({season:'unknown'}),'summer');
});

test('seasonal random missions preserve terrain, enemies, objectives and events for the same seed',()=>{
  const reference=generateRandomMissionPackage('europe',20261024);
  for(const [season,snowCover,look] of styles) {
    const candidate=generateRandomMissionPackage('europe',20261024,{season,snowCover});
    assert.equal(seasons.europeanTerrainLook(candidate.mission),look);
    const label={spring:'春季',summer:'欧洲',autumn:'秋季',winter_bare:'冬季无雪',winter_snow:'冬季积雪'}[look];
    assert(candidate.mission.name.includes(label),'mission name identifies its appearance');
    for(const key of ['tiles','enemies','objective','playerTank'])assert.deepEqual(candidate.mission[key],reference.mission[key]);
    assert.deepEqual(candidate.turnEndEvents,reference.turnEndEvents);
  }
});

test('JSON saves restore all five appearances independently of changed mission defaults; legacy saves retain mission season',()=>{
  for(const [season,snowCover,look] of styles) {
    const pkg=generateRandomMissionPackage('europe',4403,{season,snowCover,weather:'rain'});
    const mission=loadMission(pkg.mission);
    const save=JSON.parse(JSON.stringify(captureSave({gameMode:'classic',missionId:mission.data.id,mission,turn:2,phase:'player',movesLeft:2,attacksLeft:1,miscDone:false,playerStep:'choose',hatchChangedThisTurn:false,phaseDice:[]})));
    const resumed=loadMission({...pkg.mission,season:'summer',snowCover:'none'});
    assert.equal(applySave(resumed,resumed.data.id,save).ok,true);
    assert.equal(seasons.europeanTerrainLook(resumed.data),look);
    assert.equal(resumed.data.weather,'rain');
    delete save.season;delete save.snowCover;
    const legacy=loadMission({...pkg.mission,season:'winter',snowCover:undefined});
    assert.equal(applySave(legacy,legacy.data.id,save).ok,true);
    assert.equal(seasons.europeanTerrainLook(legacy.data),'winter_snow');
  }
});

test('production assets have stable Cocos metadata, real transparency, all road variants and no snow in bare materials',async()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'source_art/terrain/seasons-design-20261024/production-manifest.json')));
  const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
  assert.equal(sha(fs.readFileSync(path.join(live,'redesign_v3/materials.json'))),manifest.baseline.materials);
  const uuids=new Set();
  for(const entry of manifest.files) {
    const file=path.join(root,entry.path),meta=JSON.parse(fs.readFileSync(file+'.meta'));
    assert.equal(sha(fs.readFileSync(file)),entry.sha256,entry.path);
    assert(!uuids.has(meta.uuid),'unique imported asset UUID: '+entry.path);uuids.add(meta.uuid);
    if(file.endsWith('.png')) {
      const frame=Object.values(meta.subMetas).find(m=>m.importer==='sprite-frame');
      assert.equal(frame.userData.packable,false);
      const image=await sharp(file).metadata();assert(image.hasAlpha);
      assert.equal(frame.userData.width,image.width);assert.equal(frame.userData.height,image.height);
    }
  }
  const summerRoads=fs.readdirSync(path.join(live,'european_roads')).filter(f=>/^european_road_surface_summer_[01]{6}_v[123]\.png$/.test(f));
  for(const look of seasons.EXTRA_EUROPEAN_LOOKS) {
    assert.equal(packs[look].winterArtwork,undefined);
    for(const name of summerRoads)assert(fs.existsSync(path.join(live,'european_roads',name.replace('summer',look))));
    for(let i=1;i<=4;i++) {
      const data=await sharp(path.join(live,`seasons/${look}/tree_0${i}.png`)).ensureAlpha().raw().toBuffer();
      const alpha=Array.from({length:data.length/4},(_,i)=>data[i*4+3]);
      assert(alpha.some(v=>v===0)&&alpha.some(v=>v>200),'tree needs true clear background and visible branches');
      if(look==='winter_bare')for(let j=0;j<data.length;j+=4)if(data[j+3]>180)assert(Math.min(data[j],data[j+1],data[j+2])<205,'no white snow on bare branches');
    }
  }
  for(const id of ['grass','mud','soil','forest_floor','road_surface','rural_yard']) {
    const pixels=Buffer.from(packs.winter_bare.materials[id].rgb,'base64');
    for(let i=0;i<pixels.length;i+=3)assert(Math.min(pixels[i],pixels[i+1],pixels[i+2])<225,`no snow/white frost in bare ${id}`);
  }
});

test('CPU and GPU select the same seasonal substrates, with independent floors and continuous chunk borders',()=>{
  const bundle={...base,europeanSeasons:packs},tiles=[];
  for(let r=-2;r<6;r++)for(let q=-2;q<6;q++)tiles.push({pos:{q,r},terrain:q===0?'water':q===2?'forest':q===3?'mud':'field',...(r===1?{roads:[true,false,false,true,false,false]}:{})});
  for(const [season,snowCover,look] of styles) {
    const pack=raster.selectEuropeanTerrainBundle(bundle,look),snow=look==='winter_snow';
    assert.equal(pack,packs[look]??(snow?base.europeanWinter:base.europeanSummer));
    const engine=new raster.TerrainGroundRaster(pack),data=new gpu.TerrainGroundGpuData(pack),encoded=data.tileData(tiles,snow);
    const atlas=data.atlas();assert(atlas.width<=2048&&atlas.height<=2048);
    if(!snow)for(let i=0;i<encoded.ground.length;i+=4)if(encoded.ground[i])assert(!gpu.GPU_MATERIALS[encoded.ground[i]-1].startsWith('winter'));
    assert.notDeepEqual(engine.renderChunk([{pos:{q:0,r:0},terrain:'field'}],snow,0,0,32,32).pixels,engine.renderChunk([{pos:{q:0,r:0},terrain:'forest'}],snow,0,0,32,32).pixels);
    const a=engine.renderChunk(tiles,snow,0,0,64,64,2),b=engine.renderChunk(tiles,snow,64,0,64,64,2),c=engine.renderChunk(tiles,snow,0,64,64,64,2);
    for(let p=0;p<a.textureHeight;p++)for(let s=0;s<2;s++)for(let k=0;k<4;k++)assert(Math.abs(a.pixels[(p*a.textureWidth+128+s)*4+k]-b.pixels[(p*b.textureWidth+s)*4+k])<=1,look+' horizontal border');
    for(let p=0;p<a.textureWidth;p++)for(let s=0;s<2;s++)for(let k=0;k<4;k++)assert(Math.abs(a.pixels[((128+s)*a.textureWidth+p)*4+k]-c.pixels[(s*c.textureWidth+p)*4+k])<=1,look+' vertical border');
  }
});

test('changing the appearance releases ground caches even with identical tiles and snow boolean',()=>{
  function load(file,deps) {const m={exports:{}};new Function('module','exports','require',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(m,m.exports,n=>{if(!(n in deps))throw Error(n);return deps[n];});return m.exports;}
  const {TerrainGroundRenderer}=load('assets/scripts/view/TerrainGroundRenderer.ts',{'cc':{},'./TerrainGroundRaster':raster,'./TerrainGroundGpuData':gpu,'./TerrainGroundGpuBaker':{}});
  let releases=0;
  const renderer={destroyed:false,bundle:{...base,europeanSeasons:packs},chunks:new Map(),queue:[],style:'',cancelWork(){this.queue=[];},releaseChunks(){releases++;},position(){}};
  const tiles=[{pos:{q:0,r:0},terrain:'field'}];
  for(const look of ['summer','spring','autumn','winter_bare']) {
    TerrainGroundRenderer.prototype.draw.call(renderer,tiles,false,48,0,0,true,look);
    assert.equal(renderer.data.bundle,packs[look]??base.europeanSummer);
  }
  assert.equal(releases,4);
  TerrainGroundRenderer.prototype.draw.call(renderer,tiles,false,60,20,20,true,'winter_bare');
  assert.equal(releases,4,'camera transform reuses the current seasonal cache');
});

test('hidden random-map previews accept null cells; visible previews use the selected season',()=>{
  const source=fs.readFileSync(path.join(root,'assets/scripts/view/MenuOperations.ts'),'utf8');
  const ast=ts.createSourceFile('MenuOperations.ts',source,ts.ScriptTarget.Latest,true);
  const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='MenuOperations');
  const method=cls.members.find(n=>n.name?.getText(ast)==='drawMap').getText(ast);
  const compiled=ts.transpileModule(`class Preview { ${method} };`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  class Color {constructor(r,g,b){this.rgb=[r,g,b];}}
  const hex=require('../assets/scripts/core/HexGrid.ts');
  const Preview=new Function('Color','Graphics','axialToPixel','offsetToAxial','seasonalTerrainRGB','europeanTerrainLook',compiled+'return Preview;')(Color,{},hex.axialToPixel,hex.offsetToAxial,seasons.seasonalTerrainRGB,seasons.europeanTerrainLook);
  const colors=[],g={moveTo(){},lineTo(){},close(){},stroke(){},rect(){},fill(){colors.push(this.fillColor.rgb);}};
  const preview=new Preview();preview.node=()=>({addComponent:()=>g});
  preview.drawMap({},undefined,true,500,200);
  assert.equal(colors.length,48);assert(colors.every(c=>c.join(',')==='0,0,0'));
  for(const [season,snowCover,look] of styles) {
    colors.length=0;preview.drawMap({},{rows:1,cols:1,season,snowCover,tiles:[[{t:'f'}]]},false,500,200);
    assert.deepEqual(colors[0],Array.from(seasons.seasonalTerrainRGB(look,'field')));
  }
});

test('battle selects snow roofs/trees only for accumulated snow, including old winter maps',()=>{
  class Color {constructor(...rgba){this.rgba=rgba;}}
  const Scene=require('./helpers/BattleSceneMethods.cjs')(['usesWinterTerrainVisuals','usesEuropeanSummerVisuals','activeTreeSpriteFrames','ruralRoofFrame'],{...seasons,Color});
  const scene=new Scene();scene.treeSpriteFrames=['base'];scene.europeanSummerTreeSpriteFrames=['seasonal'];scene.winterTreeSpriteFrames=['snow'];
  scene.seasonalTreeFrames=[null,null,null,null];
  scene.redesignObjectFrames={rural_roof_01:'bare-roof',rural_roof_01_snow:'snow-roof',pacific_roof_01:'pacific-roof'};
  for(const [season,snowCover,look] of styles) {
    scene.mission={data:{season,snowCover}};
    assert.equal(scene.usesWinterTerrainVisuals(),look==='winter_snow');
    assert.equal(scene.ruralRoofFrame(0),look==='winter_snow'?'snow-roof':'bare-roof');
    assert.equal(scene.activeTreeSpriteFrames()[0],look==='winter_snow'?'snow':'seasonal');
  }
  scene.mission={data:{theater:'pacific',season:'winter'}};
  assert.equal(scene.ruralRoofFrame(0),'pacific-roof');assert.equal(scene.activeTreeSpriteFrames()[0],'base');
});

test('mission-time artwork loading handles late base assets and ignores callbacks from a previous season',()=>{
  const pending=[],renderers=[],urban=require('../assets/scripts/core/UrbanTerrain.ts');
  class SpriteFrame {} class JsonAsset {}
  class Renderer {constructor(parent,bundle){this.bundle=bundle;renderers.push(this);}destroy(){this.destroyed=true;}}
  const Scene=require('./helpers/BattleSceneMethods.cjs')(['loadMissionTerrainSeason','rebuildSeasonTerrainGround'],{
    ...seasons,resources:{load:(path,type,callback)=>pending.push({path,type,callback})},SpriteFrame,JsonAsset,
    ROAD_CANONICAL_MASKS:urban.ROAD_CANONICAL_MASKS,EUROPEAN_ROAD_VARIANT_COUNT:urban.EUROPEAN_ROAD_VARIANT_COUNT,
    TerrainGroundRenderer:Renderer,console,
  });
  const scene=new Scene();Object.assign(scene,{isValid:true,mission:{data:{season:'spring'}},seasonTerrainEpoch:0,missionTerrainLook:null,
    continuousTerrain:null,terrainLayerNode:{},terrainMaterialBundle:null,urbanOverlaySpriteFrames:{},requestResourceRedraw(){}});
  scene.loadMissionTerrainSeason();const spring=pending.splice(0);
  assert.equal(spring.length,54);assert.equal(scene.pendingSeasonTerrainLoads,54);
  scene.mission.data.season='autumn';scene.loadMissionTerrainSeason();const autumn=pending.splice(0);
  const complete=entry=>entry.callback(null,entry.type===JsonAsset?{json:packs[entry.path.includes('/autumn/')?'autumn':'spring']}:{path:entry.path});
  spring.forEach(complete);assert.equal(scene.pendingSeasonTerrainLoads,54,'obsolete callbacks cannot complete the active batch');
  autumn.forEach(complete);assert.equal(scene.pendingSeasonTerrainLoads,0);assert.equal(renderers.length,0,'wait for common ground data');
  assert(scene.seasonalTreeFrames.every(f=>f.path.includes('/autumn/')));
  scene.terrainMaterialBundle=base;scene.rebuildSeasonTerrainGround();
  assert.equal(renderers.length,1);assert.equal(renderers[0].bundle.europeanSeasons.autumn,packs.autumn);
  scene.loadMissionTerrainSeason();assert.equal(pending.length,0,'same appearance does not reload resources');
  scene.mission.data={season:'winter',snowCover:'none'};scene.loadMissionTerrainSeason();const bare=pending.splice(0);
  assert.equal(renderers[0].destroyed,true);
  scene.mission.data={season:'summer'};scene.loadMissionTerrainSeason();
  assert.equal(scene.pendingSeasonTerrainLoads,0);assert.equal(scene.seasonalYardFrame,null);
  assert(scene.seasonalTreeFrames.every(f=>f===null));
  bare.forEach(complete);assert.equal(scene.pendingSeasonTerrainLoads,0);assert.equal(renderers.at(-1).bundle,base);
});
