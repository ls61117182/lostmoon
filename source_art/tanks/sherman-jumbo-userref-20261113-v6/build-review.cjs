// Deterministic uniform resampling and pivot compositing, never vehicle painting.
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const {blank,clean,inspect,part,text,svg,maskCoverage}=require('./review-helpers.cjs');
const R=__dirname;
async function main(){
 const hf=path.join(R,'generated/m4a3e2-hull-v3.png'),tf=path.join(R,'generated/m4a3e2-turret-v4.png');
 const hs=await inspect(hf),ts=await inspect(tf),s=800/hs.b.height,ss=(340*800/956)/ts.b.width;
 const ring=[416,913],tp=[444,1268],target=[400+(ring[0]-(hs.b.left+hs.b.width/2))*s,340+(ring[1]-hs.b.top)*s];
 const hl=await part(hf,hs,s,ring,target),tl=await part(tf,ts,ss,tp,target);
 const hb=await clean(await blank().composite([hl]).png().toBuffer()),tb=await clean(await blank().composite([tl]).png().toBuffer()),ab=await clean(await blank().composite([hl,tl]).png().toBuffer());
 for(const[n,b]of[['hull',hb],['turret',tb],['assembled',ab]])await sharp(b).toFile(path.join(R,'candidates','m4a3e2_'+n+'.png'));
 const coverage=await maskCoverage(tb,target[0],target[1],237*s);if(coverage.fraction!==1)throw Error('Ring exposed: '+JSON.stringify(coverage));
 const small=await clean(await sharp(ab).resize(78,137).toBuffer()),big=await sharp(small).flatten({background:'#28352d'}).resize(234,411,{kernel:'nearest'}).toBuffer();
 await sharp(small).toFile(path.join(R,'previews/m4a3e2_map-size.png'));await sharp(big).toFile(path.join(R,'previews/m4a3e2_map-size-3x.png'));
 let body='<rect width="1600" height="1120" fill="#28352d"/>'+text(28,43,'M4A3E2 · 按用户新三视图重绘',29)+text(28,80,'车身含座圈 / 独立炮塔 / 同比例支点合成；待确认，未替换游戏资源。',19,'#b8c4ad');
 const parts=[];
 for(const[i,b]of[hb,tb,ab].entries()){
  const x=i*405;body+=text(x+205,130,['车身 · 炮塔座圈','炮塔 · 75毫米','支点合成'][i],24,'#e9ecdf','middle');
  parts.push({input:await sharp(b).extract({left:150,top:250,width:500,height:950}).resize(390,741).toBuffer(),left:x+10,top:155});
 }
 body+=text(1410,130,'地图尺寸',23,'#e9ecdf','middle')+text(1410,330,'78px车身长',18,'#b8c4ad','middle')+text(1410,860,'最近邻3倍',18,'#b8c4ad','middle');
 parts.push({input:small,left:1371,top:160},{input:big,left:1293,top:400});
 body+=text(28,995,'主要核对：焊接车首、外倾椭圆舱盖、双格栅、厚炮盾、圆弧炮塔及右侧车长塔。',22,'#b8c4ad')+text(28,1035,'两张分层均为真实透明PNG；本页底色及文字只供审阅。',19,'#b8c4ad');
 await sharp(svg(1600,1120,body)).composite(parts).toFile(path.join(R,'jumbo-review.png'));
 const refPart=await sharp(path.join(R,'references/m4a3e2-top-front-up.png')).extract({left:6,top:10,width:429,height:956}).resize({height:800}).toBuffer();
 const refCanvas=await blank().composite([{input:refPart,left:221,top:340}]).png().toBuffer();
 const comparisonFrame={left:150,top:300,width:500,height:880};
 const ref=await sharp(refCanvas).extract(comparisonFrame).resize(450,792).toBuffer();
 const candidate=await sharp(ab).extract(comparisonFrame).resize(450,792).toBuffer();
 const referenceBoard=svg(1000,930,'<rect width="1000" height="930" fill="#28352d"/>'+text(245,48,'用户参考 · 车头向上',26,'#e9ecdf','middle')+text(750,48,'本轮候选合成',26,'#e9ecdf','middle')+text(28,910,'参考仅旋转与裁切；右侧为两张新分层按支点合成。',19,'#b8c4ad'));
 await sharp(referenceBoard).composite([{input:ref,left:25,top:75},{input:candidate,left:525,top:75}]).toFile(path.join(R,'reference-comparison.png'));
 const audit={status:'approval-candidate',generator:'built-in image_gen',gameAssetsReplaced:false,canvas:[800,1400],hull:hs,turret:ts,hullScale:s,turretScale:ss,referenceHullLength:956,referenceTurretWidth:340,sourceRingCenter:ring,sourceTurretPivot:tp,pivot:target,ringCoverage:coverage,notes:['New user sheet is the geometric authority. Old Jumbo sprite not used as reference.','Body proportions and feature layout visually compared against the new plan; generative artwork is a review candidate, not a CAD-exact reconstruction.','Only reference crop/rotation, uniform resizing, alpha cleanup, compositing and review layout use code. Artwork and layer corrections use built-in image_gen.','No damaged states or game integration.']};
 fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify({hull:hs.b,turret:ts.b,pivot:target,coverage}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
