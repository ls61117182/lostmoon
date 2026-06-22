import type { LoadedMission } from './MissionLoader';
import type { MissionSource } from './CustomMissionStore';
import type { Direction, Faction, ShermanCrew, Unit, UnitKind } from './types';
import { getUnitStats } from './UnitDB';
import { GameMode } from './GameMode';

/** localStorage 的 key；数据结构升级由 version 字段控制，不一定要改 key */
export const SAVE_KEY = 'lone_sherman_save_v1';

/**
 * 存档版本号。
 *   1: 位置 + 朝向 + 回合 + 移动力
 *   2: 追加 attacksLeft + 每个单位的 damaged/destroyed 状态（战斗系统）
 *   3: 追加玩家子阶段 / 本阶段骰子 / 谢尔曼与敌军的战术字段（装填、舱盖、乘员、烟雾等）
 */
const SAVE_VERSION = 5 as const;

/** 与 BattleScene PlayerStep 一致；独立在此避免 BattleScene ↔ SaveLoad 环依赖 */
export type SavePlayerStep = 'choose' | 'movement' | 'attack' | 'misc';

interface UnitSnapshot {
  id?: string;
  kind: UnitKind;
  faction?: Faction;
  q: number;
  r: number;
  facing: Direction | null;
  turretFacing?: Direction;
  damaged?: boolean;
  destroyed?: boolean;
  /** v3：烟雾掩护（谢尔曼 / 德军均可能） */
  smoked?: boolean;
  /** v3：仅谢尔曼 */
  fireLevel?: number;
  turretDamaged?: boolean;
  paralyzed?: boolean;
  loaded?: boolean;
  hatchOpen?: boolean;
  visionRange?: number;
  crew?: ShermanCrew;
}

export interface SaveData {
  version: typeof SAVE_VERSION | 4 | 3 | 2;
  /** v5: selected rule profile; older saves resume as classic. */
  gameMode?: GameMode;
  missionId: string;
  missionSource?: MissionSource;
  turn: number;
  phase: 'player' | 'enemy';
  movesLeft: number;
  attacksLeft: number;
  sherman: UnitSnapshot;
  allies?: UnitSnapshot[];
  enemies: UnitSnapshot[];
  /** v3：杂项阶段是否已结束 */
  miscDone?: boolean;
  /** v3：玩家回合子状态 */
  playerStep?: SavePlayerStep;
  /** Whether the phase-choice hatch button has already been used this player turn. */
  hatchChangedThisTurn?: boolean;
  /** v3：当前子阶段骰子槽（与 BattleScene.phaseDice 同构） */
  phaseDice?: Array<{ pip: number; used: boolean }>;
  /** 谢尔曼是否已完成 destroy_kind_evac 离场移动 */
  shermanEvacuated?: boolean;
  /** 任务 5：德军卡车是否因回合结束事件已驶出地图而判负 */
  truckEscapeDefeat?: boolean;
  /** Pacific: accumulated US casualties. */
  usCasualties?: number;
}

export interface SnapshotParams {
  gameMode: GameMode;
  missionId: string;
  missionSource?: MissionSource;
  mission: LoadedMission;
  turn: number;
  phase: 'player' | 'enemy';
  movesLeft: number;
  attacksLeft: number;
  miscDone: boolean;
  playerStep: SavePlayerStep;
  hatchChangedThisTurn: boolean;
  phaseDice: Array<{ pip: number; used: boolean }>;
}

function captureUnit(u: Unit): UnitSnapshot {
  return {
    id: u.id,
    kind: u.kind,
    faction: u.faction,
    q: u.pos.q,
    r: u.pos.r,
    facing: u.facing,
    turretFacing: u.turretFacing,
    damaged: u.damaged,
    destroyed: u.destroyed,
    fireLevel: u.fireLevel,
    turretDamaged: u.turretDamaged,
    paralyzed: u.paralyzed,
    loaded: u.loaded,
    hatchOpen: u.hatchOpen,
    visionRange: u.visionRange,
    crew: u.crew ? { ...u.crew } : undefined,
    smoked: u.smoked,
  };
}

function applyUnitSnapshot(live: Unit, s: UnitSnapshot): void {
  live.pos = { q: s.q, r: s.r };
  live.facing = s.facing;
  live.turretFacing = s.turretFacing ?? (s.facing ?? undefined);
  live.damaged = s.damaged ?? false;
  live.destroyed = s.destroyed ?? false;
  if (s.smoked !== undefined) live.smoked = s.smoked;
  if (s.fireLevel !== undefined) live.fireLevel = s.fireLevel;
  if (s.turretDamaged !== undefined) live.turretDamaged = s.turretDamaged;
  if (s.paralyzed !== undefined) live.paralyzed = s.paralyzed;
  if (s.loaded !== undefined) live.loaded = s.loaded;
  if (s.hatchOpen !== undefined) live.hatchOpen = s.hatchOpen;
  if (s.visionRange !== undefined) live.visionRange = s.visionRange;
  if (s.crew) live.crew = { ...s.crew };
}

function makeSavedUnit(s: UnitSnapshot, idFallback: string, theater: LoadedMission['data']['theater']): Unit {
  const stats = getUnitStats(s.kind, theater ?? 'europe');
  const unit: Unit = {
    id: s.id || idFallback,
    kind: s.kind,
    faction: s.faction ?? stats.faction,
    pos: { q: s.q, r: s.r },
    facing: s.facing,
    stats,
  };
  applyUnitSnapshot(unit, s);
  return unit;
}

/**
 * 将当前战局打包成纯数据。故意不引用任何 Cocos 类型，这样未来做
 * 单元测试或服务器战报回放时可以直接使用同一 JSON 格式。
 */
