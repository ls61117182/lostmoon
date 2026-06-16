import type { MissionData } from './types';
import type { TurnEndEventRow } from './TurnEndEventDB';

export const CUSTOM_MISSION_INDEX_KEY = 'lone_sherman_custom_mission_index_v1';
export const CUSTOM_MISSION_KEY_PREFIX = 'lone_sherman_custom_mission_';

export interface CustomMissionPackage {
  schemaVersion: 1;
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

export const CustomMissionStore = {
  list(): CustomMissionIndexEntry[] {
    return readIndex().sort((a, b) => b.savedAt - a.savedAt);
  },

  load(id: string): CustomMissionPackage | null {
    if (!hasLocalStorage()) return null;
    try {
      const raw = localStorage.getItem(packageKey(normalizePackageId(id)));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CustomMissionPackage;
      if (parsed.schemaVersion !== 1 || !parsed.mission || !Array.isArray(parsed.turnEndEvents)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  },

  save(id: string, pkg: CustomMissionPackage): string {
    const normalizedId = normalizePackageId(id);
    const now = Date.now();
    const normalizedPkg: CustomMissionPackage = {
      ...pkg,
      schemaVersion: 1,
      savedAt: now,
      editorVersion: pkg.editorVersion || '1',
      source: pkg.source || 'player',
      turnEndEvents: Array.isArray(pkg.turnEndEvents) ? pkg.turnEndEvents : [],
    };
    if (hasLocalStorage()) {
      localStorage.setItem(packageKey(normalizedId), JSON.stringify(normalizedPkg));
      const entries = readIndex().filter(entry => entry.id !== normalizedId);
      entries.push(indexEntryFor(normalizedId, normalizedPkg));
      writeIndex(entries);
    }
    return normalizedId;
  },

  remove(id: string): void {
    if (!hasLocalStorage()) return;
    const normalizedId = normalizePackageId(id);
    localStorage.removeItem(packageKey(normalizedId));
    writeIndex(readIndex().filter(entry => entry.id !== normalizedId));
  },
};
