const fs=require('fs'),path=require('path'),sharp=require('sharp'),ts=require('typescript');
const {sprite,write}=require('./installTerrainV4.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'source_art/terrain/redesign-review-20261002/pacific-tree-floor');
async function main(){
  throw new Error('Retired: Pacific trees now use the open sand floor. Do not reinstall the discarded grove texture.');
  const p=path.join(ROOT,'assets/resources/textures/terrain/redesign_v3/materials.json');
  if(!fs.existsSync(path.join(OUT,'materials-before.json')))fs.copyFileSync(p,path.join(OUT,'materials-before.json'));
  const b=JSON.parse(fs.readFileSync(p,'utf8')),rgb=await sharp(path.join(OUT,'source.png')).resize(384,384).removeAlpha().raw().toBuffer();
  b.materials.pacific_tree_floor={width:384,height:384,rgb:rgb.toString('base64')};
  await write(p,JSON.stringify(b)+'\n');
  const options={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},urban={exports:{}},raster={exports:{}};
  new Function('module','exports',ts.transpileModule(fs.readFileSync(path.join(ROOT,'assets/scripts/core/UrbanTerrain.ts'),'utf8'),{compilerOptions:options}).outputText)(urban,urban.exports);
  new Function('module','exports','require',ts.transpileModule(fs.readFileSync(path.join(ROOT,'assets/scripts/view/TerrainGroundRaster.ts'),'utf8'),{compilerOptions:options}).outputText)(raster,raster.exports,()=>urban.exports);
  const engine=new raster.exports.TerrainGroundRaster(b),a=engine.renderChunk([{pos:{q:0,r:0},terrain:'trees'}],false,-42,-48,84,96);
  await sprite('pacific_trees',await sharp(a.pixels,{raw:{width:a.textureWidth,height:a.textureHeight,channels:4}}).extract({left:1,top:1,width:84,height:96}).resize(222,256).png().toBuffer(),222,256);
  console.log('Installed dedicated sandy palm-grove floor.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
