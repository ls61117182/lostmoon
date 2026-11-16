// image_gen supplies rear surface rendering; code only aligns/blends that local layer
// under the existing silhouette, preserving front, common ring, tracks and turret.
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const {blank,clean,inspect,text,svg,maskCoverage}=require('./review-helpers.cjs');
const R=__dirname;
async function main(){
 const oldFile=path.join(R,'references/hull-base.png'),old=await sharp(oldFile).ensureAlpha().raw().toBuffer({resolveWithObject:true}),src=old.data,dst=Buffer.from(src);
 const local=await sharp(path.join(R,'generated/rear-volume-v3.png')).resize(416,300,{fit:'fill'}).ensureAlpha().raw().toBuffer();
 let changed=0,alphaChanged=0,outsideChanged=0,frontChanged=0,trackChanged=0;
 for(let y=840;y<1140;y++)for(let x=192;x<608;x++){
  const n=(y*800+x)*4;if(!src[n+3])continue;
  const track=y>=1098&&(x<282||x>=518);if(track)continue;
  const q=((y-840)*416+x-192)*4;
  const a=Math.max(0,Math.min(1,(y-840)/20,(x-192)/3,(607-x)/3,local[q+3]/255));if(!a)continue;
  for(let c=0;c<3;c++)dst[n+c]=Math.round(src[n+c]*(1-a)+local[q+c]*a);
 }
 for(let y=0;y<1400;y++)for(let x=0;x<800;x++){
  const n=(y*800+x)*4,diff=dst.subarray(n,n+4).compare(src.subarray(n,n+4))!==0;
  if(dst[n+3]!==src[n+3])alphaChanged++;
  if(diff){changed++;if(x<192||x>=608||y<840||y>=1140)outsideChanged++;if(y<840)frontChanged++;if(y>=1098&&(x<282||x>=518))trackChanged++;}
 }
 if(alphaChanged||outsideChanged||frontChanged||trackChanged)throw Error('Protected image region modified');
 const hb=await sharp(dst,{raw:old.info}).png().toBuffer(),tb=await fs.promises.readFile(path.join(R,'references/turret-unchanged.png')),ab=await clean(await sharp(hb).composite([{input:tb,left:0,top:0}]).png().toBuffer());
 for(const[n,b]of[['hull',hb],['turret',tb],['assembled',ab]])await sharp(b).toFile(path.join(R,'candidates','m4a3e2_'+n+'.png'));
 const hs=await inspect(hb);if(hs.b.width!==416||hs.b.height!==800||hs.b.top!==340)throw Error('Changed hull dimensions');
 const t=await sharp(path.join(R,'references/common-ring.png')).ensureAlpha().raw().toBuffer();let ringMismatch=0,blackMismatch=0;
 for(let y=0;y<236;y++)for(let x=0;x<236;x++){const q=(y*236+x)*4,n=((602+y)*800+282+x)*4;if(t[q+3]===255&&t.subarray(q,q+4).compare(dst.subarray(n,n+4)))ringMismatch++;}
 for(let y=622;y<818;y++)for(let x=302;x<498;x++)if(Math.hypot(x-399.5,y-719.5)<98){const n=(y*800+x)*4;if(dst[n]||dst[n+1]||dst[n+2]||dst[n+3]!==255)blackMismatch++;}
 const coverage=await maskCoverage(tb,400,720,118);if(ringMismatch||blackMismatch||coverage.fraction!==1)throw Error('Seat verification');
 const small=await clean(await sharp(ab).resize(78,137).toBuffer()),big=await sharp(small).resize(234,411,{kernel:'nearest'}).toBuffer();await sharp(small).toFile(path.join(R,'previews/m4a3e2_map-size.png'));
 const frame={left:150,top:300,width:500,height:880},parts=[];
 let labels=text(28,42,'M4A3E2 · 后甲板体积与表面转折修正',29)+text(28,78,'宽度416px、车长800px、统一黑色座圈与炮塔保持；仅候选，未替换资源。',19,'#b8c4ad');
 for(const[i,b]of[await fs.promises.readFile(oldFile),hb,ab].entries()){
  labels+=text(i*405+205,128,['修改前车身','修改后车身','支点合成'][i],25,'#e9ecdf','middle');
  parts.push({input:await sharp(b).extract(frame).resize(390,686).toBuffer(),left:i*405+10,top:150});
 }
 labels+=text(1410,128,'地图尺寸',23,'#e9ecdf','middle')+text(1410,340,'78px车身长',18,'#b8c4ad','middle')+text(1410,870,'最近邻3倍',18,'#b8c4ad','middle')+text(28,935,'后部修正：连续倾斜甲板、纵向侧缘面、格栅凹入与边框厚度、尾部折边及接触阴影。',21,'#b8c4ad');
 parts.push({input:small,left:1371,top:170},{input:big,left:1293,top:410});
 await sharp(svg(1600,990,'<rect width="1600" height="990" fill="#28352d"/>'+labels)).composite(parts).toFile(path.join(R,'jumbo-review.png'));
 const rearFrame={left:192,top:840,width:416,height:300};
 await sharp(svg(1600,720,'<rect width="1600" height="720" fill="#28352d"/>'+text(400,48,'修改前 · 后部局部',27,'#e9ecdf','middle')+text(1200,48,'修改后 · 后部局部',27,'#e9ecdf','middle')+text(28,675,'相同位置与比例；原履带和车身外廓保留。',20,'#b8c4ad'))).composite([{input:await sharp(oldFile).extract(rearFrame).resize(748,539).toBuffer(),left:26,top:85},{input:await sharp(hb).extract(rearFrame).resize(748,539).toBuffer(),left:826,top:85}]).toFile(path.join(R,'rear-before-after.png'));
 const audit={status:'approval-candidate',generator:'built-in image_gen, localized alignment/blending only',gameAssetsReplaced:false,canvas:[800,1400],hullBounds:hs.b,workingRegion:{left:192,top:840,width:416,height:300},changedPixels:changed,alphaPixelsChanged:alphaChanged,pixelsChangedOutsideWorkArea:outsideChanged,frontPixelsChanged:frontChanged,rearTrackPixelsChanged:trackChanged,commonRing:{center:[400,720],size:[236,236],opaquePixelMismatch:ringMismatch,blackInteriorMismatch:blackMismatch},ringCoverage:coverage,turretArtworkChanged:false,notes:['Based on the supplied side/rear/top reference crops.','Rejected the first generated polygonal platform; selected the continuous deck and longitudinal side transition rendering.','Same silhouette and full existing alpha map retained; rear tread colors also retained.','Static candidate review, no in-game visual acceptance.']};
 fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify(audit));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
