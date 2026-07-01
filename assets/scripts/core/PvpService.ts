import { getApiBase, getServerToken, getServerUsername } from './AuthService';
import {
  PvpFactionId,
  PvpMatchMode,
  PvpParity,
  PvpSessionConfig,
} from './PvpConfig';
import type { Direction, FireDirection, ShermanCrew, UnitKind } from './types';

export interface PvpBattleUnitSnapshot {
  id: string;
  ownerParity: PvpParity;
  ownerFactionId: PvpFactionId;
  role: 'protagonist' | 'support';
  kind: UnitKind;
  pos: { q: number; r: number };
  facing: Direction | null;
  turretFacing?: FireDirection | null;
  destroyed?: boolean;
  damaged?: boolean;
  loaded?: boolean;
  hatchOpen?: boolean;
  fireLevel?: number;
  turretDamaged?: boolean;
  paralyzed?: boolean;
  hidden?: boolean;
  smoked?: boolean;
  radioDamaged?: boolean;
  visionRange?: number;
  crew?: ShermanCrew;
}

export interface PvpBattleSnapshot {
  version: number;
  turn: number;
  currentParity: PvpParity;
  actionPhase?: 'player' | 'ai';
  firstParity: PvpParity;
  openingDie: number;
  units: PvpBattleUnitSnapshot[];
  smokeHexes?: string[];
  smokeHexOwners?: Record<string, PvpParity>;
  winnerParity?: PvpParity | null;
  updatedAt?: number;
}

export type PvpServerEvent =
  | { type: 'connected'; clientId: string; username: string }
  | { type: 'waiting'; parity: PvpParity }
  | { type: 'roomCreated'; roomCode: string }
  | { type: 'roomUpdate'; roomCode: string; owner: PvpServerPlayer | null; guest: PvpServerPlayer | null; you: 'owner' | 'guest'; canStart: boolean }
  | { type: 'matchStarted'; session: PvpSessionConfig; matchId: string }
  | { type: 'battleStart'; matchId: string; firstParity: PvpParity; currentParity: PvpParity }
  | { type: 'battleSnapshot'; matchId: string; state: PvpBattleSnapshot; reason: string }
  | { type: 'battleEvent'; matchId: string; event: unknown; from?: unknown; seq?: unknown }
  | { type: 'closed'; reason: string }
  | { type: 'error'; code: string; message: string };

type PvpListener = (event: PvpServerEvent) => void;

export interface PvpServerPlayer {
  clientId: string;
  name: string;
  factionId: PvpFactionId;
  parity: PvpParity;
  ready?: boolean;
}

interface PvpMatchStartedMessage {
  type: 'pvp_match_started';
  match: {
    matchId: string;
    matchMode: PvpMatchMode;
    roomCode?: string;
    localPlayer: PvpServerPlayer;
    opponentPlayer: PvpServerPlayer;
    openingDie: number;
    firstParity: PvpParity;
    firstPlayerName: string;
    missionPath: string;
  };
}

function wsBaseFromApiBase(apiBase: string): string {
  if (apiBase.startsWith('https://')) return `wss://${apiBase.slice('https://'.length)}`;
  if (apiBase.startsWith('http://')) return `ws://${apiBase.slice('http://'.length)}`;
  return apiBase;
}

class PvpServiceImpl {
  private ws: WebSocket | null = null;
  private listeners = new Set<PvpListener>();
  private clientId = '';
  private matchId = '';
  private seq = 1;

  get currentMatchId(): string {
    return this.matchId;
  }

