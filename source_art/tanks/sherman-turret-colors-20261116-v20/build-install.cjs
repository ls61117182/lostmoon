// ImageGen supplies color-only edit masters. Project the paint ramps onto the
// existing sprite pixels, then calibrate to the untouched M4A1 reference.
// No generated silhouette, linework or geometry is installed.
const fs=require('fs'),path=require('path'),sharp=require('sharp'),crypto=require('crypto');
const R=__dirname,ROOT=path.resolve(R,'../../..'),U=path.join(ROOT,'assets/resources/textures/units');
const {text,svg}=require('../sherman-destroyed-hulls-20261114-v16/review-helpers.cjs');
const kinds=['sherman','sherman76','sherman_jumbo'];
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const clamp=v=>Math.max(0,Math.min(255,v));
const smooth=v=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
async function raw(f){return sharp(f).ensureAlpha().raw().toBuffer({resolveWithObject:true});}
function paint(p){const[r,g,b,a]=p;return a>250&&r>=g-2&&g-b>=8&&r-b>14&&Math.min(r,g,b)>40&&r<200;}
function anchors(data){
 const values=[[],[],[]];for(let p=0;p<data.length;p+=4)if(paint(data.subarray(p,p+4)))for(let c=0;c<3;c++)values[c].push(data[p+c]);
 if(values[0].length<100)throw Error('Not enough painted armor samples');
 for(const a of values)a.sort((a,b)=>a-b);
 return{samples:values[0].length,channels:values.map(a=>[0,...[.2,.5,.8].map(q=>a[Math.floor((a.length-1)*q)]),255])};
}
function ramp(x,a,b){let i=0;while(i<3&&x>a[i+1])i++;return b[i]+(x-a[i])*(b[i+1]-b[i])/(a[i+1]-a[i]);}
function weight(p){const[r,g,b,a]=p;if(!a||r<g-3||g<b+5)return 0;const l=.2126*r+.7152*g+.0722*b;return smooth((l-38)/20)*smooth((r-b-8)/8);}
function fixedMedian(source,changed){const vals=[[],[],[]];for(let p=0;p<source.length;p+=4)if(paint(source.subarray(p,p+4)))for(let c=0;c<3;c++)vals[c].push(changed[p+c]);return vals.map(a=>a.sort((a,b)=>a-b)[Math.floor((a.length-1)*.5)]);}
async function main(){
 for(const d of ['normal','destroyed','backup'])fs.mkdirSync(path.join(R,d),{recursive:true});
 const ref=(await raw(path.join(R,'references/sherman_top_turret.png'))).data,target=anchors(ref),refMedian=target.channels.map(a=>a[2]);
 const report={date:'2026-11-16',reference:'unchanged M4A1 turret',tool:'built-in image_gen edit masters followed by source-pixel paint projection',referenceAnchors:target,referenceMedian:refMedian,shapeAndAlphaUnchanged:true,models:[]};
 const unchanged={};
 for(const k of kinds)for(const part of ['top_hull','top_destroyed']){const f=path.join(U,k+'_'+part+'.png');unchanged[f]=sha(f);}
 for(const part of ['top','top_turret']){const f=path.join(U,'sherman_'+part+'.png');unchanged[f]=sha(f);}
 const metas={};for(const k of kinds)for(const part of ['top','top_hull','top_turret','top_destroyed']){const f=path.join(U,k+'_'+part+'.png.meta');metas[f]=sha(f);}
 for(const k of ['sherman76','sherman_jumbo']){
  const f=k+'_top_turret.png',original=await raw(path.join(R,'references',f)),master=await raw(path.join(R,'generated',k+'-color-master.png')),src=anchors(original.data),gen=anchors(master.data),out=Buffer.from(original.data);
  let changed=0,alphaDiff=0,protectedDiff=0;
  for(let p=0;p<out.length;p+=4){
   const w=weight(original.data.subarray(p,p+4));
   for(let c=0;c<3;c++){
    const masterTone=ramp(original.data[p+c],src.channels[c],gen.channels[c]),finalTone=ramp(masterTone,gen.channels[c],target.channels[c]);
    out[p+c]=Math.round(clamp(original.data[p+c]*(1-w)+finalTone*w));
   }
   if(!out.subarray(p,p+4).equals(original.data.subarray(p,p+4))){changed++;if(w===0)protectedDiff++;}
   if(out[p+3]!==original.data[p+3])alphaDiff++;
  }
  if(alphaDiff||protectedDiff)throw Error('Paint-only invariant failed');
  const beforeMedian=fixedMedian(original.data,original.data),afterMedian=fixedMedian(original.data,out),distance=m=>m.reduce((s,v,i)=>s+Math.abs(v-refMedian[i]),0);
  if(distance(afterMedian)>=distance(beforeMedian))throw Error('Palette match did not improve');
  const turret=await sharp(out,{raw:original.info}).png().toBuffer();
  const topFile=k+'_top.png',top=await raw(path.join(R,'references',topFile)),topOut=Buffer.from(top.data);
  // Turret left=-1, top=9 in the existing 199x84 flattened runtime canvas.
  // Apply only RGB deltas through the existing alpha composite; the full-image
  // footprint and every pixel outside recolored turret paint remain exact.
  for(let y=0;y<original.info.height;y++)for(let x=0;x<original.info.width;x++){
   const tx=x-1,ty=y+9;if(tx<0||tx>=top.info.width||ty>=top.info.height)continue;
   const p=(y*original.info.width+x)*4,q=(ty*top.info.width+tx)*4;
   if(!top.data[q+3])continue;for(let c=0;c<3;c++)topOut[q+c]=Math.round(clamp(top.data[q+c]+(out[p+c]-original.data[p+c])*original.data[p+3]/top.data[q+3]));
  }
  const topBuf=await sharp(topOut,{raw:top.info}).png().toBuffer();
  for(const [name,buf]of [[f,turret],[topFile,topBuf]]){
   const asset=path.join(U,name),backup=path.join(R,'backup',name);if(!fs.existsSync(backup))fs.copyFileSync(asset,backup);
   if(!fs.existsSync(backup+'.meta'))fs.copyFileSync(asset+'.meta',backup+'.meta');
   await sharp(buf).rotate(90).png().toFile(path.join(R,'normal',name));await sharp(buf).toFile(asset);
  }
  report.models.push({kind:k,sourceAnchors:src,imageGenAnchors:gen,sourceMedian:beforeMedian,finalMedian:afterMedian,referenceMedian:refMedian,medianRGBDistanceBefore:distance(beforeMedian),medianRGBDistanceAfter:distance(afterMedian),paintPixelsChanged:changed,alphaDifferences:alphaDiff,protectedPixelDifferences:protectedDiff,installed:[f,topFile]});
 }
 for(const [f,h]of Object.entries(unchanged))if(sha(f)!==h)throw Error('Protected asset changed '+f);
 for(const [f,h]of Object.entries(metas))if(sha(f)!==h)throw Error('Meta changed '+f);
 // Snapshot complete current source layers, upright like previous revisions.
 for(const k of kinds)for(const part of ['top','top_hull','top_turret','top_destroyed']){
  const name=k+'_'+part+'.png',dir=part==='top_destroyed'?'destroyed':'normal';await sharp(path.join(U,name)).rotate(90).png().toFile(path.join(R,dir,name));
 }
 let labels=text(24,38,'谢尔曼炮塔配色 · 以M4A1为准',27)+text(24,76,'仅统一涂装色调与明暗，保留原始轮廓和全部结构。合成图为正式尺寸最近邻2倍。',18,'#b8c4ad');const comps=[];
 for(let i=0;i<kinds.length;i++){
  const k=kinds[i],x=i*480;labels+=text(x+240,121,['M4A1 · 配色基准','M4A1(76)W HVSS','M4A3E2 Jumbo · 380宽'][i],23,'#e9ecdf','middle')+text(x+240,159,'调整前',18,'#b8c4ad','middle')+text(x+240,405,k==='sherman'?'基准保持':'统一后',18,'#b8c4ad','middle')+text(x+240,645,'正式PNG原始尺寸',18,'#b8c4ad','middle');
  comps.push({input:await sharp(path.join(R,'references',k+'_top.png')).resize(398,168,{kernel:'nearest'}).toBuffer(),left:x+41,top:183},{input:await sharp(path.join(U,k+'_top.png')).resize(398,168,{kernel:'nearest'}).toBuffer(),left:x+41,top:430},{input:fs.readFileSync(path.join(U,k+'_top.png')),left:x+140,top:675});
 }
 await sharp(svg(1440,800,'<rect width="1440" height="800" fill="#28352d"/>'+labels)).composite(comps).toFile(path.join(R,'color-review.png'));
 report.m4a1ReferenceUnchanged=true;report.allHullsAndWrecksUnchanged=true;report.allMetasUnchanged=true;fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.models.map(m=>({kind:m.kind,before:m.sourceMedian,after:m.finalMedian,target:m.referenceMedian,alphaDiff:m.alphaDifferences,changed:m.paintPixelsChanged})),null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
