/**
 * 关卡元数据 + 主菜单本地进度（解锁、通关、设置）。
 *
 * 本模块只承担 *数据* 与 *localStorage* 读写，不依赖 Cocos，方便单测。
 * UI（MainMenuScene）通过 `LEVELS` 数组生成按钮，通过 `MenuProgress.*` 查/写状态。
 *
 * 存档策略：
 *   - `MENU_STATE_KEY` 存菜单态（解锁/通关/音量/语言）
 *   - 与战斗场景 SAVE_KEY（单局存档）完全独立，互不污染
 *   - localStorage 不可用时 silently 退回"只存内存"，避免抛异常卡 UI
 */

import { LangCode } from './Lang';

export interface LevelMeta {
  /** 关卡编号 1..12；也是解锁顺序 */
  id: number;
  /** 任务 JSON 在 resources/ 下的相对路径（无扩展名） */
  missionPath: string;
  /** 关卡在 lang.csv 里的标题 key，如 'level.01.title' */
  titleKey: string;
  /** MissionData.id 字段值；用于把战斗存档和关卡对应起来 */
  missionId: string;
}

/**
 * 12 关卡配置。当前已实装到 mission_12（`assets/resources/missions/mission_12.json`）。
 */
export const LEVELS: LevelMeta[] = [
  { id: 1,  missionPath: 'missions/mission_01', titleKey: 'level.01.title', missionId: 'mission_01' },
  { id: 2,  missionPath: 'missions/mission_02', titleKey: 'level.02.title', missionId: 'mission_02' },
  { id: 3,  missionPath: 'missions/mission_03', titleKey: 'level.03.title', missionId: 'mission_03' },
  { id: 4,  missionPath: 'missions/mission_04', titleKey: 'level.04.title', missionId: 'mission_04' },
  { id: 5,  missionPath: 'missions/mission_05', titleKey: 'level.05.title', missionId: 'mission_05' },
  { id: 6,  missionPath: 'missions/mission_06', titleKey: 'level.06.title', missionId: 'mission_06' },
  { id: 7,  missionPath: 'missions/mission_07', titleKey: 'level.07.title', missionId: 'mission_07' },
  { id: 8,  missionPath: 'missions/mission_08', titleKey: 'level.08.title', missionId: 'mission_08' },
  { id: 9,  missionPath: 'missions/mission_09', titleKey: 'level.09.title', missionId: 'mission_09' },
  { id: 10, missionPath: 'missions/mission_10', titleKey: 'level.10.title', missionId: 'mission_10' },
  { id: 11, missionPath: 'missions/mission_11', titleKey: 'level.11.title', missionId: 'mission_11' },
  { id: 12, missionPath: 'missions/mission_12', titleKey: 'level.12.title', missionId: 'mission_12' },
];

export function findLevelByMissionId(missionId: string): LevelMeta | undefined {
  return LEVELS.find(l => l.missionId === missionId);
}

// ---------- 菜单本地进度 ----------

const MENU_STATE_KEY = 'lone_sherman_menu_v1';

/**
 * 至少解锁到此关：测试期间设为 `LEVELS.length`（当前 = 12），主菜单全部关卡开放，
 * 方便绕过通关链直接进入任意已实装关卡（mission_01..12）。
 * 正式发布前若要恢复「按通关顺序解锁」可把
 * 它改回 1（仅首关默认开放），既有玩家存档里 unlockedLevel 较大的值会照常保留。
 */
const MIN_UNLOCKED_LEVEL = LEVELS.length;

export interface MenuState {
  /** 已解锁到第几关（1..12）。新档至少为 MIN_UNLOCKED_LEVEL。通关 n 后解锁 n+1 */
  unlockedLevel: number;
  /** 通关过的关卡编号列表（用于 ★） */
  completedLevels: number[];
  /** 音量 0..100，默认 60 */
  volume: number;
  /** 语言，默认 zh */
  lang: LangCode;
}

const DEFAULT_STATE: MenuState = {
  unlockedLevel: MIN_UNLOCKED_LEVEL,
  completedLevels: [],
  volume: 60,
  lang: 'zh',
};

function hasLS(): boolean {
  // Cocos 预览 / 构建后都挂 window.localStorage；保险起见 try/catch
  try {
    return typeof localStorage !== 'undefined' && !!localStorage;
  } catch {
    return false;
  }
}

function readState(): MenuState {
  if (!hasLS()) return { ...DEFAULT_STATE };
  try {
    const raw = localStorage.getItem(MENU_STATE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<MenuState>;
    return {
      unlockedLevel: Math.max(
        MIN_UNLOCKED_LEVEL,
        clamp(parsed.unlockedLevel ?? DEFAULT_STATE.unlockedLevel, 1, LEVELS.length),
      ),
      completedLevels: Array.isArray(parsed.completedLevels) ? parsed.completedLevels.filter(n => typeof n === 'number') : [],
      volume: clamp(parsed.volume ?? DEFAULT_STATE.volume, 0, 100),
      lang: (parsed.lang === 'en' || parsed.lang === 'zh') ? parsed.lang : DEFAULT_STATE.lang,
    };
  } catch (e) {
    console.warn('[LevelDB] 解析菜单存档失败，重置', e);
    return { ...DEFAULT_STATE };
  }
}

function writeState(s: MenuState): void {
  if (!hasLS()) return;
  try {
    localStorage.setItem(MENU_STATE_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn('[LevelDB] 写入菜单存档失败', e);
  }
}

function clamp(n: number, min: number, max: number): number {
  if (typeof n !== 'number' || !isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export const MenuProgress = {
  /** 读取（每次都从 localStorage 取，避免多处缓存不同步） */
  load(): MenuState {
    return readState();
  },

  isUnlocked(levelId: number): boolean {
    return levelId <= this.load().unlockedLevel;
  },

  isCompleted(levelId: number): boolean {
    return this.load().completedLevels.indexOf(levelId) >= 0;
  },

  /** 通关回调：战斗胜利后调用 */
  markCompleted(levelId: number): void {
    const s = readState();
    if (s.completedLevels.indexOf(levelId) < 0) s.completedLevels.push(levelId);
    if (levelId >= s.unlockedLevel && levelId < LEVELS.length) {
      s.unlockedLevel = levelId + 1;
    }
    writeState(s);
  },

  setVolume(v: number): void {
    const s = readState();
    s.volume = clamp(v, 0, 100);
    writeState(s);
  },

  setLang(lang: LangCode): void {
    const s = readState();
    s.lang = lang;
    writeState(s);
  },

  /** 调试/测试重置：清空进度 */
  reset(): void {
    writeState({ ...DEFAULT_STATE });
  },
};
