/**
 * 六角格工具集 —— 纯 TypeScript，不依赖 Cocos。
 *
 * 采用 pointy-top（尖顶在上下）六边形 + Axial 坐标 (q, r)。
 * 方向编号顺时针从正东开始：
 *      0=E, 1=SE, 2=SW, 3=W, 4=NW, 5=NE
 *
 *           NW(4)  NE(5)
 *              \  /
 *      W(3) -- HEX -- E(0)
 *              /  \
 *           SW(2)  SE(1)
 */

import { Axial, Direction, Offset, Tile } from './types';

// ---------- 常量 ----------
/** 6 个方向对应的 (dq, dr) 偏移（pointy-top, 顺时针自东） */
export const HEX_DIRECTIONS: ReadonlyArray<Axial> = [
  { q: +1, r:  0 }, // 0 E
  { q:  0, r: +1 }, // 1 SE
  { q: -1, r: +1 }, // 2 SW
  { q: -1, r:  0 }, // 3 W
  { q:  0, r: -1 }, // 4 NW
  { q: +1, r: -1 }, // 5 NE
];

// ---------- 基础运算 ----------
export function axialEquals(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

export function axialAdd(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function axialSub(a: Axial, b: Axial): Axial {
  return { q: a.q - b.q, r: a.r - b.r };
}

/** 六边形距离（cube distance） */
export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** 取某方向的邻居坐标 */
export function neighbor(pos: Axial, dir: Direction): Axial {
  return axialAdd(pos, HEX_DIRECTIONS[dir]);
}

/** 取所有邻居 */
export function neighbors(pos: Axial): Axial[] {
  return HEX_DIRECTIONS.map(d => axialAdd(pos, d));
}

/** 顺时针旋转方向 n 步（n 可为负） */
export function rotateDirection(dir: Direction, steps: number): Direction {
  return (((dir + steps) % 6) + 6) % 6 as Direction;
}

/**
 * 近似方向：从 from 看向 to 最接近的六向之一。
 * 和 directionTo 不同，即使二者不在同一 hex 直线上也返回 best-effort 结果，
 * 主要用于"目标受到攻击时该用哪一面装甲"这类需要模糊方向的场合。
 */
export function approximateDirection(from: Axial, to: Axial): Direction {
  if (axialEquals(from, to)) return 0;
  // 用 cube 坐标下 6 个单位向量与 (Δq,Δr,Δs) 点积最大化；
  // cube 坐标消除了 axial 的非正交偏差，点积即可正确比较。
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  const ds = -dq - dr;
  const CUBE: ReadonlyArray<[number, number, number]> = [
    [+1,  0, -1], // 0 E
    [ 0, +1, -1], // 1 SE
    [-1, +1,  0], // 2 SW
    [-1,  0, +1], // 3 W
    [ 0, -1, +1], // 4 NW
    [+1, -1,  0], // 5 NE
  ];
  let best: Direction = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < 6; i++) {
    const [cq, cr, cs] = CUBE[i];
    const dot = dq * cq + dr * cr + ds * cs;
    if (dot > bestScore) {
      bestScore = dot;
      best = i as Direction;
    }
  }
  return best;
}

/** 计算从 from 看向 to 应该面对的方向（仅当二者在同一直线上时返回，否则返回 null） */
export function directionTo(from: Axial, to: Axial): Direction | null {
  if (axialEquals(from, to)) return null;
  const d = axialSub(to, from);
  // 沿某条直线 → d 与 HEX_DIRECTIONS[i] 成正比
  for (let i = 0; i < 6; i++) {
    const u = HEX_DIRECTIONS[i];
    if (u.q === 0) {
      if (d.q === 0 && Math.sign(d.r) === Math.sign(u.r)) return i as Direction;
    } else if (u.r === 0) {
      if (d.r === 0 && Math.sign(d.q) === Math.sign(u.q)) return i as Direction;
    } else {
      // u.q != 0 && u.r != 0
      if (d.q * u.r === d.r * u.q && Math.sign(d.q) === Math.sign(u.q)) {
        return i as Direction;
      }
    }
  }
  return null;
}

// ---------- Offset ↔ Axial（odd-r 偏移，pointy-top 标准） ----------
export function offsetToAxial(o: Offset): Axial {
  // odd-r：奇数行向右偏移 0.5 格
  const q = o.col - ((o.row - (o.row & 1)) >> 1);
  const r = o.row;
  return { q, r };
}

export function axialToOffset(a: Axial): Offset {
  const col = a.q + ((a.r - (a.r & 1)) >> 1);
  const row = a.r;
  return { col, row };
}

// ---------- 屏幕坐标（用于 Cocos 渲染） ----------
/**
 * Axial → 世界坐标（pointy-top）
 * @param size 单边长（像素）
 */
export function axialToPixel(a: Axial, size: number): { x: number; y: number } {
  const x = size * Math.sqrt(3) * (a.q + a.r / 2);
  // 注意：屏幕 Y 通常向上为正；这里返回数学坐标，渲染时根据 Cocos 习惯取反
  const y = size * 1.5 * a.r;
  return { x, y };
}

// ---------- 视线（Bresenham 风格的六边形线） ----------
/**
 * 计算从 a 到 b 经过的所有格子（含端点）。
 * 用线性插值 + cube round 实现，常用于视线 / 射程检测。
 */
export function hexLine(a: Axial, b: Axial): Axial[] {
  const N = hexDistance(a, b);
  if (N === 0) return [a];
  const result: Axial[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const q = a.q + (b.q - a.q) * t;
    const r = a.r + (b.r - a.r) * t;
    result.push(cubeRound(q, r));
  }
  return result;
}

/** 浮点 axial 取整（cube round） */
function cubeRound(qf: number, rf: number): Axial {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  let s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

// ---------- 地图容器 ----------
export class HexMap {
  private grid: Map<string, Tile> = new Map();
  readonly cols: number;
  readonly rows: number;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }

  static keyOf(p: Axial): string {
    return `${p.q},${p.r}`;
  }

  set(tile: Tile) {
    this.grid.set(HexMap.keyOf(tile.pos), tile);
  }

  get(p: Axial): Tile | undefined {
    return this.grid.get(HexMap.keyOf(p));
  }

  has(p: Axial): boolean {
    return this.grid.has(HexMap.keyOf(p));
  }

  all(): Tile[] {
    return Array.from(this.grid.values());
  }

  /** 单位是否能进入该格（坦克视角，不考虑是否被占据） */
  canTankEnter(p: Axial): boolean {
    const t = this.get(p);
    if (!t) return false;
    if (t.terrain === 'forest' || t.terrain === 'water') return false;
    return true;
  }

  /**
   * 当某格在视线路径的**中间**（非起点、非终点）时，是否因此截断视线。
   * 林地/水域、以及路径**中间**的带建筑格均阻挡；建筑在起止格不调用本方法故不挡视线
   *（含：建筑格内的单位可作为视线起点向外射击）。
   */
  lineOfSightBlockedByTile(t: Tile): boolean {
    if (t.terrain === 'forest' || t.terrain === 'water') return true;
    if (t.hasBuilding) return true;
    return false;
  }

  /**
   * 计算 from → to 之间是否有视线。
   * 规则：除起止格外，路径上任何阻挡视线的地形/建筑（中间格）会切断视线。
   */
  hasLineOfSight(from: Axial, to: Axial): boolean {
    const path = hexLine(from, to);
    for (let i = 1; i < path.length - 1; i++) {
      const t = this.get(path[i]);
      if (!t) return false;
      if (this.lineOfSightBlockedByTile(t)) return false;
    }
    return true;
  }

  /**
   * 计算射击路径上穿过的树篱数量（不含目标格本身的树篱）。
   * 简化实现：累计每段相邻格之间的树篱标记。
   */
  countHedgesAlong(from: Axial, to: Axial): number {
    const path = hexLine(from, to);
    let count = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const dir = directionTo(a, b);
      if (dir === null) continue;
      const tile = this.get(a);
      if (tile?.hedges?.[dir]) count++;
    }
    return count;
  }
}
