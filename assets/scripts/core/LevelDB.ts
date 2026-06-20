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
import { CustomMissionStore, CUSTOM_MISSION_MAX_SLOTS } from './CustomMissionStore';
import { DEFAULT_GAME_MODE, GameMode, isGameMode } from './GameMode';

export type ChapterId = string;

export interface LevelMeta {
  /** Chapter this level belongs to. */
  chapterId: ChapterId;
  /** 关卡编号 1..12；也是解锁顺序 */
  id: number;
  /** 任务 JSON 在 resources/ 下的相对路径（无扩展名） */
  missionPath: string;
  /** 关卡在 lang.csv 里的标题 key，如 'level.01.title' */
  titleKey: string;
  /** MissionData.id 字段值；用于把战斗存档和关卡对应起来 */
  missionId: string;
  entryKind?: 'mission' | 'editor' | 'custom';
  customPackageId?: string;
  titleOverride?: string;
  badgeOverride?: string;
}

export interface ChapterMeta {
  /** Stable chapter id for progress and future chapter routing. */
  id: ChapterId;
  /** Display order in the main menu. */
  order: number;
  /** Chapter name key in lang.csv. */
  titleKey: string;
  /** Short status/description key in lang.csv. */
  subtitleKey: string;
  /** Levels currently implemented for this chapter. */
  levels: LevelMeta[];
}

export const DEFAULT_CHAPTER_ID = 'europe';
export const CUSTOM_CHAPTER_ID = 'custom';
export const LEVEL_EDITOR_ENTRY_ID = 0;

/**
 * 12 关卡配置。当前已实装到 mission_12（`assets/resources/missions/mission_12.json`）。
 */
export const CHAPTERS: ChapterMeta[] = [
  {
    id: DEFAULT_CHAPTER_ID,
    order: 1,
    titleKey: 'chapter.europe.title',
    subtitleKey: 'chapter.europe.subtitle',
    levels: [
      { chapterId: DEFAULT_CHAPTER_ID, id: 1,  missionPath: 'missions/mission_01', titleKey: 'level.01.title', missionId: 'mission_01' },
      { chapterId: DEFAULT_CHAPTER_ID, id: 2,  missionPath: 'missions/mission_02', titleKey: 'level.02.title', missionId: 'mission_02' },
      { chapterId: DEFAULT_CHAPTER_ID, id: 3,  missionPath: 'missions/mission_03', titleKey: 'level.03.title', missionId: 'mission_03' },
      { chapterId: DEFAULT_CHAPTER_ID, id: 4,  missionPath: 'missions/mission_04', titleKey: 'level.04.title', missionId: 'mission_04' },
      { chapterId: DEFAULT_CHAPTER_ID, id: 5,  missionPath: 'missions/mission_05', titleKey: 'level.05.title', missionId: 'mission_05' },
      { chapterId: DEFAULT_CHAPTER_ID, id: 6,  missionPath: 'missions/mission_06', titleKey: 'level.06.title', missionId: 'mission_06' },
      { chapterId: DEFAULT_CHAPTER_ID, id: 7,  missionPath: 'missions/mission_07', titleKey: 'level.07.title', missionId: 'mission_07' },
      { chapterId: DEFAULT_CHAPTER_ID, id: 8,  missionPath: 'missions/mission_08', titleKey: 'level.08.title', missionId: 'mission_08' },
      { chapterId: DEFAULT_CHAPTER_ID, id: 9,  missionPath: 'missions/mission_09', titleKey: 'level.09.title', missionId: 'mission_09' },
      { chapterId: DEFAULT_CHAPTER_ID, id: 10, missionPath: 'missions/mission_10', titleKey: 'level.10.title', missionId: 'mission_10' },
      { chapterId: DEFAULT_CHAPTER_ID, id: 11, missionPath: 'missions/mission_11', titleKey: 'level.11.title', missionId: 'mission_11' },
      { chapterId: DEFAULT_CHAPTER_ID, id: 12, missionPath: 'missions/mission_12', titleKey: 'level.12.title', missionId: 'mission_12' },
    ],
  },
  {
    id: 'pacific',
    order: 2,
    titleKey: 'chapter.pacific.title',
    subtitleKey: 'chapter.pacific.subtitle',
    levels: [
      { chapterId: 'pacific', id: 1,  missionPath: 'missions/mission_pacific_01', titleKey: 'level.pacific.01.title', missionId: 'mission_pacific_01' },
      { chapterId: 'pacific', id: 2,  missionPath: 'missions/mission_pacific_02', titleKey: 'level.pacific.02.title', missionId: 'mission_pacific_02' },
      { chapterId: 'pacific', id: 3,  missionPath: 'missions/mission_pacific_03', titleKey: 'level.pacific.03.title', missionId: 'mission_pacific_03' },
      { chapterId: 'pacific', id: 4,  missionPath: 'missions/mission_pacific_04', titleKey: 'level.pacific.04.title', missionId: 'mission_pacific_04' },
      { chapterId: 'pacific', id: 5,  missionPath: 'missions/mission_pacific_05', titleKey: 'level.pacific.05.title', missionId: 'mission_pacific_05' },
      { chapterId: 'pacific', id: 6,  missionPath: 'missions/mission_pacific_06', titleKey: 'level.pacific.06.title', missionId: 'mission_pacific_06' },
      { chapterId: 'pacific', id: 7,  missionPath: 'missions/mission_pacific_07', titleKey: 'level.pacific.07.title', missionId: 'mission_pacific_07' },
      { chapterId: 'pacific', id: 8,  missionPath: 'missions/mission_pacific_08', titleKey: 'level.pacific.08.title', missionId: 'mission_pacific_08' },
      { chapterId: 'pacific', id: 9,  missionPath: 'missions/mission_pacific_09', titleKey: 'level.pacific.09.title', missionId: 'mission_pacific_09' },
      { chapterId: 'pacific', id: 10, missionPath: 'missions/mission_pacific_10', titleKey: 'level.pacific.10.title', missionId: 'mission_pacific_10' },
      { chapterId: 'pacific', id: 11, missionPath: 'missions/mission_pacific_11', titleKey: 'level.pacific.11.title', missionId: 'mission_pacific_11' },
      { chapterId: 'pacific', id: 12, missionPath: 'missions/mission_pacific_12', titleKey: 'level.pacific.12.title', missionId: 'mission_pacific_12' },
    ],
  },
  {
    id: 'test',
    order: 99,
    titleKey: 'chapter.test.title',
    subtitleKey: 'chapter.test.subtitle',
    levels: [
      { chapterId: 'test', id: 0, missionPath: 'missions/mission_test', titleKey: 'level.test.title', missionId: 'mission_test' },
    ],
  },
  {
    id: CUSTOM_CHAPTER_ID,
    order: 100,
    titleKey: 'chapter.custom.title',
    subtitleKey: 'chapter.custom.subtitle',
    levels: [
      {
        chapterId: CUSTOM_CHAPTER_ID,
        id: LEVEL_EDITOR_ENTRY_ID,
        missionPath: '',
        titleKey: 'level.custom.editor.title',
        missionId: 'level_editor',
        entryKind: 'editor',
        badgeOverride: 'ED',
      },
    ],
  },
];

