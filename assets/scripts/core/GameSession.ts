import type { CustomMissionPackage, MissionSource } from './CustomMissionStore';
import { DEFAULT_GAME_MODE, GameMode } from './GameMode';
import type { PvpSessionConfig } from './PvpConfig';
import {
  createRandomEuropeCampaign,
  createRandomIslandCampaign,
  createRandomSnowCampaign,
  getCampaign,
  RANDOM_EUROPE_CAMPAIGN_ID,
  RANDOM_ISLAND_CAMPAIGN_ID,
  RANDOM_SNOW_CAMPAIGN_ID,
} from './CampaignDB';
import type { CampaignDefinition } from './CampaignDB';
import { generateRandomMissionPackage } from './RandomMissionGenerator';

export function createRandomIslandPackages(seed: number = Date.now()): CustomMissionPackage[] {
  const baseSeed = (seed >>> 0) || 1;
  const seeds = [
    baseSeed,
    (baseSeed + 0x9e3779b9) >>> 0,
    (baseSeed + 0x3c6ef372) >>> 0,
  ];
  return [
    generateRandomMissionPackage('pacific', seeds[0], {
      pacificBattleType: 'landing',
      objectiveKinds: ['direct_evac', 'target_evac'],
      enemyThreatPoints: 10,
    }),
    generateRandomMissionPackage('pacific', seeds[1], {
      pacificBattleType: 'inland',
      objectiveKinds: ['direct_evac', 'target_evac'],
      enemyThreatPoints: 13,
    }),
    generateRandomMissionPackage('pacific', seeds[2], {
      pacificBattleType: 'inland',
      objectiveKinds: ['destroy_all'],
      enemyThreatPoints: 16,
    }),
  ];
}

export function createRandomSnowPackages(seed: number = Date.now()): CustomMissionPackage[] {
  const baseSeed = (seed >>> 0) || 1;
  const seeds = [baseSeed, (baseSeed + 0x9e3779b9) >>> 0, (baseSeed + 0x3c6ef372) >>> 0];
  const weather = ['clear', 'light_snow', 'heavy_snow'] as const;
  return seeds.map((missionSeed, index) => generateRandomMissionPackage('europe', missionSeed, {
    season: 'winter',
    weather: weather[((missionSeed ^ (index * 0x45d9f3b)) >>> 0) % weather.length],
  }));
}

export function createRandomEuropePackages(seed: number = Date.now()): CustomMissionPackage[] {
  const baseSeed = (seed >>> 0) || 1;
  const seeds = [baseSeed, (baseSeed + 0x9e3779b9) >>> 0, (baseSeed + 0x3c6ef372) >>> 0];
  const weather = ['clear', 'rain'] as const;
  return seeds.map((missionSeed, index) => generateRandomMissionPackage('europe', missionSeed, {
    season: 'summer',
    weather: weather[((missionSeed ^ (index * 0x45d9f3b)) >>> 0) % weather.length],
  }));
}

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
  /** Open the PVP selection dialog once after the main menu scene loads. */
  openPvpSelectionOnMenu: boolean;
  selectedCampaignId: string | null;
  /** Resolved campaign run; random campaign stages stay fixed for this session. */
  selectedCampaign: CampaignDefinition | null;
  /** In-memory generated missions and event tables for Random Island. */
  selectedCampaignPackages: CustomMissionPackage[] | null;
}

const DEFAULT_MISSION_PATH = 'missions/mission_01';

const DEFAULT_STATE: GameSessionState = {
  selectedMissionPath: DEFAULT_MISSION_PATH,
  selectedMissionSource: { type: 'resource', missionPath: DEFAULT_MISSION_PATH },
  selectedLevelId: -1,
  resumeFromSave: false,
  gameMode: DEFAULT_GAME_MODE,
  pvpSession: null,
  openPvpSelectionOnMenu: false,
  selectedCampaignId: null,
  selectedCampaign: null,
  selectedCampaignPackages: null,
};

const state: GameSessionState = { ...DEFAULT_STATE };

