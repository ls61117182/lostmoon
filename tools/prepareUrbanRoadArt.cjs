// Export city roads using the existing six-direction road geometry and generated materials.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'source_art/terrain/urban_surface');
const OUT = path.join(ROOT, 'assets/resources/textures/terrain/urban/roads');
const W = 222, H = 256, S = 3;
const HALF = 128 * 0.24; // City streets: 33% wider than the original 0.18 radius.
const CURB = 3.2;
const TURN_RADIUS = 48;
const JUNCTION_BLEND = 36;
const DIRECTIONS = ['E', 'SE', 'SW', 'W', 'NW', 'NE'];
const EDGES = [[222,128], [166.5,224], [55.5,224], [0,128], [55.5,32], [166.5,32]];
const VERTICES = [[111,0],[222,64],[222,192],[111,256],[0,192],[0,64]];
const RAYS = EDGES.map(([x,y]) => {const d = Math.hypot(x-111,y-128); return [(x-111)/d,(y-128)/d];});
const flags = mask => Array.from({length:6}, (_,i) => (mask >> i) & 1).join('');
const file = mask => `urban_road_surface_${flags(mask)}_v1.png`;
function hexInset(x, y) {
  let result = Infinity;
  for (let i=0;i<6;i++) {
    const [ax,ay] = VERTICES[i], [bx,by] = VERTICES[(i+1)%6];
    result = Math.min(result, ((bx-ax)*(y-ay)-(by-ay)*(x-ax))/Math.hypot(bx-ax,by-ay));
  }
  return result;
}
function shapeFor(mask) {
  const dirs=RAYS.filter((_,d)=>mask&(1<<d));
  const pairs=[];
  for(let a=0;a<dirs.length;a++) for(let b=a+1;b<dirs.length;b++) {
    if(dirs[a][0]*dirs[b][0]+dirs[a][1]*dirs[b][1]>-.99) pairs.push([a,b]);
  }
  let turn=null;
  if(dirs.length===2 && pairs.length) {
    const [u,v]=dirs, angle=Math.acos(u[0]*v[0]+u[1]*v[1]);
    const t=TURN_RADIUS/Math.tan(angle/2), length=Math.hypot(u[0]+v[0],u[1]+v[1]);
    const offset=TURN_RADIUS/Math.sin(angle/2);
    const cx=(u[0]+v[0])/length*offset, cy=(u[1]+v[1])/length*offset;
    const start=Math.atan2(t*u[1]-cy,t*u[0]-cx), end=Math.atan2(t*v[1]-cy,t*v[0]-cx);
    const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
    const sweep=wrap(end-start);
    turn={t,cx,cy,start,sweep};
  }
  return (x,y) => {
    x-=111; y-=128;
    if(turn) {
      const {t,cx,cy,start,sweep}=turn;
      let distance=Infinity;
      // Straight lead-ins are tangent to one constant-width circular bend.
      for(const [ux,uy] of dirs) {
        const dot=x*ux+y*uy-t;
        distance=Math.min(distance,dot>=0 ? Math.abs(x*uy-y*ux) : Math.hypot(x-t*ux,y-t*uy));
      }
      const a=Math.atan2(y-cy,x-cx)-start, relative=Math.atan2(Math.sin(a),Math.cos(a));
      if(relative*Math.sign(sweep)>=0 && Math.abs(relative)<=Math.abs(sweep)) distance=Math.min(distance,Math.abs(Math.hypot(x-cx,y-cy)-TURN_RADIUS));
      return distance;
    }
    const distances=dirs.map(([ux,uy])=>x*ux+y*uy>=0 ? Math.abs(x*uy-y*ux) : Math.hypot(x,y));
    let result=Math.min(...distances);
    if(dirs.length===1) return Math.min(result,Math.hypot(x,y)-HALF*.6);
    // Round concave junction corners; opposite rays stay exactly straight.
    for(const [a,b] of pairs) {
      if(x*dirs[a][0]+y*dirs[a][1]<0 || x*dirs[b][0]+y*dirs[b][1]<0) continue;
      const h=Math.max(0,1-Math.abs(distances[a]-distances[b])/JUNCTION_BLEND);
      result=Math.min(result,Math.min(distances[a],distances[b])-JUNCTION_BLEND*h*h/4);
    }
    return result;
  };
}
function roadDistance(x,y,mask) { return shapeFor(mask)(x,y); }
function metaFor(filename) {
  const output=path.join(OUT,filename+'.meta');
  if(fs.existsSync(output)) return;
  const template=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/resources/textures/terrain/terrain_road.png.meta'),'utf8'));
  const uuid=crypto.randomUUID(), name=path.basename(filename,'.png');
  const meta=JSON.parse(JSON.stringify(template).replaceAll(template.uuid,uuid).replaceAll('terrain_road',name));
  const frame=meta.subMetas.f9941.userData;
  frame.trimType='none'; frame.packable=false;
  fs.writeFileSync(output,JSON.stringify(meta,null,2)+'\n');
}
async function save(data,filename) {
  await sharp(data,{raw:{width:W*S,height:H*S,channels:4}}).resize(W,H).png().toFile(path.join(OUT,filename));
  metaFor(filename);
}
function titleSvg(text,width,height=28) {
  return Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#313839"/><text x="${width/2}" y="20" font-family="sans-serif" font-size="14" fill="#eee9d9" text-anchor="middle">${text}</text></svg>`);
}
async function main() {
  fs.mkdirSync(OUT,{recursive:true});
  const materialManifest=JSON.parse(fs.readFileSync(path.join(SOURCE,'road_materials_manifest.json'),'utf8'));
  const materials={};
  for(const entry of materialManifest.materials) {
    const saved=path.join(SOURCE,`urban_road_${entry.key}_material_v1.png`);
    if(!fs.existsSync(saved)) fs.copyFileSync(entry.generatedPath,saved);
    materials[entry.key]=await sharp(saved).removeAlpha().resize(W*S,H*S,{fit:'fill'}).raw().toBuffer();
  }
  const N=W*H*S*S;
  const inside=new Float32Array(N);
  const base=Buffer.alloc(N*4), texture=Buffer.alloc(N*3);
  for(let y=0;y<H*S;y++) for(let x=0;x<W*S;x++) {
    const i=y*W*S+x, px=(x+.5)/S, py=(y+.5)/S;
    inside[i]=hexInset(px,py);
    // A reflected periodic texture with periods W/2 and 3H/4 is invariant under
    // BOTH hex-lattice translations (W,0) and (W/2,3H/4). Every seam shares texture.
    const tx=Math.min(W*S-1,Math.floor((1-Math.abs(2*((px/(W/2))%1)-1))*(W*S-1)));
    const ty=Math.min(H*S-1,Math.floor((1-Math.abs(2*((py/(H*.75))%1)-1))*(H*S-1)));
    const sample=(ty*W*S+tx)*3;
    for(let c=0;c<3;c++) {
      texture[i*3+c]=materials.asphalt[sample+c];
      base[i*4+c]=inside[i]<1.2 ? [109,110,99][c] : materials.pavers[i*3+c];
    }
    base[i*4+3]=inside[i]>=0 ? 255 : 0;
  }
  const baseName='urban_road_tile_base_v1.png';
  await save(base,baseName);
  const entries=[];
  const composites=[];
  for(let mask=0;mask<64;mask++) {
    if(mask) {
      const data=Buffer.alloc(N*4), distanceAt=shapeFor(mask);
      for(let i=0;i<N;i++) {
        if(inside[i]<0) continue;
        const distance=distanceAt((i%(W*S)+.5)/S,(Math.floor(i/(W*S))+.5)/S);
        if(distance>HALF+CURB) continue;
        const delta=distance-HALF;
        const color=delta<=0 ? null : delta<.9 ? [58,61,59] : delta<CURB-.7 ? [181,181,162] : [83,88,82];
        for(let c=0;c<3;c++) data[i*4+c]=color ? color[c] : texture[i*3+c];
        data[i*4+3]=255;
      }
      await save(data,file(mask));
    }
    const composite=await sharp(path.join(OUT,baseName)).composite(mask ? [{input:path.join(OUT,file(mask))}] : []).png().toBuffer();
    composites.push(composite);
    entries.push({rd:flags(mask),directions:DIRECTIONS.filter((_,i)=>mask&(1<<i)),surface:mask?file(mask):null});
  }
  const manifest={size:[W,H],pivot:[.5,.5],base:baseName,directionOrder:DIRECTIONS,
    roadHalfWidth:HALF,curbWidth:CURB,endpointRadius:HALF*1.6,turnCenterlineRadius:TURN_RADIUS,junctionBlend:JUNCTION_BLEND,
    note:'rd characters follow Tile.roads order (E,SE,SW,W,NW,NE), NOT a conventional binary integer string. Place base and one surface at identical center and size; do not trim. All 63 surfaces are pre-oriented. No rotation required. 000000 uses base only.',variants:entries};
  fs.writeFileSync(path.join(OUT,'urban_road_manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  // Compact catalogue of every possible road mask, including the empty base.
  const catalogue=[];
  for(let m=0;m<64;m++) {
    const x=16+(m%8)*127, y=16+Math.floor(m/8)*164;
    catalogue.push({input:await sharp(composites[m]).resize(111,128).toBuffer(),left:x,top:y});
    catalogue.push({input:titleSvg(flags(m),111),left:x,top:y+130});
  }
  await sharp({create:{width:1032,height:1328,channels:4,background:'#555d56'}}).composite(catalogue).png().toFile(path.join(SOURCE,'urban_roads_all_connections_preview.png'));
  // Full-size common cases, including all three orientations of a straight road.
  const examples=[[0,'BASE'],[9,'STRAIGHT E-W'],[18,'STRAIGHT SE-NW'],[36,'STRAIGHT SW-NE'],[1,'DEAD END'],[3,'PORTS 60 DEG'],[5,'PORTS 120 DEG'],[21,'Y JUNCTION'],[11,'T JUNCTION'],[27,'FOUR WAY'],[31,'FIVE WAY'],[63,'SIX WAY']];
  const common=[];
  for(let i=0;i<examples.length;i++) {
    const [mask,label]=examples[i], x=16+i%4*238,y=16+Math.floor(i/4)*300;
    common.push({input:composites[mask],left:x,top:y});
    common.push({input:titleSvg(label,W),left:x,top:y+260});
  }
  await sharp({create:{width:968,height:916,channels:4,background:'#555d56'}}).composite(common).png().toFile(path.join(SOURCE,'urban_roads_examples_preview.png'));
  // A connected nineteen-tile neighbourhood with a through-street and two branches.
  const cells=new Map();
  for(let q=-2;q<=2;q++) for(let r=-2;r<=2;r++) if(Math.abs(q+r)<=2) cells.set(`${q},${r}`,{q,r,mask:0});
  const offsets=[[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]];
  function connect(a,b) {
    const A=cells.get(a.join(',')), B=cells.get(b.join(','));
    const d=offsets.findIndex(([q,r])=>B.q-A.q===q&&B.r-A.r===r);
    if(d<0) throw Error('Non-adjacent demo cells');
    A.mask|=1<<d; B.mask|=1<<((d+3)%6);
  }
  for(const chain of [ [[-2,0],[-1,0],[0,0],[1,0],[2,0]], [[0,0],[0,-1],[1,-2],[2,-2]], [[1,0],[0,1],[-1,2],[-2,2]] ]) {
    for(let i=1;i<chain.length;i++) connect(chain[i-1],chain[i]);
  }
  const map=[];
  for(const tile of cells.values()) {
    const x=Math.round(580+W*(tile.q+tile.r/2)-W/2),y=430+192*tile.r-H/2+128;
    map.push({input:composites[tile.mask],left:x,top:y});
    if(!tile.mask) {
      const building=['apartment','factory','market','theater','post_office','waterworks'][Math.abs(tile.q*3+tile.r)%6];
      const sprite=path.join(OUT,'..',`urban_dense_indestructible_${building}_v1.png`);
      if(fs.existsSync(sprite)) map.push({input:await sharp(sprite).resize(178,205).toBuffer(),left:x+22,top:y+25});
    }
  }
  await sharp({create:{width:1160,height:1120,channels:4,background:'#404b45'}}).composite(map).png().toFile(path.join(SOURCE,'urban_roads_neighbourhood_preview.png'));
  // Verify actual exported images: every mouth center matches the rd flag, no fill outside hex.
  let checkedMouths=0, checkedProfiles=0;
  const mouthReferences=await Promise.all(RAYS.map((_,d)=>sharp(path.join(OUT,file(1<<d))).raw().toBuffer()));
  for(let mask=1;mask<64;mask++) {
    const p=path.join(OUT,file(mask));
    const {data,info}=await sharp(p).raw().toBuffer({resolveWithObject:true});
    if(info.width!==W||info.height!==H||info.channels!==4) throw Error('Wrong image dimensions: '+file(mask));
    for(let d=0;d<6;d++) {
      const [mx,my]=EDGES[d], [ux,uy]=RAYS[d];
      const x=Math.max(0,Math.min(W-1,Math.floor(mx-ux*3))),y=Math.max(0,Math.min(H-1,Math.floor(my-uy*3)));
      const alpha=data[(y*W+x)*4+3];
      if(Boolean(alpha>200)!==Boolean(mask&(1<<d))) throw Error('Wrong mouth '+file(mask)+' direction '+d);
      checkedMouths++;
      if(mask&(1<<d)) {
        for(let offset=-40;offset<=40;offset++) {
          const px=Math.max(0,Math.min(W-1,Math.floor(mx-ux*3-uy*offset)));
          const py=Math.max(0,Math.min(H-1,Math.floor(my-uy*3+ux*offset)));
          const index=(py*W+px)*4+3;
          if(Math.abs(data[index]-mouthReferences[d][index])>3) throw Error('Mouth width mismatch '+file(mask)+' direction '+d);
        }
        checkedProfiles++;
      }
    }
    if(data[3]!==0||data[(W-1)*4+3]!==0) throw Error('Opaque corner '+file(mask));
  }
  fs.writeFileSync(path.join(SOURCE,'urban_roads_validation.json'),JSON.stringify({surfaces:63,baseTiles:1,dimensions:[W,H],roadWidth:HALF*2,turnCenterlineRadius:TURN_RADIUS,verifiedMouths:checkedMouths,verifiedMouthWidthProfiles:checkedProfiles,transparentCorners:true,demoConnections:'reciprocal'},null,2)+'\n');
  console.log(`Exported base + 63 transparent surfaces; verified ${checkedMouths} direction mouths. Preview sheets and neighbourhood saved.`);
}
if(require.main===module) main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={hexInset,roadDistance,shapeFor,flags,EDGES,RAYS,HALF,CURB};
