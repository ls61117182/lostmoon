import { LoadedMission } from './MissionLoader';
import { MissionObjective } from './types';

export type MissionOutcome = 'ongoing' | 'victory' | 'defeat';

/** 判断当前任务状态：胜 / 负 / 进行中 */
export function checkOutcome(mission: LoadedMission): MissionOutcome {
  if (mission.sherman.destroyed) return 'defeat';
  if (isObjectiveMet(mission.data.objective, mission)) return 'victory';
  return 'ongoing';
}

export function isObjectiveMet(obj: MissionObjective, mission: LoadedMission): boolean {
  switch (obj.type) {
    case 'destroy_all_enemies':
      return mission.enemies.length > 0 && mission.enemies.every(e => e.destroyed);
    case 'destroy_kind': {
      const group = mission.enemies.filter(e => e.kind === obj.kind);
      return group.length > 0 && group.every(e => e.destroyed);
    }
    case 'exit_from_edge':
      // MVP 未实现：按位置判定谢尔曼是否到达指定边
      return false;
    case 'destroy_truck':
      return mission.enemies
        .filter(e => e.kind === 'truck')
        .every(e => e.destroyed);
    default:
      return false;
  }
}