export const LEVELS: LevelMeta[] = CHAPTERS
  .slice()
  .sort((a, b) => a.order - b.order)
  .flatMap(chapter => chapter.levels);

export function getChapter(id: ChapterId): ChapterMeta | undefined {
  return CHAPTERS.find(c => c.id === id);
}

export function getChapterLevels(id: ChapterId): LevelMeta[] {
  if (id === CUSTOM_CHAPTER_ID) return getCustomChapterLevels();
  return getChapter(id)?.levels ?? [];
}

export function findLevelByMissionId(missionId: string): LevelMeta | undefined {
  return LEVELS.find(l => l.missionId === missionId);
}

export function getCustomChapterLevels(): LevelMeta[] {
  const chapter = getChapter(CUSTOM_CHAPTER_ID);
  const editor = chapter?.levels[0];
  const levels: LevelMeta[] = editor ? [{ ...editor }] : [];
  const customEntries = CustomMissionStore.list().slice(0, CUSTOM_MISSION_MAX_SLOTS);
  for (let i = 0; i < customEntries.length; i++) {
    const entry = customEntries[i]!;
    levels.push({
      chapterId: CUSTOM_CHAPTER_ID,
      id: i + 1,
      missionPath: '',
      titleKey: 'level.custom.mission.title',
      missionId: entry.missionId,
      entryKind: 'custom',
      customPackageId: entry.id,
      titleOverride: entry.name,
    });
  }
  return levels;
}

// ---------- 菜单本地进度 ----------

export const MENU_STATE_KEY = 'lone_sherman_menu_v1';

/**
 * 至少解锁到此关：测试期间设为 `LEVELS.length`（当前 = 12），主菜单全部关卡开放，
 * 方便绕过通关链直接进入任意已实装关卡（mission_01..12）。
 * 正式发布前若要恢复「按通关顺序解锁」可把
 * 它改回 1（仅首关默认开放），既有玩家存档里 unlockedLevel 较大的值会照常保留。
 */
const MIN_UNLOCKED_LEVEL = Math.max(...LEVELS.map(l => l.id));

