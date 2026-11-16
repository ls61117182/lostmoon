// User-authorized width change only. Resample the chassis; restore the original
// circular mounting seat separately so it cannot be narrowed into an ellipse.
const fs=require('fs'),path=require('path'),sharp=require('sharp'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'../../..'),R=__dirname,V17=path.join(R,'../sherman-game-size-20261114-v17');
const {inspect,text,svg}=require('../sherman-destroyed-hulls-20261114-v16/review-helpers.cjs');
const ratio=380/416,kind='sherman_jumbo',units=path.join(ROOT,'assets/resources/textures/units');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
async function rgba(f){return sharp(f).ensureAlpha().raw().toBuffer({resolveWithObject:true});}
async function encode(data,width,height){return sharp(data,{raw:{width,height,channels:4}}).png().toBuffer();}
function smooth(t){t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);}
async function preserveRing(buf,original,w,h,cx,cy,r,f){
 const out=(await rgba(buf)).data,old=(await rgba(original)).data;let differences=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const d=Math.hypot(x-cx,y-cy),a=1-smooth((d-r)/f),p=(y*w+x)*4;
  if(a)for(let c=0;c<4;c++)out[p+c]=Math.round(out[p+c]*(1-a)+old[p+c]*a);
  if(d<=r&&!out.subarray(p,p+4).equals(old.subarray(p,p+4)))differences++;
 }
 if(differences)throw Error('Ring changed');return encode(out,w,h);
}
async function main(){
 for(const d of ['normal','destroyed','candidates','backup'])fs.mkdirSync(path.join(R,d),{recursive:true});
 const before={};for(const k of ['sherman','sherman76'])for(const s of ['top','top_hull','top_turret','top_destroyed'])before[k+'_'+s]=sha(path.join(units,k+'_'+s+'.png'));
 const turretHash=sha(path.join(units,kind+'_top_turret.png'));
 const source=path.join(R,'../sherman-jumbo-curved-shoulders-20261114-v14/candidates/m4a3e2_hull.png');
 const narrow=await sharp(source).extract({left:192,top:340,width:416,height:800}).resize(380,800).png().toBuffer();
 const canvas=await sharp({create:{width:800,height:1400,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:narrow,left:210,top:340}]).png().toBuffer();
 const high=await preserveRing(canvas,source,800,1400,400,720,125,8);await sharp(high).toFile(path.join(R,'candidates/m4a3e2_hull.png'));
 const bounds=(await inspect(high)).b;if(bounds.width!==380||bounds.height!==800||bounds.top!==340)throw Error('Wrong source dimensions '+JSON.stringify(bounds));
 const oldHull=path.join(V17,'normal/sherman_jumbo_top_hull.png'),oldWreck=path.join(V17,'destroyed/sherman_jumbo_top_destroyed.png');
 let normal=await sharp(high).resize(152,266).extract({left:34,top:62,width:84,height:158}).png().toBuffer();
 normal=await preserveRing(normal,oldHull,84,158,42,74.8,24,2);
 const n=(await rgba(normal)).data,od=(await rgba(oldWreck)).data,out=Buffer.from(n);
 // Warp the already-approved wreck horizontally about the unchanged seat axis.
 // Premultiplied interpolation avoids dark fringes on transparent track edges.
 for(let y=0;y<158;y++)for(let x=0;x<84;x++){
  const sx=(x+.5-42)/ratio+42-.5,x0=Math.floor(sx),f=sx-x0,p=(y*84+x)*4;
  let alpha=0,rgb=[0,0,0];
  for(const [xx,weight]of [[x0,1-f],[x0+1,f]])if(xx>=0&&xx<84){const q=(y*84+xx)*4,a=od[q+3]/255;alpha+=a*weight;for(let c=0;c<3;c++)rgb[c]+=od[q+c]*a*weight;}
  if(alpha>.2&&n[p+3])for(let c=0;c<3;c++)out[p+c]=Math.round(rgb[c]/alpha);
 }
 let wreck=await preserveRing(await encode(out,84,158),normal,84,158,42,74.8,24,2);
 const nd=(await rgba(normal)).data,dd=(await rgba(wreck)).data;for(let p=3;p<nd.length;p+=4)if(nd[p]!==dd[p])throw Error('Wreck silhouette mismatch');
 const turret=path.join(V17,'normal/sherman_jumbo_top_turret.png');
 const assembled=await sharp({create:{width:84,height:200,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:normal,left:0,top:42},{input:turret,left:9,top:0}]).png().toBuffer();
 const top=await sharp(assembled).extract({left:0,top:1,width:84,height:199}).png().toBuffer();
 for(const [f,b]of [['normal/sherman_jumbo_top_hull.png',normal],['normal/sherman_jumbo_top.png',top],['destroyed/sherman_jumbo_top_destroyed.png',wreck]])await sharp(b).toFile(path.join(R,f));
 fs.copyFileSync(turret,path.join(R,'normal/sherman_jumbo_top_turret.png'));
 const files=['sherman_jumbo_top_hull.png','sherman_jumbo_top.png','sherman_jumbo_top_destroyed.png'];
 const csv=path.join(ROOT,'data/tank_visuals.csv'),db=path.join(ROOT,'assets/scripts/core/TankVisualDB.ts');
 for(const f of [csv,db,...files.map(f=>path.join(units,f)),...files.map(f=>path.join(units,f+'.meta'))]){
  const dest=path.join(R,'backup',path.basename(f)+(f.endsWith('.ts')?'.bak':''));if(!fs.existsSync(dest))fs.copyFileSync(f,dest);
 }
 for(const f of files){const from=path.join(R,f.includes('destroyed')?'destroyed':'normal',f),dest=path.join(units,f);await sharp(from).rotate(270).png().toFile(dest);const m=await sharp(dest).metadata(),j=JSON.parse(fs.readFileSync(dest+'.meta')),d=Object.values(j.subMetas).find(s=>s.importer==='sprite-frame').userData;if(d.rawWidth!==m.width||d.rawHeight!==m.height)throw Error('Unexpected meta dimensions');}
 const mgY=42+(29-42)*ratio;let contents=fs.readFileSync(csv,'utf8'),head=contents.replace(/^\uFEFF/,'').split(/\r?\n/)[0].split(',');
 contents=contents.replace(/^sherman_jumbo,[^\r\n]*/m,line=>{const row=line.split(',');row[head.indexOf('hullMuzzleSpriteY')]=String(mgY);row[head.indexOf('notes')]='M4A3E2 Jumbo approved v19; source hull width 380 from 416; unchanged circular seat and turret; hull-aligned wreck';return row.join(',');});fs.writeFileSync(csv,contents);
 for(const [f,h]of Object.entries(before))if(sha(path.join(units,f+'.png'))!==h)throw Error('Unrelated Sherman changed');if(sha(path.join(units,kind+'_top_turret.png'))!==turretHash)throw Error('Turret changed');
 let labels=text(20,35,'巨无霸车身宽度 · 416 → 380',26)+text(20,68,'同一车长与座圈；下方为正式尺寸最近邻3倍。',18,'#b8c4ad');const comps=[];
 for(const [i,file,label]of [[0,oldHull,'调整前 · 416'],[1,normal,'调整后 · 380'],[2,top,'调整后 · 合成']]){labels+=text(i*300+150,111,label,22,'#e9ecdf','middle');const m=await sharp(file).metadata();comps.push({input:await sharp(file).resize(m.width*3,m.height*3,{kernel:'nearest'}).toBuffer(),left:i*300+24,top:130});}
 await sharp(svg(900,760,'<rect width="900" height="760" fill="#28352d"/>'+labels)).composite(comps).toFile(path.join(R,'width-review.png'));
 const audit={sourceBounds:bounds,widthChange:[416,380],scaleX:ratio,ringCenter:[400,720],ringDiameter:236,sourceRingProtectedRadius:125,finalRingProtectedRadius:24,finalHullBounds:(await inspect(normal)).b,finalWreckBounds:(await inspect(wreck)).b,normalWreckAlphaIdentical:true,turretUnchanged:true,otherShermansUnchanged:true,canvasUnchanged:true,metasUnchanged:true,hullMachineGunY:mgY,installed:files};fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify(audit,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
