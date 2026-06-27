/**
 * Enemy AI action tables and dice counts. Auto-generated; do not edit by hand.
 *
 * Sources: data/enemy_ai_table.csv, data/enemy_ai_dice.csv,
 * data/enemy_hardcore_tank_action_table.csv, data/enemy_hardcore_tank_dice.csv
 * Regenerate: node tools/buildEnemyAIDB.js
 */

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

export interface AIActionEntry {
  primary: EnemyAction;
  fallback?: EnemyAction;
  fallback2?: EnemyAction;
}

export type AIColumn = 'road' | 'field' | 'mud' | 'damaged' | 'type95' | 'type97' | 'at_gun' | 'japanese_infantry' | 'heavy_artillery';
export type EnemyTankDieType = 'attack' | 'move';
export type HardcoreTankDiceTerrain = 'road' | 'field' | 'mud' | 'clear' | 'trees' | 'beach' | 'airstrip';

export interface HardcoreTankDiceCount {
  attack: number;
  move: number;
}

export type AIActionTable = Record<AIColumn, Record<number, AIActionEntry>>;
export type HardcoreTankActionTable = Record<EnemyTankDieType, Record<number, AIActionEntry>>;

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

export const HARDCORE_TANK_AI_DICE_COUNT: Record<HardcoreTankDiceTerrain, HardcoreTankDiceCount> = {
  road: { attack: -1, move: 0 },
  field: { attack: 0, move: -1 },
  mud: { attack: -1, move: -1 },
  clear: { attack: 0, move: -1 },
  trees: { attack: 0, move: -1 },
  beach: { attack: -2, move: -2 },
  airstrip: { attack: -1, move: 0 },
};

export const HARDCORE_TANK_AI_TABLE: HardcoreTankActionTable = {
  attack: {
    1: { primary: 'repair', fallback: 'shoot', fallback2: 'turn' },
    2: { primary: 'advance', fallback: 'shoot' },
    3: { primary: 'shoot', fallback: 'advance' },
    4: { primary: 'shoot', fallback: 'turn' },
    5: { primary: 'advance', fallback: 'reverse' },
    6: { primary: 'shoot', fallback: 'conceal' },
  },
  move: {
    1: { primary: 'turn' },
    2: { primary: 'advance', fallback: 'turn' },
    3: { primary: 'shoot', fallback: 'advance' },
    4: { primary: 'advance', fallback: 'turn' },
    5: { primary: 'advance', fallback: 'reverse' },
    6: { primary: 'shoot', fallback: 'smoke' },
  },
};
