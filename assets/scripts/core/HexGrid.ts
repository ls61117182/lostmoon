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

import { Axial, Direction, FireDirection, Offset, Tile, tileHasBridge } from './types';

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

/** Six additional center-to-center rays between adjacent hex-axis directions. */
export const HEX_DIAGONAL_DIRECTIONS: ReadonlyArray<Axial> = HEX_DIRECTIONS.map((a, i) => {
  const b = HEX_DIRECTIONS[(i + 1) % 6];
  return { q: a.q + b.q, r: a.r + b.r };
});

export function isDiagonalFireDirection(direction: FireDirection): boolean {
  return direction >= 6;
}

/** Convert the compatibility encoding (0..5 axes, 6..11 diagonals) to 12 clock steps. */
export function fireDirectionStep(direction: FireDirection): number {
  return direction < 6 ? direction * 2 : (direction - 6) * 2 + 1;
}

export function fireDirectionVector(direction: FireDirection): Axial {
  return direction < 6 ? HEX_DIRECTIONS[direction] : HEX_DIAGONAL_DIRECTIONS[direction - 6];
}

/** 与方向索引 0..5 一一对应，仅作文案；与 `HEX_DIRECTIONS`、`TileDef.h` / `ef` 同序 */
export const HEX_DIRECTION_NAMES: readonly [string, string, string, string, string, string] = [
  'E', 'SE', 'SW', 'W', 'NW', 'NE',
];

/**
 * 轴向方向 `a` 与**绘制**时 `drawHedgeEdge` 所用弦边下标（`-30°+60°·i` 的第 `i` 条边）的对应。
 * `Tile.hedges[a]` 与 `HEX_DIRECTIONS[a]`、关卡 `h`/`ef` 均按**轴向** 0..5 编号；`drawHedgeEdge` 的入参是「顶点等分角」的边号，与轴向并非同一下标一一相同（仅 E、W 重合）。
 * 在 pointy-top + 本工程投影下为 **自逆置换** `[0,5,4,3,2,1]`。
 */
export const HEDGE_DRAW_EDGE_BY_AXIAL: readonly [number, number, number, number, number, number] = [
  0, 5, 4, 3, 2, 1,
];

/**
 * 将关卡 JSON 的 `h` 字串解析为六条格边的树篱标记（与 `Tile.hedges` 一致）。
 *
 * **与 `ef`、单位朝向、战场景观一致**：索引 `i` 与 `HEX_DIRECTIONS[i]` 相同，表示「自本格心指向第 i 个邻接格心」
 * 的那条边（自本格跨向邻格时经过的格边 / 法向即方向 i）。`h[i]===true` 表示该边外缘布设树篱；
 * 同格 `eid` 的 `ef` 亦为同一套 `i`（0=E, 顺时针 1=SE … 5=NE）。**渲染**树篱时须用 `HEDGE_DRAW_EDGE_BY_AXIAL[i]` 再传给 `drawHedgeEdge` 的几何边号。
 */
export function hedgeFlagsFromMapJson(s: string | undefined): Tile['hedges'] {
  if (!s || s.length !== 6) return undefined;
  return [
    s[0] === '1', s[1] === '1', s[2] === '1',
    s[3] === '1', s[4] === '1', s[5] === '1',
  ] as Tile['hedges'];
}

export function breakwaterFlagsFromMapJson(s: string | undefined): Tile['breakwaters'] {
  if (!s || s.length !== 6) return undefined;
  return [
    s[0] === '1', s[1] === '1', s[2] === '1',
    s[3] === '1', s[4] === '1', s[5] === '1',
  ] as Tile['breakwaters'];
}

