/**
 * 简易自检脚本：直接运行（或在 Cocos 启动时调用）会把核心模块跑一遍，
 * 在控制台输出地图统计、距离、视线、攻击命中所需值等，方便确认逻辑正确。
 *
 * 运行方式 A（Cocos 内）：
 *   import { runSelfTest } from './core/SelfTest';
 *   runSelfTest(missionJson);
 *
 * 运行方式 B（命令行）：
 *   npx ts-node assets/scripts/core/SelfTest.ts
 *   （需要先 `npm i -D ts-node typescript` 并准备好任务 JSON）
 */

import { hexDistance, neighbor, HexMap, axialToOffset } from './HexGrid';
import { loadMission } from './MissionLoader';
import { MissionData } from './types';
import { RNG } from './Dice';

export function runSelfTest(missionJson: MissionData): void {
  console.log('=== Sherman Self-Test ===');
  const { map, sherman, enemies } = loadMission(missionJson, new RNG(42));

  // 1. 地图统计
  const tiles = map.all();
  const counts: Record<string, number> = {};
  for (const t of tiles) counts[t.terrain] = (counts[t.terrain] ?? 0) + 1;
  console.log(`地图共 ${tiles.length} 格，分布:`, counts);

  // 2. 谢尔曼信息
  const sOff = axialToOffset(sherman.pos);
  console.log(`谢尔曼位于 col=${sOff.col} row=${sOff.row}, 朝向 ${sherman.facing}`);
  console.log(`乘员:`, sherman.crew);

  // 3. 敌方信息 + 距离
  for (const e of enemies) {
    const off = axialToOffset(e.pos);
    const dist = hexDistance(sherman.pos, e.pos);
    const los = map.hasLineOfSight(sherman.pos, e.pos);
    const hedges = map.countHedgesAlong(sherman.pos, e.pos);
    console.log(
      `${e.kind} @ col=${off.col} row=${off.row}` +
      ` | 距离 ${dist} | 视线 ${los ? '通畅' : '阻挡'} | 穿过树篱 ${hedges}`
    );

    if (los) {
      // 计算"命中所需"（不含方向修正、不含烟雾/隐蔽）
      const need = e.stats.size + dist + hedges;
      console.log(`  → 命中 IV 号需要 2d6 > ${need}`);
    }
  }

  // 4. 摇骰演示
  const rng = new RNG(20260420); // 固定种子可复现
  const rolls = rng.dice(5);
  console.log(`摇 5 颗骰（种子 20260420）:`, rolls);

  // 5. 邻居演示：谢尔曼正前方格
  if (sherman.facing !== null) {
    const front = neighbor(sherman.pos, sherman.facing);
    const frontTile = map.get(front);
    console.log(`正前方格:`, axialToOffset(front), `地形 = ${frontTile?.terrain ?? '出图'}`);
    console.log(`坦克可入: ${map.canTankEnter(front)}`);
  }

  console.log('=== Self-Test Done ===');
}
