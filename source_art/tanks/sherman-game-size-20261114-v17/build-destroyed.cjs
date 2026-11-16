// Generated damage comes from edits of the final 84x158 hull, not a high-res
// intact tank. Only technical registration / local composite is performed here.
const fs=require('fs'),path=require('path'),sharp=require('sharp'),crypto=require('crypto');
const {inspect,text,svg}=require('../sherman-destroyed-hulls-20261114-v16/review-helpers.cjs');
const R=__dirname,L=JSON.parse(fs.readFileSync(path.join(R,'layout.json')));
const masks={m4a1:[[9,15,38,45,3],[12,96,62,51,3],[62,136,18,20,2]],m4a1_76_hvss:[[38,10,40,49,3],[11,94,61,55,3],[6,136,21,20,2]],m4a3e2:[[4,18,43,45,3],[12,98,61,49,3],[61,137,20,19,2]]};
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function ease(t){t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);}
function mask(x,y,z){const [l,t,w,h,f]=z;return ease(Math.min(x-l,l+w-1-x,y-t,t+h-1-y)/f);}
async function main(){
 const audit={generator:'built-in image_gen; final-size hull edit targets',gameAssetsReplaced:false,canvasHull:[84,158],maxPNGSide:200,ringPivot:L.hullPivot,protectedRadius:24,variants:[]};
 let labels=text(24,38,'谢尔曼正式尺寸资源 · 车身 / 炮塔 / 合成 / 击毁',27)+text(24,76,'上排为PNG原始尺寸；下排为车身正常 / 击毁最近邻2倍。所有文件最长边≤200px，尚未接入游戏。',18,'#b8c4ad');
 let dlabels=text(24,38,'毁伤可读性 · 上一版 / 新版',28)+text(24,76,'左侧原始158px高度，右侧为新版最近邻3倍；中心圆孔是座圈，新增破口在车首和发动机舱。',18,'#b8c4ad');
 const comps=[],dcomps=[];
 for(let i=0;i<L.variants.length;i++){
  const v=L.variants[i],normal=path.join(R,v.files.hull),gen=path.join(R,'generated',v.key+'_destroyed.png'),nb=(await inspect(normal)).b,gb=(await inspect(gen)).b;
  const p=await sharp(gen).extract(gb).resize({height:nb.height}).png().toBuffer(),pm=await sharp(p).metadata(),left=Math.round(nb.left+(nb.width-pm.width)/2),top=nb.top;
  // Register on a larger intermediate canvas so a buckled track is not clipped
  // before the normal footprint / alpha is restored.
  const pad=10,al=await sharp({create:{width:104,height:178,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:p,left:left+pad,top:top+pad}]).png().toBuffer();
  const aligned=await sharp(al).extract({left:10,top:10,width:84,height:158}).png().toBuffer();await sharp(aligned).toFile(path.join(R,'generated',v.key+'_registered.png'));
  const nd=await sharp(normal).ensureAlpha().raw().toBuffer(),gd=await sharp(aligned).ensureAlpha().raw().toBuffer(),out=Buffer.from(nd);let changed=0,ringDiff=0,alphaDiff=0;
  for(let y=0;y<158;y++)for(let x=0;x<84;x++){
   const q=(y*84+x)*4,r=Math.hypot(x-42,y-74.8);let a=r>24&&nd[q+3]?Math.max(...masks[v.key].map(z=>mask(x,y,z))):0;
   if(gd[q+3]<220)a=0;for(let c=0;c<3;c++)out[q+c]=Math.round(nd[q+c]*(1-a)+gd[q+c]*a);
   if(!out.subarray(q,q+4).equals(nd.subarray(q,q+4))){changed++;if(r<=24)ringDiff++;}if(out[q+3]!==nd[q+3])alphaDiff++;
  }
  if(ringDiff||alphaDiff)throw Error('Geometry/ring changed '+v.key);
  const buf=await sharp(out,{raw:{width:84,height:158,channels:4}}).png().toBuffer(),dest='destroyed/'+v.kind+'_top_destroyed.png';await sharp(buf).toFile(path.join(R,dest));
  const old=await sharp(path.join(R,'..','sherman-destroyed-hulls-20261114-v16/candidates',v.key+'_hull_destroyed.png')).resize(152,266).extract(L.frames.hull).png().toBuffer();
  await sharp(old).toFile(path.join(R,'previews',v.key+'_previous-destroyed.png'));
  const od=await sharp(old).ensureAlpha().raw().toBuffer();let oldDark=0,newDark=0,armor=0;
  for(let y=0;y<158;y++)for(let x=0;x<84;x++){
   const q=(y*84+x)*4;if(nd[q+3]<240||Math.hypot(x-42,y-74.8)<25)continue;armor++;
   if(Math.max(od[q],od[q+1],od[q+2])<55)oldDark++;if(Math.max(out[q],out[q+1],out[q+2])<55)newDark++;
  }
  const x=i*480;labels+=text(x+240,119,v.label,24,'#e9ecdf','middle');dlabels+=text(x+240,119,v.label,24,'#e9ecdf','middle');
  for(const [file,dx,name]of [[v.files.hull,30,'车身'],[v.files.turret,136,'炮塔'],[v.files.top,222,'合成'],[dest,338,'击毁']]){
   labels+=text(x+dx+38,150,name,17,'#b8c4ad','middle');comps.push({input:fs.readFileSync(path.join(R,file)),left:x+dx,top:170});
  }
  labels+=text(x+124,425,'正常车身 · 2倍',19,'#b8c4ad','middle')+text(x+349,425,'击毁车身 · 2倍',19,'#b8c4ad','middle');
  comps.push({input:await sharp(normal).resize(168,316,{kernel:'nearest'}).toBuffer(),left:x+40,top:449},{input:await sharp(buf).resize(168,316,{kernel:'nearest'}).toBuffer(),left:x+265,top:449});
  dlabels+=text(x+70,160,'上一版',18,'#b8c4ad','middle')+text(x+180,160,'新版',18,'#b8c4ad','middle')+text(x+340,638,'新版 · 最近邻3倍',18,'#b8c4ad','middle');
  dcomps.push({input:old,left:x+28,top:180},{input:buf,left:x+138,top:180},{input:await sharp(buf).resize(252,474,{kernel:'nearest'}).toBuffer(),left:x+222,top:150});
  // Show another important runtime size, roughly 76px hull length.
  const map=await sharp(buf).resize(42,79).toBuffer();await sharp(map).toFile(path.join(R,'previews',v.key+'_destroyed-76px.png'));
  dlabels+=text(x+125,404,'约76px车长',17,'#b8c4ad','middle');dcomps.push({input:map,left:x+104,top:425});
  for(const [part,f]of Object.entries(v.files)){
   const m=await sharp(path.join(R,f)).metadata();if(m.width>200||m.height>200||!m.hasAlpha)throw Error('Texture contract '+f);
  }
  if(sha(normal)!==sha(path.join(R,'references',v.key+'_final-hull-edit-target.png')))throw Error('Final normal target changed');
  audit.variants.push({key:v.key,kind:v.kind,output:dest,normalHullSHA256:sha(normal),normalBounds:nb,generatedBounds:gb,uniformScale:nb.height/gb.height,placement:{left,top,width:pm.width,height:pm.height},changedPixels:changed,alphaDifferences:alphaDiff,ringDifferences:ringDiff,damageMasks:masks[v.key],darkArmorComparison:{threshold:'RGB maximum below 55, alpha >=240, radius25 turret opening excluded',armorPixels:armor,previousDarkPixels:oldDark,newDarkPixels:newDark,ratio:oldDark?newDark/oldDark:null}});
 }
 const bg=(h,t)=>svg(1440,h,`<rect width="1440" height="${h}" fill="#28352d"/><path d="M480 100V${h-20}M960 100V${h-20}" stroke="#526052"/>`+t);
 await sharp(bg(815,labels)).composite(comps).toFile(path.join(R,'production-size-review.png'));
 await sharp(bg(675,dlabels)).composite(dcomps).toFile(path.join(R,'damage-before-after.png'));
 audit.finalFiles=[];
 for(const dir of ['normal','destroyed'])for(const f of fs.readdirSync(path.join(R,dir))){
  if(!f.endsWith('.png'))continue;const m=await sharp(path.join(R,dir,f)).metadata();
  if(m.width>200||m.height>200||!m.hasAlpha)throw Error('Final PNG contract '+f);
  audit.finalFiles.push({file:dir+'/'+f,width:m.width,height:m.height,hasAlpha:m.hasAlpha});
 }
 for(const v of L.variants)for(const part of ['hull','turret'])if(sha(path.join(R,'..',v.sourceVersion,'candidates',v.key+'_'+part+'.png'))!==v.sourceHashes[part])throw Error('Normal source changed '+v.key);
 audit.normalSourceHashesUnchanged=true;
 fs.writeFileSync(path.join(R,'review-audit.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify(audit.variants.map(v=>({key:v.key,changed:v.changedPixels,ring:v.ringDifferences,damage:v.darkArmorComparison})),null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
