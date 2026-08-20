import type { LoadedMission } from './MissionLoader';
import type { MissionSource } from './CustomMissionStore';
import type { ATGunCrewKind, CrewLevels, CrewSkills, Direction, Faction, FireDirection, ShermanCrew, Unit, UnitKind, UnitLevel } from './types';
import { isTankKind, neutralizeUncrewedTank } from './types';
import { normalizePlayerCrewLevels, normalizeUnitLevel } from './UnitLevel';
import { getUnitStats } from './UnitDB';
import { GameMode } from './GameMode';
import { HexMap } from './HexGrid';
import { AttackPositionMemory, cloneAttackPositionMemory } from './AttackPositionMemory';

/** localStorage 的 key；数据结构升级由 version 字段控制，不一定要改 key */
export const SAVE_KEY = 'lone_sherman_save_v1';

/**
 * 存档版本号。
 *   1: 位置 + 朝向 + 回合 + 移动力
 *   2: 追加 attacksLeft + 每个单位的 damaged/destroyed 状态（战斗系统）
 *   3: 追加玩家子阶段 / 本阶段骰子 / 谢尔曼与敌军的战术字段（装填、舱盖、乘员、烟雾等）
 *   6: 追加非玩家单位等级与玩家独立乘员等级
 *   7: 追加乘员技能与伏击跨回合状态
 *   8: 追加本回合/上回合敌方最后攻击位置记忆
 */
const SAVE_VERSION = 8 as const;

/** 与 BattleScene PlayerStep 一致；独立在此避免 BattleScene ↔ SaveLoad 环依赖 */
export type SavePlayerStep = 'choose' | 'movement' | 'attack' | 'misc';

interface UnitSnapshot {
  id?: string;
  kind: UnitKind;
  faction?: Faction;
  q: number;
  r: number;
  facing: Direction | null;
  turretFacing?: FireDirection;
  previousTurretFacing?: FireDirection;
  diagonalGunnerSidePreference?: FireDirection;
  turretVisualTarget?: { q: number; r: number };
  damaged?: boolean;
  destroyed?: boolean;
  /** v3：烟雾掩护（谢尔曼 / 德军均可能） */
  smoked?: boolean;
  suppressed?: boolean;
  /** v3：仅谢尔曼 */
  fireLevel?: number;
  turretDamaged?: boolean;
  paralyzed?: boolean;
  loaded?: boolean;
  hatchOpen?: boolean;
  visionRange?: number;
  gunnerVisionRange?: number;
  interiorVisionRange?: number;
  radioDamaged?: boolean;
  crew?: ShermanCrew;
  unitLevel?: UnitLevel;
  atGunCrewLevel?: UnitLevel;
  crewLevels?: CrewLevels;
  crewSkills?: CrewSkills;
  ambushAttackedSinceTurnEnd?: boolean;
  ambushObscuredSinceTurnEnd?: boolean;
  ambushReadyThisTurn?: boolean;
  ambushActedThisTurn?: boolean;
  atGunCrewAlive?: boolean;
  atGunCrewKind?: ATGunCrewKind;
  atGunCrewTargetSize?: number;
  atGunCrewGeneration?: number;
  atGunControllerUnitId?: string;
  attachedToATGunId?: string;
}

