const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const {ROOT,PACK,readPack,jsonDigest,digest,safe}=require('./switchEuropeanTerrainArt.cjs');
const STEEL=process.argv.includes('--steel'),VERSION=STEEL?'detailed-steel-bridge':'detailed-bridge';
const OUT=path.join(ROOT,STEEL?'source_art/terrain/steel-bridge-20261015':'source_art/terrain/bridge-v7-20261015');
async function main(){
  const previous=readPack('detailed'),dir=path.join(PACK,VERSION);
  fs.mkdirSync(dir,{recursive:true});
  for(const f of previous.files){const to=safe(dir,f.path);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(safe(path.join(PACK,'detailed'),f.path),to);}
  // Full deck artwork is sampled directly, never squeezed into a 384px atlas cell.
  const deck=await sharp(path.join(OUT,'bridge-source.png')).trim({threshold:16}).resize(768,192,{fit:'fill'}).ensureAlpha().png().toBuffer();
  await sharp(deck).toFile(path.join(OUT,'bridge-deck-768x192.png'));
  const summer=previous.summer;
  summer.bridgeArtwork={width:768,height:192,rgba:(await sharp(deck).raw().toBuffer()).toString('base64')};
  const relative='european_roads/european_bridge_surface_summer_v1.png';
  const width=888,height=1024,worldLength=2*(Math.sqrt(3)*48/2+48*.08),worldWidth=2*48*(.205+.028);
  const deckWidth=Math.round(worldLength*width/84),deckHeight=Math.round(worldWidth*height/96);
  const spriteDeck=await sharp(deck).resize(deckWidth,deckHeight,{fit:'fill'}).extract({left:Math.floor((deckWidth-width)/2),top:0,width,height:deckHeight}).png().toBuffer();
  await sharp({create:{width,height,channels:4,background:'#00000000'}}).composite([{input:spriteDeck,left:0,top:Math.round((height-deckHeight)/2)}]).png().toFile(safe(dir,relative));
  const metaFile=safe(dir,relative+'.meta'),meta=JSON.parse(fs.readFileSync(metaFile,'utf8'));
  const s=Object.values(meta.subMetas).find(s=>s.importer==='sprite-frame').userData;
  Object.assign(s,{width,height,rawWidth:width,rawHeight:height,trimX:0,trimY:0,offsetX:0,offsetY:0,trimType:'none',packable:false});
  s.vertices={rawPosition:[-width/2,-height/2,0,width/2,-height/2,0,-width/2,height/2,0,width/2,height/2,0],indexes:[0,1,2,2,1,3],uv:[0,height,width,height,0,0,width,0],nuv:[0,0,1,0,0,1,1,1],minPos:[-width/2,-height/2,0],maxPos:[width/2,height/2,0]};
  fs.writeFileSync(metaFile,JSON.stringify(meta,null,2)+'\n');
  fs.writeFileSync(path.join(dir,'summer.json'),JSON.stringify(summer)+'\n');
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({version:VERSION,summerSha256:jsonDigest(summer),files:previous.files.map(f=>({path:f.path,sha256:digest(fs.readFileSync(safe(dir,f.path)))}))},null,2)+'\n');
  console.log(`Built ${VERSION}: 768x192 painted deck, 888x1024 sprite; previous packs preserved.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
