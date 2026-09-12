const sharp=require('sharp'),fs=require('fs'),path=require('path');
const dir=__dirname,shading=path.join(dir,'../shading-preview-20260909');
(async()=>{
 // Reuse the approved color transfer, extending its exclusion to the entire gun.
 // Strip all installation/backup/manifest side effects from the preview copy.
 let code=fs.readFileSync(path.join(shading,'install-shading.cjs'),'utf8');
 code=code.replace('const dir=__dirname,root=',`const dir=${JSON.stringify(shading)},root=`);
 const start=code.indexOf(" const outdir=path.join(dir,'installed-sources')");
 const end=code.indexOf(' const old=await read',start);
 code=code.slice(0,start)+` const outdir=${JSON.stringify(dir)};\n`+code.slice(end);
 code=code.replace('for(let x=820;x<w;x++)','for(let x=0;x<w;x++)');
 const mstart=code.indexOf(' const manifest=JSON.parse');
 const mend=code.indexOf('})().catch',mstart);
 code=code.slice(0,mstart)+` fs.writeFileSync(path.join(outdir,'checks.json'),JSON.stringify(checks,null,2));\n`+code.slice(mend);
 fs.writeFileSync(path.join(dir,'preview-color-transfer.cjs'),code);
 require('child_process').execFileSync(process.execPath,[path.join(dir,'preview-color-transfer.cjs')],{stdio:'inherit'});
 const W=1950,H=1950,PX=1160,PY=386,C=975;
 const turretPath=path.join(shading,'installed-sources/turret.png');
 const turret=await sharp(turretPath).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 // Rotate using the fixed existing source pivot. Canvas is centered on that pivot.
 const turretCanvas=await sharp({create:{width:2800,height:2800,channels:4,background:'#00000000'}}).composite([{input:turret.data,raw:turret.info,left:1400-PX,top:1400-PY}]).png().toBuffer();
 const rotated=await sharp(turretCanvas).rotate(270).png().toBuffer();
 const views=[];
 for(const [name,hullPath] of [['before',path.join(shading,'installed-sources/hull.png')],['after',path.join(dir,'hull.png')]]){
  const hull=await sharp(hullPath).png().toBuffer();
  const full=await sharp({create:{width:2800,height:2800,channels:4,background:'#00000000'}}).composite([{input:hull,left:1400-PX,top:1400-PY},{input:rotated,left:0,top:0}]).png().toBuffer();
  const composite=await sharp(full).extract({left:710,top:980,width:1450,height:1660}).resize({width:300}).flatten({background:'#61694b'}).png().toBuffer();
  views.push(composite);fs.writeFileSync(path.join(dir,name+'-rotated.png'),composite);
 }
 const meta=await sharp(views[0]).metadata();
 await sharp({create:{width:616,height:meta.height,channels:3,background:'#ffffff'}}).composite(views.map((input,i)=>({input,left:i*316,top:0}))).png().toFile(path.join(dir,'rotation-comparison.png'));
 const old=await sharp(path.join(shading,'installed-sources/hull.png')).ensureAlpha().raw().toBuffer();
 const next=await sharp(path.join(dir,'hull.png')).ensureAlpha().raw().toBuffer();
 let alphaChanges=0,rgbChanges=0;for(let o=0;o<old.length;o+=4){if(old[o+3]!==next[o+3])alphaChanges++;if(old[o]!==next[o]||old[o+1]!==next[o+1]||old[o+2]!==next[o+2])rgbChanges++;}
 if(alphaChanges)throw Error('Alpha changed');console.log({alphaChanges,rgbChanges,previewOnly:true});
})().catch(e=>{console.error(e);process.exit(1)});


