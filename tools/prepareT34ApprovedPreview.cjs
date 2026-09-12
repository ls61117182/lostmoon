// Extract the user-approved September 8 preview without redrawing visible paint.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const dir = path.resolve(__dirname, '../source_art/tanks/t34/preview-20260908');
async function raw(name, width, height) {
  let im = sharp(path.join(dir, name)).ensureAlpha();
  if (width) im = im.resize(width, height, {fit:'fill'});
  return im.raw().toBuffer();
}
async function main() {
  const w=1880,h=800,left=170,hw=w-left;
  const normal=await raw('normal-preview.png');
  const under=await raw('hull-underlay-generated.png',w,h);
  for(let i=0;i<under.length;i+=4) if(under[i+1]>under[i]*1.6 && under[i+1]>under[i+2]*1.6 && under[i+1]>100) under[i+3]=0;
  // Trace the existing outer ink boundary, including mantlet and barrel.
  const outline='M0 382 L432 382 L432 334 L529 334 L529 310 Q520 243 586 237 L609 237 Q608 203 638 189 L850 131 Q902 119 939 134 L1149 224 Q1191 244 1192 290 L1192 383 L1199 384 L1199 413 L1192 414 L1192 510 Q1192 556 1153 574 L954 663 Q901 679 856 667 L634 600 Q606 590 608 561 L588 561 Q526 554 528 508 L528 478 L432 474 L432 417 L0 417 Z';
  const mask=await sharp(Buffer.from(`<svg width="${w}" height="${h}"><path d="${outline}" fill="white"/></svg>`)).ensureAlpha().raw().toBuffer();
  const turret=Buffer.alloc(normal.length), hull=Buffer.alloc(hw*h*4);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const i=(y*w+x)*4, inside=mask[i+3]>=128;
    if(inside) normal.copy(turret,i,i,i+4);
    if(x>=left){const j=(y*hw+x-left)*4; (inside?under:normal).copy(hull,j,i,i+4);}
  }
  const wreck=await raw('destroyed-preview.png',hw,h);
  for(let i=3;i<hull.length;i+=4) wreck[i]=hull[i];
  for(const [name,data,width] of [['hull-installed-source',hull,hw],['turret-installed-source',turret,w],['destroyed-installed-source',wreck,hw]])
    await sharp(data,{raw:{width,height:h,channels:4}}).png().toFile(path.join(dir,name+'.png'));
  const composed=await sharp(hull,{raw:{width:hw,height:h,channels:4}}).extend({left, right:0,top:0,bottom:0,background:{r:0,g:0,b:0,alpha:0}}).composite([{input:turret,raw:{width:w,height:h,channels:4},left:0,top:0}]).png().toBuffer();
  await sharp(composed).resize({width:940}).toFile(path.join(dir,'layers-check.png')); 
  const manifestPath=path.resolve(__dirname,'../data/tank_art/t34.json');
  const old=fs.readFileSync(manifestPath);
  const backup=path.join(dir,'manifest-before-install.json');
  if(!fs.existsSync(backup))fs.writeFileSync(backup,old);
  const manifest=JSON.parse(old);
  for(const role of ['hull','turret','destroyed']) manifest.inputs[role]={path:`source_art/tanks/t34/preview-20260908/${role}-installed-source.png`,background:'alpha'};
  manifest.notes='User-approved 2026-09-08 mild simplification. Exact normal-preview paint extracted into layers; generated fill used only under removed turret. Wreck registered to hull canvas and alpha. Installed after explicit user confirmation.';
  manifest.processing.commonScale=139/hw;
  manifest.sourceGeometry={hullPivot:[710,399],turretPivot:[880,399],muzzle:[1,399],commanderHatch:[900,494]};
  fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
}
main().catch(e=>{console.error(e);process.exitCode=1;});

