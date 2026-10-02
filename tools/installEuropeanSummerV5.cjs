const fs=require('fs'),path=require('path'),sharp=require('sharp'),ts=require('typescript');
const {sprite,write}=require('./installTerrainV4.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'source_art/terrain/redesign-review-20261002/europe-summer-v5'),LIVE=path.join(ROOT,'assets/resources/textures/terrain');
async function cell(file,index){const p=path.join(OUT,'sources',file+'.png'),m=await sharp(p).metadata(),w=Math.floor(m.width/3),h=Math.floor(m.height/2);return sharp(p).extract({left:index%3*w,top:Math.floor(index/3)*h,width:w,height:h}).png().toBuffer();}
async function main(){
  const p=path.join(LIVE,'redesign_v3/materials.json'),bundle=JSON.parse(fs.readFileSync(p,'utf8'));
  const europe={version:3,fieldBasedLand:false,curvedRoads:true,materials:JSON.parse(JSON.stringify(bundle.materials))};
  for(const [i,id]of ['grass','mud','soil','water','deep_water','timber'].entries()){
    const refinement=path.join(OUT,'sources/field-light.png');
    const input=id==='grass'&&fs.existsSync(refinement)?refinement:await cell('materials',i);
    let image=sharp(input);
    if(Buffer.isBuffer(input)){
      // AI atlas cells contain a thin colour boundary from their neighbours.
      // Reflecting those boundary texels creates straight lines at world UV
      // origins even with perfectly continuous chunks and clamped GPU sampling.
      const size=await image.metadata(),inset=12;
      image=image.extract({left:inset,top:inset,width:size.width-inset*2,height:size.height-inset*2});
    }
    const raw=await image.resize(384,384).removeAlpha().raw().toBuffer();europe.materials[id]={width:384,height:384,rgb:raw.toString('base64')};
  }
  const countrySurface=path.join(OUT,'sources/road-country.png');
  const roadSurface=fs.existsSync(countrySurface)?countrySurface:path.join(OUT,'sources/road-gravel.png');
  if(fs.existsSync(roadSurface))europe.materials.road_surface={width:384,height:384,rgb:(await sharp(roadSurface).resize(384,384).removeAlpha().raw().toBuffer()).toString('base64')};
  const forestFloor=path.join(OUT,'sources/forest-floor.png');
  if(fs.existsSync(forestFloor))europe.materials.forest_floor={width:384,height:384,rgb:(await sharp(forestFloor).resize(384,384).removeAlpha().raw().toBuffer()).toString('base64')};
  bundle.europeanSummer=europe;await write(p,JSON.stringify(bundle)+'\n');
  for(let i=0;i<4;i++)await sprite(`redesign_v3/europe_tree_0${i+1}`,await sharp(await cell('objects',i)).trim().png().toBuffer(),256,256);
  const house=await sharp(await cell('objects',4)).trim().resize(150,120,{fit:'inside'}).png().toBuffer(),hm=await sharp(house).metadata();
  const roof=await sharp({create:{width:222,height:256,channels:4,background:'#00000000'}}).composite([{input:house,left:Math.round((222-hm.width)/2),top:Math.round((256-hm.height)/2)}]).png().toBuffer();await sprite('redesign_v3/europe_building_intact',roof,222,256);
  const options={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},urban={exports:{}};
  new Function('module','exports',ts.transpileModule(fs.readFileSync(path.join(ROOT,'assets/scripts/core/UrbanTerrain.ts'),'utf8'),{compilerOptions:options}).outputText)(urban,urban.exports);
  const code=ts.transpileModule(fs.readFileSync(path.join(ROOT,'assets/scripts/view/TerrainGroundRaster.ts'),'utf8'),{compilerOptions:options}).outputText,m={exports:{}};new Function('module','exports','require',code)(m,m.exports,()=>urban.exports);const engine=new m.exports.TerrainGroundRaster(europe);
  for(const terrain of ['field','forest','mud','road','water','deep_water']){
    const a=engine.renderChunk([{pos:{q:0,r:0},terrain}],false,-42,-48,84,96);
    await sprite('terrain_'+terrain,await sharp(a.pixels,{raw:{width:a.textureWidth,height:a.textureHeight,channels:4}}).extract({left:1,top:1,width:84,height:96}).resize(222,256).png().toBuffer(),222,256);
  }
  // Summer European roads only; winter, Pacific and urban resources stay intact.
  for(const file of fs.readdirSync(path.join(LIVE,'european_roads'))){
    const match=file.match(/^european_road_surface_summer_([01]{6})_v(\d)\.png$/);if(!match)continue;
    const variant=Number(match[2])-1,roads=[...match[1]].map(c=>c==='1'),a=engine.renderChunk([{pos:{q:0,r:0},terrain:'road',roads}],false,-42,-48,84,96,2,variant);
    for(let y=0;y<a.textureHeight;y++)for(let x=0;x<a.textureWidth;x++){const gx=-42+(x-1+.5)/2,gy=-48+(y-1+.5)/2,d=m.exports.europeanCountryRoadDistance(roads,gx/48,-gy/48,variant)*48;a.pixels[(y*a.textureWidth+x)*4+3]=Math.round(a.pixels[(y*a.textureWidth+x)*4+3]*Math.max(0,Math.min(1,(48*.40-d)/2)));}
    await sprite('european_roads/'+file.slice(0,-4),await sharp(a.pixels,{raw:{width:a.textureWidth,height:a.textureHeight,channels:4}}).extract({left:1,top:1,width:168,height:192}).resize(222,256).png().toBuffer(),222,256);
  }
  const bridge=engine.renderChunk([{pos:{q:0,r:0},terrain:'water',bridgeEnds:[0,3]}],false,-42,-48,84,96);
  for(let y=0;y<bridge.textureHeight;y++)for(let x=0;x<bridge.textureWidth;x++)if(Math.abs(-49+y+.5)>48*(.205+.028))bridge.pixels[(y*bridge.textureWidth+x)*4+3]=0;
  await sprite('european_roads/european_bridge_surface_summer_v1',await sharp(bridge.pixels,{raw:{width:bridge.textureWidth,height:bridge.textureHeight,channels:4}}).extract({left:1,top:1,width:84,height:96}).resize(222,256).png().toBuffer(),222,256);
  const tiles=[];for(let r=0;r<5;r++)for(let c=0;c<7;c++)tiles.push({pos:{q:c-Math.floor(r/2),r},terrain:c===5?'water':c===1?'mud':r===0||r===4?'forest':'field',roads:r===2?[true,false,false,true,false,false]:undefined,bridgeEnds:r===2&&c===5?[0,3]:undefined});
  const ground=engine.renderChunk(tiles,false,-48,-48,640,396),layers=[],map=await sharp(ground.pixels,{raw:{width:ground.textureWidth,height:ground.textureHeight,channels:4}}).resize(802,497).png().toBuffer();
  const layout=[[0,.64,.78],[-.47,.35,.84],[.47,.35,.80],[-.58,-.16,.85],[0,.12,.90],[.58,-.16,.82],[-.32,-.54,.85],[.32,-.54,.82],[0,-.1,.79]];
  for(const t of tiles)if(t.terrain==='forest')for(let i=0;i<layout.length;i++){
    const [dx,dy,scale]=layout[i],w=Math.round(60*scale*.82),index=(Math.abs(t.pos.q*92811+t.pos.r*6899)+i)%4;
    const input=await sharp(path.join(LIVE,`redesign_v3/europe_tree_0${index+1}.png`)).resize(w,w).png().toBuffer();
    const x=(Math.sqrt(3)*48*(t.pos.q+t.pos.r/2)+49)*1.25+dx*60,y=(72*t.pos.r+49)*1.25-dy*60;
    const left=Math.round(x-w/2),top=Math.round(y-w/2);if(left>=0&&top>=0&&left+w<=802&&top+w<=497)layers.push({input,left,top});
  }
  await write(path.join(OUT,'map-preview.png'),await sharp(map).composite(layers).png().toBuffer());
  const manifestPath=path.join(ROOT,'source_art/terrain/backups/pre-v3-20261002/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  for(const name of ['europe_tree_01','europe_tree_02','europe_tree_03','europe_tree_04','europe_building_intact'])for(const suffix of ['.png','.png.meta']){const f=`assets/resources/textures/terrain/redesign_v3/${name}${suffix}`;if(!manifest.introduced.includes(f))manifest.introduced.push(f);}await write(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  console.log('Installed isolated European summer style; base material bundle and other theaters preserved.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
