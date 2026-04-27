import { offsetToAxial, rotateDirection } from './HexGrid';
import { LoadedMission } from './MissionLoader';
import { Axial, Direction, MissionObjective, UnitKind } from './types';

export type MissionOutcome = 'ongoing' | 'victory' | 'defeat';

/** 判断当前任务状态：胜 / 负 / 进行中 */
export function checkOutcome(mission: LoadedMission): MissionOutcome {
  if (mission.sherman.destroyed) return 'defeat';
  if (isObjectiveMet(mission.data.objective, mission)) return 'victory';
  return 'ongoing';
}

/** 指定种类的敌方单位是否已全部被摧毁 */
export function allEnemiesOfKindDestroyed(mission: LoadedMission, kind: UnitKind): boolean {
  const group = mission.enemies.filter(e => e.kind === kind);
  return group.length > 0 && group.every(e => e.destroyed);
}

/**
 * 谢尔曼是否满足「撤离移动」几何条件：已在撤离格、歼灭条件已达成、
 * 沿 `evacExitDir` 前进或后退的目标六角无地图格（可驶出地图外）。
 */
export function isShermanEvacDrive(
  mission: LoadedMission,
  from: Axial,
  facing: Direction,
  dirSign: 1 | -1,
  to: Axial,
): boolean {
  const obj = mission.data.objective;
  if (obj.type !== 'destroy_kind_evac') return false;
  if (!obj.evacAt || obj.evacExitDir === undefined) return false;
  if (obj.kind && !allEnemiesOfKindDestroyed(mission, obj.kind)) return false;
  const ev = offsetToAxial(obj.evacAt);
  if (from.q !== ev.q || from.r !== ev.r) return false;
  const driveDir = (dirSign === 1 ? facing : rotateDirection(facing, 3)) as number;
  if (driveDir !== obj.evacExitDir) return false;
  return !mission.map.has(to);
}

export function isObjectiveMet(obj: MissionObjective, mission: LoadedMission): boolean {
  switch (obj.type) {
    case 'destroy_all_enemies':
      return mission.enemies.length > 0 && mission.enemies.every(e => e.destroyed);
    case 'destroy_kind': {
      const group = mission.enemies.filter(e => e.kind === obj.kind);
      return group.length > 0 && group.every(e => e.destroyed);
    }
    case 'destroy_kind_evac': {
      if (!obj.evacAt || obj.evacExitDir === undefined) return false;
      if (obj.kind && !allEnemiesOfKindDestroyed(mission, obj.kind)) return false;
      return !!mission.shermanEvacuated;
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
