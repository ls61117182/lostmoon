/**
 * 德军坦克 AI 行动表与骰数 —— 自动生成，请勿手改本文件。
 *
 * 数据源：data/enemy_ai_table.csv + data/enemy_ai_dice.csv
 * 重新生成：node tools/buildEnemyAIDB.js
 * 对应 GDD §3.7 行动表 + 掷骰数。
 */

/** 敌方 AI 单颗骰能产出的具体行动 */
export type EnemyAction =
  | 'shoot'
  | 'turn'
  | 'advance'
  | 'reverse'
  | 'smoke'
  | 'repair'
  | 'none';

/** 一颗骰的 A>B 条目；无 fallback 则只执行 primary */
export interface AIActionEntry {
  primary: EnemyAction;
  fallback?: EnemyAction;
}

/** AI 表的列键：地形或"受损"（受损优先于地形） */
export type AIColumn = 'road' | 'field' | 'mud' | 'damaged';

/** 列 → (1..6) → 行动条目 */
export type AIActionTable = Record<AIColumn, Record<number, AIActionEntry>>;

/** 每列掷多少颗骰（GDD §3.7 骰数表） */
export const AI_DICE_COUNT: Record<AIColumn, number> = {
  road: 4,
  field: 4,
  mud: 3,
  damaged: 2,
};

/** 默认 AI 行动表（数据源 enemy_ai_table.csv；各关可按需覆盖） */
export const DEFAULT_AI_TABLE: AIActionTable = {
  road: {
    1: { primary: 'shoot', fallback: 'turn' },
    2: { primary: 'advance', fallback: 'shoot' },
    3: { primary: 'advance', fallback: 'turn' },
    4: { primary: 'turn' },
    5: { primary: 'advance', fallback: 'shoot' },
    6: { primary: 'advance', fallback: 'turn' },
  },
  field: {
    1: { primary: 'shoot', fallback: 'turn' },
    2: { primary: 'turn' },
    3: { primary: 'advance', fallback: 'turn' },
    4: { primary: 'advance', fallback: 'turn' },
    5: { primary: 'advance', fallback: 'turn' },
    6: { primary: 'advance', fallback: 'reverse' },
  },
  mud: {
    1: { primary: 'shoot' },
    2: { primary: 'turn' },
    3: { primary: 'advance', fallback: 'turn' },
    4: { primary: 'turn' },
    5: { primary: 'advance', fallback: 'shoot' },
    6: { primary: 'advance', fallback: 'smoke' },
  },
  damaged: {
    1: { primary: 'repair' },
    2: { primary: 'turn' },
    3: { primary: 'advance', fallback: 'turn' },
    4: { primary: 'turn' },
    5: { primary: 'shoot' },
    6: { primary: 'smoke' },
  },
};
