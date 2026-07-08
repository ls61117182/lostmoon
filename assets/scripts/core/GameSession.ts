import type { MissionSource } from './CustomMissionStore';
import { DEFAULT_GAME_MODE, GameMode } from './GameMode';
import type { PvpSessionConfig } from './PvpConfig';

export interface GameSessionState {
  /** Resource path under assets/resources, without extension. */
  selectedMissionPath: string;
  /** Current mission source: bundled resource mission or local custom package. */
  selectedMissionSource: MissionSource;
  /** Official level id. Custom or direct scene launches use -1. */
  selectedLevelId: number;
  /** BattleScene should apply the active save after the mission data loads. */
  resumeFromSave: boolean;
  /** Rule profile selected on the main menu for this battle. */
  gameMode: GameMode;
  /** Local frontend PVP session state; server-backed data can replace this later. */
  pvpSession: PvpSessionConfig | null;
  selectedCampaignId: string | null;
}

const DEFAULT_MISSION_PATH = 'missions/mission_01';

const DEFAULT_STATE: GameSessionState = {
  selectedMissionPath: DEFAULT_MISSION_PATH,
  selectedMissionSource: { type: 'resource', missionPath: DEFAULT_MISSION_PATH },
  selectedLevelId: -1,
  resumeFromSave: false,
  gameMode: DEFAULT_GAME_MODE,
  pvpSession: null,
  selectedCampaignId: null,
};

const state: GameSessionState = { ...DEFAULT_STATE };

export const GameSession = {
  get selectedMissionPath() { return state.selectedMissionPath; },
  get selectedMissionSource() { return state.selectedMissionSource; },
  get selectedLevelId() { return state.selectedLevelId; },
  get resumeFromSave() { return state.resumeFromSave; },
  get gameMode() { return state.gameMode; },
  get pvpSession() { return state.pvpSession; },
  get isPvp() { return !!state.pvpSession?.active; },
  get selectedCampaignId() { return state.selectedCampaignId; },
  get isCampaign() { return !!state.selectedCampaignId; },

  setGameMode(mode: GameMode) {
    state.gameMode = mode;
  },

  startPvpBattle(session: PvpSessionConfig) {
    state.pvpSession = { ...session, active: true };
    state.selectedCampaignId = null;
    state.gameMode = 'hardcore';
    state.selectedLevelId = -1;
    state.selectedMissionPath = session.missionPath;
    state.selectedMissionSource = { type: 'resource', missionPath: session.missionPath };
    state.resumeFromSave = false;
  },

  clearPvpBattle() {
    state.pvpSession = null;
  },

  selectMission(levelId: number, missionPath: string) {
    state.pvpSession = null;
    state.selectedCampaignId = null;
    state.selectedLevelId = levelId;
    state.selectedMissionPath = missionPath;
    state.selectedMissionSource = { type: 'resource', missionPath };
    state.resumeFromSave = false;
  },

  selectCustomMission(packageId: string) {
    state.pvpSession = null;
    state.selectedCampaignId = null;
    state.selectedLevelId = -1;
    state.selectedMissionPath = '';
    state.selectedMissionSource = { type: 'custom', packageId };
    state.resumeFromSave = false;
  },

  resumeMission(levelId: number, missionPath: string) {
    state.pvpSession = null;
    state.selectedCampaignId = null;
    state.selectedLevelId = levelId;
    state.selectedMissionPath = missionPath;
    state.selectedMissionSource = { type: 'resource', missionPath };
    state.resumeFromSave = true;
  },

  resumeCustomMission(packageId: string) {
    state.pvpSession = null;
    state.selectedCampaignId = null;
    state.selectedLevelId = -1;
    state.selectedMissionPath = '';
    state.selectedMissionSource = { type: 'custom', packageId };
    state.resumeFromSave = true;
  },

  selectCampaign(levelId: number, campaignId: string) {
    state.pvpSession = null;
    state.selectedLevelId = levelId;
    state.selectedMissionPath = '';
    state.selectedMissionSource = { type: 'resource', missionPath: '' };
    state.selectedCampaignId = campaignId;
    state.resumeFromSave = false;
  },

  clearResumeFlag() {
    state.resumeFromSave = false;
  },

  reset() {
    state.selectedMissionPath = DEFAULT_STATE.selectedMissionPath;
    state.selectedMissionSource = { ...DEFAULT_STATE.selectedMissionSource };
    state.selectedLevelId = DEFAULT_STATE.selectedLevelId;
    state.resumeFromSave = DEFAULT_STATE.resumeFromSave;
    state.gameMode = DEFAULT_STATE.gameMode;
    state.pvpSession = DEFAULT_STATE.pvpSession;
    state.selectedCampaignId = DEFAULT_STATE.selectedCampaignId;
  },
};
