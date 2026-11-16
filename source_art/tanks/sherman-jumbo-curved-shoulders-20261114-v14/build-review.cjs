// image_gen edits the shoulder curvature from the clean reference, without red guides.
// Code registers only the affected region, retaining the original exterior/seat/layers.
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const {clean,inspect,text,svg,maskCoverage}=require('./review-helpers.cjs');
const R=__dirname,Y0=620,Y1=905;
async function main(){
 const oldFile=path.join(R,'references/hull-base.png'),old=await sharp(oldFile).ensureAlpha().raw().toBuffer({resolveWithObject:true}),src=old.data,dst=Buffer.from(src);
 const file=path.join(R,'generated/curved-shoulders-v1.png'),s=await inspect(file),cropped=await sharp(file).extract(s.b).png().toBuffer(),art=await sharp(cropped).resize(416,800,{fit:'fill'}).ensureAlpha().raw().toBuffer();
 for(let y=Y0;y<Y1;y++)for(let x=192;x<608;x++){
  const n=(y*800+x)*4;if(!src[n+3])continue;const q=((y-340)*416+x-192)*4,dist=Math.hypot(x+.5-400,y+.5-720);
  const seatGuard=Math.max(0,Math.min(1,(dist-125)/16));
  const a=Math.max(0,Math.min(1,(y-Y0)/20,(Y1-1-y)/20,(x-192)/3,(607-x)/3,art[q+3]/255))*seatGuard;
  if(!a)continue;for(let c=0;c<3;c++)dst[n+c]=Math.round(src[n+c]*(1-a)+art[q+c]*a);
 }
 let changed=0,alphaChanged=0,outsideChanged=0,mirror=0,red=0;
 for(let y=0;y<1400;y++)for(let x=0;x<800;x++){
  const n=(y*800+x)*4,diff=dst.subarray(n,n+4).compare(src.subarray(n,n+4))!==0;
  if(diff){changed++;if(x<192||x>=608||y<Y0||y>=Y1)outsideChanged++;}
  if(dst[n+3]!==src[n+3])alphaChanged++;
  if(x<400&&dst[n+3]!==dst[(y*800+799-x)*4+3])mirror++;
  if(dst[n+3]>24&&dst[n]>150&&dst[n]>dst[n+1]*1.7&&dst[n]>dst[n+2]*1.7)red++;
 }
 const hb=await sharp(dst,{raw:old.info}).png().toBuffer(),tb=await fs.promises.readFile(path.join(R,'references/turret-unchanged.png')),ab=await clean(await sharp(hb).composite([{input:tb,left:0,top:0}]).png().toBuffer());
 for(const[n,b]of[['hull',hb],['turret',tb],['assembled',ab]])await sharp(b).toFile(path.join(R,'candidates','m4a3e2_'+n+'.png'));
 const hs=await inspect(hb),ring=await sharp(path.join(R,'references/common-ring.png')).ensureAlpha().raw().toBuffer();let ringMismatch=0,blackMismatch=0;
 for(let y=0;y<236;y++)for(let x=0;x<236;x++){const q=(y*236+x)*4,n=((602+y)*800+282+x)*4;if(ring[q+3]===255&&ring.subarray(q,q+4).compare(dst.subarray(n,n+4)))ringMismatch++;}
 for(let y=622;y<818;y++)for(let x=302;x<498;x++)if(Math.hypot(x-399.5,y-719.5)<98){const n=(y*800+x)*4;if(dst[n]||dst[n+1]||dst[n+2]||dst[n+3]!==255)blackMismatch++;}
 const coverage=await maskCoverage(tb,400,720,118);
 if(alphaChanged||outsideChanged||mirror||red||ringMismatch||blackMismatch||coverage.fraction!==1||hs.b.width!==416||hs.b.height!==800)throw Error('Art audit failed');
 const frame={left:150,top:300,width:500,height:880},pieces=[];
 let labels=text(28,42,'巨无霸 · 肩部前段弧线与自然过渡',29)+text(28,80,'依据未标注原图调整曲率；红线仅表示大致位置，不作为折角或直线模板。',19,'#b8c4ad');
 for(const[i,b]of[await fs.promises.readFile(oldFile),hb,ab].entries()){
  labels+=text(i*405+205,128,['修改前 · 直边折角','修改后 · 连续弧线','支点合成'][i],24,'#e9ecdf','middle');
  pieces.push({input:await sharp(b).extract(frame).resize(390,686).toBuffer(),left:i*405+10,top:150});
 }
 const small=await clean(await sharp(ab).resize(78,137).toBuffer()),big=await sharp(small).resize(234,411,{kernel:'nearest'}).toBuffer();await sharp(small).toFile(path.join(R,'previews/m4a3e2_map-size.png'));
 labels+=text(1410,128,'地图尺寸',23,'#e9ecdf','middle')+text(1410,340,'78px车身长',18,'#b8c4ad','middle')+text(1410,870,'最近邻3倍',18,'#b8c4ad','middle')+text(28,940,'外廓416×800、座圈236×236及圈心(400,720)保持；仅候选，未替换资源。',20,'#b8c4ad');
 pieces.push({input:small,left:1371,top:170},{input:big,left:1293,top:410});
 await sharp(svg(1600,995,'<rect width="1600" height="995" fill="#28352d"/>'+labels)).composite(pieces).toFile(path.join(R,'curved-review.png'));
 const detail={left:192,top:610,width:416,height:320};
 await sharp(svg(1600,740,'<rect width="1600" height="740" fill="#28352d"/>'+text(400,48,'修改前 · 长直边与折角',26,'#e9ecdf','middle')+text(1200,48,'修改后 · 弧度收束与自然转直',26,'#e9ecdf','middle')+text(28,705,'同位置、同比例局部对照；不是只将旧拐角磨圆。',20,'#b8c4ad'))).composite([{input:await sharp(oldFile).extract(detail).resize(748,575).toBuffer(),left:26,top:85},{input:await sharp(hb).extract(detail).resize(748,575).toBuffer(),left:826,top:85}]).toFile(path.join(R,'shoulder-before-after.png'));
 const audit={status:'approval-candidate',date:'2026-11-14',generator:'built-in image_gen, clean original reference; localized registration/blending',gameAssetsReplaced:false,canvas:[800,1400],hullBounds:hs.b,workArea:{left:192,top:Y0,width:416,height:Y1-Y0},changedPixels:changed,pixelsChangedOutsideWorkArea:outsideChanged,alphaPixelsChanged:alphaChanged,alphaMirrorPairMismatch:mirror,redMarkerPixels:red,ring:{center:[400,720],size:[236,236],opaquePixelMismatch:ringMismatch,blackInteriorMismatch:blackMismatch},ringCoverage:coverage,turretArtworkChanged:false,geometryNotes:['Red annotation is approximate position only, not literal polyline geometry.','The entire forward shoulder transition is curved and blends into the aft parallel portion.','No hard-coded fold coordinates were supplied to image_gen this round.','Only clean original top-view references were used to guide curvature; the target image provided current approved layout.','Curvature/shape remains a visual-review candidate, not proven by metadata checks.','Other two Sherman candidates remain v10.']};
 fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify(audit));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