export interface SaveData {
  version: typeof SAVE_VERSION | 7 | 6 | 5 | 4 | 3 | 2;
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
  /** v5: active smoke screen hexes, stored as HexMap.keyOf(pos). */
  smokeHexes?: string[];
  /** v5: side that deployed each active smoke hex, for phase-based clearing. */
  smokeHexOwners?: Record<string, 'friendly' | 'enemy'>;
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
  /** v8：供无可见目标时转向使用的跨回合攻击位置记忆。 */
  attackPositionMemory?: AttackPositionMemory;
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
  attackPositionMemory?: AttackPositionMemory;
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
    previousTurretFacing: u.previousTurretFacing,
    diagonalGunnerSidePreference: u.diagonalGunnerSidePreference,
    turretVisualTarget: u.turretVisualTarget ? { ...u.turretVisualTarget } : undefined,
    damaged: u.damaged,
    destroyed: u.destroyed,
    fireLevel: u.fireLevel,
    turretDamaged: u.turretDamaged,
    paralyzed: u.paralyzed,
    loaded: u.loaded,
    hatchOpen: u.hatchOpen,
    visionRange: u.visionRange,
    gunnerVisionRange: u.gunnerVisionRange,
    interiorVisionRange: u.interiorVisionRange,
    radioDamaged: u.radioDamaged,
    crew: u.crew ? { ...u.crew } : undefined,
    unitLevel: u.unitLevel,
    atGunCrewLevel: u.atGunCrewLevel,
    crewLevels: u.crewLevels ? { ...u.crewLevels } : undefined,
    crewSkills: u.crewSkills ? Object.fromEntries(
      Object.entries(u.crewSkills).map(([slot, skills]) => [slot, skills?.slice()]),
    ) : undefined,
    ambushAttackedSinceTurnEnd: u.ambushAttackedSinceTurnEnd,
    ambushObscuredSinceTurnEnd: u.ambushObscuredSinceTurnEnd,
    ambushReadyThisTurn: u.ambushReadyThisTurn,
    ambushActedThisTurn: u.ambushActedThisTurn,
    atGunCrewAlive: u.atGunCrewAlive,
    atGunCrewKind: u.atGunCrewKind,
    atGunCrewTargetSize: u.atGunCrewTargetSize,
    atGunCrewGeneration: u.atGunCrewGeneration,
    atGunControllerUnitId: u.atGunControllerUnitId,
    attachedToATGunId: u.attachedToATGunId,
    smoked: u.smoked,
    suppressed: u.suppressed,
  };
}

function captureSmokeHexOwners(mission: LoadedMission): Record<string, 'friendly' | 'enemy'> {
  const owners: Record<string, 'friendly' | 'enemy'> = {};
  for (const [key, owner] of mission.smokeHexOwners) owners[key] = owner;
  return owners;
}

function savedTurretFacing(value: unknown, fallback: Direction | null): FireDirection | undefined {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 0 && n <= 11) return n as FireDirection;
  return fallback ?? undefined;
}

