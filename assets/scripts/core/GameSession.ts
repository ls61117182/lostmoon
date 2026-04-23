/**
 * 跨场景共享的"本局会话"状态。
 *
 * 为什么不用 Cocos `director` 自带的 userData / globals？
 *   - 这是我们自己的业务状态（关卡选择、是否继续存档），放业务层最直观
 *   - 纯静态 + 无 Cocos 依赖，便于单元测试与未来迁移
 *
 * 典型用法：
 *   1. MainMenuScene 里点击"第 3 关" → `GameSession.selectMission(LEVELS[2])`
 *   2. director.loadScene('changjing2') 切到战斗场景
 *   3. BattleScene.onLoad 启动时读 `GameSession.selectedMissionPath` 覆盖默认 missionPath
 *
 * 约定：resumeFromSave=true 时 BattleScene 在任务加载完成后立刻读档恢复状态；
 *       否则走新局流程。GameSession 本身不负责 localStorage，由调用方决定。
 */

export interface GameSessionState {
  /** 要加载的任务 JSON 在 resources/ 下的相对路径（无扩展名），例如 'missions/mission_01' */
  selectedMissionPath: string;
  /** 关卡编号 1..12；用于解锁/进度与 UI 显示。-1 表示未经主菜单直接进入（保持 BattleScene 默认行为） */
  selectedLevelId: number;
  /** 进入战斗场景后是否自动读档恢复进度 */
  resumeFromSave: boolean;
}

const DEFAULT_STATE: GameSessionState = {
  selectedMissionPath: 'missions/mission_01',
  selectedLevelId: -1,
  resumeFromSave: false,
};

const state: GameSessionState = { ...DEFAULT_STATE };

export const GameSession = {
  get selectedMissionPath() { return state.selectedMissionPath; },
  get selectedLevelId()     { return state.selectedLevelId; },
  get resumeFromSave()      { return state.resumeFromSave; },

  /** 主菜单选关入口：清掉 resumeFromSave，按新局进入 */
  selectMission(levelId: number, missionPath: string) {
    state.selectedLevelId = levelId;
    state.selectedMissionPath = missionPath;
    state.resumeFromSave = false;
  },

  /** 主菜单"继续游戏"入口：读档流程需要战斗场景自己恢复状态 */
  resumeMission(levelId: number, missionPath: string) {
    state.selectedLevelId = levelId;
    state.selectedMissionPath = missionPath;
    state.resumeFromSave = true;
  },

  /** 战斗场景消费完 resumeFromSave 后调用，避免下次再进战斗时又被读档覆盖 */
  clearResumeFlag() {
    state.resumeFromSave = false;
  },

  /** 调试或测试时重置到默认态 */
  reset() {
    state.selectedMissionPath = DEFAULT_STATE.selectedMissionPath;
    state.selectedLevelId = DEFAULT_STATE.selectedLevelId;
    state.resumeFromSave = DEFAULT_STATE.resumeFromSave;
  },
};