/**
 * 将关卡 JSON 的 `rd` 字串解析为六条边方向上的"公路绘制"标记（与 `Tile.roads` 一致）。
 *
 * 与 `h` / `ef` 同序（轴向 0..5），第 i 位为 `'1'` 表示在本格内沿「第 i 向邻边中点 → 格心」绘制道路条带。
 * 仅作视觉，不影响移动 / 视线 / 骰子；具体绘制及"单方向画圆形道路尽头"逻辑在 `BattleScene.drawRoadOverlay` 中。
 */
export function roadFlagsFromMapJson(s: string | undefined): Tile['roads'] {
  if (!s || s.length !== 6) return undefined;
  return [
    s[0] === '1', s[1] === '1', s[2] === '1',
    s[3] === '1', s[4] === '1', s[5] === '1',
  ] as Tile['roads'];
}

/**
 * 将**旧版资源**中按「`h` 下标 = 几何边下标」直接绘制时的 6 位串，迁为**当前**轴向语义下的 `h`：
 * 对各位 `ax` 有 `h_new[ax] = h_old[ HEDGE_DRAW_EDGE_BY_AXIAL[ax] ]`，与 `BattleScene` 中 `HEDGE_DRAW_EDGE_BY_AXIAL` 联用后，**画面**与旧版仍一致，且与 `HEX_DIRECTIONS` / 越境规则一致。
 */
export function migrateHedgeHFromLegacyDraw(h: string | undefined): string | undefined {
  if (!h || h.length !== 6) return h;
  return HEDGE_DRAW_EDGE_BY_AXIAL.map((d) => h[d]).join('');
}

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
export function offsetToAxial(o: Offset, rowParityOffset: 0 | 1 = 0): Axial {
  // odd-r：奇数行向右偏移 0.5 格
  const parityRow = o.row + rowParityOffset;
  const q = o.col - ((parityRow - (parityRow & 1)) >> 1);
  const r = o.row;
  return { q, r };
}

/** Like directionTo, but also recognizes the six halfway rays used by hardcore turrets. */
export function fireDirectionTo(from: Axial, to: Axial): FireDirection | null {
  const axis = directionTo(from, to);
  if (axis !== null) return axis;
  if (axialEquals(from, to)) return null;
  const d = axialSub(to, from);
  for (let i = 0; i < 6; i++) {
    const u = HEX_DIAGONAL_DIRECTIONS[i];
    if (d.q * u.r === d.r * u.q
      && (u.q === 0 || Math.sign(d.q) === Math.sign(u.q))
      && (u.r === 0 || Math.sign(d.r) === Math.sign(u.r))) {
      return (i + 6) as FireDirection;
    }
  }
  return null;
}

/** Closest of the twelve turret directions, used only as a visual/AI fallback. */
export function approximateFireDirection(from: Axial, to: Axial): FireDirection {
  const exact = fireDirectionTo(from, to);
  if (exact !== null) return exact;
  const a = axialToPixel(from, 1);
  const b = axialToPixel(to, 1);
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  let best: FireDirection = 0;
  let bestDelta = Infinity;
  for (let direction = 0; direction < 12; direction++) {
    const fireDirection = direction as FireDirection;
    const v = axialToPixel(fireDirectionVector(fireDirection), 1);
    const candidate = Math.atan2(v.y, v.x);
    const delta = Math.abs(Math.atan2(Math.sin(angle - candidate), Math.cos(angle - candidate)));
    if (delta < bestDelta) {
      best = fireDirection;
      bestDelta = delta;
    }
  }
  return best;
}

