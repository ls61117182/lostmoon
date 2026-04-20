import { hexDistance, neighbors, HexMap } from './HexGrid';
import { terrainMoveCost } from './MoveCost';
import { Axial, Unit } from './types';

export interface EnemyMoveDecision {
  to: Axial;
  cost: number;
}

/**
 * 简化敌方 AI：贪心地"向谢尔曼走一步"。
 *
 * 选格规则（按优先级）：
 *   1. 必须严格靠近谢尔曼（避免无意义反复横跳）
 *   2. 行动力开销 ≤ 当前剩余预算
 *   3. 在所有满足 1+2 的候选里，按 (距离, 开销) 字典序选最小
 *      —— 距离更近优先；同样距离，便宜的优先（绕开泥地）
 *
 * 当前不考虑：
 *   - 多步路径规划（绕过 ≥1 格的障碍）
 *   - 射击/停下开火（贴脸傻冲）
 *   - 朝向旋转开销
 * 这些等"完整 AI 表"那一阶段再补。
 *
 * @param enemy        要决策的敌方单位
 * @param sherman      目标
 * @param map          地图（提供 canTankEnter 与 tile 信息）
 * @param otherUnits   除 enemy 自己外，所有占格单位（含其它敌坦克 + 谢尔曼若需）
 * @param budget       该敌人剩余的行动力点数
 * @returns 决策（含目标格与开销）；若没有更优落点返回 null（原地不动）
 */
export function decideEnemyMove(
  enemy: Unit,
  sherman: Unit,
  map: HexMap,
  otherUnits: Unit[],
  budget: number,
): EnemyMoveDecision | null {
  const currentDist = hexDistance(enemy.pos, sherman.pos);
  const occupied = new Set<string>();
  for (const u of otherUnits) occupied.add(`${u.pos.q},${u.pos.r}`);
  // 谢尔曼自己也占格（敌人不能"踩进谢尔曼"，撞击/接触留给战斗系统处理）
  occupied.add(`${sherman.pos.q},${sherman.pos.r}`);

  let best: Axial | null = null;
  let bestDist = currentDist;
  let bestCost = Infinity;

  for (const n of neighbors(enemy.pos)) {
    if (!map.canTankEnter(n)) continue;
    if (occupied.has(`${n.q},${n.r}`)) continue;
    const tile = map.get(n);
    if (!tile) continue;
    const cost = terrainMoveCost(tile.terrain);
    if (cost > budget) continue;
    const d = hexDistance(n, sherman.pos);
    if (d >= currentDist) continue; // 必须严格靠近

    if (d < bestDist || (d === bestDist && cost < bestCost)) {
      best = n;
      bestDist = d;
      bestCost = cost;
    }
  }

  return best ? { to: best, cost: bestCost } : null;
}
