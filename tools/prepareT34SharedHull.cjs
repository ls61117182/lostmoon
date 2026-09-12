const fs=require('fs'),path=require('path'),sharp=require('sharp');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'source_art/tanks/t34/shared-hull-20260908');
async function read(p){return sharp(path.join(root,p)).ensureAlpha().raw().toBuffer({resolveWithObject:true});}
async function main(){
 fs.mkdirSync(dir,{recursive:true});
 const hull=await read('source_art/tanks/t34_85/hull-selected.png');
 const wreck=await read('source_art/tanks/t34_85/destroyed-from-hull.png');
 const w=hull.info.width;
 for(const [role,im] of [['hull',hull],['destroyed',wreck]]){
  const src=Buffer.from(im.data);
  // Copy existing bare fender paint over the removed upper rear drum.
  // Swap the lower drum with the equally sized empty fender immediately ahead.
  for(let y=0;y<449;y++)for(let x=0;x<w;x++){
   let sx=x;
   if(y<67&&x>=677&&x<832)sx=440+(x-677)%80;
   if(y>=381&&x>=523&&x<677)sx=x+154;
   if(y>=381&&x>=677&&x<831)sx=x-154;
   if(sx!==x)src.copy(im.data,(y*w+x)*4,(y*w+sx)*4,(y*w+sx)*4+3);
  }
  await sharp(im.data,{raw:im.info}).png().toFile(path.join(dir,role+'.png'));
 }
 const tur=await read('assets/resources/textures/units/t34_top_turret.png');
 const ref=await read('assets/resources/textures/units/t34_85_top_turret.png');
 function paintMean(im){let sum=[0,0,0],n=0;for(let i=0;i<im.data.length;i+=4){const [r,g,b,a]=im.data.subarray(i,i+4);if(a>240&&g>r&&g>b*1.15&&g>45){sum[0]+=r;sum[1]+=g;sum[2]+=b;n++;}}return sum.map(v=>v/n);}
 const from=paintMean(tur),to=paintMean(ref),gain=to.map((v,i)=>v/from[i]);
 for(let i=0;i<tur.data.length;i+=4)for(let c=0;c<3;c++)tur.data[i+c]=Math.min(255,Math.round(tur.data[i+c]*gain[c]));
 await sharp(tur.data,{raw:tur.info}).resize(660,307,{fit:'fill',kernel:'nearest'}).png().toFile(path.join(dir,'turret.png'));
 const mp=path.join(root,'data/tank_art/t34.json');
 if(!fs.existsSync(path.join(dir,'manifest-before.json')))fs.copyFileSync(mp,path.join(dir,'manifest-before.json'));
 const m=JSON.parse(fs.readFileSync(mp));
 for(const role of ['hull','turret','destroyed'])m.inputs[role]={path:`source_art/tanks/t34/shared-hull-20260908/${role}.png`,background:'alpha'};
 m.processing.commonScale=.15;
 m.sourceGeometry={hullPivot:[410,226],turretPivot:[72/.15,23/.15],muzzle:[1/.15,23/.15],commanderHatch:[74/.15,31/.15]};
 m.notes='T34/85 source hull copied exactly except fuel drum rectangles: two aligned drums. Current T34/76 turret geometry retained; RGB paint gain matched to current T34/85 turret. Wreck shares the same fuel layout. User requested installation.';
 fs.writeFileSync(mp,JSON.stringify(m,null,2)+'\n');
 fs.writeFileSync(path.join(dir,'palette.json'),JSON.stringify({from,to,gain},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
