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
  | 'conceal'
  | 'shoot_adjacent'
  | 'infantry_move'
  | 'advance_to_building'
  | 'hull_down'
  | 'none';

/** 一颗骰的 A>B 条目；无 fallback 则只执行 primary */
export interface AIActionEntry {
  primary: EnemyAction;
  fallback?: EnemyAction;
  fallback2?: EnemyAction;
}

/** AI 表的列键：地形或"受损"（受损优先于地形） */
export type AIColumn = 'road' | 'field' | 'mud' | 'damaged' | 'type95' | 'type97' | 'at_gun' | 'japanese_infantry' | 'heavy_artillery';

/** 列 → (1..6) → 行动条目 */
export type AIActionTable = Record<AIColumn, Record<number, AIActionEntry>>;

/** 每列掷多少颗骰（GDD §3.7 骰数表） */
export const AI_DICE_COUNT: Record<AIColumn, number> = {
  road: 4,
  field: 4,
  mud: 3,
  damaged: 2,
  type95: 4,
  type97: 4,
  at_gun: 2,
  japanese_infantry: 3,
  heavy_artillery: 1,
};

/** 默认 AI 行动表（数据源 enemy_ai_table.csv；各关可按需覆盖） */
export const DEFAULT_AI_TABLE: AIActionTable = {
  road: {
    1: { primary: 'shoot', fallback: 'turn' },
    2: { primary: 'advance', fallback: 'shoot' },
    3: { primary: 'shoot', fallback: 'advance' },
    4: { primary: 'advance', fallback: 'turn' },
    5: { primary: 'advance', fallback: 'reverse' },
    6: { primary: 'shoot', fallback: 'smoke' },
  },
  field: {
    1: { primary: 'shoot', fallback: 'turn' },
    2: { primary: 'advance', fallback: 'turn' },
    3: { primary: 'shoot', fallback: 'advance' },
    4: { primary: 'turn' },
    5: { primary: 'advance', fallback: 'reverse' },
    6: { primary: 'shoot', fallback: 'conceal' },
  },
  mud: {
    1: { primary: 'shoot' },
    2: { primary: 'turn' },
    3: { primary: 'advance', fallback: 'turn' },
    4: { primary: 'advance', fallback: 'reverse' },
    5: { primary: 'shoot' },
    6: { primary: 'smoke' },
  },
  damaged: {
    1: { primary: 'repair' },
    2: { primary: 'turn' },
    3: { primary: 'advance', fallback: 'turn' },
    4: { primary: 'advance', fallback: 'reverse' },
    5: { primary: 'shoot' },
    6: { primary: 'smoke' },
  },
  type95: {
    1: { primary: 'shoot', fallback: 'turn' },
    2: { primary: 'advance', fallback: 'turn' },
    3: { primary: 'shoot', fallback: 'advance' },
    4: { primary: 'turn' },
    5: { primary: 'advance', fallback: 'reverse' },
    6: { primary: 'shoot', fallback: 'advance', fallback2: 'hull_down' },
  },
  type97: {
    1: { primary: 'shoot', fallback: 'turn' },
    2: { primary: 'advance', fallback: 'turn' },
    3: { primary: 'shoot', fallback: 'advance' },
    4: { primary: 'turn' },
    5: { primary: 'advance', fallback: 'reverse' },
    6: { primary: 'shoot', fallback: 'advance', fallback2: 'hull_down' },
  },
  at_gun: {
    1: { primary: 'turn' },
    2: { primary: 'advance_to_building' },
    3: { primary: 'turn' },
    4: { primary: 'none' },
    5: { primary: 'shoot' },
    6: { primary: 'shoot' },
  },
  japanese_infantry: {
    1: { primary: 'shoot_adjacent' },
    2: { primary: 'infantry_move' },
    3: { primary: 'shoot_adjacent' },
    4: { primary: 'infantry_move' },
    5: { primary: 'infantry_move' },
    6: { primary: 'shoot_adjacent' },
  },
  heavy_artillery: {
    1: { primary: 'none' },
    2: { primary: 'none' },
    3: { primary: 'shoot' },
    4: { primary: 'shoot' },
    5: { primary: 'shoot' },
    6: { primary: 'shoot' },
  },
};
