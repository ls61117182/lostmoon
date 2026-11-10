import type { Direction, Tile, TileDef } from './types';
import { ROAD_CANONICAL_MASKS, roadSpriteTransform } from './UrbanTerrain';
import { axialToOffset, neighbor, offsetToAxial } from './HexGrid';
import { clearRailwayEdgeHedges } from './RailwayHedges';

/** Railway is an overlay. All current unit rules continue to read Tile.terrain. */
export const RAILWAY_ART_MASKS = ROAD_CANONICAL_MASKS;
export const RAILWAY_ART_SIZE = 256;

export function parseRailway(raw: string | undefined, terrain: Tile['terrain']): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !/^[01]{6}$/.test(raw)) {
    throw new Error('Railway rl must contain six 0/1 flags (E, SE, SW, W, NW, NE)');
  }
  if (!['field', 'road', 'mud'].includes(terrain)) {
    throw new Error('Railway requires field, road or mud terrain');
  }
  return raw === '000000' ? undefined : raw;
}

export function railwayArtTransform(connections: string, crossing = false) {
  if (typeof connections !== 'string' || !/^[01]{6}$/.test(connections)) {
    throw new Error('Railway connections must contain six 0/1 flags');
  }
  const transform = roadSpriteTransform([...connections].map(bit => bit === '1'));
  if (!transform) return null;
  return { ...transform,
    surface: `textures/terrain/railway/railway_${transform.canonicalFlags}${crossing ? '_crossing' : ''}_v1/spriteFrame`,
  };
}

/** Timber infill is only needed when a road crosses rather than follows the rails. */
export function railwayHasCrossing(tile: Pick<Tile, 'terrain' | 'railway' | 'roads'>): boolean {
  return tile.terrain === 'road' && !!tile.railway
    && (!tile.roads?.some(Boolean) || tile.roads.some((enabled, d) => enabled && tile.railway![d] !== '1'));
}

type EditorGrid = Array<Array<TileDef | null>>;
export function editorAllowsRailway(tile: TileDef | null | undefined): boolean {
  return !!tile && ['f', 'r', 'm'].includes(tile.t);
}

/** Match adjacent authored railway ports, including maps with shifted row parity. */
export function setEditorRailwayConnection(grid: EditorGrid, row: number, col: number, dir: Direction,
  enabled: boolean, parity: 0 | 1 = 0): boolean {
  const tile = grid[row]?.[col];
  if (!editorAllowsRailway(tile)) return false;
  const write = (target: TileDef, direction: number) => {
    const bits = [...(target.rl ?? '000000')]; bits[direction] = enabled ? '1' : '0';
    const next = bits.join('');
    if (next === '000000') delete target.rl; else target.rl = next;
  };
  write(tile!, dir);
  const offset = axialToOffset(neighbor(offsetToAxial({ row, col }, parity), dir), parity);
  const other = grid[offset.row]?.[offset.col];
  if (editorAllowsRailway(other) && (enabled || other?.rl)) write(other!, (dir + 3) % 6);
  if (enabled) clearRailwayEdgeHedges(grid, row, col, dir, parity);
  return true;
}

const railwayClearanceCache = new Map<string, (x: number, y: number) => number>();

