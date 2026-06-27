import type { UnitKind } from './types';

export type PvpFactionId = 'usa' | 'germany' | 'japan' | 'ussr';
export type PvpMatchMode = 'matchmaking' | 'room';
export type PvpParity = 'odd' | 'even';

export interface PvpFactionConfig {
  id: PvpFactionId;
  name: string;
  shortName: string;
  protagonistUnit: UnitKind | 'future';
  protagonistName: string;
  supportSummary: string;
  styleTags: string[];
  available: boolean;
}

export interface PvpPlayerConfig {
  name: string;
  factionId: PvpFactionId;
  parity: PvpParity;
  isLocal: boolean;
}

export interface PvpSessionConfig {
  active: boolean;
  matchId?: string;
  matchMode: PvpMatchMode;
  roomCode?: string;
  localPlayer: PvpPlayerConfig;
  opponentPlayer: PvpPlayerConfig;
  openingDie: number;
  firstParity: PvpParity;
  firstPlayerName: string;
  missionPath: string;
}

export const PVP_DEFAULT_MISSION_PATH = 'missions/mission_01';

export const PVP_FACTIONS: PvpFactionConfig[] = [
  {
    id: 'usa',
    name: '美军',
    shortName: '美军',
    protagonistUnit: 'sherman',
    protagonistName: 'M4 Sherman 75',
    supportSummary: '步兵 x2 / 坦克歼击车 x1',
    styleTags: ['均衡', '稳定', '中距离'],
    available: true,
  },
  {
    id: 'germany',
    name: '德军',
    shortName: '德军',
    protagonistUnit: 'panzer4',
    protagonistName: 'Panzer IV',
    supportSummary: '反坦克炮 x1 / 步兵 x2',
    styleTags: ['火力', '装甲', '少量精锐'],
    available: true,
  },
  {
    id: 'japan',
    name: '日军',
    shortName: '日军',
    protagonistUnit: 'type97',
    protagonistName: 'Shinhoto Chi-Ha',
    supportSummary: '步兵 x3 / 固定火力点 x1',
    styleTags: ['伏击', '地形', '步兵协同'],
    available: true,
  },
  {
    id: 'ussr',
    name: '苏军',
    shortName: '苏军',
    protagonistUnit: 'future',
    protagonistName: '未来加入',
    supportSummary: '未来加入',
    styleTags: ['未来加入'],
    available: false,
  },
];

export function pvpFactionOf(id: PvpFactionId): PvpFactionConfig {
  return PVP_FACTIONS.find(f => f.id === id) ?? PVP_FACTIONS[0];
}

export function pvpParityLabel(parity: PvpParity): string {
  return parity === 'odd' ? '单数玩家' : '双数玩家';
}

export function pvpOpponentFactionFor(local: PvpFactionId): PvpFactionId {
  if (local === 'usa') return 'germany';
  if (local === 'germany') return 'usa';
  return 'usa';
}
