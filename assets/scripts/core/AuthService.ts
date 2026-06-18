import { MenuState } from './LevelDB';

export interface ServerProfile {
  menuState: MenuState | null;
  settings: Record<string, unknown> | null;
  updatedAt?: number;
}

export interface ServerAuthResult {
  ok: boolean;
  code?: string;
  message?: string;
  username?: string;
  token?: string;
  profile?: ServerProfile;
}

const API_BASE_KEY = 'lone_sherman_api_base_v1';
const AUTH_TOKEN_KEY = 'lone_sherman_server_token_v1';
const AUTH_USER_KEY = 'lone_sherman_server_user_v1';
const DEFAULT_API_BASE = 'http://119.91.156.212';

export function getApiBase(): string {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return DEFAULT_API_BASE;
    return localStorage.getItem(API_BASE_KEY) || DEFAULT_API_BASE;
  } catch {
    return DEFAULT_API_BASE;
  }
}

export function getServerToken(): string {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return '';
    return localStorage.getItem(AUTH_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function getServerUsername(): string {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return '';
    return localStorage.getItem(AUTH_USER_KEY) || '';
  } catch {
    return '';
  }
}

export function setServerSession(username: string, token: string): void {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return;
    localStorage.setItem(AUTH_USER_KEY, username);
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch (e) {
    console.warn('[AuthService] save session failed', e);
  }
}

export function clearServerSession(): void {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return;
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch (e) {
    console.warn('[AuthService] clear session failed', e);
  }
}

export function loginServer(username: string, password: string): Promise<ServerAuthResult> {
  return requestJson('/api/auth/login', 'POST', { username, password });
}

export function registerServer(username: string, password: string, profile: ServerProfile): Promise<ServerAuthResult> {
  return requestJson('/api/auth/register', 'POST', { username, password, profile });
}

export function loadServerProfile(): Promise<ServerAuthResult> {
  return requestJson('/api/player/profile', 'GET');
}

export function saveServerProfile(profile: ServerProfile): Promise<ServerAuthResult> {
  return requestJson('/api/player/profile', 'PUT', { profile });
}

export function syncServerProfile(menuState: MenuState): void {
  void menuState;
}

function requestJson(path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown): Promise<ServerAuthResult> {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${getApiBase()}${path}`, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    const token = getServerToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 0) {
        resolve({ ok: false, code: 'NETWORK_ERROR', message: 'Cannot connect to server' });
        return;
      }
      let payload: ServerAuthResult;
      try {
        payload = JSON.parse(xhr.responseText || '{}') as ServerAuthResult;
      } catch {
        payload = { ok: false, code: 'BAD_RESPONSE', message: xhr.responseText || 'Bad server response' };
      }
      if (payload.ok && payload.username && payload.token) {
        setServerSession(payload.username, payload.token);
      }
      resolve(payload);
    };
    xhr.onerror = () => resolve({ ok: false, code: 'NETWORK_ERROR', message: 'Cannot connect to server' });
    xhr.ontimeout = () => resolve({ ok: false, code: 'NETWORK_TIMEOUT', message: 'Server timeout' });
    xhr.timeout = 8000;
    xhr.send(body === undefined ? null : JSON.stringify(body));
  });
}
