// Artwork: image_gen; tread crop/alignment: explicitly approved pixel editing.
// This script measures, uniformly resamples and composites candidates only.
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const R=__dirname,W=800,H=1400,L=800,NOSE=340;
const measured=JSON.parse(fs.readFileSync(path.join(R,'ring-measurements.json'),'utf8'));
const trackAudit=JSON.parse(fs.readFileSync(path.join(R,'track-alignment-audit.json'),'utf8'));
const V=[
 {key:'m4a1',label:'M4A1 · 75毫米',hull:'m4a1_hull-pixel-aligned.png',turret:'m4a1_turret-unchanged.png',refH:638,refTW:244,tp:[550,1020],outerRingRadius:262,baseline:{left:16,top:22,width:819,height:1786},native:76,subtitle:'履带前后等宽、同线 / 炮塔沿用'},
 {key:'m4a1_76_hvss',label:'M4A1(76)W · HVSS',hull:'m4a1_76_hvss_hull-pixel-aligned.png',turret:'m4a1_76_hvss_turret-unchanged.png',refH:550,refTW:214,tp:[401,1405],outerRingRadius:214,baseline:{left:15,top:418,width:761,height:1462},native:76,subtitle:'履带前后等宽、同线 / 修正炮塔沿用'},
 {key:'m4a3e2',label:'M4A3E2 · 巨无霸',hull:'m4a3e2_hull-v1.png',turret:'m4a3e2_turret-v1.png',refH:774,refTW:272,tp:[444,1095],outerRingRadius:223,native:78,subtitle:'新增炮塔座圈 / 车身与炮塔统一涂装'},
];
function blank(w=W,h=H,bg={r:0,g:0,b:0,alpha:0}){return sharp({create:{width:w,height:h,channels:4,background:bg}});}
async function clean(buf){const{data,info}=await sharp(buf).ensureAlpha().raw().toBuffer({resolveWithObject:true});for(let i=0;i<data.length;i+=4)if(data[i+3]<=4)data.fill(0,i,i+4);return sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();}
async function inspect(file){const{data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});let x0=info.width,y0=info.height,x1=-1,y1=-1,clear=0;for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const a=data[(y*info.width+x)*4+3];if(!a)clear++;if(a>24){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}if(!clear||x1<x0)throw Error('Bad RGBA '+file);return{width:info.width,height:info.height,clearPixels:clear,b:{left:x0,top:y0,width:x1-x0+1,height:y1-y0+1}};}
async function part(file,scan,s,pivot,target){const b=scan.b,w=Math.round(b.width*s),h=Math.round(b.height*s),left=Math.round(target[0]-(pivot[0]-b.left)*s),top=Math.round(target[1]-(pivot[1]-b.top)*s);if(left<0||top<0||left+w>W||top+h>H)throw Error('Part outside canvas '+file);return{input:await sharp(file).extract(b).resize(w,h).toBuffer(),left,top};}
function text(x,y,t,size=22,color='#e9ecdf',anchor='start'){return`<text x="${x}" y="${y}" font-family="Microsoft YaHei,Arial,sans-serif" font-size="${size}" fill="${color}" text-anchor="${anchor}">${t}</text>`;}
function svg(w,h,body){return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);}
async function maskCoverage(turret,cx,cy,r){const{data,info}=await sharp(turret).ensureAlpha().raw().toBuffer({resolveWithObject:true});let covered=0,total=0,minA=255;for(let ring=-2;ring<=2;ring++)for(let i=0;i<360;i++){const a=i*Math.PI/180,x=Math.round(cx+(r+ring)*Math.cos(a)),y=Math.round(cy+(r+ring)*Math.sin(a)),alpha=data[(y*info.width+x)*4+3]||0;total++;if(alpha>200)covered++;minA=Math.min(minA,alpha);}return{covered,total,fraction:covered/total,minAlpha:minA};}
async function tracksPreview(){
 const items=[],guides=[],captions=[];
 const cfg=[{key:'m4a1',label:'M4A1',width:125,leftX:20,rightX:665,frontY:22,rearY:1594,bandLeft:40,bandRight:685},
 {key:'m4a1_76_hvss',label:'M4A1(76)W HVSS',width:120,leftX:20,rightX:612,frontY:418,rearY:1668,bandLeft:40,bandRight:632}];
 for(let i=0;i<cfg.length;i++){
  const c=cfg[i],file=path.join(R,'generated',c.key+'_hull-pixel-aligned.png'),base=i*800;
  captions.push(text(base+400,95,c.label,29,'#f1f2e7','middle'),text(base+400,128,`源图履带宽度 ${c.width}px · 前后边界同线`,19,'#b8c4ad','middle'));
  for(let side=0;side<2;side++)for(let end=0;end<2;end++){
   const x=base+45+end*380,y=185+side*480,cropX=side?c.rightX:c.leftX,cropY=end?c.rearY:c.frontY,band=side?c.bandRight:c.bandLeft;
   const pic=await sharp(file).extract({left:cropX,top:cropY,width:170,height:210}).resize(340,420).toBuffer();items.push({input:pic,left:x,top:y});
   captions.push(text(x+170,y-15,`${side?'右':'左'}侧 · ${end?'车尾':'车首'}`,21,'#d6dfcc','middle'));
   const x0=x+(band-cropX)*2,x1=x+(band+c.width-cropX)*2;
   guides.push(`<path d="M${x0} ${y}V${y+420}M${x1} ${y}V${y+420}" fill="none" stroke="#58d5cc" stroke-width="2" stroke-dasharray="8 6"/>`);
  }
 }
 const bg=svg(1600,1150,`<rect width="1600" height="1150" fill="#28352d"/>${text(30,42,'履带前后宽度与横向位置检查',29)}<path d="M800 65V1120" stroke="#526052"/>${captions.join('')}${text(30,1122,'青色虚线：同侧履带内外边界。仅用于审阅，透明成品不含辅助线。',20,'#b8c4ad')}`);
 await sharp(bg).composite([...items,{input:svg(1600,1150,guides.join('')),left:0,top:0}]).toFile(path.join(R,'track-alignment-preview.png'));
}
async function main(){
 for(const d of['candidates','previews'])fs.mkdirSync(path.join(R,d),{recursive:true});
 const out={status:'approval-candidate',gameAssetsModified:false,canvas:[W,H],nominalHullLength:L,ringMeasurements:measured,trackAudit,notes:['Built-in image_gen for Jumbo ring and style; explicitly authorized pixel crop/alignment for M4A1 and M4A1(76) tracks.','Original hull scale and nose placement preserved for both track-edited hulls.','Circle centers measured from actual image edges; turret source pivots aligned to measured centers.','No resource registration, asset replacement or in-game visual acceptance.'],variants:[]};
 let labels=text(25,38,'谢尔曼三型 · 分层候选审阅',27)+text(25,72,'透明车身与炮塔，车头统一朝上；仅候选，未替换游戏资源。',19,'#b8c4ad');
 let assemblyLabels=text(25,38,'支点合成与地图尺寸检查',27)+text(25,72,'上：车身与炮塔合成　下：地图尺寸与最近邻3倍预览',19,'#b8c4ad');
 const art=[],assembledArt=[];
 for(let i=0;i<V.length;i++){
  const v=V[i],hf=path.join(R,'generated',v.hull),tf=path.join(R,'generated',v.turret),hs=await inspect(hf),ts=await inspect(tf),baseline=v.baseline||hs.b,s=L/baseline.height,ss=v.refTW*(L/v.refH)/ts.b.width,ring=measured[v.key].circleCenter;
  const target=[400+(ring[0]-(baseline.left+baseline.width/2))*s,NOSE+(ring[1]-baseline.top)*s];
  const hl=await part(hf,hs,s,ring,target),tl=await part(tf,ts,ss,v.tp,target);
  const hb=await clean(await blank().composite([hl]).png().toBuffer()),tb=await clean(await blank().composite([tl]).png().toBuffer()),ab=await clean(await blank().composite([hl,tl]).png().toBuffer());
  for(const[n,b]of[['hull',hb],['turret',tb],['assembled',ab]])await sharp(b).toFile(path.join(R,'candidates',v.key+'_'+n+'.png'));
  const coverage=await maskCoverage(tb,target[0],target[1],v.outerRingRadius*s);
  if(coverage.fraction!==1)throw Error(v.key+' ring exposed beneath aligned turret: '+JSON.stringify(coverage));
  const nh=Math.round(v.native*H/W),small=await clean(await sharp(ab).resize(v.native,nh).toBuffer());await sharp(small).toFile(path.join(R,'previews',v.key+'_map-size.png'));
  const big=await sharp(small).flatten({background:'#28352d'}).resize(v.native*3,nh*3,{kernel:'nearest'}).toBuffer();await sharp(big).toFile(path.join(R,'previews',v.key+'_map-size-3x.png'));
  const x=i*600;
  labels+=text(x+300,119,v.label,26,'#f1f2e7','middle')+text(x+300,151,v.subtitle,17,'#b8c4ad','middle')+text(x+150,185,'车身 · 炮塔座圈',19,'#d6dfcc','middle')+text(x+450,185,'炮塔',19,'#d6dfcc','middle');
  const frame={left:150,top:100,width:500,height:1100};
  art.push({input:await sharp(hb).extract(frame).resize(280,616).toBuffer(),left:x+10,top:205},{input:await sharp(tb).extract(frame).resize(280,616).toBuffer(),left:x+310,top:205});
  assemblyLabels+=text(x+300,122,v.label,26,'#f1f2e7','middle');
  assembledArt.push({input:await sharp(ab).resize(320,560).toBuffer(),left:x+140,top:140},{input:small,left:x+90,top:800},{input:big,left:x+310,top:750});
  assemblyLabels+=text(x+128,978,`${v.native}px车身长`,17,'#b8c4ad','middle')+text(x+425,1188,'最近邻3倍',17,'#b8c4ad','middle');
  out.variants.push({key:v.key,hull:hs,turret:ts,hullBaselineBounds:baseline,hullScale:s,turretScale:ss,sourceRingCenter:ring,sourceTurretPivot:v.tp,pivot:target,ringRadius:v.outerRingRadius*s,ringCoverageByTurret:coverage,mapHullLength:v.native});
 }
 await sharp(svg(1800,865,`<rect width="1800" height="865" fill="#28352d"/><path d="M600 90V845M1200 90V845" stroke="#526052"/>${labels}`)).composite(art).toFile(path.join(R,'family-review.png'));
 await sharp(svg(1800,1220,`<rect width="1800" height="1220" fill="#28352d"/><path d="M600 95V1200M1200 95V1200M25 725H1775" stroke="#526052"/>${assemblyLabels}`)).composite(assembledArt).toFile(path.join(R,'assembly-review.png'));
 await tracksPreview();
 fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify(out.variants.map(v=>({key:v.key,pivot:v.pivot,ringRadius:v.ringRadius,coverage:v.ringCoverageByTurret})),null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
