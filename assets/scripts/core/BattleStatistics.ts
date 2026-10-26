import type { AttackReport, HighExplosiveReport } from './Combat';

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
}

export function cloneBattleStatistics(saved?: Partial<BattleStatistics>): BattleStatistics {
  const result: BattleStatistics = {
    attacksReceived: 0, hitsReceived: 0, penetrationsReceived: 0,
    mainGunHitChecks: 0, mainGunHits: 0,
    mainGunPenetrationChecks: 0, mainGunPenetrations: 0,
    machineGunShots: 0, machineGunHits: 0,
  };
  for (const key of Object.keys(result) as (keyof BattleStatistics)[]) {
    const value = saved?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = Math.max(0, Math.floor(value));
  }
  return result;
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
