const fs=require('fs'),path=require('path'),sharp=require('sharp'),ts=require('typescript'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'source_art/terrain/redesign-review-20261002/candidate-v4'),LIVE=path.join(ROOT,'assets/resources/textures/terrain');
const hex=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="222" height="256"><polygon points="111,0 222,64 222,192 111,256 0,192 0,64" fill="white"/></svg>');
async function cell(file,index,n){const p=path.join(OUT,'sources',file+'.png'),m=await sharp(p).metadata(),w=Math.floor(m.width/n),h=Math.floor(m.height/n);return sharp(p).extract({left:(index%n)*w,top:Math.floor(index/n)*h,width:w,height:h}).png().toBuffer();}
async function write(file,data){for(let i=0;;i++){try{fs.writeFileSync(file,data);return;}catch(e){if(i===8)throw e;await new Promise(r=>setTimeout(r,400));}}}
async function sprite(name,input,w,h){
  const p=path.join(LIVE,name+'.png'),data=await sharp(input).resize(w,h,{fit:'contain',background:'#00000000'}).png().toBuffer();await write(p,data);
  const meta=p+'.meta';let m=JSON.parse(fs.readFileSync(fs.existsSync(meta)?meta:path.join(LIVE,'redesign_v3/tree_palm.png.meta'),'utf8'));
  if(!fs.existsSync(meta)){const old=m.uuid,id=crypto.randomUUID();m=JSON.parse(JSON.stringify(m).replaceAll(old,id));}
  for(const s of Object.values(m.subMetas)){s.name=s.displayName=path.basename(name);if(s.importer==='sprite-frame')Object.assign(s.userData,{trimType:'none',trimX:0,trimY:0,offsetX:0,offsetY:0,width:w,height:h,rawWidth:w,rawHeight:h,packable:false,vertices:{rawPosition:[-w/2,-h/2,0,w/2,-h/2,0,-w/2,h/2,0,w/2,h/2,0],indexes:[0,1,2,2,1,3],uv:[0,h,w,h,0,0,w,0],nuv:[0,1,1,1,0,0,1,0],minPos:[-w/2,-h/2,0],maxPos:[w/2,h/2,0]}});}
  await write(meta,JSON.stringify(m,null,2)+'\n');
}
async function main(){
  const old=JSON.parse(fs.readFileSync(path.join(LIVE,'redesign_v3/materials.json'),'utf8')),ids=['grass','mud','sand','soil','water','deep_water','snow','winter_water','timber'];
  fs.mkdirSync(path.join(OUT,'materials'),{recursive:true});fs.mkdirSync(path.join(OUT,'objects'),{recursive:true});
  for(let i=0;i<ids.length;i++){const input=await cell('materials',i,3),rgb=await sharp(input).resize(384,384).removeAlpha().raw().toBuffer();old.materials[ids[i]]={width:384,height:384,rgb:rgb.toString('base64')};await write(path.join(OUT,'materials',ids[i]+'.png'),await sharp(input).png().toBuffer());}
  await write(path.join(LIVE,'redesign_v3/materials.json'),JSON.stringify(old)+'\n');
  for(let i=0;i<4;i++){
    const tree=await sharp(await cell('objects',i,3)).trim().png().toBuffer();
    const winter=await sharp(await cell('winter',i,2)).trim().png().toBuffer();
    const palm=await sharp(await cell('objects',i+4,3)).trim().png().toBuffer();
    await sprite(`tree_0${i+1}`,tree,256,256);await sprite(`tree_0${i+1}_snow`,winter,256,256);await sprite(`pacific_tree_0${i+1}`,palm,256,256);
    await sprite('redesign_v3/'+(i===0?'tree_palm':`tree_palm_${i+1}`),palm,256,256);
  }
  const rock=await sharp(path.join(OUT,'sources/highland.png')).trim().resize(222,256,{fit:'fill'}).composite([{input:hex,blend:'dest-in'}]).png().toBuffer();
  await sprite('redesign_v3/rocks',rock,222,256);await sprite('pacific_rocks',rock,222,256);
  const house=await sharp(await cell('objects',8,3)).trim().resize(160,135,{fit:'inside'}).png().toBuffer(),hm=await sharp(house).metadata();
  const roof=await sharp({create:{width:222,height:256,channels:4,background:'#00000000'}}).composite([{input:house,left:Math.round((222-hm.width)/2),top:Math.round((256-hm.height)/2)}]).png().toBuffer();await sprite('redesign_v3/building_intact',roof,222,256);
  const options={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},urban={exports:{}};
  new Function('module','exports',ts.transpileModule(fs.readFileSync(path.join(ROOT,'assets/scripts/core/UrbanTerrain.ts'),'utf8'),{compilerOptions:options}).outputText)(urban,urban.exports);
  const code=ts.transpileModule(fs.readFileSync(path.join(ROOT,'assets/scripts/view/TerrainGroundRaster.ts'),'utf8'),{compilerOptions:options}).outputText,m={exports:{}};new Function('module','exports','require',code)(m,m.exports,()=>urban.exports);const engine=new m.exports.TerrainGroundRaster(old);
  const floors={terrain_field:'field',terrain_road:'road',terrain_forest:'forest',terrain_mud:'mud',terrain_water:'water',terrain_deep_water:'deep_water',pacific_sand:'clear',pacific_trees:'trees',pacific_water:'beach',pacific_track:'clear'};
  for(const [name,terrain]of Object.entries(floors))for(const winter of [false,true]){if(winter&&!['field','road','forest','mud','water'].includes(terrain))continue;const a=engine.renderChunk([{pos:{q:0,r:0},terrain}],winter,-42,-48,84,96);const png=await sharp(a.pixels,{raw:{width:a.textureWidth,height:a.textureHeight,channels:4}}).extract({left:1,top:1,width:84,height:96}).resize(222,256).png().toBuffer();await sprite(name+(winter?'_snow':''),png,222,256);}
  for(const file of fs.readdirSync(path.join(LIVE,'european_roads'))){
    const match=file.match(/^european_road_surface_(summer|winter)_([01]{6})_v\d\.png$/);if(!match)continue;
    const winter=match[1]==='winter',roads=[...match[2]].map(c=>c==='1'),a=engine.renderChunk([{pos:{q:0,r:0},terrain:'road',roads}],winter,-42,-48,84,96);
    for(let y=0;y<a.textureHeight;y++)for(let x=0;x<a.textureWidth;x++){
      const gx=-42-1+x+.5,gy=-48-1+y+.5;let d=Infinity;
      for(let i=0;i<6;i++)if(roads[i]){const nx=Math.cos(i*Math.PI/3),ny=Math.sin(i*Math.PI/3),end=Math.sqrt(3)*24+48*.08,u=Math.max(0,Math.min(end,gx*nx+gy*ny));d=Math.min(d,Math.hypot(gx-u*nx,gy-u*ny));}
      const edge=winter?48*.36:48*.22,alpha=Math.max(0,Math.min(1,(edge-d)/2));a.pixels[(y*a.textureWidth+x)*4+3]=Math.round(a.pixels[(y*a.textureWidth+x)*4+3]*alpha);
    }
    await sprite('european_roads/'+file.slice(0,-4),await sharp(a.pixels,{raw:{width:a.textureWidth,height:a.textureHeight,channels:4}}).extract({left:1,top:1,width:84,height:96}).resize(222,256).png().toBuffer(),222,256);
  }
  for(const winter of [false,true]){
    const a=engine.renderChunk([{pos:{q:0,r:0},terrain:'water',bridgeEnds:[0,3]}],winter,-42,-48,84,96);
    for(let y=0;y<a.textureHeight;y++)for(let x=0;x<a.textureWidth;x++)if(Math.abs(-49+y+.5)>48*(.205+.028))a.pixels[(y*a.textureWidth+x)*4+3]=0;
    await sprite('european_roads/european_bridge_surface_'+(winter?'winter':'summer')+'_v1',await sharp(a.pixels,{raw:{width:a.textureWidth,height:a.textureHeight,channels:4}}).extract({left:1,top:1,width:84,height:96}).resize(222,256).png().toBuffer(),222,256);
  }
  const tiles=[];for(let r=0;r<5;r++)for(let c=0;c<7;c++)tiles.push({pos:{q:c-Math.floor(r/2),r},terrain:c===3?'water':c===1?'mud':r===1?'forest':'field',roads:r===3?[true,false,false,true,false,false]:undefined});
  for(const winter of [false,true]){const a=engine.renderChunk(tiles,winter,-48,-48,640,396);await write(path.join(OUT,winter?'winter-ground.png':'summer-ground.png'),await sharp(a.pixels,{raw:{width:a.textureWidth,height:a.textureHeight,channels:4}}).png().toBuffer());}
  const manifestPath=path.join(ROOT,'source_art/terrain/backups/pre-v3-20261002/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  for(let i=2;i<=4;i++)for(const suffix of ['.png','.png.meta']){const p=`assets/resources/textures/terrain/redesign_v3/tree_palm_${i}${suffix}`;if(!manifest.introduced.includes(p))manifest.introduced.push(p);}await write(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  console.log('Installed V4 non-urban terrain, four summer trees, four winter trees, four palms, massif and farmhouse.');
}
module.exports={sprite,write};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});

