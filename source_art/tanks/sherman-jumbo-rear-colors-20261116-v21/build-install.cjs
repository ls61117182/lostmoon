// Transfer only the broad rear paint/light field from the ImageGen edit.
// Original pixels supply all geometry, alpha, edges, grilles, fixtures and damage.
const fs=require('fs'),path=require('path'),sharp=require('sharp'),crypto=require('crypto');
const R=__dirname,ROOT=path.resolve(R,'../../..'),U=path.join(ROOT,'assets/resources/textures/units');
const {inspect,text,svg}=require('../sherman-destroyed-hulls-20261114-v16/review-helpers.cjs');
const W=158,H=84,k='sherman_jumbo',sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const clamp=n=>Math.max(0,Math.min(255,n));
const ease=n=>{n=Math.max(0,Math.min(1,n));return n*n*(3-2*n);};
async function raw(f){return sharp(f).ensureAlpha().raw().toBuffer({resolveWithObject:true});}
function paint(p){
 const[r,g,b,a]=p,l=.2126*r+.7152*g+.0722*b;
 // Continuous color weights avoid stippling at adjacent quantized olive pixels.
 return a/255*ease((l-38)/22)*ease((r-b-6)/12)*ease((g-b-2)/10)
  *(1-ease((r-g-9)/14))*ease((r-g+6)/6);
}
function field(data){
 const n=W*H,a=new Float32Array(n*4),t=new Float32Array(n*4),out=new Float32Array(n*4),radius=15,sigma=5,weights=[];
 let total=0;for(let d=-radius;d<=radius;d++){const w=Math.exp(-d*d/(2*sigma*sigma));weights.push(w);total+=w;}for(let i=0;i<weights.length;i++)weights[i]/=total;
 for(let p=0;p<data.length;p+=4){const w=paint(data.subarray(p,p+4));for(let c=0;c<3;c++)a[p+c]=data[p+c]*w;a[p+3]=w;}
 for(let y=0;y<H;y++)for(let x=0;x<W;x++)for(let d=-radius;d<=radius;d++){
  const xx=Math.max(0,Math.min(W-1,x+d)),src=(y*W+xx)*4,p=(y*W+x)*4,w=weights[d+radius];for(let c=0;c<4;c++)t[p+c]+=a[src+c]*w;
 }
 for(let y=0;y<H;y++)for(let x=0;x<W;x++)for(let d=-radius;d<=radius;d++){
  const yy=Math.max(0,Math.min(H-1,y+d)),src=(yy*W+x)*4,p=(y*W+x)*4,w=weights[d+radius];for(let c=0;c<4;c++)out[p+c]+=t[src+c]*w;
 }
 for(let p=0;p<out.length;p+=4)if(out[p+3]>.001)for(let c=0;c<3;c++)out[p+c]/=out[p+3];return out;
}
async function main(){
 const unchanged={};for(const kind of ['sherman','sherman76','sherman_jumbo'])for(const part of ['top','top_hull','top_turret','top_destroyed']){
  const f=path.join(U,kind+'_'+part+'.png');if(kind!=='sherman_jumbo'||part==='top_turret')unchanged[f]=sha(f);unchanged[f+'.meta']=sha(f+'.meta');
 }
 unchanged[path.join(ROOT,'data/tank_visuals.csv')]=sha(path.join(ROOT,'data/tank_visuals.csv'));
 const names={hull:k+'_top_hull.png',wreck:k+'_top_destroyed.png',top:k+'_top.png',turret:k+'_top_turret.png'};
 const h=await raw(path.join(R,'references',names.hull)),d=await raw(path.join(R,'references',names.wreck)),top=await raw(path.join(R,'references',names.top)),turret=await raw(path.join(R,'references',names.turret));
 const master=path.join(R,'generated/rear-paint-master.png'),gb=(await inspect(master)).b,nb=(await inspect(path.join(R,'references/sherman_jumbo_upright-hull.png'))).b;
 const patch=await sharp(master).extract(gb).resize(nb.width,nb.height).png().toBuffer(),upright=await sharp({create:{width:84,height:158,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:patch,left:nb.left,top:nb.top}]).png().toBuffer();
 const registered=await sharp(upright).rotate(270).png().toBuffer();await sharp(registered).toFile(path.join(R,'generated/registered-color-master.png'));
 const m=await raw(registered),hf=field(h.data),mf=field(m.data),out=Buffer.from(h.data),wreck=Buffer.from(d.data),delta=new Float32Array(h.data.length);
 let changed=0,wreckChanged=0,frontDiff=0,ringDiff=0,alphaDiff=0;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const p=(y*W+x)*4,r=Math.hypot(x-74.8,y-42),region=ease((x-65)/24)*ease((r-24)/3),a=region*paint(h.data.subarray(p,p+4));
  if(a&&hf[p+3]>.03&&mf[p+3]>.03)for(let c=0;c<3;c++){
   const lightField=.88*(mf[p+c]-hf[p+c]),hotEdge=.32*Math.max(0,h.data[p+c]-hf[p+c]-4);
   // Bound paint correction so the original rear surfaces keep their relief.
   delta[p+c]=Math.max(-27,Math.min(24,lightField-hotEdge))*a;out[p+c]=Math.round(clamp(h.data[p+c]+delta[p+c]));
  }
  if(!out.subarray(p,p+4).equals(h.data.subarray(p,p+4))){changed++;if(x<=65)frontDiff++;if(r<=24)ringDiff++;}
  const damageDiff=Math.max(...[0,1,2].map(c=>Math.abs(d.data[p+c]-h.data[p+c]))),paintDamage=ease((35-damageDiff)/15)*paint(d.data.subarray(p,p+4));
  for(let c=0;c<3;c++)wreck[p+c]=Math.round(clamp(d.data[p+c]+delta[p+c]*paintDamage));
  if(!wreck.subarray(p,p+4).equals(d.data.subarray(p,p+4)))wreckChanged++;
  if(out[p+3]!==h.data[p+3]||wreck[p+3]!==d.data[p+3])alphaDiff++;
 }
 if(frontDiff||ringDiff||alphaDiff)throw Error('Color scope/geometry changed');
 const topOut=Buffer.from(top.data);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const p=(y*W+x)*4,tx=x+41,ty=y,q=(ty*top.info.width+tx)*4,ux=tx+1,uy=ty-9;
  const ta=ux>=0&&ux<turret.info.width&&uy>=0&&uy<turret.info.height?turret.data[(uy*turret.info.width+ux)*4+3]/255:0;
  if(!top.data[q+3])continue;for(let c=0;c<3;c++)topOut[q+c]=Math.round(clamp(top.data[q+c]+(out[p+c]-h.data[p+c])*h.data[p+3]*(1-ta)/top.data[q+3]));
 }
 for(const [name,pixels,info]of [[names.hull,out,h.info],[names.wreck,wreck,d.info],[names.top,topOut,top.info]]){
  const dest=path.join(U,name),backup=path.join(R,'backup',name);if(!fs.existsSync(backup))fs.copyFileSync(dest,backup);if(!fs.existsSync(backup+'.meta'))fs.copyFileSync(dest+'.meta',backup+'.meta');await sharp(pixels,{raw:info}).png().toFile(dest);
 }
 for(const [f,s]of Object.entries(unchanged))if(sha(f)!==s)throw Error('Protected file changed '+f);
 for(const kind of ['sherman','sherman76','sherman_jumbo'])for(const part of ['top','top_hull','top_turret','top_destroyed']){
  const name=kind+'_'+part+'.png',dir=part==='top_destroyed'?'destroyed':'normal';await sharp(path.join(U,name)).rotate(90).png().toFile(path.join(R,dir,name));
 }
 let labels=text(22,36,'巨无霸后半车身 · 配色与高光修正',27)+text(22,73,'统一后部哑光橄榄绿，收敛偏黄亮边；保留380宽度、曲面、格栅、座圈和炮塔。',18,'#b8c4ad');const comps=[];
 for(const [i,f,label]of [[0,path.join(R,'references',names.hull),'调整前 · 车身'],[1,path.join(U,names.hull),'调整后 · 车身'],[2,path.join(U,names.top),'调整后 · 合成']]){
  labels+=text(i*300+150,120,label,22,'#e9ecdf','middle');const buf=await sharp(f).rotate(90).png().toBuffer(),meta=await sharp(buf).metadata();comps.push({input:await sharp(buf).resize(meta.width*3,meta.height*3,{kernel:'nearest'}).toBuffer(),left:i*300+24,top:145});
 }
 await sharp(svg(900,790,'<rect width="900" height="790" fill="#28352d"/>'+labels)).composite(comps).toFile(path.join(R,'rear-color-review.png'));
 fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify({generator:'built-in image_gen rear paint edit; low-frequency paint-field projection to original pixels',colorMasterBounds:gb,sourceShapeBounds:nb,changedHullPixels:changed,changedWreckPixels:wreckChanged,pixelsChangedInFront:frontDiff,ringPixelDifferences:ringDiff,alphaDifferences:alphaDiff,scope:'rear paint only: x>65 in runtime left-facing hull, ring radius24 protected',otherShermansUnchanged:true,turretsUnchanged:true,metasAndConfigurationUnchanged:true,installed:[names.hull,names.top,names.wreck]},null,2));console.log(JSON.stringify({changed,wreckChanged,frontDiff,ringDiff,alphaDiff}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