export function captureSave(p: SnapshotParams): SaveData {
  const sh = p.mission.sherman;
  return {
    version: SAVE_VERSION,
    gameMode: p.gameMode,
    missionId: p.missionId,
    missionSource: p.missionSource,
    turn: p.turn,
    phase: p.phase,
    movesLeft: p.movesLeft,
    attacksLeft: p.attacksLeft,
    miscDone: p.miscDone,
    playerStep: p.playerStep,
    hatchChangedThisTurn: p.hatchChangedThisTurn,
    phaseDice: p.phaseDice.map(s => ({ pip: s.pip, used: s.used })),
    sherman: {
      ...captureUnit(sh),
      damaged: false,
    },
    allies: p.mission.allies.map(captureUnit),
    enemies: p.mission.enemies.map(captureUnit),
    shermanEvacuated: p.mission.shermanEvacuated ?? false,
    truckEscapeDefeat: p.mission.truckEscapeDefeat ?? false,
    usCasualties: p.mission.usCasualties ?? 0,
  };
}

export interface ApplyResult {
  ok: boolean;
  /** 恢复后的回合数，调用方写回场景 */
  turn?: number;
  phase?: 'player' | 'enemy';
  movesLeft?: number;
  attacksLeft?: number;
  miscDone?: boolean;
  playerStep?: SavePlayerStep;
  hatchChangedThisTurn?: boolean;
  phaseDice?: Array<{ pip: number; used: boolean }>;
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
  if (save.version !== SAVE_VERSION && save.version !== 4 && save.version !== 3 && save.version !== 2) {
    return { ok: false, reason: `版本不兼容 (${save.version} vs ${SAVE_VERSION})` };
  }
  if (save.missionId !== missionId) {
    return { ok: false, reason: `任务不匹配 (${save.missionId} vs ${missionId})` };
  }
  if (save.sherman.kind !== mission.sherman.kind) {
    return { ok: false, reason: `谢尔曼种类不匹配` };
  }
  if (save.enemies.length < mission.enemies.length) {
    return {
      ok: false,
      reason: `敌人数不匹配 (${save.enemies.length} vs ${mission.enemies.length})`,
    };
  }
  for (let i = 0; i < mission.enemies.length; i++) {
    if (save.enemies[i].kind !== mission.enemies[i].kind) {
      return { ok: false, reason: `敌人 #${i} 种类不匹配` };
    }
  }
  const extraEnemies: Unit[] = [];
  for (let i = mission.enemies.length; i < save.enemies.length; i++) {
    extraEnemies.push(makeSavedUnit(save.enemies[i], `save_enemy_${i}`, mission.data.theater));
  }
  if (save.version >= 4) {
    const allies = save.allies ?? [];
    if (allies.length !== mission.allies.length) {
      return {
        ok: false,
        reason: `友军数不匹配 (${allies.length} vs ${mission.allies.length})`,
      };
    }
    for (let i = 0; i < allies.length; i++) {
      if (allies[i].kind !== mission.allies[i].kind) {
        return { ok: false, reason: `友军 #${i} 种类不匹配` };
      }
    }
  }

  // 校验通过，写入状态
  mission.sherman.pos = { q: save.sherman.q, r: save.sherman.r };
  mission.enemies.push(...extraEnemies);
  mission.sherman.facing = save.sherman.facing;
  mission.sherman.turretFacing = save.sherman.turretFacing ?? (save.sherman.facing ?? undefined);
  // 谢尔曼不再使用 damaged 语义；旧档里若有也丢弃，避免地图误显示
  mission.sherman.damaged = false;
  mission.sherman.destroyed = save.sherman.destroyed ?? false;
  for (let i = 0; i < save.enemies.length; i++) {
    const s = save.enemies[i];
    const live = mission.enemies[i];
    applyUnitSnapshot(live, s);
  }
  if (save.version >= 4 && save.allies) {
    for (let i = 0; i < save.allies.length; i++) {
      const s = save.allies[i];
      const live = mission.allies[i];
      applyUnitSnapshot(live, s);
    }
  }

  if (save.version >= 3) {
    const sh = mission.sherman;
    const ss = save.sherman;
    if (ss.fireLevel !== undefined) sh.fireLevel = ss.fireLevel;
    if (ss.turretDamaged !== undefined) sh.turretDamaged = ss.turretDamaged;
    if (ss.paralyzed !== undefined) sh.paralyzed = ss.paralyzed;
    if (ss.loaded !== undefined) sh.loaded = ss.loaded;
    if (ss.hatchOpen !== undefined) sh.hatchOpen = ss.hatchOpen;
    if (ss.visionRange !== undefined) sh.visionRange = ss.visionRange;
    if (ss.crew) sh.crew = { ...ss.crew };
    if (ss.smoked !== undefined) sh.smoked = ss.smoked;
    mission.shermanEvacuated = save.shermanEvacuated ?? false;
    mission.truckEscapeDefeat = save.truckEscapeDefeat ?? false;
    mission.usCasualties = save.usCasualties ?? 0;
  }

  return {
    ok: true,
    turn: save.turn,
    phase: save.phase,
    movesLeft: save.movesLeft,
    attacksLeft: save.attacksLeft,
    ...(save.version >= 3
      ? {
        miscDone: save.miscDone ?? false,
        playerStep: save.playerStep ?? 'choose',
        hatchChangedThisTurn: save.hatchChangedThisTurn ?? false,
        phaseDice: save.phaseDice ?? [],
      }
      : {
        miscDone: false,
        playerStep: 'choose' as SavePlayerStep,
        hatchChangedThisTurn: false,
        phaseDice: [] as Array<{ pip: number; used: boolean }>,
      }),
  };
}