/** Distance outside the authored ballast/wood footprint, in hex radii and Y-up coordinates. */
export function railwaySurfaceClearance(connections: string, crossing = false): ((x: number, y: number) => number) | undefined {
  if (!connections || connections === '000000') return undefined;
  const cacheKey = `${connections}:${crossing}`;
  const cached = railwayClearanceCache.get(cacheKey);
  if (cached) return cached;
  const art = railwayArtTransform(connections)!;
  const ports = Array.from({ length: 6 }, (_, d) => d).filter(d => art.canonicalMask & (1 << d));
  const separation = (a: number, b: number) => Math.min(Math.abs(a-b), 6-Math.abs(a-b));
  const pairs: Array<[number, number | null]> = [];
  if (ports.length === 1) pairs.push([ports[0], null]);
  else {
    let main: [number, number] = [ports[0], ports[1]];
    for (const a of ports) for (const b of ports) if (separation(a,b) > separation(...main)) main = [a,b];
    pairs.push(main);
    const used = new Set(main);
    for (const a of ports) if (!used.has(a) && ports.includes((a+3)%6) && !used.has((a+3)%6)) {
      pairs.push([a,(a+3)%6]); used.add(a); used.add((a+3)%6);
    }
    for (const a of ports) if (!used.has(a)) pairs.push([a,[...main].sort((b,c)=>separation(a,c)-separation(a,b))[0]]);
  }
  const extent = Math.sqrt(3)/2 + 3/128;
  const point = (dir: number, radius = extent) => [Math.cos(dir*Math.PI/3)*radius, -Math.sin(dir*Math.PI/3)*radius];
  const segments: Array<{x:number;y:number;dx:number;dy:number;length2:number}> = [];
  const decks: number[][] = [];
  for (const [a,b] of pairs) {
    const start=point(a), end=b===null?[0,0]:point(b), straight=b===null||separation(a,b)===3;
    const handle=(b!==null&&separation(a,b)===1?108:80)/128;
    const p1=straight?start.map((v,i)=>v+(end[i]-v)/3):point(a,extent-handle);
    const p2=straight?start.map((v,i)=>v+(end[i]-v)*2/3):point(b!,extent-handle);
    let previous=start;
    let deckCenter=straight ? (b===null?end:start.map((v,i)=>(v+end[i])/2)) : start;
    const count=straight?1:48;
    for(let i=1;i<=count;i++) {
      const t=i/count,u=1-t;
      const next=[0,1].map(k=>u*u*u*start[k]+3*u*u*t*p1[k]+3*u*t*t*p2[k]+t*t*t*end[k]);
      if (Math.hypot(...next) < Math.hypot(...deckCenter)) deckCenter=next;
      const dx=next[0]-previous[0],dy=next[1]-previous[1];
      segments.push({x:previous[0],y:previous[1],dx,dy,length2:dx*dx+dy*dy});previous=next;
    }
    if (crossing) decks.push(deckCenter);
  }
  const angle=art.rotationSteps*Math.PI/3,c=Math.cos(angle),s=Math.sin(angle);
  const clearance=(x:number,y:number)=>{
    const px=x*c-y*s,py=x*s+y*c;
    let best=Infinity;
    for(const segment of segments) {
      const dx=px-segment.x,dy=py-segment.y;
      const t=Math.max(0,Math.min(1,(dx*segment.dx+dy*segment.dy)/segment.length2));
      best=Math.min(best,(dx-t*segment.dx)**2+(dy-t*segment.dy)**2);
    }
    // Includes the gravel shoulder, scattered stones and crossing timber.
    let distance=Math.sqrt(best)-.22;
    for(const p of decks) distance=Math.min(distance,Math.hypot(px-p[0],py-p[1])-.28);
    return distance;
  };
  railwayClearanceCache.set(cacheKey,clearance);
  return clearance;
}

export function clearEditorRailway(grid: EditorGrid, row: number, col: number, parity: 0 | 1 = 0): void {
  const tile = grid[row]?.[col];
  if (!tile) return;
  const connections = tile.rl;
  delete tile.rl;
  for (let d = 0; d < 6; d++) {
    if (connections?.[d] !== '1') continue;
    const offset = axialToOffset(neighbor(offsetToAxial({ row, col }, parity), d as Direction), parity);
    const other = grid[offset.row]?.[offset.col];
    if (!other?.rl) continue;
    const bits = [...other.rl]; bits[(d + 3) % 6] = '0';
    const next = bits.join('');
    if (next === '000000') delete other.rl; else other.rl = next;
  }
}
