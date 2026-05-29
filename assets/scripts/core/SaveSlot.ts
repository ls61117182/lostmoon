import { SAVE_KEY } from './SaveLoad';

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