export const GameSession = {
  get selectedMissionPath() { return state.selectedMissionPath; },
  get selectedMissionSource() { return state.selectedMissionSource; },
  get selectedLevelId() { return state.selectedLevelId; },
  get resumeFromSave() { return state.resumeFromSave; },
  get gameMode() { return state.gameMode; },
  get pvpSession() { return state.pvpSession; },
  get openPvpSelectionOnMenu() { return state.openPvpSelectionOnMenu; },
  get isPvp() { return !!state.pvpSession?.active; },
  get selectedCampaignId() { return state.selectedCampaignId; },
  get selectedCampaign() { return state.selectedCampaign; },
  get selectedCampaignPackages() { return state.selectedCampaignPackages; },
  get isCampaign() { return !!state.selectedCampaignId; },

  setGameMode(mode: GameMode) {
    state.gameMode = mode;
  },

  startPvpBattle(session: PvpSessionConfig) {
    state.pvpSession = { ...session, active: true };
    state.selectedCampaignId = null;
    state.selectedCampaign = null;
    state.selectedCampaignPackages = null;
    state.gameMode = 'hardcore';
    state.selectedLevelId = -1;
    state.selectedMissionPath = session.missionPath;
    state.selectedMissionSource = { type: 'resource', missionPath: session.missionPath };
    state.resumeFromSave = false;
  },

  clearPvpBattle() {
    state.pvpSession = null;
  },

  returnToPvpSelection() {
    state.pvpSession = null;
    state.openPvpSelectionOnMenu = true;
  },

  consumePvpSelectionRequest() {
    const shouldOpen = state.openPvpSelectionOnMenu;
    state.openPvpSelectionOnMenu = false;
    return shouldOpen;
  },

  selectMission(levelId: number, missionPath: string) {
    state.pvpSession = null;
    state.openPvpSelectionOnMenu = false;
    state.selectedCampaignId = null;
    state.selectedCampaign = null;
    state.selectedCampaignPackages = null;
    state.selectedLevelId = levelId;
    state.selectedMissionPath = missionPath;
    state.selectedMissionSource = { type: 'resource', missionPath };
    state.resumeFromSave = false;
  },

  selectCustomMission(packageId: string) {
    state.pvpSession = null;
    state.openPvpSelectionOnMenu = false;
    state.selectedCampaignId = null;
    state.selectedCampaign = null;
    state.selectedCampaignPackages = null;
    state.selectedLevelId = -1;
    state.selectedMissionPath = '';
    state.selectedMissionSource = { type: 'custom', packageId };
    state.resumeFromSave = false;
  },

  resumeMission(levelId: number, missionPath: string) {
    state.pvpSession = null;
    state.openPvpSelectionOnMenu = false;
    state.selectedCampaignId = null;
    state.selectedCampaign = null;
    state.selectedCampaignPackages = null;
    state.selectedLevelId = levelId;
    state.selectedMissionPath = missionPath;
    state.selectedMissionSource = { type: 'resource', missionPath };
    state.resumeFromSave = true;
  },

  resumeCustomMission(packageId: string) {
    state.pvpSession = null;
    state.openPvpSelectionOnMenu = false;
    state.selectedCampaignId = null;
    state.selectedCampaign = null;
    state.selectedCampaignPackages = null;
    state.selectedLevelId = -1;
    state.selectedMissionPath = '';
    state.selectedMissionSource = { type: 'custom', packageId };
    state.resumeFromSave = true;
  },

  selectCampaign(levelId: number, campaignId: string) {
    const generatedPackages = campaignId === RANDOM_ISLAND_CAMPAIGN_ID
      ? createRandomIslandPackages()
      : campaignId === RANDOM_SNOW_CAMPAIGN_ID
        ? createRandomSnowPackages()
        : campaignId === RANDOM_EUROPE_CAMPAIGN_ID
          ? createRandomEuropePackages()
        : null;
    const campaign = generatedPackages
      ? campaignId === RANDOM_SNOW_CAMPAIGN_ID
        ? createRandomSnowCampaign(generatedPackages.map(pkg => pkg.mission.id))
        : campaignId === RANDOM_EUROPE_CAMPAIGN_ID
          ? createRandomEuropeCampaign(generatedPackages.map(pkg => pkg.mission.id))
          : createRandomIslandCampaign(generatedPackages.map(pkg => pkg.mission.id))
      : getCampaign(campaignId);
    if (!campaign) return false;
    state.pvpSession = null;
    state.openPvpSelectionOnMenu = false;
    state.selectedLevelId = levelId;
    state.selectedMissionPath = '';
    state.selectedMissionSource = { type: 'resource', missionPath: '' };
    state.selectedCampaignId = campaignId;
    state.selectedCampaign = campaign;
    state.selectedCampaignPackages = generatedPackages;
    state.resumeFromSave = false;
    return true;
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
    state.openPvpSelectionOnMenu = DEFAULT_STATE.openPvpSelectionOnMenu;
    state.selectedCampaignId = DEFAULT_STATE.selectedCampaignId;
    state.selectedCampaign = DEFAULT_STATE.selectedCampaign;
    state.selectedCampaignPackages = DEFAULT_STATE.selectedCampaignPackages;
  },
};
