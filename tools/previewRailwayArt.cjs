const fs = require('node:fs'), path = require('node:path'), sharp = require('sharp');
const { OUT, SOURCE, flags } = require('./prepareRailwayArt.cjs');
const { RAILWAY_ART_MASKS, railwayArtTransform, railwayHasCrossing } = require('../assets/scripts/core/Railway.ts');
const { directionTo, neighbor } = require('../assets/scripts/core/HexGrid.ts');
const { TerrainGroundRaster } = require('../assets/scripts/view/TerrainGroundRaster.ts');
const ROOT = path.resolve(__dirname, '..');
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/resources/textures/terrain/redesign_v3/materials.json'), 'utf8'));
const raster = new TerrainGroundRaster(bundle.europeanSummer ?? bundle);
const text = (value, x, y, size = 18) => `<text x="${x}" y="${y}" font-size="${size}" font-family="Microsoft YaHei,sans-serif" fill="#e6dfc6">${value}</text>`;
const svg = (width, height, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);
const blank = (width, height) => sharp({ create: { width, height, channels: 4, background: '#293125' } });
const key = p => `${p.q},${p.r}`;
const nameFor = (connections, crossing = false) => {
  const t = railwayArtTransform(connections, crossing);
  return { ...t, file: path.join(OUT, path.basename(t.surface.replace('/spriteFrame', '')) + '.png') };
};
async function placed(connections, crossing, radius) {
  const art = nameFor(connections, crossing);
  const rotated = await sharp(art.file).rotate(-art.rotationDegrees, { background: '#00000000' }).png().toBuffer();
  const m = await sharp(rotated).metadata();
  return sharp(rotated).extract({left:Math.floor((m.width-256)/2),top:Math.floor((m.height-256)/2),width:256,height:256})
    .resize(Math.round(radius*2),Math.round(radius*2)).png().toBuffer();
}
async function ground(tiles, x, y, width, height) {
  const a = raster.renderChunk(tiles, false, x, y, width, height, 1);
  return sharp(a.pixels, { raw: { width: a.textureWidth, height: a.textureHeight, channels: 4 } })
    .extract({ left: 1, top: 1, width, height }).png().toBuffer();
}
async function mapPreview() {
  const tiles = [];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 11; c++) {
    const q = c-Math.floor(r/2);
    const mud = r >= 3 && r <= 4 && c >= 5 && c <= 6;
    tiles.push({ pos: { q, r }, terrain: q===6 ? 'road' : mud ? 'mud' : 'field', ...(q===6 ? { roads: [false,true,false,false,true,false] } : {}) });
  }
  const lut = new Map(tiles.map(t => [key(t.pos),t]));
  const connect = route => {
    for (let i=1;i<route.length;i++) {
      const a = lut.get(key(route[i-1])), b = lut.get(key(route[i]));
      const d = directionTo(a.pos,b.pos);
      for (const [tile,dir] of [[a,d],[b,(d+3)%6]]) {
        const bits = [...(tile.railway??'000000')]; bits[dir]='1'; tile.railway=bits.join('');
      }
    }
  };
  connect([[-2,4],[-1,4],[0,4],[1,4],[2,3],[3,3],[4,3],[5,3],[6,3],[7,3],[8,3]].map(([q,r])=>({q,r})));
  connect([[3,3],[4,2],[5,1],[6,1],[7,1]].map(([q,r])=>({q,r})));
  const width=1030,height=560,x0=-64,y0=-60,scale=1.4;
  const pw=Math.round(width*scale),ph=Math.round(height*scale),layers=[];
  layers.push({input:await sharp(await ground(tiles,x0,y0,width,height)).resize(pw,ph).png().toBuffer(),left:0,top:0});
  let grid='';
  for(const tile of tiles) {
    const x=(Math.sqrt(3)*48*(tile.pos.q+tile.pos.r/2)-x0)*scale,y=(72*tile.pos.r-y0)*scale;
    const points=Array.from({length:6},(_,i)=>{const a=(-90+i*60)*Math.PI/180;return `${x+48*scale*Math.cos(a)},${y+48*scale*Math.sin(a)}`;}).join(' ');
    grid+=`<polygon points="${points}" fill="none" stroke="#eeedc9" stroke-opacity=".15" stroke-width=".7"/>`;
    if(tile.railway) {
      const input=await placed(tile.railway,railwayHasCrossing(tile),48*scale),m=await sharp(input).metadata();
      layers.push({input,left:Math.round(x-m.width/2),top:Math.round(y-m.height/2)});
    }
  }
  layers.push({input:svg(pw,ph,grid),left:0,top:0});
  const image=await blank(pw,ph).composite(layers).png().toBuffer();
  await blank(1536,ph+124).composite([
    {input:svg(1536,100,text('铁路覆盖 · 实际导出素材预览',35,42,28)+text('田野 / 泥地 / 道路平交 · 木枕、钢轨、碎石道床 · 六向连接 / 弯轨 / 道岔 / 尽头',35,78,17)),left:0,top:0},
    {input:image,left:Math.round((1536-pw)/2),top:100},
  ]).png().toFile(path.join(SOURCE,'railway-map-preview.png'));
  fs.writeFileSync(path.join(SOURCE,'preview-layout.json'),JSON.stringify(tiles,null,2)+'\n');
  const demoTiles=Array.from({length:7},()=>Array(11).fill(null));
  for(const tile of tiles)demoTiles[tile.pos.r][tile.pos.q+Math.floor(tile.pos.r/2)]={
    t:tile.terrain==='road'?'r':tile.terrain==='mud'?'m':'f',
    ...(tile.roads?{rd:tile.roads.map(b=>b?'1':'0').join('')} : {}),
    ...(tile.railway?{rl:tile.railway} : {}),
  };
  const demo={schemaVersion:2,editorVersion:'railway-v1',savedAt:0,source:'developer',turnEndEvents:[],mission:{
    id:'railway-art-demo',name:'铁路素材展示',description:'铁路覆盖田野、泥地、道路。展示弯轨、道岔、平交道口与尽头。火车规则待补充。',
    theater:'europe',cols:11,rows:7,tiles:demoTiles,sherman:{kind:'sherman',at:{row:6,col:1},facing:0},
    enemies:[{kind:'infantry',at:{row:0,col:9},facing:3}],objective:{type:'destroy_all_enemies'},
  }};
  fs.writeFileSync(path.join(SOURCE,'railway-demo-mission.json'),JSON.stringify(demo,null,2)+'\n');
}
async function assetSheet() {
  const layers=[],width=1470,height=880;
  let labels=text('铁路素材 · 13 类连接 × 普通 / 平交',24,40,27)+text('256 × 256 RGBA；中心锚点；旋转后覆盖全部 63 种非空连接。',24,70,17);
  for(let i=0;i<RAILWAY_ART_MASKS.length;i++) for(const [j,crossing]of[false,true].entries()) {
    const mask=RAILWAY_ART_MASKS[i],left=24+(i%7)*205,top=100+Math.floor(i/7)*190+j*390;
    const a=nameFor(flags(mask),crossing);
    layers.push({input:await sharp(a.file).resize(170,170).png().toBuffer(),left,top});
    labels+=text(`${flags(mask)}${crossing?' · 平交':''}`,left+28,top+180,14);
  }
  await blank(width,height).composite([{input:svg(width,height,labels),left:0,top:0},...layers]).png().toFile(path.join(SOURCE,'railway-assets-preview.png'));
}
async function smallScale() {
  const width=1240,height=450,layers=[];
  let labels=text('铁路覆盖 · 小尺寸辨识度',24,38,25);
  for(const [i,terrain]of['field','road','mud'].entries()) {
    const tiles=[];for(let r=-2;r<=2;r++)for(let q=-2;q<=2;q++)tiles.push({pos:{q,r},terrain, ...(terrain==='road'?{roads:[false,true,false,false,true,false]}:{})});
    const base=await ground(tiles,-90,-90,180,180);
    const rail=await placed('100100',terrain==='road',48),m=await sharp(rail).metadata();
    const full=await sharp(base).composite([{input:rail,left:Math.round(90-m.width/2),top:Math.round(90-m.height/2)}]).png().toBuffer();
    const left=24+i*410;
    layers.push({input:full,left,top:100});
    layers.push({input:await sharp(full).resize(90,90).png().toBuffer(),left:left+210,top:145});
    labels+=text(['田野：沿用田野规则','道路：沿用道路规则','泥地：沿用泥地规则'][i],left,80,19)+text('正常尺寸',left+46,310,16)+text('缩小 50%',left+212,270,16);
  }
  labels+=text('预览使用项目地面合成器与正式 PNG，未实现火车行为。',24,403,17);
  await blank(width,height).composite([{input:svg(width,height,labels),left:0,top:0},...layers]).png().toFile(path.join(SOURCE,'railway-small-scale-preview.png'));
}
async function configurator() {
  const data={};
  for(const mask of RAILWAY_ART_MASKS) for(const crossing of[false,true]) {
    const a=nameFor(flags(mask),crossing);data[`${mask}:${crossing}`]='data:image/png;base64,'+fs.readFileSync(a.file).toString('base64');
  }
  const bases={};
  for(const terrain of['field','road','mud']) {
    const tiles=[];for(let r=-2;r<=2;r++)for(let q=-2;q<=2;q++)tiles.push({pos:{q,r},terrain,...(terrain==='road'?{roads:[false,true,false,false,true,false]}:{})});
    bases[terrain]='data:image/png;base64,'+(await ground(tiles,-128,-128,256,256)).toString('base64');
  }
  const variants=Array.from({length:63},(_,i)=>railwayArtTransform(flags(i+1)));
  fs.writeFileSync(path.join(SOURCE,'configurator.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>铁路素材预览</title><style>body{background:#252e22;color:#e8e3cf;font:16px system-ui;max-width:850px;margin:32px auto}button,select{font:inherit;padding:8px;margin:4px;background:#404c35;color:inherit;border:1px solid #899176;border-radius:5px}button.on{background:#758255}#tile{width:384px;height:384px;position:relative;margin:25px auto}#tile img{position:absolute;inset:0;width:100%;height:100%}p{line-height:1.7}#dirs{text-align:center}</style><h1>铁路 · 六向连接预览</h1><p>铁路保留田野、道路、泥地的原有规则；火车规则待补充。</p><label>基底 <select id="base"><option value="field">田野</option><option value="road">道路平交</option><option value="mud">泥地</option></select></label><label>尺寸 <select id="zoom"><option>96</option><option>192</option><option selected>384</option></select> px</label><div id="dirs"></div><div id="tile"><img id="ground" alt="原地形"><img id="rail" alt="铁路"></div><p id="info"></p><script>
const images=${JSON.stringify(data)},bases=${JSON.stringify(bases)},variants=${JSON.stringify(variants)};
let mask=9;const names=['东 E','东南 SE','西南 SW','西 W','西北 NW','东北 NE'];
const buttons=names.map((name,d)=>{const b=document.createElement('button');b.textContent=name;b.onclick=()=>{mask^=1<<d;draw()};document.querySelector('#dirs').append(b);return b});
function draw(){const base=document.querySelector('#base').value,z=Number(document.querySelector('#zoom').value),view=document.querySelector('#tile');view.style.width=view.style.height=z+'px';document.querySelector('#ground').src=bases[base];buttons.forEach((b,d)=>b.classList.toggle('on',!!(mask&(1<<d))));const img=document.querySelector('#rail');img.style.display=mask?'block':'none';if(mask){const v=variants[mask-1],crossing=base==='road'&&[1,4].some(d=>!(mask&(1<<d)));img.src=images[v.canonicalMask+':'+crossing];img.style.transform='rotate('+(-v.rotationDegrees)+'deg)'}document.querySelector('#info').textContent='连接：'+names.map((_,d)=>(mask>>d)&1).join('')+' · 顺序 E / SE / SW / W / NW / NE'}
document.querySelector('#base').onchange=document.querySelector('#zoom').onchange=draw;draw();</script></html>`);
}
async function main(){await mapPreview();await assetSheet();await smallScale();await configurator();console.log('Railway map, asset sheet, small-scale preview and standalone configurator saved.');}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
