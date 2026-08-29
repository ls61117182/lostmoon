import type { MissionData } from './types';
import type { TurnEndEventRow } from './TurnEndEventDB';

export const CUSTOM_MISSION_INDEX_KEY = 'lone_sherman_custom_mission_index_v1';
export const CUSTOM_MISSION_KEY_PREFIX = 'lone_sherman_custom_mission_';
export const CUSTOM_MISSION_MAX_SLOTS = 10;
const transientPackages = new Map<string, CustomMissionPackage>();

export interface CustomMissionPackage {
  schemaVersion: 1 | 2;
  editorVersion: string;
  savedAt: number;
  source: 'player' | 'developer';
  mission: MissionData;
  turnEndEvents: TurnEndEventRow[];
  editor?: {
    thumbnail?: string;
    notes?: string;
    tags?: string[];
  };
}

export interface CustomMissionIndexEntry {
  id: string;
  name: string;
  missionId: string;
  savedAt: number;
  source: 'player' | 'developer';
}

export interface MissionSourceResource {
  type: 'resource';
  missionPath: string;
}

export interface MissionSourceCustom {
  type: 'custom';
  packageId: string;
}

export type MissionSource = MissionSourceResource | MissionSourceCustom;

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && !!localStorage;
  } catch {
    return false;
  }
}

function packageKey(id: string): string {
  return `${CUSTOM_MISSION_KEY_PREFIX}${id}_v1`;
}

function normalizePackageId(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || `custom_${Date.now()}`;
}

function readIndex(): CustomMissionIndexEntry[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(CUSTOM_MISSION_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is CustomMissionIndexEntry =>
      !!entry
      && typeof entry.id === 'string'
      && typeof entry.name === 'string'
      && typeof entry.missionId === 'string'
      && typeof entry.savedAt === 'number'
      && (entry.source === 'player' || entry.source === 'developer'),
    );
  } catch {
    return [];
  }
}

function writeIndex(entries: CustomMissionIndexEntry[]): void {
  if (!hasLocalStorage()) return;
  localStorage.setItem(CUSTOM_MISSION_INDEX_KEY, JSON.stringify(entries));
}

function indexEntryFor(id: string, pkg: CustomMissionPackage): CustomMissionIndexEntry {
  return {
    id,
    name: pkg.mission.name || pkg.mission.id || id,
    missionId: pkg.mission.id,
    savedAt: pkg.savedAt,
    source: pkg.source,
  };
}

function normalizePackage(pkg: CustomMissionPackage): CustomMissionPackage {
  const playerTank = pkg.mission.playerTank ?? pkg.mission.sherman;
  return {
    ...pkg,
    schemaVersion: 2,
    mission: {
      ...pkg.mission,
      ...(playerTank ? { playerTank, sherman: playerTank } : {}),
    },
    savedAt: Date.now(),
    editorVersion: pkg.editorVersion || '1',
    source: pkg.source || 'player',
    turnEndEvents: Array.isArray(pkg.turnEndEvents) ? pkg.turnEndEvents : [],
  };
}

export const CustomMissionStore = {
  list(): CustomMissionIndexEntry[] {
    return readIndex().sort((a, b) => b.savedAt - a.savedAt).slice(0, CUSTOM_MISSION_MAX_SLOTS);
  },

  load(id: string): CustomMissionPackage | null {
    const normalizedId = normalizePackageId(id);
    const transient = transientPackages.get(normalizedId);
    if (transient) return transient;
    if (!hasLocalStorage()) return null;
    try {
      const raw = localStorage.getItem(packageKey(normalizedId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CustomMissionPackage;
      if ((parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2)
        || !parsed.mission || !Array.isArray(parsed.turnEndEvents)) {
        return null;
      }
      const playerTank = parsed.mission.playerTank ?? parsed.mission.sherman;
      return {
        ...parsed,
        schemaVersion: 2,
        mission: {
          ...parsed.mission,
          ...(playerTank ? { playerTank, sherman: playerTank } : {}),
        },
      };
    } catch {
      return null;
    }
  },

  save(id: string, pkg: CustomMissionPackage): string {
    const normalizedId = normalizePackageId(id);
    const normalizedPkg = normalizePackage(pkg);
    if (hasLocalStorage()) {
      const current = readIndex();
      const isNew = !current.some(entry => entry.id === normalizedId);
      if (isNew && current.length >= CUSTOM_MISSION_MAX_SLOTS) {
        throw new Error(`Custom mission limit reached (${CUSTOM_MISSION_MAX_SLOTS})`);
      }
      localStorage.setItem(packageKey(normalizedId), JSON.stringify(normalizedPkg));
      const entries = current.filter(entry => entry.id !== normalizedId);
      entries.push(indexEntryFor(normalizedId, normalizedPkg));
      writeIndex(entries);
    }
    return normalizedId;
  },

  /**
   * 保存运行时生成的临时关卡包，但不写入“我的关卡”索引，也不占用 10 个玩家关卡槽位。
   * 固定 id 可被下一次生成覆盖，BattleScene 仍通过普通 custom source 加载，因此事件表与存档链无需分叉。
   */
  saveTransient(id: string, pkg: CustomMissionPackage): string {
    const normalizedId = normalizePackageId(id);
    const normalizedPkg = normalizePackage(pkg);
    transientPackages.set(normalizedId, normalizedPkg);
    if (hasLocalStorage()) {
      localStorage.setItem(packageKey(normalizedId), JSON.stringify(normalizedPkg));
    }
    return normalizedId;
  },

  remove(id: string): void {
    const normalizedId = normalizePackageId(id);
    transientPackages.delete(normalizedId);
    if (!hasLocalStorage()) return;
    localStorage.removeItem(packageKey(normalizedId));
    writeIndex(readIndex().filter(entry => entry.id !== normalizedId));
  },
};
