// User-requested exact width changes and previously authorized PNG pixel crop/alignment.
// Seat is recomposited separately; rear tread pixels are reused behind existing armor.
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const {blank,clean,inspect,text,svg,maskCoverage}=require('./review-helpers.cjs');
const R=__dirname,P=path.join(R,'..'),S7=path.join(P,'sherman-common-ring-20261113-v7'),S8=path.join(P,'sherman-jumbo-geometry-20261113-v8');
const cfg=[{key:'m4a1',label:'M4A1 · 75毫米',old:367,target:367,top:340,height:800,native:76},{key:'m4a1_76_hvss',label:'M4A1(76)W · HVSS',old:416,target:367,top:341,height:799,native:76},{key:'m4a3e2',label:'M4A3E2 · 巨无霸',old:360,target:416,top:340,height:800,native:78}];
const ring=path.join(S7,'generated/common-ring-236.png');
async function plain76(){
 const source=path.join(S7,'references/m4a1_76_hvss_hull-base.png'),r=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true}),d=r.data;
 const patch=await sharp(path.join(S7,'generated/m4a1_76_hvss_deck-clear.png')).resize(280,280).ensureAlpha().raw().toBuffer();
 const cx=396.9904240766074,cy=726.8673050615595;
 for(let y=580;y<860;y++)for(let x=260;x<540;x++){
  const radius=Math.hypot((x-cx)/128,(y-cy)/128),a=Math.max(0,Math.min(1,(1-radius)/.045));if(!a)continue;
  const n=(y*800+x)*4,q=((y-580)*280+x-260)*4;for(let c=0;c<3;c++)d[n+c]=Math.round(d[n+c]*(1-a)+patch[q+c]*a);
 }
 return sharp(d,{raw:r.info}).png().toBuffer();
}
async function resizeHull(buf,box,v){const p=await sharp(buf).extract(box).resize(v.target,v.height,{fit:'fill'}).png().toBuffer();return blank().composite([{input:p,left:Math.round(400-v.target/2),top:v.top}]).png().toBuffer();}
async function rearTreads(buf){
 const {data,info}=await sharp(buf).ensureAlpha().raw().toBuffer({resolveWithObject:true}),before=Buffer.from(data);
 const bands=[];
 for(const [side,x0,x1]of[['left',217,295],['right',505,584]]){let lo=800,hi=-1;for(let x=x0;x<x1;x++)if(data[(1120*800+x)*4+3]>24){lo=Math.min(lo,x);hi=Math.max(hi,x);}if(hi<lo)throw Error('No rear band '+side);bands.push({side,left:lo,right:hi,width:hi-lo+1});}
 const start=1078,y0=1025,y1=1080;let altered=0,clearBefore=0,clearAfter=0,outside=0;
 for(const band of bands)for(let y=y0;y<y1;y++)for(let x=band.left;x<=band.right;x++){
  const n=(y*800+x)*4,sy=y<start?start+(start-y):y,q=(sy*800+x)*4;
  if(x>band.left&&x<band.right&&before[n+3]<24)clearBefore++;
  // Leave the generated opaque armor and tread pixels byte-identical.
  if(data[n+3]>=240)continue;
  const a=before[n+3]/255,b=before[q+3]/255,oa=a+(1-a)*b;if(!oa)continue;
  for(let c=0;c<3;c++)data[n+c]=Math.round((before[n+c]*a+before[q+c]*b*(1-a))/oa);data[n+3]=Math.round(oa*255);altered++;
 }
 for(let y=0;y<1400;y++)for(let x=0;x<800;x++){
  const n=(y*800+x)*4,inWork=y>=y0&&y<y1&&bands.some(b=>x>=b.left&&x<=b.right);
  if(!inWork&&data.subarray(n,n+4).compare(before.subarray(n,n+4)))outside++;
 }
 for(const b of bands)for(let y=y0;y<y1;y++)for(let x=b.left+1;x<b.right;x++)if(data[(y*800+x)*4+3]<24)clearAfter++;
 if(outside||clearAfter)throw Error('Rear fix verification '+JSON.stringify({outside,clearAfter}));
 return{buffer:await sharp(data,{raw:info}).png().toBuffer(),audit:{bands,workY:[y0,y1],originalTreadStart:start,textureMethod:'Mirror/reuse original rear tread rows behind existing hull alpha; no new vehicle painting',alteredPixels:altered,transparentCorePixelsBefore:clearBefore,transparentCorePixelsAfter:clearAfter,pixelsChangedOutsideTailWorkArea:outside}};
}
async function seat(buf){return clean(await sharp(buf).composite([{input:ring,left:282,top:602}]).png().toBuffer());}
async function main(){
 const v76=cfg[1],s76=await plain76();let p76=await resizeHull(s76,{left:192,top:341,width:416,height:799},v76);
 await sharp(p76).toFile(path.join(R,'generated/m4a1_76_plain-before-tail.png'));const fixed=await rearTreads(p76);p76=fixed.buffer;
 await sharp(p76).toFile(path.join(R,'generated/m4a1_76_plain-tail-fixed.png'));
 const jf=path.join(S8,'generated/hull-original-only-v2.png'),js=await inspect(jf),jcrop=await sharp(jf).extract(js.b).png().toBuffer(),jrot=await sharp(jcrop).rotate(90).png().toBuffer(),jm=await sharp(jrot).metadata();
 const pj=await resizeHull(jrot,{left:0,top:0,width:jm.width,height:jm.height},cfg[2]);await sharp(pj).toFile(path.join(R,'generated/m4a3e2_plain-width416.png'));
 const hulls=[await fs.promises.readFile(path.join(S7,'candidates/m4a1_hull.png')),await seat(p76),await seat(pj)];
 let labels=text(28,42,'谢尔曼三型 · 宽度调整与尾部履带修正',29)+text(28,80,'车长保留，座圈同尺寸同位置；炮塔图沿用，未替换游戏资源。',19,'#b8c4ad');
 let assemblyLabels=text(28,42,'调整后的支点合成与地图尺寸',29);const parts=[],assembly=[];
 const report={status:'approval-candidate',gameAssetsReplaced:false,method:'User-requested horizontal resampling; common ring recomposited unchanged; user-authorized reuse/alignment of tread pixels',canvas:[800,1400],ring:{center:[400,720],size:[236,236],blackInterior:[0,0,0]},tailFix:fixed.audit,variants:[]};
 const tpl=await sharp(ring).ensureAlpha().raw().toBuffer();
 for(let i=0;i<cfg.length;i++){
  const v=cfg[i],hb=hulls[i],tb=await fs.promises.readFile(path.join(i===2?S8:S7,'candidates',v.key+'_turret.png')),ab=await clean(await sharp(hb).composite([{input:tb,left:0,top:0}]).png().toBuffer());
  for(const[n,b]of[['hull',hb],['turret',tb],['assembled',ab]])await sharp(b).toFile(path.join(R,'candidates',v.key+'_'+n+'.png'));
  const scan=await inspect(hb);if(scan.b.width!==v.target||scan.b.height!==v.height||scan.b.top!==v.top)throw Error(v.key+' wrong hull bounds '+JSON.stringify(scan.b));
  const d=await sharp(hb).ensureAlpha().raw().toBuffer();let mismatch=0,blackMismatch=0;
  for(let y=0;y<236;y++)for(let x=0;x<236;x++){const q=(y*236+x)*4,n=((602+y)*800+282+x)*4;if(tpl[q+3]===255&&tpl.subarray(q,q+4).compare(d.subarray(n,n+4)))mismatch++;}
  for(let y=622;y<818;y++)for(let x=302;x<498;x++)if(Math.hypot(x-399.5,y-719.5)<98){const n=(y*800+x)*4;if(d[n]||d[n+1]||d[n+2]||d[n+3]!==255)blackMismatch++;}
  const coverage=await maskCoverage(tb,400,720,118);if(mismatch||blackMismatch||coverage.fraction!==1)throw Error(v.key+' seat/coverage');
  const small=await clean(await sharp(ab).resize(v.native,Math.round(v.native*1.75)).toBuffer()),big=await sharp(small).resize(v.native*3,Math.round(v.native*1.75)*3,{kernel:'nearest'}).toBuffer();await sharp(small).toFile(path.join(R,'previews',v.key+'_map-size.png'));
  const x=i*600;labels+=text(x+300,125,v.label,27,'#e9ecdf','middle')+text(x+300,875,`车身宽 ${v.old}px → ${v.target}px`,23,'#e9ecdf','middle')+text(x+300,910,'座圈 236×236 · 圈心 (400,720)',19,'#b8c4ad','middle');
  parts.push({input:await sharp(hb).extract({left:150,top:300,width:500,height:880}).resize(400,704).toBuffer(),left:x+100,top:150});
  assemblyLabels+=text(x+300,110,v.label,27,'#e9ecdf','middle')+text(x+130,1010,`${v.native}px车身长`,18,'#b8c4ad','middle')+text(x+430,1190,'最近邻3倍',18,'#b8c4ad','middle');
  assembly.push({input:await sharp(ab).resize(400,700).toBuffer(),left:x+100,top:130},{input:small,left:x+90,top:820},{input:big,left:x+310,top:760});
  report.variants.push({key:v.key,previousWidth:v.old,targetWidth:v.target,measuredHullBounds:scan.b,horizontalScale:v.target/v.old,seatOpaquePixelMismatch:mismatch,blackInteriorMismatch:blackMismatch,ringCoverage:coverage,turretArtworkChanged:false});
 }
 await sharp(svg(1800,965,'<rect width="1800" height="965" fill="#28352d"/><path d="M600 95V940M1200 95V940" stroke="#526052"/>'+labels)).composite(parts).toFile(path.join(R,'width-review.png'));
 await sharp(svg(1800,1220,'<rect width="1800" height="1220" fill="#28352d"/>'+assemblyLabels)).composite(assembly).toFile(path.join(R,'assembly-review.png'));
 const beforeSeat=await seat(await fs.promises.readFile(path.join(R,'generated/m4a1_76_plain-before-tail.png'))),frame={left:205,top:1010,width:390,height:150};
 await sharp(svg(1600,445,'<rect width="1600" height="445" fill="#28352d"/>'+text(400,45,'76型收窄后 · 修正前',25,'#e9ecdf','middle')+text(1200,45,'修正后 · 履带延伸至装甲下方',25,'#e9ecdf','middle')+text(28,425,'同一尺寸局部放大；只复用原履带像素填补透明缺口。',19,'#b8c4ad'))).composite([{input:await sharp(beforeSeat).extract(frame).resize(780,300,{kernel:'nearest'}).toBuffer(),left:10,top:80},{input:await sharp(hulls[1]).extract(frame).resize(780,300,{kernel:'nearest'}).toBuffer(),left:810,top:80}]).toFile(path.join(R,'tail-before-after.png'));
 fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
