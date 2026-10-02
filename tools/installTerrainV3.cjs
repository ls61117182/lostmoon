// Installs the approved art only after a recoverable backup exists.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp');
const ROOT=path.resolve(__dirname,'..'),TERRAIN=path.join(ROOT,'assets/resources/textures/terrain');
const REVIEW=path.join(ROOT,'source_art/terrain/redesign-review-20261002/candidate-v3');
const BACKUP=path.join(ROOT,'source_art/terrain/backups/pre-v3-20261002');
const NEW=path.join(TERRAIN,'redesign_v3');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const relative=p=>path.relative(ROOT,p).replaceAll('\\','/');
const files=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)):[path.join(d,e.name)]);
const changed=new Set(),introduced=new Set();
function record(file){(fs.existsSync(file)?changed:introduced).add(relative(file));}
function uuid(name){const h=crypto.createHash('sha256').update('sherman-terrain-v3:'+name).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
function write(file,data){record(file);fs.writeFileSync(file,data);}
function imageMeta(file,w,h){
  const metaFile=file+'.meta',exists=fs.existsSync(metaFile);
  let m=JSON.parse(fs.readFileSync(exists?metaFile:path.join(BACKUP,'terrain/terrain_field.png.meta'),'utf8'));
  if(!exists){const old=m.uuid,newId=uuid(relative(file));m=JSON.parse(JSON.stringify(m).replaceAll(old,newId));}
  const name=path.basename(file,'.png');
  for(const sub of Object.values(m.subMetas)){
    sub.displayName=name;sub.name=name;
    if(sub.importer==='texture'){sub.userData.wrapModeS='clamp-to-edge';sub.userData.wrapModeT='clamp-to-edge';continue;}
    if(sub.importer!=='sprite-frame')continue;
    Object.assign(sub.userData,{trimType:'none',trimX:0,trimY:0,offsetX:0,offsetY:0,width:w,height:h,rawWidth:w,rawHeight:h,rotated:false,packable:false,pivotX:.5,pivotY:.5,atlasUuid:''});
    sub.userData.vertices={rawPosition:[-w/2,-h/2,0,w/2,-h/2,0,-w/2,h/2,0,w/2,h/2,0],indexes:[0,1,2,2,1,3],uv:[0,h,w,h,0,0,w,0],nuv:[0,1,1,1,0,0,1,0],minPos:[-w/2,-h/2,0],maxPos:[w/2,h/2,0]};
  }
  write(metaFile,JSON.stringify(m,null,2)+'\n');
}
async function save(file,input){const data=await sharp(input).png().toBuffer(),m=await sharp(data).metadata();write(file,data);imageMeta(file,m.width,m.height);}
const hex=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="222" height="256"><polygon points="111,0 222,64 222,192 111,256 0,192 0,64" fill="white"/></svg>');
async function floor(id){
  let input=path.join(REVIEW,'exports/materials',id+'.png');
  if(id==='shallow_water'){
    const {data,info}=await sharp(path.join(REVIEW,'exports/materials/water.png')).resize(192,192).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const tint=[145,201,202];for(let i=0;i<data.length;i++)data[i]=Math.round(data[i]+(tint[i%3]-data[i])*.4);
    input=await sharp(data,{raw:info}).png().toBuffer();
  }
  return sharp(input).resize(222,256).ensureAlpha().composite([{input:hex,blend:'dest-in'}]).png().toBuffer();
}
async function objectCanvas(id,w=128,h=116,angle=0){const input=await sharp(path.join(REVIEW,'exports/objects',id+'.png')).resize(w,h,{fit:'inside'}).rotate(angle,{background:'#00000000'}).png().toBuffer();const m=await sharp(input).metadata();return sharp({create:{width:222,height:256,channels:4,background:'#00000000'}}).composite([{input,left:Math.round((222-m.width)/2),top:Math.round((256-m.height)/2)}]).png().toBuffer();}
async function houseGroup(state,variant){
  if(state==='rubble')return objectCanvas('building_rubble',154,146);
  const id=state==='damaged'?'building_damaged':'building_intact';
  const first=await sharp(path.join(REVIEW,'exports/objects',id+'.png')).resize(105,84,{fit:'inside'}).png().toBuffer();
  const second=await sharp(path.join(REVIEW,'exports/objects/building_intact.png')).resize(88,74,{fit:'inside'}).png().toBuffer();
  const layouts={rowhouses_l:[[26,68],[104,133]],courtyard:[[26,66],[104,140]],workshop:[[38,72],[102,131]]};
  const a=layouts[variant]??layouts.courtyard;
  return sharp({create:{width:222,height:256,channels:4,background:'#00000000'}}).composite([{input:first,left:a[0][0],top:a[0][1]},{input:second,left:a[1][0],top:a[1][1]}]).png().toBuffer();
}
async function main(){
  if(!fs.existsSync(path.join(BACKUP,'BattleScene.ts.backup'))||!fs.existsSync(path.join(BACKUP,'terrain/terrain_field.png')))throw Error('Complete terrain backup is required');
  const originals=files(path.join(BACKUP,'terrain')).map(p=>({live:'assets/resources/textures/terrain/'+path.relative(path.join(BACKUP,'terrain'),p).replaceAll('\\','/'),backup:relative(p),sha256:hash(p)}));
  for(const name of ['terrain.meta','BattleScene.ts','BattleScene.ts.meta']){const backupFile=path.join(BACKUP,name.startsWith('Battle')?name+'.backup':name);originals.push({live:name.startsWith('Battle')?'assets/scripts/view/'+name:'assets/resources/textures/'+name,backup:relative(backupFile),sha256:hash(backupFile)});}
  fs.mkdirSync(NEW,{recursive:true});
  if(!fs.existsSync(NEW+'.meta'))write(NEW+'.meta',JSON.stringify({ver:'1.2.0',importer:'directory',imported:true,uuid:uuid('redesign_v3'),files:[],subMetas:{},userData:{}},null,2)+'\n');
  const materialIds=['grass','soil','mud','sand','water','deep_water','paving','snow','winter_water','timber'],materials={};
  for(const id of materialIds){const rgb=await sharp(path.join(REVIEW,'exports/materials',id+'.png')).resize(192,192).removeAlpha().raw().toBuffer();materials[id]={width:192,height:192,rgb:rgb.toString('base64')};}
  const materialFile=path.join(NEW,'materials.json');write(materialFile,JSON.stringify({version:3,materials})+'\n');
  write(materialFile+'.meta',JSON.stringify({ver:'1.0.3',importer:'json',imported:true,uuid:uuid('materials.json'),files:['.json'],subMetas:{},userData:{}},null,2)+'\n');
  for(const [name,mat]of Object.entries({terrain_road:'grass',terrain_field:'grass',terrain_mud:'mud',terrain_forest:'grass',terrain_water:'water',terrain_deep_water:'deep_water',pacific_sand:'sand',pacific_trees:'grass',pacific_water:'shallow_water',pacific_rocks:'soil',pacific_track:'soil'}))await save(path.join(TERRAIN,name+'.png'),await floor(mat));
  for(const id of ['road','field','mud','forest','water']){
    // Winter fallback floors, with no baked trees or road strips.
    const mat=id==='water'?'winter_water':id==='mud'?'mud':'snow';await save(path.join(TERRAIN,'terrain_'+id+'_snow.png'),await floor(mat));
  }
  const treeSource=path.join(REVIEW,'exports/objects/tree_deciduous.png');
  for(let i=1;i<=4;i++){
    const tree=await sharp(treeSource).rotate((i-1)*90,{background:'#00000000'}).resize(256,256,{fit:'contain',background:'#00000000'}).png().toBuffer();
    await save(path.join(TERRAIN,`tree_0${i}.png`),tree);
    const {data,info}=await sharp(tree).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const p=(y*info.width+x)*4,field=Math.sin(x*.09+y*.04)*.47+Math.sin(x*.037-y*.093)*.32+Math.sin(x*.16+y*.12)*.21;const frost=Math.max(0,Math.min(1,(field-.05)/.55))*.72;if(data[p+3])for(let k=0;k<3;k++)data[p+k]=Math.round(data[p+k]+([216,220,207][k]-data[p+k])*frost);}
    await save(path.join(TERRAIN,`tree_0${i}_snow.png`),await sharp(data,{raw:info}).png().toBuffer());
    await save(path.join(TERRAIN,`pacific_tree_0${i}.png`),path.join(REVIEW,'exports/objects/tree_palm.png'));
  }
  await save(path.join(NEW,'tree_palm.png'),path.join(REVIEW,'exports/objects/tree_palm.png'));
  await save(path.join(NEW,'rocks.png'),path.join(REVIEW,'exports/objects/rocks.png'));
  await save(path.join(NEW,'building_intact.png'),await objectCanvas('building_intact',134,109));
  for(const dir of ['urban','urban/roads'])if(!fs.existsSync(path.join(TERRAIN,dir)))throw Error('Expected original urban directory is absent');
  await save(path.join(TERRAIN,'urban/urban_floor_base_v1.png'),await floor('paving'));
  await save(path.join(TERRAIN,'urban/roads/urban_road_tile_base_v1.png'),await floor('paving'));
  for(const file of fs.readdirSync(path.join(TERRAIN,'urban')).filter(f=>f.endsWith('.png'))){
    if(file.startsWith('urban_dense_indestructible'))await save(path.join(TERRAIN,'urban',file),await objectCanvas('building_solid',140,118));
    else if(file.startsWith('urban_dense_destructible')||file==='urban_dense_rubble.png'){
      const state=file.includes('rubble')?'rubble':file.includes('damaged')?'damaged':'intact';
      const variant=file.includes('rowhouses_l')?'rowhouses_l':file.includes('workshop')?'workshop':'courtyard';
      await save(path.join(TERRAIN,'urban',file),await houseGroup(state,variant));
    }
  }
  const roadDir=path.join(REVIEW,'exports/roads');
  for(const file of fs.readdirSync(roadDir)){
    const m=file.match(/^road_(summer|winter|urban)_([01]{6})\.png$/);if(!m)continue;
    if(m[1]==='urban')await save(path.join(TERRAIN,'urban/roads',`urban_road_surface_${m[2]}_v1.png`),path.join(roadDir,file));
    else for(let variant=1;variant<=3;variant++)await save(path.join(TERRAIN,'european_roads',`european_road_surface_${m[1]}_${m[2]}_v${variant}.png`),path.join(roadDir,file));
  }
  for(const season of ['summer','winter'])await save(path.join(TERRAIN,'european_roads',`european_bridge_surface_${season}_v1.png`),path.join(REVIEW,'exports/bridges',`bridge_${season}_0.png`));
  for(const name of ['TerrainGroundRaster','TerrainGroundRenderer']){
    const file=path.join(ROOT,'assets/scripts/view',name+'.ts');introduced.add(relative(file));
    const meta=JSON.parse(fs.readFileSync(path.join(BACKUP,'BattleScene.ts.meta.backup'),'utf8'));meta.uuid=uuid(name+'.ts');write(file+'.meta',JSON.stringify(meta,null,2)+'\n');
  }
  changed.add('assets/scripts/view/BattleScene.ts');
  fs.writeFileSync(path.join(BACKUP,'manifest.json'),JSON.stringify({version:1,purpose:'Restore terrain before V3 installation',originals,modified:[...changed].sort(),introduced:[...introduced].sort()},null,2)+'\n');
  console.log(JSON.stringify({backup:relative(BACKUP),backedUpFiles:originals.length,modifiedFiles:changed.size,newFiles:introduced.size,materialBytes:fs.statSync(materialFile).size},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
