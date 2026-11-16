// image_gen clears old deck seats and makes the common black-centered ring.
// Deterministic compositing reuses the SAME ring raster, scale and anchor for all three.
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const {blank,clean,inspect,part,text,svg,maskCoverage}=require('./review-helpers.cjs');
const R=__dirname,C=[400,720],D=236;
const a5=JSON.parse(fs.readFileSync(path.join(R,'../sherman-track-jumbo-20261113-v5/review-audit.json')));
const a6=JSON.parse(fs.readFileSync(path.join(R,'../sherman-jumbo-userref-20261113-v6/review-audit.json')));
const V=[
 {key:'m4a1',label:'M4A1 · 75毫米',old:a5.variants[0].pivot,erase:[128,128],tp:[550,1020],scale:a5.variants[0].turretScale,source:'../sherman-track-jumbo-20261113-v5/generated/m4a1_turret-unchanged.png',native:76},
 {key:'m4a1_76_hvss',label:'M4A1(76)W · HVSS',old:a5.variants[1].pivot,erase:[128,128],tp:[401,1405],scale:a5.variants[1].turretScale,source:'../sherman-track-jumbo-20261113-v5/generated/m4a1_76_hvss_turret-unchanged.png',native:76},
 {key:'m4a3e2',label:'M4A3E2 · 巨无霸',old:a6.pivot,erase:[115,119],tp:a6.sourceTurretPivot,scale:a6.turretScale,source:'../sherman-jumbo-userref-20261113-v6/generated/m4a3e2-turret-v4.png',native:78},
];
async function commonRing(){
 const file=path.join(R,'generated/common-ring.png'),scan=await inspect(file),b=scan.b;
 const side=Math.max(b.width,b.height),left=Math.round(b.left+(b.width-side)/2),top=Math.round(b.top+(b.height-side)/2);
 const {data,info}=await sharp(file).extract({left,top,width:side,height:side}).resize(D,D).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let black=0,nearBlackMax=0;
 for(let y=0;y<D;y++)for(let x=0;x<D;x++){
  const p=(y*D+x)*4,r=Math.hypot(x-(D-1)/2,y-(D-1)/2);
  if(data[p+3]>250)data[p+3]=255;
  if(r<98){nearBlackMax=Math.max(nearBlackMax,data[p],data[p+1],data[p+2]);if(Math.max(data[p],data[p+1],data[p+2])>16)throw Error('Ring interior is not black');data[p]=data[p+1]=data[p+2]=0;data[p+3]=255;black++;}
  if(data[p+3]<=4)data.fill(0,p,p+4);
 }
 const ring=await sharp(data,{raw:info}).png().toBuffer();await sharp(ring).toFile(path.join(R,'generated/common-ring-236.png'));
 return{ring,data,black,nearBlackMax};
}
async function deck(v){
 const {data,info}=await sharp(path.join(R,'references',v.key+'_hull-base.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true}),original=Buffer.from(data);
 const p=await sharp(path.join(R,'generated',v.key+'_deck-clear.png')).resize(280,280).ensureAlpha().raw().toBuffer();
 let changed=0;
 for(let y=580;y<860;y++)for(let x=260;x<540;x++){
  const r=Math.hypot((x-v.old[0])/v.erase[0],(y-v.old[1])/v.erase[1]),alpha=Math.max(0,Math.min(1,(1-r)/.045));if(!alpha)continue;
  const n=(y*800+x)*4,q=((y-580)*280+x-260)*4;
  for(let c=0;c<3;c++)data[n+c]=Math.round(data[n+c]*(1-alpha)+p[q+c]*alpha);changed++;
 }
 return{buffer:await sharp(data,{raw:info}).png().toBuffer(),original,patchPixels:changed};
}
async function main(){
 const shared=await commonRing(),ringPart={input:shared.ring,left:C[0]-D/2,top:C[1]-D/2};
 const report={status:'approval-candidate',generator:'built-in image_gen + deterministic shared-raster compositing',gameAssetsModified:false,canvas:[800,1400],nominalHullLength:800,commonRing:{center:C,canvasDiameter:D,blackInteriorRadius:98,blackInteriorRGB:[0,0,0],blackPixelCount:shared.black,generatedInteriorMaxRGB:shared.nearBlackMax},variants:[]};
 let labels=text(28,42,'三型谢尔曼 · 同尺寸、同位置、黑色内圈',29)+text(28,78,'同一张座圈图复用，统一车身比例与圈心；仅候选，未替换游戏资源。',19,'#b8c4ad');
 let alabels=text(28,42,'统一座圈后的炮塔支点合成与小尺寸检查',29);
 const art=[],assembled=[];
 for(let i=0;i<V.length;i++){
  const v=V[i],d=await deck(v),composited=await sharp(d.buffer).composite([ringPart]).ensureAlpha().raw().toBuffer();
  // Preserve the original bytes outside the working masks, including very faint
  // edge pixels that a general-purpose alpha compositor can round differently.
  for(let y=0;y<1400;y++)for(let x=0;x<800;x++){
   const inPatch=Math.hypot((x-v.old[0])/v.erase[0],(y-v.old[1])/v.erase[1])<1;
   const inRing=x>=ringPart.left&&x<ringPart.left+D&&y>=ringPart.top&&y<ringPart.top+D;
   if(!inPatch&&!inRing){const n=(y*800+x)*4;d.original.copy(composited,n,n,n+4);}
  }
  const hb=await sharp(composited,{raw:{width:800,height:1400,channels:4}}).png().toBuffer();
  const tf=path.join(R,v.source),scan=await inspect(tf),tl=await part(tf,scan,v.scale,v.tp,C),tb=await clean(await blank().composite([tl]).png().toBuffer()),ab=await clean(await sharp(hb).composite([{input:tb,left:0,top:0}]).png().toBuffer());
  for(const[n,b]of[['hull',hb],['turret',tb],['assembled',ab]])await sharp(b).toFile(path.join(R,'candidates',v.key+'_'+n+'.png'));
  const coverage=await maskCoverage(tb,C[0],C[1],D/2);if(coverage.fraction!==1)throw Error(v.key+' uncovered seat '+JSON.stringify(coverage));
  const raw=await sharp(hb).raw().toBuffer();let outsideChanges=0,commonPixelMismatch=0,blackMismatch=0;
  for(let y=0;y<1400;y++)for(let x=0;x<800;x++){
   const n=(y*800+x)*4,inPatch=Math.hypot((x-v.old[0])/v.erase[0],(y-v.old[1])/v.erase[1])<1;
   const rx=x-ringPart.left,ry=y-ringPart.top,inRing=rx>=0&&rx<D&&ry>=0&&ry<D;
   if(!inPatch&&!inRing&&raw.subarray(n,n+4).compare(d.original.subarray(n,n+4)))outsideChanges++;
   if(inRing){const q=(ry*D+rx)*4;if(shared.data[q+3]===255&&raw.subarray(n,n+4).compare(shared.data.subarray(q,q+4)))commonPixelMismatch++;}
   if(Math.hypot(x-399.5,y-719.5)<98&&(raw[n]||raw[n+1]||raw[n+2]||raw[n+3]!==255))blackMismatch++;
  }
  if(outsideChanges||commonPixelMismatch||blackMismatch)throw Error(v.key+' scope/shared/black verification failed: '+JSON.stringify({outsideChanges,commonPixelMismatch,blackMismatch}));
  const small=await clean(await sharp(ab).resize(v.native,Math.round(v.native*1.75)).toBuffer()),big=await sharp(small).flatten({background:'#28352d'}).resize(v.native*3,Math.round(v.native*1.75)*3,{kernel:'nearest'}).toBuffer();
  await sharp(small).toFile(path.join(R,'previews',v.key+'_map-size.png'));
  const x=i*600;
  labels+=text(x+300,125,v.label,27,'#e9ecdf','middle')+text(x+300,850,'座圈局部 · 相同裁切比例',19,'#b8c4ad','middle');
  art.push({input:await sharp(hb).extract({left:150,top:300,width:500,height:880}).resize(400,704).toBuffer(),left:x+100,top:140},{input:await sharp(hb).extract({left:270,top:590,width:260,height:260}).resize(234,234).toBuffer(),left:x+183,top:880});
  alabels+=text(x+300,110,v.label,27,'#e9ecdf','middle')+text(x+130,1010,`${v.native}px车身长`,18,'#b8c4ad','middle')+text(x+430,1190,'最近邻3倍',18,'#b8c4ad','middle');
  assembled.push({input:await sharp(ab).resize(400,700).toBuffer(),left:x+100,top:130},{input:small,left:x+90,top:820},{input:big,left:x+310,top:760});
  report.variants.push({key:v.key,ringCenter:C,ringDiameter:D,turretPivot:C,sourceTurretPivot:v.tp,turretScale:v.scale,blackInteriorMismatch:blackMismatch,opaqueSharedRingMismatch:commonPixelMismatch,pixelsChangedOutsideRingWorkArea:outsideChanges,ringCoverage:coverage});
 }
 await sharp(svg(1800,1150,'<rect width="1800" height="1150" fill="#28352d"/><path d="M600 95V1130M1200 95V1130" stroke="#526052"/>'+labels)).composite(art).toFile(path.join(R,'common-ring-review.png'));
 await sharp(svg(1800,1220,'<rect width="1800" height="1220" fill="#28352d"/>'+alabels)).composite(assembled).toFile(path.join(R,'assembly-review.png'));
 fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