export interface MenuState {
  /** 已解锁到第几关（1..12）。新档至少为 MIN_UNLOCKED_LEVEL。通关 n 后解锁 n+1 */
  unlockedLevel: number;
  /** 通关过的关卡编号列表（用于 ★） */
  completedLevels: number[];
  chapterProgress: Record<ChapterId, {
    unlockedLevel: number;
    completedLevels: number[];
  }>;
  /** 背景音乐 0..100 */
  bgmVolume: number;
  /** 音效（UI / 战斗）0..100 */
  sfxVolume: number;
  /** 语言，默认 zh */
  lang: LangCode;
  /** Main menu chapter selection. */
  selectedChapterId: ChapterId;
  /** Rule profile selected before starting a mission. */
  gameMode: GameMode;
}

const DEFAULT_STATE: MenuState = {
  unlockedLevel: MIN_UNLOCKED_LEVEL,
  completedLevels: [],
  chapterProgress: emptyChapterProgress(),
  bgmVolume: 60,
  sfxVolume: 70,
  lang: 'zh',
  selectedChapterId: DEFAULT_CHAPTER_ID,
  gameMode: DEFAULT_GAME_MODE,
};

function maxLevelIdForChapter(chapterId: ChapterId): number {
  const ids = getChapterLevels(chapterId).map(l => l.id);
  return ids.length > 0 ? Math.max(...ids) : MIN_UNLOCKED_LEVEL;
}

function clampLevelForChapter(chapterId: ChapterId, levelId: number): number {
  return clamp(levelId, 1, maxLevelIdForChapter(chapterId));
}

function emptyChapterProgress(): Record<ChapterId, { unlockedLevel: number; completedLevels: number[] }> {
  const out: Record<ChapterId, { unlockedLevel: number; completedLevels: number[] }> = {};
  for (const chapter of CHAPTERS) {
    out[chapter.id] = {
      unlockedLevel: maxLevelIdForChapter(chapter.id),
      completedLevels: [],
    };
  }
  return out;
}

