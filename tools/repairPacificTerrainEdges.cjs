const fs=require('fs'),path=require('path'),sharp=require('sharp'),ts=require('typescript');
const {sprite,write}=require('./installTerrainV4.cjs');
const ROOT=path.resolve(__dirname,'..');
async function main(){
  const out=path.join(ROOT,'source_art/terrain/redesign-review-20261002/pacific-edge-repair');
  fs.mkdirSync(out,{recursive:true});
  const file=path.join(ROOT,'assets/resources/textures/terrain/redesign_v3/materials.json');
  if(!fs.existsSync(path.join(out,'materials-before.json')))fs.copyFileSync(file,path.join(out,'materials-before.json'));
  const bundle=JSON.parse(fs.readFileSync(file,'utf8'));
  const atlas=path.join(ROOT,'source_art/terrain/redesign-review-20261002/candidate-v4/sources/materials.png');
  const meta=await sharp(atlas).metadata(),w=Math.floor(meta.width/3),h=Math.floor(meta.height/3),inset=12;
  // Discard the neighbouring-cell colour strips before resizing and reflecting.
  for(const [id,index] of [['grass',0],['sand',2],['water',4],['deep_water',5]]){
    const rgb=await sharp(atlas).extract({left:index%3*w+inset,top:Math.floor(index/3)*h+inset,width:w-inset*2,height:h-inset*2}).resize(384,384).removeAlpha().raw().toBuffer();
    bundle.materials[id]={width:384,height:384,rgb:rgb.toString('base64')};
  }
  await write(file,JSON.stringify(bundle)+'\n');
  const options={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},urban={exports:{}},raster={exports:{}};
  new Function('module','exports',ts.transpileModule(fs.readFileSync(path.join(ROOT,'assets/scripts/core/UrbanTerrain.ts'),'utf8'),{compilerOptions:options}).outputText)(urban,urban.exports);
  new Function('module','exports','require',ts.transpileModule(fs.readFileSync(path.join(ROOT,'assets/scripts/view/TerrainGroundRaster.ts'),'utf8'),{compilerOptions:options}).outputText)(raster,raster.exports,()=>urban.exports);
  const engine=new raster.exports.TerrainGroundRaster(bundle);
  for(const [name,terrain]of [['pacific_sand','clear'],['pacific_trees','trees'],['pacific_water','beach'],['pacific_track','clear']]){
    const a=engine.renderChunk([{pos:{q:0,r:0},terrain}],false,-42,-48,84,96);
    await sprite(name,await sharp(a.pixels,{raw:{width:a.textureWidth,height:a.textureHeight,channels:4}}).extract({left:1,top:1,width:84,height:96}).resize(222,256).png().toBuffer(),222,256);
  }
  // Show the world-origin join without GPU rendering, before and after cleaning.
  for(const [name,data]of [['before',JSON.parse(fs.readFileSync(path.join(out,'materials-before.json'),'utf8'))],['after',bundle]]){
    const m=data.materials.sand,src=Buffer.from(m.rgb,'base64'),n=512,p=Buffer.alloc(n*n*3);
    const reflected=(v,len)=>{v=((Math.floor(v)%(len*2))+len*2)%(len*2);return v<len?v:len*2-v-1;};
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=(reflected(y-n/2,m.height)*m.width+reflected(x-n/2,m.width))*3;src.copy(p,(y*n+x)*3,i,i+3);}
    await sharp(p,{raw:{width:n,height:n,channels:3}}).png().toFile(path.join(out,'sand-'+name+'.png'));
  }
  console.log('Repaired Pacific atlas edges and fallback terrain sprites.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