export function axialToOffset(a: Axial, rowParityOffset: 0 | 1 = 0): Offset {
  const parityRow = a.r + rowParityOffset;
  const col = a.q + ((parityRow - (parityRow & 1)) >> 1);
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

  /**
   * 单位是否能进入该格（坦克视角，不考虑是否被占据）。
   *
   * - 林地永远不可入；
   * - 水域**默认**不可入，但若叠加了桥梁（GDD §3.2，`Tile.bridgeEnds` 非空）则可入；
   * - 其他基底（公路 / 田地 / 泥地）一律可入。
   *
   * 注意：本函数**只**校验目标格本身是否「物理上能站」。是否能从某条边跨入桥梁格、
   * 是否能从桥梁格沿某条边跨出，需另用 `canTankCrossEdge` 做边向校验。
   */
  canTankEnter(p: Axial): boolean {
    const t = this.get(p);
    if (!t) return false;
    if (t.terrain === 'forest' || t.terrain === 'rocky') return false;
    if (t.terrain === 'water' || t.terrain === 'deep_water') return tileHasBridge(t);
    return true;
  }

  hasBreakwaterBetween(from: Axial, to: Axial): boolean {
    if (hexDistance(from, to) !== 1) return false;
    const dirAB = directionTo(from, to);
    if (dirAB !== null && this.get(from)?.breakwaters?.[dirAB]) return true;
    const dirBA = directionTo(to, from);
    if (dirBA !== null && this.get(to)?.breakwaters?.[dirBA]) return true;
    return false;
  }

  /**
   * 是否允许坦克 / 卡车沿 `from → to` 跨过这条相邻格边（GDD §3.2 桥梁边向规则）。
   *
   * - `from` 与 `to` 必须严格相邻（`hexDistance === 1`），否则返回 false；
   * - `to` 必须能进入（`canTankEnter`）；
   * - 若 `from` 是桥梁格 → 出方向 `dir(from→to)` 须落在 `from.bridgeEnds` 中；
   * - 若 `to` 是桥梁格 → 入方向 `dir(to→from)` 须落在 `to.bridgeEnds` 中；
   * - 两端都是桥梁时上述两条同时生效（必须同时对齐）。
   *
   * 不在桥梁场景下，本函数行为退化为 `canTankEnter(to) && from-to 相邻`，与旧逻辑一致。
   */
  canTankCrossEdge(from: Axial, to: Axial, opts: { ignoreBreakwater?: boolean } = {}): boolean {
    if (hexDistance(from, to) !== 1) return false;
    if (!this.canTankEnter(to)) return false;
    if (!opts.ignoreBreakwater && this.hasBreakwaterBetween(from, to)) return false;
    const tFrom = this.get(from);
    const tTo = this.get(to);
    if (tileHasBridge(tFrom)) {
      const dirOut = directionTo(from, to);
      if (dirOut === null) return false;
      if (!tFrom!.bridgeEnds!.includes(dirOut)) return false;
    }
    if (tileHasBridge(tTo)) {
      const dirIn = directionTo(to, from);
      if (dirIn === null) return false;
      if (!tTo!.bridgeEnds!.includes(dirIn)) return false;
    }
    return true;
  }

  /**
   * 当某格在视线路径的**中间**（非起点、非终点）时，是否因此截断视线。
   * 林地、以及路径**中间**的带建筑格均阻挡；水域**不**阻挡视线（任何单位仍不可入）；
   * 建筑在起止格不调用本方法故不挡视线（含：建筑格内的单位可作为视线起点向外射击）。
   */
  lineOfSightBlockedByTile(t: Tile): boolean {
    if (t.terrain === 'forest' || t.terrain === 'rocky') return true;
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
   * Hardcore halfway rays pass between two adjacent hexes. For each such pair,
   * both flanking hexes must block LoS before the ray is considered blocked.
   */
  hasDiagonalLineOfSight(from: Axial, to: Axial, fireDirection: FireDirection): boolean {
    const diagonalIndex = fireDirection - 6;
    const a = diagonalIndex as Direction;
    const b = ((diagonalIndex + 1) % 6) as Direction;
    const rayVector = fireDirectionVector(fireDirection);
    const steps = hexDistance(from, to) / 2;
    let current = from;

    for (let step = 0; step < steps; step++) {
      const left = this.get(neighbor(current, a));
      const right = this.get(neighbor(current, b));
      if (left && right && this.lineOfSightBlockedByTile(left) && this.lineOfSightBlockedByTile(right)) {
        return false;
      }

      current = axialAdd(current, rayVector);
      if (step < steps - 1) {
        const centerTile = this.get(current);
        if (!centerTile || this.lineOfSightBlockedByTile(centerTile)) return false;
      }
    }

    return true;
  }

  /**
   * 计算射击路径上穿过的树篱数量（用于 §3.4 Step 1 命中所需点数中的"树篱数"修正项）。
   *
   * **GDD §3.4 规则**：若路径上的树篱"紧挨攻击者"，则**不计入**。"紧挨攻击者"指：
   *   1. 该树篱与攻击者**处于同一格子**（即 `from` 格 `hedges[dir(from→邻格)]` 命中）；
   *   2. 或该树篱所处格子**与攻击者相邻**且**树篱方向为攻击者所在格**（即 `path[1]` 格 `hedges[dir(path[1]→from)]` 命中）。
   *
   * 这两种情况都对应 `path[0]→path[1]` 这一条边——攻击者射出第一步穿过的那一段——
   * 实现上从 `i=1` 起累计后续所有边即可：第一条边永远跳过，自然把上述两种编码同时排除掉。
   *
   * 一条物理边可能被任一侧编码，因此 `i ≥ 1` 时同时检查两侧（`a.hedges[dirAB] || b.hedges[dirBA]`），
   * 任一侧命中即按 1 个树篱计数（不重复累加），与"该边是否有篱笆"语义一致。
   *
   * 起止格本身不计：循环上界为 `path.length - 1`，目标格 `path[length-1]` 不会作为起点被检查。
   */
  countHedgesAlong(from: Axial, to: Axial): number {
    const fireDirection = fireDirectionTo(from, to);
    if (fireDirection !== null && isDiagonalFireDirection(fireDirection)) {
      return this.countHedgesAlongDiagonal(from, to, fireDirection);
    }
    const path = hexLine(from, to);
    let count = 0;
    // 从 i=1 开始 → 跳过 path[0]→path[1] 这条紧挨攻击者的边
    for (let i = 1; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const dirAB = directionTo(a, b);
      if (dirAB === null) continue;
      const tileA = this.get(a);
      if (tileA?.hedges?.[dirAB]) {
        count++;
        continue;
      }
      // 兼容：同一物理边的另一侧编码（b 格指向 a 格的方向上写了树篱）
      const dirBA = directionTo(b, a);
      if (dirBA === null) continue;
      const tileB = this.get(b);
      if (tileB?.hedges?.[dirBA]) count++;
    }
    return count;
  }

  /**
   * A halfway ray runs through hex vertices. Count hedges on both alternating
   * shortest paths bordering that ray, then halve and round down. As with the
   * six old rays, both first edges adjacent to the attacker are ignored.
   */
  private countHedgesAlongDiagonal(from: Axial, to: Axial, fireDirection: FireDirection): number {
    const diagonalIndex = fireDirection - 6;
    const a = diagonalIndex as Direction;
    const b = ((diagonalIndex + 1) % 6) as Direction;
    const distance = hexDistance(from, to);
    const countPath = (first: Direction, second: Direction): number => {
      let current = from;
      let count = 0;
      for (let step = 0; step < distance; step++) {
        const direction = step % 2 === 0 ? first : second;
        const next = neighbor(current, direction);
        if (step > 0 && this.hasHedgeBetween(current, next)) count++;
        current = next;
      }
      return count;
    };
    return Math.floor((countPath(a, b) + countPath(b, a)) / 2);
  }

  private hasHedgeBetween(a: Axial, b: Axial): boolean {
    const dirAB = directionTo(a, b);
    const dirBA = directionTo(b, a);
    return (dirAB !== null && !!this.get(a)?.hedges?.[dirAB])
      || (dirBA !== null && !!this.get(b)?.hedges?.[dirBA]);
  }
}
