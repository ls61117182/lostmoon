const sharp=require('sharp'),fs=require('fs'),path=require('path');
const dir=__dirname,root=path.resolve(dir,'../../../..');
async function load(name){
 const r=await sharp(path.join(dir,name)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const w=1950,h=807,d=Buffer.alloc(w*h*4);
 for(let y=0;y<Math.min(h,r.info.height);y++)for(let x=0;x<Math.min(w,r.info.width);x++){
  const o=(y*w+x)*4,j=(y*r.info.width+x)*4;const [red,g,b]=r.data.subarray(j,j+3);
  if(g>70&&g>red*1.4&&g>b*1.4)continue;
  r.data.copy(d,o,j,j+4);
  if(g>red+15&&g>b+15)d[o+1]=Math.round((red+b)/2);
 }
 return {data:d,info:{width:w,height:h,channels:4}};
}
(async()=>{
 const hull=await load('hull-generated.png'),turret=await load('turret-generated.png'),dead=await load('destroyed-generated.png');
 // Enforce identical hull/wreck alpha and source canvas, without fitting either independently.
 for(let o=0;o<hull.data.length;o+=4){
  if(hull.data[o+3]&&!dead.data[o+3])hull.data.copy(dead.data,o,o,o+3);
  dead.data[o+3]=hull.data[o+3];
  if(!dead.data[o+3])dead.data.fill(0,o,o+4);
 }
 for(const [name,r] of [['hull',hull],['turret',turret],['destroyed',dead]])await sharp(r.data,{raw:r.info}).png().toFile(path.join(dir,name+'-source.png'));
 const manifest={schemaVersion:1,kind:'tiger',notes:'User-approved v6 blueprint proportions; covered tracks; common canvas and scale; wreck alpha locked to hull.',inputs:{hull:{path:'source_art/tanks/tiger/final-20260909/hull-source.png',background:'alpha'},turret:{path:'source_art/tanks/tiger/final-20260909/turret-source.png',background:'alpha'},destroyed:{path:'source_art/tanks/tiger/final-20260909/destroyed-source.png',background:'alpha'}},processing:{alphaThreshold:32,commonScale:0.109,outlinePixels:0,hullPadding:[1,1,1,1],turretPadding:[1,1,1,1]},sourceGeometry:{hullPivot:[1160,386],turretPivot:[1160,386],muzzle:[69,386],commanderHatch:[1270,495]}};
 fs.writeFileSync(path.join(root,'data/tank_art/tiger.json'),JSON.stringify(manifest,null,2)+'\n');
 await sharp(hull.data,{raw:hull.info}).composite([{input:turret.data,raw:turret.info,left:0,top:0}]).png().toFile(path.join(dir,'assembled-source.png'));
 console.log('Source alpha cleaned; wreck alpha locked; source layers share 1950x807 canvas.');
})().catch(e=>{console.error(e);process.exit(1)});
