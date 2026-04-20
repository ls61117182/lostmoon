/**
 * 行动阶段骰子逻辑 —— 纯 TypeScript，不依赖 Cocos。
 *
 * 说明书 3.6 节规定：玩家进入"谢尔曼行动阶段"时先掷 N 颗骰子（N = 基础 3 +
 * 地形修正 + 舱盖修正 + 乘员修正，上限 5），再按骰面点数把每颗骰子拖进
 * A/B/C 三列行动槽。本 demo 与 GDD 口径保持一致，只是把它进一步拆成
 * "移动阶段 / 攻击阶段各自独立掷骰"——玩家手动选先进哪个阶段，
 * 每进一次都重摇一次骰。
 *
 * 本文件负责 2 件事：
 *  1) 给出"某阶段进骰池的大小"的纯函数；
 *  2) 把单颗骰子点数 → 该阶段可用动作 的查表函数；
 *
 * 不触及 Unit / Map，这样以后写单元测试可以直接跑。
 */

import { RNG } from './Dice';
import { TerrainType } from './types';

// ---------- 动作分类 ----------

/**
 * 移动阶段骰面含义（说明书 3.6 表）：
 *   1        → 无
 *   2        → 启动（本 demo 未实装发动机熄火机制，玩家把它当废骰放弃即可）
 *   3 / 4    → 转向 1 次（60°，顺时针或逆时针由玩家选）
 *   5 / 6    → 前进 1 格；允许玩家改为"后退"（说明书里"后退"属痛痪解除后的普通驾驶动作）
 */
export type MoveDieAction = 'none' | 'start' | 'turn' | 'drive';

/**
 * 攻击阶段骰面含义（说明书 3.6 表）：
 *   1 / 2    → 装填 1 次
 *   3 / 4    → 机枪射击（相邻步兵）
 *   5 / 6    → 主炮射击（必须已装填）
 *
 * MVP 把"对子"相关的特殊组合（如 对子 → 炮手主炮射击/装填）留空，
 * 对子的每颗骰仍作为普通骰分别使用。
 */
export type AttackDieAction = 'none' | 'reload' | 'mg' | 'gun';

export function classifyMoveDie(pt: number): MoveDieAction {
  if (pt === 1) return 'none';
  if (pt === 2) return 'start';
  if (pt === 3 || pt === 4) return 'turn';
  if (pt === 5 || pt === 6) return 'drive';
  return 'none';
}

export function classifyAttackDie(pt: number): AttackDieAction {
  if (pt === 1 || pt === 2) return 'reload';
  if (pt === 3 || pt === 4) return 'mg';
  if (pt === 5 || pt === 6) return 'gun';
  return 'none';
}

// ---------- 行动骰池 ----------

export interface ActionDicePoolOpts {
  /** 谢尔曼当前所在格的地形 */
  terrain: TerrainType;
  /** 车长舱盖是否打开 */
  hatchOpen: boolean;
}

/**
 * 本阶段应掷骰数。
 *
 * 手册修正：
 *   基础 3；公路 +1；泥地 -1；舱盖打开 +1；上限 5；下限 1（防止极端修正下永远 0 骰）
 *
 * 乘员修正 MVP 暂未落实（驾驶员/炮手阵亡的细则后续迭代时补）。
 */
export function actionDicePool(opts: ActionDicePoolOpts): number {
  let n = 3;
  if (opts.terrain === 'road') n += 1;
  else if (opts.terrain === 'mud') n -= 1;
  if (opts.hatchOpen) n += 1;
  return Math.max(1, Math.min(5, n));
}

/** 用给定 RNG 掷 count 颗 d6，返回长度为 count 的点数数组。 */
export function rollActionDice(rng: RNG, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(rng.d6());
  return out;
}
