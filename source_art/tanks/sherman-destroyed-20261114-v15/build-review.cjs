// Artwork is from built-in image_gen edits. Registration uses a single uniform
// scale anchored to the NORMAL hull front/rear, never a refit of the turret/gun.
const fs=require('fs'),path=require('path'),sharp=require('sharp'),crypto=require('crypto');
const {blank,clean,inspect,text,svg}=require('./review-helpers.cjs');
const R=__dirname,V=JSON.parse(fs.readFileSync(path.join(R,'reference-layout.json')));
async function measure(file){
 const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true}),b=(await inspect(file)).b,rows=[];
 for(let y=0;y<info.height;y++){let lo=info.width,hi=-1;for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>24){lo=Math.min(lo,x);hi=Math.max(hi,x);}rows.push(hi>=lo?hi-lo+1:0);}
 const limit=b.width*.82;let nose=-1;for(let y=b.top;y<b.top+b.height-3;y++)if(rows[y]>=limit&&rows[y+1]>=limit&&rows[y+2]>=limit){nose=y;break;}
 if(nose<0)throw Error('Could not locate body '+file);
 return{size:[info.width,info.height],bounds:b,hullNose:nose,hullRear:b.top+b.height,hullLength:b.top+b.height-nose};
}
function sha(f){return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');}
async function main(){
 const audit={status:'approval-candidate',date:'2026-11-14',generator:'built-in image_gen, one edit per model',gameAssetsReplaced:false,canvas:[800,1400],registration:'Uniform scaling anchored to normal hull front/rear; no independent stretching of hull, turret or barrel',variants:[]};
 let compareLabels=text(28,43,'三型谢尔曼 · 正常与击毁候选对照',29)+text(28,80,'按正常图车身基准对齐；保留未损区域涂装，以局部破口、焦黑和机械变形表现击毁。',19,'#b8c4ad');
 let heroLabels=text(28,43,'谢尔曼三型 · 击毁状态候选',29)+text(28,80,'基于当前正常稿制作，真实透明PNG，尚未替换游戏资源。',19,'#b8c4ad');
 let mapLabels=text(28,43,'地图尺寸：正常 / 击毁 / 击毁最近邻3倍',28);const comparisons=[],heroes=[],maps=[];
 const captions=['炮塔后侧破口、发动机盖翻折、右后履带损坏','炮塔前侧破口、顶置机枪变形、后盖及左履带损坏','炮塔顶破口、左格栅破损、右后履带撕裂'];
 for(let i=0;i<V.length;i++){
  const v=V[i],gf=path.join(R,'generated',v.key+'_destroyed-v1.png'),normal=path.join(R,'references',v.key+'_normal_assembled.png'),m=await measure(gf),s=v.hullBounds.height/m.hullLength,b=m.bounds;
  const width=Math.round(b.width*s),part=await sharp(gf).extract(b).resize({width}).png().toBuffer(),meta=await sharp(part).metadata();
  const effectiveScale=meta.height/b.height,targetCenter=v.hullBounds.left+v.hullBounds.width/2,left=Math.round(targetCenter-meta.width/2),top=Math.round(v.hullBounds.top-(m.hullNose-b.top)*effectiveScale);
  if(left<0||top<0||left+meta.width>800||top+meta.height>1400)throw Error('Artwork outside canvas '+v.key);
  const result=await clean(await blank().composite([{input:part,left,top}]).png().toBuffer()),out=path.join(R,'candidates',v.key+'_destroyed.png');await sharp(result).toFile(out);
  const fm=await measure(out),noseDelta=fm.hullNose-v.hullBounds.top,rearDelta=fm.hullRear-(v.hullBounds.top+v.hullBounds.height),widthChange=fm.bounds.width/v.hullBounds.width-1;
  if(Math.abs(noseDelta)>2||Math.abs(rearDelta)>2||Math.abs(widthChange)>.03)throw Error('Registration mismatch '+v.key+' '+JSON.stringify({noseDelta,rearDelta,widthChange}));
  const nsmall=await clean(await sharp(normal).resize(v.native,Math.round(v.native*1.75)).toBuffer()),dsmall=await clean(await sharp(result).resize(v.native,Math.round(v.native*1.75)).toBuffer()),big=await sharp(dsmall).resize(v.native*3,Math.round(v.native*1.75)*3,{kernel:'nearest'}).toBuffer();
  for(const[name,buf]of[['normal',nsmall],['destroyed',dsmall],['destroyed-3x',big]])await sharp(buf).toFile(path.join(R,'previews',v.key+'_'+name+'.png'));
  const x=i*600,frame={left:150,top:100,width:500,height:1100};
  compareLabels+=text(x+300,130,v.label,25,'#e9ecdf','middle')+text(x+150,166,'正常',20,'#b8c4ad','middle')+text(x+450,166,'击毁',20,'#b8c4ad','middle')+text(x+300,807,captions[i],16,'#b8c4ad','middle');
  comparisons.push({input:await sharp(normal).extract(frame).resize(250,550).toBuffer(),left:x+25,top:185},{input:await sharp(result).extract(frame).resize(250,550).toBuffer(),left:x+325,top:185});
  heroLabels+=text(x+300,130,v.label,27,'#e9ecdf','middle')+text(x+300,1090,captions[i],18,'#b8c4ad','middle');
  heroes.push({input:await sharp(result).extract(frame).resize(400,880).toBuffer(),left:x+100,top:155});
  mapLabels+=text(x+300,95,v.label,24,'#e9ecdf','middle')+text(x+105,140,'正常',18,'#b8c4ad','middle')+text(x+230,140,'击毁',18,'#b8c4ad','middle')+text(x+430,595,'击毁 · 最近邻3倍',18,'#b8c4ad','middle')+text(x+170,365,`${v.native}px名义车身长`,18,'#b8c4ad','middle');
  maps.push({input:nsmall,left:x+67,top:165},{input:dsmall,left:x+192,top:165},{input:big,left:x+313,top:150});
  const archivedHash=sha(normal),source=path.join(R,'..',v.sourceVersion,'candidates',v.key+'_assembled.png'),sourceHash=sha(source);if(sourceHash!==archivedHash)throw Error('Normal reference changed '+v.key);
  audit.variants.push({key:v.key,label:v.label,normalSource:source,normalSHA256:sourceHash,sourceImage:m,uniformScale:s,effectiveRasterScale:effectiveScale,placement:{left,top,width:meta.width,height:meta.height},normalHullBounds:v.hullBounds,finalImage:fm,alignmentDelta:{hullNose:noseDelta,hullRear:rearDelta,outlineWidthFraction:widthChange},damageCaption:captions[i],output:path.basename(out),nominalMapHullLength:v.native});
 }
 await sharp(svg(1800,855,'<rect width="1800" height="855" fill="#28352d"/><path d="M600 100V835M1200 100V835" stroke="#526052"/>'+compareLabels)).composite(comparisons).toFile(path.join(R,'normal-destroyed-review.png'));
 await sharp(svg(1800,1140,'<rect width="1800" height="1140" fill="#28352d"/><path d="M600 100V1120M1200 100V1120" stroke="#526052"/>'+heroLabels)).composite(heroes).toFile(path.join(R,'destroyed-review.png'));
 await sharp(svg(1800,650,'<rect width="1800" height="650" fill="#28352d"/><path d="M600 75V630M1200 75V630" stroke="#526052"/>'+mapLabels)).composite(maps).toFile(path.join(R,'map-size-review.png'));
 fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify(audit.variants.map(v=>({key:v.key,scale:v.uniformScale,alignment:v.alignmentDelta,bounds:v.finalImage.bounds})),null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
