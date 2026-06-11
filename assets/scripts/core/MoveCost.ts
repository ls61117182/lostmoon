import { effectiveDiceTerrain, TerrainType, Tile } from './types';

/**
 * 谢尔曼/坦克进入该地形需消耗的"行动力"点数。
 *
 * 这是把手册原版的"骰子加减"机制简化为离散点数的近似：
 *   手册 → 本 demo
 *   公路：移动阶段 +1 骰   → 1 点（便宜）
 *   田地：无修正           → 1 点（基准）
 *   泥地：移动阶段 -1 骰   → 2 点（昂贵）
 *
 * 林地 / **未叠桥水域** 在 HexMap.canTankEnter 已被拒绝，正常流程不会调用到这里。
 * 但本函数仍然返回 Infinity 作为防御性兜底，方便 AI / 路径搜索代码统一处理。
 * 注：「水域+桥梁」由 `tileMoveCost` 经 `effectiveDiceTerrain` 折算成 'road' 后再读，自然 = 1。
 *
 * **桥梁叠加（GDD §3.2）**：水域格叠桥梁时移动力消耗与公路相同。本函数仅看
 * `TerrainType`，对桥梁不感知；要正确处理「水域+桥梁=公路」请改用 `tileMoveCost(tile)`。
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
    case 'deep_water': return Infinity;
    case 'clear':    return 1;
    case 'trees':    return 1;
    case 'beach':    return 1;
    case 'rocky':    return Infinity;
    case 'airstrip': return 1;
  }
}

/**
 * 基于 `Tile` 的移动力消耗：自动应用 GDD §3.2 桥梁叠加（水域+桥梁视为公路）。
 * 任何拿到具体 `Tile` 的调用方都应优先用本函数，而不是 `terrainMoveCost(tile.terrain)`，
 * 否则桥梁格会被错误地按"水域 → Infinity"拒绝。
 */
export function tileMoveCost(tile: Tile | undefined | null): number {
  return terrainMoveCost(effectiveDiceTerrain(tile));
}
