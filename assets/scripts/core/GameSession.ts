import { BUILD_FEATURES } from './BuildProfile';
import type { CustomMissionPackage, MissionSource } from './CustomMissionStore';
import { DEFAULT_GAME_MODE, GameMode, normalizeSelectedGameMode } from './GameMode';
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
import { DEFAULT_PLAYER_TANK_KIND, normalizeSelectedPlayerTankKind } from './PlayerTankSelection';
import type { UnitKind } from './types';
import type { CampaignRunSave } from './CampaignRunStore';

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
      enemyThreatPoints: 7,
    }),
    generateRandomMissionPackage('pacific', seeds[1], {
      pacificBattleType: 'inland',
      objectiveKinds: ['direct_evac', 'target_evac'],
      enemyThreatPoints: 10,
    }),
    generateRandomMissionPackage('pacific', seeds[2], {
      pacificBattleType: 'inland',
      objectiveKinds: ['destroy_all'],
      enemyThreatPoints: 13,
    }),
  ];
}

export function createRandomSnowPackages(seed: number = Date.now()): CustomMissionPackage[] {
  const baseSeed = (seed >>> 0) || 1;
  const seeds = [baseSeed, (baseSeed + 0x9e3779b9) >>> 0, (baseSeed + 0x3c6ef372) >>> 0];
  const weather = ['clear', 'light_snow', 'heavy_snow'] as const;
  return seeds.map((missionSeed, index) => generateRandomMissionPackage('europe', missionSeed, {
    season: 'winter',
    enemyThreatPoints: [7, 10, 13][index],
    weather: weather[((missionSeed ^ (index * 0x45d9f3b)) >>> 0) % weather.length],
  }));
}

export function createRandomEuropePackages(seed: number = Date.now()): CustomMissionPackage[] {
  const baseSeed = (seed >>> 0) || 1;
  const seeds = [baseSeed, (baseSeed + 0x9e3779b9) >>> 0, (baseSeed + 0x3c6ef372) >>> 0];
  const weather = ['clear', 'rain'] as const;
  return seeds.map((missionSeed, index) => generateRandomMissionPackage('europe', missionSeed, {
    season: 'summer',
    enemyThreatPoints: [7, 10, 13][index],
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
  /** Main-menu tank choice used for newly loaded single-player missions. */
  selectedPlayerTankKind: UnitKind;
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
  selectedPlayerTankKind: DEFAULT_PLAYER_TANK_KIND,
};

const state: GameSessionState = { ...DEFAULT_STATE };
let campaignResume: CampaignRunSave | null = null;

let missionMenuTab = 'europe';
let menuReturnRequest: { kind: 'mission' | 'campaign'; tab: string } | null = null;

export const GameSession = {
  setMissionMenuTab(tab: string) { missionMenuTab = tab; },
  requestBattleMenuReturn() {
    menuReturnRequest = state.pvpSession?.active ? null : {
      kind: state.selectedCampaignId ? 'campaign' : 'mission', tab: missionMenuTab,
    };
  },
  consumeBattleMenuReturn() {
    const request = menuReturnRequest;
    menuReturnRequest = null;
    return request;
  },
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
  get selectedPlayerTankKind() { return state.selectedPlayerTankKind; },
  get campaignResume() { return state.resumeFromSave && state.selectedCampaignId ? campaignResume : null; },

  setSelectedPlayerTankKind(kind: unknown) {
    state.selectedPlayerTankKind = normalizeSelectedPlayerTankKind(kind);
  },

  setGameMode(mode: GameMode) {
    state.gameMode = state.selectedCampaignId ? 'hardcore' : normalizeSelectedGameMode(mode);
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
    if (!BUILD_FEATURES.testChapter && missionPath === 'missions/mission_test') return;
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
    if (!BUILD_FEATURES.testChapter && missionPath === 'missions/mission_test') return;
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
    campaignResume = null;
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
    state.gameMode = 'hardcore';
    state.selectedCampaign = campaign;
    state.selectedCampaignPackages = generatedPackages;
    state.resumeFromSave = false;
    return true;
  },

  resumeCampaign(run: CampaignRunSave) {
    state.pvpSession = null;
    state.openPvpSelectionOnMenu = false;
    state.selectedCampaignId = run.runtime.campaign.id;
    state.selectedCampaign = run.runtime.campaign;
    state.selectedCampaignPackages = run.packages;
    state.selectedLevelId = run.runtime.campaign.levelId;
    state.selectedMissionPath = '';
    state.selectedMissionSource = { type: 'resource', missionPath: '' };
    state.selectedPlayerTankKind = normalizeSelectedPlayerTankKind(run.save.playerTank?.kind ?? run.save.sherman.kind);
    state.gameMode = 'hardcore';
    state.resumeFromSave = true;
    campaignResume = run;
  },

  clearResumeFlag() {
    state.resumeFromSave = false;
    campaignResume = null;
  },

  reset() {
    menuReturnRequest = null;
    missionMenuTab = 'europe';
    campaignResume = null;
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
    state.selectedPlayerTankKind = DEFAULT_STATE.selectedPlayerTankKind;
  },
};
