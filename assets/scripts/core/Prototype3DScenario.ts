/** Small, deterministic presentation sandbox. It never reads or writes campaign saves. */
import { axialEquals, axialToPixel, HEX_DIRECTIONS, hexDistance, hexLine, neighbor } from './HexGrid';
import type { Axial, Direction } from './types';

export const PROTOTYPE_HEX_RADIUS = 1.55;
export const prototypeKey = (p: Axial): string => `${p.q},${p.r}`;
export type PrototypeTerrain = 'grass' | 'road' | 'forest' | 'building';
export interface PrototypeCell { pos: Axial; terrain: PrototypeTerrain; blocked: boolean }

export function prototypeWorld(p: Axial): { x: number; z: number } {
  const point = axialToPixel(p, PROTOTYPE_HEX_RADIUS);
  return { x: point.x, z: point.y };
}

/** A continuous ramp joins the western meadow to the eastern plateau. */
export function prototypeHeight(x: number, _z: number): number {
  const t = Math.max(0, Math.min(1, (x + 0.8) / 5.2));
  return 1.4 * t * t * (3 - 2 * t);
}

export function createPrototypeCells(): PrototypeCell[] {
  const forest = new Set(['-3,0', '-3,1', '-2,-1', '-1,3', '0,3', '0,1', '2,-3', '3,-3', '3,0']);
  const buildings = new Set(['-1,-2', '0,-2']);
  const cells: PrototypeCell[] = [];
  for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) {
    if (hexDistance({ q, r }, { q: 0, r: 0 }) > 3) continue;
    const pos = { q, r }, key = prototypeKey(pos);
    const terrain: PrototypeTerrain = buildings.has(key) ? 'building' : forest.has(key) ? 'forest'
      : r === 0 ? 'road' : 'grass';
    cells.push({ pos, terrain, blocked: terrain === 'building' || terrain === 'forest' });
  }
  return cells;
}

export class Prototype3DBattle {
  readonly cells = createPrototypeCells();
  readonly cellMap = new Map(this.cells.map(cell => [prototypeKey(cell.pos), cell]));
  player: Axial = { q: -2, r: 1 };
  readonly enemy: Axial = { q: 2, r: -1 };
  playerHP = 3;
  enemyHP = 2;
  turn = 1;
  moves = 3;
  fired = false;

  get outcome(): 'playing' | 'won' | 'lost' {
    return this.enemyHP <= 0 ? 'won' : this.playerHP <= 0 ? 'lost' : 'playing';
  }

  reachablePaths(): Map<string, Axial[]> {
    const paths = new Map<string, Axial[]>([[prototypeKey(this.player), []]]);
    if (this.outcome !== 'playing') return paths;
    const queue = [this.player];
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i], path = paths.get(prototypeKey(current))!;
      if (path.length >= this.moves) continue;
      for (let d = 0; d < HEX_DIRECTIONS.length; d++) {
        const next = neighbor(current, d as Direction), key = prototypeKey(next);
        if (paths.has(key) || !this.cellMap.has(key) || this.cellMap.get(key)!.blocked || axialEquals(next, this.enemy)) continue;
        paths.set(key, [...path, next]);
        queue.push(next);
      }
    }
    return paths;
  }

  moveTo(destination: Axial): Axial[] | null {
    if (this.outcome !== 'playing') return null;
    const path = this.reachablePaths().get(prototypeKey(destination));
    if (!path?.length) return null;
    this.moves -= path.length;
    this.player = { ...destination };
    return path;
  }

  get inRange(): boolean { return hexDistance(this.player, this.enemy) <= 5; }

  get clearShot(): boolean {
    return hexLine(this.player, this.enemy).slice(1, -1).every(p => !this.cellMap.get(prototypeKey(p))?.blocked);
  }

  get canFire(): boolean { return this.outcome === 'playing' && !this.fired && this.inRange && this.clearShot; }

  fire(): boolean {
    if (!this.canFire) return false;
    this.fired = true;
    this.enemyHP--;
    return true;
  }

  /** Returns whether the stationary target fired back. */
  endTurn(): boolean {
    if (this.outcome !== 'playing') return false;
    const returnFire = this.inRange && this.clearShot;
    if (returnFire) this.playerHP--;
    if (this.outcome === 'playing') {
      this.turn++;
      this.moves = 3;
      this.fired = false;
    }
    return returnFire;
  }
}
