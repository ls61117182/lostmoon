const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const {PACK,readPack,jsonDigest}=require('../tools/switchEuropeanTerrainArt.cjs');
const {loadRaster}=require('../tools/buildEuropeanTerrainV6.cjs');
async function main(){
 const version=fs.existsSync(path.join(PACK,'detailed-steel-bridge/manifest.json'))?'detailed-steel-bridge':'detailed-bridge';
 const old=readPack('detailed'),next=readPack(version),art=next.summer.bridgeArtwork;
 assert.equal(art.width,768);assert.equal(art.height,192);assert.equal(Buffer.from(art.rgba,'base64').length,768*192*4);
 assert.equal(jsonDigest(old.summer.materials),jsonDigest(next.summer.materials),'only bridge artwork changes; summer ground materials stay exact');
 const bridge='european_roads/european_bridge_surface_summer_v1.png';
 for(const f of old.manifest.files)if(!f.path.startsWith(bridge))assert.equal(f.sha256,next.manifest.files.find(n=>n.path===f.path).sha256,'all non-bridge art stays exact');
 const m=await sharp(path.join(PACK,version,bridge)).metadata();assert.equal(m.width,888);assert.equal(m.height,1024);assert(m.hasAlpha);
 const oldMeta=JSON.parse(fs.readFileSync(path.join(PACK,'detailed',bridge+'.meta'))),newMeta=JSON.parse(fs.readFileSync(path.join(PACK,version,bridge+'.meta')));
 assert.equal(newMeta.uuid,oldMeta.uuid,'bridge resource UUID stays stable');
 const frame=Object.values(newMeta.subMetas).find(m=>m.importer==='sprite-frame').userData;assert.equal(frame.width,888);assert.equal(frame.height,1024);
 const {TerrainGroundRaster}=loadRaster(),before=new TerrainGroundRaster(old.summer),after=new TerrainGroundRaster(next.summer);
 for(let axis=0;axis<3;axis++){
  const tile={pos:{q:0,r:0},terrain:'water',bridgeEnds:[axis,axis+3]},a=before.renderChunk([tile],false,-48,-48,96,96,2),b=after.renderChunk([tile],false,-48,-48,96,96,2);
  assert.notDeepEqual(a.pixels,b.pixels,'new bridge appears along axis '+axis);
  assert.equal(b.waterMask[(97*b.textureWidth+97)*4],0,'bridge center must remain static water mask');
  assert.deepEqual(before.renderChunk([tile],true,-24,-24,48,48,2).pixels,after.renderChunk([tile],true,-24,-24,48,48,2).pixels,'winter ignores summer bridge artwork');
 }
 const field=[{pos:{q:0,r:0},terrain:'field'}];
 assert.deepEqual(before.renderChunk(field,false,-24,-24,48,48).pixels,after.renderChunk(field,false,-24,-24,48,48).pixels,'ordinary terrain colors stay exact');
 console.log('V7 bridge: 768x192 deck, 4x sprite dimensions, stable UUID, three axes, winter isolation, water mask and unchanged ordinary ground passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
