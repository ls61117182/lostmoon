// Layout, uniform scale and deterministic layer alignment only. No vehicle is painted by code.
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const R=__dirname,CW=800,CH=1400,L=800,NOSE=340;
const V=[
 {key:'m4a1',label:'谢尔曼 · M4A1',sub:'75mm / 小舱口 / VVSS',hull:'m4a1_hull-v2.png',turret:'m4a1_turret-v2.png',ref:'m4a1-75-top-plan.png',rb:{x:22,y:20,w:392,h:858},rp:[220,445],tp:[434,1115],refTurretWidth:320,small:76},
 {key:'m4a1_76',label:'谢尔曼76 · M4A1(76)W',sub:'M1A1无制退器 / VVSS',hull:'m4a1_76_hull-v1.png',turret:'m4a1_76_turret-v2.png',ref:'m4a1-76-top-plan.png',rb:{x:22,y:178,w:411,h:952},rp:[228,650],tp:[401,1405],refTurretWidth:350,small:76},
 {key:'m4a3e2',label:'巨无霸 · M4A3E2',sub:'75mm / 专用厚炮塔 / VVSS',hull:'m4a3e2_hull-v1.png',turret:'m4a3e2_turret-v2.png',ref:'m4a3e2-top-plan.png',rb:{x:21,y:24,w:355,h:774},rp:[195,435],tp:[444,1095],refTurretWidth:272,small:78},
];
function canvas(w=CW,h=CH,color={r:0,g:0,b:0,alpha:0}){return sharp({create:{width:w,height:h,channels:4,background:color}});}
async function clean(buf){const {data,info}=await sharp(buf).ensureAlpha().raw().toBuffer({resolveWithObject:true});for(let i=0;i<data.length;i+=4)if(data[i+3]<=4)data.fill(0,i,i+4);return sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();}
async function scan(file){const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});let x0=info.width,y0=info.height,x1=-1,y1=-1,clear=0;for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){let a=data[(y*info.width+x)*4+3];if(!a)clear++;if(a>24){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}}if(x1<x0||!clear)throw Error('Bad RGBA '+file);return {width:info.width,height:info.height,transparent:clear,b:{left:x0,top:y0,width:x1-x0+1,height:y1-y0+1}};}
async function part(file,s,scale,pivot,target){const b=s.b,w=Math.round(b.width*scale),h=Math.round(b.height*scale),left=Math.round(target[0]-(pivot[0]-b.left)*scale),top=Math.round(target[1]-(pivot[1]-b.top)*scale);if(left<0||top<0||left+w>CW||top+h>CH)throw Error('Part outside canvas '+file);return {input:await sharp(file).extract(b).resize(w,h).toBuffer(),left,top};}
function text(x,y,t,size=23,color='#eceee3',anchor='start'){return `<text x="${x}" y="${y}" font-family="Microsoft YaHei,Arial,sans-serif" font-size="${size}" fill="${color}" text-anchor="${anchor}">${t}</text>`;}
function svg(w,h,body){return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);}
async function main(){for(const d of ['candidates','previews'])fs.mkdirSync(path.join(R,d),{recursive:true});
 const audit={generator:'built-in image_gen',date:'2026-11-13',status:'review-only',sourceArtworkUsed:false,previousCandidateArtworkUsed:false,canvas:[CW,CH],hullLength:L,gameResourcesModified:false,limitations:['Similarity alignment is manual review geometry, not a pixel-exact trace.','M4A3E2 isolated barrel remains about 15-20% shorter than the plan relative to turret width; final refinement was blocked by image generation service. Keep this marked as a candidate, not approved production art.','No in-game visual acceptance; no destroyed or commander states produced.'],variants:[]};
 const reviewLayers=[],compareLayers=[];let labels='',compareLabels='';
 labels+=text(35,50,'谢尔曼系列 · 型号与实车结构重绘',32)+text(35,85,'透明分层 / 参考比例对齐 / 待确认，未替换资源',20,'#b7c1ad');
 labels+=text(35,175,'车身与炮塔',22)+text(35,705,'确定性合成',22)+text(35,1300,'地图显示尺寸与最近邻放大',22);
 compareLabels+=text(35,48,'三视图俯视部分 ↔ 新稿合成对照',32)+text(35,82,'每对按车身等长排列；便于直接核对轮廓、舱口、甲板与炮管比例',20,'#b7c1ad');
 for(let i=0;i<V.length;i++){
  const v=V[i],hf=path.join(R,'generated',v.hull),tf=path.join(R,'generated',v.turret),hs=await scan(hf),ts=await scan(tf),s=L/hs.b.height,rs=L/v.rb.h,ss=v.refTurretWidth*rs/ts.b.width;
  const target=[400,NOSE+(v.rp[1]-v.rb.y)*rs],hp=[hs.b.left+hs.b.width/2,hs.b.top+(v.rp[1]-v.rb.y)/v.rb.h*hs.b.height];
  const hl=await part(hf,hs,s,hp,target),tl=await part(tf,ts,ss,v.tp,target);
  const hb=await clean(await canvas().composite([hl]).png().toBuffer()),tb=await clean(await canvas().composite([tl]).png().toBuffer()),ab=await clean(await canvas().composite([hl,tl]).png().toBuffer());
  for(const [n,b] of [['hull',hb],['turret',tb],['assembled',ab]])await sharp(b).toFile(path.join(R,'candidates',`${v.key}_${n}.png`));
  const small=await clean(await sharp(ab).resize(v.small,Math.round(CH*v.small/L)).toBuffer());
  await sharp(small).toFile(path.join(R,'previews',v.key+'_map-size.png'));
  const big=await sharp(small).flatten({background:'#273129'}).resize({width:v.small*3,kernel:'nearest'}).toBuffer();
  await sharp(big).toFile(path.join(R,'previews',v.key+'_map-size-3x.png'));
  const x=i*600;
  labels+=text(x+300,128,v.label,26,'#f0f0e9','middle')+text(x+300,163,v.sub,18,'#b7c1ad','middle');
  reviewLayers.push({input:await sharp(hb).resize(320,560).toBuffer(),left:x-10,top:170},{input:await sharp(tb).resize(320,560).toBuffer(),left:x+290,top:170});
  labels+=text(x+150,660,'车身',18,'#b7c1ad','middle')+text(x+450,660,'炮塔＋主炮',18,'#b7c1ad','middle');
  reviewLayers.push({input:await sharp(ab).resize(400,700).toBuffer(),left:x+100,top:620});
  reviewLayers.push({input:small,left:x+70,top:1370},{input:big,left:x+280,top:1305});
  labels+=text(x+110,1540,`${v.small}px车身长`,17,'#b7c1ad','middle')+text(x+393,1760,'最近邻 3倍',17,'#b7c1ad','middle');
  const rf=path.join(R,'references',v.ref),rm=await sharp(rf).metadata();
  const refLayer={input:await sharp(rf).resize(Math.round(rm.width*rs),Math.round(rm.height*rs)).toBuffer(),left:Math.round(400-v.rp[0]*rs),top:Math.round(NOSE-v.rb.y*rs)};
  const refBuf=await canvas(CW,CH,'#f4f3eb').composite([refLayer]).png().toBuffer();
  compareLayers.push({input:await sharp(refBuf).resize(500,875).extract({left:100,top:0,width:300,height:875}).toBuffer(),left:x,top:170},{input:await sharp(ab).resize(500,875).extract({left:100,top:0,width:300,height:875}).toBuffer(),left:x+300,top:170});
  compareLabels+=text(x+300,125,v.label,24,'#f0f0e9','middle')+text(x+150,157,'历史参考顶视图',17,'#b7c1ad','middle')+text(x+450,157,'新稿',17,'#b7c1ad','middle');
  if(v.key==='m4a3e2')compareLabels+=text(x+300,1085,'炮管相对长度仍待进一步校正',18,'#e0c78c','middle');
  audit.variants.push({key:v.key,hull:hs,turret:ts,referenceHull:v.rb,referencePivot:v.rp,referenceTurretWidth:v.refTurretWidth,sourceTurretPivot:v.tp,hullScale:s,turretScale:ss,commonPivot:target,smallHullLength:v.small});
 }
 const W=1800,H=1790,bg=`<rect width="${W}" height="${H}" fill="#273129"/><path d="M600 100V1780M1200 100V1780M25 680H1775M25 1265H1775" stroke="#4b564b" stroke-width="2"/>`;
 // Neighboring transparent thumbnail margins overlap harmlessly; bound the two outer margins.
 const safe=[];for(const l of reviewLayers){const m=await sharp(l.input).metadata();if(l.left<0)safe.push({...l,input:await sharp(l.input).extract({left:-l.left,top:0,width:m.width+l.left,height:m.height}).toBuffer(),left:0});else if(l.left+m.width>W)safe.push({...l,input:await sharp(l.input).extract({left:0,top:0,width:W-l.left,height:m.height}).toBuffer()});else safe.push(l);}
 await sharp(svg(W,H,bg+labels)).composite(safe).toFile(path.join(R,'review-board.png'));
 await sharp(svg(1800,1120,'<rect width="1800" height="1120" fill="#273129"/><path d="M600 100V1100M1200 100V1100" stroke="#4b564b"/>'+compareLabels)).composite(compareLayers).toFile(path.join(R,'reference-comparison.png'));
 fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(audit,null,2)+'\n');
 console.log(JSON.stringify(audit.variants.map(v=>({key:v.key,hull:v.hull.b,turret:v.turret.b,pivot:v.commonPivot,scales:[v.hullScale,v.turretScale]})),null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
