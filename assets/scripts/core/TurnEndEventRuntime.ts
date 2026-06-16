import {
  hasTurnEndEvents,
  turnEndEventsForMission,
  turnEndRowForSum,
} from './TurnEndEventDB';
import type { TurnEndEventRow } from './TurnEndEventDB';

export interface TurnEndEventProvider {
  has(missionId: string): boolean;
  rows(missionId: string): TurnEndEventRow[];
  rowForSum(missionId: string, sum: number): TurnEndEventRow | null;
  diceCount(missionId: string): number;
}

function diceCountFromRows(rows: TurnEndEventRow[]): number {
  if (rows.length === 0) return 2;
  return Math.max(...rows.map(r => r.diceCount));
}

export const OfficialTurnEndEventProvider: TurnEndEventProvider = {
  has(missionId: string): boolean {
    return hasTurnEndEvents(missionId);
  },

  rows(missionId: string): TurnEndEventRow[] {
    return turnEndEventsForMission(missionId);
  },

  rowForSum(missionId: string, sum: number): TurnEndEventRow | null {
    return turnEndRowForSum(missionId, sum);
  },

  diceCount(missionId: string): number {
    return diceCountFromRows(turnEndEventsForMission(missionId));
  },
};

export function createCustomTurnEndEventProvider(rows: TurnEndEventRow[]): TurnEndEventProvider {
  const normalizedRows = Array.isArray(rows) ? rows.slice() : [];
  return {
    has(missionId: string): boolean {
      return normalizedRows.some(r => r.missionId === missionId);
    },

    rows(missionId: string): TurnEndEventRow[] {
      return normalizedRows
        .filter(r => r.missionId === missionId)
        .sort((a, b) => a.sumMin - b.sumMin || a.sumMax - b.sumMax);
    },

    rowForSum(missionId: string, sum: number): TurnEndEventRow | null {
      const hit = normalizedRows.filter(r => r.missionId === missionId && sum >= r.sumMin && sum <= r.sumMax);
      if (hit.length === 0) return null;
      return hit[0];
    },

    diceCount(missionId: string): number {
      return diceCountFromRows(normalizedRows.filter(r => r.missionId === missionId));
    },
  };
}
