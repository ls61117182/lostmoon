const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const dir = __dirname;
async function key(name) {
  const {data,info} = await sharp(path.join(dir,name)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let l=info.width,t=info.height,r=-1,b=-1;
  for(let y=0;y<info.height;y++) for(let x=0;x<info.width;x++) {
    const i=(y*info.width+x)*4;
    const excess=data[i+1]-Math.max(data[i],data[i+2]);
    if(excess>45) {data.fill(0,i,i+4);continue;}
    if(excess>12) data[i+1]=Math.max(data[i],data[i+2]);
    if(data[i+3]>32) {l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y);}
  }
  const box={left:l,top:t,width:r-l+1,height:b-t+1};
  return {buffer:await sharp(data,{raw:info}).extract(box).png().toBuffer(),full:await sharp(data,{raw:info}).png().toBuffer(),box};
}
(async()=>{
  const hull=await key('hull-generated.png');
  const turret=await key('turret-final-generated.png');
  const hullBuffer=await sharp(hull.buffer).resize({width:634}).png().toBuffer();
  const turretBuffer=await sharp(turret.buffer).resize({height:250}).png().toBuffer();
  const hm=await sharp(hullBuffer).metadata(),tm=await sharp(turretBuffer).metadata();
  const scaleH=634/hull.box.width,scaleT=250/turret.box.height;
  const bodyPivot={x:Math.round((614-hull.box.left)*scaleH),y:Math.round((621-hull.box.top)*scaleH)};
  const turretPivot={x:Math.round((1025-turret.box.left)*scaleT),y:Math.round((445-turret.box.top)*scaleT)};
  const dx=bodyPivot.x-turretPivot.x,dy=bodyPivot.y-turretPivot.y;
  const padding=24, hullX=padding+Math.max(0,-dx),hullY=padding+Math.max(0,-dy);
  const width=hullX+Math.max(hm.width,dx+tm.width)+padding;
  const height=hullY+Math.max(hm.height,dy+tm.height)+padding;
  const blank=()=>sharp({create:{width,height,channels:4,background:'#00000000'}});
  await blank().composite([{input:hullBuffer,left:hullX,top:hullY}]).png().toFile(path.join(dir,'sherman_top_hull.png'));
  await blank().composite([{input:turretBuffer,left:hullX+dx,top:hullY+dy}]).png().toFile(path.join(dir,'sherman_top_turret.png'));
  await sharp(path.join(dir,'sherman_top_hull.png')).composite([{input:path.join(dir,'sherman_top_turret.png')}]).png().toFile(path.join(dir,'sherman_top.png'));
  await sharp(path.join(dir,'sherman_top.png')).flatten({background:'#00ff00'}).png().toFile(path.join(dir,'normal-green.png'));
  const manifest={status:'AWAITING_USER_REVIEW_NOT_INSTALLED',facing:'left',canvas:{width,height},hullBounds:{x:hullX,y:hullY,width:hm.width,height:hm.height},sharedPivot:{x:hullX+bodyPivot.x,y:hullY+bodyPivot.y},sourceBounds:{hull:hull.box,turret:turret.box},scales:{hull:scaleH,turret:scaleT},reference:'reference-top.png',note:'Uniform resampling. Turret height 250 to reference hull length 634. No independent stretching. Current runtime assets and configs untouched.'};
  fs.writeFileSync(path.join(dir,'candidate.json'),JSON.stringify(manifest,null,2));
  if(fs.existsSync(path.join(dir,'destroyed-generated.png'))) {
    const dead=await key('destroyed-generated.png');
    await sharp(dead.full).resize({width}).png().toFile(path.join(dir,'sherman_top_destroyed.png'));
    const names=['sherman_top','sherman_top_destroyed','sherman_top_hull','sherman_top_turret'];
    const pieces=[];
    for(let i=0;i<names.length;i++) {
      const input=await sharp(path.join(dir,names[i]+'.png')).resize({width:490}).png().toBuffer();
      pieces.push({input,left:30+(i%2)*530,top:64+Math.floor(i/2)*278});
    }
    for(let i=0;i<2;i++) {
      const sm=await sharp(path.join(dir,names[i]+'.png')).resize({width:Math.round(width*100/634)}).png().toBuffer();
      await sharp(sm).toFile(path.join(dir,names[i]+'-small.png'));
      pieces.push({input:sm,left:30+i*530,top:660});
      pieces.push({input:await sharp(sm).resize({width:440,kernel:'nearest'}).png().toBuffer(),left:30+i*530,top:753});
    }
    const labels=Buffer.from(`<svg width="1100" height="1000"><style>text{font-family:Arial,'Microsoft YaHei';fill:#e8ece6;font-size:22px}.s{font-size:16px;fill:#aebba9}</style><text x="30" y="36">M4 Sherman · 正常状态</text><text x="560" y="36">击毁状态</text><text x="30" y="322">车身层</text><text x="560" y="322">炮塔层（与车身共用画布及支点）</text><text x="30" y="634">小尺寸 · 车身长度 100 px</text><text x="560" y="634">击毁 · 相同显示比例</text><text class="s" x="30" y="741">4 倍最近邻放大</text><text class="s" x="560" y="741">4 倍最近邻放大</text><text class="s" x="30" y="984">待确认候选稿 · 未替换游戏资源</text></svg>`);
    await sharp({create:{width:1100,height:1000,channels:4,background:'#26312b'}}).composite([...pieces,{input:labels,left:0,top:0}]).png().toFile(path.join(dir,'review.png'));
    const checks={files:[],compositeMatches:true};
    for(const name of names) {const m=await sharp(path.join(dir,name+'.png')).metadata();checks.files.push({name,width:m.width,height:m.height,alpha:m.hasAlpha});}
    const composite=await sharp(path.join(dir,'sherman_top_hull.png')).composite([{input:path.join(dir,'sherman_top_turret.png')}]).raw().toBuffer();
    const top=await sharp(path.join(dir,'sherman_top.png')).raw().toBuffer();
    checks.compositeMatches=composite.equals(top);
    fs.writeFileSync(path.join(dir,'checks.json'),JSON.stringify(checks,null,2));
    console.log(checks);
  }
  console.log(manifest);
})();
