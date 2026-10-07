const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
function load(file,deps={}){const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;const module={exports:{}};new Function('module','exports','require',code)(module,module.exports,name=>{if(name in deps)return deps[name];throw Error('Unexpected dependency '+name);});return module.exports;}
const urbanRoads=load('assets/scripts/core/UrbanTerrain.ts');
const raster=load('assets/scripts/view/TerrainGroundRaster.ts',{'../core/UrbanTerrain':urbanRoads});
const realBundle=JSON.parse(fs.readFileSync('assets/resources/textures/terrain/redesign_v3/materials.json','utf8'));
const engine=new raster.TerrainGroundRaster(realBundle);
const tile=(q,r,terrain='field',more={})=>({pos:{q,r},terrain,...more});
const tiles=[];
for(let r=0;r<5;r++)for(let c=0;c<9;c++)tiles.push(tile(c-Math.floor(r/2),r,c===4?'water':c===2&&r>1?'mud':c>6?'urban_ground':'field'));
const a=engine.renderChunk(tiles,false,0,0,128,192),b=engine.renderChunk(tiles,false,128,0,128,192);
let maxSeamError=0,opaqueSeamPixels=0;
for(let y=0;y<a.textureHeight;y++)for(let s=0;s<2;s++)for(let k=0;k<4;k++){
  const left=(y*a.textureWidth+128+s)*4+k,right=(y*b.textureWidth+s)*4+k;
  maxSeamError=Math.max(maxSeamError,Math.abs(a.pixels[left]-b.pixels[right]));
  if(k===3&&a.pixels[left]===255)opaqueSeamPixels++;
}
assert(maxSeamError<=1,'continuous materials, region masks, and alpha must match across chunk padding');
assert(opaqueSeamPixels>100,'seam check must include actual terrain, not just transparent padding');
const winter=engine.renderChunk(tiles,true,0,0,128,192);assert.notDeepEqual(winter.pixels,a.pixels,'winter must change ground art');
const winterRight=engine.renderChunk(tiles,true,128,0,128,192);
for(let y=0;y<winter.textureHeight;y++)for(let s=0;s<2;s++)for(let k=0;k<4;k++)assert(Math.abs(winter.pixels[(y*winter.textureWidth+128+s)*4+k]-winterRight.pixels[(y*winterRight.textureWidth+s)*4+k])<=1,'winter snow and material transitions must match across chunks');
assert.equal(raster.terrainMaterial(tile(0,0,'beach'),false),'shallow_water','beach is shallow sea');
assert.notEqual(raster.terrainMaterial(tile(0,0,'beach'),false),raster.terrainMaterial(tile(0,0,'clear'),false),'beach must differ from open ground');
const beach=engine.renderChunk([tile(0,0,'beach')],false,-16,-16,32,32),open=engine.renderChunk([tile(0,0,'clear')],false,-16,-16,32,32);
const center=(17*beach.textureWidth+17)*4;
assert(beach.pixels[center+2]>beach.pixels[center],'shallow sea must appear blue rather than sandy');
assert.notDeepEqual(beach.pixels,open.pixels,'runtime shallow sea differs visually from open ground');
const beachMeta=JSON.parse(fs.readFileSync('assets/resources/textures/terrain/pacific_water.png.meta','utf8'));
const oldBeachMeta=JSON.parse(fs.readFileSync('source_art/terrain/backups/pre-v3-20261002/terrain/pacific_water.png.meta','utf8'));
assert.equal(beachMeta.uuid,oldBeachMeta.uuid,'beach resource identity must be preserved');
assert.equal(raster.terrainMaterial(tile(0,0,'field'),true),'winter_ground');
assert.equal(raster.terrainMaterial(tile(0,0,'mud'),true),'winter_mud');
assert.equal(raster.terrainMaterial(tile(0,0,'field'),false),'grass','summer keeps its original substrate');
// Winter ground must use frozen earth rather than summer olive-green patches.
const snowGround=engine.renderChunk([tile(0,0,'field'),tile(1,0,'mud')],true,-40,-40,164,80);
let checkedWinterPixels=0;
for(let i=0;i<snowGround.pixels.length;i+=4)if(snowGround.pixels[i+3]){const [r,g,b]=snowGround.pixels.slice(i,i+3);assert(Math.min(r,g)-b<=25,'winter land must not expose saturated summer grass');checkedWinterPixels++;}
assert(checkedWinterPixels>5000);
const straightRoad=[tile(0,0,'road',{roads:[true,false,false,true,false,false]})];
assert.notDeepEqual(engine.renderChunk(straightRoad,true,-40,-40,80,80).pixels,engine.renderChunk(straightRoad,false,-40,-40,80,80).pixels,'winter roads have their own frozen surface and snow shoulders');
const runwayTile=tile(0,0,'airstrip',{roads:[true,false,false,true,false,false]});
assert.notEqual(raster.terrainGroundFingerprint([runwayTile],false),raster.terrainGroundFingerprint([tile(0,0,'clear',{roads:runwayTile.roads})],false),'runway status invalidates cache');
const runway=engine.renderChunk([runwayTile],false,-40,-40,80,80),road=engine.renderChunk(straightRoad,false,-40,-40,80,80);
const shoulder=(57*runway.textureWidth+41)*4;
assert(runway.pixels[shoulder]>200&&runway.pixels[shoulder+1]>200,'original-width runway reaches 16 pixels from the center with a pale surface');
assert.notDeepEqual(runway.pixels.slice(shoulder,shoulder+3),road.pixels.slice(shoulder,shoulder+3),'runway is substantially wider than normal roads');
const before=raster.terrainGroundFingerprint([tile(0,0,'urban_destructible',{urbanStructure:2})],false);
assert.equal(before,raster.terrainGroundFingerprint([tile(0,0,'urban_rubble',{urbanStructure:0})],false),'roof damage does not rebake identical paved ground');
assert.notEqual(before,raster.terrainGroundFingerprint([tile(0,0,'mud')],false),'a material change invalidates the ground cache');
assert.notEqual(before,raster.terrainGroundFingerprint([tile(0,0,'urban_destructible',{roads:[true,false,false,false,false,false]})],false),'road changes invalidate the ground cache');
assert.notEqual(raster.terrainGroundFingerprint([tile(0,0,'forest')],false),raster.terrainGroundFingerprint([tile(0,0,'field')],false),'forest ground changes invalidate the summer ground cache');
assert(engine.chunkOrigins([tile(-10,-9)]).every(p=>p.x<0&&p.y<0),'negative axial coordinates are supported');
assert.deepEqual(engine.chunkOrigins([]),[]);
const empty=engine.renderChunk([],false,0,0,8,8);assert(empty.pixels.every(v=>v===0),'empty map remains transparent');

