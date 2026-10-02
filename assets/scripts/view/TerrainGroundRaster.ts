import type { Tile } from '../core/types';
import { europeanRoadCenterlineDistance, europeanRoadVariantIndex } from '../core/UrbanTerrain';

/** Pure, platform-independent terrain compositor. Coordinates are Y-down,
 * pointy-top axial. Chunk boundaries never restart material or transition UVs. */
export interface TerrainMaterialData { width: number; height: number; rgb: string; }
export interface TerrainMaterialBundle { version: number; materials: Record<string, TerrainMaterialData>; europeanSummer?: TerrainMaterialBundle; europeanWinter?: TerrainMaterialBundle; winterArtwork?: boolean; fieldBasedLand?: boolean; curvedRoads?: boolean; }
export interface GroundChunk { x: number; y: number; width: number; height: number; textureWidth: number; textureHeight: number; pixels: Uint8Array; }
interface GroundTile { q: number; r: number; x: number; y: number; material: string; roads: number; roadFlags: boolean[]; roadVariant: number; bridge: number; runway: boolean; mudPatches: boolean; ruralYard: boolean; }
interface Material { width: number; height: number; pixels: Uint8Array; }
export const GROUND_RADIUS = 48;
export const GROUND_CHUNK_SIZE = 384;
const SQ = Math.sqrt(3), HALO = 40;
const AXES = [[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]];
const NORMALS = Array.from({ length:6 }, (_,i) => [Math.cos(i*Math.PI/3),Math.sin(i*Math.PI/3)]);
const WATER = new Set(['water','deep_water','winter_water','shallow_water']);
const BASE: Record<string,string> = { road:'grass',field:'grass',mud:'mud',forest:'grass',water:'water',deep_water:'deep_water',clear:'sand',trees:'sand',beach:'shallow_water',rocky:'soil',airstrip:'sand',urban_ground:'paving',urban_road:'paving',urban_indestructible:'paving',urban_destructible:'paving',urban_rubble:'paving' };
const WINTER:Record<string,string>={grass:'winter_ground',mud:'winter_mud',soil:'winter_soil',sand:'winter_soil',paving:'winter_paving'};
const WINTER_COVER:Record<string,number>={winter_ground:.93,winter_forest:.70,winter_mud:.58,winter_soil:.72,winter_paving:.50};
const clamp = (v:number,a=0,b=1) => Math.max(a,Math.min(b,v));
function smooth(a:number,b:number,v:number):number { const t=clamp((v-a)/(b-a));return t*t*(3-2*t); }
function noise(x:number,y:number):number { return Math.sin(x*.055+y*.016)*.47+Math.sin(x*.022-y*.068)*.32+Math.sin(x*.113+y*.091)*.21; }
function key(q:number,r:number):string { return `${q},${r}`; }
function reflected(n:number,len:number):number { const p=((Math.floor(n)%(len*2))+len*2)%(len*2);return p<len?p:len*2-p-1; }
function decodeBase64(text:string):Uint8Array {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const table=new Int16Array(128).fill(-1);for(let i=0;i<alphabet.length;i++)table[alphabet.charCodeAt(i)]=i;
  const padding=text.endsWith('==')?2:text.endsWith('=')?1:0,out=new Uint8Array(text.length/4*3-padding);
  let bits=0,value=0,index=0;
  for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);if(c===61)break;const n=c<128?table[c]:-1;if(n<0)throw new Error('Invalid terrain material encoding');value=(value<<6)|n;bits+=6;if(bits>=8){bits-=8;out[index++]=(value>>bits)&255;}}
  return out;
}
export function terrainMaterial(tile:Tile,winter:boolean):string {
  const m=BASE[tile.terrain]??'grass';return winter?(WATER.has(m)?'winter_water':WINTER[m]??m):m;
}
export function terrainGroundFingerprint(tiles:readonly Tile[],winter:boolean):string {
  return `${winter?1:0}|`+tiles.map(t=>`${t.pos.q},${t.pos.r}:${terrainMaterial(t,winter)}:${['forest','trees'].includes(t.terrain)?t.terrain:''}:${t.terrain==='airstrip'?1:0}:${t.hasBuilding&&!t.urbanKind&&!t.terrain.startsWith('urban_')&&!t.roads?.some(Boolean)?1:0}:${t.roads?.map(b=>b?1:0).join('')??''}:${t.bridgeEnds?.join(',')??''}`).join('|');
}
/** Soft irregular bare-earth courtyard, normalized to the hex radius. */
export function ruralYardCoverage(x:number,y:number):number {
  const radius=Math.hypot(x/.76,y/.67);
  const irregular=Math.sin(x*12+y*7)*.025+Math.sin(y*15-x*6)*.018;
  return 1-smooth(.78,1.02,radius+irregular);
}
function axialAt(x:number,y:number):[number,number] {
  const r=y/(1.5*GROUND_RADIUS),q=x/(SQ*GROUND_RADIUS)-r/2;
  let a=Math.round(q),b=Math.round(r),c=Math.round(-q-r);
  const da=Math.abs(a-q),db=Math.abs(b-r),dc=Math.abs(c+q+r);
  if(da>db&&da>dc)a=-b-c;else if(db>dc)b=-a-c;
  return [a,b];
}
function distance(x:number,y:number,t:GroundTile):number {
  let d=-Infinity;for(const n of NORMALS)d=Math.max(d,(x-t.x)*n[0]+(y-t.y)*n[1]);return d-SQ*GROUND_RADIUS/2;
}
function blur(input:Float32Array,width:number,height:number,radius:number):Float32Array {
  let src=input;
  for(let pass=0;pass<3;pass++) {
    const tmp=new Float32Array(src.length),out=new Float32Array(src.length),span=radius*2+1;
    for(let y=0;y<height;y++){const row=y*width;let sum=0;for(let k=-radius;k<=radius;k++)sum+=src[row+clamp(k,0,width-1)];for(let x=0;x<width;x++){tmp[row+x]=sum/span;sum+=src[row+clamp(x+radius+1,0,width-1)]-src[row+clamp(x-radius,0,width-1)];}}
    for(let x=0;x<width;x++){let sum=0;for(let k=-radius;k<=radius;k++)sum+=tmp[clamp(k,0,height-1)*width+x];for(let y=0;y<height;y++){out[y*width+x]=sum/span;sum+=tmp[clamp(y+radius+1,0,height-1)*width+x]-tmp[clamp(y-radius,0,height-1)*width+x];}}
    src=out;
  }
  return src;
}
function fieldAt(a:Float32Array,x:number,y:number,width:number,height:number):number {
  x=clamp(x,0,width-1);y=clamp(y,0,height-1);
  const ix=Math.floor(x),iy=Math.floor(y),jx=Math.min(ix+1,width-1),jy=Math.min(iy+1,height-1),u=x-ix,v=y-iy;
  return a[iy*width+ix]*(1-u)*(1-v)+a[iy*width+jx]*u*(1-v)+a[jy*width+ix]*(1-u)*v+a[jy*width+jx]*u*v;
}
function roadDistance(x:number,y:number,t:GroundTile,curved=false):number {
  if(curved){
    if(distance(x,y,t)>GROUND_RADIUS*.08)return Infinity;
    return europeanCountryRoadDistance(t.roadFlags,(x-t.x)/GROUND_RADIUS,-(y-t.y)/GROUND_RADIUS,t.roadVariant)*GROUND_RADIUS;
  }
  const dx=x-t.x,dy=y-t.y,end=SQ*GROUND_RADIUS/2+GROUND_RADIUS*.08;let d=Infinity;
  for(let i=0;i<6;i++)if(t.roads&(1<<i)) {
    const n=NORMALS[i],along=clamp((dx*n[0]+dy*n[1])/end);
    d=Math.min(d,Math.hypot(dx-n[0]*end*along,dy-n[1]*end*along));
  }
  return d;
}
/** Broader country-road bends; edge position and tangent stay unchanged. */
export function europeanCountryRoadDistance(roads:readonly boolean[],x:number,y:number,variant=0):number {
  const inset=Math.min(SQ/2-Math.abs(x),SQ/2-Math.abs(x)*.5-Math.abs(y)*SQ/2);
  const envelope=smooth(0,.68,inset),phase=(variant%3)*2.1;
  const dx=.07*Math.sin(y*1.9+phase+.5)*envelope,dy=.11*Math.sin(x*2.3+phase+1.0)*envelope;
  return europeanRoadCenterlineDistance(roads,x+dx,y+dy,variant);
}
/** Mud footprint in canonical world coordinates, independent of chunk bounds. */
export function europeanMudCoverage(q:number,r:number,gx:number,gy:number,mudNeighbors=0):number {
  const tx=SQ*GROUND_RADIUS*(q+r/2),ty=1.5*GROUND_RADIUS*r;
  // Shared world-space pattern: several smaller muddy patches and field gaps
  // per hex, continuing without restarting across adjacent mud tiles.
  const alpha=smooth(-.43,-.30,noise(gx*2.8+103,gy*2.8-71));
  let edge=-Infinity;
  for(let i=0;i<6;i++)if(!(mudNeighbors&(1<<i))){const n=NORMALS[i];edge=Math.max(edge,(gx-tx)*n[0]+(gy-ty)*n[1]-SQ*GROUND_RADIUS/2);}
  // Only the perimeter of the whole mud region retains a narrow field rim.
  return alpha*(1-smooth(-GROUND_RADIUS*.055,-GROUND_RADIUS*.02,edge));
}

