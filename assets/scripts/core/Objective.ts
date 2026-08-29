import { offsetToAxial, rotateDirection } from './HexGrid';
import { LoadedMission } from './MissionLoader';
import { Axial, Direction, isAbandonedATGun, isAbandonedTank, isAttachedATGunCrew, MissionObjective, tileHasBridge, UnitKind } from './types';

export interface PlayerTankEvacDriveOptions {
  canExitTo?: (to: Axial) => boolean;
}

/** @deprecated Use PlayerTankEvacDriveOptions. */
export type ShermanEvacDriveOptions = PlayerTankEvacDriveOptions;

/** `destroy_kind_evac`：歼敌前置是否已满足（纯撤离无 kind/kinds 时恒为 true） */
export function destroyKindEvacPrereqMet(mission: LoadedMission, obj: MissionObjective): boolean {
  if (obj.type !== 'destroy_kind_evac') return false;
  if (obj.destroyAllEnemiesBeforeEvac) return liveEnemyCount(mission) === 0;
  const kinds = obj.kinds;
  if (kinds && kinds.length > 0) {
    return kinds.every((k) => allEnemiesOfKindDestroyed(mission, k));
  }
  if (obj.kind) return allEnemiesOfKindDestroyed(mission, obj.kind);
  return true;
}

export type MissionOutcome = 'ongoing' | 'victory' | 'defeat';

/** 判断当前任务状态：胜 / 负 / 进行中 */
export function checkOutcome(mission: LoadedMission): MissionOutcome {
  // Keep hand-built legacy fixtures/extensions working while MissionLoader
  // guarantees playerTank for all real missions.
  const playerTank = mission.playerTank ?? mission.sherman;
  if (playerTank.destroyed || isAbandonedTank(playerTank)) return 'defeat';
  if (mission.truckEscapeDefeat) return 'defeat';
  const usLimit = mission.data.usCasualtyLimit ?? 0;
  if (usLimit > 0 && (mission.usCasualties ?? 0) > usLimit) return 'defeat';
  if (isObjectiveMet(mission.data.objective, mission)) return 'victory';
  return 'ongoing';
}

/** 指定种类的敌方单位是否已全部被摧毁 */
export function allEnemiesOfKindDestroyed(mission: LoadedMission, kind: UnitKind): boolean {
  const group = mission.enemies.filter(e => e.kind === kind && !isAttachedATGunCrew(e));
  return group.length > 0 && group.every(e => e.destroyed || isAbandonedATGun(e) || isAbandonedTank(e));
}

export function liveEnemyCount(mission: LoadedMission): number {
  return mission.enemies.filter(e => !e.destroyed
    && !isAbandonedATGun(e)
    && !isAbandonedTank(e)
    && !isAttachedATGunCrew(e)).length;
}

/**
 * 玩家坦克是否满足「撤离移动」几何条件：已在撤离格、歼灭条件已达成、
 * 沿 `evacExitDir` 前进或后退的目标六角无地图格（可驶出地图外）。
 *
 * **桥梁约束（GDD §3.2）**：撤离格若叠加桥梁，`evacExitDir` 必须落在桥梁两端方向之一，
 * 否则视为越水阻挡（即便方向已指向地图外，仍按桥端规则拦截）。
 */
export function isPlayerTankEvacDrive(
  mission: LoadedMission,
  from: Axial,
  facing: Direction,
  dirSign: 1 | -1,
  to: Axial,
  options: PlayerTankEvacDriveOptions = {},
): boolean {
  const obj = mission.data.objective;
  const legacyTruckObjective = obj.type === 'destroy_truck';
  if (obj.type !== 'destroy_kind_evac' && !legacyTruckObjective) return false;
  const evacAt = obj.evacAt ?? (legacyTruckObjective ? { col: 7, row: 2 } : undefined);
  const evacExitDir = obj.evacExitDir ?? (legacyTruckObjective ? 0 : undefined);
  if (!evacAt || evacExitDir === undefined) return false;
  if (legacyTruckObjective) {
    if (!allEnemiesOfKindDestroyed(mission, 'truck')) return false;
  } else if (!destroyKindEvacPrereqMet(mission, obj)) return false;
  const ev = offsetToAxial(evacAt, mission.data.rowParityOffset === 1 ? 1 : 0);
  if (from.q !== ev.q || from.r !== ev.r) return false;
  const driveDir = (dirSign === 1 ? facing : rotateDirection(facing, 3)) as number;
  if (driveDir !== evacExitDir) return false;
  // 撤离格若是桥梁，驶出方向须落在桥端两方向之一
  const fromTile = mission.map.get(from);
  if (tileHasBridge(fromTile) && !fromTile!.bridgeEnds!.includes(driveDir as Direction)) return false;
  return !mission.map.has(to) || options.canExitTo?.(to) === true;
}

/** @deprecated Compatibility alias for older call sites and extensions. */
export const isShermanEvacDrive = isPlayerTankEvacDrive;

export function isObjectiveMet(obj: MissionObjective, mission: LoadedMission): boolean {
  switch (obj.type) {
    case 'destroy_all_enemies':
      return mission.enemies.length > 0 && liveEnemyCount(mission) === 0;
    case 'destroy_kind': {
      return !!obj.kind && allEnemiesOfKindDestroyed(mission, obj.kind);
    }
    case 'destroy_kind_evac': {
      if (!obj.evacAt || obj.evacExitDir === undefined) return false;
      if (!destroyKindEvacPrereqMet(mission, obj)) return false;
      return !!(mission.playerTankEvacuated || mission.shermanEvacuated);
    }
    case 'exit_from_edge':
      // MVP 未实现：按位置判定谢尔曼是否到达指定边
      return false;
    case 'destroy_truck':
      return allEnemiesOfKindDestroyed(mission, 'truck')
        && !!(mission.playerTankEvacuated || mission.shermanEvacuated);
    default:
      return false;
  }
}
