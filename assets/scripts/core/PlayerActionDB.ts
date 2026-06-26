/**
 * 玩家行动表与骰池 —— 自动生成，请勿手改本文件。
 *
 * 数据源：data/player_action_table.csv + data/player_dice_pool.csv
 * 重新生成：node tools/buildPlayerActionDB.js
 * 对应 GDD §3.6 行动表 + §3.6.1 掷骰数。
 */

import { TerrainType } from './types';

/** A 列：移动骰可映射到的动作枚举。MVP 实际消费 none / turn / drive / reverse，start 预留给未来的启动检定，driver_drive_codriver_turn 预留给对子合并玩法（驾驶员前进 / 副驾驶转向，二选一）。 */
export type MoveDieAction = 'none' | 'start' | 'turn' | 'drive' | 'reverse' | 'driver_drive_codriver_turn';

/** B 列：攻击骰可映射到的动作枚举。MVP 实际消费 none / reload / mg / gun。 */
export type AttackDieAction = 'none' | 'reload' | 'mg' | 'gun' | 'gunner_gun_or_reload';

/** C 列：杂项骰可映射到的动作枚举。MVP 尚未开放该阶段，仅作数据存根，运行时暂不读取。 */
export type MiscDieAction = 'none' | 'gunner_gun_or_reload' | 'codriver_mg' | 'driver_turn_or_drive' | 'repair' | 'smoke_or_repair' | 'fire_suppress' | 'concealment';

/** 行动表的一行：三列动作 */
export interface ActionTableRow {
  move: MoveDieAction;
  attack: AttackDieAction;
  misc: MiscDieAction;
}

/** 1..6 骰面 → 行动表行。0 下标不用；访问请用 pip 值直接索引。 */
export const PLAYER_ACTION_BY_PIP: Record<1 | 2 | 3 | 4 | 5 | 6, ActionTableRow> = {
  1: { move: 'reverse', attack: 'reload', misc: 'fire_suppress' },
  2: { move: 'turn', attack: 'reload', misc: 'repair' },
  3: { move: 'turn', attack: 'mg', misc: 'smoke_or_repair' },
  4: { move: 'turn', attack: 'mg', misc: 'codriver_mg' },
  5: { move: 'drive', attack: 'gun', misc: 'driver_turn_or_drive' },
  6: { move: 'drive', attack: 'gun', misc: 'gunner_gun_or_reload' },
};

/** 对子（两颗同点）特殊行：MVP 不消费，仅保留给未来的对子合并玩法。 */
export const PLAYER_ACTION_DOUBLES: ActionTableRow = {
  move: 'driver_drive_codriver_turn',
  attack: 'gunner_gun_or_reload',
  misc: 'concealment',
};

/** GDD §3.6.1：子阶段 × 地形基础 + 修正系数 + 下限 / 可选上限。由 actionDicePool() 消费。 */
export type ActionDiceSubPhase = 'movement' | 'attack' | 'misc';

export interface PlayerDicePoolConfig {
  /** 移动 / 攻击 / 杂项 → 各地形基础骰数 */
  baseByPhaseTerrain: Record<ActionDiceSubPhase, Record<TerrainType, number>>;
  /** 移动阶段：驾驶员 / 副驾驶存活、开舱 各加多少（通常为 1） */
  moveMods: { driver: number; codriver: number; hatch: number };
  /** 攻击阶段：炮手 / 装填手存活、开舱 */
  attackMods: { gunner: number; loader: number; hatch: number };
  /** 杂项阶段：车长开舱 */
  miscMods: { hatch: number };
  capMin: number;
  capMax: number | null;
}

export const PLAYER_DICE_POOL: PlayerDicePoolConfig = {
  baseByPhaseTerrain: {
    movement: {
      road: 2,
      field: 1,
      mud: 0,
      forest: 0,
      water: 0,
      deep_water: 0,
      clear: 2,
      trees: 1,
      beach: -1,
      rocky: 0,
      airstrip: 2,
    },
    attack: {
      road: 2,
      field: 2,
      mud: 1,
      forest: 0,
      water: 0,
      deep_water: 0,
      clear: 2,
      trees: 1,
      beach: 0,
      rocky: 0,
      airstrip: 2,
    },
    misc: {
      road: 1,
      field: 2,
      mud: 1,
      forest: 0,
      water: 0,
      deep_water: 0,
      clear: 1,
      trees: 2,
      beach: 1,
      rocky: 0,
      airstrip: 1,
    },
  },
  moveMods: {
    driver: 1,
    codriver: 1,
    hatch: 1,
  },
  attackMods: {
    gunner: 1,
    loader: 1,
    hatch: 1,
  },
  miscMods: {
    hatch: 1,
  },
  capMin: 1,
  capMax: null,
};
