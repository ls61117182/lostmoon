/**
 * 回合结束事件表 —— 自动生成，请勿手改。
 * 数据源：data/turn_end_events.csv
 * 生成：node tools/buildTurnEndEventDB.js
 */

export type TurnEndEffectType = 'sniper' | 'commander_extra' | 'infantry_spawn' | 'adjacent_infantry_fire' | 'mechanical_failure' | 'stuka' | 'panzer3_spawn';

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
