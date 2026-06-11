/**
 * 全局音频：BGM + 多路 SFX（与 `MenuProgress` 的 bgmVolume / sfxVolume 同步）。
 * 资源放在 `assets/resources/audio/` 下，路径与扩展名由 Cocos 导入后决定；代码里用无扩展 bundle 路径。
 * 缺文件时仅 warn 一次，不抛异常。
 */

import { AudioClip, AudioSource, Node, director, resources } from 'cc';
import { MenuProgress } from '../core/LevelDB';

/** resources 下相对路径（无扩展名）；放入 ogg/mp3/wav 并刷新资源库后即可播放 */
export const AudioKeys = {
  bgmMenu: 'audio/bgm_menu',
  bgmBattle: 'audio/bgm_battle',
  uiClick: 'audio/ui_click',
  diceRoll: 'audio/dice_roll',
  /** 坦克前进 / 后退 / 转向共用；动画期间循环播放，动作结束时由 `stopTankManeuver` 停止 */
  tankManeuver: 'audio/tank_move',
  cannonFire: 'audio/cannon_fire',
  mgFire: 'audio/mg_fire',
  /** 主炮装填完成（玩家消耗装填骰 / 对子装填手） */
  cannonReload: 'audio/cannon_reload',
} as const;

const clipCache = new Map<string, AudioClip>();
const loadFailed = new Set<string>();

let rootNode: Node | null = null;
let bgmSource: AudioSource | null = null;
/** 谢尔曼 / 敌坦 平移与转向共用一路，与短音效池分离，便于在动画结束时 `stop()` */
let maneuverSource: AudioSource | null = null;
/** 防止 `getClip` 晚于 `stopTankManeuver` 回调时误开播 */
let maneuverPlayId = 0;
let sfxPool: AudioSource[] = [];
let sfxIdx = 0;
let currentBgmKey: string | null = null;
let initCalled = false;

function getClip(key: string, cb: (c: AudioClip | null) => void): void {
  const hit = clipCache.get(key);
  if (hit) {
    cb(hit);
    return;
  }
  if (loadFailed.has(key)) {
    cb(null);
    return;
  }
  resources.load(key, AudioClip, (err, clip) => {
    if (err || !clip) {
      if (!loadFailed.has(key)) {
        console.warn('[GameAudio] load failed:', key, err);
        loadFailed.add(key);
      }
      cb(null);
      return;
    }
    clipCache.set(key, clip);
    cb(clip);
  });
}

function ensureRoot(): void {
  if (rootNode && rootNode.isValid) return;
  const scene = director.getScene();
  if (!scene) return;

  const root = new Node('GameAudioRoot');
  scene.addChild(root);
  director.addPersistRootNode(root);
  rootNode = root;

  const bgmN = new Node('BGM');
  root.addChild(bgmN);
  bgmSource = bgmN.addComponent(AudioSource);
  bgmSource.loop = true;
  bgmSource.playOnAwake = false;

  const sfxParent = new Node('SFXPool');
  root.addChild(sfxParent);
  for (let i = 0; i < 8; i++) {
    const n = new Node(`Sfx_${i}`);
    sfxParent.addChild(n);
    const a = n.addComponent(AudioSource);
    a.playOnAwake = false;
    a.loop = false;
    sfxPool.push(a);
  }

  const maneuverN = new Node('TankManeuver');
  root.addChild(maneuverN);
  maneuverSource = maneuverN.addComponent(AudioSource);
  maneuverSource.playOnAwake = false;
  maneuverSource.loop = true;

  refreshVolumes();
}

function refreshVolumes(): void {
  const s = MenuProgress.load();
  const bgm = s.bgmVolume / 100;
  const sfx = s.sfxVolume / 100;
  if (bgmSource) bgmSource.volume = bgm;
  if (maneuverSource) maneuverSource.volume = sfx;
  for (const a of sfxPool) a.volume = sfx;
}

function preloadKeys(keys: readonly string[]): void {
  for (const k of keys) {
    getClip(k, () => { /* warm cache */ });
  }
}

