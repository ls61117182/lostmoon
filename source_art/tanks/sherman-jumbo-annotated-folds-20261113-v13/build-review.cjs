// User annotation is the authority for the paired inner deck folds.
// image_gen renders the surfaces; code registers that layer and protects existing geometry.
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const {blank,clean,inspect,text,svg,maskCoverage}=require('./review-helpers.cjs');
const R=__dirname,GUIDE={left:[[12,320],[80,515],[80,760]],right:[[404,320],[336,515],[336,760]]};
async function main(){
 const f=path.join(R,'references/hull-base.png'),base=await sharp(f).ensureAlpha().raw().toBuffer({resolveWithObject:true}),src=base.data,dst=Buffer.from(src);
 const file=path.join(R,'generated/annotated-folds-v1.png'),scan=await inspect(file),crop=await sharp(file).extract(scan.b).png().toBuffer();
 const art=await sharp(crop).resize(416,800,{fit:'fill'}).ensureAlpha().raw().toBuffer();
 let altered=0,frontChanged=0,alphaChanged=0,trackChanged=0;
 for(let y=640;y<1140;y++)for(let x=192;x<608;x++){
  const n=(y*800+x)*4;if(!src[n+3]||(y>=1098&&(x<282||x>=518)))continue;
  const q=((y-340)*416+x-192)*4,dist=Math.hypot(x+.5-400,y+.5-720);
  const preserveSeat=Math.max(0,Math.min(1,(dist-125)/16));
  const a=Math.max(0,Math.min(1,(y-640)/20,(x-192)/3,(607-x)/3,art[q+3]/255))*preserveSeat;
  if(!a)continue;for(let c=0;c<3;c++)dst[n+c]=Math.round(src[n+c]*(1-a)+art[q+c]*a);
 }
 // The shared seat itself and its black opening remain byte-identical.
 const hull=await sharp(dst,{raw:base.info}).png().toBuffer();
 for(let y=0;y<1400;y++)for(let x=0;x<800;x++){
  const n=(y*800+x)*4,diff=src.subarray(n,n+4).compare(dst.subarray(n,n+4))!==0;
  if(dst[n+3]!==src[n+3])alphaChanged++;
  if(diff){altered++;if(y<640)frontChanged++;if(y>=1098&&(x<282||x>=518))trackChanged++;}
 }
 if(alphaChanged||frontChanged||trackChanged)throw Error('Protected pixels changed');
 const tb=await fs.promises.readFile(path.join(R,'references/turret-unchanged.png')),ab=await clean(await sharp(hull).composite([{input:tb,left:0,top:0}]).png().toBuffer());
 for(const[n,b]of[['hull',hull],['turret',tb],['assembled',ab]])await sharp(b).toFile(path.join(R,'candidates','m4a3e2_'+n+'.png'));
 const hs=await inspect(hull);let symmetry=0,ringMismatch=0,blackMismatch=0,redMarkers=0;
 for(let y=0;y<1400;y++)for(let x=0;x<400;x++)if(dst[(y*800+x)*4+3]!==dst[(y*800+799-x)*4+3])symmetry++;
 const ring=await sharp(path.join(R,'references/common-ring.png')).ensureAlpha().raw().toBuffer();
 for(let y=0;y<236;y++)for(let x=0;x<236;x++){const q=(y*236+x)*4,n=((602+y)*800+282+x)*4;if(ring[q+3]===255&&ring.subarray(q,q+4).compare(dst.subarray(n,n+4)))ringMismatch++;}
 for(let y=622;y<818;y++)for(let x=302;x<498;x++)if(Math.hypot(x-399.5,y-719.5)<98){const n=(y*800+x)*4;if(dst[n]||dst[n+1]||dst[n+2]||dst[n+3]!==255)blackMismatch++;}
 for(let n=0;n<dst.length;n+=4)if(dst[n+3]>24&&dst[n]>150&&dst[n]>dst[n+1]*1.7&&dst[n]>dst[n+2]*1.7)redMarkers++;
 const coverage=await maskCoverage(tb,400,720,118);if(symmetry||ringMismatch||blackMismatch||redMarkers||coverage.fraction!==1||hs.b.width!==416||hs.b.height!==800)throw Error('Art audit failed '+JSON.stringify({symmetry,ringMismatch,blackMismatch,redMarkers,coverage,bounds:hs.b}));
 const frame={left:150,top:300,width:500,height:880};
 let labels=text(28,42,'巨无霸 · 按用户标线修正中央甲板与侧斜面',28)+text(28,80,'外廓保持；顶部中央面先向后收窄，再沿发动机甲板两侧平行延伸。',20,'#b8c4ad');
 const pieces=[];
 labels+=text(250,130,'用户标线 · 车头转向上',24,'#e9ecdf','middle')+text(750,130,'修正后车身',25,'#e9ecdf','middle')+text(1250,130,'支点合成',25,'#e9ecdf','middle');
 const reference=await sharp(path.join(R,'references/user-folds-front-up.png')).resize({height:640}).toBuffer(),rm=await sharp(reference).metadata();
 pieces.push({input:reference,left:Math.round(250-rm.width/2),top:190},{input:await sharp(hull).extract(frame).resize(390,686).toBuffer(),left:555,top:160},{input:await sharp(ab).extract(frame).resize(390,686).toBuffer(),left:1055,top:160});
 labels+=text(28,915,'两侧折线成对对应；右侧工具可遮挡折线，折线本身不因附件而移位。',22,'#b8c4ad')+text(28,958,'宽416px、长800px；统一黑色座圈与炮塔保持。红线只在参考图中，成品无辅助线。',19,'#b8c4ad')+text(28,1000,'仍为候选，未替换游戏资源。',20,'#b8c4ad');
 await sharp(svg(1500,1040,'<rect width="1500" height="1040" fill="#28352d"/>'+labels)).composite(pieces).toFile(path.join(R,'folds-review.png'));
 let bLabels=text(28,43,'顶部转折 · 修改前后',29)+text(400,108,'修改前',25,'#e9ecdf','middle')+text(1200,108,'按标线修正后',25,'#e9ecdf','middle');
 await sharp(svg(1600,910,'<rect width="1600" height="910" fill="#28352d"/>'+bLabels)).composite([{input:await sharp(f).extract(frame).resize(390,686).toBuffer(),left:205,top:145},{input:await sharp(hull).extract(frame).resize(390,686).toBuffer(),left:1005,top:145}]).toFile(path.join(R,'before-after.png'));
 const small=await clean(await sharp(ab).resize(78,137).toBuffer()),big=await sharp(small).resize(234,411,{kernel:'nearest'}).toBuffer();await sharp(small).toFile(path.join(R,'previews/m4a3e2_map-size.png'));
 await sharp(svg(650,540,'<rect width="650" height="540" fill="#28352d"/>'+text(95,50,'78px车身长',22)+text(330,50,'最近邻3倍',22))).composite([{input:small,left:118,top:110},{input:big,left:300,top:85}]).toFile(path.join(R,'map-size-review.png'));
 const audit={status:'approval-candidate',generator:'built-in image_gen with user-drawn fold guides',gameAssetsReplaced:false,canvas:[800,1400],hullBounds:hs.b,foldGuideLocal:GUIDE,foldGuideMeaning:'Inner top-deck folds, not the outer hull silhouette; approximately registered from user annotation',changedPixels:altered,frontPixelsChanged:frontChanged,alphaPixelsChanged:alphaChanged,rearTrackPixelsChanged:trackChanged,alphaMirrorPairMismatch:symmetry,redMarkerPixels:redMarkers,ring:{center:[400,720],size:[236,236],opaquePixelMismatch:ringMismatch,blackInteriorMismatch:blackMismatch},ringCoverage:coverage,turretArtworkChanged:false,notes:['The v12 assertion that the rear should have no longitudinal narrowing folds is withdrawn.','The user annotation clarifies a symmetric central roof that narrows aft and then runs parallel.','Guide coordinates describe approximate intended break lines; generated shading remains subject to visual review.','Other two Sherman candidates remain v10.']};
 fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify(audit));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
