/**
 * 玩家行动表与骰池 —— 自动生成，请勿手改本文件。
 *
 * 数据源：data/player_action_table.csv + data/player_dice_pool.csv
 * 重新生成：node tools/buildPlayerActionDB.js
 * 对应 GDD §3.6 行动表 + 掷骰公式。
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
  1: { move: 'reverse', attack: 'reload', misc: 'gunner_gun_or_reload' },
  2: { move: 'turn', attack: 'reload', misc: 'codriver_mg' },
  3: { move: 'turn', attack: 'mg', misc: 'driver_turn_or_drive' },
  4: { move: 'turn', attack: 'mg', misc: 'repair' },
  5: { move: 'drive', attack: 'gun', misc: 'smoke_or_repair' },
  6: { move: 'drive', attack: 'gun', misc: 'fire_suppress' },
};

/** 对子（两颗同点）特殊行：MVP 不消费，仅保留给未来的对子合并玩法。 */
export const PLAYER_ACTION_DOUBLES: ActionTableRow = {
  move: 'driver_drive_codriver_turn',
  attack: 'gunner_gun_or_reload',
  misc: 'concealment',
};

/** 骰池基础配置 + 地形修正 + 上下限。由 actionDicePool() 消费。 */
export interface DicePoolConfig {
  /** 基础骰数（常量） */
  base: number;
  /** 车长打开舱盖的 +N */
  hatchOpen: number;
  /** 地形 → 修正 (+/-) */
  terrainBonus: Record<TerrainType, number>;
  /** 骰数下限（不低于此值） */
  capMin: number;
  /** 骰数上限（不高于此值） */
  capMax: number;
}

export const PLAYER_DICE_POOL: DicePoolConfig = {
  base: 3,
  hatchOpen: 1,
  terrainBonus: {
    road: 1,
    field: 0,
    mud: -1,
    forest: 0,
    water: 0,
  },
  capMin: 1,
  capMax: 5,
};