/** 首次进游戏或进战斗场景时调用；可重复调用（幂等）。 */
export function initGameAudio(): void {
  if (initCalled) {
    ensureRoot();
    return;
  }
  initCalled = true;
  ensureRoot();
  preloadKeys(Object.values(AudioKeys));
}

/** 设置里改音量后调用，立即作用到 AudioSource */
export function onMenuVolumesChanged(): void {
  refreshVolumes();
}

export function playBgm(key: string): void {
  ensureRoot();
  if (!bgmSource) return;
  refreshVolumes();
  const s = MenuProgress.load();
  if (s.bgmVolume <= 0) {
    bgmSource.stop();
    currentBgmKey = null;
    return;
  }
  if (currentBgmKey === key && bgmSource.playing) return;
  getClip(key, (clip) => {
    if (!clip || !bgmSource) return;
    currentBgmKey = key;
    bgmSource.stop();
    bgmSource.clip = clip;
    bgmSource.play();
  });
}

export function playBgmMenu(): void {
  playBgm(AudioKeys.bgmMenu);
}

export function playBgmBattle(): void {
  playBgm(AudioKeys.bgmBattle);
}

export function stopBgm(): void {
  if (bgmSource) {
    bgmSource.stop();
    currentBgmKey = null;
  }
}

/**
 * @param volumeMul 相对当前 SFX 基准（sfxVolume/100）的倍数
 * @param volumeCap 单路音量上限（默认 1）；主炮等可提高到 2～6，避免拉满 SFX 仍被压成「像蚊子叫」
 */
export function playSfxKey(key: string, volumeMul = 1, volumeCap = 1): void {
  ensureRoot();
  const s = MenuProgress.load();
  if (s.sfxVolume <= 0) return;
  getClip(key, (clip) => {
    if (!clip || sfxPool.length === 0) return;
    refreshVolumes();
    const src = sfxPool[sfxIdx++ % sfxPool.length];
    src.stop();
    src.clip = clip;
    const sfx = s.sfxVolume / 100;
    src.volume = Math.min(volumeCap, sfx * volumeMul);
    src.play();
  });
}

export function playUiClick(): void {
  playSfxKey(AudioKeys.uiClick);
}

export function playDiceRoll(): void {
  playSfxKey(AudioKeys.diceRoll);
}

/** 开始播放坦克机动音（前进 / 后退 / 转向同一 clip）；动画进行中保持循环，结束请调 `stopTankManeuver`。 */
export function startManeuverSound(key?: string | null): void {
  if (!key) return;
  ensureRoot();
  const s = MenuProgress.load();
  if (s.sfxVolume <= 0) return;
  const myId = ++maneuverPlayId;
  getClip(key, (clip) => {
    if (myId !== maneuverPlayId || !clip || !maneuverSource) return;
    refreshVolumes();
    maneuverSource.stop();
    maneuverSource.clip = clip;
    maneuverSource.loop = true;
    maneuverSource.play();
  });
}

export function startTankManeuver(): void {
  startManeuverSound(AudioKeys.tankManeuver);
}

/** 当前段移动 / 转向动画结束时调用，立即停止机动音。 */
export function stopManeuverSound(): void {
  maneuverPlayId++;
  if (maneuverSource) maneuverSource.stop();
}

export function stopTankManeuver(): void {
  stopManeuverSound();
}

/** 主炮开火：在 SFX 基准上再拉高（大 cap 以免顶到 1 后无法再响） */
const CANNON_FIRE_VOL_MUL = 6;
const CANNON_FIRE_VOL_CAP = 4;

export function playConfiguredAttackSound(key?: string | null): void {
  if (!key) return;
  playSfxKey(key, CANNON_FIRE_VOL_MUL, CANNON_FIRE_VOL_CAP);
}

export function playCannonFire(): void {
  playConfiguredAttackSound(AudioKeys.cannonFire);
}

export function playMgFire(): void {
  playSfxKey(AudioKeys.mgFire);
}

/** 装填：相对默认 SFX 约 +150%（2.5×），上限同步放宽 */
export function playCannonReload(): void {
  playSfxKey(AudioKeys.cannonReload, 2.5, 2.5);
}
