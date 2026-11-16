// Reference preparation and review layout only. All vehicle artwork comes from image_gen.
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const R=__dirname,W=800,H=1400,L=800,NOSE=340;
const variants=[
 {key:'m4a1',label:'M4A1 · 75毫米',sub:'按用户图1 / VVSS',hull:'m4a1_hull-v2.png',turret:'m4a1_turret-v1.png',ref:'m4a1-top-up.png',rb:{x:5,y:8,w:294,h:638},rp:[151,327],tp:[550,1020],turretRefWidth:244,small:76},
 {key:'m4a1_76_hvss',label:'M4A1(76)W · HVSS',sub:'按用户图2 / 宽履带与制退器',hull:'m4a1_76_hvss_hull-v2.png',turret:'m4a1_76_hvss_turret-v2.png',ref:'m4a1-76-hvss-top-up.png',rb:{x:6,y:154,w:273,h:550},rp:[140,433],tp:[475,1290],turretRefWidth:214,small:76},
];
function blank(w=W,h=H,bg={r:0,g:0,b:0,alpha:0}){return sharp({create:{width:w,height:h,channels:4,background:bg}});}
async function clean(buf){const {data,info}=await sharp(buf).ensureAlpha().raw().toBuffer({resolveWithObject:true});for(let i=0;i<data.length;i+=4)if(data[i+3]<=4)data.fill(0,i,i+4);return sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();}
async function inspect(file){const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});let x0=info.width,y0=info.height,x1=-1,y1=-1,z=0;for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const a=data[(y*info.width+x)*4+3];if(!a)z++;if(a>24){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}if(x1<x0||!z)throw Error('Bad alpha: '+file);return{width:info.width,height:info.height,clearPixels:z,b:{left:x0,top:y0,width:x1-x0+1,height:y1-y0+1}};}
async function part(file,scan,s,pivot,target){const b=scan.b,w=Math.round(b.width*s),h=Math.round(b.height*s),left=Math.round(target[0]-(pivot[0]-b.left)*s),top=Math.round(target[1]-(pivot[1]-b.top)*s);if(left<0||top<0||left+w>W||top+h>H)throw Error('Part outside canvas '+file);return{input:await sharp(file).extract(b).resize(w,h).toBuffer(),left,top};}
function text(x,y,t,size=22,color='#e8eade',anchor='start'){return`<text x="${x}" y="${y}" font-family="Microsoft YaHei,Arial,sans-serif" font-size="${size}" fill="${color}" text-anchor="${anchor}">${t}</text>`;}
function svg(w,h,s){return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${s}</svg>`);}
async function thumb(buf,w,h,crop){let s=sharp(buf).resize(w,h);if(crop)s=s.extract(crop);return s.toBuffer();}
async function main(){for(const d of ['candidates','previews'])fs.mkdirSync(path.join(R,d),{recursive:true});
 const audit={source:'two user-supplied images',generator:'built-in image_gen',status:'candidate-only',oldArtUsed:false,canvas:[W,H],hullLength:L,gameResourcesModified:false,notes:['Image geometry measured manually from user top-plan crops.','Each layer is uniformly scaled; no independent nonuniform stretching or painting by code.','Front corner zooms show the actual hull layer, not a separately generated idealized detail.','Default map-length check 76px is external QA only, not in-game visual acceptance.'],variants:[]};
 let reviewText=text(35,50,'M4A1 / M4A1(76) · 按用户图片重绘',30)+text(35,86,'上：用户参考与新稿合成对照　下：透明分层与小尺寸预览',19,'#b4c0ad');
 let frontText=text(35,48,'车首两侧履带 · 位置与挡泥板遮挡关系',29)+text(35,83,'左：用户参考；右：新稿。按同一车身长度取相同区域，使用实际车身分层图',19,'#b4c0ad');
 const reviewLayers=[],frontLayers=[];
 for(let i=0;i<variants.length;i++){
  const v=variants[i],hf=path.join(R,'generated',v.hull),tf=path.join(R,'generated',v.turret),hs=await inspect(hf),ts=await inspect(tf),s=L/hs.b.height,rs=L/v.rb.h,ss=v.turretRefWidth*rs/ts.b.width;
  const target=[400,NOSE+(v.rp[1]-v.rb.y)*rs],hp=[hs.b.left+hs.b.width/2,hs.b.top+(v.rp[1]-v.rb.y)/v.rb.h*hs.b.height];
  const hl=await part(hf,hs,s,hp,target),tl=await part(tf,ts,ss,v.tp,target);
  const hb=await clean(await blank().composite([hl]).png().toBuffer()),tb=await clean(await blank().composite([tl]).png().toBuffer()),ab=await clean(await blank().composite([hl,tl]).png().toBuffer());
  for(const[n,b]of[['hull',hb],['turret',tb],['assembled',ab]])await sharp(b).toFile(path.join(R,'candidates',v.key+'_'+n+'.png'));
  const rf=path.join(R,'references',v.ref),rm=await sharp(rf).metadata();
  const ref=await blank(W,H,'#e1e4d8').composite([{input:await sharp(rf).resize(Math.round(rm.width*rs),Math.round(rm.height*rs)).toBuffer(),left:Math.round(400-v.rp[0]*rs),top:Math.round(NOSE-v.rb.y*rs)}]).png().toBuffer();
  const refFront=await sharp(ref).extract({left:170,top:320,width:460,height:280}).resize(690,420).toBuffer();
  const hullFront=await sharp(hb).extract({left:170,top:320,width:460,height:280}).flatten({background:'#354037'}).resize(690,420).toBuffer();
  await sharp(refFront).toFile(path.join(R,'previews',v.key+'_reference-front.png'));
  await sharp(hullFront).toFile(path.join(R,'previews',v.key+'_candidate-front.png'));
  const x=i*800;
  reviewText+=text(x+400,128,v.label,26,'#f2f0e6','middle')+text(x+400,161,v.sub,18,'#b4c0ad','middle');
  reviewText+=text(x+200,194,'用户参考',18,'#b4c0ad','middle')+text(x+600,194,'新稿合成',18,'#b4c0ad','middle');
  reviewLayers.push({input:await thumb(ref,440,770,{left:20,top:0,width:400,height:770}),left:x,top:205},{input:await thumb(ab,440,770,{left:20,top:0,width:400,height:770}),left:x+400,top:205});
  reviewText+=text(x+200,1000,'车身',20,'#b4c0ad','middle')+text(x+600,1000,'炮塔＋主炮',20,'#b4c0ad','middle');
  reviewLayers.push({input:await sharp(hb).resize(320,560).toBuffer(),left:x+40,top:1000},{input:await sharp(tb).resize(320,560).toBuffer(),left:x+440,top:1000});
  const small=await clean(await sharp(ab).resize(v.small,Math.round(H*v.small/L)).toBuffer());
  await sharp(small).toFile(path.join(R,'previews',v.key+'_map-size.png'));
  const enlarged=await sharp(small).flatten({background:'#28352d'}).resize({width:v.small*3,kernel:'nearest'}).toBuffer();
  await sharp(enlarged).toFile(path.join(R,'previews',v.key+'_map-size-3x.png'));
  reviewLayers.push({input:small,left:x+170,top:1530},{input:enlarged,left:x+470,top:1480});
  reviewText+=text(x+208,1700,'约76px车身长',17,'#b4c0ad','middle')+text(x+584,1910,'最近邻3倍',17,'#b4c0ad','middle');
  frontText+=text(400,130+i*510,v.label,26,'#f2f0e6','middle')+text(1150,130+i*510,'新稿车身局部',22,'#f2f0e6','middle');
  frontLayers.push({input:refFront,left:45,top:150+i*510},{input:hullFront,left:845,top:150+i*510});
  audit.variants.push({key:v.key,hull:hs,turret:ts,refHull:v.rb,refPivot:v.rp,sourceTurretPivot:v.tp,pivot:target,hullScale:s,turretScale:ss,mapHullLength:v.small});
 }
 const bg='<rect width="1600" height="1940" fill="#28352d"/><path d="M800 100V1925M25 980H1575M25 1460H1575" stroke="#526052" stroke-width="2"/>';
 await sharp(svg(1600,1940,bg+reviewText)).composite(reviewLayers).toFile(path.join(R,'review-board.png'));
 await sharp(svg(1600,1180,'<rect width="1600" height="1180" fill="#28352d"/><path d="M800 100V1165M25 600H1575" stroke="#526052" stroke-width="2"/>'+frontText)).composite(frontLayers).toFile(path.join(R,'front-track-comparison.png'));
 fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(audit,null,2)+'\n');
 console.log(JSON.stringify(audit.variants.map(v=>({key:v.key,hull:v.hull.b,turret:v.turret.b,scale:[v.hullScale,v.turretScale],pivot:v.pivot})),null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
