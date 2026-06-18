/**
 * 战斗 HUD 左上角「任务目标」多行文案的状态与模板数据（纯逻辑，不含 i18n）。
 * 文案在 BattleScene 里用 t() 展开。
 */

import { allEnemiesOfKindDestroyed, liveEnemyCount } from './Objective';
import { LoadedMission } from './MissionLoader';
import { MissionObjective, UnitKind } from './types';

export type ObjHudState = 'locked' | 'active' | 'done';

export type ObjHudTemplate =
  | { key: 'destroyProgress'; unitKind: UnitKind; cur: number; total: number }
  | { key: 'evacFromMark' }
  | { key: 'destroyAllRemaining'; remaining: number }
  | { key: 'destroyAllUnitsRemaining'; remaining: number }
  | { key: 'destroyTruck'; cur: number; total: number }
  | { key: 'usCasualties'; cur: number; limit: number }
  | { key: 'exitEdge' }
  | { key: 'unknownType'; type: string };

export interface ObjHudLine {
  displayIndex: number;
  state: ObjHudState;
  template: ObjHudTemplate;
}

/** 任务目标「歼敌进度」行：步兵用「消灭」、军官用「击杀」、坦克与卡车用「击毁」（见 lang `objective.destroyProgress.*`）。 */
export function objectiveDestroyProgressLangKey(kind: UnitKind): string {
  if (kind === 'infantry') return 'objective.destroyProgress.infantry';
  if (kind === 'officer') return 'objective.destroyProgress.officer';
  return 'objective.destroyProgress.tank';
}

function kindProgress(mission: LoadedMission, kind: UnitKind): { cur: number; total: number } {
  const group = mission.enemies.filter(e => e.kind === kind);
  const total = group.length;
  const cur = group.filter(e => e.destroyed).length;
  return { cur, total };
}

function truckProgress(mission: LoadedMission): { cur: number; total: number } {
  const group = mission.enemies.filter(e => e.kind === 'truck');
  const total = group.length;
  const cur = group.filter(e => e.destroyed).length;
  return { cur, total };
}

/** 根据当前任务与进度生成 1..N 行目标；与 GDD 任务类型一一对应。 */
export function buildObjectiveHudLines(mission: LoadedMission): ObjHudLine[] {
  const obj: MissionObjective = mission.data.objective;
  const withUsCasualties = (lines: ObjHudLine[]): ObjHudLine[] => {
    const limit = mission.data.usCasualtyLimit ?? 0;
    if (limit <= 0) return lines;
    const cur = mission.usCasualties ?? 0;
    return [
      ...lines,
      {
        displayIndex: lines.length + 1,
        state: cur > limit ? 'locked' : 'active',
        template: { key: 'usCasualties', cur, limit },
      },
    ];
  };

  switch (obj.type) {
    case 'destroy_kind_evac': {
      const evacDone = !!mission.shermanEvacuated;
      if (obj.destroyAllEnemiesBeforeEvac) {
        const remaining = liveEnemyCount(mission);
        const destroyDone = remaining === 0;
        return withUsCasualties([
          {
            displayIndex: 1,
            state: destroyDone ? 'done' : 'active',
            template: { key: 'destroyAllRemaining', remaining },
          },
          {
            displayIndex: 2,
            state: !destroyDone ? 'locked' : evacDone ? 'done' : 'active',
            template: { key: 'evacFromMark' },
          },
        ]);
      }
      const kinds = obj.kinds && obj.kinds.length > 0 ? obj.kinds : null;
      if (kinds) {
        const lines: ObjHudLine[] = [];
        let idx = 1;
        for (const k of kinds) {
          const destroyDone = allEnemiesOfKindDestroyed(mission, k);
          const { cur, total } = kindProgress(mission, k);
          lines.push({
            displayIndex: idx++,
            state: destroyDone ? 'done' : 'active',
            template: { key: 'destroyProgress', unitKind: k, cur, total },
          });
        }
        const allDestroy = kinds.every((k) => allEnemiesOfKindDestroyed(mission, k));
        lines.push({
          displayIndex: idx,
          state: !allDestroy ? 'locked' : evacDone ? 'done' : 'active',
          template: { key: 'evacFromMark' },
        });
        return withUsCasualties(lines);
      }
      if (!obj.kind) {
        return withUsCasualties([
          {
            displayIndex: 1,
            state: evacDone ? 'done' : 'active',
            template: { key: 'evacFromMark' },
          },
        ]);
      }
      const { cur, total } = kindProgress(mission, obj.kind);
      const destroyDone = allEnemiesOfKindDestroyed(mission, obj.kind);
      return withUsCasualties([
        {
          displayIndex: 1,
          state: destroyDone ? 'done' : 'active',
          template: { key: 'destroyProgress', unitKind: obj.kind, cur, total },
        },
        {
          displayIndex: 2,
          state: !destroyDone ? 'locked' : evacDone ? 'done' : 'active',
          template: { key: 'evacFromMark' },
        },
      ]);
    }
    case 'destroy_kind': {
      if (!obj.kind) return withUsCasualties([]);
      const { cur, total } = kindProgress(mission, obj.kind);
      const done = allEnemiesOfKindDestroyed(mission, obj.kind);
      return withUsCasualties([{
        displayIndex: 1,
        state: done ? 'done' : 'active',
        template: { key: 'destroyProgress', unitKind: obj.kind, cur, total },
      }]);
    }
    case 'destroy_all_enemies': {
      const remaining = liveEnemyCount(mission);
      return withUsCasualties([{
        displayIndex: 1,
        state: mission.enemies.length > 0 && remaining === 0 ? 'done' : 'active',
        template: { key: 'destroyAllUnitsRemaining', remaining },
      }]);
    }
    case 'destroy_truck': {
      const { cur, total } = truckProgress(mission);
      const done = total > 0 && mission.enemies.filter(e => e.kind === 'truck').every(e => e.destroyed);
      return withUsCasualties([{
        displayIndex: 1,
        state: done ? 'done' : 'active',
        template: { key: 'destroyTruck', cur, total },
      }]);
    }
    case 'exit_from_edge': {
      return withUsCasualties([{
        displayIndex: 1,
        state: 'active',
        template: { key: 'exitEdge' },
      }]);
    }
    default:
      return withUsCasualties([{
        displayIndex: 1,
        state: 'active',
        template: { key: 'unknownType', type: String((obj as MissionObjective).type) },
      }]);
  }
}
