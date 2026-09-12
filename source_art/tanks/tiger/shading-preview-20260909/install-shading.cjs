const sharp=require('sharp'),fs=require('fs'),path=require('path');
const dir=__dirname,root=path.resolve(dir,'../../../..');
async function read(p){return sharp(p).ensureAlpha().raw().toBuffer({resolveWithObject:true});}
(async()=>{
 const outdir=path.join(dir,'installed-sources');fs.mkdirSync(outdir,{recursive:true});
 const before=path.join(outdir,'before');fs.mkdirSync(before,{recursive:true});
 for(const name of ['tiger_top.png','tiger_top_hull.png','tiger_top_turret.png','tiger_top_destroyed.png']){
  for(const suffix of ['', '.meta']){const target=path.join(before,name+suffix);if(!fs.existsSync(target))fs.copyFileSync(path.join(root,'assets/resources/textures/units',name+suffix),target);}
 }
 const mp=path.join(root,'data/tank_art/tiger.json');if(!fs.existsSync(path.join(before,'manifest.json')))fs.copyFileSync(mp,path.join(before,'manifest.json'));
 const old=await read(path.join(dir,'../final-20260909/assembled-source.png')),approved=await read(path.join(dir,'tiger-shading-preview.png'));
 const turret=await read(path.join(dir,'../final-20260909/turret-source.png'));
 const {width:w,height:h}=old.info;
 // Feather a turret-body exclusion area; lighting on the hull must not contain a fixed turret silhouette.
 const mask=Buffer.alloc(w*h);for(let y=0;y<h;y++)for(let x=820;x<w;x++)mask[y*w+x]=turret.data[(y*w+x)*4+3];
 const grown=Buffer.from(mask),horizontal=Buffer.alloc(w*h);
 // Separable binary dilation supported by the project's existing sharp version.
 for(let y=0;y<h;y++){let count=0;for(let x=-45;x<w;x++){if(x+45<w)count+=mask[y*w+x+45]>0?1:0;if(x-46>=0)count-=mask[y*w+x-46]>0?1:0;if(x>=0)horizontal[y*w+x]=count?255:0;}}
 for(let x=0;x<w;x++){let count=0;for(let y=-45;y<h;y++){if(y+45<h)count+=horizontal[(y+45)*w+x]>0?1:0;if(y-46>=0)count-=horizontal[(y-46)*w+x]>0?1:0;if(y>=0)grown[y*w+x]=count?255:0;}}
 const expanded=await sharp(grown,{raw:{width:w,height:h,channels:1}}).blur(24).toColourspace('b-w').raw().toBuffer();
 const checks={};
 for(const role of ['hull','turret','destroyed']){
  const src=await read(path.join(dir,'../final-20260909',role+'-source.png')),out=Buffer.from(src.data);
  for(let i=0;i<w*h;i++){
   const o=i*4;if(!src.data[o+3])continue;
   if(role==='turret'){approved.data.copy(out,o,o,o+3);continue;}
   const gray=(src.data[o]+src.data[o+1]+src.data[o+2])/3,weight=Math.max(0,Math.min(1,(gray-35)/40));
   const exclusion=expanded[i]/255;
   for(let c=0;c<3;c++){
    const ratio=Math.max(.35,Math.min(1.6,approved.data[o+c]/Math.max(25,old.data[o+c])));
    const neutral=(src.data[o+c]*.65+gray*.35)*.82;
    const shaded=src.data[o+c]*ratio;
    out[o+c]=Math.round(Math.max(0,Math.min(255,src.data[o+c]*(1-weight)+(shaded*(1-exclusion)+neutral*exclusion)*weight)));
   }
  }
  let alpha=0;for(let o=3;o<out.length;o+=4)if(out[o]!==src.data[o])alpha++;
  if(alpha)throw Error(role+' alpha changed');checks[role]={alphaChanges:alpha};
  await sharp(out,{raw:src.info}).png().toFile(path.join(outdir,role+'.png'));
 }
 const manifest=JSON.parse(fs.readFileSync(mp,'utf8'));
 for(const role of ['hull','turret','destroyed'])manifest.inputs[role]={path:'source_art/tanks/tiger/shading-preview-20260909/installed-sources/'+role+'.png',background:'alpha'};
 manifest.notes='Approved shading transferred as RGB only; original geometry and alpha preserved; turret-shaped hull shadow excluded for rotation.';
 fs.writeFileSync(mp,JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(path.join(outdir,'checks.json'),JSON.stringify(checks,null,2));console.log(checks);
})().catch(e=>{console.error(e);process.exit(1)});
