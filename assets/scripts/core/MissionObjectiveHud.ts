/**
 * 战斗 HUD 左上角「任务目标」多行文案的状态与模板数据（纯逻辑，不含 i18n）。
 * 文案在 BattleScene 里用 t() 展开。
 */

import { allEnemiesOfKindDestroyed } from './Objective';
import { LoadedMission } from './MissionLoader';
import { MissionObjective, UnitKind } from './types';

export type ObjHudState = 'locked' | 'active' | 'done';

export type ObjHudTemplate =
  | { key: 'destroyProgress'; unitKind: UnitKind; cur: number; total: number }
  | { key: 'evacFromMark' }
  | { key: 'destroyAll'; cur: number; total: number }
  | { key: 'destroyTruck'; cur: number; total: number }
  | { key: 'exitEdge' }
  | { key: 'unknownType'; type: string };

export interface ObjHudLine {
  displayIndex: number;
  state: ObjHudState;
  template: ObjHudTemplate;
}

function kindProgress(mission: LoadedMission, kind: UnitKind): { cur: number; total: number } {
  const group = mission.enemies.filter(e => e.kind === kind);
  const total = group.length;
  const cur = group.filter(e => e.destroyed).length;
  return { cur, total };
}

function allEnemyProgress(mission: LoadedMission): { cur: number; total: number } {
  const total = mission.enemies.length;
  const cur = mission.enemies.filter(e => e.destroyed).length;
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

  switch (obj.type) {
    case 'destroy_kind_evac': {
      const evacDone = !!mission.shermanEvacuated;
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
        return lines;
      }
      if (!obj.kind) {
        return [
          {
            displayIndex: 1,
            state: evacDone ? 'done' : 'active',
            template: { key: 'evacFromMark' },
          },
        ];
      }
      const { cur, total } = kindProgress(mission, obj.kind);
      const destroyDone = allEnemiesOfKindDestroyed(mission, obj.kind);
      return [
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
      ];
    }
    case 'destroy_kind': {
      if (!obj.kind) return [];
      const { cur, total } = kindProgress(mission, obj.kind);
      const done = allEnemiesOfKindDestroyed(mission, obj.kind);
      return [{
        displayIndex: 1,
        state: done ? 'done' : 'active',
        template: { key: 'destroyProgress', unitKind: obj.kind, cur, total },
      }];
    }
    case 'destroy_all_enemies': {
      const { cur, total } = allEnemyProgress(mission);
      const done = total > 0 && mission.enemies.every(e => e.destroyed);
      return [{
        displayIndex: 1,
        state: done ? 'done' : 'active',
        template: { key: 'destroyAll', cur, total },
      }];
    }
    case 'destroy_truck': {
      const { cur, total } = truckProgress(mission);
      const done = total > 0 && mission.enemies.filter(e => e.kind === 'truck').every(e => e.destroyed);
      return [{
        displayIndex: 1,
        state: done ? 'done' : 'active',
        template: { key: 'destroyTruck', cur, total },
      }];
    }
    case 'exit_from_edge': {
      return [{
        displayIndex: 1,
        state: 'active',
        template: { key: 'exitEdge' },
      }];
    }
    default:
      return [{
        displayIndex: 1,
        state: 'active',
        template: { key: 'unknownType', type: String((obj as MissionObjective).type) },
      }];
  }
}
