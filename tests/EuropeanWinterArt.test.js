const assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),path=require('path');
function load(file,deps={}){const m={exports:{}};new Function('module','exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(m,m.exports,n=>deps[n]);return m.exports;}
const raster=load('assets/scripts/view/TerrainGroundRaster.ts',{'../core/UrbanTerrain':load('assets/scripts/core/UrbanTerrain.ts')}),bundle=JSON.parse(fs.readFileSync('assets/resources/textures/terrain/redesign_v3/materials.json','utf8')),winter=bundle.europeanWinter;
assert(winter.winterArtwork&&winter.curvedRoads,'winter uses independent artwork and European country road bends');
const backup=JSON.parse(fs.readFileSync('source_art/terrain/redesign-review-20261003/europe-winter/backup/redesign_v3/materials.json','utf8'));
const summerUpgradeSnapshot='source_art/terrain/europe-summer-v6-20261015/classic/materials.snapshot.json';
const winterBaseline=fs.existsSync(summerUpgradeSnapshot)?JSON.parse(fs.readFileSync(summerUpgradeSnapshot,'utf8')):backup;
assert.deepEqual(bundle.materials,winterBaseline.materials,'Pacific and base materials preserved');
// Summer may now be switched independently; its original V5 artwork remains
// preserved byte-for-byte in the version pack rather than being the active art.
const versionsPath='source_art/terrain/europe-summer-v6-20261015',activeSummer=JSON.stringify(bundle.europeanSummer);
if(fs.existsSync(versionsPath+'/detailed/manifest.json')){
 const originalSummer=JSON.parse(fs.readFileSync(versionsPath+'/classic/summer.json','utf8'));
 const snapshot=JSON.parse(fs.readFileSync(versionsPath+'/classic/materials.snapshot.json','utf8'));
 assert.deepEqual(originalSummer,snapshot.europeanSummer,'original European summer art preserved at the V6 upgrade boundary');
 assert.deepEqual(winter,snapshot.europeanWinter,'summer version switching preserves winter art exactly');
 const detailedSummer=JSON.parse(fs.readFileSync(versionsPath+'/detailed/summer.json','utf8'));
 const versions=[originalSummer,detailedSummer];
 const bridgeVersion=versionsPath+'/detailed-bridge/summer.json';if(fs.existsSync(bridgeVersion))versions.push(JSON.parse(fs.readFileSync(bridgeVersion,'utf8')));
 const steelVersion=versionsPath+'/detailed-steel-bridge/summer.json';if(fs.existsSync(steelVersion))versions.push(JSON.parse(fs.readFileSync(steelVersion,'utf8')));
 assert(versions.some(v=>JSON.stringify(v)===activeSummer),'active summer must match a preserved version');
}else assert.deepEqual(bundle.europeanSummer,backup.europeanSummer,'European summer preserved');
const engine=new raster.TerrainGroundRaster(winter),tile=(q,r,terrain,more={})=>({pos:{q,r},terrain,...more}),tiles=[];
for(let r=0;r<5;r++)for(let c=0;c<8;c++)tiles.push(tile(c-Math.floor(r/2),r,['forest','mud','field','water'][c%4],r===2?{roads:[true,false,false,true,false,false]}:{}));
let maximum=0;for(const horizontal of [true,false]){const a=engine.renderChunk(tiles,true,0,0,128,192,2),b=engine.renderChunk(tiles,true,horizontal?128:0,horizontal?0:192,128,192,2);
for(let p=0;p<(horizontal?a.textureHeight:a.textureWidth);p++)for(let s=0;s<2;s++)for(let k=0;k<4;k++){const i=horizontal?(p*a.textureWidth+256+s)*4+k:((384+s)*a.textureWidth+p)*4+k,j=horizontal?(p*b.textureWidth+s)*4+k:(s*b.textureWidth+p)*4+k;maximum=Math.max(maximum,Math.abs(a.pixels[i]-b.pixels[j]));}}
assert(maximum<=1,'winter water, mud, forest and road transitions remain continuous at 2x resolution');
const field=engine.renderChunk([tile(0,0,'field')],true,-30,-30,60,60,2),forest=engine.renderChunk([tile(0,0,'forest')],true,-30,-30,60,60,2);assert.notDeepEqual(field.pixels,forest.pixels,'winter forest has its own floor');assert.notEqual(raster.terrainGroundFingerprint([tile(0,0,'field')],true),raster.terrainGroundFingerprint([tile(0,0,'forest')],true),'winter forest updates invalidate ground cache');
for(let i=1;i<=4;i++){const file=`assets/resources/textures/terrain/redesign_v3/rural_roof_0${i}_snow.png`,meta=JSON.parse(fs.readFileSync(file+'.meta','utf8'));assert(fs.existsSync(file));const frame=Object.values(meta.subMetas).find(s=>s.importer==='sprite-frame');assert.equal(frame.userData.width,256);assert.equal(frame.userData.height,176);assert.equal(frame.userData.packable,false);}
console.log('European winter art: isolated bundle, 2x continuous transitions, distinct forest floor and snowy roof imports passed; max seam error '+maximum);
