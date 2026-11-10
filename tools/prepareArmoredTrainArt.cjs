// BP44 single-hex module artwork: fixed registration, layered weapons and Cocos metadata.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp');
const ROOT=path.resolve(__dirname,'..');
const SOURCE=path.join(ROOT,'source_art/trains/bp44-v1-20261106');
const OUT=path.join(ROOT,'assets/resources/textures/units/trains/bp44');
const SIZE=512,BASE=256,COUPLER=Math.sqrt(3)*128/2;
const modules=[
  {id:'locomotive',label:'装甲机车',weapons:[],chimney:[128,76]},
  {id:'tender',label:'装甲煤水车',weapons:[]},
  {id:'command',label:'指挥／步兵车',weapons:[]},
  {id:'howitzer',label:'榴弹炮车',weapons:[{id:'howitzer',pivot:[128,78],angle:0}]},
  {id:'artillery_flak',label:'火炮／防空组合车',weapons:[{id:'howitzer',pivot:[128,78],angle:0},{id:'flakvierling',pivot:[128,180],angle:180}]},
  {id:'panzerjaeger',label:'反坦克炮车',weapons:[{id:'panzer4',pivot:[128,128],angle:0}]},
];
const weapons=[
  {id:'howitzer',label:'榴弹炮塔',pivot:[128,128],muzzles:[[128,72]],bounds:[101,71,54,81]},
  {id:'panzer4',label:'四号坦克式炮塔',pivot:[128,128],muzzles:[[128,48]],bounds:[103,47,50,106]},
  {id:'flakvierling',label:'四联装防空炮座',pivot:[128,128],muzzles:[[120,86],[125,86],[131,86],[136,86]],bounds:[108,84,41,69]},
];
const rgb={armor:'#78847f',light:'#9ba59a',shade:'#505b58',dark:'#252c2c',black:'#171d1c',metal:'#a2aaa0'};
function rect(x,y,w,h,fill=rgb.armor,stroke=rgb.dark,sw=2){return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;}
function circle(x,y,r,fill=rgb.armor,stroke=rgb.dark,sw=2){return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;}
function hatch(x,y,w=18,h=17){return rect(x-w/2,y-h/2,w,h,rgb.light)+`<path d="M${x-3},${y-2}h6" stroke="${rgb.dark}" stroke-width="2"/>`;}
function socket(x,y,r=22){return circle(x,y,r,rgb.shade)+circle(x,y,r-4,rgb.dark)+circle(x,y,3,rgb.metal);}
function bodyGuide(id){
  let s=rect(124,128-COUPLER,8,16,rgb.dark)+rect(124,128+COUPLER-16,8,16,rgb.dark);
  for(const y of[34,216])s+=rect(106,y,44,5,rgb.dark);
  s+=`<path d="M105 34H151L160 43V213L151 222H105L96 213V43Z" fill="${rgb.armor}" stroke="${rgb.dark}" stroke-width="3"/>`;
  s+=rect(97,46,5,165,rgb.shade)+rect(154,46,5,165,rgb.shade);
  if(id==='locomotive'){
    s+=`<path d="M112 43H144L151 55V161L143 169H113L105 161V55Z" fill="${rgb.light}" stroke="${rgb.dark}" stroke-width="2.5"/>`;
    s+=circle(128,76,11,rgb.dark)+circle(128,76,7,rgb.black)+circle(128,111,8,rgb.armor)+circle(128,143,7,rgb.armor);
    s+=rect(93,170,70,43,rgb.armor)+rect(99,176,58,31,rgb.light)+hatch(128,190,26,20);
    s+=rect(103,164,8,5,rgb.black)+rect(145,164,8,5,rgb.black);
  } else if(id==='tender'){
    s+=rect(105,49,46,78,rgb.dark);
    for(let i=0;i<11;i++)s+=`<path d="M${109+i%3*13} ${55+Math.floor(i/3)*17}l9 -2 5 9 -8 5 -7 -4Z" fill="${i%2?'#313b36':'#404943'}" stroke="#1f2824" stroke-width="1.5"/>`;
    s+=rect(104,137,48,69,rgb.light)+circle(128,166,10,rgb.armor)+hatch(128,193,16,12);
  } else if(id==='command'){
    s+=rect(104,44,48,166,rgb.light)+hatch(128,72,23,24)+hatch(128,174,24,26);
    s+=rect(113,112,30,30,rgb.armor)+hatch(128,127,17,17);
    for(const y of[89,104,151,192])s+=rect(98,y,4,7,rgb.black)+rect(154,y,4,7,rgb.black);
    s+=rect(115,198,26,7,rgb.shade);
  } else if(id==='howitzer'){
    s+=rect(101,40,54,73,rgb.shade)+socket(128,78);
    s+=rect(103,125,50,83,rgb.light)+hatch(128,153,25,25)+hatch(128,191,19,14);
  } else if(id==='artillery_flak'){
    s+=rect(101,40,54,73,rgb.shade)+socket(128,78);
    s+=rect(104,115,48,29,rgb.light)+hatch(128,129,18,17);
    s+=rect(101,151,54,63,rgb.shade)+socket(128,180,21);
    s+=rect(98,151,4,61,rgb.light)+rect(154,151,4,61,rgb.light);
  } else {
    s+=`<path d="M103 36H153L160 52H96Z" fill="${rgb.shade}" stroke="${rgb.dark}" stroke-width="2"/>`;
    s+=`<path d="M110 75H146L154 94V163L144 176H112L102 163V94Z" fill="${rgb.light}" stroke="${rgb.dark}" stroke-width="2"/>`;
    s+=socket(128,128,22)+hatch(128,57,24,13)+hatch(128,198,28,22);
  }
  return s;
}
function weaponGuide(id){
  if(id==='flakvierling'){
    let s=circle(128,128,17,rgb.shade)+rect(112,120,32,26,rgb.armor);
    for(const x of[120,125,131,136])s+=rect(x-1.25,86,2.5,37,rgb.dark,'none',0);
    s+=rect(109,115,12,18,rgb.light)+rect(135,115,12,18,rgb.light)+rect(119,124,18,13,rgb.shade);
    s+=rect(109,139,11,12,rgb.dark)+rect(136,139,11,12,rgb.dark);
    return s;
  }
  if(id==='panzer4')return `<path d="M113 106L143 106 150 122 147 141 138 151H118L107 140 105 122Z" fill="${rgb.armor}" stroke="${rgb.dark}" stroke-width="2.5"/>`
    +rect(117,140,22,11,rgb.shade)+rect(119,102,18,13,rgb.shade)+rect(125.8,53,4.4,52,rgb.armor)+rect(123.5,48,9,9,rgb.shade)+hatch(135,129,14,16)+circle(116,126,5,rgb.light);
  return `<path d="M113 108H143L152 117V137L143 148H113L104 137V117Z" fill="${rgb.armor}" stroke="${rgb.dark}" stroke-width="2.5"/>`
    +rect(119,102,18,13,rgb.shade)+rect(124,73,8,32,rgb.armor)+rect(122,72,12,8,rgb.shade)+hatch(136,130,14,17);
}
async function guides(){
  for(const dir of['guides','sources','prompts','assembled','previews'])fs.mkdirSync(path.join(SOURCE,dir),{recursive:true});
  for(const [id,body]of [...modules.map(m=>[m.id+'_body',bodyGuide(m.id)]),...weapons.map(w=>[w.id+'_weapon',weaponGuide(w.id)])]){
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 256 256">${body}</svg>`;
    fs.writeFileSync(path.join(SOURCE,'guides',id+'.svg'),svg);
    await sharp(Buffer.from(svg)).png().toFile(path.join(SOURCE,'guides',id+'.png'));
  }
  console.log(`Saved ${modules.length+weapons.length} geometry guides.`);
}
function bounds(data,width,height,threshold=24){let x=width,y=height,right=-1,bottom=-1;for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++)if(data[(yy*width+xx)*4+3]>=threshold){x=Math.min(x,xx);y=Math.min(y,yy);right=Math.max(right,xx);bottom=Math.max(bottom,yy);}if(right<0)throw Error('Empty alpha');return {left:x,top:y,width:right-x+1,height:bottom-y+1};}
async function alphaBounds(file){const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});return bounds(data,info.width,info.height);}
const filename=(id,state)=>`bp44_${id}_${state}.png`;
const guid=(key)=>{const s=crypto.createHash('sha256').update('sherman:bp44:'+key).digest('hex').slice(0,32);return `${s.slice(0,8)}-${s.slice(8,12)}-4${s.slice(13,16)}-a${s.slice(17,20)}-${s.slice(20)}`;};
function directoryMeta(dir){if(fs.existsSync(dir+'.meta'))return;fs.writeFileSync(dir+'.meta',JSON.stringify({ver:'1.2.0',importer:'directory',imported:true,uuid:guid(path.relative(ROOT,dir)),files:[],subMetas:{},userData:{}},null,2)+'\n');}
function meta(file){
  const template=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/resources/textures/terrain/railway/railway_100100_v1.png.meta'),'utf8'));
  const name=path.basename(file,'.png');
  const m=JSON.parse(JSON.stringify(template).replaceAll(template.uuid,guid(name)).replaceAll('railway_100100_v1',name));
  const f=m.subMetas.f9941.userData;
  Object.assign(f,{width:SIZE,height:SIZE,rawWidth:SIZE,rawHeight:SIZE,offsetX:0,offsetY:0,trimX:0,trimY:0,trimType:'none',packable:false});
  f.vertices.rawPosition=[-256,-256,0,256,-256,0,-256,256,0,256,256,0];
  f.vertices.uv=[0,512,512,512,0,0,512,0];f.vertices.minPos=[-256,-256,0];f.vertices.maxPos=[256,256,0];
  fs.writeFileSync(file+'.meta',JSON.stringify(m,null,2)+'\n');
}
async function saveImage(file,buffer){
  try{if((await fs.promises.readFile(file)).equals(buffer))return;}catch(e){if(e.code!=='ENOENT')throw e;}
  for(let i=0;i<20;i++){try{await fs.promises.writeFile(file,buffer);return;}catch(e){if(!['EBUSY','EPERM','EACCES','UNKNOWN'].includes(e.code)||i===19)throw e;await new Promise(r=>setTimeout(r,100));}}
}
async function normalizeBody(id){
  const source=path.join(SOURCE,'sources',id+'_body-generated.png');
  const box=await alphaBounds(source),scale=(COUPLER*2*2)/box.height;
  const width=Math.round(box.width*scale),height=Math.round(box.height*scale);
  if(width>190)throw Error(`${id}: hull too wide (${width}px after uniform registration)`);
  const input=await sharp(source).extract(box).resize(width,height).png().toBuffer();
  const buffer=await sharp({create:{width:SIZE,height:SIZE,channels:4,background:'#00000000'}}).composite([{input,left:Math.round((SIZE-width)/2),top:Math.round((SIZE-height)/2)}]).png().toBuffer();
  await saveImage(path.join(OUT,filename(id,'body')),buffer);meta(path.join(OUT,filename(id,'body')));
  return {source:path.relative(ROOT,source).replaceAll('\\','/'),sourceBounds:box,scale,offset:{x:Math.round((SIZE-width)/2),y:Math.round((SIZE-height)/2)}};
}
async function normalizeWeapon(id){
  const source=path.join(SOURCE,'sources',id+'_weapon-generated.png');
  // Guide preserves the shared car/turret scale; weapon-specific registration lives
  // in registration.json and never stretches X/Y independently.
  const registration=JSON.parse(fs.readFileSync(path.join(SOURCE,'registration.json'),'utf8'));
  const pose=registration.weapons[id];
  if(!pose)throw Error(`Missing ${id} weapon registration`);
  const buffer=await renderPose(source,pose);
  await saveImage(path.join(OUT,filename(id,'weapon')),buffer);meta(path.join(OUT,filename(id,'weapon')));
}
async function renderPose(source,pose){
  const m=await sharp(source).metadata(),width=Math.round(m.width*pose.scale),height=Math.round(m.height*pose.scale);
  const x=Math.round(pose.x),y=Math.round(pose.y),left=Math.max(0,-x),top=Math.max(0,-y);
  const w=Math.min(width-left,SIZE-Math.max(x,0)),h=Math.min(height-top,SIZE-Math.max(y,0));
  if(w<=0||h<=0)throw Error('Registration outside canvas');
  const input=await sharp(source).resize(width,height).extract({left,top,width:w,height:h}).png().toBuffer();
  return sharp({create:{width:SIZE,height:SIZE,channels:4,background:'#00000000'}})
    .composite([{input,left:Math.max(0,x),top:Math.max(0,y)}]).png().toBuffer();
}
async function register(source,target,initial,fixed=false){
  const sm=await sharp(source).metadata(),tm=await sharp(target).metadata();
  const s=await sharp(source).resize(128,128).ensureAlpha().raw().toBuffer();
  const t=await sharp(target).resize(128,128).ensureAlpha().raw().toBuffer();
  const score=pose=>{
    let intersection=0,union=0;
    for(let y=0;y<128;y++)for(let x=0;x<128;x++){
      const sx=Math.floor(((x+.5)*4-pose.x)/(pose.scale*sm.width)*128);
      const sy=Math.floor(((y+.5)*4-pose.y)/(pose.scale*sm.height)*128);
      const a=t[(y*128+x)*4+3]>32,b=sx>=0&&sx<128&&sy>=0&&sy<128&&s[(sy*128+sx)*4+3]>32;
      intersection+=a&&b?1:0;union+=a||b?1:0;
    }
    return union?intersection/union:0;
  };
  if(fixed){const pose={scale:Number(initial.scale.toFixed(7)),x:Math.round(initial.x),y:Math.round(initial.y)};return {...pose,silhouetteIoU:Number(score(pose).toFixed(4))};}
  let pose=initial,best=score(pose);
  for(let ds=-3;ds<=3;ds++)for(let dx=-4;dx<=4;dx++)for(let dy=-5;dy<=5;dy++){
    const p={scale:initial.scale*(1+ds*.03),x:initial.x+dx*3,y:initial.y+dy*3},v=score(p);
    if(v>best){best=v;pose=p;}
  }
  const coarse=pose;
  for(let ds=-2;ds<=2;ds++)for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++){
    const p={scale:coarse.scale*(1+ds*.0075),x:coarse.x+dx,y:coarse.y+dy},v=score(p);
    if(v>best){best=v;pose=p;}
  }
  return {scale:Number(pose.scale.toFixed(7)),x:Math.round(pose.x),y:Math.round(pose.y),silhouetteIoU:Number(best.toFixed(4))};
}
async function registration(){
  const file=path.join(SOURCE,'registration.json');
  const data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{schemaVersion:1,weapons:{},destroyed:{}};
  for(const w of weapons){
    const source=path.join(SOURCE,'sources',w.id+'_weapon-generated.png'),target=path.join(SOURCE,'guides',w.id+'_weapon.png');
    const sb=await alphaBounds(source),tb=await alphaBounds(target);
    const scale=(tb.width*.5)/sb.width;
    const initial={scale,x:(tb.left+tb.width/2)*.5-(sb.left+sb.width/2)*scale,y:(tb.top+tb.height/2)*.5-(sb.top+sb.height/2)*scale};
    data.weapons[w.id]=await register(source,target,initial);
    console.log(w.id,data.weapons[w.id]);
  }
  for(const m of modules){
    const source=path.join(SOURCE,'sources',m.id+'_destroyed-generated.png'),target=path.join(SOURCE,'assembled',m.id+'_normal.png');
    if(!fs.existsSync(source)||!fs.existsSync(target))continue;
    const sb=await alphaBounds(source),tb=await alphaBounds(target);
    const {data:pixels,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let sumX=0,weight=0;
    for(const y0 of[sb.top+sb.height*.025,sb.top+sb.height*.975])for(let y=Math.round(y0)-3;y<=Math.round(y0)+3;y++)for(let x=0;x<info.width;x++){
      const alpha=pixels[(y*info.width+x)*4+3];if(alpha<100)continue;sumX+=(x+.5)*alpha;weight+=alpha;
    }
    const scale=tb.height/sb.height;
    // Lock the same coupler tips/axis as the intact hull. Scorched interiors and
    // torn plates must not pull a wreck's registration off the railway.
    data.destroyed[m.id]=await register(source,target,{scale,x:SIZE/2-(sumX/weight)*scale,y:tb.top-sb.top*scale},true);
    console.log(m.id+'_destroyed',data.destroyed[m.id]);
  }
  fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
}
async function assembled(id){
  const m=modules.find(m=>m.id===id),layers=[];
  for(const slot of m.weapons){
    const input=await sharp(path.join(OUT,filename(slot.id,'weapon'))).rotate(slot.angle,{background:'#00000000'}).png().toBuffer();
    const info=await sharp(input).metadata();
    layers.push({input,left:Math.round(slot.pivot[0]*2-info.width/2),top:Math.round(slot.pivot[1]*2-info.height/2)});
  }
  const output=path.join(SOURCE,'assembled',id+'_normal.png');
  await saveImage(output,await sharp(path.join(OUT,filename(id,'body'))).composite(layers).png().toBuffer());
  return output;
}
async function muzzleTips(id){
  const file=path.join(OUT,filename(id,'weapon'));
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const box=bounds(data,info.width,info.height,64),y=box.top+4;
  const runs=[];let active=null;
  for(let x=box.left;x<box.left+box.width;x++){
    if(data[(y*SIZE+x)*4+3]>=64){if(!active)active={left:x,right:x};else active.right=x;}
    else if(active){runs.push(active);active=null;}
  }
  if(active)runs.push(active);
  const expected=id==='flakvierling'?4:1;
  if(runs.length!==expected)throw Error(`${id}: expected ${expected} visible muzzle tips, found ${runs.length}`);
  return runs.map(run=>({x:(run.left+run.right+1)/2,y:box.top+.5}));
}
async function build(){
  fs.mkdirSync(OUT,{recursive:true});
  for(const dir of[path.join(ROOT,'assets/resources/textures/units/trains'),OUT])directoryMeta(dir);
  const poses={};
  for(const m of modules)poses[m.id]=await normalizeBody(m.id);
  for(const w of weapons)await normalizeWeapon(w.id);
  for(const m of modules)await assembled(m.id);
  const registration=JSON.parse(fs.readFileSync(path.join(SOURCE,'registration.json'),'utf8'));
  for(const m of modules){
    const source=path.join(SOURCE,'sources',m.id+'_destroyed-generated.png');
    if(!fs.existsSync(source))continue;
    const info=await sharp(source).metadata();
    const pose=registration.destroyed?.[m.id]??{scale:SIZE/info.width,x:0,y:0};
    const file=path.join(OUT,filename(m.id,'destroyed'));
    await saveImage(file,await renderPose(source,pose));meta(file);
  }
  const assetPath=file=>'textures/units/trains/bp44/'+file.replace('.png','')+'/spriteFrame';
  const point=p=>({x:p[0]*2,y:p[1]*2});
  const weaponDefinitions=[];
  for(const w of weapons)weaponDefinitions.push({id:w.id,label:w.label,layer:'weapon',sprite:assetPath(filename(w.id,'weapon')),pivot:point(w.pivot),muzzles:await muzzleTips(w.id)});
  const manifest={schemaVersion:2,style:'BP44',scope:'art-only',canvas:{width:SIZE,height:SIZE},baseHexRadius:128,pixelDensity:2,forward:{x:0,y:-1},footprintLength:1,
    couplingDistance:COUPLER*4,railGaugePixels:44,sourceFolder:path.relative(ROOT,SOURCE).replaceAll('\\','/'),
    modules:modules.map(m=>({id:m.id,label:m.label,body:assetPath(filename(m.id,'body')),destroyed:assetPath(filename(m.id,'destroyed')),pivot:point([128,128]),
      frontCoupler:point([128,128-COUPLER]),rearCoupler:point([128,128+COUPLER]),bogies:[point([128,64]),point([128,192])],
      ...(m.chimney?{chimney:point(m.chimney)}:{}),weapons:m.weapons.map(w=>({slotId:w.id==='howitzer'?'main_gun':w.id==='flakvierling'?'anti_aircraft':'anti_tank',id:w.id,pivot:point(w.pivot),initialAngleDegrees:w.angle,rotationMode:'independent'})),registration:poses[m.id]})),
    weapons:weaponDefinitions,
  };
  const file=path.join(OUT,'bp44_art_manifest.json');fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
  if(!fs.existsSync(file+'.meta'))fs.writeFileSync(file+'.meta',JSON.stringify({ver:'2.0.1',importer:'json',imported:true,uuid:guid('manifest'),files:['.json'],subMetas:{},userData:{}},null,2)+'\n');
  console.log(`Prepared ${modules.length} module bodies and ${weapons.length} independent weapons; assembled normal previews saved.`);
}
module.exports={ROOT,SOURCE,OUT,SIZE,COUPLER,modules,weapons,filename,alphaBounds,saveImage,assembled,build,guides,registration};
if(require.main===module){const command=process.argv[2]??'build';(command==='guides'?guides():command==='register'?registration():build()).catch(e=>{console.error(e);process.exitCode=1;});}
