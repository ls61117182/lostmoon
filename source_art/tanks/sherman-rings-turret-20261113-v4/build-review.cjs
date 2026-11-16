// Uniform resampling, measured-pivot alignment and review layout. Vehicle artwork is image_gen output.
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const R=__dirname,W=800,H=1400,L=800,NOSE=340;
const measured=JSON.parse(fs.readFileSync(path.join(R,'ring-measurements.json'),'utf8'));
const V=[
 {key:'m4a1',label:'M4A1 · 75毫米',hull:'m4a1_hull-v1.png',turret:'m4a1_turret-unchanged.png',refH:638,refTW:244,tp:[550,1020],outerRingRadius:262,subtitle:'车身补座圈 / 普通炮塔沿用'},
 {key:'m4a1_76_hvss',label:'M4A1(76)W · HVSS',hull:'m4a1_76_hvss_hull-v1.png',turret:'m4a1_76_hvss_turret-v1.png',refH:550,refTW:214,tp:[401,1405],outerRingRadius:214,subtitle:'车身补座圈 / 以上一版76型炮塔修正'},
];
function blank(w=W,h=H,bg={r:0,g:0,b:0,alpha:0}){return sharp({create:{width:w,height:h,channels:4,background:bg}});}
async function clean(buf){const{data,info}=await sharp(buf).ensureAlpha().raw().toBuffer({resolveWithObject:true});for(let i=0;i<data.length;i+=4)if(data[i+3]<=4)data.fill(0,i,i+4);return sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();}
async function inspect(file){const{data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});let x0=info.width,y0=info.height,x1=-1,y1=-1,clear=0;for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const a=data[(y*info.width+x)*4+3];if(!a)clear++;if(a>24){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}if(!clear||x1<x0)throw Error('Bad RGBA '+file);return{width:info.width,height:info.height,clearPixels:clear,b:{left:x0,top:y0,width:x1-x0+1,height:y1-y0+1}};}
async function part(file,scan,s,pivot,target){const b=scan.b,w=Math.round(b.width*s),h=Math.round(b.height*s),left=Math.round(target[0]-(pivot[0]-b.left)*s),top=Math.round(target[1]-(pivot[1]-b.top)*s);if(left<0||top<0||left+w>W||top+h>H)throw Error('Part outside canvas '+file);return{input:await sharp(file).extract(b).resize(w,h).toBuffer(),left,top};}
function text(x,y,t,size=22,color='#e9ecdf',anchor='start'){return`<text x="${x}" y="${y}" font-family="Microsoft YaHei,Arial,sans-serif" font-size="${size}" fill="${color}" text-anchor="${anchor}">${t}</text>`;}
function svg(w,h,body){return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);}
async function maskCoverage(turret,cx,cy,r){const{data,info}=await sharp(turret).ensureAlpha().raw().toBuffer({resolveWithObject:true});let covered=0,total=0,minA=255;for(let ring=-2;ring<=2;ring++)for(let i=0;i<360;i++){const a=i*Math.PI/180,x=Math.round(cx+(r+ring)*Math.cos(a)),y=Math.round(cy+(r+ring)*Math.sin(a)),alpha=data[(y*info.width+x)*4+3]||0;total++;if(alpha>200)covered++;minA=Math.min(minA,alpha);}return{covered,total,fraction:covered/total,minAlpha:minA};}
async function main(){for(const d of['candidates','previews'])fs.mkdirSync(path.join(R,d),{recursive:true});
 const out={generator:'built-in image_gen',status:'approval-candidate',gameAssetsModified:false,canvas:[W,H],nominalHullLength:L,ringMeasurements:measured,notes:['Circle centers fitted from actual image brightness edges, not merely the prompt coordinates.','Hull is preserved at the previous nose/length position; turret pivot is placed at the fitted ring center.','Only uniform scaling and deterministic compositing are applied.','Previous M4A1(76) turret is explicitly authorized as the editing base.','No in-game visual acceptance or resource replacement.'],variants:[]};
 let labels='',assemblyLabels=text(35,48,'座圈与炮塔支点合成检查',30)+text(35,83,'上：实际分层合成　下：76px车身长与最近邻3倍预览',19,'#b8c4ad');
 const art=[],assembledArt=[];
 for(let i=0;i<V.length;i++){
  const v=V[i],hf=path.join(R,'generated',v.hull),tf=path.join(R,'generated',v.turret),hs=await inspect(hf),ts=await inspect(tf),s=L/hs.b.height,ss=v.refTW*(L/v.refH)/ts.b.width,ring=measured[v.key].circleCenter;
  const target=[400+(ring[0]-(hs.b.left+hs.b.width/2))*s,NOSE+(ring[1]-hs.b.top)*s];
  const hl=await part(hf,hs,s,ring,target),tl=await part(tf,ts,ss,v.tp,target);
  const hb=await clean(await blank().composite([hl]).png().toBuffer()),tb=await clean(await blank().composite([tl]).png().toBuffer()),ab=await clean(await blank().composite([hl,tl]).png().toBuffer());
  for(const[n,b]of[['hull',hb],['turret',tb],['assembled',ab]])await sharp(b).toFile(path.join(R,'candidates',v.key+'_'+n+'.png'));
  const coverage=await maskCoverage(tb,target[0],target[1],v.outerRingRadius*s);
  const small=await clean(await sharp(ab).resize(76,133).toBuffer());await sharp(small).toFile(path.join(R,'previews',v.key+'_map-size.png'));
  const big=await sharp(small).flatten({background:'#28352d'}).resize(228,399,{kernel:'nearest'}).toBuffer();await sharp(big).toFile(path.join(R,'previews',v.key+'_map-size-3x.png'));
  const x=i*800;
  labels+=text(x+400,43,v.label,27,'#f1f2e7','middle')+text(x+400,77,v.subtitle,18,'#b8c4ad','middle')+text(x+200,110,'车身 · 炮塔座圈',20,'#d6dfcc','middle')+text(x+600,110,'炮塔',20,'#d6dfcc','middle');
  const frame={left:150,top:100,width:500,height:1100};
  art.push({input:await sharp(hb).extract(frame).resize(350,770).toBuffer(),left:x+25,top:130},{input:await sharp(tb).extract(frame).resize(350,770).toBuffer(),left:x+425,top:130});
  assemblyLabels+=text(x+400,130,v.label,26,'#f1f2e7','middle');
  assembledArt.push({input:await sharp(ab).resize(400,700).toBuffer(),left:x+200,top:140},{input:small,left:x+160,top:850},{input:big,left:x+480,top:760});
  assemblyLabels+=text(x+198,1015,'76px车身长',17,'#b8c4ad','middle')+text(x+594,1190,'最近邻3倍',17,'#b8c4ad','middle');
  out.variants.push({key:v.key,hull:hs,turret:ts,hullScale:s,turretScale:ss,sourceRingCenter:ring,sourceTurretPivot:v.tp,pivot:target,ringRadius:v.outerRingRadius*s,ringCoverageByTurret:coverage});
 }
 await sharp(svg(1600,930,'<rect width="1600" height="930" fill="#28352d"/><path d="M800 15V915" stroke="#526052"/>'+labels)).composite(art).toFile(path.join(R,'changes-preview.png'));
 await sharp(svg(1600,1220,'<rect width="1600" height="1220" fill="#28352d"/><path d="M800 100V1200M25 735H1575" stroke="#526052"/>'+assemblyLabels)).composite(assembledArt).toFile(path.join(R,'assembly-review.png'));
 fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify(out.variants.map(v=>({key:v.key,pivot:v.pivot,ringRadius:v.ringRadius,coverage:v.ringCoverageByTurret})),null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