  addListener(listener: PvpListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const base = wsBaseFromApiBase(getApiBase());
      const token = encodeURIComponent(getServerToken());
      const url = `${base}${base.endsWith('/') ? '' : '/'}?token=${token}`;
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      ws.onopen = () => settle();
      ws.onmessage = event => this.handleMessage(event.data);
      ws.onerror = () => {
        this.emit({ type: 'error', code: 'NETWORK_ERROR', message: 'Cannot connect to PVP server' });
        settle();
      };
      ws.onclose = () => {
        this.ws = null;
        this.emit({ type: 'closed', reason: 'socket closed' });
        settle();
      };
    });
  }

  disconnect(): void {
    if (!this.ws) return;
    this.ws.close();
    this.ws = null;
  }

  async joinMatchmaking(factionId: PvpFactionId): Promise<void> {
    await this.connect();
    this.send({ type: 'pvp_matchmaking_join', factionId });
  }

  cancelMatchmaking(): void {
    this.send({ type: 'pvp_matchmaking_cancel' });
  }

  async createRoom(factionId: PvpFactionId): Promise<void> {
    await this.connect();
    this.send({ type: 'pvp_room_create', factionId });
  }

  async joinRoom(roomCode: string, factionId: PvpFactionId): Promise<void> {
    await this.connect();
    this.send({ type: 'pvp_room_join', roomCode, factionId });
  }

  leaveRoom(): void {
    this.send({ type: 'pvp_room_leave' });
  }

  setRoomReady(roomCode: string, ready: boolean): void {
    this.send({ type: 'pvp_room_ready', roomCode, ready });
  }

  startRoom(roomCode: string): void {
    this.send({ type: 'pvp_room_start', roomCode });
  }

  sendBattleEvent(event: unknown): void {
    if (!this.matchId) return;
    this.send({ type: 'pvp_battle_event', matchId: this.matchId, seq: this.seq++, event });
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.emit({ type: 'error', code: 'SOCKET_CLOSED', message: 'PVP server is not connected' });
      return;
    }
    this.ws.send(JSON.stringify(payload));
  }

  private handleMessage(raw: unknown): void {
    let msg: any;
    try {
      msg = JSON.parse(String(raw || '{}'));
    } catch {
      this.emit({ type: 'error', code: 'BAD_MESSAGE', message: 'Bad PVP server message' });
      return;
    }
    switch (msg.type) {
      case 'welcome':
        this.clientId = String(msg.clientId || '');
        this.emit({
          type: 'connected',
          clientId: this.clientId,
          username: String(msg.username || getServerUsername() || this.clientId),
        });
        break;
      case 'pvp_matchmaking_waiting':
        this.emit({ type: 'waiting', parity: msg.parity === 'even' ? 'even' : 'odd' });
        break;
      case 'pvp_room_created':
        this.emit({ type: 'roomCreated', roomCode: String(msg.roomCode || '') });
        break;
      case 'pvp_room_update':
        this.emit({
          type: 'roomUpdate',
          roomCode: String(msg.roomCode || ''),
          owner: msg.owner ?? null,
          guest: msg.guest ?? null,
          you: msg.you === 'guest' ? 'guest' : 'owner',
          canStart: !!msg.canStart,
        });
        break;
      case 'pvp_match_started':
        this.handleMatchStarted(msg as PvpMatchStartedMessage);
        break;
      case 'pvp_battle_start':
        this.emit({
          type: 'battleStart',
          matchId: String(msg.matchId || ''),
          firstParity: msg.firstParity === 'even' ? 'even' : 'odd',
          currentParity: msg.currentParity === 'even' ? 'even' : 'odd',
        });
        break;
      case 'pvp_battle_snapshot':
        this.emit({
          type: 'battleSnapshot',
          matchId: String(msg.matchId || ''),
          state: msg.state as PvpBattleSnapshot,
          reason: String(msg.reason || ''),
        });
        break;
      case 'pvp_battle_event':
        this.emit({
          type: 'battleEvent',
          matchId: String(msg.matchId || ''),
          event: msg.event ?? null,
          from: msg.from,
          seq: msg.seq,
        });
        break;
      case 'pvp_error':
      case 'error':
        this.emit({
          type: 'error',
          code: String(msg.code || 'PVP_ERROR'),
          message: String(msg.message || 'PVP server error'),
        });
        break;
      case 'pvp_match_closed':
      case 'pvp_room_closed':
        this.emit({ type: 'closed', reason: String(msg.reason || msg.type) });
        break;
      default:
        break;
    }
  }

  private handleMatchStarted(msg: PvpMatchStartedMessage): void {
    const match = msg.match;
    this.matchId = match.matchId;
    const firstPlayerName = match.firstParity === match.localPlayer.parity
      ? match.localPlayer.name
      : match.opponentPlayer.name;
    this.emit({
      type: 'matchStarted',
      matchId: match.matchId,
      session: {
        active: true,
        matchId: match.matchId,
        matchMode: match.matchMode,
        roomCode: match.roomCode,
        localPlayer: { ...match.localPlayer, isLocal: true },
        opponentPlayer: { ...match.opponentPlayer, isLocal: false },
        openingDie: match.openingDie,
        firstParity: match.firstParity,
        firstPlayerName,
        missionPath: match.missionPath || 'missions/mission_01',
      },
    });
  }

  private emit(event: PvpServerEvent): void {
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }
}

export const PvpService = new PvpServiceImpl();
