/* Independent art-review renderer. It never writes to assets/ or game code.
 * Raster art comes from sources/*.png. Geometry, masks and compositing are
 * native rendering operations, not substitutes for the painted source art.
 */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const ROOT = __dirname;
const SOURCE = path.join(ROOT, 'sources');
const OUT = path.join(ROOT, 'exports');
const W = 222, H = 256, S = 128, SQ = Math.sqrt(3);
const TEX_SIZE = 384;
const GAME = path.resolve(ROOT, '../../../..');
const normals = Array.from({length:6}, (_,i)=>[Math.cos(i*Math.PI/3),Math.sin(i*Math.PI/3)]);
const directions = [[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]];
const TERRAIN = {
  road:['公路','grass'], field:['草地','grass'], mud:['泥地','mud'],
  forest:['森林','grass'], water:['浅水','water'], deep_water:['深水','deep_water'],
  clear:['开阔地','sand'], trees:['热带树林','grass'], beach:['海滩','sand'],
  rocky:['岩地','soil'], airstrip:['机场跑道','sand'],
  urban_ground:['城市地面','paving'], urban_road:['城市道路','paving'],
  urban_indestructible:['坚固建筑','paving'], urban_destructible:['可毁建筑','paving'],
  urban_rubble:['建筑废墟','paving'],
};
const materialIds = ['grass','soil','mud','sand','water','deep_water','paving','snow','winter_water','timber'];
const objectIds = ['tree_deciduous','tree_palm','rocks','building_solid','building_intact','building_damaged','building_rubble'];
const textures = {}, objects = {};
const clamp = (x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth = (a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const key=(q,r)=>`${q},${r}`;
const flags=m=>Array.from({length:6},(_,i)=>(m>>i)&1).join('');
const rotateMask=(m,s)=>s?((m<<s)|(m>>(6-s)))&63:m;
const canonicalMasks=[...new Set(Array.from({length:63},(_,i)=>Math.min(...Array.from({length:6},(_,s)=>rotateMask(i+1,s)))))].sort((a,b)=>a-b);
const pixel=(q,r,size)=>[SQ*size*(q+r/2),1.5*size*r];
function hexDistance(x,y,t,size) {
  const dx=x-t.x,dy=y-t.y;
  return Math.max(...normals.map(n=>dx*n[0]+dy*n[1]))-SQ*size/2;
}
function noise(x,y) {
  // Shared world-space signal: every incident tile uses the same displacement.
  return Math.sin(x*.055+y*.016)*.47+Math.sin(x*.022-y*.068)*.32+Math.sin(x*.113+y*.091)*.21;
}
function reflected(n,len) {
  const p=((Math.floor(n)%(len*2))+len*2)%(len*2);
  return p<len?p:len*2-p-1;
}
function sample(id,x,y) {
  const a=textures[id],i=(reflected(y,TEX_SIZE)*TEX_SIZE+reflected(x,TEX_SIZE))*4;
  return [a[i],a[i+1],a[i+2]];
}
function cubeRound(x,y,size) {
  const r=y/(1.5*size),q=x/(SQ*size)-r/2;
  let a=Math.round(q),b=Math.round(r),c=Math.round(-q-r);
  const da=Math.abs(a-q),db=Math.abs(b-r),dc=Math.abs(c+q+r);
  if(da>db&&da>dc)a=-b-c;else if(db>dc)b=-a-c;
  return [a,b];
}
function rawImage(data,width,height) {return sharp(data,{raw:{width,height,channels:4}});}
async function writeRaw(data,width,height,file) {
  await rawImage(data,width,height).png().toFile(file);
}
function materialFor(t,winter) {
  const mat=TERRAIN[t.terrain]?.[1]??'grass';
  if(winter&&(mat==='water'||mat==='deep_water'))return 'winter_water';
  return mat;
}
function seasonalSample(mat,wx,wy,winter) {
  let c=sample(mat,wx,wy);
  if(winter&&!['winter_water','water','deep_water'].includes(mat)) {
    const coverage=mat==='mud'?.27:mat==='paving'?.38:.76;
    const cover=smooth(-.035,.035,noise(wx*.6,wy*.6)+coverage-.44);
    c=mix(c,sample('snow',wx,wy),cover);
  }
  return c;
}
function boxBlur(input,width,height,radius) {
  let src=input;
  for(let pass=0;pass<3;pass++) {
    const tmp=new Float32Array(src.length),out=new Float32Array(src.length),span=radius*2+1;
    for(let y=0;y<height;y++) {
      const row=y*width;let sum=0;
      for(let k=-radius;k<=radius;k++)sum+=src[row+clamp(k,0,width-1)];
      for(let x=0;x<width;x++){tmp[row+x]=sum/span;sum+=src[row+clamp(x+radius+1,0,width-1)]-src[row+clamp(x-radius,0,width-1)];}
    }
    for(let x=0;x<width;x++) {
      let sum=0;for(let k=-radius;k<=radius;k++)sum+=tmp[clamp(k,0,height-1)*width+x];
      for(let y=0;y<height;y++){out[y*width+x]=sum/span;sum+=tmp[clamp(y+radius+1,0,height-1)*width+x]-tmp[clamp(y-radius,0,height-1)*width+x];}
    }
    src=out;
  }
  return src;
}
function buildFields(l,lut,size,winter) {
  const fields=new Map([...new Set(l.tiles.map(t=>materialFor(t,winter)))].map(m=>[m,new Float32Array(l.width*l.height)]));
  for(let y=0;y<l.height;y++)for(let x=0;x<l.width;x++) {
    const [q,r]=cubeRound(x+.5-l.offsetX,y+.5-l.offsetY,size);
    let t=lut.get(key(q,r));
    if(!t) {
      const near=directions.map(([dq,dr])=>lut.get(key(q+dq,r+dr))).filter(Boolean);
      if(near.length)t=near.reduce((a,b)=>hexDistance(x,y,a,size)<hexDistance(x,y,b,size)?a:b);
    }
    if(t)fields.get(materialFor(t,winter))[y*l.width+x]=1;
  }
  for(const [m,a]of fields)fields.set(m,boxBlur(a,l.width,l.height,Math.max(2,Math.round(size*.14))));
  return {...l,fields};
}
function fieldAt(a,x,y,width,height) {
  x=clamp(x,0,width-1);y=clamp(y,0,height-1);
  const ix=Math.floor(x),iy=Math.floor(y),jx=Math.min(ix+1,width-1),jy=Math.min(iy+1,height-1),u=x-ix,v=y-iy;
  return a[iy*width+ix]*(1-u)*(1-v)+a[iy*width+jx]*u*(1-v)+a[jy*width+ix]*(1-u)*v+a[jy*width+jx]*u*v;
}
function groundPixel(x,y,near,size,winter,transition=true,fieldMap=null) {
  const wx=x-fieldMap.offsetX,wy=y-fieldMap.offsetY;
  if(!transition) {
    const nearest=near.reduce((best,t)=>hexDistance(x,y,t,size)<hexDistance(x,y,best,size)?t:best);
    return seasonalSample(materialFor(nearest,winter),wx,wy,winter);
  }
  const warpedX=x-.5+noise(wx*.82+38,wy*.9)*size*.19;
  const warpedY=y-.5+noise(wx*.83-17,wy*.84+53)*size*.19;
  let weights=[...fieldMap.fields].map(([mat,a])=>[mat,fieldAt(a,warpedX,warpedY,fieldMap.width,fieldMap.height)]).filter(([,w])=>w>.00001);
  const waterIds=['water','deep_water','winter_water'];
  const originalSum=weights.reduce((a,p)=>a+p[1],0)||1;
  weights=weights.map(([m,w])=>[m,w/originalSum]);
  const waterWeight=weights.filter(([m])=>waterIds.includes(m)).reduce((a,p)=>a+p[1],0);
  const hasWater=waterWeight>.0001,hasLand=waterWeight<.9999;
  const waterAlpha=smooth(.30,.70,waterWeight);
  if(hasWater&&hasLand)weights=weights.map(([m,w])=>[m,waterIds.includes(m)?w/waterWeight*waterAlpha:w/(1-waterWeight)*(1-waterAlpha)]);
  const sum=weights.reduce((v,p)=>v+p[1],0)||1;
  let color=[0,0,0];
  for(const [mat,w]of weights) {
    const c=seasonalSample(mat,wx,wy,winter);
    for(let k=0;k<3;k++)color[k]+=c[k]*w/(sum||1);
  }
  if(hasWater&&hasLand) {
    const bank=4*waterAlpha*(1-waterAlpha)*.88;
    color=mix(color,sample(winter?'snow':'sand',wx,wy),bank);
    const contact=(1-smooth(.045,.10,Math.abs(waterAlpha-.83)))*.12;
    color=color.map(v=>v*(1-contact));
  }
  return color;
}
function segmentDistance(x,y,a,b) {
  const dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;
  const t=den?clamp(((x-a[0])*dx+(y-a[1])*dy)/den):0;
  return Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t);
}
function roadDistance(x,y,mask,size) {
  if(!mask)return Infinity;
  const apothem=SQ*size/2;
  return Math.min(...normals.filter((_,i)=>(mask>>i)&1).map(n=>segmentDistance(x,y,[0,0],[n[0]*(apothem+size*.08),n[1]*(apothem+size*.08)])));
}
function roadPixel(x,y,t,size,winter=false,urban=false) {
  const d=roadDistance(x-t.x,y-t.y,t.roads,size);
  const half=size*(urban?.195:.185);
  const alpha=1-smooth(half-size*.006,half+size*.034,d);
  const wx=x-(t.sampleOffsetX??0),wy=y-(t.sampleOffsetY??0);
  let c=sample(urban?'paving':'soil',wx,wy);
  if(urban)c=c.map(v=>v*.76);
  if(winter)c=mix(c,sample('snow',wx,wy),.18);
  const edge=smooth(half*.84,half,d)*.18;
  c=c.map(v=>v*(1-edge));
  return [c,alpha];
}
function bridgePixel(x,y,t,size,winter=false) {
  const angle=(t.bridgeAxis??0)*Math.PI/3;
  const dx=x-t.x,dy=y-t.y;
  const u=dx*Math.cos(angle)+dy*Math.sin(angle),v=-dx*Math.sin(angle)+dy*Math.cos(angle);
  const width=size*.205,extent=SQ*size/2+size*.08;
  if(Math.abs(u)>extent||Math.abs(v)>width+size*.028)return null;
  const rail=Math.abs(v)>width-size*.027;
  let c=sample('timber',u*2,v*2);
  if(rail)c=[78,70,52];
  else if(Math.abs(u%(size*.13))<size*.009)c=c.map(a=>a*.68);
  if(winter&&!rail)c=mix(c,sample('snow',x,y),.22);
  return [c,1];
}
function layout(tiles,size,margin=18) {
  const positioned=tiles.map(t=>{const [x,y]=pixel(t.q,t.r,size);return {...t,x,y};});
  const minX=Math.min(...positioned.map(t=>t.x-SQ*size/2));
  const minY=Math.min(...positioned.map(t=>t.y-size));
  const maxX=Math.max(...positioned.map(t=>t.x+SQ*size/2));
  const maxY=Math.max(...positioned.map(t=>t.y+size));
  for(const t of positioned){t.x+=margin-minX;t.y+=margin-minY;}
  return {tiles:positioned,width:Math.ceil(maxX-minX+margin*2),height:Math.ceil(maxY-minY+margin*2),offsetX:margin-minX,offsetY:margin-minY};
}
function rasterMap(tiles,size,{winter=false,transition=true,margin=18}={}) {
  const l=layout(tiles,size,margin),lut=new Map(l.tiles.map(t=>[key(t.q,t.r),t]));
  for(const t of l.tiles){t.sampleOffsetX=l.offsetX;t.sampleOffsetY=l.offsetY;}
  const fieldMap=transition?buildFields(l,lut,size,winter):l;
  const data=Buffer.alloc(l.width*l.height*4);
  for(let y=0;y<l.height;y++)for(let x=0;x<l.width;x++) {
    const [q,r]=cubeRound(x+.5-l.offsetX,y+.5-l.offsetY,size);
    const primary=lut.get(key(q,r));
    const near=[primary,...directions.map(([dq,dr])=>lut.get(key(q+dq,r+dr)))].filter(Boolean);
    if(!near.length)continue;
    const inside=primary?-1:near.reduce((d,t)=>Math.min(d,hexDistance(x+.5,y+.5,t,size)),Infinity);
    if(inside>.6)continue;
    let c=groundPixel(x+.5,y+.5,near,size,winter,transition,fieldMap);
    let overlay=null,roadTile=null;
    if(primary?.bridgeAxis!=null)overlay=bridgePixel(x+.5,y+.5,primary,size,winter);
    else {
      const candidates=near.filter(t=>t.roads&&t.bridgeAxis==null);
      for(const t of candidates){const a=roadPixel(x+.5,y+.5,t,size,winter,t.terrain==='urban_road');if(!overlay||a[1]>overlay[1]){overlay=a;roadTile=t;}}
      if(roadTile&&fieldMap.fields?.has('paving')) {
        const wx=x+.5-l.offsetX,wy=y+.5-l.offsetY;
        const fx=x+noise(wx*.82+38,wy*.9)*size*.19,fy=y+noise(wx*.83-17,wy*.84+53)*size*.19;
        const urbanMix=smooth(.08,.92,fieldAt(fieldMap.fields.get('paving'),fx,fy,l.width,l.height));
        const rural=roadPixel(x+.5,y+.5,roadTile,size,winter,false)[0],urban=roadPixel(x+.5,y+.5,roadTile,size,winter,true)[0];
        overlay[0]=mix(rural,urban,urbanMix);
      }
    }
    if(overlay)c=mix(c,overlay[0],overlay[1]);
    const idx=(y*l.width+x)*4;
    data[idx]=Math.round(c[0]);data[idx+1]=Math.round(c[1]);data[idx+2]=Math.round(c[2]);
    // Interior shared edges belong to the union, not to an antialiased cutout.
    // Antialiasing every individual hex would create translucent hairline seams.
    data[idx+3]=primary?255:Math.round(clamp(.6-inside)*255);
  }
  return {...l,data,size,winter};
}
async function sprite(id,width,height,winter=false) {
  const cacheKey=`${id}-${width}-${height}-${winter}`;
  if(objects[cacheKey])return objects[cacheKey];
  let a=sharp(objects[id]).resize(width,height,{fit:'inside'});
  if(winter&&id.startsWith('tree_')) {
    const {data,info}=await a.ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++) {
      const i=(y*info.width+x)*4;
      const frost=smooth(.05,.6,noise(x*2+18,y*2+7))*.72;
      if(data[i+3])for(let k=0;k<3;k++)data[i+k]=Math.round(data[i+k]*(1-frost)+[216,220,207][k]*frost);
    }
    a=rawImage(data,info.width,info.height);
  }
  const result=await a.png().toBuffer();objects[cacheKey]=result;return result;
}
async function objectLayers(map,{tanks=false}={}) {
  const layers=[],s=map.size;
  async function add(id,t,dx,dy,scale=1,winter=map.winter) {
    const building=id.startsWith('building');
    const w=Math.round(s*(building?1.0:id==='tree_palm'?.67:id==='rocks'?.7:.58)*scale);
    const h=Math.round(s*(building?.81:id==='tree_palm'?.67:id==='rocks'?.56:.58)*scale);
    const input=await sprite(id,w,h,winter);
    const meta=await sharp(input).metadata();
    const left=Math.round(t.x+dx*s-meta.width/2),top=Math.round(t.y+dy*s-meta.height/2);
    if(left>=0&&top>=0&&left+meta.width<=map.width&&top+meta.height<=map.height)layers.push({input,left,top});
  }
  for(const t of map.tiles) {
    if(t.terrain==='forest') {
      for(const [x,y,scale]of [[-.34,-.3,1.12],[.32,-.25,.97],[-.35,.36,.89],[.30,.31,1.15]])await add('tree_deciduous',t,x,y,scale);
    }
    if(t.terrain==='trees')for(const [x,y,scale]of [[-.30,-.24,1.05],[.28,.27,.92]])await add('tree_palm',t,x,y,scale,false);
    if(t.terrain==='rocky') {await add('rocks',t,-.20,-.25,1.13,false);await add('rocks',t,.25,.31,.77,false);}
    if(t.terrain==='urban_indestructible')await add('building_solid',t,0,0,1,false);
    if(t.terrain==='urban_destructible') {
      await add(t.damaged?'building_damaged':'building_intact',t,-.22,-.25,.8,false);
      await add('building_intact',t,.27,.27,.72,false);
    }
    if(t.terrain==='urban_rubble')await add('building_rubble',t,0,0,1.06,false);
    if(t.hedge)for(let i=0;i<4;i++)await add('tree_deciduous',t,.66,-.45+i*.3,.58);
  }
  if(tanks) {
    const db=fs.readFileSync(path.join(GAME,'assets/scripts/core/TankVisualDB.ts'),'utf8');
    const cfg=db.match(/const SPLIT_TANK_VISUAL_CONFIG[\s\S]*?sherman:\s*\{([^}]+)\}/)?.[1];
    if(!cfg)throw Error('Cannot read current Sherman visual configuration');
    const num=name=>{const m=cfg.match(new RegExp(name+':\\s*(-?[0-9.]+)'));if(!m)throw Error('Missing Sherman '+name);return Number(m[1]);};
    const scale=s*1.8*num('hullFitScale')/100,turretScale=scale*num('turretScale');
    const hull=await sharp(path.join(GAME,'assets/resources/textures/units/sherman_top_hull.png')).resize(Math.round(100*scale),Math.round(44*scale)).png().toBuffer();
    const turret=await sharp(path.join(GAME,'assets/resources/textures/units/sherman_top_turret.png')).resize(Math.round(52*turretScale),Math.round(29*turretScale)).png().toBuffer();
    const hullMeta=await sharp(hull).metadata();
    for(const index of [map.tiles.findIndex(t=>t.terrain==='road'&&t.col===2),map.tiles.findIndex(t=>t.terrain==='field'&&t.row===5&&t.col===2)]) {
      if(index<0)continue;const t=map.tiles[index];
      // Left-facing unit; same hull fit and turret scale as the current game.
      layers.push({input:hull,left:Math.round(t.x-hullMeta.width/2),top:Math.round(t.y-hullMeta.height/2)});
      const pivotX=t.x+(48-50)*scale-num('turretOffsetForward')*s*SQ;
      const pivotY=t.y+(21-22)*scale-num('turretOffsetRight')*s*SQ;
      layers.push({input:turret,left:Math.round(pivotX-35*turretScale),top:Math.round(pivotY-14*turretScale)});
    }
  }
  return layers;
}
function hexSvg(map,{grid=true,labels=false}={}) {
  let content='';
  for(const t of map.tiles) {
    const points=Array.from({length:6},(_,i)=>{const a=(-90+i*60)*Math.PI/180;return `${(t.x+Math.cos(a)*map.size).toFixed(2)},${(t.y+Math.sin(a)*map.size).toFixed(2)}`;}).join(' ');
    if(grid)content+=`<polygon points="${points}" fill="none" stroke="#393b2d" stroke-opacity=".25" stroke-width=".7"/>`;
    if(labels)content+=`<text x="${t.x}" y="${t.y+map.size*.70}" text-anchor="middle" fill="#262a22" font-size="${Math.round(map.size*.15)}" font-family="Microsoft YaHei">${TERRAIN[t.terrain][0]}</text>`;
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${map.width}" height="${map.height}">${content}</svg>`);
}
async function composeMap(map,file,{grid=true,tanks=false,labels=false}={}) {
  const layers=await objectLayers(map,{tanks});
  if(grid||labels)layers.push({input:hexSvg(map,{grid,labels}),left:0,top:0});
  const image=await rawImage(map.data,map.width,map.height).composite(layers).png().toBuffer();
  if(file)fs.writeFileSync(file,image);
  return image;
}
function europeMap() {
  const tiles=[];
  for(let row=0;row<7;row++)for(let col=0;col<11;col++) {
    const q=col-Math.floor(row/2),r=row;
    let terrain='field';
    const river=row>=5?4:5;
    if(col===river)terrain=row===6?'deep_water':'water';
    if(row<=2&&col<=2&&!(row===2&&col===0))terrain='forest';
    if(row>=4&&col===3)terrain='mud';
    if(col>=7&&row<=4)terrain='urban_ground';
    if(row===3&&col!==river)terrain=col>=7?'urban_road':'road';
    if(col===8+Math.floor(row/2)&&row>=1&&row<=5)terrain='urban_road';
    if(row===1&&col===7)terrain='urban_indestructible';
    if(row===2&&col===7)terrain='urban_destructible';
    if(row===4&&col===9)terrain='urban_rubble';
    if(row===4&&col===7)terrain='urban_destructible';
    tiles.push({q,r,row,col,terrain,damaged:row===4&&col===7,hedge:row===5&&col===1,bridgeAxis:row===3&&col===river?0:undefined});
  }
  const lut=new Map(tiles.map(t=>[key(t.q,t.r),t]));
  const byPosition=(col,row)=>tiles.find(t=>t.col===col&&t.row===row);
  function connect(a,b) {
    const i=directions.findIndex(([dq,dr])=>a.q+dq===b.q&&a.r+dr===b.r);
    if(i<0)throw Error('Road path crosses a non-neighbor');
    a.roads=(a.roads??0)|(1<<i);b.roads=(b.roads??0)|(1<<((i+3)%6));
  }
  for(let col=0;col<10;col++)connect(byPosition(col,3),byPosition(col+1,3));
  for(let row=1;row<5;row++)connect(byPosition(8+Math.floor(row/2),row),byPosition(8+Math.floor((row+1)/2),row+1));
  byPosition(0,3).roads|=8;byPosition(10,3).roads|=1;
  return tiles;
}
function pacificMap() {
  const tiles=[];
  for(let row=0;row<5;row++)for(let col=0;col<8;col++) {
    let terrain=col<=1?'deep_water':col===2?'water':col===3?'beach':'clear';
    if(col>=5&&row<=2)terrain='trees';
    if(col===4&&row<=1)terrain='rocky';
    if(row===3&&col>=4)terrain='airstrip';
    tiles.push({q:col-Math.floor(row/2),r:row,col,row,terrain,roads:terrain==='airstrip'?9:0});
  }
  return tiles;
}
async function exportMaterials() {
  for(const id of materialIds) {
    const t=textures[id];
    await writeRaw(t,TEX_SIZE,TEX_SIZE,path.join(OUT,'materials',`${id}.png`));
  }
  for(const id of objectIds) {
    await sharp(objects[id]).resize(256,256,{fit:'inside'}).png().toFile(path.join(OUT,'objects',`${id}.png`));
  }
}
async function exportRoads() {
  for(const style of ['summer','winter','urban'])for(const mask of canonicalMasks) {
    const data=Buffer.alloc(W*H*4),tile={x:W/2,y:H/2,roads:mask};
    for(let y=0;y<H;y++)for(let x=0;x<W;x++) {
      const d=hexDistance(x+.5,y+.5,tile,S);
      // Transparent layer bleeds 2px beyond mouth; Cocos must not trim the frame.
      if(d>2)continue;
      const [c,a]=roadPixel(x+.5,y+.5,tile,S,style==='winter',style==='urban'),i=(y*W+x)*4;
      for(let k=0;k<3;k++)data[i+k]=Math.round(c[k]);data[i+3]=Math.round(a*255);
    }
    await writeRaw(data,W,H,path.join(OUT,'roads',`road_${style}_${flags(mask)}.png`));
  }
  for(const season of ['summer','winter'])for(let axis=0;axis<3;axis++) {
    const data=Buffer.alloc(W*H*4),tile={x:W/2,y:H/2,bridgeAxis:axis};
    for(let y=0;y<H;y++)for(let x=0;x<W;x++) {
      if(hexDistance(x+.5,y+.5,tile,S)>2)continue;
      const p=bridgePixel(x+.5,y+.5,tile,S,season==='winter');if(!p)continue;
      const i=(y*W+x)*4;for(let k=0;k<3;k++)data[i+k]=Math.round(p[0][k]);data[i+3]=255;
    }
    await writeRaw(data,W,H,path.join(OUT,'bridges',`bridge_${season}_${axis}.png`));
  }
}
async function exportMasks() {
  // Connected edges form one union; shared corners are handled by the minimum
  // distance to neighboring hexes, avoiding double alpha accumulation.
  const center={x:W/2,y:H/2};
  for(let mask=0;mask<64;mask++) {
    const data=Buffer.alloc(W*H*4);
    const neighbors=normals.flatMap((n,i)=>(mask>>i)&1?[{x:W/2+n[0]*SQ*S,y:H/2+n[1]*SQ*S}]:[]);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++) {
      const own=hexDistance(x+.5,y+.5,center,S),i=(y*W+x)*4;
      if(own>0)continue;
      let alpha=0;
      if(neighbors.length) {
        const adjacent=Math.min(...neighbors.map(t=>hexDistance(x+.5,y+.5,t,S)));
        const n=noise(x+.5,y+.5)*S*.045,width=S*.22;
        const a=1-smooth(-width*.5,width*.5,own+n),b=1-smooth(-width*.5,width*.5,adjacent+n);
        alpha=b/(a+b||1);
      }
      data[i]=255;data[i+1]=255;data[i+2]=255;data[i+3]=Math.round(alpha*255);
    }
    await writeRaw(data,W,H,path.join(OUT,'transition-masks',`edge_${flags(mask)}.png`));
  }
}
async function exportTiles() {
  const entries=[];
  for(const terrain of Object.keys(TERRAIN)) {
    const t={q:0,r:0,terrain};
    if(terrain==='road'||terrain==='urban_road'||terrain==='airstrip')t.roads=9;
    const map=rasterMap([t],128,{margin:0});
    const file=`terrain_${terrain}.png`;
    const image=await composeMap(map,null,{grid:false});
    // Normalize to existing Cocos sprite-frame size, retaining transparent hex corners.
    await sharp(image).resize(W,H,{fit:'fill'}).png().toFile(path.join(OUT,'tiles',file));
    entries.push({id:terrain,label:TERRAIN[terrain][0],file:`exports/tiles/${file}`,winter:false});
  }
  for(const terrain of ['road','field','mud','forest','water']) {
    const t={q:0,r:0,terrain,roads:terrain==='road'?9:0};
    const map=rasterMap([t],128,{winter:true,margin:0}),file=`terrain_${terrain}_snow.png`;
    await sharp(await composeMap(map,null,{grid:false})).resize(W,H,{fit:'fill'}).png().toFile(path.join(OUT,'tiles',file));
    entries.push({id:terrain,label:`冬季${TERRAIN[terrain][0]}`,file:`exports/tiles/${file}`,winter:true});
  }
  for(const [id,t,label] of [
    ['bridge',{terrain:'water',bridgeAxis:0},'桥梁'],
    ['damaged',{terrain:'urban_destructible',damaged:true},'受损建筑'],
    ['hedge',{terrain:'field',hedge:true},'树篱'],
  ]) {
    const map=rasterMap([{q:0,r:0,...t}],128,{margin:0}),file=`terrain_${id}.png`;
    await sharp(await composeMap(map,null,{grid:false})).resize(W,H,{fit:'fill'}).png().toFile(path.join(OUT,'tiles',file));
    entries.push({id,label,file:`exports/tiles/${file}`,winter:false});
  }
  return entries;
}
function textSvg(width,height,title,subtitle,labels=[]) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#e5e1d3"/><g font-family="Microsoft YaHei, sans-serif" fill="#31352a"><text x="28" y="43" font-size="26" font-weight="bold">${title}</text><text x="28" y="70" font-size="14" fill="#62675a">${subtitle}</text>${labels.map(a=>`<text x="${a.x}" y="${a.y}" text-anchor="middle" font-size="${a.size??16}">${a.text}</text>`).join('')}</g></svg>`);
}
async function atlas(entries) {
  const cols=6,cellW=186,cellH=222,width=cols*cellW+40,height=100+4*cellH;
  const layers=[],labels=[];
  for(let i=0;i<entries.length;i++) {
    const col=i%cols,row=Math.floor(i/cols),left=20+col*cellW+24,top=98+row*cellH;
    const input=await sharp(path.join(ROOT,entries[i].file)).resize(139,160).png().toBuffer();
    layers.push({input,left,top});labels.push({x:left+69,y:top+186,text:entries[i].label});
  }
  await sharp(textSvg(width,height,'新版地形候选 · 24 项','独立素材合成预览；无烘焙格框。最终过渡由邻格决定，不能只重复这些单格样张。',labels)).composite(layers).png().toFile(path.join(ROOT,'terrain-candidates-v3.png'));
}
async function comparisons() {
  const pairs=[['草地—泥地','field','mud'],['草地—森林','field','forest'],['陆地—浅水','field','water'],['道路跨格','road','road'],['乡村—城市','field','urban_ground'],['浅水—深水','water','deep_water'],['海滩—浅水','beach','water'],['雪地—冻泥','field','mud']];
  const width=1210,height=810,labels=[],layers=[];
  for(let i=0;i<pairs.length;i++) {
    const [label,a,b]=pairs[i],col=i%4,row=Math.floor(i/4),left=24+col*296,top=110+row*342;
    const tiles=[{q:0,r:0,terrain:a,roads:a==='road'?9:0},{q:1,r:0,terrain:b,roads:b==='road'?9:0}];
    const map=rasterMap(tiles,62,{winter:i===7,margin:5});
    const good=await composeMap(map,null,{grid:false});
    const bad=await composeMap(rasterMap(tiles,62,{winter:i===7,transition:false,margin:5}),null,{grid:false});
    layers.push({input:bad,left:left+30,top},{input:good,left:left+30,top:top+155});
    labels.push({x:left+142,y:top-12,text:label},{x:left+142,y:top+142,text:'硬切边界',size:12},{x:left+142,y:top+298,text:'邻格过渡',size:12});
  }
  await sharp(textSvg(width,height,'衔接检查 · 同一组素材的前后对照','上：关闭过渡　下：启用邻格过渡。道路出口按六方向固定；森林与草地共用底材。',labels)).composite(layers).png().toFile(path.join(ROOT,'terrain-transitions-v3.png'));
}
async function directionMatrix() {
  const width=1168,height=986,layers=[],labels=[];
  const pairs=[['草地—泥地','field','mud'],['陆地—河岸','field','water'],['乡村—城市','field','urban_ground']];
  const names=['E 东','SE 东南','SW 西南','W 西','NW 西北','NE 东北'];
  for(let row=0;row<3;row++)for(let d=0;d<6;d++) {
    const [label,a,b]=pairs[row],map=rasterMap([{q:0,r:0,terrain:a},{q:directions[d][0],r:directions[d][1],terrain:b}],46,{margin:5});
    const left=20+d*188+Math.round((188-map.width)/2),top=104+row*210+Math.round((175-map.height)/2);
    layers.push({input:await composeMap(map,null,{grid:true}),left,top});labels.push({x:20+d*188+94,y:104+row*210+193,text:`${label} · ${names[d]}`,size:12});
  }
  const corners=[['草地 / 泥地 / 水域',['field','mud','water']],['草地 / 泥地 / 城市',['field','mud','urban_ground']],['海滩 / 树林 / 浅水',['beach','trees','water']]];
  for(let i=0;i<corners.length;i++) {
    const [label,kinds]=corners[i],map=rasterMap([{q:0,r:0,terrain:kinds[0]},{q:1,r:0,terrain:kinds[1]},{q:0,r:1,terrain:kinds[2]}],55,{margin:5});
    layers.push({input:await composeMap(map,null,{grid:true}),left:20+i*376+Math.round((376-map.width)/2),top:752});labels.push({x:20+i*376+188,y:954,text:label,size:14});
  }
  await sharp(textSvg(width,height,'六向交界与三地形交角检查','每种过渡检查六个方向；下排检查三格共享顶点。颜色和透明度按区域统一计算。',labels)).composite(layers).png().toFile(path.join(ROOT,'terrain-directions-v3.png'));
}
async function verification() {
  const issues=[],sourceInfo={};
  for(const id of [...materialIds,...objectIds]) {
    const m=await sharp(path.join(SOURCE,id+'.png')).metadata();
    sourceInfo[id]={width:m.width,height:m.height,hasAlpha:!!m.hasAlpha};
    if(objectIds.includes(id)&&!m.hasAlpha)issues.push(`${id}: missing transparency`);
  }
  // A same-material grid must reproduce the global texture exactly; tile
  // boundaries cannot alter its colors. This is a seam-specific numerical check.
  const tiles=[];for(let r=0;r<3;r++)for(let q=0;q<3;q++)tiles.push({q,r,terrain:'field'});
  const map=rasterMap(tiles,60,{margin:0});
  let maximumResidual=0,checked=0,interiorAlphaErrors=0;
  const occupied=new Set(tiles.map(t=>key(t.q,t.r)));
  for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++) {
    const i=(y*map.width+x)*4;
    const [q,r]=cubeRound(x+.5-map.offsetX,y+.5-map.offsetY,60);
    if(occupied.has(key(q,r))&&map.data[i+3]!==255)interiorAlphaErrors++;
    if(map.data[i+3]!==255)continue;
    const c=sample('grass',x+.5-map.offsetX,y+.5-map.offsetY);
    for(let k=0;k<3;k++)maximumResidual=Math.max(maximumResidual,Math.abs(map.data[i+k]-c[k]));checked++;
  }
  if(maximumResidual!==0)issues.push('same-material grid changed global material samples');
  if(interiorAlphaErrors)issues.push('interior tile edges contain translucent seams');
  const horizontal={x:0,y:0,roads:9};
  const mouths=normals.map((n,i)=>({direction:i,alpha:roadPixel(n[0]*SQ*S/2,n[1]*SQ*S/2,{...horizontal,roads:1<<i},S)[1]}));
  if(mouths.some(m=>m.alpha<.99))issues.push('road mouth not opaque at shared edge');
  let oppositeMouthResidual=0;
  for(let i=0;i<6;i++) {
    const n=normals[i],tangent=[-n[1],n[0]],edge=SQ*S/2;
    const a={x:0,y:0,roads:1<<i},b={x:n[0]*edge*2,y:n[1]*edge*2,roads:1<<((i+3)%6)};
    for(let j=-36;j<=36;j++) {
      const x=n[0]*edge+tangent[0]*j,y=n[1]*edge+tangent[1]*j;
      oppositeMouthResidual=Math.max(oppositeMouthResidual,Math.abs(roadPixel(x,y,a,S)[1]-roadPixel(x,y,b,S)[1]));
    }
  }
  if(oppositeMouthResidual>1e-9)issues.push('opposite road mouth alpha mismatch');
  const coveredMasks=new Set(canonicalMasks.flatMap(m=>Array.from({length:6},(_,s)=>rotateMask(m,s))));
  if(coveredMasks.size!==63)issues.push('road masks do not cover all 63 nonempty connections');
  const pngs=fs.readdirSync(path.join(OUT,'tiles')).filter(f=>f.endsWith('.png'));
  for(const f of pngs) {
    const {data,info}=await sharp(path.join(OUT,'tiles',f)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    if(info.width!==W||info.height!==H)issues.push(`${f}: wrong dimensions`);
    const corners=[0,W-1,(H-1)*W,(H*W)-1];
    if(corners.some(p=>data[p*4+3]!==0))issues.push(`${f}: opaque hex corner`);
  }
  const result={status:issues.length?'failed':'passed',issues,sourceInfo,sameMaterialSeam:{pixelsChecked:checked,maximumColorResidual:maximumResidual,interiorAlphaErrors},roadMouths:mouths,oppositeMouthAlphaResidual:oppositeMouthResidual,roadConnectionMasksCovered:coveredMasks.size,tileDimensions:[W,H],reviewOnly:true,limitations:['Independent review renderer, not an in-game screenshot.','No game resources or runtime code have been changed.','Mixed-edge and multi-material corners require visual review; numerical checks do not establish all combinations.','Generic masks are topology references; final terrain transitions must use world coordinates and material-normalized weights, not stack multiple per-edge images.']};
  fs.writeFileSync(path.join(ROOT,'validation.json'),JSON.stringify(result,null,2)+'\n');
  if(issues.length)throw Error(issues.join('\n'));
  return result;
}
async function main() {
  for(const dir of ['materials','objects','tiles','roads','bridges','transition-masks'])fs.mkdirSync(path.join(OUT,dir),{recursive:true});
  for(const id of materialIds)textures[id]=await sharp(path.join(SOURCE,id+'.png')).resize(TEX_SIZE,TEX_SIZE,{fit:'fill'}).ensureAlpha().raw().toBuffer();
  // Crop diffuse empty margins tightly around roofs; preserve the source alpha
  // and artwork. This prevents a large transparent margin shrinking the roof.
  for(const id of objectIds)objects[id]=await sharp(path.join(SOURCE,id+'.png')).trim({threshold:id.startsWith('building')?128:8}).png().toBuffer();
  await exportMaterials();await exportRoads();await exportMasks();
  const entries=await exportTiles();
  const atlasEntries=[...entries.slice(0,16),entries.find(a=>a.id==='bridge'),entries.find(a=>a.id==='damaged'),...entries.filter(a=>a.winter),entries.find(a=>a.id==='hedge')];
  await atlas(atlasEntries);await comparisons();await directionMatrix();
  const summer=rasterMap(europeMap(),60);
  await composeMap(summer,path.join(ROOT,'map-summer-v3.png'),{grid:true,tanks:true});
  await composeMap(summer,path.join(ROOT,'map-summer-v3-no-grid.png'),{grid:false,tanks:true});
  await composeMap(rasterMap(europeMap(),60,{winter:true}),path.join(ROOT,'map-winter-v3.png'),{grid:true,tanks:true});
  await composeMap(rasterMap(pacificMap(),60),path.join(ROOT,'map-pacific-v3.png'),{grid:true});
  fs.writeFileSync(path.join(ROOT,'manifest.json'),JSON.stringify({version:3,status:'awaiting-art-approval',frameSize:[W,H],gameHexRadius:60,coordinateSystem:'pointy-top axial, E SE SW W NW NE',materials:materialIds,objects:objectIds,tiles:entries,roadCanonicalMasks:canonicalMasks.map(flags),bridgeAxes:[0,60,120],transitionMaskCount:64,previewMap:europeMap(),sourceTank:['assets/resources/textures/units/sherman_top_hull.png','assets/resources/textures/units/sherman_top_turret.png'],tankScaleSource:'assets/scripts/core/TankVisualDB.ts'},null,2)+'\n');
  const checks=await verification();
  console.log(JSON.stringify({tiles:entries.length,materials:materialIds.length,objects:objectIds.length,roadSprites:canonicalMasks.length*3,bridges:6,masks:64,status:checks.status,seam:checks.sameMaterialSeam},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
