/**
 * 骰子工具 —— 可种子化的随机数生成器，便于回放和单元测试。
 *
 * 用法：
 *   const rng = new RNG(12345);
 *   rng.d6();           // 1..6
 *   rng.dice(5);        // 摇 5 颗骰，返回 number[]
 *   rng.pick(arr);      // 从数组中随机选 1 个
 */

export class RNG {
  private state: number;

  constructor(seed?: number) {
    // 默认用时间种子；传入种子则可复现
    this.state = (seed ?? Date.now()) >>> 0;
    if (this.state === 0) this.state = 1; // mulberry32 不能为 0
  }

  /** mulberry32：极简、足够战棋用、可复现 */
  next(): number {
    let t = (this.state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 单颗 d6，返回 1..6 */
  d6(): number {
    return Math.floor(this.next() * 6) + 1;
  }

  /** 摇 n 颗 d6 */
  dice(n: number): number[] {
    const r: number[] = [];
    for (let i = 0; i < n; i++) r.push(this.d6());
    return r;
  }

  /** [min, max] 闭区间整数 */
  intRange(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** 数组随机取一 */
  pick<T>(arr: ReadonlyArray<T>): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** 取当前种子（可用于存档） */
  getState(): number {
    return this.state;
  }
}

// ---------- 骰子结果工具 ----------
/** 是否为对子（两颗骰点数相同） */
export function isDoubles(rolls: number[]): boolean {
  return rolls.length === 2 && rolls[0] === rolls[1];
}

/** 找出所有同点对 */
export function findPairs(rolls: number[]): number[] {
  const counts = new Map<number, number>();
  for (const r of rolls) counts.set(r, (counts.get(r) ?? 0) + 1);
  const pairs: number[] = [];
  counts.forEach((c, v) => { if (c >= 2) pairs.push(v); });
  return pairs;
}
