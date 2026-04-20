import { LoadedMission } from './MissionLoader';
import { Direction, UnitKind } from './types';

/** localStorage 的 key；数据结构升级由 version 字段控制，不一定要改 key */
export const SAVE_KEY = 'lone_sherman_save_v1';

/**
 * 存档版本号。
 *   1: 位置 + 朝向 + 回合 + 移动力
 *   2: 追加 attacksLeft + 每个单位的 damaged/destroyed 状态（战斗系统）
 */
const SAVE_VERSION = 2 as const;

interface UnitSnapshot {
  kind: UnitKind;
  q: number;
  r: number;
  facing: Direction | null;
  damaged?: boolean;
  destroyed?: boolean;
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  missionId: string;
  turn: number;
  phase: 'player' | 'enemy';
  movesLeft: number;
  attacksLeft: number;
  sherman: UnitSnapshot;
  enemies: UnitSnapshot[];
}

export interface SnapshotParams {
  missionId: string;
  mission: LoadedMission;
  turn: number;
  phase: 'player' | 'enemy';
  movesLeft: number;
  attacksLeft: number;
}

/**
 * 将当前战局打包成纯数据。故意不引用任何 Cocos 类型，这样未来做
 * 单元测试或服务器战报回放时可以直接使用同一 JSON 格式。
 */
export function captureSave(p: SnapshotParams): SaveData {
  return {
    version: SAVE_VERSION,
    missionId: p.missionId,
    turn: p.turn,
    phase: p.phase,
    movesLeft: p.movesLeft,
    attacksLeft: p.attacksLeft,
    sherman: {
      kind: p.mission.sherman.kind,
      q: p.mission.sherman.pos.q,
      r: p.mission.sherman.pos.r,
      facing: p.mission.sherman.facing,
      damaged: p.mission.sherman.damaged,
      destroyed: p.mission.sherman.destroyed,
    },
    enemies: p.mission.enemies.map(e => ({
      kind: e.kind,
      q: e.pos.q,
      r: e.pos.r,
      facing: e.facing,
      damaged: e.damaged,
      destroyed: e.destroyed,
    })),
  };
}

export interface ApplyResult {
  ok: boolean;
  /** 恢复后的回合数，调用方写回场景 */
  turn?: number;
  phase?: 'player' | 'enemy';
  movesLeft?: number;
  attacksLeft?: number;
  reason?: string;
}

/**
 * 将存档应用到当前 mission（就地修改 Unit 对象，保持引用稳定，
 * 这样外部保存的 Unit 指针/Set 缓存不会失效）。
 *
 * 严格校验：版本号、任务 id、敌人数量和种类。任何不匹配都返回 ok=false，
 * 由调用方在 UI 上提示，不做猜测性修复。
 */
export function applySave(
  mission: LoadedMission,
  missionId: string,
  save: SaveData,
): ApplyResult {
  if (save.version !== SAVE_VERSION) {
    return { ok: false, reason: `版本不兼容 (${save.version} vs ${SAVE_VERSION})` };
  }
  if (save.missionId !== missionId) {
    return { ok: false, reason: `任务不匹配 (${save.missionId} vs ${missionId})` };
  }
  if (save.sherman.kind !== mission.sherman.kind) {
    return { ok: false, reason: `谢尔曼种类不匹配` };
  }
  if (save.enemies.length !== mission.enemies.length) {
    return {
      ok: false,
      reason: `敌人数不匹配 (${save.enemies.length} vs ${mission.enemies.length})`,
    };
  }
  for (let i = 0; i < save.enemies.length; i++) {
    if (save.enemies[i].kind !== mission.enemies[i].kind) {
      return { ok: false, reason: `敌人 #${i} 种类不匹配` };
    }
  }

  // 校验通过，写入状态
  mission.sherman.pos = { q: save.sherman.q, r: save.sherman.r };
  mission.sherman.facing = save.sherman.facing;
  mission.sherman.damaged = save.sherman.damaged ?? false;
  mission.sherman.destroyed = save.sherman.destroyed ?? false;
  for (let i = 0; i < save.enemies.length; i++) {
    const s = save.enemies[i];
    const live = mission.enemies[i];
    live.pos = { q: s.q, r: s.r };
    live.facing = s.facing;
    live.damaged = s.damaged ?? false;
    live.destroyed = s.destroyed ?? false;
  }

  return {
    ok: true,
    turn: save.turn,
    phase: save.phase,
    movesLeft: save.movesLeft,
    attacksLeft: save.attacksLeft,
  };
}
