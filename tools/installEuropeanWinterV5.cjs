const fs=require('fs'),path=require('path'),sharp=require('sharp'),ts=require('typescript'),assert=require('node:assert/strict');
const {sprite,write}=require('./installTerrainV4.cjs');
const ROOT=path.resolve(__dirname,'..'),LIVE=path.join(ROOT,'assets/resources/textures/terrain'),OUT=path.join(ROOT,'source_art/terrain/redesign-review-20261003/europe-winter');
const BACK=path.join(OUT,'backup');
function backup(relative){const source=path.join(LIVE,relative),target=path.join(BACK,relative);if(fs.existsSync(source)&&!fs.existsSync(target)){fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);}}
async function save(name,input,w,h){backup(name+'.png');backup(name+'.png.meta');await sprite(name,input,w,h);}
function loadRaster(){const options={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},urban={exports:{}},m={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync(path.join(ROOT,'assets/scripts/core/UrbanTerrain.ts'),'utf8'),{compilerOptions:options}).outputText)(urban,urban.exports);new Function('module','exports','require',ts.transpileModule(fs.readFileSync(path.join(ROOT,'assets/scripts/view/TerrainGroundRaster.ts'),'utf8'),{compilerOptions:options}).outputText)(m,m.exports,()=>urban.exports);return m.exports;}
async function main(){
 const bundlePath=path.join(LIVE,'redesign_v3/materials.json'),bundle=JSON.parse(fs.readFileSync(bundlePath,'utf8')),base=JSON.stringify(bundle.materials),summer=JSON.stringify(bundle.europeanSummer);
 backup('redesign_v3/materials.json');
 const winter={version:3,fieldBasedLand:false,curvedRoads:true,winterArtwork:true,materials:JSON.parse(JSON.stringify(bundle.europeanSummer.materials))};
 for(const id of ['snow','winter_ground','winter_mud','winter_forest','winter_water','winter_soil']){const rgb=await sharp(path.join(OUT,'sources',id+'.png')).resize(384,384).removeAlpha().toColourspace('srgb').raw().toBuffer();winter.materials[id]={width:384,height:384,rgb:rgb.toString('base64')};}
 // A trampled winter courtyard retains the pale village earth and light frost.
 const yard=Buffer.from(winter.materials.rural_yard.rgb,'base64'),frost=Buffer.from(winter.materials.snow.rgb,'base64');
 for(let i=0;i<yard.length;i++)yard[i]=Math.round(yard[i]*.75+frost[i]*.25);
 winter.materials.winter_yard={...winter.materials.rural_yard,rgb:yard.toString('base64')};
 bundle.europeanWinter=winter;assert.equal(JSON.stringify(bundle.materials),base);assert.equal(JSON.stringify(bundle.europeanSummer),summer);await write(bundlePath,JSON.stringify(bundle)+'\n');
 for(let i=1;i<=4;i++){await save(`tree_0${i}_snow`,await sharp(path.join(OUT,'sources',`tree_0${i}_snow.png`)).trim().png().toBuffer(),256,256);await save(`redesign_v3/rural_roof_0${i}_snow`,await sharp(path.join(OUT,'sources',`rural_roof_0${i}_snow.png`)).trim().png().toBuffer(),256,176);}
 const raster=loadRaster(),engine=new raster.TerrainGroundRaster(winter);
 const png=async a=>sharp(a.pixels,{raw:{width:a.textureWidth,height:a.textureHeight,channels:4}}).extract({left:1,top:1,width:a.textureWidth-2,height:a.textureHeight-2}).png().toBuffer();
 for(const terrain of ['field','forest','mud','road','water'])await save('terrain_'+terrain+'_snow',await png(engine.renderChunk([{pos:{q:0,r:0},terrain}],true,-42,-48,84,96,2)),222,256);
 for(const file of fs.readdirSync(path.join(LIVE,'european_roads'))){const match=file.match(/^european_road_surface_winter_([01]{6})_v(\d)\.png$/);if(!match)continue;const variant=Number(match[2])-1,roads=[...match[1]].map(c=>c==='1'),a=engine.renderChunk([{pos:{q:0,r:0},terrain:'road',roads}],true,-42,-48,84,96,2,variant);
  for(let y=0;y<a.textureHeight;y++)for(let x=0;x<a.textureWidth;x++){const gx=-42+(x-1+.5)/2,gy=-48+(y-1+.5)/2,d=raster.europeanCountryRoadDistance(roads,gx/48,-gy/48,variant)*48;a.pixels[(y*a.textureWidth+x)*4+3]*=Math.max(0,Math.min(1,(48*.36-d)/2));}
  await save('european_roads/'+file.slice(0,-4),await png(a),222,256);
 }
 const bridge=engine.renderChunk([{pos:{q:0,r:0},terrain:'water',bridgeEnds:[0,3]}],true,-42,-48,84,96,2);
 for(let y=0;y<bridge.textureHeight;y++)for(let x=0;x<bridge.textureWidth;x++)if(Math.abs(-48+(y-1+.5)/2)>48*(.205+.028))bridge.pixels[(y*bridge.textureWidth+x)*4+3]=0;
 await save('european_roads/european_bridge_surface_winter_v1',await png(bridge),222,256);
 const patch=Buffer.alloc(256*256*4),earth=Buffer.from(winter.materials.winter_yard.rgb,'base64');for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=(y*256+x)*4,j=(Math.floor(y*384/256)*384+Math.floor(x*384/256))*3;for(let k=0;k<3;k++)patch[i+k]=earth[j+k];patch[i+3]=Math.round(255*raster.ruralYardCoverage((x-127.5)/128,(y-127.5)/128));}
 await save('redesign_v3/rural_yard_patch_snow',await sharp(patch,{raw:{width:256,height:256,channels:4}}).png().toBuffer(),256,256);
 const tiles=[];for(let r=0;r<5;r++)for(let c=0;c<7;c++)tiles.push({pos:{q:c-Math.floor(r/2),r},terrain:c===5?'water':c===1?'mud':r===0||r===4?'forest':'field',hasBuilding:r===3&&c===3,roads:r===2?[true,false,false,true,false,false]:undefined,bridgeEnds:r===2&&c===5?[0,3]:undefined});
 const ground=engine.renderChunk(tiles,true,-48,-48,640,396),layers=[];
 const map=await sharp(ground.pixels,{raw:{width:ground.textureWidth,height:ground.textureHeight,channels:4}}).resize(802,497).png().toBuffer();
 const positions=[[0,.64,.78],[-.47,.35,.84],[.47,.35,.80],[-.58,-.16,.85],[0,.12,.90],[.58,-.16,.82],[-.32,-.54,.85],[.32,-.54,.82],[0,-.1,.79]];
 for(const t of tiles)if(t.terrain==='forest')for(let i=0;i<positions.length;i++){const [dx,dy,s]=positions[i],w=Math.round(60*s*.82),index=(Math.abs(t.pos.q*92811+t.pos.r*6899)+i)%4,input=await sharp(path.join(LIVE,`tree_0${index+1}_snow.png`)).resize(w,w).png().toBuffer(),left=Math.round((Math.sqrt(3)*48*(t.pos.q+t.pos.r/2)+49)*1.25+dx*60-w/2),top=Math.round((72*t.pos.r+49)*1.25-dy*60-w/2);if(left>=0&&top>=0&&left+w<=802&&top+w<=497)layers.push({input,left,top});}
 const village=tiles.find(t=>t.hasBuilding),cx=(Math.sqrt(3)*48*(village.pos.q+village.pos.r/2)+49)*1.25,cy=(72*village.pos.r+49)*1.25;
 for(let i=0;i<6;i++){const input=await sharp(path.join(LIVE,`redesign_v3/rural_roof_0${i%4+1}_snow.png`)).resize(25,17).png().toBuffer();layers.push({input,left:Math.round(cx+[-28,2,22,-22,12,30][i]-12),top:Math.round(cy+[-20,-27,-8,12,22,14][i]-8)});}
 await write(path.join(OUT,'map-preview.png'),await sharp(map).composite(layers).png().toBuffer());
 const manifestPath=path.join(ROOT,'source_art/terrain/backups/pre-v3-20261002/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));for(const name of ['rural_roof_01_snow','rural_roof_02_snow','rural_roof_03_snow','rural_roof_04_snow','rural_yard_patch_snow'])for(const suffix of ['.png','.png.meta']){const f=`assets/resources/textures/terrain/redesign_v3/${name}${suffix}`;if(!manifest.introduced.includes(f))manifest.introduced.push(f);}await write(manifestPath,JSON.stringify(manifest,null,2)+'\n');
 console.log('Installed isolated European winter art, snowy trees, rural roofs, roads and courtyard. Summer and base materials unchanged.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
