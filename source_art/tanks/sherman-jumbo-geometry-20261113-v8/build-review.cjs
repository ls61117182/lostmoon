// The only geometry input used by image_gen was the user's horizontal top plan.
// Code rotates, crops and uniformly scales; no chassis stretching or painting.
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const {blank,clean,inspect,svg,text,maskCoverage}=require('./review-helpers.cjs');
const R=__dirname,REF={left:9,top:5,width:957,height:434};
async function main(){
 const source=path.join(R,'generated/hull-original-only-v2.png'),scan=await inspect(source),b=scan.b;
 const length=b.width,width=b.height,ratio=length/width,referenceRatio=REF.width/REF.height;
 const cropped=await sharp(source).extract(b).png().toBuffer();
 const part=await sharp(cropped).rotate(90).resize({height:800}).png().toBuffer(),pm=await sharp(part).metadata();
 const hullBase=await blank().composite([{input:part,left:Math.round(400-pm.width/2),top:340}]).png().toBuffer();
 const ring=path.join(R,'references/common-ring-236.png');
 const hb=await clean(await sharp(hullBase).composite([{input:ring,left:282,top:602}]).png().toBuffer()),tb=await fs.promises.readFile(path.join(R,'references/turret-unchanged.png'));
 const ab=await clean(await sharp(hb).composite([{input:tb,left:0,top:0}]).png().toBuffer());
 for(const[n,png]of[['hull',hb],['turret',tb],['assembled',ab]])await sharp(png).toFile(path.join(R,'candidates/m4a3e2_'+n+'.png'));
 const coverage=await maskCoverage(tb,400,720,118);if(coverage.fraction!==1)throw Error('Seat not covered');
 const refCrop=await sharp(path.join(R,'references/user-top-front-left.png')).extract(REF).png().toBuffer();
 const refPart=await sharp(refCrop).rotate(90).resize({height:800}).png().toBuffer(),rm=await sharp(refPart).metadata();
 const ref=await blank().composite([{input:refPart,left:Math.round(400-rm.width/2),top:340}]).png().toBuffer();
 let labels=text(28,42,'巨无霸车身 · 只依据用户原图重新绘制',29)+text(28,80,'三栏使用相同车身长度和同一裁切比例；未对车身做横纵向拉伸。',20,'#b8c4ad');
 const pieces=[],frame={left:150,top:300,width:500,height:880};
 for(const[i,png]of[ref,hb,ab].entries()){
  labels+=text(i*500+250,135,['用户原图 · 俯视','新车身 · 统一黑色座圈','与沿用炮塔合成'][i],25,'#e9ecdf','middle');
  pieces.push({input:await sharp(png).extract(frame).resize(400,704).png().toBuffer(),left:i*500+50,top:160});
 }
 labels+=text(28,930,`外轮廓长宽比量取：参考 ${referenceRatio.toFixed(3)} : 1　旧稿 2.264 : 1　新稿 ${ratio.toFixed(3)} : 1`,23)+text(28,972,`新稿与参考仍约有 ${((ratio/referenceRatio-1)*100).toFixed(1)}% 的长宽比差异；候选图供继续核对。`,21,'#b8c4ad')+text(28,1012,'本轮车身生成不提供旧车身或其他车型图片；座圈及炮塔仅在生成完成后用于合成。',19,'#b8c4ad')+text(28,1050,'所有产物仅为候选，未替换游戏资源。',20,'#b8c4ad');
 await sharp(svg(1500,1090,'<rect width="1500" height="1090" fill="#28352d"/><path d="M500 105V885M1000 105V885" stroke="#526052"/>'+labels)).composite(pieces).toFile(path.join(R,'geometry-review.png'));
 const small=await clean(await sharp(ab).resize(78,137).toBuffer()),big=await sharp(small).resize(234,411,{kernel:'nearest'}).toBuffer();
 await sharp(small).toFile(path.join(R,'previews/m4a3e2_map-size.png'));
 await sharp(svg(650,540,'<rect width="650" height="540" fill="#28352d"/>'+text(160,55,'78px车身长',22,'#e9ecdf','middle')+text(430,55,'最近邻3倍',22,'#e9ecdf','middle'))).composite([{input:small,left:121,top:110},{input:big,left:313,top:90}]).toFile(path.join(R,'map-size-review.png'));
 const audit={status:'approval-candidate',gameAssetsReplaced:false,geometryInputs:['references/user-top-front-left.png'],oldVehicleImagesPassedToGeneration:false,referenceBounds:REF,referenceLengthWidthRatio:referenceRatio,sourceBounds:b,sourceLengthWidthRatio:ratio,relativeRatioError:ratio/referenceRatio-1,normalizedHull:[pm.width,800],canvas:[800,1400],commonRing:{diameter:236,center:[400,720]},ringCoverage:coverage,turret:'unchanged from v7; used only in review compositing',notes:['Previous ordinary Sherman style inputs affected the first v6 draft; later v6 passes removed those inputs but kept generated intermediates.','This v8 hull starts from the original user top plan alone, in its original front-left orientation.','Remaining ratio difference is explicitly reported rather than described as exact reconstruction.','No independent horizontal/vertical stretching.']};
 fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify(audit));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
