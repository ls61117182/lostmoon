// Built-in image_gen supplies damage artwork. Code only registers it and
// composites local damage onto the unchanged normal hull / shared black ring.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),sharp=require('sharp');
const {blank,clean,inspect,text,svg}=require('./review-helpers.cjs');
const R=__dirname,V=JSON.parse(fs.readFileSync(path.join(R,'reference-layout.json')));
const zones={
 m4a1:[[234,425,151,194,15],[353,937,187,158,12],[510,1083,74,57,5]],
 m4a1_76_hvss:[[405,442,161,185,15],[275,897,168,168,10],[217,1074,88,66,5]],
 m4a3e2:[[207,472,171,143,15],[268,839,154,201,10],[520,1091,88,49,5]]
};
const captions=['车首局部破口 · 后盖翻折 · 右后履带损坏','右舱盖变形 · 后盖破口 · 左后履带损坏','车首局部裂口 · 左格栅撕裂 · 右后履带损坏'];
function sha(f){return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');}
function smooth(t){t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);}
function mask(x,y,z){const [l,t,w,h,f]=z;return smooth(Math.min(x-l,l+w-1-x,y-t,t+h-1-y)/f);}
async function main(){
 const audit={status:'hull-only approval candidate',date:'2026-11-14',toolMode:'built-in image_gen edits',gameAssetsReplaced:false,canvas:[800,1400],ring:{center:[400,720],templateSize:[236,236],protectedRadius:125},method:'Uniform registration to normal hull length; local generated damage composite, unchanged normal pixels outside masks; original ring protected',variants:[]};
 let heroLabels=text(28,44,'谢尔曼三型 · 车身击毁候选',29)+text(28,83,'炮塔已被击飞；这里只绘制车身损伤，保留露出的公共黑色座圈。',20,'#b8c4ad');
 let pairLabels=text(28,44,'车身对照 · 正常 / 击毁',29)+text(28,83,'正常车身保持；仅合入局部破损，座圈、画布和车身基准不变。',20,'#b8c4ad');
 let mapLabels=text(28,44,'地图尺寸 · 正常 / 击毁 / 击毁最近邻3倍',27);
 const heroes=[],pairs=[],maps=[];
 for(let i=0;i<V.length;i++){
  const v=V[i],gf=path.join(R,'generated',v.key+'_destroyed-hull-v1.png'),nf=path.join(R,'references',v.key+'_normal_hull.png'),gb=(await inspect(gf)).b,b=v.hullBounds;
  const scale=b.height/gb.height,part=await sharp(gf).extract(gb).resize({height:b.height}).png().toBuffer(),pm=await sharp(part).metadata(),left=Math.round(b.left+(b.width-pm.width)/2),top=b.top;
  if(Math.abs(pm.width-b.width)>3)throw Error('Unexpected generated proportions '+v.key);
  const aligned=await blank().composite([{input:part,left,top}]).png().toBuffer();
  await sharp(aligned).toFile(path.join(R,'generated',v.key+'_registered.png'));
  const nd=await sharp(nf).ensureAlpha().raw().toBuffer(),gd=await sharp(aligned).ensureAlpha().raw().toBuffer(),out=Buffer.from(nd);
  let changed=0,protectedChanged=0,opaqueBlack=0,blackSamples=0;
  for(let y=0;y<1400;y++)for(let x=0;x<800;x++){
   const p=(y*800+x)*4,rad=Math.hypot(x-400,y-720);let a=0;
   if(rad>125&&nd[p+3]>0)a=Math.max(...zones[v.key].map(z=>mask(x,y,z)));
   // Full normal alpha is retained: no detached fragments or floating pixels.
   if(gd[p+3]<220)a=0;
   if(a>0)for(let c=0;c<3;c++)out[p+c]=Math.round(nd[p+c]*(1-a)+gd[p+c]*a);
   const differs=out[p]!==nd[p]||out[p+1]!==nd[p+1]||out[p+2]!==nd[p+2]||out[p+3]!==nd[p+3];
   if(differs){changed++;if(rad<=125)protectedChanged++;}
   if(rad<=98){blackSamples++;if(out[p]===0&&out[p+1]===0&&out[p+2]===0&&out[p+3]===255)opaqueBlack++;}
  }
  if(protectedChanged||opaqueBlack!==blackSamples)throw Error('Ring invariant failed '+v.key);
  const result=await sharp(out,{raw:{width:800,height:1400,channels:4}}).png().toBuffer(),of=path.join(R,'candidates',v.key+'_hull_destroyed.png');await sharp(result).toFile(of);
  const final=await inspect(of);if(JSON.stringify(final.b)!==JSON.stringify(b))throw Error('Hull bounds changed '+v.key);
  const source=path.join(R,'..',v.sourceVersion,'candidates',v.key+'_hull.png');if(sha(source)!==sha(nf))throw Error('Normal source changed '+v.key);
  const h=Math.round(v.native*1.75),ns=await clean(await sharp(nf).resize(v.native,h).toBuffer()),ds=await clean(await sharp(result).resize(v.native,h).toBuffer()),big=await sharp(ds).resize(v.native*3,h*3,{kernel:'nearest'}).toBuffer();
  for(const [name,buf]of[['normal',ns],['destroyed',ds],['destroyed-3x',big]])await sharp(buf).toFile(path.join(R,'previews',v.key+'_'+name+'.png'));
  const x=i*600,frame={left:150,top:310,width:500,height:870};
  heroLabels+=text(x+300,137,v.label,27,'#e9ecdf','middle')+text(x+300,907,captions[i],17,'#b8c4ad','middle');
  heroes.push({input:await sharp(result).extract(frame).resize(400,696).toBuffer(),left:x+100,top:170});
  pairLabels+=text(x+300,137,v.label,26,'#e9ecdf','middle')+text(x+150,173,'正常车身',19,'#b8c4ad','middle')+text(x+450,173,'击毁车身',19,'#b8c4ad','middle');
  pairs.push({input:await sharp(nf).extract(frame).resize(250,435).toBuffer(),left:x+25,top:195},{input:await sharp(result).extract(frame).resize(250,435).toBuffer(),left:x+325,top:195});
  mapLabels+=text(x+300,95,v.label,24,'#e9ecdf','middle')+text(x+105,140,'正常',18,'#b8c4ad','middle')+text(x+230,140,'击毁',18,'#b8c4ad','middle')+text(x+430,595,'击毁 · 最近邻3倍',18,'#b8c4ad','middle')+text(x+170,365,`${v.native}px名义车身长`,18,'#b8c4ad','middle');
  maps.push({input:ns,left:x+67,top:165},{input:ds,left:x+192,top:165},{input:big,left:x+313,top:150});
  audit.variants.push({key:v.key,normalSource:source,normalSHA256:sha(source),generatedBounds:gb,uniformScale:scale,registered:{left,top,width:pm.width,height:pm.height},damageMasks:zones[v.key],finalBounds:final.b,changedPixels:changed,ringProtectedPixelDifferences:protectedChanged,opaqueBlackRingSamples:opaqueBlack,blackRingSamples:blackSamples,normalAlphaUnchanged:true,output:path.basename(of)});
 }
 const bg=(h,labels)=>svg(1800,h,`<rect width="1800" height="${h}" fill="#28352d"/><path d="M600 105V${h-20}M1200 105V${h-20}" stroke="#526052"/>`+labels);
 await sharp(bg(950,heroLabels)).composite(heroes).toFile(path.join(R,'destroyed-hulls-review.png'));
 await sharp(bg(680,pairLabels)).composite(pairs).toFile(path.join(R,'normal-destroyed-hulls-review.png'));
 await sharp(bg(650,mapLabels)).composite(maps).toFile(path.join(R,'map-size-review.png'));
 fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify(audit.variants.map(v=>({key:v.key,bounds:v.finalBounds,changed:v.changedPixels,ringDifferences:v.ringProtectedPixelDifferences,blackRingSamples:v.opaqueBlackRingSamples})),null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
