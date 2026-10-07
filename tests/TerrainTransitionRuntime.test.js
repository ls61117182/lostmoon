const assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),sharp=require('sharp');
const m={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync('source_art/terrain/retired-runtime-transitions/TerrainTransitionMatcher.ts.txt','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m,m.exports);
const {matchTerrainTransitions}=m.exports,{context}=require('../tools/bakeCommonTerrainTransitions.cjs');
const {feather,animated,digest}=require('../tools/installCommonTerrainTransitions.cjs');
const original=JSON.parse(fs.readFileSync('source_art/terrain/prefab-transitions-v1/manifest.json'));
const manifest=JSON.parse(fs.readFileSync('source_art/terrain/retired-runtime-transitions/textures/manifest.json'));
for(const entry of manifest.entries){
 const tiles=context(entry.center,entry.other,entry.neighborMask).tiles;
 const matches=matchTerrainTransitions(tiles,manifest.entries,entry.style);
 const center=matches.find(t=>t.tile.pos.q===0&&t.tile.pos.r===0);
 assert(center,'every baked topology must match');
 // Homogeneous neighborhoods may choose either compatible pair.
 if(entry.neighborMask!==0)assert.equal(center.entry.color,entry.color);
 for(const special of [{roads:[true]},{bridgeEnds:[0,3]},{hasBuilding:true},{urbanKind:'ground'}]){
  const altered=tiles.map(t=>({...t}));altered[8]={...altered[8],...special};
  assert(!matchTerrainTransitions(altered,manifest.entries,entry.style).some(t=>t.tile.pos.q===0&&t.tile.pos.r===0),'second-ring special terrain must fall back');
 }
 const missing=tiles.slice(0,-1);assert(!matchTerrainTransitions(missing,manifest.entries,entry.style).some(t=>t.tile.pos.q===0&&t.tile.pos.r===0));
}
async function assets(){
 assert.equal(manifest.version,2);
 assert.equal(manifest.entries.length,original.entries.length);
 const buffers=new Map(),unique=new Set();
 for(let n=0;n<manifest.entries.length;n++){const entry=manifest.entries[n],source=original.entries[n];
 assert.deepEqual({...entry,color:source.color,waterMask:source.waterMask},source,'topology metadata must remain unchanged');
 for(const [kind,relative,sourceRelative] of [['color',entry.color,source.color],['mask',entry.waterMask,source.waterMask]]){
  if(!sourceRelative){assert.equal(relative,null);continue;}
  const expected=await sharp('source_art/terrain/prefab-transitions-v1/'+sourceRelative).ensureAlpha().raw().toBuffer();
  if(kind==='mask'&&!animated(expected)){assert.equal(relative,null,'inactive masks must be omitted');continue;}
  if(kind==='color')feather(expected);
  assert(relative,'active resources must be retained');
  let actual=buffers.get(relative);if(!actual){actual=await sharp('source_art/terrain/retired-runtime-transitions/textures/'+relative).ensureAlpha().raw().toBuffer();buffers.set(relative,actual);}
  assert(actual.equals(expected),'every shared resource must preserve original installed pixels');
  assert.equal(manifest.resources[relative].kind,kind);assert.equal(manifest.resources[relative].pixelSha256,digest(actual));
 }
 for(const relative of [entry.color,entry.waterMask].filter(Boolean)){
  const file='source_art/terrain/retired-runtime-transitions/textures/'+relative,meta=JSON.parse(fs.readFileSync(file+'.meta'));
  assert.equal(meta.subMetas.f9941.userData.imageUuidOrDatabaseUri,meta.uuid+'@6c48a');assert.equal(meta.userData.redirect,meta.uuid+'@6c48a');assert.equal(meta.subMetas.f9941.userData.packable,false);
  const image=await sharp(file).metadata();assert.equal(image.width,170);assert.equal(image.height,194);
 }
 }
 for(const [relative,resource]of Object.entries(manifest.resources)){const id=resource.kind+':'+resource.pixelSha256;assert(!unique.has(id),'resource table must contain no duplicate pixel buffers');unique.add(id);assert(buffers.has(relative),'every installed resource must be referenced');}
 assert.equal(unique.size,buffers.size);
 const entry=manifest.entries.find(e=>e.neighborMask===1&&e.center==='field'&&e.other==='mud');
 const raw=await sharp('source_art/terrain/retired-runtime-transitions/textures/'+entry.color).raw().toBuffer();
 assert.equal(raw[(97*170+169)*4+3],0,'shared edge must reveal continuous ground');assert.equal(raw[(97*170+85)*4+3],255,'prefab interior must render fully');
 console.log('Runtime transitions: all 1152 topologies, per-combination pixel equivalence, unique resources, omitted inactive masks and import references passed.');
}
assets().catch(e=>{console.error(e);process.exitCode=1;});
