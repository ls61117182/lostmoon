import type { AttackReport, HighExplosiveReport } from './Combat';
import type { Unit, UnitKind } from './types';

export interface BattleCrewStatus { slot: number; alive: boolean }

export function battleCrewStatus(player?: Unit): BattleCrewStatus[] {
  if (!player) return [];
  const roles = ['commander', 'gunner', 'loader', 'driver', 'coDriver', 'secondLoader'] as const;
  return (player.stats.crewMembers ?? [1, 2, 3, 4, 5]).map(slot => ({
    slot, alive: player.crew?.[roles[slot - 1]] ?? true,
  }));
}

/** Counts belong to the local protagonist, across the current battle/campaign. */
export interface BattleStatistics {
  attacksReceived: number;
  hitsReceived: number;
  penetrationsReceived: number;
  mainGunHitChecks: number;
  mainGunHits: number;
  mainGunPenetrationChecks: number;
  mainGunPenetrations: number;
  machineGunShots: number;
  machineGunHits: number;
  killsByKind: Partial<Record<UnitKind, number>>;
  countedKillIds: string[];
}

export function cloneBattleStatistics(saved?: Partial<BattleStatistics>): BattleStatistics {
  const result: BattleStatistics = {
    attacksReceived: 0, hitsReceived: 0, penetrationsReceived: 0,
    mainGunHitChecks: 0, mainGunHits: 0,
    mainGunPenetrationChecks: 0, mainGunPenetrations: 0,
    machineGunShots: 0, machineGunHits: 0,
    killsByKind: {}, countedKillIds: [],
  };
  for (const key of Object.keys(result) as (keyof BattleStatistics)[]) {
    if (key === 'killsByKind' || key === 'countedKillIds') continue;
    const value = saved?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = Math.max(0, Math.floor(value));
  }
  for (const [kind, count] of Object.entries(saved?.killsByKind ?? {})) {
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) result.killsByKind[kind as UnitKind] = Math.floor(count);
  }
  result.countedKillIds = Array.from(new Set((saved?.countedKillIds ?? []).filter(id => typeof id === 'string')));
  return result;
}

/** Stable unit identity prevents impact presentation and final settlement double counting. */
export function recordBattleKill(stats: BattleStatistics, id: string, kind: UnitKind): void {
  if (stats.countedKillIds.includes(id)) return;
  stats.countedKillIds.push(id);
  stats.killsByKind[kind] = (stats.killsByKind[kind] ?? 0) + 1;
}

type StatisticalReport = Pick<AttackReport, 'hit'> & Partial<AttackReport>;

/** Called only when an attack settles; previews, history and collateral never add shots. */
export function recordBattleAttack(
  stats: BattleStatistics,
  playerAttacking: boolean,
  playerTargeted: boolean,
  weapon: 'main' | 'he' | 'mg',
  reports: readonly (StatisticalReport | HighExplosiveReport)[],
): void {
  for (const report of reports) {
    const ap = report as StatisticalReport;
    // Some instant-kill reports use penetrated=true without an armour check.
    const penetrationChecked = weapon === 'main' && report.hit && ap.penThreshold != null;
    if (playerTargeted) {
      stats.attacksReceived++;
      if (report.hit) stats.hitsReceived++;
      if (penetrationChecked && ap.penetrated) stats.penetrationsReceived++;
    }
    if (!playerAttacking) continue;
    if (weapon === 'mg') {
      stats.machineGunShots++;
      if (report.hit) stats.machineGunHits++;
    } else {
      if (!report.automaticHit) {
        stats.mainGunHitChecks++;
        if (report.shootingPortHit ?? report.hit) stats.mainGunHits++;
      }
      if (penetrationChecked) {
        stats.mainGunPenetrationChecks++;
        if (ap.penetrated) stats.mainGunPenetrations++;
      }
    }
  }
}

export function battleStatisticRate(hits: number, checks: number): string {
  return checks > 0 ? `${Math.round(hits / checks * 100)}%` : '—';
}