function normalizeCompletedForChapter(chapterId: ChapterId, values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  const maxId = maxLevelIdForChapter(chapterId);
  const seen = new Set<number>();
  for (const value of values) {
    if (typeof value !== 'number' || !isFinite(value)) continue;
    const n = Math.trunc(value);
    if (n >= 1 && n <= maxId) seen.add(n);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

function normalizeChapterProgress(parsed: Partial<MenuState>): Record<ChapterId, { unlockedLevel: number; completedLevels: number[] }> {
  const out = emptyChapterProgress();
  const raw = parsed.chapterProgress;
  if (raw && typeof raw === 'object') {
    for (const chapter of CHAPTERS) {
      const entry = raw[chapter.id];
      if (!entry || typeof entry !== 'object') continue;
      out[chapter.id] = {
        unlockedLevel: clampLevelForChapter(chapter.id, entry.unlockedLevel ?? out[chapter.id].unlockedLevel),
        completedLevels: normalizeCompletedForChapter(chapter.id, entry.completedLevels),
      };
    }
  }

  if (!raw && Array.isArray(parsed.completedLevels)) {
    out[DEFAULT_CHAPTER_ID]!.completedLevels = normalizeCompletedForChapter(DEFAULT_CHAPTER_ID, parsed.completedLevels);
    out.pacific!.completedLevels = normalizeCompletedForChapter(
      'pacific',
      parsed.completedLevels
        .filter(n => typeof n === 'number' && n >= 101 && n <= 112)
        .map(n => n - 100),
    );
  }

  return out;
}

function hasLS(): boolean {
  // Cocos 预览 / 构建后都挂 window.localStorage；保险起见 try/catch
  try {
    return typeof localStorage !== 'undefined' && !!localStorage;
  } catch {
    return false;
  }
}

function readState(): MenuState {
  if (!hasLS()) return { ...DEFAULT_STATE, chapterProgress: emptyChapterProgress() };
  try {
    const raw = localStorage.getItem(MENU_STATE_KEY);
    if (!raw) return { ...DEFAULT_STATE, chapterProgress: emptyChapterProgress() };
    const parsed = JSON.parse(raw) as Partial<MenuState> & { volume?: number };
    const legacyVol = typeof parsed.volume === 'number'
      ? clamp(parsed.volume, 0, 100)
      : undefined;
    const chapterProgress = normalizeChapterProgress(parsed);
    return {
      unlockedLevel: Math.max(
        MIN_UNLOCKED_LEVEL,
        clamp(parsed.unlockedLevel ?? DEFAULT_STATE.unlockedLevel, 1, LEVELS.length),
      ),
      completedLevels: Array.isArray(parsed.completedLevels) ? parsed.completedLevels.filter(n => typeof n === 'number') : [],
      chapterProgress,
      bgmVolume: clamp(parsed.bgmVolume ?? legacyVol ?? DEFAULT_STATE.bgmVolume, 0, 100),
      sfxVolume: clamp(parsed.sfxVolume ?? legacyVol ?? DEFAULT_STATE.sfxVolume, 0, 100),
      lang: (parsed.lang === 'en' || parsed.lang === 'zh') ? parsed.lang : DEFAULT_STATE.lang,
      selectedChapterId: getChapter(parsed.selectedChapterId ?? '') ? parsed.selectedChapterId! : DEFAULT_CHAPTER_ID,
      gameMode: isGameMode(parsed.gameMode) ? parsed.gameMode : DEFAULT_GAME_MODE,
    };
  } catch (e) {
    console.warn('[LevelDB] 解析菜单存档失败，重置', e);
    return { ...DEFAULT_STATE, chapterProgress: emptyChapterProgress() };
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

  replace(state: MenuState): void {
    const chapterProgress = normalizeChapterProgress(state);
    writeState({
      unlockedLevel: clamp(state.unlockedLevel ?? DEFAULT_STATE.unlockedLevel, 1, LEVELS.length),
      completedLevels: Array.isArray(state.completedLevels) ? state.completedLevels.filter(n => typeof n === 'number') : [],
      chapterProgress,
      bgmVolume: clamp(state.bgmVolume ?? DEFAULT_STATE.bgmVolume, 0, 100),
      sfxVolume: clamp(state.sfxVolume ?? DEFAULT_STATE.sfxVolume, 0, 100),
      lang: (state.lang === 'en' || state.lang === 'zh') ? state.lang : DEFAULT_STATE.lang,
      selectedChapterId: getChapter(state.selectedChapterId ?? '') ? state.selectedChapterId : DEFAULT_CHAPTER_ID,
      gameMode: isGameMode(state.gameMode) ? state.gameMode : DEFAULT_GAME_MODE,
    });
  },

  isUnlocked(levelId: number, chapterId: ChapterId = DEFAULT_CHAPTER_ID): boolean {
    if (chapterId === CUSTOM_CHAPTER_ID) return true;
    const progress = this.load().chapterProgress[chapterId];
    return levelId <= (progress?.unlockedLevel ?? DEFAULT_STATE.unlockedLevel);
  },

  isCompleted(levelId: number, chapterId: ChapterId = DEFAULT_CHAPTER_ID): boolean {
    if (chapterId === CUSTOM_CHAPTER_ID) return false;
    const progress = this.load().chapterProgress[chapterId];
    return (progress?.completedLevels ?? []).indexOf(levelId) >= 0;
  },

  /** 通关回调：战斗胜利后调用 */
  markCompleted(levelId: number, chapterId: ChapterId = DEFAULT_CHAPTER_ID): void {
    if (chapterId === CUSTOM_CHAPTER_ID) return;
    const s = readState();
    const progress = s.chapterProgress[chapterId] ?? {
      unlockedLevel: maxLevelIdForChapter(chapterId),
      completedLevels: [],
    };
    if (progress.completedLevels.indexOf(levelId) < 0) progress.completedLevels.push(levelId);
    progress.completedLevels.sort((a, b) => a - b);
    const maxId = maxLevelIdForChapter(chapterId);
    if (levelId >= progress.unlockedLevel && levelId < maxId) {
      progress.unlockedLevel = levelId + 1;
    }
    s.chapterProgress[chapterId] = progress;
    if (chapterId === DEFAULT_CHAPTER_ID) {
      s.unlockedLevel = progress.unlockedLevel;
      s.completedLevels = progress.completedLevels.slice();
    }
    writeState(s);
  },

  setBgmVolume(v: number): void {
    const s = readState();
    s.bgmVolume = clamp(v, 0, 100);
    writeState(s);
  },

  setSfxVolume(v: number): void {
    const s = readState();
    s.sfxVolume = clamp(v, 0, 100);
    writeState(s);
  },

  setLang(lang: LangCode): void {
    const s = readState();
    s.lang = lang;
    writeState(s);
  },

  setSelectedChapterId(chapterId: ChapterId): void {
    if (!getChapter(chapterId)) return;
    const s = readState();
    s.selectedChapterId = chapterId;
    writeState(s);
  },

  setGameMode(gameMode: GameMode): void {
    const s = readState();
    s.gameMode = gameMode;
    writeState(s);
  },

  /** 调试/测试重置：清空进度 */
  reset(): void {
    writeState({ ...DEFAULT_STATE, chapterProgress: emptyChapterProgress() });
  },
};
