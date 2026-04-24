import { TerrainType } from './types';

/**
 * 谢尔曼/坦克进入该地形需消耗的"行动力"点数。
 *
 * 这是把手册原版的"骰子加减"机制简化为离散点数的近似：
 *   手册 → 本 demo
 *   公路：移动阶段 +1 骰   → 1 点（便宜）
 *   田地：无修正           → 1 点（基准）
 *   泥地：移动阶段 -1 骰   → 2 点（昂贵）
 *
 * 林地/水域在 HexMap.canTankEnter 已被拒绝，正常流程不会调用到这里。
 * 但本函数仍然返回 Infinity 作为防御性兜底，方便 AI/路径搜索代码统一处理。
 *
 * 未来若要支持"穿越树篱 +1 行动力"，新增一个 `hedgeCost(crossing: boolean)`
 * 函数即可，无需改动本函数签名。
 */
export function terrainMoveCost(t: TerrainType): number {
  switch (t) {
    case 'road':     return 1;
    case 'field':    return 1;
    case 'mud':      return 2;
    case 'forest':   return Infinity;
    case 'water':    return Infinity;
  }
}