// Cooperative generation must preserve every color and water-mask byte.
for(const [bundle,winter,resolution] of [[realBundle,false,1],[realBundle.europeanSummer,false,2],[realBundle.europeanWinter,true,2]]){
  const e=new raster.TerrainGroundRaster(bundle);
  const mixed=[tile(0,0,'water'),tile(1,0,'mud'),tile(0,1,'road',{roads:[true,false,false,true,false,false]})];
  const expected=e.renderChunk(mixed,winter,-24,-24,80,80,resolution);
  const job=e.renderChunkSteps(mixed,winter,-24,-24,80,80,resolution);
  let step=job.next(),yields=0;
  while(!step.done){yields++;step=job.next();}
  assert(yields>resolution*80,'work yields throughout field, blur and pixel stages');
  assert.deepEqual(step.value,expected,'cooperative output matches synchronous output exactly');
}
if(realBundle.europeanSummer){
  const summerEngine=new raster.TerrainGroundRaster(realBundle.europeanSummer),left=summerEngine.renderChunk(tiles,false,0,0,128,192),right=summerEngine.renderChunk(tiles,false,128,0,128,192);
  if(realBundle.europeanSummer.materials.forest_floor){
    assert.notDeepEqual(summerEngine.renderChunk([tile(0,0,'forest')],false,-42,-48,84,96).pixels,summerEngine.renderChunk([tile(0,0,'field')],false,-42,-48,84,96).pixels,'forest has its own ground art');
    const flat=rgb=>({width:1,height:1,rgb:Buffer.from(rgb).toString('base64')});
    const blendEngine=new raster.TerrainGroundRaster({...realBundle.europeanSummer,materials:{...realBundle.europeanSummer.materials,grass:flat([212,208,144]),forest_floor:flat([127,122,78])}});
    const mixed=blendEngine.renderChunk([tile(0,0,'forest'),tile(1,0,'field')],false,10,0,64,2);
    let intermediate=0;
    for(let x=1;x<64;x++){const p=(mixed.textureWidth+x)*4,next=p+4;assert(Math.abs(mixed.pixels[next]-mixed.pixels[p])<15,'forest-to-field ground transition must remain smooth');if(mixed.pixels[p]>135&&mixed.pixels[p]<204)intermediate++;}
    assert(intermediate>8,'forest perimeter must blend through intermediate ground colors');
  }
  if(realBundle.europeanSummer.fieldBasedLand){
    const field=summerEngine.renderChunk([tile(0,0,'field')],false,-42,-48,84,96),mud=summerEngine.renderChunk([tile(0,0,'mud')],false,-42,-48,84,96);
    let equalInterior=0,changedInterior=0,rimPixels=0;
    for(let y=0;y<mud.textureHeight;y++)for(let x=0;x<mud.textureWidth;x++){
      const p=(y*mud.textureWidth+x)*4;if(!mud.pixels[p+3])continue;
      const gx=-43+x+.5,gy=-49+y+.5,d=Math.max(...Array.from({length:6},(_,i)=>gx*Math.cos(i*Math.PI/3)+gy*Math.sin(i*Math.PI/3)))-Math.sqrt(3)*24;
      const equal=field.pixels.slice(p,p+4).every((v,k)=>v===mud.pixels[p+k]);
      if(d>-48*.02){assert(equal,'mud tile rim must exactly match its field substrate');rimPixels++;}
      else if(equal)equalInterior++;else changedInterior++;
    }
    assert(rimPixels>200&&equalInterior>500&&changedInterior>500,'mud has distinct patches, field gaps and a shared field rim');
    const fractions=[];
    for(let q=-3;q<=3;q++){
      let occupied=0,covered=0;
      for(let y=-48;y<=48;y++)for(let x=-42;x<=42;x++){
        if(Math.max(...Array.from({length:6},(_,i)=>x*Math.cos(i*Math.PI/3)+y*Math.sin(i*Math.PI/3)))>Math.sqrt(3)*24)continue;
        occupied++;if(raster.europeanMudCoverage(q,1,x+Math.sqrt(3)*48*(q+.5),y+72)>.5)covered++;
      }
      fractions.push(covered/occupied);
    }
    assert(fractions.every(v=>v>.64&&v<.78),'random mud tile layouts must cover about 70% of the hex');
    assert(fractions.reduce((a,b)=>a+b,0)/fractions.length>.68,'average mud coverage must stay near 70%');
    let connectedMud=0;
    for(let y=-20;y<=20;y++){
      const x=Math.sqrt(3)*24;
      const a=raster.europeanMudCoverage(0,0,x,y,1),b=raster.europeanMudCoverage(1,0,x,y,1<<3);
      assert(Math.abs(a-b)<1e-6,'mud pattern must continue across a shared muddy hex edge');
      if(a>.5)connectedMud++;
    }
    assert(connectedMud>15,'adjacent mud cells must not keep an artificial field seam');
    const winterEngine=new raster.TerrainGroundRaster({...realBundle.europeanSummer,fieldBasedLand:false});
    assert.deepEqual(summerEngine.renderChunk([tile(0,0,'mud')],true,-42,-48,84,96).pixels,winterEngine.renderChunk([tile(0,0,'mud')],true,-42,-48,84,96).pixels,'field overlays do not change winter terrain');
  }
  for(let y=0;y<left.textureHeight;y++)for(let s=0;s<2;s++)for(let k=0;k<4;k++)assert(Math.abs(left.pixels[(y*left.textureWidth+128+s)*4+k]-right.pixels[(y*right.textureWidth+s)*4+k])<=1,'new European summer material transitions remain continuous');
  if(realBundle.europeanSummer.curvedRoads){
    const variants=[0,1,2].map(v=>summerEngine.renderChunk(straightRoad,false,-42,-48,84,96,2,v));
    assert.notDeepEqual(variants[0].pixels,variants[1].pixels,'road art must retain distinct winding variants');
    assert.notDeepEqual(variants[1].pixels,variants[2].pixels);
    const plain=summerEngine.renderChunk([tile(0,0,'road')],false,-42,-48,84,96,2);
    let shoulderPixels=0;
    for(let y=0;y<variants[0].textureHeight;y++)for(let x=0;x<variants[0].textureWidth;x++){
      const p=(y*variants[0].textureWidth+x)*4;if(!plain.pixels[p+3])continue;
      const gx=-42+(x-1+.5)/2,gy=-48+(y-1+.5)/2,d=raster.europeanCountryRoadDistance(straightRoad[0].roads,gx/48,-gy/48,0);
      if(d>.22&&d<.32&&variants[0].pixels.slice(p,p+3).some((v,k)=>v!==plain.pixels[p+k]))shoulderPixels++;
    }
    assert(shoulderPixels>200,'road shoulder must extend beyond the road surface');
    if(realBundle.europeanSummer.materials.road_surface){
      const p=(97*variants[0].textureWidth+85)*4;
      assert(variants[0].pixels[p]>=variants[0].pixels[p+2]&&variants[0].pixels[p]-variants[0].pixels[p+2]<40&&variants[0].pixels[p+1]>105,'country road uses a muted warm-gray gravel palette');
    }
    for(let variant=0;variant<3;variant++)for(let mask=1;mask<64;mask++)for(let direction=0;direction<6;direction++){
      const roads=Array.from({length:6},(_,i)=>!!(mask&(1<<i))),angle=direction*Math.PI/3,x=Math.sqrt(3)/2*Math.cos(angle),y=-Math.sqrt(3)/2*Math.sin(angle);
      assert(Math.abs(raster.europeanCountryRoadDistance(roads,x,y,variant)-urbanRoads.europeanRoadCenterlineDistance(roads,x,y,variant))<1e-8,'country-road bends keep every road mouth fixed');
    }
    const hleft=summerEngine.renderChunk(tiles,false,0,0,128,192,2),hright=summerEngine.renderChunk(tiles,false,128,0,128,192,2);
    assert.equal(hleft.textureWidth,258,'European summer uses two texture samples per ground pixel');
    for(let y=0;y<hleft.textureHeight;y++)for(let s=0;s<2;s++)for(let k=0;k<4;k++)assert(Math.abs(hleft.pixels[(y*hleft.textureWidth+256+s)*4+k]-hright.pixels[(y*hright.textureWidth+s)*4+k])<=1,'high resolution curved road chunks remain seamless');
  }
}
// The curved coast must retreat into water, never flood the land-side hedge edge.
{
  const flat=rgb=>({width:1,height:1,rgb:Buffer.from(rgb).toString('base64')});
  const coast=new raster.TerrainGroundRaster({...realBundle,materials:{...realBundle.materials,grass:flat([220,180,90]),sand:flat([220,180,90]),water:flat([30,120,210])}});
  const image=coast.renderChunk([tile(0,0),tile(1,0,'water'),tile(2,0,'water')],false,0,-12,170,24);
  const color=x=>Array.from(image.pixels.slice((13*image.textureWidth+x+1)*4,(13*image.textureWidth+x+1)*4+3));
  for(let x=30;x<=44;x++)assert(color(x)[0]>color(x)[2],'land and shared edge stay dry, including a bank inside water');
  assert(color(62)[2]>color(62)[0],'water remains visible inside its tile');
  assert(color(124)[2]>color(124)[0],'shared water edges do not acquire a land strip');
}
// Wide runways span their shared hex boundary as a rectangle in all axes.
{
  const flat=rgb=>({width:1,height:1,rgb:Buffer.from(rgb).toString('base64')});
  const e=new raster.TerrainGroundRaster({...realBundle,materials:{...realBundle.materials,sand:flat([145,120,80])}});
  for(let axis=0;axis<3;axis++){
    const dir=[[1,0],[0,1],[-1,1]][axis],roads=Array.from({length:6},(_,i)=>i===axis||i===axis+3),grid=[];
    for(let q=-3;q<=3;q++)for(let r=-3;r<=3;r++)grid.push(tile(q,r,(q===0&&r===0||q===dir[0]&&r===dir[1])?'airstrip':'clear',{roads}));
    const a=e.renderChunk(grid,false,-160,-160,360,360),angle=axis*Math.PI/3,n=[Math.cos(angle),Math.sin(angle)],join=Math.sqrt(3)*48/2;
    const red=(u,v)=>{const x=u*n[0]-v*n[1],y=u*n[1]+v*n[0];return a.pixels[((Math.floor(y+160)+1)*a.textureWidth+Math.floor(x+160)+1)*4];};
    for(const u of [join-8,join,join+8])for(const v of [-16,0,16])assert(red(u,v)>195,'runway stays pale and equally wide through the joint, including outside each individual hex');
    assert(red(join,25)<180,'runway width matches the old 0.42-radius half width');
    assert(red(-38,0)<180,'only the outer runway end is trimmed');
  }
}
// Village yards also underlie roads; road surfaces and shoulders render above them.
{
  const village=tile(0,0,'field',{hasBuilding:true}),plain=tile(0,0,'field');
  assert.notEqual(raster.terrainGroundFingerprint([village],false),raster.terrainGroundFingerprint([plain],false),'yard presence invalidates the ground cache');
  const a=engine.renderChunk([village],false,-40,-40,80,80),b=engine.renderChunk([plain],false,-40,-40,80,80),i=(41*a.textureWidth+41)*4;
  assert.notDeepEqual(a.pixels.slice(i,i+3),b.pixels.slice(i,i+3),'village center uses bare earth');
  assert.equal(raster.ruralYardCoverage(0,0),1);
  assert.equal(raster.ruralYardCoverage(.85,0),0,'yard retains a grassy perimeter');
  const road={roads:[true,false,false,true,false,false]};
  const roadVillage=tile(0,0,'road',{...road,hasBuilding:true}),roadPlain=tile(0,0,'road',road);
  assert.notEqual(raster.terrainGroundFingerprint([roadVillage],false),raster.terrainGroundFingerprint([roadPlain],false),'building changes on a road invalidate the cached floor');
  for(const winter of [false,true]) {
    const yardRoad=engine.renderChunk([roadVillage],winter,-40,-40,80,80),plainRoad=engine.renderChunk([roadPlain],winter,-40,-40,80,80);
    assert.deepEqual(yardRoad.pixels.slice(i,i+3),plainRoad.pixels.slice(i,i+3),'opaque road surface covers the building floor');
    const outside=(61*yardRoad.textureWidth+41)*4;
    assert.notDeepEqual(yardRoad.pixels.slice(outside,outside+3),plainRoad.pixels.slice(outside,outside+3),'building floor remains visible beside the road');
  }
  assert.equal(raster.terrainGroundFingerprint([tile(0,0,'urban_road',{...road,hasBuilding:true})],false),raster.terrainGroundFingerprint([tile(0,0,'urban_road',road)],false),'urban ground keeps its existing floor');
}
// Water coverage remains continuous and never animates land, bridges or ice banks.
assert.equal(empty.hasWater,false);
assert.equal(open.hasWater,false);
assert(beach.hasWater);
for(let y=0;y<a.textureHeight;y++)for(let s=0;s<2;s++)for(let k=0;k<4;k++)assert(Math.abs(a.waterMask[(y*a.textureWidth+128+s)*4+k]-b.waterMask[(y*b.textureWidth+s)*4+k])<=1,'water animation mask matches across chunks');
const lake=engine.renderChunk([tile(0,0,'water')],false,-40,-40,80,80);
const frozen=engine.renderChunk([tile(0,0,'water')],true,-40,-40,80,80);
const bridge=engine.renderChunk([tile(0,0,'water',{bridgeEnds:[0,3]})],false,-40,-40,80,80);
const mid=(41*lake.textureWidth+41)*4;
const deepSea=engine.renderChunk([tile(0,0,'deep_water')],false,-40,-40,80,80);
assert(deepSea.hasWater,'Pacific deep sea participates in animated water rendering');
assert.equal(deepSea.waterMask[mid],255,'deep-sea interior has full animation coverage');
assert(deepSea.waterMask[mid+2]>lake.waterMask[mid+2],'deep sea uses broader waves');
assert(deepSea.waterMask[mid+1]<lake.waterMask[mid+1],'deep sea moves more slowly than inland water');
assert.equal(lake.waterMask[mid],255);
assert.equal(bridge.waterMask[mid],0,'bridge deck is excluded from motion');
assert(frozen.waterMask[mid+1]<lake.waterMask[mid+1],'winter moves more slowly');
for(let i=0;i<a.pixels.length;i+=4)if(a.waterMask[i]>0)assert.equal(a.pixels[i+3],255,'motion never extends off map');
const europeanWinter=new raster.TerrainGroundRaster(realBundle.europeanWinter);
const winterLake=europeanWinter.renderChunk([tile(0,0,'water')],true,-16,-16,32,32,2);
const winterMid=(33*winterLake.textureWidth+33)*4;
assert.equal(winterLake.waterMask[winterMid],255,'European winter open water is fully animated');
assert(winterLake.waterMask[winterMid+1]>frozen.waterMask[mid+1],'European winter ripples remain visible against the winter artwork');
assert(winterLake.waterMask[winterMid+1]<lake.waterMask[mid+1],'European winter flow remains slower than summer');
const winterBridge=europeanWinter.renderChunk([tile(0,0,'water',{bridgeEnds:[0,3]})],true,-16,-16,32,32,2);
assert.equal(winterBridge.waterMask[winterMid],0,'European winter bridge stays stationary');
const narrowRiverTiles=[];
for(let q=-2;q<=2;q++)for(let r=-2;r<=2;r++)narrowRiverTiles.push(tile(q,r,q===0&&Math.abs(r)<=1?'water':'field'));
const narrowRiver=europeanWinter.renderChunk(narrowRiverTiles,true,-90,-90,180,180,2);
let visibleWinterMotion=0;
for(let i=0;i<narrowRiver.waterMask.length;i+=4)if(narrowRiver.waterMask[i]>128){
  visibleWinterMotion++;
  assert.equal(narrowRiver.waterMask[i+3],128,'narrow winter rivers carry the stronger winter highlight setting');
}
assert(visibleWinterMotion>1000,'a narrow winter river surrounded by land retains visible animated interior');
console.log(JSON.stringify({status:'passed',maxSeamError,opaqueSeamPixels},null,2));
