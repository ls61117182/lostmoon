// Production terrain overlays: generated materials, fixed hex geometry, road rotation mapping.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '..');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const { fortificationArtTransform, FORTIFICATION_ART_MASKS, FORTIFICATION_ART_DIRECTIONS } =
  require('../assets/scripts/core/FortificationArt.ts');
const SOURCE = path.join(ROOT, 'source_art/terrain/fortifications-v1-20261028');
const OUT = path.join(ROOT, 'assets/resources/textures/terrain/fortifications');
const W = 222, H = 256, S = 2, HALF = 14, PIT_RADIUS = 60;
const EDGES = [[222,128],[166.5,224],[55.5,224],[0,128],[55.5,32],[166.5,32]];
const RAYS = Array.from({length:6}, (_,d) => [Math.cos(d*Math.PI/3), Math.sin(d*Math.PI/3)]);
const flags = m => Array.from({length:6}, (_,d) => (m>>d)&1).join('');
const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
const smooth = x => { const t=clamp(x); return t*t*(3-2*t); };
const mix = (a,b,t) => a+(b-a)*t;
const filename = (kind,mask,rim=false) => `${kind}_${flags(mask)}_v1${rim?'_rim':''}.png`;
function uuid(key) {
  const h=crypto.createHash('sha256').update(`sherman:fortifications-v1:${key}`).digest('hex').slice(0,32).split('');
  h[12]='4'; h[16]=((parseInt(h[16],16)&3)|8).toString(16);
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].map(a=>a.join('')).join('-');
}
function saveJson(file,value) { fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n'); }
function directoryMeta() {
  if (!fs.existsSync(OUT+'.meta')) saveJson(OUT+'.meta',{
    ver:'1.2.0',importer:'directory',imported:true,uuid:uuid('directory'),files:[],subMetas:{},userData:{},
  });
}
function imageMeta(name) {
  const template=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/resources/textures/terrain/terrain_road.png.meta'),'utf8'));
  const meta=JSON.parse(JSON.stringify(template).replaceAll(template.uuid,uuid(name)).replaceAll('terrain_road',name.slice(0,-4)));
  const frame=meta.subMetas.f9941.userData;
  frame.trimType='none'; frame.packable=false;
  meta.userData.fixAlphaTransparencyArtifacts=true;
  saveJson(path.join(OUT,name+'.meta'),meta);
}
function jsonMeta(name) {
  saveJson(path.join(OUT,name+'.meta'),{ver:'2.0.1',importer:'json',imported:true,uuid:uuid(name),files:['.json'],subMetas:{},userData:{}});
}
function hexInset(x,y) {
  x=Math.abs(x-111); y=Math.abs(y-128);
  return Math.min(111-x,(111-x*.5-y*Math.sqrt(3)/2));
}
function segment(x,y,a,b) {
  const dx=b[0]-a[0],dy=b[1]-a[1],t=clamp(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy));
  return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);
}
function geometry(kind,mask) {
  const dirs=RAYS.map((r,d)=>({r,d})).filter(({d})=>mask&(1<<d));
  const paths=dirs.map(({r:[ux,uy]})=>[
    [0,0],[ux*32-uy*8,uy*32+ux*8],[ux*64,uy*64],[ux*140,uy*140],
  ]);
  if (!mask && kind==='trench') paths.push([[-38,5],[-12,5],[10,-9],[38,-9]]);
  const sdf=(x,y) => {
    let distance=kind==='gun_pit'?Math.hypot(x,y)-PIT_RADIUS:Infinity;
    for(const p of paths) for(let j=1;j<p.length;j++) distance=Math.min(distance,segment(x,y,p[j-1],p[j])-HALF);
    return distance;
  };
  return {dirs,paths,sdf};
}
async function materials() {
  const loaded={};
  for(const [key,file] of [['floor','trench-floor-generated.png'],['lip','earth-lip-generated.png']]) {
    loaded[key]=await sharp(path.join(SOURCE,'sources',file)).resize(W*S,H*S,{fit:'fill'}).removeAlpha().raw().toBuffer();
  }
  return loaded;
}
function decorations(kind,mask,g) {
  const bags=[];
  if(kind==='gun_pit') {
    // Balanced short clusters around a shallow pit: none implies a firing axis.
    for(const center of [Math.PI/6,Math.PI*5/6,Math.PI*7/6,Math.PI*11/6]) {
      for(const offset of [-.07,.07]) {
        const a=center+offset,x=Math.cos(a)*68,y=Math.sin(a)*68;
        if(g.sdf(x,y)>4 && g.sdf(x,y)<13) bags.push({x,y,a:a+Math.PI/2});
      }
    }
  } else {
    const dir=g.dirs[0]?.r??[1,0];
    for(const t of [-11,0,11]) {
      const x=dir[0]*(32+t)-dir[1]*23,y=dir[1]*(32+t)+dir[0]*23;
      if(g.sdf(x,y)>3 && g.sdf(x,y)<15) bags.push({x,y,a:Math.atan2(dir[1],dir[0])});
    }
  }
  return bags;
}
async function render(kind,mask,mats) {
  const {sdf,dirs,...rest}=geometry(kind,mask),g={sdf,dirs,...rest},bags=decorations(kind,mask,g);
  const data=Buffer.alloc(W*H*S*S*4),rim=Buffer.alloc(data.length);
  for(let yy=0;yy<H*S;yy++) for(let xx=0;xx<W*S;xx++) {
    const x=(xx+.5)/S,y=(yy+.5)/S,lx=x-111,ly=y-128,inset=hexInset(x,y);
    if(inset < -2) continue; // Diagonal-mouth bleed, as on roads.
    const interior=smooth((inset-12)/26);
    const noise=(Math.sin(lx*.31+Math.cos(ly*.19))*1.15+Math.cos(ly*.49+lx*.14)*.6)*interior;
    const d=sdf(lx,ly)+noise;
    if(d>17.5) continue;
    const index=(yy*W*S+xx)*4,tex=(yy*W*S+xx)*3;
    const textureWeight=smooth(inset/28);
    let color,alpha=255,foreground=0;
    if(d < 0) {
      const shade=1-.34*smooth((d+8)/8);
      color=[0,1,2].map(c=>mix([80,58,40][c],mats.floor[tex+c],textureWeight)*shade);
    } else {
      const lip=[0,1,2].map(c=>mix([168,131,83][c],mats.lip[tex+c],textureWeight));
      // Gun pits are shallower inside, but communications-trench mouths must
      // share the infantry trench cross-section, including the wall highlight.
      const slope=kind==='gun_pit'?mix(6,4.5,interior):6;
      let shade=d<slope?mix(.43,.82,d/slope):d<8?1.14:d<13?mix(1.10,.95,(d-8)/5):.78;
      // Thin strong inner edge and broken outer lip remain readable at 84x96.
      if(d>slope-.65 && d<slope+.25) shade=.53;
      color=lip.map(c=>c*shade);
      alpha=255*clamp((17-d)/2);
      foreground=255*smooth((d-2)/2);
    }
    // Short transverse duckboard strips, absent from the broad gun platform.
    if(d<-2 && dirs.length && inset>24) {
      for(let n=0;n<dirs.length;n++) {
        if(n%2 && dirs.length>2) continue;
        const [ux,uy]=dirs[n].r,u=lx*ux+ly*uy,v=-lx*uy+ly*ux;
        if(u<69||u>85||Math.abs(v)>10.5) continue;
        const board=(u-69)%5.4,edge=Math.min(board,5.4-board,10.5-Math.abs(v));
        const wave=Math.sin(v*1.8+n)*3;
        color=edge<.65?[48,39,28]:edge<1.2?[150,125,85]:[112+wave,92+wave,63+wave];
      }
    }
    for(const bag of bags) {
      const dx=lx-bag.x,dy=ly-bag.y,co=Math.cos(bag.a),si=Math.sin(bag.a);
      const u=dx*co+dy*si,v=-dx*si+dy*co;
      const round=Math.hypot(Math.max(Math.abs(u)-2.5,0),v);
      if(round>3.3) continue;
      const shade=round>2.7?.44:mix(1.07,.78,(v+3.3)/6.6);
      color=[193,175,133].map(c=>c*shade); alpha=255*clamp((3.3-round)*S);foreground=255;
    }
    for(let c=0;c<3;c++) data[index+c]=rim[index+c]=clamp(Math.round(color[c]),0,255);
    data[index+3]=Math.round(alpha);
    rim[index+3]=Math.round(alpha*foreground/255);
  }
  const encode=raw=>sharp(raw,{raw:{width:W*S,height:H*S,channels:4}}).resize(W,H).png().toBuffer();
  return {surface:await encode(data),foreground:await encode(rim)};
}
function svgText(text,width,height=28,fontSize=14,color='#e5dfcb') {
  return Buffer.from(`<svg width="${width}" height="${height}"><text x="${width/2}" y="${Math.round(height*.72)}" font-family="Microsoft YaHei,Arial,sans-serif" font-size="${fontSize}" fill="${color}" text-anchor="middle">${text}</text></svg>`);
}
async function rotated(png,degrees) {
  if(!degrees) return png;
  // Cocos uses y-up; raster canvas/sharp use y-down.
  return sharp(png).extend({top:24,bottom:24,left:32,right:32,background:'#00000000'})
    .rotate(-degrees,{background:'#00000000'}).png().toBuffer();
}
async function centerOn(png,bg=path.join(ROOT,'assets/resources/textures/terrain/terrain_field.png')) {
  const info=await sharp(png).metadata();
  const base=await sharp(bg).resize(W,H).png().toBuffer();
  if(info.width===W&&info.height===H) return sharp(base).composite([{input:png}]).png().toBuffer();
  const p=await sharp(png).extract({left:Math.floor((info.width-W)/2),top:Math.floor((info.height-H)/2),width:W,height:H}).png().toBuffer();
  return sharp(base).composite([{input:p}]).png().toBuffer();
}
async function makePreviews(rendered,manifest) {
  const composites=new Map();
  for(const kind of ['trench','gun_pit']) for(let m=0;m<64;m++) {
    const t=fortificationArtTransform({kind,connections:flags(m)});
    composites.set(`${kind}:${m}`,await centerOn(await rotated(rendered.get(`${kind}:${t.canonicalMask}`).surface,t.rotationDegrees)));
  }
  const layers=[];
  const examples=[['trench',0,'独立战壕'],['trench',1,'端头'],['trench',9,'直通'],['trench',3,'60° 转弯'],['trench',5,'120° 转弯'],['trench',11,'三向连接'],['gun_pit',0,'独立炮位'],['gun_pit',1,'单口炮位'],['gun_pit',9,'贯通炮位'],['gun_pit',21,'三口炮位']];
  for(let n=0;n<examples.length;n++) {
    const [kind,m,label]=examples[n],left=22+(n%5)*238,top=66+Math.floor(n/5)*300;
    layers.push({input:composites.get(`${kind}:${m}`),left,top});
    layers.push({input:svgText(`${label} · ${flags(m)}`,W),left,top:top+H+4});
  }
  layers.push({input:svgText('战壕与炮位 · 正式透明贴图 / 222 × 256',1228,42,23),left:0,top:8});
  await sharp({create:{width:1228,height:682,channels:4,background:'#303b31'}}).composite(layers).png().toFile(path.join(SOURCE,'asset-sheet.png'));
  for(const kind of ['trench','gun_pit']) {
    const items=[];
    for(let m=0;m<64;m++) {
      const left=16+(m%8)*132,top=45+Math.floor(m/8)*155;
      items.push({input:await sharp(composites.get(`${kind}:${m}`)).resize(111,128).png().toBuffer(),left,top});
      items.push({input:svgText(flags(m),111,22,12),left,top:top+128});
    }
    items.push({input:svgText(`${kind} · 全部 64 种方向配置（实际贴图旋转）`,1080,34,20),left:0,top:2});
    await sharp({create:{width:1080,height:1296,channels:4,background:'#303b31'}}).composite(items).png().toFile(path.join(SOURCE,`${kind}-all-connections.png`));
  }
  const cells=new Map(),offsets=[[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]];
  for(let r=-1;r<=1;r++) for(let q=-2;q<=2;q++) cells.set(`${q},${r}`,{q,r,kind:'trench',mask:0,active:false});
  function connect(a,b) {
    const A=cells.get(a.join(',')),B=cells.get(b.join(','));
    const d=offsets.findIndex(([q,r])=>B.q-A.q===q&&B.r-A.r===r);
    if(d<0) throw Error('Preview cells must be adjacent');
    A.mask|=1<<d;B.mask|=1<<((d+3)%6);A.active=B.active=true;
  }
  const main=[[-2,0],[-1,0],[0,0],[1,0],[2,0]];
  for(let i=1;i<main.length;i++) connect(main[i-1],main[i]);
  connect([0,0],[0,1]); connect([0,1],[-1,1]); connect([1,0],[1,-1]);
  cells.get('1,-1').kind='gun_pit';cells.get('-1,1').kind='gun_pit';
  const ground=[],overlay=[],units=[],foreground=[];
  for(const tile of cells.values()) {
    const left=Math.round(720+W*(tile.q+tile.r/2)-W/2),top=90+(tile.r+1)*192;
    ground.push({input:await sharp(path.join(ROOT,'assets/resources/textures/terrain/terrain_field.png')).resize(W,H).png().toBuffer(),left,top});
    if(!tile.active) continue;
    const tr=fortificationArtTransform({kind:tile.kind,connections:flags(tile.mask)}),art=rendered.get(`${tile.kind}:${tr.canonicalMask}`);
    const surface=await rotated(art.surface,tr.rotationDegrees),edge=await rotated(art.foreground,tr.rotationDegrees),info=await sharp(surface).metadata();
    const at={left:left-Math.floor((info.width-W)/2),top:top-Math.floor((info.height-H)/2)};
    overlay.push({input:surface,...at});foreground.push({input:edge,...at});
    if(tile.kind==='gun_pit') {
      units.push({input:await sharp(path.join(ROOT,'assets/resources/textures/units/pak38_top.png')).resize(146,99).png().toBuffer(),left:left+38,top:top+78});
    } else if(tile.q===-1 && tile.r===0) {
      units.push({input:await sharp(path.join(ROOT,'assets/resources/textures/units/AmericanInfantry01_seated_simple.png')).resize({height:42}).png().toBuffer(),left:left+96,top:top+105});
    }
  }
  const title={input:svgText('实际贴图拼接 · 炮位低土沿，不限定射击方向',1440,48,24),left:0,top:14};
  const map=await sharp({create:{width:1440,height:780,channels:4,background:'#29342c'}}).composite([title,...ground,...overlay,...units,...foreground]).png().toBuffer();
  await fs.promises.writeFile(path.join(SOURCE,'connected-map-preview.png'),map);
  // Typical game's 84x96 tile size, upscaled only to inspect pixels.
  const small=await sharp(map).resize(545,295).png().toBuffer();
  await sharp(small).resize(1090,590,{kernel:'nearest'}).png().toFile(path.join(SOURCE,'map-game-scale-2x.png'));
  await writeConfigurator(rendered,manifest);
}
async function writeConfigurator(rendered,manifest) {
  const images={};
  for(const [key,value] of rendered) images[key]='data:image/png;base64,'+value.surface.toString('base64');
  const grass='data:image/png;base64,'+(await fs.promises.readFile(path.join(ROOT,'assets/resources/textures/terrain/terrain_field.png'))).toString('base64');
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>战壕与炮位资源配置预览</title>
<style>*{box-sizing:border-box}body{margin:0;background:#202c26;color:#eee8d8;font:16px system-ui,"Microsoft YaHei",sans-serif}main{max-width:1000px;margin:40px auto;padding:24px}h1{font-size:26px}p{color:#c1c4b3;line-height:1.8}.layout{display:flex;gap:48px;align-items:center;flex-wrap:wrap}.controls{flex:1;min-width:290px}button,select{font:inherit;padding:10px 14px;margin:5px;border:1px solid #68745d;border-radius:8px;background:#354339;color:#ede6ce;cursor:pointer}button[aria-pressed=true]{background:#9b8956;color:#fff}canvas{max-width:100%;height:auto;background:#29372e;border-radius:14px}pre{padding:18px;background:#15251e;border-radius:10px;white-space:pre-wrap;line-height:1.6}label{display:block;margin:12px 0}</style>
<main><h1>战壕与炮位 · 正式资源配置预览</h1><p>六方向顺序与道路一致：E → SE → SW → W → NW → NE。点击方向切换交通壕出口。炮位没有固定射击口；这些开口表示交通壕连接。</p><div class="layout"><canvas id="preview" width="444" height="512"></canvas><div class="controls"><label>工事类型 <select id="kind"><option value="trench">步兵战壕</option><option value="gun_pit">反坦克炮位</option></select></label><div id="ports"></div><button id="clear">独立工事</button><button id="straight">东西贯通</button><button id="junction">三向连接</button><pre id="config"></pre><p>此页面预览正式 PNG、旋转与美术配置；游戏内请在格子属性配置战壕或炮位。</p></div></div></main>
<script>const manifest=${JSON.stringify(manifest)},sources=${JSON.stringify(images)},grassSrc=${JSON.stringify(grass)};const bg=new Image(),cache={},canvas=document.getElementById('preview'),ctx=canvas.getContext('2d');let mask=9;const kinds=document.getElementById('kind'),ports=document.getElementById('ports');const labels=['东 E','东南 SE','西南 SW','西 W','西北 NW','东北 NE'];for(let d=0;d<6;d++){const b=document.createElement('button');b.textContent=labels[d];b.onclick=()=>{mask^=1<<d;draw()};ports.appendChild(b)}for(const [key,src]of Object.entries(sources)){const im=new Image();im.src=src;im.onload=draw;cache[key]=im}bg.onload=draw;bg.src=grassSrc;function draw(){const v=manifest.variants[mask],kind=kinds.value;ctx.clearRect(0,0,444,512);if(bg.complete)ctx.drawImage(bg,0,0,444,512);const im=cache[kind+':'+v.canonicalMask];if(im?.complete&&im.naturalWidth){ctx.save();ctx.translate(222,256);ctx.rotate(v.rotationSteps*Math.PI/3);ctx.drawImage(im,-222,-256,444,512);ctx.restore()}[...ports.children].forEach((b,d)=>b.setAttribute('aria-pressed',String(!!(mask&(1<<d)))));document.getElementById('config').textContent=JSON.stringify({kind,connections:v.connections},null,2)+'\\n\\n'+kind+'_'+v.canonicalConnections+'_v1.png\\nCocos Z 旋转：'+v.rotationDegrees+'°'}kinds.onchange=draw;document.getElementById('clear').onclick=()=>{mask=0;draw()};document.getElementById('straight').onclick=()=>{mask=9;draw()};document.getElementById('junction').onclick=()=>{mask=21;draw()};draw();</script></html>`;
  fs.writeFileSync(path.join(SOURCE,'configurator.html'),html);
}
async function build() {
  fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(SOURCE,{recursive:true});directoryMeta();
  const scriptMeta=path.join(ROOT,'assets/scripts/core/FortificationArt.ts.meta');
  if(!fs.existsSync(scriptMeta)) saveJson(scriptMeta,{ver:'4.0.24',importer:'typescript',imported:true,uuid:uuid('FortificationArt.ts'),files:[],subMetas:{},userData:{}});
  const mats=await materials(),rendered=new Map(),hashes={};
  for(const kind of ['trench','gun_pit']) for(const mask of FORTIFICATION_ART_MASKS) {
    const art=await render(kind,mask,mats);rendered.set(`${kind}:${mask}`,art);
    for(const [layer,rim]of [['surface',false],['foreground',true]]) {
      const name=filename(kind,mask,rim);await fs.promises.writeFile(path.join(OUT,name),art[layer]);imageMeta(name);
      hashes[name]=crypto.createHash('sha256').update(art[layer]).digest('hex');
    }
  }
  const variants=Array.from({length:64},(_,mask)=>{
    const t=fortificationArtTransform({kind:'trench',connections:flags(mask)});
    return {connections:flags(mask),directions:FORTIFICATION_ART_DIRECTIONS.filter((_,d)=>mask&(1<<d)),canonicalMask:t.canonicalMask,canonicalConnections:t.canonicalFlags,rotationSteps:t.rotationSteps,rotationDegrees:t.rotationDegrees,
      trench:{surface:filename('trench',t.canonicalMask),foreground:filename('trench',t.canonicalMask,true)},
      gun_pit:{surface:filename('gun_pit',t.canonicalMask),foreground:filename('gun_pit',t.canonicalMask,true)}};
  });
  const manifest={version:1,size:[W,H],pivot:[.5,.5],directionOrder:FORTIFICATION_ART_DIRECTIONS,artOnly:true,
    canonicalShapeCountPerKind:14,surfaceCount:28,foregroundCount:28,trenchFloorWidth:HALF*2,pitFloorDiameter:PIT_RADIUS*2,
    mouthBleed:2,unitFacingRestriction:false,canonicalMasks:FORTIFICATION_ART_MASKS,
    note:'Reuse road rotation mapping. 000000 is an isolated earthwork, not absence. Missing configuration means no fortification. Connections are communications trenches, never weapon firing arcs. Draw ground, surface, units, then optional foreground rim. Floor and rim contain no units, grass, text or baked effects.',variants};
  saveJson(path.join(OUT,'fortification_art_manifest.json'),manifest);jsonMeta('fortification_art_manifest.json');
  saveJson(path.join(SOURCE,'checksums.json'),hashes);
  await makePreviews(rendered,manifest);
  console.log(`Exported ${Object.keys(hashes).length} transparent 222x256 PNGs, 128 configurations, Cocos metas and previews.`);
}
if(require.main===module) build().catch(e=>{console.error(e);process.exitCode=1});
module.exports={W,H,HALF,PIT_RADIUS,EDGES,RAYS,flags,geometry,hexInset,render,filename,build};
