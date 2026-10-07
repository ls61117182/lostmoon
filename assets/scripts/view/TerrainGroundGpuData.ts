import type { Tile } from '../core/types';
import { europeanRoadVariantIndex, urbanRoadSpriteTransform } from '../core/UrbanTerrain';
import { GROUND_CHUNK_SIZE, GROUND_RADIUS, TerrainGroundRaster, terrainGroundFingerprint, terrainMaterial, type TerrainMaterialBundle } from './TerrainGroundRaster';

// Stable shader IDs. Every cell has its own duplicated border, so atlas filtering
// cannot pull an unrelated material into a shoreline or winter patch.
export const GPU_MATERIALS = ['grass','soil','mud','sand','water','deep_water','paving','snow','winter_water','timber','rural_yard','shallow_water','winter_ground','winter_mud','winter_soil','winter_paving','road_surface','forest_floor','winter_forest','winter_yard'] as const;
export const ATLAS_CELL = 386, ATLAS_COLUMNS = 4, ATLAS_ROWS = 5;
const axes = [[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]];
const sq = Math.sqrt(3);
export interface GpuChunkPlan {
  x:number; y:number; key:string; fingerprint:string; tiles:readonly Tile[];
}
export interface GpuTileData { q:number; r:number; width:number; height:number; ground:Uint8Array; roads:Uint8Array; hasWater:boolean; }
export class TerrainGroundGpuData {
  constructor(readonly bundle:TerrainMaterialBundle) {}
  atlas():{width:number;height:number;pixels:Uint8Array} {
    const materials=new TerrainGroundRaster(this.bundle).getGpuMaterials(),width=ATLAS_CELL*ATLAS_COLUMNS,height=ATLAS_CELL*ATLAS_ROWS,pixels=new Uint8Array(width*height*4);
    for(let id=0;id<GPU_MATERIALS.length;id++) {
      const name=GPU_MATERIALS[id];
      const source=materials[name]??materials[name==='road_surface'?'soil':name==='winter_forest'?'winter_ground':name==='winter_yard'?'rural_yard':'grass'];
      const ox=id%ATLAS_COLUMNS*ATLAS_CELL,oy=Math.floor(id/ATLAS_COLUMNS)*ATLAS_CELL;
      for(let y=0;y<ATLAS_CELL;y++)for(let x=0;x<ATLAS_CELL;x++) {
        const sx=Math.min(source.width-1,Math.max(0,Math.floor((x-1)*source.width/384)));
        const sy=Math.min(source.height-1,Math.max(0,Math.floor((y-1)*source.height/384)));
        const from=(sy*source.width+sx)*3,to=((oy+y)*width+ox+x)*4;
        pixels[to]=source.pixels[from];pixels[to+1]=source.pixels[from+1];pixels[to+2]=source.pixels[from+2];pixels[to+3]=255;
      }
    }
    return {width,height,pixels};
  }
  plans(tiles:readonly Tile[],winter:boolean):GpuChunkPlan[] {
    // Includes two neighbour rings and their road/shore effects. Only affected
    // chunks change fingerprint when a cell changes; camera motion changes none.
    const halo=GROUND_RADIUS*3;
    const origins=new Map<string,{x:number;y:number}>();
    for(const t of tiles) {
      const tx=sq*GROUND_RADIUS*(t.pos.q+t.pos.r/2),ty=1.5*GROUND_RADIUS*t.pos.r;
      for(let cy=Math.floor((ty-GROUND_RADIUS)/GROUND_CHUNK_SIZE);cy<=Math.floor((ty+GROUND_RADIUS)/GROUND_CHUNK_SIZE);cy++)
        for(let cx=Math.floor((tx-sq*GROUND_RADIUS/2)/GROUND_CHUNK_SIZE);cx<=Math.floor((tx+sq*GROUND_RADIUS/2)/GROUND_CHUNK_SIZE);cx++)origins.set(`${cx},${cy}`,{x:cx*GROUND_CHUNK_SIZE,y:cy*GROUND_CHUNK_SIZE});
    }
    return [...origins.values()].map(({x,y})=>{
      const nearby=tiles.filter(t=>{const tx=sq*GROUND_RADIUS*(t.pos.q+t.pos.r/2),ty=1.5*GROUND_RADIUS*t.pos.r;return tx>=x-halo&&tx<=x+GROUND_CHUNK_SIZE+halo&&ty>=y-halo&&ty<=y+GROUND_CHUNK_SIZE+halo;});
      nearby.sort((a,b)=>a.pos.r-b.pos.r||a.pos.q-b.pos.q);
      return {x,y,key:`${x},${y}`,tiles:nearby,fingerprint:terrainGroundFingerprint(nearby,winter)};
    });
  }
  tileData(tiles:readonly Tile[],winter:boolean):GpuTileData {
    const q=Math.min(...tiles.map(t=>t.pos.q))-1,r=Math.min(...tiles.map(t=>t.pos.r))-1;
    const width=Math.max(...tiles.map(t=>t.pos.q))-q+2,height=Math.max(...tiles.map(t=>t.pos.r))-r+2;
    const ground=new Uint8Array(width*height*4),roads=new Uint8Array(width*height*4),lut=new Map(tiles.map(t=>[`${t.pos.q},${t.pos.r}`,t]));
    let hasWater=false;
    for(const t of tiles) {
      const mud=!!this.bundle.fieldBasedLand&&!winter&&t.terrain==='mud';
      let mat=mud?'grass':terrainMaterial(t,winter);
      if(t.terrain==='forest') { if(winter&&this.bundle.materials.winter_forest)mat='winter_forest';else if(!winter&&this.bundle.materials.forest_floor)mat='forest_floor'; }
      const id=GPU_MATERIALS.indexOf(mat as typeof GPU_MATERIALS[number]);
      if(id<0)throw new Error(`Unsupported GPU terrain material: ${mat}`);
      hasWater ||= ['water','deep_water','winter_water','shallow_water'].includes(mat);
      const flags=t.roads??[],transform=urbanRoadSpriteTransform(flags),i=((t.pos.r-r)*width+t.pos.q-q)*4;
      ground[i]=id+1;ground[i+1]=transform?.mask??0;
      ground[i+2]=t.terrain==='water'&&t.bridgeEnds?t.bridgeEnds[0]%3+1:0;
      // The village floor is the substrate, including cells crossed by a road.
      // The bake shader composites road shoulders and road surfaces above it.
      const yard=!!t.hasBuilding&&!t.urbanKind&&!t.terrain.startsWith('urban_');
      ground[i+3]=(t.terrain==='airstrip'?1:0)+(mud?2:0)+(yard?4:0);
      roads[i]=transform?.canonicalMask??0;roads[i+1]=transform?.rotationSteps??0;roads[i+2]=europeanRoadVariantIndex(t.pos.q,t.pos.r);
      if(mud)axes.forEach(([dq,dr],bit)=>{if(lut.get(`${t.pos.q+dq},${t.pos.r+dr}`)?.terrain==='mud')roads[i+3]|=1<<bit;});
    }
    return {q,r,width,height,ground,roads,hasWater};
  }
}
