// Whole-object painted sprites; geometry is used for registration and shared ports only.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const legacy = require('./prepareFortificationArt.cjs');
const { W, H, HALF, RAYS, flags, geometry, hexInset, filename } = legacy;
const { FORTIFICATION_ART_MASKS } = require('../assets/scripts/core/FortificationArt.ts');
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'source_art/terrain/fortifications-v2-20261102');
const CELL_W = 270, CELL_H = 300, PAD_X = 24, PAD_Y = 22;
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = x => { const t=clamp(x); return t*t*(3-2*t); };
const mix = (a,b,t) => a+(b-a)*t;

function nearest(data,width,height,x,y) {
  x=Math.round(x); y=Math.round(y);
  if(x<0||x>=width||y<0||y>=height) return [0,0,0,0];
  const i=(y*width+x)*4;
  return [data[i],data[i+1],data[i+2],data[i+3]];
}
function sample(tile,x,y,pose=tile.pose) {
  const sx=(x-W/2)/pose.scale+W/2+PAD_X+pose.dx;
  const sy=(y-H/2)/pose.scale+H/2+PAD_Y+pose.dy;
  return bilinear(tile.data,CELL_W,CELL_H,sx,sy);
}
function bilinear(data,width,height,sx,sy) {
  const x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0;
  const samples=[nearest(data,width,height,x0,y0),nearest(data,width,height,x0+1,y0),
    nearest(data,width,height,x0,y0+1),nearest(data,width,height,x0+1,y0+1)];
  const weights=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy];
  const alpha=samples.reduce((a,p,i)=>a+p[3]*weights[i],0);
  // Premultiplied sampling avoids the generated image's RGB in transparent pixels.
  return [0,1,2].map(c=>alpha?samples.reduce((a,p,i)=>a+p[c]*p[3]*weights[i],0)/alpha:0).concat(alpha);
}
function register(tile,target) {
  const probes=[];
  for(let y=2;y<H;y+=4) for(let x=2;x<W;x+=4) {
    const i=(y*W+x)*4;
    probes.push([x-W/2,y-H/2,target[i+3]/255]);
  }
  const score=p=>{
    let sum=0;
    for(const [x,y,a] of probes) {
      const sx=Math.round(x/p.scale+W/2+PAD_X+p.dx),sy=Math.round(y/p.scale+H/2+PAD_Y+p.dy);
      const b=sx>=0&&sx<CELL_W&&sy>=0&&sy<CELL_H?tile.data[(sy*CELL_W+sx)*4+3]/255:0;
      sum+=(a-b)**2;
    }
    return sum;
  };
  let best={scale:1,dx:0,dy:0},minimum=Infinity;
  for(let scale=.78;scale<=1.12;scale+=.04) for(let dx=-12;dx<=12;dx+=4) for(let dy=-12;dy<=12;dy+=4) {
    const p={scale,dx,dy},s=score(p);if(s<minimum){minimum=s;best=p;}
  }
  const coarse=best;
  for(let ds=-3;ds<=3;ds++) for(let dx=-3;dx<=3;dx++) for(let dy=-3;dy<=3;dy++) {
    const p={scale:coarse.scale+ds*.01,dx:coarse.dx+dx,dy:coarse.dy+dy},s=score(p);
    if(s<minimum){minimum=s;best=p;}
  }
  tile.pose={scale:Number(best.scale.toFixed(3)),dx:best.dx,dy:best.dy};
  return tile;
}
async function loadTiles() {
  const tiles=new Map();
  for(const kind of ['trench','gun_pit']) {
    const atlas=await sharp(path.join(SOURCE,'sources',`${kind}-painted-atlas.png`))
      .resize(CELL_W*4,CELL_H*4,{fit:'fill'}).ensureAlpha().raw().toBuffer();
    for(let n=0;n<FORTIFICATION_ART_MASKS.length;n++) {
      const mask=FORTIFICATION_ART_MASKS[n],data=Buffer.alloc(CELL_W*CELL_H*4);
      for(let y=0;y<CELL_H;y++) {
        const start=((Math.floor(n/4)*CELL_H+y)*CELL_W*4+(n%4)*CELL_W)*4;
        atlas.copy(data,y*CELL_W*4,start,start+CELL_W*4);
      }
      const target=await sharp(path.join(SOURCE,'before',filename(kind,mask))).ensureAlpha().raw().toBuffer();
      tiles.set(`${kind}:${mask}`,register({data},target));
    }
  }
  tiles.connector=await sharp(path.join(SOURCE,'sources','trench-connector-painted.png'))
    .resize(1024,512,{fit:'fill'}).ensureAlpha().raw().toBuffer();
  return tiles;
}
function mouthProfile(connector,v,inset) {
  // A full painted patch keeps the soil clods and floor texture at tile joins.
  // Only the last few pixels are symmetric, so opposing ports match exactly.
  const absolute=Math.abs(v),d=absolute-HALF;
  if(d>=17) return [0,0,0,0];
  const x=400+Math.max(0,inset)*2.72;
  const a=bilinear(connector,1024,512,x,256+absolute*2.72),b=bilinear(connector,1024,512,x,256-absolute*2.72);
  const detail=bilinear(connector,1024,512,x,256+v*2.72),t=smooth((inset-1)/6);
  const wall=smooth((absolute-12)/6),floorTone=[.85,.88,.98],wallTone=[.96,1.02,1.35];
  const alpha=mix((a[3]+b[3])/2,detail[3],t);
  return [0,1,2].map(c=>Math.min(255,mix((a[c]+b[c])/2,detail[c],t)*mix(floorTone[c],wallTone[c],wall)))
    .concat(Math.min(alpha>245?255:alpha,255*clamp((17-d)/2)));
}
function makeRenderer(tiles) {
  const connector=tiles.connector;
  return async (kind,mask)=>{
    const tile=tiles.get(`${kind}:${mask}`),{sdf}=geometry(kind,mask);
    const width=W*2,height=H*2,data=Buffer.alloc(width*height*4),rim=Buffer.alloc(data.length);
    for(let yy=0;yy<height;yy++) for(let xx=0;xx<width;xx++) {
      const x=(xx+.5)/2,y=(yy+.5)/2,lx=x-W/2,ly=y-H/2,inset=hexInset(x,y);
      if(inset < -2) continue;
      const distance=sdf(lx,ly);
      let color=sample(tile,x,y);
      // Discard stray low-alpha paint; keep the painted irregular contour itself.
      color[3]*=smooth((color[3]-10)/25)*smooth((27-distance)/7);
      if(color[3]>245) color[3]=255;
      if(mask && inset<24) for(let d=0;d<6;d++) {
        if(!(mask&(1<<d))) continue;
        const [ux,uy]=RAYS[d],u=lx*ux+ly*uy,v=-lx*uy+ly*ux;
        if(u<75||Math.abs(v)>39) continue;
        const t=1-smooth((inset-13)/11),port=mouthProfile(connector,v,inset);
        const alpha=mix(color[3],port[3],t);
        color=[0,1,2].map(c=>alpha?mix(color[c]*color[3],port[c]*port[3],t)/alpha:0).concat(alpha);
      }
      const i=(yy*width+xx)*4;
      const brightness=color[0]*.299+color[1]*.587+color[2]*.114;
      // The foreground follows painted wall/sandbag masses, not a new outline.
      const wall=smooth((distance-1)/3);
      const bag=smooth((brightness-115)/35)*smooth((distance+10)/5);
      const foreground=Math.max(wall,bag);
      for(let c=0;c<3;c++) data[i+c]=rim[i+c]=Math.round(color[c]);
      data[i+3]=Math.round(color[3]);rim[i+3]=Math.round(color[3]*foreground);
    }
    const encode=raw=>sharp(raw,{raw:{width,height,channels:4}}).resize(W,H).png().toBuffer();
    return {surface:await encode(data),foreground:await encode(rim)};
  };
}
async function comparisons() {
  const rows=[];
  for(const [i,label] of ['原版 V1','优化 V2'].entries()) {
    const file=path.join(SOURCE,i===0?'before/connected-map-preview.png':'connected-map-preview.png');
    const map=await sharp(file).extract({left:85,top:80,width:1260,height:680}).resize(1008,544).png().toBuffer();
    rows.push({input:map,left:0,top:46+i*590});
    rows.push({input:Buffer.from(`<svg width="1008" height="38"><text x="24" y="28" font-family="Microsoft YaHei,Arial" font-size="23" fill="#eee0bc">${label} · 相同地面、相同单位、正式贴图拼接</text></svg>`),left:0,top:8+i*590});
  }
  await sharp({create:{width:1008,height:1180,channels:4,background:'#29342c'}}).composite(rows).png().toFile(path.join(SOURCE,'before-after.png'));
}
async function build() {
  const tiles=await loadTiles();
  fs.writeFileSync(path.join(SOURCE,'registration.json'),JSON.stringify(Object.fromEntries([...tiles].map(([k,v])=>[k,v.pose])),null,2)+'\n');
  await legacy.build({sourceDir:SOURCE,renderArt:makeRenderer(tiles),artRevision:2});
  await comparisons();
}
module.exports={build,loadTiles,makeRenderer};
if(require.main===module) build().catch(e=>{console.error(e);process.exitCode=1});