export class TerrainGroundRaster {
  private materials:Record<string,Material>={};
  private fieldBasedLand=false;
  private curvedRoads=false;
  private winterArtwork=false;
  constructor(bundle:TerrainMaterialBundle) {
    this.fieldBasedLand=!!bundle.fieldBasedLand;
    this.curvedRoads=!!bundle.curvedRoads;
    this.winterArtwork=!!bundle.winterArtwork;
    if(bundle.version!==3)throw new Error('Unsupported terrain material version');
    for(const [id,m]of Object.entries(bundle.materials)){const pixels=decodeBase64(m.rgb);if(pixels.length!==m.width*m.height*3)throw new Error(`Invalid terrain material ${id}`);this.materials[id]={width:m.width,height:m.height,pixels};}
    for(const id of ['grass','soil','mud','sand','water','deep_water','paving','snow','winter_water','timber'])if(!this.materials[id])throw new Error(`Missing terrain material ${id}`);
    if(!this.materials.shallow_water){
      const water=this.materials.water,pixels=water.pixels.slice(),tint=[145,201,202];
      for(let i=0;i<pixels.length;i++)pixels[i]=Math.round(pixels[i]+(tint[i%3]-pixels[i])*.4);
      this.materials.shallow_water={width:water.width,height:water.height,pixels};
    }
    // Winter substrates keep the source texture shapes but use their own
    // frozen-earth palette; exposed ground must never reveal summer grass.
    for(const [id,source,tint]of [
      ['winter_ground','grass',[150,148,135]],
      ['winter_mud','mud',[116,109,99]],
      ['winter_soil','soil',[151,143,129]],
      ['winter_paving','paving',[139,144,146]],
    ] as Array<[string,string,number[]]>) {
      if(this.materials[id])continue;
      const m=this.materials[source],pixels=m.pixels.slice();let mean=0;
      for(let i=0;i<pixels.length;i+=3)mean+=(pixels[i]+pixels[i+1]+pixels[i+2])/3;
      mean/=pixels.length/3;
      for(let i=0;i<pixels.length;i+=3){const detail=((pixels[i]+pixels[i+1]+pixels[i+2])/3-mean)*.45;for(let k=0;k<3;k++)pixels[i+k]=Math.round(clamp(tint[k]+detail,0,255));}
      this.materials[id]={width:m.width,height:m.height,pixels};
    }
  }
  private sample(id:string,x:number,y:number):number[] {
    const m=this.materials[id],factorX=m.width/384,factorY=m.height/384;
    const i=(reflected(y*factorY,m.height)*m.width+reflected(x*factorX,m.width))*3;
    return [m.pixels[i],m.pixels[i+1],m.pixels[i+2]];
  }
  chunkOrigins(tiles:readonly Tile[]):Array<{x:number;y:number}> {
    const chunks=new Map<string,{x:number;y:number}>();
    for(const t of tiles){const x=SQ*GROUND_RADIUS*(t.pos.q+t.pos.r/2),y=1.5*GROUND_RADIUS*t.pos.r;
      for(let cy=Math.floor((y-GROUND_RADIUS)/GROUND_CHUNK_SIZE);cy<=Math.floor((y+GROUND_RADIUS)/GROUND_CHUNK_SIZE);cy++)for(let cx=Math.floor((x-SQ*GROUND_RADIUS/2)/GROUND_CHUNK_SIZE);cx<=Math.floor((x+SQ*GROUND_RADIUS/2)/GROUND_CHUNK_SIZE);cx++)chunks.set(key(cx,cy),{x:cx*GROUND_CHUNK_SIZE,y:cy*GROUND_CHUNK_SIZE});}
    return [...chunks.values()];
  }
  renderChunk(tiles:readonly Tile[],winter:boolean,x:number,y:number,width=GROUND_CHUNK_SIZE,height=GROUND_CHUNK_SIZE,resolution=1,roadVariantOverride?:number):GroundChunk {
    const tw=width*resolution+2,th=height*resolution+2,fw=width+2+HALO*2,fh=height+2+HALO*2,ox=x-1-HALO,oy=y-1-HALO;
    const lut=new Map<string,GroundTile>();
    for(const t of tiles){const tx=SQ*GROUND_RADIUS*(t.pos.q+t.pos.r/2),ty=1.5*GROUND_RADIUS*t.pos.r;if(tx<ox-GROUND_RADIUS*2||tx>ox+fw+GROUND_RADIUS*2||ty<oy-GROUND_RADIUS*2||ty>oy+fh+GROUND_RADIUS*2)continue;
      const mudPatches=this.fieldBasedLand&&!winter&&t.terrain==='mud';
      const material=winter&&t.terrain==='forest'&&this.materials.winter_forest?'winter_forest':!winter&&t.terrain==='forest'&&this.materials.forest_floor?'forest_floor':mudPatches?'grass':terrainMaterial(t,winter);
      lut.set(key(t.pos.q,t.pos.r),{q:t.pos.q,r:t.pos.r,x:tx,y:ty,material,roads:t.roads?.reduce((m,b,i)=>m|(b?1<<i:0),0)??0,roadFlags:t.roads??Array(6).fill(false),roadVariant:roadVariantOverride??europeanRoadVariantIndex(t.pos.q,t.pos.r),bridge:t.terrain==='water'&&t.bridgeEnds?t.bridgeEnds[0]%3:-1,runway:t.terrain==='airstrip',ruralYard:!!t.hasBuilding&&!t.urbanKind&&!t.terrain.startsWith('urban_')&&!t.roads?.some(Boolean),mudPatches});}
    const runwayAxis=(t:GroundTile)=>{let axis=0;for(let i=0;i<6;i++)if(t.roads&(1<<i)){axis=i;if(t.roads&(1<<((i+3)%6)))break;}return axis%3;};
    const runways=[...lut.values()].filter(t=>t.runway).map(t=>{
      const axis=runwayAxis(t),n=NORMALS[(6-axis)%6],end=SQ*GROUND_RADIUS/2;
      const connected=(sign:number)=>{
        const [q,r]=axialAt(t.x+n[0]*SQ*GROUND_RADIUS*sign,t.y+n[1]*SQ*GROUND_RADIUS*sign);
        const other=lut.get(key(q,r));return !!other?.runway&&runwayAxis(other)===axis;
      };
      return {tile:t,n,min:connected(-1)?-end:-end*.60,max:connected(1)?end:end*.60};
    });
    const fields=new Map<string,Float32Array>();for(const t of lut.values())if(!fields.has(t.material))fields.set(t.material,new Float32Array(fw*fh));
    for(let py=0;py<fh;py++)for(let px=0;px<fw;px++){
      const gx=ox+px+.5,gy=oy+py+.5,[q,r]=axialAt(gx,gy);let tile=lut.get(key(q,r));
      if(!tile){let best=Infinity;for(const [dq,dr]of AXES){const n=lut.get(key(q+dq,r+dr));if(n){const d=distance(gx,gy,n);if(d<best){best=d;tile=n;}}}}
      if(tile)fields.get(tile.material)![py*fw+px]=1;
    }
    for(const [m,a]of fields)fields.set(m,blur(a,fw,fh,Math.round(GROUND_RADIUS*(winter?.18:.14))));
    const ids=[...fields.keys()],arrays=[...fields.values()],weights=new Float64Array(ids.length),pixels=new Uint8Array(tw*th*4);
    const sampleScale=60/GROUND_RADIUS;
    for(let py=0;py<th;py++)for(let px=0;px<tw;px++) {
      const gx=x+(px-1+.5)/resolution,gy=y+(py-1+.5)/resolution,[q,r]=axialAt(gx,gy),tile=lut.get(key(q,r));if(!tile)continue;
      const wx=gx*sampleScale,wy=gy*sampleScale;
      const warp=GROUND_RADIUS*(winter?.11:.19);
      const fx=gx-ox-.5+noise(wx*.82+38,wy*.9)*warp,fy=gy-oy-.5+noise(wx*.83-17,wy*.84+53)*warp;
      let sum=0,water=0;for(let i=0;i<ids.length;i++){const w=fieldAt(arrays[i],fx,fy,fw,fh);weights[i]=w;sum+=w;if(WATER.has(ids[i]))water+=w;}
      if(sum<=0)continue;water/=sum;
      let waterAlpha=smooth(.70,.90,water);
      // The blurred union of water tiles rounds convex and concave corners.
      // Threshold above one half retreats that curved contour into water.
      let shoreLand:GroundTile|undefined,landDistance=Infinity;
      if(water>.0001){
        for(const [dq,dr] of [[0,0],...AXES]){
          const land=lut.get(key(q+dq,r+dr));if(!land||WATER.has(land.material))continue;
          const d=distance(gx,gy,land);if(d<landDistance){landDistance=d;shoreLand=land;}
        }
        if(shoreLand){
          // Only a narrow safety margin uses the exact grid boundary. The
          // visible bank follows the smooth region mask rather than six lines.
          waterAlpha*=smooth(GROUND_RADIUS*.01,GROUND_RADIUS*.04,landDistance);
          // A warped sample can contain only water even inside the new bank.
          // Seed its adjacent land material so the bank still has a substrate.
          if(water>.9999&&waterAlpha<1){
            const i=ids.indexOf(shoreLand.material);weights[i]+=sum*.001;sum*=1.001;water/=1.001;
          }
        }
      }
      const shoreline=water>.0001&&water<.9999;let color=[0,0,0];
      // Blend snow coverage before thresholding it. Thresholding each material
      // separately clipped the same snow patch differently on neighbouring tiles.
      let coverage=0;
      for(let i=0;i<ids.length;i++)if(!WATER.has(ids[i]))coverage+=(WINTER_COVER[ids[i]]??.76)*weights[i]/sum;
      coverage/=Math.max(.00001,1-water);
      const frost=winter?smooth(-.18,.18,noise(wx*.48,wy*.48)*.65+coverage-.44)*(this.winterArtwork?.35:1):0;
      for(let i=0;i<ids.length;i++){
        const mat=ids[i];let weight=weights[i]/sum;if(shoreline)weight=WATER.has(mat)?weight/water*waterAlpha:weight/(1-water)*(1-waterAlpha);if(weight<.00001)continue;
        let c=this.sample(mat,wx,wy);
        if(winter&&!WATER.has(mat)){const snow=this.sample('snow',wx,wy);c=c.map((v,k)=>v+(snow[k]-v)*frost);}
        for(let k=0;k<3;k++)color[k]+=c[k]*weight;
      }
      if(shoreline){
        const bank=4*waterAlpha*(1-waterAlpha)*(winter?.96:.88),sand=this.sample(winter?'snow':'sand',wx,wy),dark=(1-smooth(.045,.10,Math.abs(waterAlpha-.83)))*(winter?.04:.12);
        // A cold ice fringe blends into the water beyond the snow-covered bank.
        const ice=winter?smooth(.55,.72,waterAlpha)*(1-smooth(.86,.99,waterAlpha))*.42:0;
        for(let k=0;k<3;k++)color[k]=(color[k]+(sand[k]-color[k])*bank)*(1-dark)*(1-ice)+[168,190,194][k]*ice;
      }
      if(tile.ruralYard&&this.materials.rural_yard){
        const alpha=ruralYardCoverage((gx-tile.x)/GROUND_RADIUS,(gy-tile.y)/GROUND_RADIUS),earth=this.sample(winter&&this.materials.winter_yard?'winter_yard':'rural_yard',wx,wy);
        for(let k=0;k<3;k++)color[k]+=(earth[k]-color[k])*alpha;
      }
      if(tile.mudPatches){
        let neighbors=0;
        for(let i=0;i<6;i++){const [dq,dr]=AXES[i];if(lut.get(key(q+dq,r+dr))?.mudPatches)neighbors|=1<<i;}
        const alpha=europeanMudCoverage(tile.q,tile.r,gx,gy,neighbors);
        const mud=this.sample('mud',wx,wy);
        for(let k=0;k<3;k++)color[k]+=(mud[k]-color[k])*alpha*.86;
      }
      // Composite runway rectangles across tile boundaries, as the old overlay
      // did. Clipping each wide strip to its own hex produces octagonal slabs.
      let runwayAlpha=0;
      for(const strip of runways){
        const dx=gx-strip.tile.x,dy=gy-strip.tile.y,u=dx*strip.n[0]+dy*strip.n[1],v=Math.abs(-dx*strip.n[1]+dy*strip.n[0]);
        const half=GROUND_RADIUS*.42,feather=GROUND_RADIUS*.012;
        const cross=1-smooth(half-feather,half+feather,v);
        const along=smooth(strip.min-feather,strip.min,u)*(1-smooth(strip.max,strip.max+feather,u));
        runwayAlpha=Math.max(runwayAlpha,cross*along);
      }
      if(runwayAlpha>0){
        const surface=this.sample('sand',wx,wy);
        for(let k=0;k<3;k++){const c=surface[k]*.25+[225,219,195][k]*.75;color[k]+=(c-color[k])*runwayAlpha;}
      } else if(tile.bridge>=0){
        const a=tile.bridge*Math.PI/3,dx=gx-tile.x,dy=gy-tile.y,u=dx*Math.cos(a)+dy*Math.sin(a),v=-dx*Math.sin(a)+dy*Math.cos(a),half=GROUND_RADIUS*.205;
        if(Math.abs(u)<=SQ*GROUND_RADIUS/2+GROUND_RADIUS*.08&&Math.abs(v)<=half+GROUND_RADIUS*.028){const rail=Math.abs(v)>half-GROUND_RADIUS*.027;let c=rail?[78,70,52]:this.sample('timber',u*sampleScale*2,v*sampleScale*2);if(!rail&&Math.abs(u%(GROUND_RADIUS*.13))<GROUND_RADIUS*.009)c=c.map(z=>z*.68);if(winter&&!rail){const snow=this.sample('snow',wx,wy);c=c.map((z,k)=>z+(snow[k]-z)*.22);}color=c;}
      } else if(!tile.runway) {
        const curved=this.curvedRoads&&(!winter||this.winterArtwork);
        let d=tile.roads?roadDistance(gx,gy,tile,curved):Infinity;
        for(const [dq,dr]of AXES){const n=lut.get(key(q+dq,r+dr));if(n?.roads&&n.bridge<0&&!n.runway)d=Math.min(d,roadDistance(gx,gy,n,curved));}
        if(d<GROUND_RADIUS*(winter?.36:curved?.40:.25)){const paving=fields.get(winter?'winter_paving':'paving'),city=paving?smooth(.08,.92,fieldAt(paving,fx,fy,fw,fh)):0,half=GROUND_RADIUS*(curved?.17+noise(wx*.85+13,wy*.85-91)*.018:.185+.010*city),alpha=1-smooth(half-GROUND_RADIUS*(curved?.014:.006),half+GROUND_RADIUS*(curved?.022:.034),d);
          const rural=this.sample(winter?'winter_soil':curved&&this.materials.road_surface?'road_surface':'soil',wx,wy),urban=this.sample(winter?'winter_paving':'paving',wx,wy),snow=winter?this.sample('snow',wx,wy):null,edge=curved?0:smooth(half*.84,half,d)*.18;
          if(curved){
            const variation=noise(wx*.8+32,wy*.8-18),outer=half+GROUND_RADIUS*(.21+variation*.025);
            const shoulder=(1-smooth(half+GROUND_RADIUS*.04,outer,d))*clamp(.46+variation*.24,.18,.70),dirt=this.sample(winter?'winter_soil':'soil',wx,wy);
            for(let k=0;k<3;k++)color[k]+=((dirt[k]*.45+(winter?[185,184,177]:[180,165,126])[k]*.55)-color[k])*shoulder;
          }
          const shoulder=snow?smooth(half*.85,half*1.12,d)*(1-smooth(half*1.25,GROUND_RADIUS*.36,d))*.8:0;
          const roadSnow=snow?.28+.50*smooth(half*.55,half,d):0;
          const tracks=curved?(1-smooth(GROUND_RADIUS*.008,GROUND_RADIUS*.030,Math.abs(d-GROUND_RADIUS*.075)))*.045:0;
          for(let k=0;k<3;k++){let c=rural[k]+(urban[k]*.76-rural[k])*city;if(snow)c+=(snow[k]-c)*roadSnow;c*=1-edge-tracks;color[k]+=(c-color[k])*alpha;if(snow)color[k]+=(snow[k]-color[k])*shoulder;}}
      }
      const i=(py*tw+px)*4;for(let k=0;k<3;k++)pixels[i+k]=Math.round(clamp(color[k],0,255));pixels[i+3]=255;
    }
    return {x,y,width,height,textureWidth:tw,textureHeight:th,pixels};
  }
}
