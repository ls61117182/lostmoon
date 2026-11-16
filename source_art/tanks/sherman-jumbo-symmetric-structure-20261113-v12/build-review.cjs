// image_gen renders the rear; approved pixel crop/alignment makes the OUTLINE
// symmetric. Accessory colors/layout are never mirrored.
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const {blank,clean,inspect,text,svg,maskCoverage}=require('./review-helpers.cjs');
const R=__dirname;
function symAlpha(d,w,h){let pairs=0,removed=0;for(let y=0;y<h;y++)for(let x=0;x<w/2;x++){const a=(y*w+x)*4,b=(y*w+w-1-x)*4;let v=Math.min(d[a+3],d[b+3]);if(v>=240)v=255;if(v<=4)v=0;if(d[a+3]!==d[b+3])pairs++;if(!v&&(d[a+3]||d[b+3]))removed++;d[a+3]=d[b+3]=v;if(!v){d.fill(0,a,a+4);d.fill(0,b,b+4);}}return{asymmetricPairsBefore:pairs,croppedEdgePairs:removed};}
async function main(){
 const f=path.join(R,'references/plain-hull-layout.png'),old=await sharp(f).ensureAlpha().raw().toBuffer({resolveWithObject:true}),d=Buffer.from(old.data),patch=await sharp(path.join(R,'generated/rear-symmetric-planes.png')).resize(416,300).ensureAlpha().raw().toBuffer();
 for(let y=840;y<1140;y++)for(let x=192;x<608;x++){
  const n=(y*800+x)*4;if(!d[n+3]||(y>=1098&&(x<282||x>=518)))continue;
  const q=((y-840)*416+x-192)*4,a=Math.max(0,Math.min(1,(y-840)/20,(x-192)/3,(607-x)/3,patch[q+3]/255));
  for(let c=0;c<3;c++)d[n+c]=Math.round(d[n+c]*(1-a)+patch[q+c]*a);
 }
 const firstSym=symAlpha(d,800,1400),symBuf=await sharp(d,{raw:old.info}).png().toBuffer(),sb=(await inspect(symBuf)).b;
 const {data:cropped,info:ci}=await sharp(symBuf).extract(sb).resize(416,800,{fit:'fill'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 symAlpha(cropped,ci.width,ci.height);const normalized=await sharp(cropped,{raw:ci}).png().toBuffer();
 const base=await blank().composite([{input:normalized,left:192,top:340}]).png().toBuffer();
 const hb=await sharp(base).composite([{input:path.join(R,'references/common-ring.png'),left:282,top:602}]).png().toBuffer(),tb=await fs.promises.readFile(path.join(R,'references/turret-unchanged.png')),ab=await clean(await sharp(hb).composite([{input:tb,left:0,top:0}]).png().toBuffer());
 for(const[n,b]of[['hull',hb],['turret',tb],['assembled',ab]])await sharp(b).toFile(path.join(R,'candidates','m4a3e2_'+n+'.png'));
 const raw=await sharp(hb).ensureAlpha().raw().toBuffer(),bounds=(await inspect(hb)).b;let silhouetteMismatch=0,alphaMismatch=0,maxEdgeError=0;
 const outline=[];
 for(let y=0;y<1400;y++){
  let lo=800,hi=-1;for(let x=0;x<800;x++){const n=(y*800+x)*4;if(raw[n+3]>24){lo=Math.min(lo,x);hi=Math.max(hi,x);}if(x<400){const q=(y*800+799-x)*4;if((raw[n+3]>24)!==(raw[q+3]>24))silhouetteMismatch++;if(raw[n+3]!==raw[q+3])alphaMismatch++;}}
  if(hi>=lo){maxEdgeError=Math.max(maxEdgeError,Math.abs(lo+hi-799));outline.push([lo,hi,y]);}
 }
 if(silhouetteMismatch||maxEdgeError||bounds.width!==416||bounds.height!==800)throw Error('Hull symmetry/dimensions '+JSON.stringify({bounds,silhouetteMismatch,maxEdgeError}));
 const ring=await sharp(path.join(R,'references/common-ring.png')).ensureAlpha().raw().toBuffer();let ringMismatch=0,blackMismatch=0;
 for(let y=0;y<236;y++)for(let x=0;x<236;x++){const q=(y*236+x)*4,n=((602+y)*800+282+x)*4;if(ring[q+3]===255&&ring.subarray(q,q+4).compare(raw.subarray(n,n+4)))ringMismatch++;}
 for(let y=622;y<818;y++)for(let x=302;x<498;x++)if(Math.hypot(x-399.5,y-719.5)<98){const n=(y*800+x)*4;if(raw[n]||raw[n+1]||raw[n+2]||raw[n+3]!==255)blackMismatch++;}
 const coverage=await maskCoverage(tb,400,720,118);if(ringMismatch||blackMismatch||coverage.fraction!==1)throw Error('Seat check');
 // Engineering overlay only: compare measured outer edges to their reflection.
 let guide='';for(const side of[0,1]){const points=outline.map(p=>[(p[side]-150)*.78+515,(p[2]-300)*.78+155]);guide+='<polyline points="'+points.map(p=>p.join(',')).join(' ')+'" fill="none" stroke="#5ed9d4" stroke-width="2"/>';const mirrored=outline.map(p=>[(799-p[1-side]-150)*.78+515,(p[2]-300)*.78+155]);guide+='<polyline points="'+mirrored.map(p=>p.join(',')).join(' ')+'" fill="none" stroke="#f0ce6b" stroke-width="1" stroke-dasharray="7 5"/>';}
 guide+='<path d="M710 165V820" stroke="#5ed9d4" stroke-dasharray="8 6"/>';
 const frame={left:150,top:300,width:500,height:880},parts=[];let labels=text(28,42,'M4A3E2 · 对称壳体与前后坡面',29)+text(28,80,'按三视图重新理清表面关系；不再使用第十一轮的纵向斜切面。',20,'#b8c4ad');
 for(const[i,b]of[hb,hb,ab].entries()){
  labels+=text(210+i*500,128,['新车身','外廓与镜像叠合','支点合成'][i],25,'#e9ecdf','middle');
  parts.push({input:await sharp(b).extract(frame).resize(390,686).toBuffer(),left:i*500+15,top:155});
 }
 labels+=text(28,900,'车身416×800；左右外廓镜像差异0像素，逐行边界偏差0像素。',23)+text(28,945,'基本壳体左右对称；工具、舱盖等配件按参考保留实际不对称，未整体镜像。',20,'#b8c4ad')+text(28,985,'座圈236×236、圈心(400,720)；仍仅候选，未替换游戏资源。',20,'#b8c4ad');
 await sharp(svg(1500,1030,'<rect width="1500" height="1030" fill="#28352d"/>'+labels)).composite([...parts,{input:svg(1500,1030,guide),left:0,top:0}]).toFile(path.join(R,'symmetry-review.png'));
 const small=await clean(await sharp(ab).resize(78,137).toBuffer()),big=await sharp(small).resize(234,411,{kernel:'nearest'}).toBuffer();await sharp(small).toFile(path.join(R,'previews/m4a3e2_map-size.png'));
 await sharp(svg(650,540,'<rect width="650" height="540" fill="#28352d"/>'+text(95,50,'78px车身长',22)+text(330,50,'最近邻3倍',22))).composite([{input:small,left:118,top:110},{input:big,left:300,top:85}]).toFile(path.join(R,'map-size-review.png'));
 const audit={status:'approval-candidate',gameAssetsReplaced:false,generator:'built-in image_gen; crop/alpha alignment and shared-layer compositing',selectedGeneration:'generated/rear-symmetric-planes.png',rejectedGeneration:'generated/full-hull-rejected.png',layoutBase:'v10 plain hull; v11 diagonal rear facets not used',canvas:[800,1400],hullBounds:bounds,outlineAxisX:400,firstSymmetryPass:firstSym,trimmedBoundsBeforeNormalization:sb,silhouetteMirrorPixelMismatch:silhouetteMismatch,alphaMirrorPairMismatch:alphaMismatch,maxRowEdgeMirrorError:maxEdgeError,accessoryColorsMirrored:false,ring:{center:[400,720],size:[236,236],opaquePixelMismatch:ringMismatch,blackInteriorMismatch:blackMismatch},ringCoverage:coverage,turretArtworkChanged:false,notes:['Shape relation schematic was made before generation, not an engineering dimension drawing.','Basic shell symmetry is checked separately from asymmetric accessory layout.','Do not equate a symmetry pass with full historical/geometric approval.','Other two Sherman candidates remain v10.']};fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify(audit));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
