/**
 * 回合结束事件表 - 自动生成，请勿手改。
 * 数据源：data/turn_end_events.csv
 * 生成：node tools/buildTurnEndEventDB.js
 */

export type TurnEndEffectType = 'none' | 'sniper' | 'commander_extra' | 'infantry_spawn' | 'adjacent_infantry_fire' | 'mechanical_failure' | 'stuka' | 'panzer3_spawn' | 'road_mine' | 'panzer4_spawn' | 'tiger_spawn' | 'sherman_spawn' | 'german_truck_move' | 'clear_mine' | 'type95_spawn' | 'type97_spawn' | 'heavy_mortar';

export interface TurnEndEventRow {
  missionId: string;
  sumMin: number;
  sumMax: number;
  diceCount: number;
  effectType: TurnEndEffectType;
}

export const TURN_END_EVENTS: TurnEndEventRow[] = [
  { missionId: 'mission_01', sumMin: 2, sumMax: 3, diceCount: 2, effectType: 'sniper' },
  { missionId: 'mission_01', sumMin: 4, sumMax: 4, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_01', sumMin: 5, sumMax: 6, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_01', sumMin: 7, sumMax: 8, diceCount: 2, effectType: 'adjacent_infantry_fire' },
  { missionId: 'mission_01', sumMin: 9, sumMax: 9, diceCount: 2, effectType: 'mechanical_failure' },
  { missionId: 'mission_01', sumMin: 10, sumMax: 10, diceCount: 2, effectType: 'stuka' },
  { missionId: 'mission_01', sumMin: 11, sumMax: 12, diceCount: 2, effectType: 'panzer3_spawn' },
  { missionId: 'mission_test', sumMin: 2, sumMax: 3, diceCount: 2, effectType: 'tiger_spawn' },
  { missionId: 'mission_test', sumMin: 4, sumMax: 4, diceCount: 2, effectType: 'sherman_spawn' },
  { missionId: 'mission_test', sumMin: 5, sumMax: 6, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_test', sumMin: 7, sumMax: 8, diceCount: 2, effectType: 'adjacent_infantry_fire' },
  { missionId: 'mission_test', sumMin: 9, sumMax: 9, diceCount: 2, effectType: 'mechanical_failure' },
  { missionId: 'mission_test', sumMin: 10, sumMax: 10, diceCount: 2, effectType: 'stuka' },
  { missionId: 'mission_test', sumMin: 11, sumMax: 12, diceCount: 2, effectType: 'panzer3_spawn' },
  { missionId: 'mission_02', sumMin: 2, sumMax: 5, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_02', sumMin: 6, sumMax: 6, diceCount: 2, effectType: 'road_mine' },
  { missionId: 'mission_02', sumMin: 7, sumMax: 8, diceCount: 2, effectType: 'adjacent_infantry_fire' },
  { missionId: 'mission_02', sumMin: 9, sumMax: 9, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_02', sumMin: 10, sumMax: 10, diceCount: 2, effectType: 'stuka' },
  { missionId: 'mission_02', sumMin: 11, sumMax: 12, diceCount: 2, effectType: 'panzer4_spawn' },
  { missionId: 'mission_03', sumMin: 2, sumMax: 4, diceCount: 2, effectType: 'sniper' },
  { missionId: 'mission_03', sumMin: 5, sumMax: 5, diceCount: 2, effectType: 'road_mine' },
  { missionId: 'mission_03', sumMin: 6, sumMax: 8, diceCount: 2, effectType: 'adjacent_infantry_fire' },
  { missionId: 'mission_03', sumMin: 9, sumMax: 9, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_03', sumMin: 10, sumMax: 10, diceCount: 2, effectType: 'stuka' },
  { missionId: 'mission_03', sumMin: 11, sumMax: 12, diceCount: 2, effectType: 'panzer3_spawn' },
  { missionId: 'mission_04', sumMin: 2, sumMax: 3, diceCount: 2, effectType: 'sniper' },
  { missionId: 'mission_04', sumMin: 4, sumMax: 4, diceCount: 2, effectType: 'mechanical_failure' },
  { missionId: 'mission_04', sumMin: 5, sumMax: 6, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_04', sumMin: 7, sumMax: 9, diceCount: 2, effectType: 'adjacent_infantry_fire' },
  { missionId: 'mission_04', sumMin: 10, sumMax: 10, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_04', sumMin: 11, sumMax: 12, diceCount: 2, effectType: 'stuka' },
  { missionId: 'mission_05', sumMin: 2, sumMax: 5, diceCount: 2, effectType: 'adjacent_infantry_fire' },
  { missionId: 'mission_05', sumMin: 6, sumMax: 9, diceCount: 2, effectType: 'german_truck_move' },
  { missionId: 'mission_05', sumMin: 10, sumMax: 10, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_05', sumMin: 11, sumMax: 12, diceCount: 2, effectType: 'panzer4_spawn' },
  { missionId: 'mission_06', sumMin: 2, sumMax: 3, diceCount: 2, effectType: 'sniper' },
  { missionId: 'mission_06', sumMin: 4, sumMax: 5, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_06', sumMin: 6, sumMax: 6, diceCount: 2, effectType: 'road_mine' },
  { missionId: 'mission_06', sumMin: 7, sumMax: 9, diceCount: 2, effectType: 'adjacent_infantry_fire' },
  { missionId: 'mission_06', sumMin: 10, sumMax: 10, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_06', sumMin: 11, sumMax: 11, diceCount: 2, effectType: 'stuka' },
  { missionId: 'mission_06', sumMin: 12, sumMax: 12, diceCount: 2, effectType: 'panzer3_spawn' },
  { missionId: 'mission_07', sumMin: 2, sumMax: 5, diceCount: 2, effectType: 'road_mine' },
  { missionId: 'mission_07', sumMin: 6, sumMax: 6, diceCount: 2, effectType: 'mechanical_failure' },
  { missionId: 'mission_07', sumMin: 7, sumMax: 8, diceCount: 2, effectType: 'none' },
  { missionId: 'mission_07', sumMin: 9, sumMax: 9, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_07', sumMin: 10, sumMax: 10, diceCount: 2, effectType: 'stuka' },
  { missionId: 'mission_07', sumMin: 11, sumMax: 12, diceCount: 2, effectType: 'panzer3_spawn' },
  { missionId: 'mission_08', sumMin: 2, sumMax: 4, diceCount: 2, effectType: 'road_mine' },
  { missionId: 'mission_08', sumMin: 5, sumMax: 6, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_08', sumMin: 7, sumMax: 9, diceCount: 2, effectType: 'adjacent_infantry_fire' },
  { missionId: 'mission_08', sumMin: 10, sumMax: 10, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_08', sumMin: 11, sumMax: 12, diceCount: 2, effectType: 'stuka' },
  { missionId: 'mission_09', sumMin: 2, sumMax: 4, diceCount: 2, effectType: 'sniper' },
  { missionId: 'mission_09', sumMin: 5, sumMax: 5, diceCount: 2, effectType: 'road_mine' },
  { missionId: 'mission_09', sumMin: 6, sumMax: 6, diceCount: 2, effectType: 'mechanical_failure' },
  { missionId: 'mission_09', sumMin: 7, sumMax: 9, diceCount: 2, effectType: 'adjacent_infantry_fire' },
  { missionId: 'mission_09', sumMin: 10, sumMax: 10, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_09', sumMin: 11, sumMax: 12, diceCount: 2, effectType: 'stuka' },
  { missionId: 'mission_10', sumMin: 2, sumMax: 5, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_10', sumMin: 6, sumMax: 6, diceCount: 2, effectType: 'road_mine' },
  { missionId: 'mission_10', sumMin: 7, sumMax: 8, diceCount: 2, effectType: 'adjacent_infantry_fire' },
  { missionId: 'mission_10', sumMin: 9, sumMax: 9, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_10', sumMin: 10, sumMax: 10, diceCount: 2, effectType: 'stuka' },
  { missionId: 'mission_10', sumMin: 11, sumMax: 12, diceCount: 2, effectType: 'panzer4_spawn' },
  { missionId: 'mission_11', sumMin: 2, sumMax: 5, diceCount: 2, effectType: 'road_mine' },
  { missionId: 'mission_11', sumMin: 6, sumMax: 7, diceCount: 2, effectType: 'none' },
  { missionId: 'mission_11', sumMin: 8, sumMax: 9, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_11', sumMin: 10, sumMax: 10, diceCount: 2, effectType: 'mechanical_failure' },
  { missionId: 'mission_11', sumMin: 11, sumMax: 12, diceCount: 2, effectType: 'stuka' },
  { missionId: 'mission_12', sumMin: 2, sumMax: 5, diceCount: 2, effectType: 'road_mine' },
  { missionId: 'mission_12', sumMin: 6, sumMax: 6, diceCount: 2, effectType: 'mechanical_failure' },
  { missionId: 'mission_12', sumMin: 7, sumMax: 8, diceCount: 2, effectType: 'none' },
  { missionId: 'mission_12', sumMin: 9, sumMax: 9, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_12', sumMin: 10, sumMax: 10, diceCount: 2, effectType: 'stuka' },
  { missionId: 'mission_12', sumMin: 11, sumMax: 12, diceCount: 2, effectType: 'panzer3_spawn' },
  { missionId: 'mission_pacific_01', sumMin: 2, sumMax: 4, diceCount: 2, effectType: 'sniper' },
  { missionId: 'mission_pacific_01', sumMin: 5, sumMax: 5, diceCount: 2, effectType: 'clear_mine' },
  { missionId: 'mission_pacific_01', sumMin: 6, sumMax: 7, diceCount: 2, effectType: 'type95_spawn' },
  { missionId: 'mission_pacific_01', sumMin: 8, sumMax: 9, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_pacific_01', sumMin: 10, sumMax: 12, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_pacific_02', sumMin: 2, sumMax: 3, diceCount: 2, effectType: 'clear_mine' },
  { missionId: 'mission_pacific_02', sumMin: 4, sumMax: 4, diceCount: 2, effectType: 'mechanical_failure' },
  { missionId: 'mission_pacific_02', sumMin: 5, sumMax: 6, diceCount: 2, effectType: 'sniper' },
  { missionId: 'mission_pacific_02', sumMin: 7, sumMax: 9, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_pacific_02', sumMin: 10, sumMax: 12, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_pacific_03', sumMin: 2, sumMax: 3, diceCount: 2, effectType: 'clear_mine' },
  { missionId: 'mission_pacific_03', sumMin: 4, sumMax: 4, diceCount: 2, effectType: 'mechanical_failure' },
  { missionId: 'mission_pacific_03', sumMin: 5, sumMax: 6, diceCount: 2, effectType: 'sniper' },
  { missionId: 'mission_pacific_03', sumMin: 7, sumMax: 8, diceCount: 2, effectType: 'none' },
  { missionId: 'mission_pacific_03', sumMin: 9, sumMax: 9, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_pacific_03', sumMin: 10, sumMax: 12, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_pacific_04', sumMin: 2, sumMax: 3, diceCount: 2, effectType: 'none' },
  { missionId: 'mission_pacific_04', sumMin: 4, sumMax: 4, diceCount: 2, effectType: 'sniper' },
  { missionId: 'mission_pacific_04', sumMin: 5, sumMax: 5, diceCount: 2, effectType: 'clear_mine' },
  { missionId: 'mission_pacific_04', sumMin: 6, sumMax: 6, diceCount: 2, effectType: 'type97_spawn' },
  { missionId: 'mission_pacific_04', sumMin: 7, sumMax: 7, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_pacific_04', sumMin: 8, sumMax: 12, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_pacific_05', sumMin: 2, sumMax: 3, diceCount: 2, effectType: 'clear_mine' },
  { missionId: 'mission_pacific_05', sumMin: 4, sumMax: 4, diceCount: 2, effectType: 'mechanical_failure' },
  { missionId: 'mission_pacific_05', sumMin: 5, sumMax: 6, diceCount: 2, effectType: 'sniper' },
  { missionId: 'mission_pacific_05', sumMin: 7, sumMax: 7, diceCount: 2, effectType: 'type97_spawn' },
  { missionId: 'mission_pacific_05', sumMin: 8, sumMax: 8, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_pacific_05', sumMin: 9, sumMax: 9, diceCount: 2, effectType: 'none' },
  { missionId: 'mission_pacific_05', sumMin: 10, sumMax: 12, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_pacific_06', sumMin: 2, sumMax: 3, diceCount: 2, effectType: 'clear_mine' },
  { missionId: 'mission_pacific_06', sumMin: 4, sumMax: 4, diceCount: 2, effectType: 'mechanical_failure' },
  { missionId: 'mission_pacific_06', sumMin: 5, sumMax: 6, diceCount: 2, effectType: 'sniper' },
  { missionId: 'mission_pacific_06', sumMin: 7, sumMax: 8, diceCount: 2, effectType: 'none' },
  { missionId: 'mission_pacific_06', sumMin: 9, sumMax: 9, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_pacific_06', sumMin: 10, sumMax: 12, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_pacific_07', sumMin: 2, sumMax: 3, diceCount: 2, effectType: 'sniper' },
  { missionId: 'mission_pacific_07', sumMin: 4, sumMax: 4, diceCount: 2, effectType: 'none' },
  { missionId: 'mission_pacific_07', sumMin: 5, sumMax: 6, diceCount: 2, effectType: 'clear_mine' },
  { missionId: 'mission_pacific_07', sumMin: 7, sumMax: 8, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_pacific_07', sumMin: 9, sumMax: 10, diceCount: 2, effectType: 'type95_spawn' },
  { missionId: 'mission_pacific_07', sumMin: 11, sumMax: 12, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_pacific_08', sumMin: 2, sumMax: 3, diceCount: 2, effectType: 'clear_mine' },
  { missionId: 'mission_pacific_08', sumMin: 4, sumMax: 4, diceCount: 2, effectType: 'mechanical_failure' },
  { missionId: 'mission_pacific_08', sumMin: 5, sumMax: 6, diceCount: 2, effectType: 'sniper' },
  { missionId: 'mission_pacific_08', sumMin: 7, sumMax: 8, diceCount: 2, effectType: 'none' },
  { missionId: 'mission_pacific_08', sumMin: 9, sumMax: 9, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_pacific_08', sumMin: 10, sumMax: 12, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_pacific_09', sumMin: 2, sumMax: 3, diceCount: 2, effectType: 'clear_mine' },
  { missionId: 'mission_pacific_09', sumMin: 4, sumMax: 4, diceCount: 2, effectType: 'mechanical_failure' },
  { missionId: 'mission_pacific_09', sumMin: 5, sumMax: 6, diceCount: 2, effectType: 'sniper' },
  { missionId: 'mission_pacific_09', sumMin: 7, sumMax: 7, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_pacific_09', sumMin: 8, sumMax: 9, diceCount: 2, effectType: 'none' },
  { missionId: 'mission_pacific_09', sumMin: 10, sumMax: 12, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_pacific_10', sumMin: 2, sumMax: 3, diceCount: 2, effectType: 'clear_mine' },
  { missionId: 'mission_pacific_10', sumMin: 4, sumMax: 4, diceCount: 2, effectType: 'sniper' },
  { missionId: 'mission_pacific_10', sumMin: 5, sumMax: 5, diceCount: 2, effectType: 'none' },
  { missionId: 'mission_pacific_10', sumMin: 6, sumMax: 6, diceCount: 2, effectType: 'type97_spawn' },
  { missionId: 'mission_pacific_10', sumMin: 7, sumMax: 7, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_pacific_10', sumMin: 8, sumMax: 9, diceCount: 2, effectType: 'heavy_mortar' },
  { missionId: 'mission_pacific_10', sumMin: 10, sumMax: 12, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_pacific_11', sumMin: 2, sumMax: 4, diceCount: 2, effectType: 'clear_mine' },
  { missionId: 'mission_pacific_11', sumMin: 5, sumMax: 5, diceCount: 2, effectType: 'type97_spawn' },
  { missionId: 'mission_pacific_11', sumMin: 6, sumMax: 9, diceCount: 2, effectType: 'none' },
  { missionId: 'mission_pacific_11', sumMin: 10, sumMax: 12, diceCount: 2, effectType: 'commander_extra' },
  { missionId: 'mission_pacific_12', sumMin: 2, sumMax: 3, diceCount: 2, effectType: 'clear_mine' },
  { missionId: 'mission_pacific_12', sumMin: 4, sumMax: 4, diceCount: 2, effectType: 'sniper' },
  { missionId: 'mission_pacific_12', sumMin: 5, sumMax: 5, diceCount: 2, effectType: 'none' },
  { missionId: 'mission_pacific_12', sumMin: 6, sumMax: 6, diceCount: 2, effectType: 'type97_spawn' },
  { missionId: 'mission_pacific_12', sumMin: 7, sumMax: 7, diceCount: 2, effectType: 'infantry_spawn' },
  { missionId: 'mission_pacific_12', sumMin: 8, sumMax: 9, diceCount: 2, effectType: 'heavy_mortar' },
  { missionId: 'mission_pacific_12', sumMin: 10, sumMax: 12, diceCount: 2, effectType: 'commander_extra' },
];

/** 某关是否配置了回合结束事件（至少一行） */
export function hasTurnEndEvents(missionId: string): boolean {
  return TURN_END_EVENTS.some(r => r.missionId === missionId);
}

/** 按 2d6 之和（或 diceCount 颗骰之和）查本关命中哪一行；无匹配返回 null */
export function turnEndRowForSum(missionId: string, sum: number): TurnEndEventRow | null {
  const hit = TURN_END_EVENTS.filter(r => r.missionId === missionId && sum >= r.sumMin && sum <= r.sumMax);
  if (hit.length === 0) return null;
  if (hit.length > 1) return hit[0];
  return hit[0];
}

/** 当前关卡全部回合结束事件行（按 sum 区间升序） */
export function turnEndEventsForMission(missionId: string): TurnEndEventRow[] {
  return TURN_END_EVENTS
    .filter(r => r.missionId === missionId)
    .sort((a, b) => a.sumMin - b.sumMin || a.sumMax - b.sumMax);
}
