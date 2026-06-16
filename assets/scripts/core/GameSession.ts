import type { MissionSource } from './CustomMissionStore';

export interface GameSessionState {
  /** Resource path under assets/resources, without extension. */
  selectedMissionPath: string;
  /** Current mission source: bundled resource mission or local custom package. */
  selectedMissionSource: MissionSource;
  /** Official level id. Custom or direct scene launches use -1. */
  selectedLevelId: number;
  /** BattleScene should apply the active save after the mission data loads. */
  resumeFromSave: boolean;
}

const DEFAULT_MISSION_PATH = 'missions/mission_01';

const DEFAULT_STATE: GameSessionState = {
  selectedMissionPath: DEFAULT_MISSION_PATH,
  selectedMissionSource: { type: 'resource', missionPath: DEFAULT_MISSION_PATH },
  selectedLevelId: -1,
  resumeFromSave: false,
};

const state: GameSessionState = { ...DEFAULT_STATE };

export const GameSession = {
  get selectedMissionPath() { return state.selectedMissionPath; },
  get selectedMissionSource() { return state.selectedMissionSource; },
  get selectedLevelId() { return state.selectedLevelId; },
  get resumeFromSave() { return state.resumeFromSave; },

  selectMission(levelId: number, missionPath: string) {
    state.selectedLevelId = levelId;
    state.selectedMissionPath = missionPath;
    state.selectedMissionSource = { type: 'resource', missionPath };
    state.resumeFromSave = false;
  },

  selectCustomMission(packageId: string) {
    state.selectedLevelId = -1;
    state.selectedMissionPath = '';
    state.selectedMissionSource = { type: 'custom', packageId };
    state.resumeFromSave = false;
  },

  resumeMission(levelId: number, missionPath: string) {
    state.selectedLevelId = levelId;
    state.selectedMissionPath = missionPath;
    state.selectedMissionSource = { type: 'resource', missionPath };
    state.resumeFromSave = true;
  },

  resumeCustomMission(packageId: string) {
    state.selectedLevelId = -1;
    state.selectedMissionPath = '';
    state.selectedMissionSource = { type: 'custom', packageId };
    state.resumeFromSave = true;
  },

  clearResumeFlag() {
    state.resumeFromSave = false;
  },

  reset() {
    state.selectedMissionPath = DEFAULT_STATE.selectedMissionPath;
    state.selectedMissionSource = { ...DEFAULT_STATE.selectedMissionSource };
    state.selectedLevelId = DEFAULT_STATE.selectedLevelId;
    state.resumeFromSave = DEFAULT_STATE.resumeFromSave;
  },
};
