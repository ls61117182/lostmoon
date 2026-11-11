// Candidate-only layout and deterministic sprite compositing. Does not write game assets.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const root = __dirname;
const variants = [
  {key:'sherman',label:'谢尔曼 · 75毫米',sub:'M4A3(75)W / VVSS',hull:'sherman_hull-v2.png',turret:'sherman_turret-v2.png',hp:[627,529],tp:[627,875],tw:300,small:76},
  {key:'sherman76',label:'谢尔曼76',sub:'M4A3(76)W / HVSS',hull:'sherman76_hull-v2.png',turret:'sherman76_turret-v2.png',hp:[440,857],tp:[627,943],tw:312,small:76},
  {key:'sherman_jumbo',label:'巨无霸 · 75毫米',sub:'M4A3E2 / VVSS + duckbills',hull:'sherman_jumbo_hull-v2.png',turret:'sherman_jumbo_turret-v1.png',hp:[627,547],tp:[544,1000],tw:320,small:78},
];
function empty(w,h){return sharp({create:{width:w,height:h,channels:4,background:{r:0,g:0,b:0,alpha:0}}});}
function svg(w,h,body){return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><style>text{font-family:Microsoft YaHei,Arial,sans-serif;fill:#e5e9dc}.sub{fill:#aeb9a4;font-size:18px}.tiny{fill:#aeb9a4;font-size:16px}</style>${body}</svg>`);}
async function cleanAlpha(buf){
  const {data,info}=await sharp(buf).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  // Discard only near-invisible RGB/alpha fringe introduced by resampling, never repaint vehicle pixels.
  for(let p=0;p<data.length;p+=4)if(data[p+3]<=4)data.fill(0,p,p+4);
  return sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
}
async function inspect(file){
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let left=info.width,top=info.height,right=-1,bottom=-1,zero=0,nonzero=0;let minAlpha=255,maxAlpha=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    const a=data[(y*info.width+x)*4+3];if(a===0)zero++;else nonzero++;
    minAlpha=Math.min(minAlpha,a);maxAlpha=Math.max(maxAlpha,a);
    if(a>16){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  }
  if(right<left||bottom<top||!zero)throw Error(`Invalid transparency: ${file}`);
  return {width:info.width,height:info.height,channels:info.channels,alphaRange:[minAlpha,maxAlpha],transparentPixels:zero,visiblePixels:nonzero,bounds:{left,top,width:right-left+1,height:bottom-top+1}};
}
async function placePart(file,scan,scale,pivot,target){
  const b=scan.bounds,w=Math.round(b.width*scale),h=Math.round(b.height*scale);
  const input=await sharp(file).extract(b).resize(w,h,{kernel:'lanczos3'}).toBuffer();
  const left=Math.round(target[0]-(pivot[0]-b.left)*scale),top=Math.round(target[1]-(pivot[1]-b.top)*scale);
  if(left<0||top<0||left+w>800||top+h>1400)throw Error(`Part exceeds candidate canvas: ${file}`);
  return {input,left,top};
}
async function main(){
  for(const d of ['candidates','previews'])fs.mkdirSync(path.join(root,d),{recursive:true});
  const audit={date:'2026-11-11',status:'approval-candidates-only',generator:'built-in image_gen',existingArtUsed:false,gameAssetsModified:false,canvas:[800,1400],nominalHullLength:800,notes:['All scale operations preserve aspect ratio.','Relative turret size and provisional pivots are preview-only, not final game geometry.','Small previews use current default hexSize=60 and hullFitScale=0.70/0.70/0.72; rounded hull length 76/76/78 px.','No in-game visual acceptance performed.'],variants:[]};
  const layers=[];let labels='';const W=1500,H=1510;
  labels+='<text x="40" y="55" font-size="32" font-weight="bold">谢尔曼系列 · 首轮重绘候选</text><text x="40" y="88" class="sub">独立三视图参考 / 正俯视 / 车身与炮塔分层 / 未替换游戏资源</text>';
  labels+='<text x="40" y="167" font-size="21">分层原稿</text><text x="40" y="695" font-size="21">支点合成预览</text><text x="40" y="1274" font-size="21">默认地图尺寸对照</text>';
  for(let i=0;i<variants.length;i++){
    const v=variants[i],hf=path.join(root,'generated',v.hull),tf=path.join(root,'generated',v.turret);
    const hs=await inspect(hf),ts=await inspect(tf);const scale=800/hs.bounds.height;
    const hpTarget=[400,340+(v.hp[1]-hs.bounds.top)*scale];
    const hLayer=await placePart(hf,hs,scale,v.hp,hpTarget);
    const tScale=v.tw/ts.bounds.width;
    const tLayer=await placePart(tf,ts,tScale,v.tp,hpTarget);
    const hBuf=await cleanAlpha(await empty(800,1400).composite([hLayer]).png().toBuffer());
    const tBuf=await cleanAlpha(await empty(800,1400).composite([tLayer]).png().toBuffer());
    const combined=await cleanAlpha(await empty(800,1400).composite([hLayer,tLayer]).png().toBuffer());
    for(const [part,buf] of [['hull',hBuf],['turret',tBuf],['assembled',combined]])await sharp(buf).toFile(path.join(root,'candidates',`${v.key}_${part}.png`));
    const small=await cleanAlpha(await sharp(combined).resize(Math.round(800*v.small/800),Math.round(1400*v.small/800),{kernel:'lanczos3'}).toBuffer());
    await sharp(small).toFile(path.join(root,'previews',`${v.key}_map-size.png`));
    await sharp(small).flatten({background:'#242c26'}).resize({width:v.small*4,kernel:'nearest'}).toFile(path.join(root,'previews',`${v.key}_map-size-4x.png`));
    const x=i*500;
    labels+=`<text x="${x+250}" y="126" text-anchor="middle" font-size="25" font-weight="bold">${v.label}</text>`;
    labels+=`<text x="${x+250}" y="192" text-anchor="middle" class="sub">${v.sub}</text>`;
    labels+=`<text x="${x+135}" y="645" text-anchor="middle" class="tiny">车身</text><text x="${x+365}" y="645" text-anchor="middle" class="tiny">炮塔＋火炮</text>`;
    const hullThumb=await sharp(hBuf).resize(344,602).toBuffer();
    const turretThumb=await sharp(tBuf).resize(344,602).toBuffer();
    // Both thumbnails retain exactly the same scale as the composite candidate.
    layers.push({input:hullThumb,left:x-37,top:130},{input:turretThumb,left:x+193,top:130});
    layers.push({input:await sharp(combined).resize(360,630).toBuffer(),left:x+70,top:625});
    layers.push({input:small,left:x+Math.round((500-v.small)/2),top:1310});
    labels+=`<text x="${x+250}" y="1475" text-anchor="middle" class="tiny">车身长约 ${v.small}px · 原尺寸</text>`;
    audit.variants.push({kind:v.key,hull:hs,turret:ts,hullScale:scale,turretScale:tScale,pivot:hpTarget,sourceHullPivot:v.hp,sourceTurretPivot:v.tp,smallHullLength:v.small});
  }
  // Only layout decoration and text are vector; all vehicle imagery is image_gen output.
  const bg=svg(W,H,`<rect width="${W}" height="${H}" fill="#242c26"/><path d="M500 107V1500M1000 107V1500M25 667H1475M25 1235H1475" stroke="#455046" stroke-width="2"/>${labels}`);
  // Cropping negative thumbnail placement is unnecessary if canvas padding is added before compositing.
  const safeLayers=[];
  for(const l of layers){
    if(l.left<0){const m=await sharp(l.input).metadata();safeLayers.push({...l,input:await sharp(l.input).extract({left:-l.left,top:0,width:m.width+l.left,height:m.height}).toBuffer(),left:0});}
    else if(l.left+(await sharp(l.input).metadata()).width>W){const m=await sharp(l.input).metadata();safeLayers.push({...l,input:await sharp(l.input).extract({left:0,top:0,width:W-l.left,height:m.height}).toBuffer()});}
    else safeLayers.push(l);
  }
  await sharp(bg).composite(safeLayers).png().toFile(path.join(root,'review-board.png'));
  fs.writeFileSync(path.join(root,'review-audit.json'),JSON.stringify(audit,null,2)+'\n');
  console.log(JSON.stringify({review:path.join(root,'review-board.png'),variants:audit.variants.map(v=>({kind:v.kind,hull:v.hull.bounds,turret:v.turret.bounds,pivot:v.pivot}))},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
