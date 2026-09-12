import { SAVE_KEY } from './SaveLoad';
import type { SaveData } from './SaveLoad';
import type { MissionSource } from './CustomMissionStore';

const AUTH_SESSION_KEY = 'lone_sherman_auth_session_v1';

interface LocalAuthSession {
  mode?: 'online' | 'offline';
  username?: string;
}

export function getActiveSaveKey(): string {
  const session = readLocalAuthSession();
  if (!session) return `${SAVE_KEY}:guest`;
  if (session.mode === 'online') {
    const user = normalizeSaveIdentity(session.username || 'player');
    return `${SAVE_KEY}:account:${user}`;
  }
  return `${SAVE_KEY}:offline`;
}

export function readActiveSaveRaw(): string | null {
  if (!hasLocalStorage()) return null;
  const key = getActiveSaveKey();
  const raw = localStorage.getItem(key);
  if (raw) return raw;
  return readLegacySaveForCurrentSlot(key);
}

export function writeActiveSaveRaw(raw: string): void {
  if (!hasLocalStorage()) return;
  localStorage.setItem(getActiveSaveKey(), raw);
}

/** Remove only this mission's save, including a matching legacy fallback. */
export function clearCompletedMissionSave(missionId: string, source: MissionSource): void {
  if (!hasLocalStorage()) return;
  const activeKey = getActiveSaveKey();
  const keys = [activeKey];
  if (activeKey === `${SAVE_KEY}:guest` || activeKey === `${SAVE_KEY}:offline`) keys.push(SAVE_KEY);
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    let save: SaveData;
    try { save = JSON.parse(raw); } catch { continue; }
    if (save?.missionId !== missionId) continue;
    const savedSource = save.missionSource;
    if (savedSource && (savedSource.type !== source.type
      || (savedSource.type === 'custom' && source.type === 'custom' && savedSource.packageId !== source.packageId)
      || (savedSource.type === 'resource' && source.type === 'resource' && savedSource.missionPath !== source.missionPath))) continue;
    localStorage.removeItem(key);
  }
}

function readLegacySaveForCurrentSlot(activeKey: string): string | null {
  if (activeKey !== `${SAVE_KEY}:offline` && activeKey !== `${SAVE_KEY}:guest`) return null;
  return localStorage.getItem(SAVE_KEY);
}

function readLocalAuthSession(): LocalAuthSession | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalAuthSession;
    if (parsed.mode !== 'online' && parsed.mode !== 'offline') return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeSaveIdentity(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'player';
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && !!localStorage;
  } catch {
    return false;
  }
}