function applyUnitSnapshot(live: Unit, s: UnitSnapshot, legacyCrewlessTankFaction?: Faction): void {
  const recoverLegacyCrewlessTankFaction = isTankKind(live.kind)
    && !s.crew
    && s.faction === 'neutral'
    && legacyCrewlessTankFaction !== undefined;
  // Older turn-end reinforcements were saved without a crew object. Once any
  // attack passed through applyAttack(), that invalid state was neutralized.
  // Loading then supplied a full default crew but retained the neutral faction,
  // producing a crewed tank that its former allies could attack. The owning
  // mission array is authoritative for this one inconsistent legacy shape.
  live.faction = recoverLegacyCrewlessTankFaction
    ? legacyCrewlessTankFaction
    : (s.faction ?? live.stats.faction);
  live.pos = { q: s.q, r: s.r };
  live.facing = s.facing;
  live.turretFacing = savedTurretFacing(s.turretFacing, s.facing);
  live.previousTurretFacing = savedTurretFacing(s.previousTurretFacing, s.facing);
  live.diagonalGunnerSidePreference = savedTurretFacing(s.diagonalGunnerSidePreference, null);
  live.turretVisualTarget = s.turretVisualTarget ? { ...s.turretVisualTarget } : undefined;
  live.damaged = s.damaged ?? false;
  live.destroyed = s.destroyed ?? false;
  // A snapshot is authoritative. JSON.stringify omits properties whose value is
  // undefined, so retaining the live value here leaks damage acquired after a
  // checkpoint (notably when retrying a campaign segment).
  live.smoked = s.smoked ?? false;
  live.suppressed = s.suppressed ?? false;
  live.fireLevel = s.fireLevel ?? 0;
  live.turretDamaged = s.turretDamaged ?? false;
  live.paralyzed = s.paralyzed ?? false;
  live.loaded = s.loaded ?? false;
  if (s.visionRange !== undefined) live.visionRange = s.visionRange;
  if (s.gunnerVisionRange !== undefined) live.gunnerVisionRange = s.gunnerVisionRange;
  if (s.interiorVisionRange !== undefined) live.interiorVisionRange = s.interiorVisionRange;
  live.radioDamaged = s.radioDamaged ?? false;
  if (s.crew) live.crew = { ...s.crew };
  if (live.id === 'sherman_player') {
    live.crewLevels = normalizePlayerCrewLevels(s.crewLevels ?? live.crewLevels);
  } else if (live.kind === 'at_gun') {
    live.atGunCrewLevel = normalizeUnitLevel(s.atGunCrewLevel ?? s.unitLevel ?? live.atGunCrewLevel);
    live.unitLevel = undefined;
  } else {
    live.unitLevel = normalizeUnitLevel(s.unitLevel ?? live.unitLevel);
  }
  if (s.crewSkills) live.crewSkills = Object.fromEntries(
    Object.entries(s.crewSkills).map(([slot, skills]) => [slot, skills?.slice()]),
  );
  live.ambushAttackedSinceTurnEnd = s.ambushAttackedSinceTurnEnd ?? false;
  live.ambushObscuredSinceTurnEnd = s.ambushObscuredSinceTurnEnd ?? false;
  live.ambushReadyThisTurn = s.ambushReadyThisTurn ?? false;
  live.ambushActedThisTurn = s.ambushActedThisTurn ?? false;
  if (s.atGunCrewAlive !== undefined) live.atGunCrewAlive = s.atGunCrewAlive;
  if (s.atGunCrewKind !== undefined) live.atGunCrewKind = s.atGunCrewKind;
  if (s.atGunCrewTargetSize !== undefined) live.atGunCrewTargetSize = s.atGunCrewTargetSize;
  if (s.atGunCrewGeneration !== undefined) live.atGunCrewGeneration = s.atGunCrewGeneration;
  live.atGunControllerUnitId = s.atGunControllerUnitId;
  live.attachedToATGunId = s.attachedToATGunId;
  live.hatchOpen = s.hatchOpen === true && live.crew?.commander !== false;
  neutralizeUncrewedTank(live);
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
  if (isTankKind(s.kind)) {
    unit.crew = {
      commander: true,
      loader: true,
      gunner: true,
      driver: true,
      coDriver: true,
    };
  }
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
    attackPositionMemory: cloneAttackPositionMemory(p.attackPositionMemory),
    sherman: {
      ...captureUnit(sh),
      damaged: false,
    },
    allies: p.mission.allies.map(captureUnit),
    enemies: p.mission.enemies.map(captureUnit),
    smokeHexes: Array.from(p.mission.smokeHexes ?? []),
    smokeHexOwners: captureSmokeHexOwners(p.mission),
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
  attackPositionMemory?: AttackPositionMemory;
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
  if (save.version !== SAVE_VERSION && save.version !== 7 && save.version !== 6 && save.version !== 5 && save.version !== 4 && save.version !== 3 && save.version !== 2) {
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
  mission.sherman.turretFacing = savedTurretFacing(save.sherman.turretFacing, save.sherman.facing);
  mission.sherman.previousTurretFacing = savedTurretFacing(save.sherman.previousTurretFacing, save.sherman.facing);
  mission.sherman.diagonalGunnerSidePreference = savedTurretFacing(save.sherman.diagonalGunnerSidePreference, null);
  mission.sherman.turretVisualTarget = save.sherman.turretVisualTarget ? { ...save.sherman.turretVisualTarget } : undefined;
  // 谢尔曼不再使用 damaged 语义；旧档里若有也丢弃，避免地图误显示
  mission.sherman.damaged = false;
  mission.sherman.destroyed = save.sherman.destroyed ?? false;
  mission.sherman.faction = save.sherman.faction ?? mission.sherman.stats.faction;
  for (let i = 0; i < save.enemies.length; i++) {
    const s = save.enemies[i];
    const live = mission.enemies[i];
    applyUnitSnapshot(
      live,
      s,
      mission.data.theater === 'pacific' ? 'japanese' : 'german',
    );
  }
  if (save.version >= 4 && save.allies) {
    for (let i = 0; i < save.allies.length; i++) {
      const s = save.allies[i];
      const live = mission.allies[i];
      applyUnitSnapshot(live, s, mission.sherman.faction);
    }
  }

  if (save.version >= 3) {
    const sh = mission.sherman;
    const ss = save.sherman;
    // Restore defaults as well as explicit truthy damage. Campaign checkpoints
    // are JSON-round-tripped, which removes undefined clean-state properties.
    sh.fireLevel = ss.fireLevel ?? 0;
    sh.turretDamaged = ss.turretDamaged ?? false;
    sh.paralyzed = ss.paralyzed ?? false;
    sh.loaded = ss.loaded ?? false;
    if (ss.hatchOpen !== undefined) sh.hatchOpen = ss.hatchOpen;
    if (ss.visionRange !== undefined) sh.visionRange = ss.visionRange;
    if (ss.gunnerVisionRange !== undefined) sh.gunnerVisionRange = ss.gunnerVisionRange;
    if (ss.interiorVisionRange !== undefined) sh.interiorVisionRange = ss.interiorVisionRange;
    sh.radioDamaged = ss.radioDamaged ?? false;
    if (ss.crew) sh.crew = { ...ss.crew };
    sh.crewLevels = normalizePlayerCrewLevels(ss.crewLevels ?? sh.crewLevels);
    if (ss.crewSkills) sh.crewSkills = Object.fromEntries(
      Object.entries(ss.crewSkills).map(([slot, skills]) => [slot, skills?.slice()]),
    );
    sh.ambushAttackedSinceTurnEnd = ss.ambushAttackedSinceTurnEnd ?? false;
    sh.ambushObscuredSinceTurnEnd = ss.ambushObscuredSinceTurnEnd ?? false;
    sh.ambushReadyThisTurn = ss.ambushReadyThisTurn ?? false;
    sh.ambushActedThisTurn = ss.ambushActedThisTurn ?? false;
    neutralizeUncrewedTank(sh);
    if (ss.smoked !== undefined) sh.smoked = ss.smoked;
    mission.shermanEvacuated = save.shermanEvacuated ?? false;
    mission.truckEscapeDefeat = save.truckEscapeDefeat ?? false;
    mission.usCasualties = save.usCasualties ?? 0;
  }

  mission.smokeHexes.clear();
  mission.smokeHexOwners.clear();
  for (const key of save.smokeHexes ?? []) {
    mission.smokeHexes.add(key);
    mission.smokeHexOwners.set(key, save.smokeHexOwners?.[key] ?? 'friendly');
  }
  if (!save.smokeHexes) {
    for (const u of [mission.sherman, ...mission.allies]) {
      if (u.smoked) {
        const key = HexMap.keyOf(u.pos);
        mission.smokeHexes.add(key);
        mission.smokeHexOwners.set(key, 'friendly');
      }
    }
    for (const u of mission.enemies) {
      if (u.smoked) {
        const key = HexMap.keyOf(u.pos);
        mission.smokeHexes.add(key);
        mission.smokeHexOwners.set(key, 'enemy');
      }
    }
  }
  for (const u of [mission.sherman, ...mission.allies, ...mission.enemies]) {
    u.smoked = false;
  }

  return {
    ok: true,
    turn: save.turn,
    phase: save.phase,
    movesLeft: save.movesLeft,
    attacksLeft: save.attacksLeft,
    attackPositionMemory: save.version >= 8
      ? cloneAttackPositionMemory(save.attackPositionMemory)
      : cloneAttackPositionMemory(),
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
