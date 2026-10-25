// Reproducible production conversion of the reviewed ImageGen source atlases.
// Original summer/winter/base packs and their UUIDs are never overwritten.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const sharp = require('sharp');
const { sprite } = require('./installTerrainV4.cjs');
const { loadRaster } = require('./buildEuropeanTerrainV6.cjs');
const ROOT = path.resolve(__dirname, '..');
const LIVE = path.join(ROOT, 'assets/resources/textures/terrain');
const OUT = path.join(ROOT, 'source_art/terrain/seasons-design-20261024');
const LOOKS = ['spring', 'autumn', 'winter_bare'];
const MATERIALS = ['grass','mud','soil','forest_floor','water','deep_water','road_surface','rural_yard','timber'];
// Art-directed mean values; retained detail is from the separately generated art.
const TONES = {
  spring: [[154,167,110],[96,80,68],[121,106,83],[101,104,69],[81,139,149],[48,94,112],[174,174,158],[137,125,100],[105,100,83]],
  autumn: [[161,140,94],[92,73,59],[119,101,80],[111,90,57],[91,127,144],[50,80,102],[164,159,145],[131,115,92],[107,99,83]],
  winter_bare: [[140,135,116],[81,74,65],[105,98,84],[95,85,66],[86,116,137],[48,72,94],[162,165,159],[117,110,95],[99,99,91]],
};
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data) + '\n'); }
function directory(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = dir + '.meta';
  if (!fs.existsSync(file)) writeJSON(file, {ver:'1.2.0',importer:'directory',imported:true,uuid:crypto.randomUUID(),files:[],subMetas:{},userData:{}});
}
function jsonAsset(file, value) {
  writeJSON(file, value);
  if (!fs.existsSync(file+'.meta')) writeJSON(file+'.meta', {ver:'2.0.1',importer:'json',imported:true,uuid:crypto.randomUUID(),files:['.json'],subMetas:{},userData:{}});
}
async function atlasCell(file, index, columns) {
  const m = await sharp(file).metadata(), cw = Math.floor(m.width / columns), ch = Math.floor(m.height / columns);
  // Exclude cell boundary antialiasing, never sample the neighboring material.
  const inset = columns === 3 ? 5 : 0;
  return sharp(file).extract({left:index%columns*cw+inset,top:Math.floor(index/columns)*ch+inset,width:cw-inset*2,height:ch-inset*2}).png().toBuffer();
}
async function toned(input, target, strength=.68, maximum=255) {
  const pixels = await sharp(input).resize(384,384).removeAlpha().toColourspace('srgb').raw().toBuffer();
  const mean = [0,0,0];
  for (let i=0;i<pixels.length;i++) mean[i%3]+=pixels[i];
  for (let k=0;k<3;k++) mean[k]/=pixels.length/3;
  for (let i=0;i<pixels.length;i++) pixels[i]=Math.max(0,Math.min(maximum,Math.round(target[i%3]+(pixels[i]-mean[i%3])*strength)));
  return {width:384,height:384,rgb:pixels.toString('base64')};
}
async function groundPNG(engine, tile, snow=false, variant) {
  const a=engine.renderChunk([tile],snow,-42,-48,84,96,2,variant);
  return {a, png:()=>sharp(a.pixels,{raw:{width:a.textureWidth,height:a.textureHeight,channels:4}}).extract({left:1,top:1,width:168,height:192}).png().toBuffer()};
}
async function main() {
  const basePath=path.join(LIVE,'redesign_v3/materials.json'), original=fs.readFileSync(basePath);
  const bundle=JSON.parse(original), baseline={materials:sha(original),summer:sha(JSON.stringify(bundle.europeanSummer)),winter:sha(JSON.stringify(bundle.europeanWinter))};
  const manifestPath=path.join(OUT,'production-manifest.json');
  if(fs.existsSync(manifestPath)) {
    const old=JSON.parse(fs.readFileSync(manifestPath));
    if(old.baseline.materials!==baseline.materials)throw Error('Base terrain changed since seasonal production; review before rebuilding.');
  }
  directory(path.join(LIVE,'seasons'));
  const { TerrainGroundRaster, europeanCountryRoadDistance }=loadRaster();
  const roads=fs.readdirSync(path.join(LIVE,'european_roads')).filter(f=>/^european_road_surface_summer_[01]{6}_v[123]\.png$/.test(f));
  const files=[];
  for (const look of LOOKS) {
    const dir=path.join(LIVE,'seasons',look), source=path.join(OUT,'sources',look); directory(dir);
    fs.mkdirSync(path.join(source,'materials'),{recursive:true});
    const pack={version:3,fieldBasedLand:!!bundle.europeanSummer.fieldBasedLand,curvedRoads:true,materials:{...bundle.europeanSummer.materials},bridgeArtwork:bundle.europeanSummer.bridgeArtwork};
    for(let i=0;i<MATERIALS.length;i++) {
      const id=MATERIALS[i], fineGrass=path.join(source,'grass-fine.png');
      // Grass needs a full-size source: a small atlas cell magnifies each tuft
      // relative to infantry when it is expanded to the runtime material size.
      const input=id==='grass'&&fs.existsSync(fineGrass)?fs.readFileSync(fineGrass):await atlasCell(path.join(source,'materials-atlas.png'),i,3);
      // Short grass and dormant blades must survive downsampling in every season.
      const detail=id==='forest_floor'?.54:.68;
      pack.materials[id]=await toned(input,TONES[look][i],detail,look==='winter_bare'?218:255);
      const m=pack.materials[id];
      await sharp(Buffer.from(m.rgb,'base64'),{raw:{width:m.width,height:m.height,channels:3}}).png().toFile(path.join(source,'materials',id+'.png'));
    }
    // European sand and nearshore are still separate from the Pacific substrate.
    const sandTone=look==='spring'?[173,167,143]:look==='autumn'?[160,151,129]:[142,139,124];
    pack.materials.europe_sand=await toned(await atlasCell(path.join(source,'materials-atlas.png'),2,3),sandTone,.36);
    pack.materials.sand=pack.materials.europe_sand;
    const water=Buffer.from(pack.materials.water.rgb,'base64');
    for(let i=0;i<water.length;i++)water[i]=Math.round(water[i]*.74+[150,176,175][i%3]*.26);
    pack.materials.shallow_water={width:384,height:384,rgb:water.toString('base64')};
    // No snow processing is enabled for any of these three packs.
    jsonAsset(path.join(dir,'materials.json'),pack);
    for(let i=0;i<4;i++) {
      const input=await atlasCell(path.join(source,'trees-atlas.png'),i,2), meta=await sharp(input).metadata();
      if(!meta.hasAlpha)throw Error(look+' tree atlas must have true alpha');
      const tree=await sharp(input).trim({threshold:12}).resize(248,248,{fit:'contain',background:'#00000000'}).extend({top:4,bottom:4,left:4,right:4,background:'#00000000'}).png().toBuffer();
      await sprite(`seasons/${look}/tree_0${i+1}`,tree,256,256);
    }
    const engine=new TerrainGroundRaster(pack);
    for(const terrain of ['field','road','mud','forest','water','deep_water','europe_beach','beach']) {
      const {png}=await groundPNG(engine,{pos:{q:0,r:0},terrain});
      const raw=await png();
      await sprite(`seasons/${look}/terrain_${terrain}`,raw,222,256);
      // The editor/inspection variant includes actual tree sprites, while the
      // battle fallback uses floor only and overlays its normal forest layout.
      if(terrain==='forest') {
        const trees=[];
        for(let i=0;i<5;i++)trees.push({input:await sharp(path.join(dir,`tree_0${i%4+1}.png`)).resize(78,78).png().toBuffer(),left:[48,90,27,108,68][i],top:[22,65,103,130,168][i]});
        await sprite(`seasons/${look}/thumbnail_forest`,await sharp(raw).resize(222,256).composite(trees).png().toBuffer(),222,256);
      }
    }
    // Decorative courtyard props use the same substrate as the continuous floor.
    const yard=pack.materials.rural_yard;
    const yardMask=Buffer.from('<svg width="256" height="176"><ellipse cx="128" cy="88" rx="124" ry="82" fill="white"/></svg>');
    const yardPNG=await sharp(Buffer.from(yard.rgb,'base64'),{raw:{width:384,height:384,channels:3}}).resize(256,176).ensureAlpha().composite([{input:yardMask,blend:'dest-in'}]).png().toBuffer();
    await sprite(`seasons/${look}/rural_yard_patch`,yardPNG,256,176);
    for(const name of roads) {
      const match=name.match(/summer_([01]{6})_v(\d)/), flags=[...match[1]].map(c=>c==='1'), variant=Number(match[2])-1;
      const {a,png}=await groundPNG(engine,{pos:{q:0,r:0},terrain:'road',roads:flags},false,variant);
      for(let y=0;y<a.textureHeight;y++)for(let x=0;x<a.textureWidth;x++) {
        const gx=-42+(x-1+.5)/2,gy=-48+(y-1+.5)/2;
        const distance=europeanCountryRoadDistance(flags,gx/48,-gy/48,variant)*48;
        const i=(y*a.textureWidth+x)*4+3;
        a.pixels[i]=Math.round(a.pixels[i]*Math.max(0,Math.min(1,(48*.40-distance)/2)));
      }
      await sprite('european_roads/'+name.replace('summer',look).slice(0,-4),await png(),222,256);
    }
    const {a,png}=await groundPNG(engine,{pos:{q:0,r:0},terrain:'water',bridgeEnds:[0,3]});
    for(let y=0;y<a.textureHeight;y++)for(let x=0;x<a.textureWidth;x++)if(Math.abs(-48+(y-1+.5)/2)>48*(.205+.028))a.pixels[(y*a.textureWidth+x)*4+3]=0;
    await sprite(`european_roads/european_bridge_surface_${look}_v1`,await png(),222,256);
    for(const name of fs.readdirSync(dir))if(!name.endsWith('.meta'))files.push({path:path.relative(ROOT,path.join(dir,name)).replaceAll('\\','/'),sha256:sha(fs.readFileSync(path.join(dir,name)))});
    for(const name of fs.readdirSync(path.join(LIVE,'european_roads')).filter(f=>f.includes('_'+look+'_')&&!f.endsWith('.meta')))files.push({path:'assets/resources/textures/terrain/european_roads/'+name,sha256:sha(fs.readFileSync(path.join(LIVE,'european_roads',name)))});
    console.log(`Built ${look}: 9 independent materials, 4 trees, 8 terrain sprites, forest thumbnail, courtyard, ${roads.length} roads and steel bridge.`);
  }
  if(sha(fs.readFileSync(basePath))!==baseline.materials)throw Error('Shared terrain was unexpectedly modified.');
  writeJSON(manifestPath,{version:1,builtWith:'built-in imagegen + deterministic production conversion',baseline,files});
  console.log(`Verified ${files.length} seasonal assets; original summer/winter/Pacific materials preserved.`);
}
module.exports={ROOT,LIVE,OUT,LOOKS,loadRaster};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
