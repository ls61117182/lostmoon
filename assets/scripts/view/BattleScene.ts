/**
 * BattleScene —— 把 mission_01.json 渲染为六角格地图，支持骰子驱动的"移动阶段 /
 * 攻击阶段"双子阶段、敌方贪心 AI 与存读档。
 *
 * 玩法（按说明书 3.6 行动表拆分为两个独立阶段）：
 *   - 回合开始时底部弹出阶段选择条：「打开舱盖/关闭舱盖」+「移动阶段 / 攻击阶段」；选择子阶段前可多次切换舱盖，车长阵亡则舱盖钮灰显为「车长阵亡」；两子阶段可任意顺序进入
 *   - 进入某阶段时，按谢尔曼当前格地形 + 舱盖状态摇 3~5 颗骰子，落在屏幕底部骰子托盘
 *     - 移动阶段：1=无 / 2=启动（未实装，可跳过）/ 3,4=转向 60° / 5,6=前进或后退 1 格
 *     - 攻击阶段：1,2=装填 / 3,4=机枪（暂无步兵，置灰）/ 5,6=主炮射击（需已装填）
 *     - 机枪：攻击阶段 3/4 点不受乘员阵亡影响；杂项阶段「副驾驶机枪」需副驾驶存活
 *   - 点击骰子弹出动作菜单，选择具体执行方式（↻顺时针 / ↺逆时针 / ▲前进 / ▼后退…）
 *   - 前进 / 后退沿谢尔曼当前朝向 ±1 格移动；若目标格地形或敌方占据无法进入，
 *     该次移动无效、骰子不消耗、只弹警告浮字
 *   - 主炮骰点击进入"选择目标"态；点击视线内敌人 → 掷骰结算并消耗骰，之后 loaded 归 false
 *   - 玩家回合点击地图格：若处于攻击/杂项且格上有敌且已选机枪或主炮骰，则优先尝试机枪/主炮开火；否则打开格子介绍（地形、骰子规则、格上单位状态）
 *   - 右下角按钮："下一阶段"用于在子阶段内提前结束（仍有骰子未用时）；移动/攻击子阶段在骰子用尽或
 *     点「下一阶段」后会自动进入另一翼或自动进入杂项；杂项结束后进入敌方阶段。
 *   - 敌方阶段：UI 固定区展示该敌坦本回合全部 AI 骰并按序执行；移动 / 转向约 0.5s 过程动画，
 *     谢尔曼移动与转向同样播放过程动画
 *   - 摧毁任务目标单位 → 屏幕中央"胜利！"；谢尔曼被摧毁 → "战败"
 *   - 胜负出现后下方"再来一局"按钮可点击重置整局，使用同一份任务 JSON
 *   - 右上 ☰ 本关回合结束事件表（只读查阅）/ ⚙ 战斗设置：音量 / 语言 / 存档读档 / 退出关卡（退出二次确认：保存后退出 / 放弃关卡）
 *
 * 用法：
 *   1. 打开任意场景（如 changjing2.scene）
 *   2. 在 Canvas 下新建一个空 Node（命名随意，如 "battle"）
 *   3. 把本脚本拖到该 Node 上
 *   4. 预览即可看到地图与 HUD
 *
 * Inspector 可调：hexSize（默认约 +20% 盘面） / missionPath / showReachable / moveDuration /
 *                 movesPerTurn（仅敌方 AI 用） / rngSeed
 */

import {
  _decorator,
  BlockInputEvents,
  Color,
  Component,
  EventTouch,
  Graphics,
  HorizontalTextAlignment,
  JsonAsset,
  Label,
  Mask,
  Node,
  ScrollView,
  Sprite,
  SpriteFrame,
  sys,
  UITransform,
  Vec3,
  VerticalTextAlignment,
  director,
  resources,
} from 'cc';
import {
  HEDGE_DRAW_EDGE_BY_AXIAL,
  HexMap,
  axialToPixel,
  approximateDirection,
  directionTo,
  hexDistance,
  neighbor,
  neighbors,
  offsetToAxial,
  rotateDirection,
} from '../core/HexGrid';
import {
  actionDicePool,
  classifyAttackDie,
  classifyMiscDie,
  classifyMoveDie,
  rollActionDice,
} from '../core/ActionDice';
import { PLAYER_DICE_POOL } from '../core/PlayerActionDB';
import { applyAttack, applyMGAttack, AttackReport, canAttack, canMGAttack, CrewDeathResult, DamageEffect, hitThreshold, maxMGHitRoll, mgHitThreshold, resolveCrewCheck, resolveDamageEffect, rollAttack, rollMGAttack } from '../core/Combat';
import { RNG } from '../core/Dice';
import { t, setLang, getLang, LangCode } from '../core/Lang';
import {
  actionFor,
  AI_DICE_COUNT,
  aiColumnFor,
  AIActionEntry,
  AIColumn,
  canExecuteAction,
  currentTargetFor,
  DEFAULT_AI_TABLE,
  decideEnemyTurn,
  EnemyAction,
  rollAIDice,
  selectAIOrder,
} from '../core/EnemyAI';
import { loadMission, LoadedMission } from '../core/MissionLoader';
import { getUnitStats } from '../core/UnitDB';
import { buildObjectiveHudLines, objectiveDestroyProgressLangKey, ObjHudLine } from '../core/MissionObjectiveHud';
import { checkOutcome, isShermanEvacDrive, MissionOutcome } from '../core/Objective';
import {
  AdjacentInfantryVolleyPreview,
  GermanTruckMoveSegment,
  prepareTurnEndEvent,
  TurnEndExtraDicePhase,
  TurnEndTankReinforceMove,
} from '../core/TurnEndEventApply';
import {
  hasTurnEndEvents,
  TURN_END_EVENTS,
  TurnEndEffectType,
  turnEndEventsForMission,
  turnEndRowForSum,
} from '../core/TurnEndEventDB';

/** 回合结束事件表弹窗：效果类型 → lang key */
const TURN_END_LIST_EFFECT_KEYS: Record<TurnEndEffectType, string> = {
  none: 'battle.turnEndList.effect.none',
  sniper: 'battle.turnEndList.effect.sniper',
  commander_extra: 'battle.turnEndList.effect.commander_extra',
  infantry_spawn: 'battle.turnEndList.effect.infantry_spawn',
  adjacent_infantry_fire: 'battle.turnEndList.effect.adjacent_infantry_fire',
  mechanical_failure: 'battle.turnEndList.effect.mechanical_failure',
  stuka: 'battle.turnEndList.effect.stuka',
  panzer3_spawn: 'battle.turnEndList.effect.panzer3_spawn',
  road_mine: 'battle.turnEndList.effect.road_mine',
  panzer4_spawn: 'battle.turnEndList.effect.panzer4_spawn',
  tiger_spawn: 'battle.turnEndList.effect.tiger_spawn',
  sherman_spawn: 'battle.turnEndList.effect.sherman_spawn',
  german_truck_move: 'battle.turnEndList.effect.german_truck_move',
  clear_mine: 'battle.turnEndList.effect.clear_mine',
  type95_spawn: 'battle.turnEndList.effect.type95_spawn',
  type97_spawn: 'battle.turnEndList.effect.type97_spawn',
  heavy_mortar: 'battle.turnEndList.effect.heavy_mortar',
};

function turnEndListEffectKey(effectType: TurnEndEffectType, theater?: string): string {
  if (theater === 'pacific' && effectType === 'infantry_spawn') {
    return 'battle.turnEndList.effect.japanese_infantry_spawn';
  }
  return TURN_END_LIST_EFFECT_KEYS[effectType];
}
import { applySave, captureSave, SaveData, SavePlayerStep } from '../core/SaveLoad';
import { GameSession } from '../core/GameSession';
import { findLevelByMissionId, MenuProgress } from '../core/LevelDB';
import { syncServerProfile } from '../core/AuthService';
import { readActiveSaveRaw, writeActiveSaveRaw } from '../core/SaveSlot';
import {
  SPLIT_TANK_KINDS,
  SplitTankKind,
  SplitTankGeometryConfig,
  SplitTankVisualConfig,
  TANK_VISUAL_KINDS,
  TankVisualKind,
  splitTankGeometryConfigOf,
  splitTankVisualConfigOf,
  tankVisualAssetConfigOf,
  tankVisualConfigOf,
} from '../core/TankVisualDB';
import {
  initGameAudio,
  onMenuVolumesChanged,
  playBgmBattle,
  stopBgm,
  playCannonReload,
  playConfiguredAttackSound,
  playDiceRoll,
  playMgFire,
  startManeuverSound,
  stopManeuverSound,
  playUiClick,
} from '../audio/GameAudio';
import { Direction, effectiveDiceTerrain, isFootUnit, MissionData, TerrainType, Tile, tileForbidsSmokeOrConcealment, tileHasBridge, Unit, UnitKind } from '../core/types';

/** 小预览用：在 Graphics 上画实心六角 + 描边 */
function drawMiniHexTerrain(g: Graphics, cx: number, cy: number, size: number, fill: Color, stroke: Color) {
  const trace = () => {
    for (let i = 0; i < 6; i++) {
      const angle = (-30 + 60 * i) * Math.PI / 180;
      const x = cx + size * Math.cos(angle);
      const y = cy + size * Math.sin(angle);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.close();
  };
  g.fillColor = fill;
  trace();
  g.fill();
  g.strokeColor = stroke;
  g.lineWidth = 1.5;
  trace();
  g.stroke();
}

function drawFieldPanel(g: Graphics, w: number, h: number, fill: Color, border: Color, accent: Color) {
  const x = -w / 2;
  const y = -h / 2;
  g.fillColor = new Color(0, 0, 0, 74);
  g.rect(x + 4, y - 5, w, h);
  g.fill();
  g.fillColor = fill;
  g.rect(x, y, w, h);
  g.fill();
  g.fillColor = new Color(255, 240, 180, 20);
  g.rect(x + 4, y + h - 18, w - 8, 10);
  g.fill();
  g.strokeColor = border;
  g.lineWidth = 2;
  g.rect(x + 1, y + 1, w - 2, h - 2);
  g.stroke();
  g.strokeColor = new Color(14, 16, 14, 185);
  g.lineWidth = 1;
  g.rect(x + 6, y + 6, w - 12, h - 12);
  g.stroke();
  g.strokeColor = accent;
  g.lineWidth = 2;
  const l = Math.min(24, Math.max(10, Math.min(w, h) * 0.18));
  g.moveTo(x + 8, y + h - 8); g.lineTo(x + 8 + l, y + h - 8);
  g.moveTo(x + 8, y + h - 8); g.lineTo(x + 8, y + h - 8 - l);
  g.moveTo(x + w - 8, y + h - 8); g.lineTo(x + w - 8 - l, y + h - 8);
  g.moveTo(x + w - 8, y + h - 8); g.lineTo(x + w - 8, y + h - 8 - l);
  g.moveTo(x + 8, y + 8); g.lineTo(x + 8 + l, y + 8);
  g.moveTo(x + 8, y + 8); g.lineTo(x + 8, y + 8 + l);
  g.moveTo(x + w - 8, y + 8); g.lineTo(x + w - 8 - l, y + 8);
  g.moveTo(x + w - 8, y + 8); g.lineTo(x + w - 8, y + 8 + l);
  g.stroke();
}

function drawDicePopupPanel(g: Graphics, w: number, h: number, fill: Color, border: Color) {
  g.fillColor = fill;
  g.roundRect(-w * 0.5, -h * 0.5, w, h, 12);
  g.fill();
  g.strokeColor = border;
  g.lineWidth = 2;
  g.roundRect(-w * 0.5, -h * 0.5, w, h, 12);
  g.stroke();
}

const { ccclass, property } = _decorator;

/** 使用通用俯视 PNG 池的车辆单位；玩家谢尔曼仍额外占用专属节点 */
type EnemyTopKind = Extract<UnitKind, 'sherman' | 'panzer4' | 'panzer3' | 'tiger' | 'type97' | 'at_gun' | 'heavy_artillery' | 'truck'>;

function isEnemyTopKind(k: UnitKind): k is EnemyTopKind {
  return k === 'sherman' || k === 'panzer4' || k === 'panzer3' || k === 'tiger' || k === 'type97' || k === 'at_gun' || k === 'heavy_artillery' || k === 'truck';
}

type DestroyedTopKind = Extract<UnitKind, 'sherman' | 'panzer4' | 'panzer3' | 'tiger' | 'type97' | 'at_gun' | 'heavy_artillery' | 'truck'>;

function isDestroyedTopKind(k: UnitKind): k is DestroyedTopKind {
  return k === 'sherman' || k === 'panzer4' || k === 'panzer3' || k === 'tiger' || k === 'type97' || k === 'at_gun' || k === 'heavy_artillery' || k === 'truck';
}

function isSplitTankKind(k: UnitKind): k is SplitTankKind {
  return (SPLIT_TANK_KINDS as readonly UnitKind[]).includes(k);
}

interface SplitTankSpriteAssets {
  hull: SpriteFrame | null;
  turret: SpriteFrame | null;
  hullDisplayW: number;
  hullDisplayH: number;
}

const SHERMAN_SPLIT_VISUAL_CONFIG = splitTankVisualConfigOf('sherman');
const TIGER_SPLIT_VISUAL_CONFIG = splitTankVisualConfigOf('tiger');
const PANZER4_SPLIT_VISUAL_CONFIG = splitTankVisualConfigOf('panzer4');
const PANZER3_SPLIT_VISUAL_CONFIG = splitTankVisualConfigOf('panzer3');
const SHERMAN_SPLIT_GEOMETRY_CONFIG = splitTankGeometryConfigOf('sherman');
const TIGER_SPLIT_GEOMETRY_CONFIG = splitTankGeometryConfigOf('tiger');
const PANZER4_SPLIT_GEOMETRY_CONFIG = splitTankGeometryConfigOf('panzer4');
const PANZER3_SPLIT_GEOMETRY_CONFIG = splitTankGeometryConfigOf('panzer3');

/** 本关在 turn_end_events 表里配置的主骰颗数（多行取最大，缺省 2） */
function turnEndDiceCountForMission(missionId: string): number {
  const rows = TURN_END_EVENTS.filter(r => r.missionId === missionId);
  if (!rows.length) return 2;
  return Math.max(...rows.map(r => r.diceCount));
}

/** 着火检定预掷结果：确认后才写入谢尔曼状态 */
interface FireCheckPreparedStep {
  die: number;
  effect: DamageEffect;
  crewDie?: number;
  /** 阵亡检定为 null 表示虚惊；1–5 为乘员位 */
  crewSlot?: number | null;
}

/** 三阶缓出：起步快、收尾慢，最适合"惯性滑停"的坦克移动 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** 三阶缓入缓出：排序位移动画用 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 掷骰展示后、按点排序到槽位的动画时长（秒） */
const ENEMY_TRAY_SORT_DUR = 1.0;

/** 把 AIActionEntry 转成控制台日志里的 "射击>转向" 这种紧凑表达 */
function describeEntry(entry: AIActionEntry): string {
  const name = (a: EnemyAction): string => {
    switch (a) {
      case 'shoot':   return '射击';
      case 'turn':    return '转向';
      case 'advance': return '前进';
      case 'reverse': return '后退';
      case 'smoke':   return '烟雾';
      case 'repair':  return '修复';
      case 'conceal': return '隐蔽';
      case 'shoot_adjacent': return '相邻射击';
      case 'infantry_move': return '步兵移动';
      case 'advance_to_building': return '进入建筑';
      case 'hull_down': return 'Hull Down';
      case 'none':    return '无';
    }
  };
  const parts = [entry.primary, entry.fallback, entry.fallback2]
    .filter((a): a is EnemyAction => !!a && a !== 'none')
    .map(name);
  return parts.length > 0 ? parts.join('>') : name('none');
}

/**
 * 把 §3.4 Step 3 的 DamageEffect 映射到骰子面板右侧的"效果文字" + 颜色。
 * 内容偏简短，只够放一行；底部的大字 outcomeLabel 用 damageOutcomeLabel 另算。
 */
function damageEffectLabel(e: DamageEffect | undefined): { text: string; color: Color } {
  switch (e) {
    case 'destroyed':  return { text: t('dmg.effect.destroyed'), color: new Color(255,  60,  60, 255) };
    case 'damaged':    return { text: t('dmg.effect.damaged'),   color: new Color(240, 200, 100, 255) };
    case 'fire':       return { text: t('dmg.effect.fire'),      color: new Color(255, 170,  40, 255) };
    case 'turret':     return { text: t('dmg.effect.turret'),    color: new Color(230, 150,  80, 255) };
    case 'paralyzed':  return { text: t('dmg.effect.paralyzed'), color: new Color(200, 160, 240, 255) };
    case 'crewCheck':  return { text: t('dmg.effect.crewCheck'), color: new Color(240, 220, 120, 255) };
    default:           return { text: '—',                        color: new Color(200, 200, 200, 255) };
  }
}

/** 面板底部大字的配色 / 文字。与右侧小字相比用更醒目颜色。 */
function damageOutcomeLabel(e: DamageEffect | undefined): { text: string; color: Color } {
  switch (e) {
    case 'destroyed':  return { text: t('dmg.outcome.destroyed'), color: new Color(255,  60,  60, 255) };
    case 'damaged':    return { text: t('dmg.outcome.damaged'),   color: new Color(240, 200, 100, 255) };
    case 'fire':       return { text: t('dmg.outcome.fire'),      color: new Color(255, 170,  40, 255) };
    case 'turret':     return { text: t('dmg.outcome.turret'),    color: new Color(230, 150,  80, 255) };
    case 'paralyzed':  return { text: t('dmg.outcome.paralyzed'), color: new Color(200, 160, 240, 255) };
    case 'crewCheck':  return { text: t('dmg.outcome.crewCheck'), color: new Color(240, 220, 120, 255) };
    default:           return { text: '—',                         color: new Color(200, 200, 200, 255) };
  }
}

/** §3.2：乘员编号 -> 角色名（走 t()，默认中文） */
function crewRoleName(slot: number | null | undefined): string {
  switch (slot) {
    case 1: return t('crew.role.1');
    case 2: return t('crew.role.2');
    case 3: return t('crew.role.3');
    case 4: return t('crew.role.4');
    case 5: return t('crew.role.5');
    default: return '—';
  }
}

/** 阵亡检定：骰子面板右侧小字 "xxx 阵亡 / 虚惊（舱盖关）" */
function crewDeathLabel(cc: CrewDeathResult | undefined): { text: string; color: Color } {
  if (!cc) return { text: '—', color: new Color(200, 200, 200, 255) };
  if (cc.slot === null) {
    // die === 6 且舱盖关 / 或兜底的"全员阵亡"极端情况
    return { text: t('crew.death.falseAlarmHatch'), color: new Color(180, 200, 240, 255) };
  }
  return {
    text: t('crew.death.kia', { role: crewRoleName(cc.slot) }),
    color: new Color(255,  80,  80, 255),
  };
}

/** 阵亡检定：骰子面板底部大字 */
function crewOutcomeLabel(cc: CrewDeathResult | undefined): { text: string; color: Color } {
  if (!cc || cc.slot === null) {
    return { text: t('crew.death.falseAlarm'), color: new Color(180, 200, 240, 255) };
  }
  return {
    text: t('crew.death.kia', { role: crewRoleName(cc.slot) }),
    color: new Color(255,  80,  80, 255),
  };
}

function unitDisplayName(kind: UnitKind): string {
  return t(`unit.name.${kind}`);
}

function missionDisplayId(id: string): string {
  if (getLang() !== 'zh') return id;
  const m = /^mission_(\d+)$/i.exec(id);
  return m ? `任务 ${m[1]}` : id;
}

function aiColumnDisplayName(col: AIColumn): string {
  return t(`dice.aiCol.${col}`);
}

/** 任意单位正在播放的移动 / 转向动画（谢尔曼 / 敌坦克通用） */
interface MoveAnim {
  unit: Unit;
  kind: 'move' | 'turn';
  fromQ: number;
  fromR: number;
  toQ: number;
  toR: number;
  t: number;     // 0..1
  dur: number;   // 秒
  /** kind==='turn'：一步 60° 的起止朝向 */
  turnFrom?: Direction;
  turnTo?: Direction;
  /** kind==='move'：驶出地图的撤离移动，结束时置 shermanEvacuated 并判胜 */
  evacExit?: boolean;
  /** kind==='move'：德军卡车沿公路末端驶离地图的最后一个位移，结束时置 truckEscapeDefeat（须在抵达最后一格之后的驶离段） */
  truckExitDefeat?: boolean;
}

interface TurretAimAnim {
  unit: Unit;
  from: Direction;
  to: Direction;
  t: number;
  dur: number;
  onDone: () => void;
}

type DirectionLerp = { from: number; to: number; t: number; angular?: boolean };

type Phase = 'player' | 'enemy';

/**
 * 玩家回合内的细分状态机：
 *   - 'choose'     : 等待玩家选择进入"移动阶段 / 攻击阶段"（顺序任意；两阶段均完成后自动进入杂项）
 *   - 'movement'   : 正在执行移动阶段，骰子托盘展示着本阶段剩余移动骰
 *   - 'attack'     : 正在执行攻击阶段；选中一颗主炮骰后进入"选目标"态，
 *                    点击敌人开火，结算后骰子从托盘消失
 *   - 'misc'       : 正在执行杂项阶段（C 列）。GDD §2.3 要求 C 列必须最后执行，
 *                    所以一旦进入 misc，本回合剩余的 movement / attack 就不能再进入了。
 * 三个阶段同一回合内互不可重复执行；均执行过（或 misc 已完成 / 移动+攻击都完成）后
 * 右下角按钮变红切为"结束回合"，再点才真正把控制权交给敌方。
 */
type PlayerStep = 'choose' | 'movement' | 'attack' | 'misc';

/** 骰子托盘里的单颗骰子 —— 同阶段内所有骰共享一份 action 分类结果（movement 或 attack） */
interface DieSlot {
  pip: number;    // 1..6 的点数
  used: boolean;  // 执行后置 true；渲染时灰掉并跳过点击
}

/** 托盘里每颗骰子对应的视觉节点三件套（背景 + 点数文字 + 下方动作提示） */
interface DieVisual {
  root: Node;           // 作为容器承接触摸
  bg: Graphics;         // 骰子方块 + 边框
  pips: Graphics;       // 骰面点阵
  faceLabel: Label;     // 大号点数
  hintLabel: Label;     // 下方动作提示（"转向 / 驾驶 / 主炮 / 装填 / —"）
}

/**
 * 攻击掷骰展示面板的状态机（§3.4 三段式）：
 *   - hit-roll : 2d6 骰子面在飞速循环
 *   - hit-show : 锁定 2d6 真值并显示"命中 / 未命中"
 *   - pen-roll : （仅命中时进入）2d6 穿甲骰在飞速循环
 *   - pen-show : 锁定 2d6 并显示"击穿 / 跳弹"
 *   - dmg-roll : （仅击穿时进入）1d6 伤害骰在飞速循环
 *   - dmg-show : 锁定 1d6 并显示"摧毁 / 起火 / 炮塔受损 / 痛痪 / 阵亡检定 / 受损"
 *   - hold     : 显示最终结果（起火 / 击毁 / 跳弹 / MISS / 炮塔 / 痛痪…），停顿后自毁
 *   - done     : 即将销毁，advanceDiceShow 里用来幂等保护
 *
 * 动画用 update() 里的 t 累加驱动，因此不依赖任何 tween 库；
 * 期间 this.diceShow !== null 会屏蔽一切玩家 / 敌方新指令。
 */
type DiceStage =
  | 'hit-roll' | 'hit-show'
  | 'pen-roll' | 'pen-show'
  | 'dmg-roll' | 'dmg-show'
  | 'crew-roll' | 'crew-show'
  | 'hold' | 'done';

interface DiceShow {
  stage: DiceStage;
  t: number;                 // 当前阶段已经经过的秒数
  report: AttackReport;      // 已 rollAttack 得出的最终结果（不能再变）
  attackerLabel: string;     // 标题里的攻击方名（"玩家" / "敌方 panzer4"）
  targetLabel: string;       // 标题里的目标名（"panzer4" / "谢尔曼"）
  /**
   * 是否"机枪模式"（§3.6 B 列 3/4 / C 列 2）：
   *   - 面板只显示 2d6 + 命中阈值 + 结果三段
   *   - 状态机在 hit-show 结束后直接跳到 hold，不进入 pen/dmg/crew
   *   - 底部大字改用 MG 专属文案（"步兵击毙 / MISS"）
  */
  mg: boolean;
  attackSound: string;
  attacker: Unit | null;
  target: Unit | null;
  onDone: () => void;        // 动画结束回调：真正 applyAttack + 浮字 + 继续调度
  finalized: boolean;        // 保险位，避免 onDone 被回调多次
  // 视觉
  panelRoot: Node;
  hitDieLabels: Label[];     // 2 颗命中骰
  hitSumLabel: Label;        // "= N"
  hitNeedLabel: Label;       // "需≥N"
  hitVerdictLabel: Label;    // "命中！" / "未命中"
  hitSpecialLabel: Label | null;
  penDieLabels: Label[];    // 穿甲骰（2 颗）
  penNeedLabel: Label | null;
  penVerdictLabel: Label | null;
  dmgDieLabel: Label | null; // 1 颗伤害骰（仅 penetrated 时展示）
  dmgTitleLabel: Label | null;  // "伤害检定" 标题
  dmgEffectLabel: Label | null; // "起火 / 炮塔受损 / 痛痪 / 阵亡检定 / 摧毁 / 受损"
  crewDieLabel: Label | null;    // 1 颗阵亡检定骰（仅 damageEffect==='crewCheck' 时存在）
  crewTitleLabel: Label | null;  // "阵亡检定" 标题
  crewEffectLabel: Label | null; // "驾驶员阵亡 / 虚惊 / …"
  outcomeLabel: Label;       // 底部大字：起火 / 击毁 / 跳弹 / MISS / 炮塔 / 痛痪 / 乘员阵亡
  confirmButton: Node | null;
}

type CombatLogParams = Record<string, string | number>;
interface CombatLogI18nEntry {
  key: string;
  params?: CombatLogParams;
}
type CombatLogEntry = string | CombatLogI18nEntry;

/** 战报浮字：一条挂在 mapNode 下的 Label，会上浮 + 渐隐 + 自毁 */
interface Floater {
  node: Node;
  label: Label;
  baseR: number;   // 原色 RGB，透明度在 update() 里重算
  baseG: number;
  baseB: number;
  baseX: number;   // 生成时的起点
  baseY: number;
  t: number;       // 已播放时长（秒）
  dur: number;     // 总时长（秒）
  rise: number;    // 整段动画向上移动的像素
}

// ---------- 配色 ----------
interface MuzzleFlash {
  node: Node;
  g: Graphics;
  x: number;
  y: number;
  ux: number;
  uy: number;
  size: number;
  t: number;
  dur: number;
}

const TERRAIN_COLORS: Record<TerrainType, Color> = {
  road:     new Color(200, 178, 142, 255), // 公路格：偏棕黄沙土地基，drawRoadHexOverlay 再叠颗粒
  field:    new Color(196, 220, 130, 255),
  mud:      new Color(132, 118, 104, 255), // 泥地：灰褐脏土基底，drawMudOverlay 叠污渍 / 擦痕
  forest:   new Color( 58, 112,  50, 255), // 稍压暗，树冠叠上去后更像林间地面
  water:    new Color( 90, 145, 200, 255),
  deep_water: new Color( 92, 136, 142, 255),
  clear:    new Color(210, 188, 132, 255),
  trees:    new Color( 78, 132,  64, 255),
  beach:    new Color(220, 202, 154, 255),
  rocky:    new Color(120, 118, 112, 255),
  airstrip: new Color(210, 188, 132, 255),
};
/** 林地表冠层（多圆+阴影示意俯视树丛，Y 轴向上） */
const FOREST_TREE_DARK  = new Color( 28,  88,  30, 255);
const FOREST_TREE_MID   = new Color( 45, 118,  42, 255);
const FOREST_TREE_LIGHT = new Color( 70, 148,  58, 255);
const FOREST_SHADE      = new Color(  0,   0,   0,  50);
/**
 * 通用 hex 纹理叠加调色板（用于"沙土 / 路面"等需要颗粒感的格子，参见 `drawHexNoiseOverlay`）：
 * 每个调色板由"软斑 ×2 + 颗粒 ×3"5 色组成。alpha 较低 → 既保留基底主色，又有"无数小颗粒"近距细节。
 *
 * - `MUD_*` 用于 `terrain==='mud'`，色相围绕 mud 基底 (182,168,148)；
 * - `ROAD_HEX_*` 用于 `terrain==='road'`，色相围绕 road 基底 (190,182,165)，整体偏浅灰；
 *
 * 两套色板由 `drawMudOverlay` / `drawRoadHexOverlay` 调用同一个 `drawHexNoiseOverlay` 函数渲染。
 */
const MUD_SOFT_LIGHT    = new Color(176, 164, 144,  70);
const MUD_SOFT_DARK     = new Color( 78,  70,  62,  68);
const MUD_GRIT_LIGHT    = new Color(184, 172, 150, 125);
const MUD_GRIT_DARK     = new Color( 72,  66,  58, 135);
const MUD_GRIT_MID      = new Color(122, 112,  98, 100);
const MUD_SMEAR_LIGHT   = new Color(190, 178, 154,  72);
const MUD_SMEAR_DARK    = new Color( 66,  58,  52,  82);
const MUD_EDGE_SHADE    = new Color( 34,  30,  28,  70);
const ROAD_HEX_SOFT_LIGHT = new Color(228, 208, 172,  55);
const ROAD_HEX_SOFT_DARK  = new Color(165, 145, 112,  55);
const ROAD_HEX_GRIT_LIGHT = new Color(228, 208, 172, 130);
const ROAD_HEX_GRIT_DARK  = new Color(155, 132, 100, 135);
const ROAD_HEX_GRIT_MID   = new Color(195, 175, 138,  90);
const FIELD_STROKE_LIGHT  = new Color(232, 242, 170, 105);
const FIELD_STROKE_MID    = new Color(150, 182,  88, 115);
const FIELD_STROKE_DARK   = new Color( 92, 124,  58, 125);
const FIELD_EDGE_SHADE    = new Color( 44,  58,  34,  58);
/**
 * 建筑图案（不改变六角格基底填色，仅叠加绘制）：
 * 主战场版本采用「俯视方屋」布局（参见 `drawBuildingOverlay`）：
 * - 每栋屋顶从 `BUILDING_ROOF_PALETTE` 中按格 axial 种子随机取一色（棕 / 灰 / 蓝灰 / 红棕等主流屋顶色）
 * - `BUILDING_OUTLINE` 外缘描边（黑棕，对所有调色板色都不糊）
 * - 屋脊细线使用「屋顶色 +35 亮度」的高光（`BUILDING_RIDGE_PALETTE`，与屋顶一一对应）
 * 关卡选择菜单仍沿用旧侧视样式：使用 `BUILDING_ROOF_FILL` 作屋顶、`BUILDING_WALL_FILL` 作墙体。
 */
const BUILDING_ROOF_FILL  = new Color( 95,  78,  62, 255);
const BUILDING_WALL_FILL  = new Color(160, 145, 125, 255);
const BUILDING_OUTLINE    = new Color( 45,  38,  32, 255);
/**
 * 战场内俯视方屋的屋顶调色板：常见的瓦 / 金属 / 沥青屋顶色，避免与 ROAD_PATH_FILL（米褐）、
 * 林地绿、水面蓝混淆。每个色都搭配一个「+35 亮度」的屋脊高光（`BUILDING_RIDGE_PALETTE` 同序）。
 */
const BUILDING_ROOF_PALETTE: ReadonlyArray<Color> = [
  new Color( 75,  60,  48, 255), // 暗棕（旧木瓦）
  new Color(110,  85,  60, 255), // 中棕（沥青瓦 / 木屋顶）
  new Color(130,  75,  55, 255), // 红棕（陶瓦）
  new Color( 85,  85,  88, 255), // 暗灰（板岩）
  new Color(125, 125, 128, 255), // 中灰（水泥瓦）
  new Color( 95, 110, 120, 255), // 蓝灰（金属屋顶）
];
const BUILDING_RIDGE_PALETTE: ReadonlyArray<Color> = BUILDING_ROOF_PALETTE.map(
  (c) => new Color(Math.min(255, c.r + 35), Math.min(255, c.g + 35), Math.min(255, c.b + 35), 255),
);
/** 双坡屋顶的「阴坡」覆盖色（屋顶色 −28 亮度）：与 RIDGE 共同营造屋脊两侧明暗对比，避免屋顶看着像扁箱子 */
const BUILDING_SHADE_PALETTE: ReadonlyArray<Color> = BUILDING_ROOF_PALETTE.map(
  (c) => new Color(Math.max(0, c.r - 28), Math.max(0, c.g - 28), Math.max(0, c.b - 28), 255),
);
/** 瓦楞 / 椽口阴影线色：黑棕 + 较低 alpha，避免在浅色屋顶上过分扎眼 */
const BUILDING_RIB_STROKE = new Color(35, 28, 22, 170);
/** 桥梁叠加（GDD §3.2，绘制于水域格之上）：棕色桥体 + 与公路等宽的浅色路面 */
const BRIDGE_PLANK_FILL   = new Color(128,  92,  58, 255);
const BRIDGE_PLANK_OUTLINE= new Color( 76,  61,  42, 220);
const BRIDGE_PLANK_SEAM   = new Color( 76,  61,  42, 150);
const BRIDGE_RAIL_STROKE  = new Color( 72,  50,  32, 255);
/**
 * 公路条带（按 `Tile.roads` 方向叠加在公路 / 叠桥水域之上）：浅米白路面 + 深棕描边。
 * 路面色比 road 基底 (200,178,142) 更浅更白 → 在棕黄路面上"凿"出一条浅色车辙带，方向感明显。
 */
const ROAD_PATH_FILL      = new Color(212, 200, 178, 255);
const ROAD_PATH_OUTLINE   = new Color( 60,  44,  26, 255);
const AIRSTRIP_FILL       = new Color(200, 196, 178, 255);
const AIRSTRIP_OUTLINE    = new Color(112, 104,  86, 235);
const DEEP_WATER_LIGHT    = new Color(190, 214, 214, 70);
const BREAKWATER_DARK     = new Color(72, 66, 58, 255);
const BREAKWATER_MID      = new Color(118, 108, 92, 255);
const BREAKWATER_LIGHT    = new Color(166, 154, 128, 255);
/**
 * 路面条带颗粒（drawRoadOverlay 二次填充后的最上层细节）：与基底浅米白相近的"细沙碎屑"。
 * 3 档颗粒色全部偏浅（亮米黄 / 浅米黄 / 浅米灰），avoiding 深色小石子那种"脏"感；
 * 仅靠 ±20 亮度差区分层次，使路面条带看起来是干净的浅色路面带细沙颗粒。
 */
const ROAD_GRIT_LIGHT     = new Color(238, 225, 195, 120);
const ROAD_GRIT_MID       = new Color(220, 208, 178, 110);
const ROAD_GRIT_DARK      = new Color(195, 182, 158, 130);
/**
 * 水陆河岸过渡（仅在水域格内沿"非水域邻格"方向画的内偏移沙带）：双层条带形成由水→陆的渐变错觉
 * - 外层：略深米褐贴近水侧
 * - 内层：浅米黄贴近格心 / 陆地侧；两层在六角顶点处自然重叠成圆滑过渡
 */
const WATER_BANK_OUTER    = new Color(168, 142,  92, 230);
const WATER_BANK_INNER    = new Color(214, 196, 152, 235);

const FACTION_COLORS = {
  allied: new Color( 60, 160,  80, 255),
  german: new Color( 60,  60,  60, 255),
  japanese: new Color(128,  52,  44, 255),
};

/** 树篱上离散「灌木丛」：比林地略深、略灰，与 FOREST_* 区分 */
const HEDGE_SHADE       = new Color(10, 18, 11, 170);
const HEDGE_BUSH_DEEP   = new Color(20, 42, 20, 255);
const HEDGE_BUSH_DARK   = new Color(30, 62, 28, 255);
const HEDGE_BUSH_MID    = new Color(52, 88, 38, 255);
const HEDGE_BUSH_LIGHT  = new Color(78, 118, 54, 245);
const TILE_BORDER        = new Color( 40,  40,  40, 220);
const WATER_SHARED_BORDER = new Color(40, 40, 40, 22);
const UNIT_BORDER        = new Color(255, 255, 255, 255);
// HUD 配色：两阶段都执行过后按钮换成"提醒色"，引导玩家结束回合
const BTN_BG_NORMAL  = new Color( 84,  95,  58, 240);
const BTN_BG_URGENT  = new Color(154,  60,  48, 245);
const BTN_BORDER     = new Color(204, 190, 142, 235);
const HUD_TEXT_COLOR = new Color(255, 255, 255, 255);
/** 左上角第一行：关卡 id + 名（与回合条区分的稍弱白） */
const HUD_MISSION_META_COLOR = new Color(226, 214, 174, 255);
/** 与 `buildHUD` 中关卡标题 UITransform 高度一致，改布局须同步 */
const HUD_MISSION_TITLE_H = 32;
/** 关卡标题行下缘 与 回合状态行上缘 的间隙 */
const HUD_MISSION_TO_TURN_GAP = 4;
/** 原设计：目标首行 y=296、回合行顶 y=344；增加关卡标题后整体下推的步长 */
const HUD_SHIFT_FOR_MISSION = HUD_MISSION_TITLE_H + HUD_MISSION_TO_TURN_GAP;
/** 任务目标行：前置未完成 */
const OBJ_HUD_LOCKED = new Color(150, 148, 132, 255);
/** 任务目标行：当前可做、未完成 */
const OBJ_HUD_ACTIVE = new Color(245, 205, 92, 255);
/** 任务目标行：已完成 */
const OBJ_HUD_DONE = new Color(142, 205, 110, 255);
/** 右上角：回合结束事件表（左）与 ⚙ 设置（右），与 `buildStatusPanel` 竖向对齐（改一处须同步） */
const BATTLE_TURNEND_LIST_CX = 520;
const BATTLE_SETTINGS_CX = 580;
const BATTLE_SETTINGS_CY = 318;
const BATTLE_SETTINGS_R = 24;

// 战斗内设置 / 退出确认模态（与主菜单风格一致）
const CANVAS_W = 1280;
const CANVAS_H = 720;
const BOARD_CENTER_OFFSET_Y = 38;
/** 与 MainMenuScene `BG_TOP` / `BG_MID` / `BG_BOTTOM` / `MENU_DIVIDER` 一致（主菜单渐变底图） */
const MAIN_MENU_STYLE_BG_TOP = new Color(40, 52, 38, 255);
const MAIN_MENU_STYLE_BG_MID = new Color(26, 34, 28, 255);
const MAIN_MENU_STYLE_BG_BOTTOM = new Color(13, 18, 17, 255);
const MAIN_MENU_STYLE_DIVIDER = new Color(145, 138, 100, 210);
/** 底部「阶段选择条 + 玩家骰子托盘」共用行中心 Y（Canvas 坐标，负值越大越靠下） */
const BOTTOM_PHASE_ROW_Y = -288;
/** 右下角「下一阶段 / 结束回合」与阶段条大按钮同高，且与底部行垂直对齐 */
const ADVANCE_BTN_W = 180;
const ADVANCE_BTN_H = 72;
const MODAL_BACKDROP     = new Color(  0,   0,   0, 180);
const MODAL_PANEL_BG     = new Color( 36,  41,  34, 245);
const DICE_EVENT_PANEL_BG = new Color(40, 44, 52, 128);
const DICE_EVENT_PANEL_BORDER = new Color(90, 98, 110, 255);
const MODAL_PANEL_BORDER = new Color(202, 188, 136, 230);
const MODAL_CLOSE_BG     = new Color(134,  49,  42, 245);
const SETTINGS_ICON_BG   = new Color( 45,  50,  44, 230);
const SETTINGS_ICON_BD   = new Color(204, 190, 142, 205);
const SLIDER_TRACK       = new Color( 70,  80,  90, 255);
const SLIDER_FILL        = new Color(170, 110,  50, 255);
const SLIDER_THUMB       = new Color(240, 215, 150, 255);
const LANG_BTN_IDLE      = new Color( 59,  64,  54, 235);
const LANG_BTN_ACTIVE    = new Color(145,  95,  44, 245);
const LANG_BTN_ACTIVE_BD = new Color(240, 215, 150, 255);
const BTN_EXIT_WARN      = new Color(134,  49,  42, 245);
const BATTLE_BTN_ACCENT  = new Color(145,  95,  44, 245);
const BATTLE_MODAL_DIVIDER = new Color(145, 138, 100, 210);
const BATTLE_MODAL_TEXT_OUTLINE = new Color(0, 0, 0, 220);
const BATTLE_MODAL_LEVEL_BORDER = new Color(204, 190, 142, 230);

// 阶段选择条配色：两个按钮（移动=绿 / 攻击=红）；已执行过的阶段被灰掉禁用
const PHASE_BTN_MOVE      = new Color( 80, 112,  68, 240);
const PHASE_BTN_ATTACK    = new Color(145,  64,  50, 240);
const PHASE_BTN_MISC      = new Color(105,  96,  70, 240);
/** 选择阶段条「舱盖」与杂项同紫系，便于与移动/攻击区分 */
const PHASE_BTN_HATCH     = new Color(105,  96,  70, 240);
const PHASE_BTN_DISABLED  = new Color( 68,  68,  63, 210);

// 骰子托盘配色：未使用统一亮底 + 亮色提示；已使用统一灰底 + 灰色提示。
const DIE_FACE_FILL      = new Color(245, 245, 235, 255);
const DIE_FACE_USED_FILL = new Color(145, 145, 138, 235);
const DIE_FACE_BORDER    = new Color( 30,  30,  30, 255);
const DIE_FACE_SELECTED  = new Color(250, 215,  90, 255); // 当前选中的主炮骰高亮边框
const DIE_FACE_TEXT      = new Color( 20,  20,  20, 255);
const DIE_FACE_TEXT_USED = new Color( 60,  60,  60, 200);
// 动作提示分类色仍供动作菜单等细节使用；托盘未使用态统一用 DIE_HINT_ACTIVE。
const DIE_HINT_ACTIVE = new Color(235, 225, 190, 255);
const DIE_HINT_GREEN = new Color( 70, 180,  70, 255);
const DIE_HINT_RED   = new Color(220, 100,  80, 255);
const DIE_HINT_GREY  = new Color(130, 130, 130, 255);

// 驾驶候选格高亮：前进 = 亮绿，后退 = 琥珀（让玩家一眼区分两个方向）
const DRIVE_FWD_COLOR = new Color(120, 230, 120, 255);
const DRIVE_BWD_COLOR = new Color(240, 190,  80, 255);
const DRIVE_BLOCKED   = new Color(200,  80,  80, 200);

// 掷骰展示面板配色
const DICE_BACKDROP    = new Color(  0,   0,   0, 180);
const DICE_PANEL_BG    = DICE_EVENT_PANEL_BG;
const DICE_PANEL_BORDER= DICE_EVENT_PANEL_BORDER;
const DICE_DIE_FILL    = new Color(245, 245, 235, 255);
const DICE_DIE_BORDER  = new Color( 30,  30,  30, 255);
const DICE_DIE_TEXT    = new Color( 20,  20,  20, 255);
const DICE_OK_TEXT     = new Color(120, 230, 120, 255); // 命中 / 击穿
const DICE_FAIL_TEXT   = new Color(240, 120, 120, 255); // 未命中 / 跳弹
const DICE_INFO_TEXT   = new Color(220, 220, 220, 255);
const DICE_OUTCOME_HIT = new Color(255, 170,  40, 255); // 起火
const DICE_OUTCOME_KO  = new Color(255,  60,  60, 255); // 击毁
const DICE_OUTCOME_RIC = new Color(180, 200, 240, 255); // 跳弹
const DICE_OUTCOME_MISS= new Color(230, 230, 230, 255); // MISS
const DICE_OUTCOME_TURRET = new Color(230, 150,  80, 255); // 炮塔受损
const DICE_OUTCOME_PARAL  = new Color(200, 160, 240, 255); // 痛痪
const DICE_OUTCOME_CREW   = new Color(240, 220, 120, 255); // 阵亡检定
const DICE_OUTCOME_HURT   = new Color(240, 200, 100, 255); // 受损（德军首发）

// 谢尔曼状态面板配色
const STATUS_PANEL_BG     = new Color( 33,  38,  31, 235);
const STATUS_PANEL_BORDER = new Color(204, 190, 142, 230);
const STATUS_TITLE_COLOR  = new Color(235, 207, 142, 255);
const STATUS_LABEL_COLOR  = new Color(205, 202, 184, 255);
// 指示灯（值部分）：
//   正面 = 绿（装填 / 存活 / 完好）
//   警告 = 琥珀（舱盖开 = 暴露 / 起火）
//   负面 = 灰（未装填 / 舱盖关）或 红（阵亡 / 摧毁）
const STATUS_VALUE_OK     = new Color(120, 230, 120, 255);
const STATUS_VALUE_WARN   = new Color(255, 180,  60, 255);
const STATUS_VALUE_FIRE   = new Color(255, 120,  40, 255);
const STATUS_VALUE_DOWN   = new Color(130, 130, 130, 255);
const STATUS_VALUE_DEAD   = new Color(240,  90,  90, 255);

// 掷骰动画时序（秒）：数值可调。命中+击穿+伤害最长约 3.7s；未命中 / 跳弹会提前结束。
const DICE_HIT_ROLL_DUR   = 0.9;
const DICE_HIT_SHOW_DUR   = 0.6;
const DICE_PEN_ROLL_DUR   = 0.9;
const DICE_PEN_SHOW_DUR   = 0.6;
const DICE_DMG_ROLL_DUR   = 0.9;
const DICE_DMG_SHOW_DUR   = 0.6;
const DICE_CREW_ROLL_DUR  = 0.9;
const DICE_CREW_SHOW_DUR  = 0.7;
const DICE_HOLD_DUR       = 0.7;
/** 掷骰阶段内每颗骰子面切换频率 */
const DICE_CYCLE_INTERVAL = 0.06;

// 战斗视觉：起火（被命中 1 次）= 鲜橙底 + 亮黄边 + 双层火焰环；摧毁 = 暗灰 + 红 X
const ONFIRE_FILL      = new Color(255, 110,  30, 255);
const ONFIRE_BORDER    = new Color(255, 230,  60, 255);
const ONFIRE_RING_OUT  = new Color(255, 160,  40, 200);
const DESTROYED_FILL   = new Color( 60,  60,  60, 220);
const DESTROYED_BORDER = new Color(220,  40,  40, 255);
// 当回合击毁残骸旁短标签（仅「已毁」；起火等改由格子下矢量状态图标；下回合起不再绘制）
const STATUS_TEXT_DEAD = new Color(220,  60,  60, 255);
const STATUS_TEXT_OUT  = new Color(  0,   0,   0, 220);

/** 坦克格子下方状态图标（顺序：受损→烟雾→隐蔽→着火→瘫痪→炮塔） */
type TankStatusBadgeKind = 'damaged' | 'smoke' | 'hidden' | 'fire' | 'paralyzed' | 'turret';

const TANK_BADGE_CELL = 17;
const TANK_BADGE_GAP = 4;
const BADGE_BG = new Color(18, 20, 26, 235);
const BADGE_FRAME = new Color(0, 0, 0, 220);
// 单位名字标签：常驻显示在每个棋子正下方，方便玩家一眼识别兵种
/** 名字 Label 中心相对格心的 Y 偏移（向下为正方向用减法）：原为 1.3×hex，间距缩短 40% → 0.78×hex */
const UNIT_NAME_OFFSET_HEX = 1.3 * 0.6;
const UNIT_NAME_TEXT_PLAYER = new Color(184, 255, 200, 255);
const UNIT_NAME_TEXT_ALLIED = new Color(200, 230, 255, 255);
const UNIT_NAME_TEXT_GERMAN = new Color(255, 220, 200, 255);
const UNIT_NAME_TEXT_DEAD   = new Color(180, 180, 180, 220);
const UNIT_NAME_OUTLINE     = new Color(  0,   0,   0, 220);
// 可攻击目标（视线中、非摧毁敌方）高亮
const ATTACKABLE_COLOR = new Color(255,  60,  60, 255);

// 命中预览：按 2d6≥N 的成功概率分四档配色
const PREVIEW_COLOR_GREAT = new Color(120, 240, 120, 255); // ≥70%
const PREVIEW_COLOR_GOOD  = new Color(240, 220,  90, 255); // 40%~70%
const PREVIEW_COLOR_FAIR  = new Color(240, 160,  60, 255); // 20%~40%
const PREVIEW_COLOR_BAD   = new Color(240,  90,  90, 255); // <20%
// 黑色描边让浅色字在任意地形上都能看清
const PREVIEW_OUTLINE     = new Color(  0,   0,   0, 200);

/** 谢尔曼起始格「入场方向」箭头：深灰填充 + 深色描边，贴在车后一侧格边 */
const SPAWN_ENTRY_ARROW_FILL   = new Color(105, 110, 118, 255);
const SPAWN_ENTRY_ARROW_STROKE = new Color( 35,  38,  42, 230);

/** 撤离格箭头：与出生箭头同几何尺寸，沿 `evacExitDir` 指向网格外（与入场箭头指向格心相反） */
const EVAC_ARROW_FILL   = new Color(210,  55,  55, 255);
const EVAC_ARROW_STROKE = new Color(110,  20,  20, 240);

/** 军官（任务 8 红色边框建筑里的高级军官）：单位身周与所在格的红色高亮边框 */
const OFFICER_HALO_STROKE = new Color(220,  40,  40, 255);
const OFFICER_TILE_STROKE = new Color(220,  40,  40, 255);

/**
 * 2d6 之和 ≥ N 的精确概率（N 取 2..13；超出范围按边界处理）。
 * 36 种可能性下的累积分布，末位按百分比四舍五入展示。
 */
const HIT_PROB_GE: ReadonlyArray<number> = [
  /* 0 */ 1.000, 1.000,
  /* 2 */ 36 / 36,
  /* 3 */ 35 / 36,
  /* 4 */ 33 / 36,
  /* 5 */ 30 / 36,
  /* 6 */ 26 / 36,
  /* 7 */ 21 / 36,
  /* 8 */ 15 / 36,
  /* 9 */ 10 / 36,
  /* 10 */ 6 / 36,
  /* 11 */ 3 / 36,
  /* 12 */ 1 / 36,
  /* 13 */ 0,
];

/** 战斗模态内矩形按钮（与 MainMenuScene.makeRectButton 同构） */
interface BattleRectButtonRefs {
  node: Node;
  graphics: Graphics;
  label: Label | null;
  redraw: (color: Color, opts?: { border?: boolean }) => void;
}

@ccclass('BattleScene')
export class BattleScene extends Component {

  @property({ tooltip: '六角形单边长度（像素）。地图过大请调小，过小请调大。' })
  hexSize: number = 60;

  @property({ tooltip: '任务 JSON 在 resources/ 下的相对路径，无需扩展名。' })
  missionPath: string = 'missions/mission_01';

  @property({ tooltip: '点击"返回主菜单"跳转到的场景名（与 Build Settings 保持一致）' })
  mainMenuSceneName: string = 'main';

  @property({ tooltip: '是否在谢尔曼周围高亮可移动的相邻格' })
  showReachable: boolean = true;

  @property({ tooltip: '坦克移动一格 / 转向 60° 的过程动画时长（秒），敌我共用' })
  moveDuration: number = 0.5;

  @property({ tooltip: '【已废弃】敌方旧版贪心移动预算；GDD §3.7 骰子驱动 AI 已接管，保留仅为场景资源兼容' })
  movesPerTurn: number = 2;

  @property({ tooltip: '战斗随机种子；留 0 用时间种子，非 0 便于复现' })
  rngSeed: number = 0;

  private g: Graphics | null = null;
  private terrainLayerNode: Node | null = null;
  private mapNode: Node | null = null;
  private terrainSpriteFrames: Record<TerrainType, SpriteFrame | null> = {
    road: null,
    field: null,
    mud: null,
    forest: null,
    water: null,
    deep_water: null,
    clear: null,
    trees: null,
    beach: null,
    rocky: null,
    airstrip: null,
  };
  private terrainSpritePool: Array<{ node: Node; sprite: Sprite }> = [];
  private terrainSpritePoolNext = 0;
  private treeSpriteFrames: Array<SpriteFrame | null> = [null, null, null, null];
  private foliageSpritePool: Array<{ node: Node; sprite: Sprite }> = [];
  private foliageSpritePoolNext = 0;
  private shermanSpriteNode: Node | null = null;
  private shermanTopSprite: Sprite | null = null;
  private shermanTopSpriteFrame: SpriteFrame | null = null;
  private shermanTurretSpriteNode: Node | null = null;
  private shermanTurretTopSprite: Sprite | null = null;
  private shermanHullSpriteFrame: SpriteFrame | null = null;
  private shermanTurretSpriteFrame: SpriteFrame | null = null;
  private splitTankSprites: Partial<Record<SplitTankKind, SplitTankSpriteAssets>> = {};
  /** 加载时锁定的裁切显示宽高；避免每帧 `sprite.spriteFrame = sf` 后引擎改写 sf.width/height 导致宽高比崩（日志里 movement 阶段 th 被拉成与 tw 相等）。 */
  private shermanSpriteDisplayW = 0;
  private shermanSpriteDisplayH = 0;
  private shermanHullSpriteDisplayW = 0;
  private shermanHullSpriteDisplayH = 0;
  /** 德军俯视图（四号/三号/虎/卡）：多单位共用节点池；每帧 redraw 开头清零再按绘制顺序占用 */
  private enemyTopMeta: Partial<Record<EnemyTopKind, { sf: SpriteFrame; dw: number; dh: number }>> = {};
  private destroyedTopMeta: Partial<Record<DestroyedTopKind, { sf: SpriteFrame; dw: number; dh: number }>> = {};
  private enemyTopSpritePool: Array<{ node: Node; sprite: Sprite }> = [];
  private enemyTopPoolNext = 0;
  private static readonly ENEMY_TOP_SPRITE_POOL = 16;
  /**
   * 步兵 / 军官小队俯视图：每个徒步单位用 3 张 Infantry01~03.png 组成"3 人小队"。
   * 池大小 = 单位数上限 × 3；redraw 开头与坦克池一并清零。
   */
  private infantrySpriteFrames: Array<SpriteFrame | null> = [null, null, null];
  private infantrySpriteDims: Array<{ dw: number; dh: number }> = [
    { dw: 0, dh: 0 },
    { dw: 0, dh: 0 },
    { dw: 0, dh: 0 },
  ];
  private infantryTopSpritePool: Array<{ node: Node; sprite: Sprite }> = [];
  private infantryTopPoolNext = 0;
  private static readonly INFANTRY_SPRITES_PER_UNIT = 3;
  private static readonly INFANTRY_TOP_SPRITE_POOL = 36; // 12 个步兵 × 3 张图，留余量
  /** 军官（kind='officer'）单兵棋子：用 Officer.png 替代 3 人小队，大小同 Infantry01 主图 */
  private officerSpriteFrame: SpriteFrame | null = null;
  private officerSpriteDim: { dw: number; dh: number } = { dw: 0, dh: 0 };
  private officerTopSpritePool: Array<{ node: Node; sprite: Sprite }> = [];
  private officerTopPoolNext = 0;
  private static readonly OFFICER_TOP_SPRITE_POOL = 4;
  private mission: LoadedMission | null = null;
  private offsetX = 0;
  private offsetY = 0;
  private anim: MoveAnim | null = null;
  private turretAimAnim: TurretAimAnim | null = null;
  private shermanTurretFacing: Direction | null = null;
  private enemyTurretFacing = new Map<string, Direction>();
  /** 多段移动/转向衔接（如回合结束德军卡车沿路推进） */
  private animQueue: MoveAnim[] = [];
  /** 当前 animQueue 播完后执行（避免敌方阶段误进 runNextEnemyStep） */
  private pendingAfterAnimChain: (() => void) | null = null;

  /** 任务 JSON 谢尔曼出生格与出生朝向；用于在出生格上永久绘制从场外驶入的灰色箭头 */
  private shermanSpawnQr: { q: number; r: number } | null = null;
  private shermanSpawnFacing: Direction | null = null;

  // 回合状态
  private turn: number = 1;
  private phase: Phase = 'player';
  /** 玩家回合内的子状态机（见 PlayerStep 注释） */
  private playerStep: PlayerStep = 'choose';
  /** 本回合是否已经执行过移动阶段 / 攻击阶段 / 杂项阶段；
   * GDD §2.3：C 列（杂项）必须最后执行，所以 miscDone = true 时同样视为回合子阶段已终结。 */
  private movementDone: boolean = false;
  private attackDone: boolean = false;
  private miscDone: boolean = false;
  /** 当前子阶段（movement/attack）手上的骰子；回到 choose 时清空 */
  private phaseDice: DieSlot[] = [];
  private playerDiceRollAnim: {
    t: number;
    dur: number;
    finalPips: number[];
    logEntry: CombatLogI18nEntry;
  } | null = null;
  private playerDiceSortAnim: {
    t: number;
    dur: number;
    fromX: number[];
    toX: number[];
  } | null = null;
  /** 攻击阶段玩家点击某颗主炮骰 → 进入"选目标"态，这里记录那颗骰在 phaseDice 的下标。-1 = 未选 */
  private selectedGunDieIdx: number = -1;
  /**
   * 若当前主炮选择来自"对子 B 列（炮手主炮射击）"，partner 记录在此。
   * 开火结算时连带这颗也标记 used；-1 = 普通单骰主炮选择。
   */
  private selectedGunDoublesIdx: number = -1;
  /**
   * 攻击 mg（3/4）/ 杂项 codriver_mg（2）时玩家点中的机枪骰下标。-1 = 未选。
   * 机枪选中与主炮选中 *互斥* —— 任一进入选中态都会把另一方清零，避免玩家困惑"这颗骰到底选哪一发"。
   */
  private selectedMGDieIdx: number = -1;

  // 敌方阶段调度（GDD §3.7 AI 表骰子驱动版）
  /** 本回合按"距离谢尔曼最近→最远"排序后的活单位列表；beginEnemyPhase 时锁定一次 */
  private enemyOrder: Unit[] = [];
  /** enemyOrder 的下标指针 */
  private enemyIndex: number = 0;
  private aiSide: 'ally' | 'german' = 'german';
  /** 当前敌坦本回合掷出的一串 d6 点数 */
  private enemyDice: number[] = [];
  /** 与 enemyDice 同长度：每颗是否已消耗 */
  private enemyDiceUsed: boolean[] = [];
  /** 当前敌坦使用的 AI 列（road / field / mud / damaged），用于查表 */
  private enemyAICol: AIColumn = 'field';
  /** 迷你骰子托盘 UI 根节点；跟随当前敌坦位置，动画期间临时隐藏 */
  private enemyDiceTrayRoot: Node | null = null;
  private enemyDiceTrayLabels: Label[] = [];
  /** 与 labels 同序：迷你骰方块底图，便于改描边高亮当前执行骰 */
  private enemyDiceTrayTileGraphics: Graphics[] = [];
  /** 每颗骰一列根节点（含骰格 + 下方动作说明），便于排序动画改 x */
  private enemyDiceTrayDieRoots: Node[] = [];
  /** 与骰同序：下方「将执行动作」短文案 */
  private enemyDiceTraySubtitleLabels: Label[] = [];
  /** 当前托盘对应的敌坦（refresh 时重算每颗骰的可行动作文案） */
  private enemyDiceTraySubject: Unit | null = null;
  /** 布局参数：排序动画与 refresh 共用 */
  private enemyTrayMetrics: {
    dieSize: number;
    gap: number;
    totalW: number;
    count: number;
    rowY: number;
  } | null = null;
  /** 本回合当前敌坦骰子按点数升序（同点按原下标）的执行顺序 */
  private enemyDiceExecOrder: number[] = [];
  /** 非 null 表示正在播排序位移动画，播完后再 runNextEnemyStep */
  private enemyDiceSortAnim: {
    t: number;
    dur: number;
    fromSlot: number[];
    toSlot: number[];
  } | null = null;
  /** AI 骰结果无可执行动作时，保留高亮和点数一小段时间再推进下一颗骰 */
  private enemyNoActionHold: {
    t: number;
    dur: number;
    dieIdx: number;
  } | null = null;
  /** 敌方当前正在执行的那颗骰下标；-1 无高亮 */
  private enemyDiceHighlightIdx: number = -1;
  // 战斗 / 胜负
  private rng: RNG = new RNG(1);
  private outcome: MissionOutcome = 'ongoing';
  private outcomeLabel: Label | null = null;
  private restartBtn: Node | null = null;
  private backToMenuBtn: Node | null = null;
  // 战报浮字池：挂在 mapNode 下，随 update() 上浮 + 渐隐自毁
  private floaters: Floater[] = [];
  private muzzleFlashes: MuzzleFlash[] = [];
  // 命中预览 Label 池：常驻显示，随 redraw 整批重建
  private previewLabels: Node[] = [];
  // 单位状态文字池（仅已毁短标签）：随 redraw 整批重建
  private statusLabels: Node[] = [];
  /** 坦克状态图标条（矢量），在格心下方横向排列 */
  private statusBadgeNodes: Node[] = [];
  // 单位名字文字池（"谢尔曼" / "虎式" 等）：常驻显示，随 redraw 整批重建
  private nameLabels: Node[] = [];
  /**
   * 本战斗轮次内**刚被击毁**、应绘制残骸（灰圆+红叉）与「已毁」短标签的单位 id。
   * 在 `endEnemyPhase` 转入下一玩家回合时清空，即每回合①开始时清除上一轮留下的击毁标记。
   */
  private destroyWreckVisualIds = new Set<string>();

  // HUD
  /** 左上角最上行：任务 JSON `id` + 关卡名（`LevelDB.titleKey` 或 `MissionData.name`） */
  private missionTitleLabel: Label | null = null;
  private hudLabel: Label | null = null;
  /** 回合数下方：多行任务目标（与 `OBJECTIVE_HUD_MAX` 同序） */
  private objectiveHudLabels: Label[] = [];
  private static readonly OBJECTIVE_HUD_MAX = 6;
  private endTurnBtn: Node | null = null;
  private endTurnBg: Graphics | null = null;
  private endTurnLabel: Label | null = null;
  /** 底部"阶段选择"条：舱盖 + 移动 / 攻击；在 choose 子步骤可见，其他子步骤隐藏 */
  private chooseBar: Node | null = null;
  private chooseHatchBtn: Node | null = null;
  private chooseHatchLabel: Label | null = null;
  private chooseMoveBtn: Node | null = null;
  private chooseAttackBtn: Node | null = null;
  /** 底部骰子托盘：movement/attack 子步骤时显示 */
  private diceTrayRoot: Node | null = null;
  private diceVisuals: DieVisual[] = [];
  private diceTitleLabel: Label | null = null;
  /** 点击某颗骰子时弹出的动作菜单；每次弹出都重建 */
  private diePopover: Node | null = null;
  /** 攻击掷骰动画面板；非 null 时锁定所有输入 */
  private diceShow: DiceShow | null = null;
  /** 回合结束事件：主骰 →（若有）额外掷骰各一段动画 → 完整说明，确认后 apply */
  private turnEndEventUI: {
    root: Node;
    stage:
      | 'roll_primary'
      | 'wait_after_primary'
      | 'pause_before_adjacent_dice'
      | 'roll_extra'
      | 'wait_after_extra'
      | 'hold';
    t: number;
    dieLabels: Label[];
    primaryDice: number[];
    sumLabel: Label;
    bodyLabel: Label;
    bodyKey: string;
    bodyParams: Record<string, string | number>;
    /** 本行效果类型（本地化短名），写入战斗记录用 */
    effectName: string;
    apply: () => void;
    extraPhases: TurnEndExtraDicePhase[];
    extraIdx: number;
    extraSection: Node | null;
    extraCaptionLabel: Label | null;
    extraDieLabels: Label[];
    germanTruckMoveSegments?: GermanTruckMoveSegment[];
    /** 与 german_truck_move.escapeDrive 配对：仅在驶离动画的最后一移上判负 */
    germanTruckDefeatAfterExitMove?: boolean;
    tankReinforceMove?: TurnEndTankReinforceMove;
    /** 相邻步兵集火：主骰走后串联主炮同款 DiceShow，再显示正文与确认 */
    adjacentInfantryVolleys?: AdjacentInfantryVolleyPreview[];
  } | null = null;
  private turnEndUnitSeq = 0;
  /** §2.1 阶段⑤ 着火检定：播 d6 动画 + 说明，确认后写回状态再继续敌方阶段 */
  private fireCheckEventUI: {
    root: Node;
    stage: 'roll' | 'hold';
    t: number;
    dieLabels: Label[];
    allDice: number[];
    sumLabel: Label;
    bodyLabel: Label;
    introKey: string;
    introParams: Record<string, string | number>;
    bodyText: string;
    apply: () => void;
  } | null = null;
  private usCasualtyEventUI: {
    root: Node;
    stage: 'roll' | 'hold';
    t: number;
    dieLabels: Label[];
    dice: number[];
    providerLabel: Label;
    resultLabel: Label;
    hits: number;
    limit: number;
  } | null = null;

  // ---- 右侧谢尔曼状态面板 ----
  private statusPanel: Node | null = null;
  private statusLoaded: Label | null = null;   // 装填 / 未装填
  private statusFire: Label | null = null;     // 着火层数 / "-"（车体旧文案已迁出）
  private statusTurret: Label | null = null;   // 完好 / 受损
  private statusMobility: Label | null = null; // 正常 / 痛痪
  private statusCrewLabels: Label[] = [];      // 5 个乘员值标签（车长..副驾驶）
  /** 状态面板固定文案（切语言时刷新） */
  private statusPanelTitleLabel: Label | null = null;
  private statusBodyLeftLabels: Label[] = [];
  private statusCrewTitleLabel: Label | null = null;
  private statusCrewLeftLabels: Label[] = [];
  /** 底部阶段条按钮文字 */
  private chooseMoveLabel: Label | null = null;
  private chooseAttackLabel: Label | null = null;
  /** 胜负界「再来一局 / 返回主菜单」子 Label */
  private restartBtnLabel: Label | null = null;
  private backToMenuBtnLabel: Label | null = null;

  // 存档/读档
  private missionId: string = '';

  /** 战斗内模态（设置）；退出确认单独一层叠在上面 */
  private battleModalRoot: Node | null = null;
  private battleExitModalRoot: Node | null = null;
  /** 地图格子介绍（地形 / 骰子规则 / 单位状态） */
  private tileInspectModalRoot: Node | null = null;
  private tileInspectScroll: ScrollView | null = null;
  private tileInspectVBar: { g: Graphics; viewH: number; trackH: number } | null = null;
  private onTileInspectBarFrame: (() => void) | null = null;
  /** 存读档飘字：叠在所有模态之上，短显后自毁 */
  private battleSettingsToastRoot: Node | null = null;
  private battleSettingsRefs: {
    bgmFill: Graphics | null;
    bgmThumb: Node | null;
    bgmLabel: Label | null;
    sfxFill: Graphics | null;
    sfxThumb: Node | null;
    sfxLabel: Label | null;
    langZhBtn: BattleRectButtonRefs | null;
    langEnBtn: BattleRectButtonRefs | null;
  } | null = null;

  /** 左下角战斗详细记录（可滚动；点击放大，点遮罩外区域缩小） */
  private combatLogRoot: Node | null = null;
  private combatLogDimmer: Node | null = null;
  private combatLogPanel: Node | null = null;
  private combatLogPanelBg: Graphics | null = null;
  private combatLogScroll: ScrollView | null = null;
  private combatLogContent: Node | null = null;
  private combatLogLabel: Label | null = null;
  private combatLogViewN: Node | null = null;
  private combatLogTitleLab: Label | null = null;
  private combatLogLines: CombatLogEntry[] = [];
  private combatLogExpanded = false;
  private static readonly COMBAT_LOG_MAX = 500;
  private static readonly COMBAT_LOG_W0 = 260;
  private static readonly COMBAT_LOG_H0 = 190;
  private static readonly COMBAT_LOG_W1 = 620;
  private static readonly COMBAT_LOG_H1 = 500;
  private static readonly COMBAT_LOG_PAD = 8;
  private static readonly COMBAT_LOG_TITLE_H = 26;
  private static readonly COMBAT_LOG_BODY_FONT0 = 15;
  private static readonly COMBAT_LOG_BODY_LINE0 = 18;
  private static readonly COMBAT_LOG_BODY_FONT1 = 15;
  private static readonly COMBAT_LOG_BODY_LINE1 = 19;
  private static readonly COMBAT_LOG_BOTTOM_PAD = 10;
  /** 玩家骰子托盘单槽尺寸与间距（与 buildDiceTray / refreshDiceTray 共用） */
  private static readonly DICE_TRAY_SLOT = 72;
  private static readonly DICE_TRAY_GAP = 12;
  private static readonly EN_LABEL_AVG_CHAR_W = 0.56;
  private static readonly EN_LABEL_SAFE_PAD = 8;
  private static readonly PLAYER_DICE_SORT_DUR = 0.5;
  private static readonly TERRAIN_SPRITE_POOL = 384;
  private static readonly FOLIAGE_SPRITE_POOL = 256;
  private static readonly SHERMAN_TURRET_PIVOT_X = SHERMAN_SPLIT_GEOMETRY_CONFIG.pivot.bodyX;
  private static readonly SHERMAN_TURRET_PIVOT_Y = SHERMAN_SPLIT_GEOMETRY_CONFIG.pivot.bodyY;
  private static readonly SHERMAN_TURRET_OFFSET_FORWARD = SHERMAN_SPLIT_VISUAL_CONFIG.turretLocalOffsetForward;
  private static readonly SHERMAN_TURRET_OFFSET_RIGHT = SHERMAN_SPLIT_VISUAL_CONFIG.turretLocalOffsetRight;
  private static readonly SHERMAN_TOP_TRIM_X = SHERMAN_SPLIT_GEOMETRY_CONFIG.topTrim.x;
  private static readonly SHERMAN_TOP_TRIM_Y = SHERMAN_SPLIT_GEOMETRY_CONFIG.topTrim.y;
  private static readonly SHERMAN_TOP_TRIM_W = SHERMAN_SPLIT_GEOMETRY_CONFIG.topTrim.w;
  private static readonly SHERMAN_TOP_TRIM_H = SHERMAN_SPLIT_GEOMETRY_CONFIG.topTrim.h;
  private static readonly SHERMAN_TURRET_SPRITE_PIVOT_X = SHERMAN_SPLIT_GEOMETRY_CONFIG.pivot.spriteX;
  private static readonly SHERMAN_TURRET_SPRITE_PIVOT_Y = SHERMAN_SPLIT_GEOMETRY_CONFIG.pivot.spriteY;
  private static readonly SHERMAN_TURRET_TRIM_X = SHERMAN_SPLIT_GEOMETRY_CONFIG.turretTrim.x;
  private static readonly SHERMAN_TURRET_TRIM_Y = SHERMAN_SPLIT_GEOMETRY_CONFIG.turretTrim.y;
  private static readonly SHERMAN_TURRET_TRIM_W = SHERMAN_SPLIT_GEOMETRY_CONFIG.turretTrim.w;
  private static readonly SHERMAN_TURRET_TRIM_H = SHERMAN_SPLIT_GEOMETRY_CONFIG.turretTrim.h;
  private static readonly TIGER_TURRET_PIVOT_X = TIGER_SPLIT_GEOMETRY_CONFIG.pivot.bodyX;
  private static readonly TIGER_TURRET_PIVOT_Y = TIGER_SPLIT_GEOMETRY_CONFIG.pivot.bodyY;
  private static readonly TIGER_TURRET_SPRITE_PIVOT_X = TIGER_SPLIT_GEOMETRY_CONFIG.pivot.spriteX;
  private static readonly TIGER_TURRET_SPRITE_PIVOT_Y = TIGER_SPLIT_GEOMETRY_CONFIG.pivot.spriteY;
  private static readonly TIGER_TOP_TRIM_X = TIGER_SPLIT_GEOMETRY_CONFIG.topTrim.x;
  private static readonly TIGER_TOP_TRIM_Y = TIGER_SPLIT_GEOMETRY_CONFIG.topTrim.y;
  private static readonly TIGER_TOP_TRIM_W = TIGER_SPLIT_GEOMETRY_CONFIG.topTrim.w;
  private static readonly TIGER_TOP_TRIM_H = TIGER_SPLIT_GEOMETRY_CONFIG.topTrim.h;
  private static readonly TIGER_TURRET_TRIM_X = TIGER_SPLIT_GEOMETRY_CONFIG.turretTrim.x;
  private static readonly TIGER_TURRET_TRIM_Y = TIGER_SPLIT_GEOMETRY_CONFIG.turretTrim.y;
  private static readonly TIGER_TURRET_TRIM_W = TIGER_SPLIT_GEOMETRY_CONFIG.turretTrim.w;
  private static readonly TIGER_TURRET_TRIM_H = TIGER_SPLIT_GEOMETRY_CONFIG.turretTrim.h;
  private static readonly PANZER4_TURRET_PIVOT_X = PANZER4_SPLIT_GEOMETRY_CONFIG.pivot.bodyX;
  private static readonly PANZER4_TURRET_PIVOT_Y = PANZER4_SPLIT_GEOMETRY_CONFIG.pivot.bodyY;
  private static readonly PANZER4_TURRET_SPRITE_PIVOT_X = PANZER4_SPLIT_GEOMETRY_CONFIG.pivot.spriteX;
  private static readonly PANZER4_TURRET_SPRITE_PIVOT_Y = PANZER4_SPLIT_GEOMETRY_CONFIG.pivot.spriteY;
  private static readonly PANZER4_TOP_TRIM_X = PANZER4_SPLIT_GEOMETRY_CONFIG.topTrim.x;
  private static readonly PANZER4_TOP_TRIM_Y = PANZER4_SPLIT_GEOMETRY_CONFIG.topTrim.y;
  private static readonly PANZER4_TOP_TRIM_W = PANZER4_SPLIT_GEOMETRY_CONFIG.topTrim.w;
  private static readonly PANZER4_TOP_TRIM_H = PANZER4_SPLIT_GEOMETRY_CONFIG.topTrim.h;
  private static readonly PANZER4_TURRET_TRIM_X = PANZER4_SPLIT_GEOMETRY_CONFIG.turretTrim.x;
  private static readonly PANZER4_TURRET_TRIM_Y = PANZER4_SPLIT_GEOMETRY_CONFIG.turretTrim.y;
  private static readonly PANZER4_TURRET_TRIM_W = PANZER4_SPLIT_GEOMETRY_CONFIG.turretTrim.w;
  private static readonly PANZER4_TURRET_TRIM_H = PANZER4_SPLIT_GEOMETRY_CONFIG.turretTrim.h;
  private static readonly PANZER3_TURRET_PIVOT_X = PANZER3_SPLIT_GEOMETRY_CONFIG.pivot.bodyX;
  private static readonly PANZER3_TURRET_PIVOT_Y = PANZER3_SPLIT_GEOMETRY_CONFIG.pivot.bodyY;
  private static readonly PANZER3_TURRET_SPRITE_PIVOT_X = PANZER3_SPLIT_GEOMETRY_CONFIG.pivot.spriteX;
  private static readonly PANZER3_TURRET_SPRITE_PIVOT_Y = PANZER3_SPLIT_GEOMETRY_CONFIG.pivot.spriteY;
  private static readonly PANZER3_TOP_TRIM_X = PANZER3_SPLIT_GEOMETRY_CONFIG.topTrim.x;
  private static readonly PANZER3_TOP_TRIM_Y = PANZER3_SPLIT_GEOMETRY_CONFIG.topTrim.y;
  private static readonly PANZER3_TOP_TRIM_W = PANZER3_SPLIT_GEOMETRY_CONFIG.topTrim.w;
  private static readonly PANZER3_TOP_TRIM_H = PANZER3_SPLIT_GEOMETRY_CONFIG.topTrim.h;
  private static readonly PANZER3_TURRET_TRIM_X = PANZER3_SPLIT_GEOMETRY_CONFIG.turretTrim.x;
  private static readonly PANZER3_TURRET_TRIM_Y = PANZER3_SPLIT_GEOMETRY_CONFIG.turretTrim.y;
  private static readonly PANZER3_TURRET_TRIM_W = PANZER3_SPLIT_GEOMETRY_CONFIG.turretTrim.w;
  private static readonly PANZER3_TURRET_TRIM_H = PANZER3_SPLIT_GEOMETRY_CONFIG.turretTrim.h;

  private loadSpriteFrame(path: string, warnMessage: string, onLoaded: (sf: SpriteFrame, dw: number, dh: number) => void) {
    if (!path) return;
    resources.load(path, SpriteFrame, (err, sf) => {
      if (err || !sf) {
        console.warn(warnMessage, err);
        return;
      }
      const rw = sf.rect.width;
      const rh = sf.rect.height;
      onLoaded(sf, rw > 0 ? rw : sf.width, rh > 0 ? rh : sf.height);
      this.redraw();
    });
  }

  private ensureSplitTankSprites(kind: SplitTankKind): SplitTankSpriteAssets {
    const existing = this.splitTankSprites[kind];
    if (existing) return existing;
    const created = { hull: null, turret: null, hullDisplayW: 0, hullDisplayH: 0 };
    this.splitTankSprites[kind] = created;
    return created;
  }

  private loadTankVisualSprites() {
    TANK_VISUAL_KINDS.forEach((kind: TankVisualKind) => {
      const assets = tankVisualAssetConfigOf(kind);
      this.loadSpriteFrame(
        assets.topSpritePath,
        `[BattleScene] 俯视图加载失败 (${kind})，该类型将回退矢量车体:`,
        (sf, dw, dh) => {
          this.enemyTopMeta[kind] = { sf, dw, dh };
          if (kind === 'sherman') {
            this.shermanSpriteDisplayW = dw;
            this.shermanSpriteDisplayH = dh;
            this.shermanTopSpriteFrame = sf;
            if (this.shermanTopSprite) this.shermanTopSprite.spriteFrame = sf;
          }
        },
      );

      this.loadSpriteFrame(
        assets.destroyedSpritePath,
        `[BattleScene] destroyed tank sprite load failed (${kind}); fallback to vector wreck:`,
        (sf, dw, dh) => {
          this.destroyedTopMeta[kind] = { sf, dw, dh };
        },
      );

      if (!isSplitTankKind(kind)) return;
      const split = this.ensureSplitTankSprites(kind);
      this.loadSpriteFrame(
        assets.hullSpritePath,
        `[BattleScene] ${kind} hull split sprite load failed; fallback to top sprite:`,
        (sf, dw, dh) => {
          split.hull = sf;
          split.hullDisplayW = dw;
          split.hullDisplayH = dh;
          if (kind === 'sherman') {
            this.shermanHullSpriteFrame = sf;
            this.shermanHullSpriteDisplayW = dw;
            this.shermanHullSpriteDisplayH = dh;
          }
        },
      );
      this.loadSpriteFrame(
        assets.turretSpritePath,
        `[BattleScene] ${kind} turret split sprite load failed; fallback to top sprite:`,
        (sf) => {
          split.turret = sf;
          if (kind === 'sherman') {
            this.shermanTurretSpriteFrame = sf;
            if (this.shermanTurretTopSprite) this.shermanTurretTopSprite.spriteFrame = sf;
          }
        },
      );
    });
  }

  onLoad() {
    setLang(MenuProgress.load().lang);
    initGameAudio();
    stopBgm();
    playBgmBattle();
    this.buildMainMenuStyleBattleBackground();
    const terrainNode = new Node('TerrainSprites');
    terrainNode.layer = this.node.layer;
    terrainNode.addComponent(UITransform).setContentSize(1280, 720);
    this.node.addChild(terrainNode);
    this.terrainLayerNode = terrainNode;
    for (let i = 0; i < BattleScene.TERRAIN_SPRITE_POOL; i++) {
      const n = new Node(`TerrainTile_${i}`);
      n.layer = this.node.layer;
      n.addComponent(UITransform).setContentSize(1, 1);
      const sp = n.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      n.active = false;
      this.terrainSpritePool.push({ node: n, sprite: sp });
      terrainNode.addChild(n);
    }
    // 自动创建子 Graphics 节点，免去编辑器手动配置
    const gNode = new Node('MapGraphics');
    // UI Graphics 必须在 UI_2D 层才会被 Canvas 的 UI 相机渲染。
    // new Node() 默认 layer 是 DEFAULT (1<<30)，会被 UI 相机过滤掉。
    gNode.layer = this.node.layer;
    const ut = gNode.addComponent(UITransform);
    ut.setContentSize(1280, 720);
    this.g = gNode.addComponent(Graphics);
    this.g.lineWidth = 2;
    this.node.addChild(gNode);
    this.mapNode = gNode;

    for (let i = 0; i < BattleScene.FOLIAGE_SPRITE_POOL; i++) {
      const h = new Node(`Foliage_${i}`);
      h.layer = this.node.layer;
      h.addComponent(UITransform).setContentSize(1, 1);
      const sp = h.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      h.active = false;
      this.foliageSpritePool.push({ node: h, sprite: sp });
      gNode.addChild(h);
    }

    // 谢尔曼俯视图：子节点在父节点 MapGraphics 的 Graphics 之后绘制 → 叠在地形之上。
    const shNode = new Node('ShermanTopSprite');
    shNode.layer = this.node.layer;
    shNode.addComponent(UITransform).setContentSize(1280, 720);
    this.shermanTopSprite = shNode.addComponent(Sprite);
    // CUSTOM：用 UITransform 定最终像素边长，避免 TRIMMED + setScale 与 1280×720 占位在 UI 刷新时叠出异常缩放
    this.shermanTopSprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.shermanSpriteNode = shNode;
    shNode.active = false;

    gNode.addChild(shNode);

    const shTurretNode = new Node('ShermanTurretTopSprite');
    shTurretNode.layer = this.node.layer;
    shTurretNode.addComponent(UITransform).setContentSize(1280, 720);
    this.shermanTurretTopSprite = shTurretNode.addComponent(Sprite);
    this.shermanTurretTopSprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.shermanTurretSpriteNode = shTurretNode;
    shTurretNode.active = false;
    gNode.addChild(shTurretNode);

    for (let i = 0; i < BattleScene.ENEMY_TOP_SPRITE_POOL; i++) {
      const pz = new Node(`EnemyTop_${i}`);
      pz.layer = this.node.layer;
      pz.addComponent(UITransform).setContentSize(1280, 720);
      const spz = pz.addComponent(Sprite);
      spz.sizeMode = Sprite.SizeMode.CUSTOM;
      pz.active = false;
      this.enemyTopSpritePool.push({ node: pz, sprite: spz });
      gNode.addChild(pz);
    }
    // 步兵 3 人小队：每帧 redraw 时按需占用，单位摧毁 / 不存在时关闭即可
    for (let i = 0; i < BattleScene.INFANTRY_TOP_SPRITE_POOL; i++) {
      const inf = new Node(`InfantryTop_${i}`);
      inf.layer = this.node.layer;
      inf.addComponent(UITransform).setContentSize(1280, 720);
      const spi = inf.addComponent(Sprite);
      spi.sizeMode = Sprite.SizeMode.CUSTOM;
      inf.active = false;
      this.infantryTopSpritePool.push({ node: inf, sprite: spi });
      gNode.addChild(inf);
    }
    // 军官单兵棋子（独立池，与 3 人小队互斥；同一格不会同时出现两类徒步单位）
    for (let i = 0; i < BattleScene.OFFICER_TOP_SPRITE_POOL; i++) {
      const ofN = new Node(`OfficerTop_${i}`);
      ofN.layer = this.node.layer;
      ofN.addComponent(UITransform).setContentSize(1280, 720);
      const ofS = ofN.addComponent(Sprite);
      ofS.sizeMode = Sprite.SizeMode.CUSTOM;
      ofN.active = false;
      this.officerTopSpritePool.push({ node: ofN, sprite: ofS });
      gNode.addChild(ofN);
    }

    this.loadTankVisualSprites();

    const infantryPaths = [
      'textures/units/Infantry01/spriteFrame',
      'textures/units/Infantry02/spriteFrame',
      'textures/units/Infantry03/spriteFrame',
    ];
    for (let i = 0; i < infantryPaths.length; i++) {
      const idx = i;
      resources.load(infantryPaths[idx], SpriteFrame, (err, sf) => {
        if (err || !sf) {
          console.warn(`[BattleScene] 步兵图加载失败 (Infantry0${idx + 1})，该单位将回退矢量小人:`, err);
          return;
        }
        const rw = sf.rect.width;
        const rh = sf.rect.height;
        this.infantrySpriteFrames[idx] = sf;
        this.infantrySpriteDims[idx] = {
          dw: rw > 0 ? rw : sf.width,
          dh: rh > 0 ? rh : sf.height,
        };
        this.redraw();
      });
    }

    // 军官棋子单张：未加载完成时 drawInfantry 在 officer 分支也会回退到矢量小人
    resources.load('textures/units/Officer/spriteFrame', SpriteFrame, (err, sf) => {
      if (err || !sf) {
        console.warn('[BattleScene] 军官图加载失败，将回退矢量小人:', err);
        return;
      }
      const rw = sf.rect.width;
      const rh = sf.rect.height;
      this.officerSpriteFrame = sf;
      this.officerSpriteDim = {
        dw: rw > 0 ? rw : sf.width,
        dh: rh > 0 ? rh : sf.height,
      };
      this.redraw();
    });

    ['tree_01', 'tree_02', 'tree_03', 'tree_04'].forEach((name, idx) => {
      resources.load(`textures/terrain/${name}/spriteFrame`, SpriteFrame, (err, sf) => {
        if (err || !sf) {
          console.warn(`[BattleScene] tree sprite load failed (${name}), fallback to Graphics:`, err);
          return;
        }
        this.treeSpriteFrames[idx] = sf;
        this.redraw();
      });
    });

    // 3.x 动态加载 SpriteFrame 必须指向图片子资源路径 …/spriteFrame（见官方「动态加载资源」）
    const terrainPaths: Partial<Record<TerrainType, string>> = {
      road: 'textures/terrain/terrain_road/spriteFrame',
      field: 'textures/terrain/terrain_field/spriteFrame',
      mud: 'textures/terrain/terrain_mud/spriteFrame',
      forest: 'textures/terrain/terrain_forest/spriteFrame',
      water: 'textures/terrain/terrain_water/spriteFrame',
      clear: 'textures/terrain/pacific_sand/spriteFrame',
      airstrip: 'textures/terrain/pacific_sand/spriteFrame',
      trees: 'textures/terrain/pacific_trees/spriteFrame',
      beach: 'textures/terrain/pacific_water/spriteFrame',
      rocky: 'textures/terrain/pacific_rocks/spriteFrame',
    };
    (Object.keys(terrainPaths) as TerrainType[]).forEach((terrain) => {
      resources.load(terrainPaths[terrain]!, SpriteFrame, (err, sf) => {
        if (err || !sf) {
          console.warn(`[BattleScene] terrain sprite load failed (${terrain}), fallback to Graphics:`, err);
          return;
        }
        this.terrainSpriteFrames[terrain] = sf;
        this.redraw();
      });
    });

    // 注册触摸事件（点击地图任意位置）
    gNode.on(Node.EventType.TOUCH_END, this.onTouchMap, this);

    // HUD：回合数 + 阶段信息 + 下一阶段按钮
    this.buildHUD();
    // 底部阶段选择条 + 骰子托盘（空的，交给 refreshPhaseUI 根据状态切换可见性）
    this.buildChooseBar();
    this.buildDiceTray();
    this.buildCombatLog();

    // 主菜单选关时会写入 GameSession.selectedMissionPath；绕过菜单直接启动场景
    // 也安全（GameSession 默认值 = 'missions/mission_01'，与本脚本 @property 默认一致）。
    if (GameSession.selectedMissionPath) {
      this.missionPath = GameSession.selectedMissionPath;
    }

    // 从 resources/ 加载任务 JSON（注意：路径不含扩展名）
    resources.load(this.missionPath, JsonAsset, (err, asset) => {
      if (err || !asset) {
        console.error('[BattleScene] 加载任务失败:', this.missionPath, err);
        return;
      }
      this.loadAndDraw(asset.json as MissionData);
      // 主菜单"继续游戏"入口：任务加载完成后立刻读档覆盖，随后清掉 resume 标志
      // 避免下次"再来一局"又被读回旧存档。
      if (GameSession.resumeFromSave) {
        this.onLoad_Save(/* skipHint */ true);
        GameSession.clearResumeFlag();
      }
    });
  }

  // ---------- 状态 ----------

  private loadAndDraw(data: MissionData) {
    this.missionId = data.id;
    this.rng = new RNG(this.rngSeed || undefined);
    this.mission = loadMission(data, this.rng);
    const { sherman: sh0 } = this.mission;
    this.shermanSpawnQr = { q: sh0.pos.q, r: sh0.pos.r };
    this.shermanSpawnFacing = sh0.facing;
    const tiles = this.mission.map.all();

    // 计算地图像素包围盒，用于居中
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of tiles) {
      const p = axialToPixel(t.pos, this.hexSize);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    this.offsetX = -(minX + maxX) / 2;
    // Cocos Y 朝上，但我们希望 row 0 在屏幕顶部 → Y 取负
    this.offsetY = (minY + maxY) / 2 + BOARD_CENTER_OFFSET_Y;

    // 初始化回合状态
    this.turn = 1;
    this.phase = 'player';
    this.playerStep = 'choose';
    this.movementDone = false;
    this.attackDone = false;
    this.miscDone = false;
    this.playerDiceRollAnim = null;
    this.playerDiceSortAnim = null;
    this.phaseDice = [];
    this.clearGunSelection();
    this.outcome = 'ongoing';
    this.clearFloaters();
    this.clearMuzzleFlashes();
    this.clearDestroyWreckVisuals();
    this.closeDiePopover();
    this.finalizeDiceShow(true);
    this.destroyTurnEndEventUI();
    this.destroyFireCheckEventUI();
    this.destroyUsCasualtyEventUI();
    this.closeTileInspectModal();
    this.turnEndUnitSeq = 0;
    this.refreshPhaseUI();
    this.updateHUD();
    this.updateOutcomeOverlay();

    this.redraw();
    const levelMeta = findLevelByMissionId(data.id);
    this.battleLogI18n('battleLog.missionLoaded', {
      name: data.name,
      nameKey: levelMeta?.titleKey ?? '',
      tiles: tiles.length,
      allies: this.mission.allies.length,
      enemies: this.mission.enemies.length,
    });
    this.beginPlayerPhaseForNewTurn();
  }

  private project(q: number, r: number) {
    const p = axialToPixel({ q, r }, this.hexSize);
    return { x: p.x + this.offsetX, y: -p.y + this.offsetY };
  }

  // ---------- 绘制 ----------

  private redraw() {
    if (!this.g || !this.mission) return;
    const g = this.g;
    g.clear();
    this.terrainSpritePoolNext = 0;
    for (const { node } of this.terrainSpritePool) node.active = false;
    this.foliageSpritePoolNext = 0;
    for (const { node } of this.foliageSpritePool) node.active = false;
    this.enemyTopPoolNext = 0;
    for (const { node } of this.enemyTopSpritePool) node.active = false;
    if (this.shermanSpriteNode) this.shermanSpriteNode.active = false;
    if (this.shermanTurretSpriteNode) this.shermanTurretSpriteNode.active = false;
    this.infantryTopPoolNext = 0;
    for (const { node } of this.infantryTopSpritePool) node.active = false;
    this.officerTopPoolNext = 0;
    for (const { node } of this.officerTopSpritePool) node.active = false;
    // 命中预览 Label 是常驻节点（非纯 Graphics），需要随每次重绘整批重建，
    // 否则谢尔曼移动后旧位置的预览会留在屏幕上误导玩家。
    this.clearPreviewLabels();

    // 右侧状态面板同步。redraw 是唯一"真相源"：任何动作（移动/转向/装填/
    // 开舱盖/命中/摧毁）走到 redraw 前，相关状态字段都已落位。
    this.refreshStatusPanel();

    const { map, sherman, enemies } = this.mission;
    const tiles = map.all();

    // 1. 地形格：分两遍绘制，避免「每格 fill+stroke 紧挨」时邻格 fill 盖住共享边上的描边
    //    （同色草地会整片「熔合」、看起来像格线突然没了；掷骰后 redraw 变多更明显）。
    const spriteBackedTileKeys = new Set<string>();
    for (const t of tiles) {
      const c = this.project(t.pos.q, t.pos.r);
      if (this.drawTerrainTileSprite(c.x, c.y, this.hexSize, t.terrain)) {
        spriteBackedTileKeys.add(`${t.pos.q},${t.pos.r}`);
        continue;
      }
      if (t.terrain === 'field') {
        this.drawHexFill(c.x, c.y, this.hexSize, TERRAIN_COLORS.field);
        this.drawFieldBrushOverlay(c.x, c.y, this.hexSize, t);
        continue;
      }
      if (t.terrain === 'airstrip') {
        this.drawHexFill(c.x, c.y, this.hexSize, TERRAIN_COLORS.clear);
        continue;
      }
      this.drawHexFill(c.x, c.y, this.hexSize, TERRAIN_COLORS[t.terrain]);
    }
    g.lineWidth = 2;
    g.strokeColor = TILE_BORDER;
    for (const t of tiles) {
      if (spriteBackedTileKeys.has(`${t.pos.q},${t.pos.r}`)) continue;
      if (t.terrain === 'deep_water') continue;
      const c = this.project(t.pos.q, t.pos.r);
      this.drawTileBorder(c.x, c.y, this.hexSize, t, map);
    }

    for (const t of tiles) {
      if (t.terrain !== 'deep_water') continue;
      const c = this.project(t.pos.q, t.pos.r);
      this.drawDeepWaterOverlay(c.x, c.y, this.hexSize, t);
    }

    // 1-bank. 水陆河岸：仅在水域格内、沿"非水域邻格"方向画沙色内偏移条带，模拟河 / 湖岸过渡。
    // 桥梁水格也保留岸线，随后 drawBridgeOverlay 会把桥面压在其上；邻居为水或地图外则跳过。
    for (const t of tiles) {
      if (t.terrain !== 'water') continue;
      const c = this.project(t.pos.q, t.pos.r);
      this.drawWaterBankOverlay(c.x, c.y, this.hexSize, t, map);
    }

    // 1-mud. 泥地纹理：在 mud 基底色之上叠"软斑 + 沙土颗粒"两层。
    // 所有斑块按 axial 种子稳定（同格永不抖动），不影响其它地形。
    for (const t of tiles) {
      if (t.terrain !== 'mud') continue;
      if (this.terrainSpriteFrames.mud) continue;
      const c = this.project(t.pos.q, t.pos.r);
      this.drawMudOverlay(c.x, c.y, this.hexSize, t);
    }

    // 1-road-hex. 公路格纹理：在 road 基底色之上叠"软斑 + 路面碎屑颗粒"两层（与泥地同算法、不同色板）。
    // 让 road 格的非条带部分也有路面感，避免整片纯色像塑料。drawRoadOverlay 的方向条带叠在其上。
    for (const t of tiles) {
      if (t.terrain !== 'road') continue;
      if (this.terrainSpriteFrames.road) continue;
      const c = this.project(t.pos.q, t.pos.r);
      this.drawRoadHexOverlay(c.x, c.y, this.hexSize, t);
    }

    // 1a. 林地表冠层：示意树木（在基底之上、建筑/树篱之前）
    for (const t of tiles) {
      if (t.terrain !== 'forest') continue;
      const c = this.project(t.pos.q, t.pos.r);
      this.drawForestCanopy(c.x, c.y, this.hexSize, t);
    }

    // 1a-bridge. 桥梁叠加（GDD §3.2，仅水域格 + bridgeEnds）：在水面上画一条贯通两端的木桥
    for (const t of tiles) {
      if (!tileHasBridge(t)) continue;
      const c = this.project(t.pos.q, t.pos.r);
      this.drawBridgeOverlay(c.x, c.y, this.hexSize, t.bridgeEnds!);
    }

    // 1a-road. 公路条带：按 `Tile.roads` 方向位绘制；单方向时格心叠绘"道路尽头"圆形（说明书图例）。
    // 在建筑之前画，避免村庄房屋被路压到；与树篱互不干扰（树篱画在格边外缘，路画在格内）。
    for (const t of tiles) {
      if (!t.roads) continue;
      const c = this.project(t.pos.q, t.pos.r);
      if (t.terrain === 'airstrip') {
        this.drawAirstripOverlay(c.x, c.y, this.hexSize, t.roads, t);
      } else {
        this.drawRoadOverlay(c.x, c.y, this.hexSize, t.roads, t);
      }
    }

    // 1b. 建筑图案（不改变基底地形色，仅格内若干个矢量俯视方屋；公路格自动避开路面）
    for (const t of tiles) {
      if (!t.hasBuilding) continue;
      const c = this.project(t.pos.q, t.pos.r);
      this.drawBuildingOverlay(c.x, c.y, this.hexSize, t);
    }

    // 2. 树篱（`Tile.hedges` 为轴向 0..5；`drawHedgeEdge` 的边号见 `HEDGE_DRAW_EDGE_BY_AXIAL`）
    const hedgeTreeKeys = new Set<string>();
    for (const t of tiles) {
      if (!t.hedges) continue;
      const c = this.project(t.pos.q, t.pos.r);
      for (let ax = 0; ax < 6; ax++) {
        if (t.hedges[ax]) {
          this.drawHedgeEdgeTrees(c.x, c.y, this.hexSize, HEDGE_DRAW_EDGE_BY_AXIAL[ax], t.pos.q, t.pos.r, hedgeTreeKeys);
        }
      }
    }

    // 2b. Pacific 防波堤：沿格边绘制石块，规则层由 HexMap.canTankCrossEdge 判定。
    const breakwaterKeys = new Set<string>();
    for (const t of tiles) {
      if (!t.breakwaters) continue;
      const c = this.project(t.pos.q, t.pos.r);
      for (let ax = 0; ax < 6; ax++) {
        if (t.breakwaters[ax]) {
          this.drawBreakwaterEdge(c.x, c.y, this.hexSize, HEDGE_DRAW_EDGE_BY_AXIAL[ax], t.pos.q, t.pos.r, breakwaterKeys);
        }
      }
    }

    // 3. 驾驶候选格高亮：仅"移动阶段"+ 未在动画 + 胜负未决；两格方向分色
    if (this.showReachable && !this.anim
        && this.phase === 'player' && this.playerStep === 'movement'
        && this.outcome === 'ongoing') {
      this.drawDriveCandidates();
    }

    // 4. 可攻击目标高亮：仅"攻击阶段 / 杂项阶段 + 已选中主炮骰"时展示
    //    —— 避免玩家在装填未做/未选骰时被红圈误导以为能直接点敌人开火
    if (!this.anim && this.phase === 'player'
        && (this.playerStep === 'attack' || this.playerStep === 'misc')
        && this.selectedGunDieIdx >= 0
        && this.outcome === 'ongoing') {
      this.drawAttackableHighlights();
    }
    // 4b. 机枪目标高亮：选中机枪骰时，把 canMGAttack 认可的步兵圈出来
    if (!this.anim && this.phase === 'player'
        && (this.playerStep === 'attack' || this.playerStep === 'misc')
        && this.selectedMGDieIdx >= 0
        && this.outcome === 'ongoing') {
      this.drawMGTargetHighlights();
    }

    // 4c. 谢尔曼出生格入场箭头（固定画在 JSON 出生格，谢尔曼离开后仍保留；在机体之下绘制）
    this.drawShermanSpawnEntryArrow();
    // 4d. destroy_kind_evac：撤离格红色箭头（与出生箭头同尺度，方向指向网格外）
    this.drawEvacExitArrow();
    // 4e. 军官单位（任务 8 红框建筑里的高级军官，kind='officer'）：在所在格绘制红色 hex 边框
    this.drawOfficerTileHighlights();

    // 5. 单位 —— 残骸先画，活动单位后画；同格时残骸不遮挡活动坦克。
    const units: Unit[] = [sherman, ...this.mission.allies, ...enemies];
    for (const u of units) {
      if (u.destroyed) this.drawUnitMaybeAnim(u);
    }
    for (const u of units) {
      if (!u.destroyed) this.drawUnitMaybeAnim(u);
    }

    // 6. 单位状态：本回合击毁的「已毁」短标签 + 坦克矢量状态图标条
    this.clearStatusLabels();
    this.spawnStatusLabelIfAny(sherman);
    for (const a of this.mission.allies) this.spawnStatusLabelIfAny(a);
    for (const e of enemies) this.spawnStatusLabelIfAny(e);
    this.clearStatusBadges();
    this.spawnStatusBadgesIfAny(sherman);
    for (const a of this.mission.allies) this.spawnStatusBadgesIfAny(a);
    for (const e of enemies) this.spawnStatusBadgesIfAny(e);

    // 7. 单位名字常驻文字（"谢尔曼" / "虎式" …），残骸名先画，活动单位名后画。
    this.clearNameLabels();
    for (const u of units) {
      if (u.destroyed) this.spawnUnitNameLabel(u);
    }
    for (const u of units) {
      if (!u.destroyed) this.spawnUnitNameLabel(u);
    }

    // 8. 任务目标进度（击毁计数等）随地图状态变，与 redraw 同步以免 HUD 漏刷
    this.refreshObjectiveHud();
  }

  private drawAttackableHighlights() {
    if (!this.g || !this.mission) return;
    const { map, sherman, enemies } = this.mission;
    for (const e of enemies) {
      if (e.destroyed) continue;
      // 主炮不瞄徒步类（步兵 / 军官）：徒步单位专属机枪（§3.1.2 / §3.6），避免大红圈误导
      if (isFootUnit(e)) continue;
      const ctx = { attacker: sherman, target: e, map, theater: this.mission.data.theater };
      if (!canAttack(ctx).ok) continue;

      const c = this.project(e.pos.q, e.pos.r);
      this.g.strokeColor = ATTACKABLE_COLOR;
      this.g.lineWidth = 3;
      this.drawHexOutline(c.x, c.y, this.hexSize - 3);

      // 命中预览：≥需要值 + 命中概率
      const need = hitThreshold(ctx);
      this.spawnPreviewLabel(c.x, c.y - this.hexSize * 0.7, need);
    }
    this.g.lineWidth = 2;
  }

  /**
   * 机枪目标高亮：与 drawAttackableHighlights 并列。
   * 仅把 canMGAttack 认可且未被摧毁的步兵圈出来，并在格上方标动态命中需求与 1d6 概率。
   */
  private drawMGTargetHighlights() {
    if (!this.g || !this.mission) return;
    const { map, sherman, enemies } = this.mission;
    const units = this.allUnits();
    for (const e of enemies) {
      if (e.destroyed) continue;
      const ctx = { attacker: sherman, target: e, map, theater: this.mission.data.theater, units };
      if (!canMGAttack(ctx).ok) continue;

      const c = this.project(e.pos.q, e.pos.r);
      this.g.strokeColor = ATTACKABLE_COLOR;
      this.g.lineWidth = 3;
      this.drawHexOutline(c.x, c.y, this.hexSize - 3);
      const maxRoll = maxMGHitRoll(ctx);
      const need = mgHitThreshold(ctx);
      const prob = maxRoll <= 7
        ? Math.max(0, Math.min(1, (maxRoll + 1 - need) / 6))
        : undefined;
      this.spawnPreviewLabel(c.x, c.y - this.hexSize * 0.7, need, prob);
    }
    this.g.lineWidth = 2;
  }

  /**
   * 在谢尔曼**出生格**绘制灰色小箭头：贴在「车尾所对」那一侧格边中点附近，
   * 指向格心，暗示单位从地图外沿该边进入、JSON 中的 `facing` 为炮口朝向。
   * 谢尔曼离开后仍保留在出生格上，作为场景提示。
   */
  private drawShermanSpawnEntryArrow() {
    if (!this.g || !this.mission || !this.shermanSpawnQr || this.shermanSpawnFacing === null) return;

    const g = this.g;
    const spawn = this.shermanSpawnQr;
    const entryFrom = rotateDirection(this.shermanSpawnFacing, 3);
    const c = this.project(spawn.q, spawn.r);
    const nb = neighbor(spawn, entryFrom);
    const nc = this.project(nb.q, nb.r);
    const mx = (c.x + nc.x) * 0.5;
    const my = (c.y + nc.y) * 0.5;
    let ix = c.x - mx;
    let iy = c.y - my;
    const ilen = Math.hypot(ix, iy);
    if (ilen < 1e-6) return;
    ix /= ilen;
    iy /= ilen;
    const tx = -iy;
    const ty = ix;

    const s = this.hexSize;
    /** 整体放大 50%；随后仅加宽箭头（垂直于箭轴），箭轴方向长度保持本组数值不变 */
    const lenScale = 1.5;
    const stemLen = s * 0.07 * lenScale;
    const headLen = s * 0.13 * lenScale;
    const headHalfW = s * 0.11 * lenScale * 2;
    const sink = headLen * 0.32;

    const sx = mx + ix * stemLen;
    const sy = my + iy * stemLen;
    const tipX = sx + ix * headLen;
    const tipY = sy + iy * headLen;
    const b1x = sx + tx * headHalfW - ix * sink;
    const b1y = sy + ty * headHalfW - iy * sink;
    const b2x = sx - tx * headHalfW - ix * sink;
    const b2y = sy - ty * headHalfW - iy * sink;

    g.strokeColor = SPAWN_ENTRY_ARROW_STROKE;
    g.fillColor = SPAWN_ENTRY_ARROW_FILL;

    g.lineWidth = 2.25 * lenScale;
    g.moveTo(mx, my);
    g.lineTo(sx, sy);
    g.stroke();

    g.lineWidth = 1.35 * lenScale;
    g.moveTo(tipX, tipY);
    g.lineTo(b1x, b1y);
    g.lineTo(b2x, b2y);
    g.close();
    g.fill();
    g.stroke();

    g.lineWidth = 2;
  }

  /**
   * 在 `destroy_kind_evac` 的撤离格绘制红色箭头：与出生箭头**同尺度**（stem/head/线宽），
   * 语义为沿 `evacExitDir` 离场；**整箭落在格内**——箭尖取格心至撤离边中点距离的 0.86 倍，不画出六角边界。
   */
  private drawEvacExitArrow() {
    if (!this.g || !this.mission) return;
    const obj = this.mission.data.objective;
    if (obj.type !== 'destroy_kind_evac' || !obj.evacAt || obj.evacExitDir === undefined) return;

    const g = this.g;
    const evac = offsetToAxial(obj.evacAt);
    const exitDir = obj.evacExitDir as Direction;
    const c = this.project(evac.q, evac.r);
    const nb = neighbor(evac, exitDir);
    const nc = this.project(nb.q, nb.r);
    const mx = (c.x + nc.x) * 0.5;
    const my = (c.y + nc.y) * 0.5;
    let ux = mx - c.x;
    let uy = my - c.y;
    const dEdge = Math.hypot(ux, uy);
    if (dEdge < 1e-6) return;
    ux /= dEdge;
    uy /= dEdge;
    const tx = -uy;
    const ty = ux;

    const s = this.hexSize;
    const lenScale = 1.5;
    const stemLen = s * 0.07 * lenScale;
    const headLen = s * 0.13 * lenScale;
    const headHalfW = s * 0.11 * lenScale * 2;
    const sink = headLen * 0.32;

    /** 箭尖在格内：沿撤离向不超过格心→该边中点距离的 0.86；若格太小容不下整箭则跳过 */
    const maxTip = dEdge * 0.86;
    const minTip = stemLen + headLen + s * 0.02;
    if (maxTip < minTip) return;
    const tipDist = maxTip;
    const tipX = c.x + ux * tipDist;
    const tipY = c.y + uy * tipDist;
    const joinX = tipX - ux * headLen;
    const joinY = tipY - uy * headLen;
    const stemStartX = joinX - ux * stemLen;
    const stemStartY = joinY - uy * stemLen;
    const b1x = joinX + tx * headHalfW + ux * sink;
    const b1y = joinY + ty * headHalfW + uy * sink;
    const b2x = joinX - tx * headHalfW + ux * sink;
    const b2y = joinY - ty * headHalfW + uy * sink;

    g.strokeColor = EVAC_ARROW_STROKE;
    g.fillColor = EVAC_ARROW_FILL;

    g.lineWidth = 2.25 * lenScale;
    g.moveTo(stemStartX, stemStartY);
    g.lineTo(joinX, joinY);
    g.stroke();

    g.lineWidth = 1.35 * lenScale;
    g.moveTo(tipX, tipY);
    g.lineTo(b1x, b1y);
    g.lineTo(b2x, b2y);
    g.close();
    g.fill();
    g.stroke();

    g.lineWidth = 2;
  }

  /**
   * 在每个 `kind === 'officer'` 的德军军官单位所在格上绘制红色六角边框，与说明书原图
   * 「红色边框建筑」一致；军官被摧毁后不再绘制（避免遗留视觉线索）。
   */
  private drawOfficerTileHighlights() {
    if (!this.g || !this.mission) return;
    const g = this.g;
    const enemies = this.mission.enemies;
    let drewAny = false;
    for (const u of enemies) {
      if (u.kind !== 'officer' || u.destroyed) continue;
      const c = this.project(u.pos.q, u.pos.r);
      g.strokeColor = OFFICER_TILE_STROKE;
      g.lineWidth = 3;
      this.drawHexOutline(c.x, c.y, this.hexSize - 2);
      drewAny = true;
    }
    if (drewAny) g.lineWidth = 2;
  }

  /** 命中概率分档配色：成功率越高越绿，越低越红 */
  private previewColor(prob: number): Color {
    if (prob >= 0.7)  return PREVIEW_COLOR_GREAT;
    if (prob >= 0.4)  return PREVIEW_COLOR_GOOD;
    if (prob >= 0.2)  return PREVIEW_COLOR_FAIR;
    return PREVIEW_COLOR_BAD;
  }

  /** 在地图上某像素点生成一条"≥N\n##%"的命中预览 Label。 */
  private spawnPreviewLabel(x: number, y: number, need: number, probability?: number) {
    if (!this.mapNode) return;
    const idx = Math.max(0, Math.min(13, need));
    const prob = probability ?? HIT_PROB_GE[idx];
    const color = this.previewColor(prob);

    const n = new Node('AttackPreview');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(80, 40);
    ut.setAnchorPoint(0.5, 0.5);

    const l = n.addComponent(Label);
    l.fontSize = 18;
    l.lineHeight = 20;
    l.color = color;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    if (prob <= 0) {
      l.string = t('preview.impossible', { n: need });
      l.fontSize = 14;
    } else {
      l.string = `≥${need}\n${Math.round(prob * 100)}%`;
    }

    // 加描边让字在任何底色上都清晰
    l.enableOutline = true;
    l.outlineColor = PREVIEW_OUTLINE;
    l.outlineWidth = 2;

    this.mapNode.addChild(n);
    n.setPosition(x, y, 0);
    this.previewLabels.push(n);
  }

  private clearPreviewLabels() {
    for (const n of this.previewLabels) n.destroy();
    this.previewLabels.length = 0;
  }

  // ---------- 单位状态常驻文字 ----------

  /**
   * 判定单位的"起火外观"是否应当点亮：只由明确的 fireLevel 驱动。
   * 德军 damaged 仍保留规则语义，但视觉上使用与谢尔曼受损状态同系的裂损 badge。
   */
  private isOnFire(u: Unit): boolean {
    return (u.fireLevel ?? 0) > 0;
  }

  /** 给本回合刚毁的单位在格子下方挂「已毁」短文字；下回合起不再生成。 */
  private spawnStatusLabelIfAny(u: Unit) {
    if (!this.mapNode) return;
    if (!this.shouldShowDestroyWreckVisual(u)) return;
    if (!isFootUnit(u) && isDestroyedTopKind(u.kind)) return;
    const c = (this.anim && this.anim.unit === u)
      ? this.interpolatedPos(u)
      : this.project(u.pos.q, u.pos.r);
    const text = t('unit.status.destroyed');
    const color = STATUS_TEXT_DEAD;

    const n = new Node('StatusLabel');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(80, 24);
    ut.setAnchorPoint(0.5, 0.5);

    const l = n.addComponent(Label);
    l.fontSize = 18;
    l.lineHeight = 20;
    l.color = color;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.string = text;
    l.enableOutline = true;
    l.outlineColor = STATUS_TEXT_OUT;
    l.outlineWidth = 2;

    this.mapNode.addChild(n);
    n.setPosition(c.x, c.y - this.hexSize * 0.65, 0);
    this.statusLabels.push(n);
  }

  private clearStatusLabels() {
    for (const n of this.statusLabels) n.destroy();
    this.statusLabels.length = 0;
  }

  private clearStatusBadges() {
    for (const n of this.statusBadgeNodes) n.destroy();
    this.statusBadgeNodes.length = 0;
  }

  /**
   * 收集当前应显示的坦克状态图标（固定顺序）。
   * 德军 damaged 显示裂损 badge，和谢尔曼的炮塔 / 瘫痪等受损状态保持同一套小标识风格。
   */
  private collectTankStatusBadgeKinds(u: Unit): TankStatusBadgeKind[] {
    // 徒步类（步兵 / 军官）没有装甲 / 装填等坦克状态，跳过坦克 badge 列。
    if (isFootUnit(u) || u.destroyed) return [];
    const out: TankStatusBadgeKind[] = [];
    if (u !== this.mission?.sherman && u.damaged) {
      out.push('damaged');
    }
    if (u.smoked) out.push('smoke');
    if (u.hidden) out.push('hidden');
    if (this.isOnFire(u)) out.push('fire');
    if (u.paralyzed) out.push('paralyzed');
    if (u.turretDamaged) out.push('turret');
    return out;
  }

  /** 在格心略下方绘制一排小方标（矢量），不遮挡俯视车体 */
  private spawnStatusBadgesIfAny(u: Unit) {
    if (!this.mapNode) return;
    const kinds = this.collectTankStatusBadgeKinds(u);
    if (kinds.length === 0) return;

    const c = (this.anim && this.anim.unit === u)
      ? this.interpolatedPos(u)
      : this.project(u.pos.q, u.pos.r);
    const rowY = c.y - this.hexSize * 0.56;
    const cell = TANK_BADGE_CELL;
    const gap = TANK_BADGE_GAP;
    const totalW = kinds.length * cell + (kinds.length - 1) * gap;

    const n = new Node('TankStatusBadges');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(totalW + 4, cell + 6);
    ut.setAnchorPoint(0.5, 0.5);
    n.setPosition(c.x, rowY, 0);

    const g = n.addComponent(Graphics);
    let x = -totalW / 2 + cell / 2;
    for (const kind of kinds) {
      this.drawTankStatusBadge(g, kind, x, 0, cell * 0.5);
      x += cell + gap;
    }

    this.mapNode.addChild(n);
    this.statusBadgeNodes.push(n);
  }

  /** 单枚状态标：深色底框 + 中心符号 */
  private drawTankStatusBadge(g: Graphics, kind: TankStatusBadgeKind, cx: number, cy: number, half: number) {
    const h = half;
    g.fillColor = BADGE_BG;
    g.strokeColor = BADGE_FRAME;
    g.lineWidth = 1.25;
    g.rect(cx - h, cy - h, h * 2, h * 2);
    g.fill();
    g.stroke();

    const r = h * 0.55;
    g.lineWidth = 1.5;
    switch (kind) {
      case 'damaged': {
        // 裂损：斜向折线
        g.strokeColor = new Color(255, 200, 80, 255);
        g.moveTo(cx - h * 0.55, cy - h * 0.35);
        g.lineTo(cx - h * 0.1, cy + h * 0.05);
        g.lineTo(cx + h * 0.15, cy - h * 0.45);
        g.lineTo(cx + h * 0.55, cy + h * 0.35);
        g.stroke();
        break;
      }
      case 'smoke': {
        g.fillColor = new Color(140, 160, 190, 200);
        g.circle(cx - 2.5, cy + 0.5, r * 0.85);
        g.fill();
        g.fillColor = new Color(170, 185, 205, 160);
        g.circle(cx + 3, cy - 1, r * 0.65);
        g.fill();
        g.fillColor = new Color(120, 140, 165, 180);
        g.circle(cx + 1, cy + 2.5, r * 0.5);
        g.fill();
        break;
      }
      case 'hidden': {
        g.fillColor = new Color(45, 85, 48, 255);
        g.rect(cx - h * 0.65, cy - h * 0.35, h * 1.3, h * 0.7);
        g.fill();
        g.strokeColor = new Color(190, 175, 120, 255);
        g.lineWidth = 1.2;
        for (let i = -1; i <= 1; i++) {
          const ox = i * 2.2;
          g.moveTo(cx - h * 0.55 + ox, cy - h * 0.35);
          g.lineTo(cx + h * 0.55 + ox, cy + h * 0.35);
          g.stroke();
        }
        break;
      }
      case 'fire': {
        g.fillColor = ONFIRE_FILL;
        g.strokeColor = ONFIRE_BORDER;
        g.lineWidth = 1.2;
        g.moveTo(cx, cy + h * 0.55);
        g.lineTo(cx - h * 0.45, cy - h * 0.15);
        g.lineTo(cx - h * 0.12, cy - h * 0.35);
        g.lineTo(cx + h * 0.12, cy - h * 0.35);
        g.lineTo(cx + h * 0.45, cy - h * 0.15);
        g.close();
        g.fill();
        g.stroke();
        g.fillColor = new Color(255, 240, 120, 255);
        g.circle(cx, cy - h * 0.15, r * 0.35);
        g.fill();
        break;
      }
      case 'paralyzed': {
        g.fillColor = new Color(160, 110, 220, 255);
        g.circle(cx, cy, r * 0.75);
        g.fill();
        g.strokeColor = new Color(255, 255, 255, 240);
        g.lineWidth = 1.4;
        g.moveTo(cx - h * 0.45, cy + h * 0.15);
        g.lineTo(cx - h * 0.1, cy - h * 0.25);
        g.lineTo(cx + h * 0.15, cy + h * 0.1);
        g.lineTo(cx + h * 0.45, cy - h * 0.2);
        g.stroke();
        break;
      }
      case 'turret': {
        g.strokeColor = new Color(90, 85, 75, 255);
        g.lineWidth = 2;
        g.moveTo(cx - h * 0.55, cy - h * 0.15);
        g.lineTo(cx + h * 0.35, cy - h * 0.15);
        g.stroke();
        g.strokeColor = new Color(230, 55, 55, 255);
        g.lineWidth = 1.6;
        const d = h * 0.35;
        g.moveTo(cx - d, cy + h * 0.15); g.lineTo(cx + d, cy + h * 0.45); g.stroke();
        g.moveTo(cx - d, cy + h * 0.45); g.lineTo(cx + d, cy + h * 0.15); g.stroke();
        break;
      }
      default:
        break;
    }
  }

  /**
   * 在单位格子正下方挂一条单位名字（"谢尔曼" / "虎式" …），常驻显示。
   * 状态图标在格心下约 hex*0.56；已毁短标签约 hex*0.65；名字在其下，偏移 `UNIT_NAME_OFFSET_HEX`×hex。
   */
  private spawnUnitNameLabel(u: Unit) {
    if (!this.mapNode) return;
    if (u.destroyed && !this.shouldShowDestroyWreckVisual(u)) return;
    if (u.destroyed && this.hasLiveUnitOnSameTile(u)) return;
    const c = (this.anim && this.anim.unit === u)
      ? this.interpolatedPos(u)
      : this.project(u.pos.q, u.pos.r);

    const n = new Node('UnitNameLabel');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(96, 22);
    ut.setAnchorPoint(0.5, 0.5);

    const l = n.addComponent(Label);
    l.fontSize = 16;
    l.lineHeight = 18;
    l.color = u.destroyed
      ? UNIT_NAME_TEXT_DEAD
      : u === this.mission?.sherman
        ? UNIT_NAME_TEXT_PLAYER
        : (u.faction === 'allied' ? UNIT_NAME_TEXT_ALLIED : UNIT_NAME_TEXT_GERMAN);
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.string = t(`unit.name.${u.kind}`);
    l.enableOutline = true;
    l.outlineColor = UNIT_NAME_OUTLINE;
    l.outlineWidth = 2;

    this.mapNode.addChild(n);
    // 叠放：车体 → 状态图标条(hex*0.56) → 已毁字(hex*0.65) → 名字（UNIT_NAME_OFFSET_HEX×hex）
    n.setPosition(c.x, c.y - this.hexSize * UNIT_NAME_OFFSET_HEX, 0);
    this.nameLabels.push(n);
  }

  private hasLiveUnitOnSameTile(u: Unit): boolean {
    if (!this.mission) return false;
    const units: Unit[] = [this.mission.sherman, ...this.mission.allies, ...this.mission.enemies];
    return units.some(o =>
      o !== u &&
      !o.destroyed &&
      o.pos.q === u.pos.q &&
      o.pos.r === u.pos.r
    );
  }

  private clearNameLabels() {
    for (const n of this.nameLabels) n.destroy();
    this.nameLabels.length = 0;
  }

  /** 单位若正在动画，返回插值像素位置；否则等价 project(u.pos)。给状态文字定位用。 */
  private interpolatedPos(u: Unit): { x: number; y: number } {
    if (!this.anim || this.anim.unit !== u) return this.project(u.pos.q, u.pos.r);
    if (this.anim.kind === 'turn') return this.project(u.pos.q, u.pos.r);
    const k = easeOutCubic(this.anim.t);
    const a = this.project(this.anim.fromQ, this.anim.fromR);
    const b = this.project(this.anim.toQ, this.anim.toR);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }

  /** 是否绘制本回合击毁残骸（灰圆+红叉）及「已毁」标签（与 `destroyWreckVisualIds` 同步）。 */
  private shouldShowDestroyWreckVisual(u: Unit): boolean {
    if (isFootUnit(u)) return false;
    return u.destroyed && this.destroyWreckVisualIds.has(u.id);
  }

  private registerDestroyWreckVisual(u: Unit): void {
    if (u.destroyed) this.destroyWreckVisualIds.add(u.id);
  }

  private clearDestroyWreckVisuals(): void {
    this.destroyWreckVisualIds.clear();
  }

  private snapshotDestroyedUnitIds(): Set<string> {
    const s = new Set<string>();
    if (!this.mission) return s;
    if (this.mission.sherman.destroyed) s.add(this.mission.sherman.id);
    for (const a of this.mission.allies) {
      if (a.destroyed) s.add(a.id);
    }
    for (const e of this.mission.enemies) {
      if (e.destroyed) s.add(e.id);
    }
    return s;
  }

  private registerNewlyDestroyedSince(prev: Set<string>): void {
    if (!this.mission) return;
    const { sherman, enemies } = this.mission;
    if (sherman.destroyed && !prev.has(sherman.id)) this.registerDestroyWreckVisual(sherman);
    for (const a of this.mission.allies) {
      if (a.destroyed && !prev.has(a.id)) this.registerDestroyWreckVisual(a);
    }
    for (const e of enemies) {
      if (e.destroyed && !prev.has(e.id)) this.registerDestroyWreckVisual(e);
    }
  }

  // ---------- 战报浮字 ----------

  /** 在目标格上方生成一条短暂浮字（MISS/HIT/受损/击毁）。 */
  private spawnFloater(
    atQ: number, atR: number,
    text: string, color: Color,
    opts?: { size?: number; dur?: number; rise?: number },
  ) {
    if (!this.mapNode) return;
    const pixel = this.project(atQ, atR);
    const startY = pixel.y + this.hexSize * 0.55;

    const n = new Node('Floater');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    const size = opts?.size ?? 34;
    ut.setContentSize(160, size + 6);
    ut.setAnchorPoint(0.5, 0.5);

    const l = n.addComponent(Label);
    l.fontSize = size;
    l.lineHeight = size + 4;
    l.color = new Color(color.r, color.g, color.b, 255);
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.string = text;

    this.mapNode.addChild(n);
    n.setPosition(pixel.x, startY, 0);

    this.floaters.push({
      node: n,
      label: l,
      baseR: color.r,
      baseG: color.g,
      baseB: color.b,
      baseX: pixel.x,
      baseY: startY,
      t: 0,
      dur: opts?.dur ?? 1.1,
      rise: opts?.rise ?? 42,
    });
  }

  private advanceFloaters(dt: number) {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      const p = Math.min(f.t / f.dur, 1);
      // 位置：匀速上浮
      f.node.setPosition(f.baseX, f.baseY + f.rise * p, 0);
      // 透明度：前 30% 全显，后 70% 线性淡出
      const alphaNorm = p < 0.3 ? 1 : 1 - (p - 0.3) / 0.7;
      const alpha = Math.max(0, Math.min(255, Math.round(alphaNorm * 255)));
      f.label.color = new Color(f.baseR, f.baseG, f.baseB, alpha);
      if (p >= 1) {
        f.node.destroy();
        this.floaters.splice(i, 1);
      }
    }
  }

  /** 清空所有浮字（切换任务或读档时调用） */
  private clearFloaters() {
    for (const f of this.floaters) f.node.destroy();
    this.floaters.length = 0;
  }

  /** 同一接口画任意单位：若该单位正是当前动画对象，使用插值位置 / 插值朝向 */
  private spawnMuzzleFlash(attacker: Unit | null, target: Unit | null) {
    if (!this.mapNode || !attacker || !target || attacker.destroyed) return;
    const pos = this.muzzleFlashPosition(attacker, target);
    if (!pos) return;

    const n = new Node('MuzzleFlash');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(1, 1);
    ut.setAnchorPoint(0.5, 0.5);
    const g = n.addComponent(Graphics);
    this.mapNode.addChild(n);
    n.setPosition(pos.x, pos.y, 0);
    n.setSiblingIndex(this.mapNode.children.length - 1);

    const flash: MuzzleFlash = {
      node: n,
      g,
      x: pos.x,
      y: pos.y,
      ux: pos.ux,
      uy: pos.uy,
      size: Math.max(10, this.hexSize * 0.24),
      t: 0,
      dur: 0.12,
    };
    this.drawMuzzleFlash(flash, 0);
    this.muzzleFlashes.push(flash);
  }

  private muzzleFlashPosition(attacker: Unit, target: Unit): { x: number; y: number; ux: number; uy: number } | null {
    const dir = (directionTo(attacker.pos, target.pos) ?? approximateDirection(attacker.pos, target.pos)) as Direction;
    const c = this.project(attacker.pos.q, attacker.pos.r);
    const aimAngle = this.directionScreenAngle(attacker.pos, c, dir);
    const aim = { ux: Math.cos(aimAngle), uy: Math.sin(aimAngle) };

    if (!attacker.destroyed && isSplitTankKind(attacker.kind)) {
      const cfg = splitTankVisualConfigOf(attacker.kind);
      const geometry = splitTankGeometryConfigOf(attacker.kind);
      const precise = this.splitTankMuzzlePosition(attacker, c, cfg, geometry, aim);
      if (precise) return precise;
    }

    const dist = this.hexSize * 0.72;
    return {
      x: c.x + aim.ux * dist,
      y: c.y + aim.uy * dist,
      ux: aim.ux,
      uy: aim.uy,
    };
  }

  private splitTankMuzzlePosition(
    u: Unit,
    c: { x: number; y: number },
    cfg: SplitTankVisualConfig,
    geometry: SplitTankGeometryConfig,
    aim: { ux: number; uy: number },
  ): { x: number; y: number; ux: number; uy: number } | null {
    const topTrim = geometry.topTrim;
    const turretTrim = geometry.turretTrim;
    if (topTrim.w <= 0 || topTrim.h <= 0 || turretTrim.w <= 0 || turretTrim.h <= 0) return null;

    const body = this.topDownForwardVec(u, c, null);
    const fit = this.hexSize * 1.8 * cfg.hullFitScale;
    const scale = fit / (Math.max(topTrim.w, topTrim.h) || 1);
    const turretScale = scale * cfg.turretScale;
    const offsetUnit = this.hexSize * Math.sqrt(3);
    const hullF = cfg.hullOffsetForward * offsetUnit;
    const hullR = cfg.hullOffsetRight * offsetUnit;
    const turretF = cfg.turretOffsetForward * offsetUnit;
    const turretR = cfg.turretOffsetRight * offsetUnit;
    const baseX = c.x + hullF * body.ux + hullR * body.uy;
    const baseY = c.y + hullF * body.uy + hullR * (-body.ux);

    const pivot = geometry.pivot;
    const pivotLocalX = (pivot.bodyX - (topTrim.x + topTrim.w / 2)) * scale;
    const pivotLocalY = ((topTrim.y + topTrim.h / 2) - pivot.bodyY) * scale;
    const bodyAngle = Math.atan2(body.uy, body.ux) + Math.PI;
    const cos = Math.cos(bodyAngle);
    const sin = Math.sin(bodyAngle);
    const pivotX = baseX + pivotLocalX * cos - pivotLocalY * sin;
    const pivotY = baseY + pivotLocalX * sin + pivotLocalY * cos;

    const localX = (geometry.muzzle.spriteX - pivot.spriteX) * turretScale - turretF;
    const localY = (pivot.spriteY - geometry.muzzle.spriteY) * turretScale + turretR;
    const right = { ux: aim.uy, uy: -aim.ux };
    return {
      x: pivotX + localX * (-aim.ux) + localY * right.ux,
      y: pivotY + localX * (-aim.uy) + localY * right.uy,
      ux: aim.ux,
      uy: aim.uy,
    };
  }

  private advanceMuzzleFlashes(dt: number) {
    for (let i = this.muzzleFlashes.length - 1; i >= 0; i--) {
      const f = this.muzzleFlashes[i];
      f.t += dt;
      const p = Math.min(f.t / f.dur, 1);
      if (p >= 1) {
        f.node.destroy();
        this.muzzleFlashes.splice(i, 1);
        continue;
      }
      f.node.setPosition(f.x + f.ux * f.size * 0.24 * p, f.y + f.uy * f.size * 0.24 * p, 0);
      this.drawMuzzleFlash(f, p);
    }
  }

  private drawMuzzleFlash(f: MuzzleFlash, p: number) {
    const g = f.g;
    g.clear();
    const alpha = Math.max(0, Math.min(255, Math.round((1 - p) * 255)));
    const s = f.size * (1 + p * 0.85);
    const ux = f.ux;
    const uy = f.uy;
    const rx = uy;
    const ry = -ux;

    g.fillColor = new Color(255, 130, 36, Math.round(alpha * 0.68));
    g.moveTo(ux * s * 1.35, uy * s * 1.35);
    g.lineTo(-ux * s * 0.38 + rx * s * 0.48, -uy * s * 0.38 + ry * s * 0.48);
    g.lineTo(-ux * s * 0.16, -uy * s * 0.16);
    g.lineTo(-ux * s * 0.38 - rx * s * 0.48, -uy * s * 0.38 - ry * s * 0.48);
    g.close();
    g.fill();

    g.fillColor = new Color(255, 226, 90, Math.round(alpha * 0.86));
    g.moveTo(ux * s * 0.94, uy * s * 0.94);
    g.lineTo(-ux * s * 0.20 + rx * s * 0.28, -uy * s * 0.20 + ry * s * 0.28);
    g.lineTo(-ux * s * 0.20 - rx * s * 0.28, -uy * s * 0.20 - ry * s * 0.28);
    g.close();
    g.fill();

    g.fillColor = new Color(255, 255, 232, alpha);
    g.circle(ux * s * 0.16, uy * s * 0.16, s * 0.24);
    g.fill();
  }

  private clearMuzzleFlashes() {
    for (const f of this.muzzleFlashes) f.node.destroy();
    this.muzzleFlashes.length = 0;
  }

  private drawUnitMaybeAnim(u: Unit) {
    if (this.anim && this.anim.unit === u) {
      if (this.anim.kind === 'turn') {
        const c = this.project(u.pos.q, u.pos.r);
        this.drawUnit(u, c.x, c.y, {
          from: this.anim.turnFrom!,
          to: this.anim.turnTo!,
          t: this.anim.t,
        });
        return;
      }
      const k = easeOutCubic(this.anim.t);
      const a = this.project(this.anim.fromQ, this.anim.fromR);
      const b = this.project(this.anim.toQ, this.anim.toR);
      this.drawUnit(u, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
    } else {
      this.drawUnit(u);
    }
  }

  update(dt: number) {
    // 浮字和移动动画独立推进：读档/胜负已决时也要让残留浮字自然淡出
    if (this.floaters.length > 0) this.advanceFloaters(dt);
    if (this.muzzleFlashes.length > 0) this.advanceMuzzleFlashes(dt);

    // 攻击掷骰动画：最高优先级推进（在 anim 之前，避免被 return 提前打断）
    if (this.diceShow) this.advanceDiceShow(dt);

    if (this.playerDiceRollAnim) this.advancePlayerDiceRollAnim(dt);

    if (this.playerDiceSortAnim) {
      this.advancePlayerDiceSortAnim(dt);
      return;
    }

    if (this.turnEndEventUI) this.advanceTurnEndEventUI(dt);

    if (this.fireCheckEventUI) this.advanceFireCheckEventUI(dt);

    if (this.usCasualtyEventUI) this.advanceUsCasualtyEventUI(dt);

    if (this.turretAimAnim) {
      const a = this.turretAimAnim;
      a.t += dt / a.dur;
      if (a.t < 1) {
        this.redraw();
        return;
      }
      if (a.unit === this.mission?.sherman) {
        this.shermanTurretFacing = a.to;
      } else if (this.enemySupportsSplitTurret(a.unit)) {
        this.enemyTurretFacing.set(a.unit.id, a.to);
      }
      this.turretAimAnim = null;
      this.redraw();
      a.onDone();
      return;
    }

    // 敌方 AI 骰：掷完后的槽位排序动画（约 1s），播完再开始按序执行各骰
    if (this.enemyDiceSortAnim && this.mission && this.enemyDiceTrayRoot) {
      const s = this.enemyDiceSortAnim;
      s.t += dt;
      const p = Math.min(1, s.t / s.dur);
      this.applyEnemyDiceSortLayout(easeInOutCubic(p));
      if (p >= 1) {
        this.applyEnemyDiceSortLayout(1);
        this.enemyDiceSortAnim = null;
        this.refreshEnemyDiceTray();
        this.runNextEnemyStep();
      }
      this.refreshEnemyDiceTray();
      this.redraw();
      return;
    }

    if (this.enemyNoActionHold && this.mission && this.enemyDiceTrayRoot) {
      const hold = this.enemyNoActionHold;
      hold.t += dt;
      if (hold.t < hold.dur) {
        this.refreshEnemyDiceTray();
        this.redraw();
        return;
      }
      this.enemyDiceUsed[hold.dieIdx] = true;
      this.enemyDiceHighlightIdx = -1;
      this.enemyNoActionHold = null;
      this.refreshEnemyDiceTray();
      this.redraw();
      this.runNextEnemyStep();
      return;
    }

    if (!this.anim || !this.mission) return;
    const maneuverSound = (this.anim.kind === 'move' || this.anim.kind === 'turn')
      ? this.anim.unit.stats.moveSound
      : '';
    if (this.anim.t === 0 && maneuverSound) {
      startManeuverSound(maneuverSound);
    }
    this.anim.t += dt / this.anim.dur;
    if (this.anim.t < 1) {
      this.redraw();
      return;
    }
    // 动画结束：移动写回格心；转向写回 facing
    const anim = this.anim;
    const finishedUnit = anim.unit;
    if (anim.kind === 'move') {
      finishedUnit.pos = { q: anim.toQ, r: anim.toR };
      if (anim.evacExit && this.mission) {
        this.mission.shermanEvacuated = true;
        this.outcome = checkOutcome(this.mission);
        this.updateOutcomeOverlay();
        this.battleLogI18n('battleLog.unitEvacuated', {
          unitKind: finishedUnit.kind,
          outcome: this.outcome,
        });
      } else if (anim.truckExitDefeat && this.mission && finishedUnit.kind === 'truck') {
        this.mission.truckEscapeDefeat = true;
        this.outcome = checkOutcome(this.mission);
        this.updateOutcomeOverlay();
        this.battleLogI18n('battleLog.truckExitDefeat', { outcome: this.outcome });
      } else {
        this.battleLogI18n('battleLog.unitArrived', {
          unitKind: finishedUnit.kind,
          q: finishedUnit.pos.q,
          r: finishedUnit.pos.r,
        });
      }
    } else {
      finishedUnit.facing = anim.turnTo!;
      this.battleLogI18n('battleLog.unitTurnDone', {
        unitKind: finishedUnit.kind,
        facing: finishedUnit.facing,
      });
    }
    if (finishedUnit === this.mission?.sherman && finishedUnit.facing !== null) {
      this.shermanTurretFacing = finishedUnit.facing;
    } else if (this.enemySupportsSplitTurret(finishedUnit) && finishedUnit.facing !== null) {
      this.enemyTurretFacing.set(finishedUnit.id, finishedUnit.facing);
    }
    if (maneuverSound) stopManeuverSound();
    this.anim = null;
    if (this.animQueue.length > 0) {
      this.anim = this.animQueue.shift()!;
      this.redraw();
      return;
    }
    if (this.pendingAfterAnimChain) {
      const cb = this.pendingAfterAnimChain;
      this.pendingAfterAnimChain = null;
      cb();
      return;
    }
    this.redraw();
    if (this.outcome !== 'ongoing') {
      this.refreshPhaseUI();
      this.updateHUD();
      return;
    }
    // 若处于敌方阶段，紧接着调度下一颗骰（骰子托盘固定在 UI 上，无需每步重建）
    if (this.phase === 'enemy') {
      this.enemyDiceHighlightIdx = -1;
      this.refreshEnemyDiceTray();
      this.runNextEnemyStep();
      return;
    }
    // 玩家移动 / 转向 / 杂项阶段驾驶类动作结束后
    if (this.phase === 'player'
        && (this.playerStep === 'movement' || this.playerStep === 'misc')) {
      this.updateHUD();
      this.autoEndPhaseIfDone();
    }
  }

  /**
   * 移动阶段的"前进 / 后退候选"高亮。
   *
   * 新规则：玩家不再自由点任意邻格，而是通过骰子托盘里的"驾驶骰"沿坦克当前朝向
   * ±1 格移动。这里把两个候选格画出来：
   *   - 前进（沿 facing）=> 绿圈
   *   - 后退（facing+3）=> 琥珀圈
   *   - 如果该方向的目标格越界 / 林地或水域不可入 / 有活着的敌人 => 画红描边提示不可入
   */
  private drawDriveCandidates() {
    if (!this.g || !this.mission) return;
    const { map, sherman } = this.mission;
    if (sherman.facing === null) return;
    const occupied = new Set(
      this.allUnits()
        .filter(e => e !== sherman && !e.destroyed)
        .map(e => `${e.pos.q},${e.pos.r}`),
    );

    const cands: Array<{ dir: number; color: Color }> = [
      { dir: sherman.facing,                    color: DRIVE_FWD_COLOR },
      { dir: rotateDirection(sherman.facing, 3), color: DRIVE_BWD_COLOR },
    ];

    for (const c of cands) {
      const pos = neighbor(sherman.pos, c.dir as 0 | 1 | 2 | 3 | 4 | 5);
      const tile = map.get(pos);
      const blocked = !tile
        || !map.canTankCrossEdge(sherman.pos, pos) // 桥梁边向校验：水域+桥梁需 dir 落在 br 端，详见 GDD §3.2
        || occupied.has(`${pos.q},${pos.r}`);
      const p = this.project(pos.q, pos.r);
      this.g.strokeColor = blocked ? DRIVE_BLOCKED : c.color;
      this.g.lineWidth = 3;
      this.drawHexOutline(p.x, p.y, this.hexSize - 3);
    }
    this.g.lineWidth = 2;
  }

  /** 六边形路径（moveTo 首顶点 + close） */
  private traceHexPath(cx: number, cy: number, size: number) {
    const g = this.g!;
    for (let i = 0; i < 6; i++) {
      const angle = (-30 + 60 * i) * Math.PI / 180;
      const x = cx + size * Math.cos(angle);
      const y = cy + size * Math.sin(angle);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.close();
  }

  /** 绘制带自有格线的地形贴图；失败时调用方会走 Graphics 兜底。 */
  private drawTerrainTileSprite(cx: number, cy: number, size: number, terrain: TerrainType): boolean {
    const sf = this.terrainSpriteFrames[terrain];
    if (!sf || this.terrainSpritePoolNext >= this.terrainSpritePool.length) return false;
    const slot = this.terrainSpritePool[this.terrainSpritePoolNext++];
    slot.sprite.spriteFrame = sf;
    const ut = slot.node.getComponent(UITransform);
    if (ut) ut.setContentSize(size * Math.sqrt(3), size * 2.0);
    slot.node.setPosition(cx, cy, 0);
    slot.node.setRotationFromEuler(0, 0, 0);
    slot.node.setScale(1, 1, 1);
    slot.node.active = true;
    return true;
  }

  private drawHexFill(cx: number, cy: number, size: number, fill: Color) {
    const g = this.g!;
    g.fillColor = fill;
    this.traceHexPath(cx, cy, size);
    g.fill();
  }

  /** 仅描边六边形格线（应在全部基底 fill 之后调用） */
  private drawHexStroke(cx: number, cy: number, size: number) {
    const g = this.g!;
    g.strokeColor = TILE_BORDER;
    g.lineWidth = 2;
    this.traceHexPath(cx, cy, size);
    g.stroke();
  }

  private drawTileBorder(cx: number, cy: number, size: number, tile: Tile, map: HexMap) {
    const g = this.g!;
    g.lineWidth = 2;
    for (let edge = 0; edge < 6; edge++) {
      const axialDir = HEDGE_DRAW_EDGE_BY_AXIAL[edge] as Direction;
      const n = map.get(neighbor(tile.pos, axialDir));
      if (tile.terrain === 'deep_water' || n?.terrain === 'deep_water') continue;
      const isSharedWaterBorder = tile.terrain === 'water' && n?.terrain === 'water';
      if (isSharedWaterBorder && (
        tile.pos.q > n.pos.q || (tile.pos.q === n.pos.q && tile.pos.r > n.pos.r)
      )) {
        continue;
      }
      g.strokeColor =
        isSharedWaterBorder
          ? WATER_SHARED_BORDER
          : TILE_BORDER;
      const a0 = (-30 + 60 * edge) * Math.PI / 180;
      const a1 = (-30 + 60 * (edge + 1)) * Math.PI / 180;
      g.moveTo(cx + size * Math.cos(a0), cy + size * Math.sin(a0));
      g.lineTo(cx + size * Math.cos(a1), cy + size * Math.sin(a1));
      g.stroke();
    }
  }

  private drawFieldBrushOverlay(cx: number, cy: number, size: number, tile: Tile) {
    const g = this.g!;
    const seedRaw =
      ((tile.pos.q | 0) * 374761393 + (tile.pos.r | 0) * 668265263 + 0x51f15eed) >>> 0;
    const rng = new RNG(seedRaw === 0 ? 1 : seedRaw);
    const innerR = size * 0.78;
    const strokes = rng.intRange(70, 96);

    g.lineWidth = Math.max(1, size * 0.016);
    for (let i = 0; i < strokes; i++) {
      const rPos = Math.sqrt(rng.next()) * innerR;
      const theta = rng.next() * Math.PI * 2;
      const px = cx + Math.cos(theta) * rPos;
      const py = cy + Math.sin(theta) * rPos;
      const len = size * (0.065 + rng.next() * 0.085);
      const a = -Math.PI / 2 + (rng.next() - 0.5) * 1.35;
      const dx = Math.cos(a) * len * 0.5;
      const dy = Math.sin(a) * len * 0.5;
      const roll = rng.next();
      g.strokeColor = roll < 0.32 ? FIELD_STROKE_LIGHT : roll < 0.78 ? FIELD_STROKE_DARK : FIELD_STROKE_MID;
      g.moveTo(px - dx, py - dy);
      g.lineTo(px + dx, py + dy);
      g.stroke();
    }

    g.strokeColor = FIELD_EDGE_SHADE;
    g.lineWidth = Math.max(2, size * 0.12);
    this.traceHexPath(cx, cy, size * 0.965);
    g.stroke();
    g.lineWidth = 1;
  }

  /**
   * 通用「hex 颗粒纹理叠加」：在格内叠"软斑 + 颗粒"两层，做出类似沙土 / 路面的质感。
   * 调用方传入 5 色调色板 + seedSalt（避免不同地形共用 axial 种子时纹理重合）。
   *
   * - 1~2 个极低 alpha 的「软斑」（半径 0.32~0.50 size，24 边轻微抖动多边形）：模拟整体光照不均；
   * - 12~18 个直径 4~12 px 的「颗粒」实心圆：3 色按 45% / 40% / 15% 概率随机；
   * - 所有几何按 `axial (q,r) + seedSalt` 种子稳定 → 同格不抖动；
   * - 颜色与基底差仅 ±25~30 → 保持基底主色，避免做"花斑"。
   */
  private drawHexNoiseOverlay(
    cx: number,
    cy: number,
    size: number,
    tile: Tile,
    palette: {
      softLight: Color;
      softDark: Color;
      gritLight: Color;
      gritDark: Color;
      gritMid: Color;
    },
    seedSalt: number,
  ) {
    const g = this.g!;
    const seedRaw =
      ((tile.pos.q | 0) * 374761393 + (tile.pos.r | 0) * 668265263 + (seedSalt | 0)) >>> 0;
    const rng = new RNG(seedRaw === 0 ? 1 : seedRaw);

    /** 颗粒 / 斑块中心允许的最大距格心半径（避免压住六角格线，内切圆 ≈ size·0.866） */
    const innerR = size * 0.82;

    // ---- 1) 软斑：1~2 个大半径（0.32~0.50 size）、24 边轻微抖动多边形、alpha 仅 55 ----
    const softN = rng.intRange(1, 2);
    for (let i = 0; i < softN; i++) {
      const col = rng.next() < 0.5 ? palette.softLight : palette.softDark;
      const r0 = size * (0.16 + rng.next() * 0.18);
      const rPosMax = Math.max(0, innerR - r0 * 0.3);
      const rPos = Math.sqrt(rng.next()) * rPosMax;
      const theta = rng.next() * Math.PI * 2;
      const px = cx + rPos * Math.cos(theta);
      const py = cy + rPos * Math.sin(theta);
      const segs = 24;
      g.fillColor = col;
      for (let k = 0; k < segs; k++) {
        const a = (k / segs) * Math.PI * 2;
        const rr = r0 * (0.92 + 0.16 * rng.next());
        const x = px + rr * Math.cos(a);
        const y = py + rr * Math.sin(a);
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.close();
      g.fill();
    }

    // ---- 2) 颗粒噪声：12~18 个 2.0~6.0 px 实心圆，3 色按概率随机 ----
    const noiseN = rng.intRange(12, 18);
    for (let i = 0; i < noiseN; i++) {
      const rr = 2.0 + rng.next() * 4.0;
      const rPosMax = Math.max(0, innerR - rr);
      const rPos = Math.sqrt(rng.next()) * rPosMax;
      const theta = rng.next() * Math.PI * 2;
      const px = cx + rPos * Math.cos(theta);
      const py = cy + rPos * Math.sin(theta);
      const v = rng.next();
      const col = v < 0.45 ? palette.gritLight : v < 0.85 ? palette.gritDark : palette.gritMid;
      g.fillColor = col;
      g.circle(px, py, rr);
      g.fill();
    }
  }

  /** 泥地纹理叠加：mud 基底之上的细颗粒沙土感（详见 `drawHexNoiseOverlay`） */
  private drawMudOverlay(cx: number, cy: number, size: number, tile: Tile) {
    const g = this.g!;
    const seedRaw =
      ((tile.pos.q | 0) * 1103515245 + (tile.pos.r | 0) * 12345 + 0x2f6e2b1) >>> 0;
    const rng = new RNG(seedRaw === 0 ? 1 : seedRaw);
    const innerR = size * 0.76;

    this.drawHexNoiseOverlay(
      cx,
      cy,
      size,
      tile,
      {
        softLight: MUD_SOFT_LIGHT,
        softDark: MUD_SOFT_DARK,
        gritLight: MUD_GRIT_LIGHT,
        gritDark: MUD_GRIT_DARK,
        gritMid: MUD_GRIT_MID,
      },
      0x12345678,
    );

    g.lineWidth = 0;
    for (let i = 0; i < 7; i++) {
      const rPos = Math.sqrt(rng.next()) * innerR;
      const theta = rng.next() * Math.PI * 2;
      const px = cx + Math.cos(theta) * rPos;
      const py = cy + Math.sin(theta) * rPos;
      const rx = size * (0.12 + rng.next() * 0.15);
      const ry = size * (0.045 + rng.next() * 0.08);
      const a0 = rng.next() * Math.PI * 2;
      const segs = 18;
      g.fillColor = rng.next() < 0.55 ? MUD_SMEAR_DARK : MUD_SMEAR_LIGHT;
      for (let k = 0; k < segs; k++) {
        const a = (k / segs) * Math.PI * 2;
        const rr = 0.82 + rng.next() * 0.28;
        const lx = Math.cos(a) * rx * rr;
        const ly = Math.sin(a) * ry * rr;
        const x = px + lx * Math.cos(a0) - ly * Math.sin(a0);
        const y = py + lx * Math.sin(a0) + ly * Math.cos(a0);
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.close();
      g.fill();
    }

    g.lineWidth = Math.max(1, size * 0.018);
    for (let i = 0; i < 34; i++) {
      const rPos = Math.sqrt(rng.next()) * innerR;
      const theta = rng.next() * Math.PI * 2;
      const px = cx + Math.cos(theta) * rPos;
      const py = cy + Math.sin(theta) * rPos;
      const len = size * (0.05 + rng.next() * 0.13);
      const a = rng.next() * Math.PI * 2;
      const dx = Math.cos(a) * len * 0.5;
      const dy = Math.sin(a) * len * 0.5;
      g.strokeColor = rng.next() < 0.62 ? MUD_SMEAR_LIGHT : MUD_SMEAR_DARK;
      g.moveTo(px - dx, py - dy);
      g.lineTo(px + dx, py + dy);
      g.stroke();
    }

    g.strokeColor = MUD_EDGE_SHADE;
    g.lineWidth = Math.max(3, size * 0.12);
    this.traceHexPath(cx, cy, size * 0.965);
    g.stroke();
    g.lineWidth = 1;
  }

  /** 公路格纹理叠加：road 基底之上的浅灰路面碎屑感（与泥地同算法、不同色板 + 不同种子盐值） */
  private drawRoadHexOverlay(cx: number, cy: number, size: number, tile: Tile) {
    this.drawHexNoiseOverlay(
      cx,
      cy,
      size,
      tile,
      {
        softLight: ROAD_HEX_SOFT_LIGHT,
        softDark: ROAD_HEX_SOFT_DARK,
        gritLight: ROAD_HEX_GRIT_LIGHT,
        gritDark: ROAD_HEX_GRIT_DARK,
        gritMid: ROAD_HEX_GRIT_MID,
      },
      0x9e3779b9,
    );
  }

  /**
   * 林地格上叠画多簇「俯视树冠」（多圆+半透明阴影）。
   * 冠幅约为原先 2 倍、丛数 2 倍，排布为上下两带，尽量占满格内可绘区域；格 (q,r) 轻微错纹。
   */
  private drawForestCanopy(cx: number, cy: number, size: number, t: Tile) {
    const seedRaw =
      ((t.pos.q | 0) * 92811 + (t.pos.r | 0) * 6899 + 0x4f2a91) >>> 0;
    const rng = new RNG(seedRaw === 0 ? 1 : seedRaw);
    const s = size;
    const trees: Array<{ ox: number; oy: number; scale: number }> = [
      { ox: -0.22, oy: 0.22, scale: 0.60 },
      { ox: 0.20, oy: 0.26, scale: 0.66 },
      { ox: -0.04, oy: -0.02, scale: 0.52 },
      { ox: -0.26, oy: -0.25, scale: 0.48 },
      { ox: 0.24, oy: -0.22, scale: 0.58 },
    ];
    if (rng.next() < 0.55) trees.push({ ox: 0.02, oy: 0.43, scale: 0.44 });

    for (let i = 0; i < trees.length; i++) {
      const p = trees[i];
      const x = cx + (p.ox + (rng.next() - 0.5) * 0.07) * s;
      const y = cy + (p.oy + (rng.next() - 0.5) * 0.07) * s;
      const scale = p.scale * (0.92 + rng.next() * 0.18);
      if (!this.drawTreeSprite(x, y, s, seedRaw + i * 101, scale)) {
        this.drawOneTreeClump(x, y, s * scale * 0.34);
      }
    }
  }

  /** 单丛树冠：左下浅影 + 几层相叠的圆 */
  private drawOneTreeClump(x: number, y: number, r: number) {
    const g = this.g!;
    const sh = r * 0.42;
    g.lineWidth = 0;
    g.fillColor = FOREST_SHADE;
    g.circle(x - sh, y - sh, r * 0.92);
    g.fill();
    g.fillColor = FOREST_TREE_DARK;
    g.circle(x - r * 0.1, y + r * 0.06, r);
    g.fill();
    g.fillColor = FOREST_TREE_MID;
    g.circle(x + r * 0.2, y - r * 0.04, r * 0.8);
    g.fill();
    g.fillColor = FOREST_TREE_LIGHT;
    g.circle(x, y, r * 0.52);
    g.fill();
    g.lineWidth = 1;
  }

  /**
   * 格内俯视方形建筑（村庄 / 农场图案）：
   * - 在六角格内随机布置 2~4 个旋转矩形作为建筑屋顶；
   * - 公路格（`tile.roads` 不为空）会避开格内的道路条带（含「道路尽头」格心圆）；
   * - 用格 axial 坐标做种子保证同格视觉稳定（重绘时不会抖动 / 数量不变）；
   * - 与 `drawHedgeEdge` / `drawBridgeOverlay` 同一套「-30°+60°·i」轴向→几何边映射，
   *   确保公路条带轴线与 `drawRoadOverlay` 完全一致。
   *
   * 颜色：屋顶 `BUILDING_ROOF_FILL` 深棕；外缘描边 `BUILDING_OUTLINE`；
   * 屋脊（沿矩形长边方向中线一笔）`BUILDING_WALL_FILL` 浅棕，叠在屋顶上做轻微立体感。
   */
  private drawBuildingOverlay(cx: number, cy: number, size: number, tile: Tile) {
    const g = this.g!;

    // ---- 1) 伪随机种子：基于 axial (q,r) 稳定到「同一格永远同样的布置」 ----
    const seedRaw =
      ((tile.pos.q | 0) * 374761393 + (tile.pos.r | 0) * 668265263 + 0x9e3779b9) >>> 0;
    const rng = new RNG(seedRaw === 0 ? 1 : seedRaw);

    // ---- 2) 收集本格公路条带轴线段，供建筑避让（与 drawRoadOverlay 同步） ----
    const roads = tile.roads;
    const roadHalfW = size * 0.18; // 与 drawRoadOverlay 一致
    let dirCount = 0;
    if (roads) for (let a = 0; a < 6; a++) if (roads[a]) dirCount++;
    const endR = dirCount === 1 ? roadHalfW * 1.6 : roadHalfW;
    const roadSegs: { ax: number; ay: number; bx: number; by: number }[] = [];
    if (roads && dirCount > 0) {
      const edgeMid = (axOrEdge: number) => {
        const edge = HEDGE_DRAW_EDGE_BY_AXIAL[axOrEdge];
        const a1 = ((-30 + 60 * edge) * Math.PI) / 180;
        const a2 = ((-30 + 60 * (edge + 1)) * Math.PI) / 180;
        const x0 = cx + size * Math.cos(a1);
        const y0 = cy + size * Math.sin(a1);
        const x1 = cx + size * Math.cos(a2);
        const y1 = cy + size * Math.sin(a2);
        return { mx: (x0 + x1) / 2, my: (y0 + y1) / 2 };
      };
      for (let a = 0; a < 3; a++) {
        const fwd = !!roads[a];
        const bwd = !!roads[a + 3];
        if (fwd && bwd) {
          const A = edgeMid(a);
          const B = edgeMid(a + 3);
          roadSegs.push({ ax: A.mx, ay: A.my, bx: B.mx, by: B.my });
        } else if (fwd) {
          const A = edgeMid(a);
          roadSegs.push({ ax: A.mx, ay: A.my, bx: cx, by: cy });
        } else if (bwd) {
          const A = edgeMid(a + 3);
          roadSegs.push({ ax: A.mx, ay: A.my, bx: cx, by: cy });
        }
      }
    }

    /** 点到线段最短距离（避道路条带用） */
    const distToSeg = (
      px: number,
      py: number,
      ax: number,
      ay: number,
      bx: number,
      by: number,
    ): number => {
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.hypot(px - ax, py - ay);
      const tt = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      return Math.hypot(px - (ax + tt * dx), py - (ay + tt * dy));
    };

    // ---- 3) 候选采样：拒绝采样直到放满目标数量（或达到尝试上限） ----
    /** 目标 2..4：rng.intRange 闭区间 */
    const target = rng.intRange(2, 4);
    /** 建筑相互之间预留间距（屋顶相对较大时收紧到 0.02·size，避免 3~4 栋常常塞不下） */
    const buildingPadding = size * 0.02;
    /** 建筑与道路之间预留间距 */
    const roadPadding = size * 0.05;
    /** 建筑中心允许的最大距格心半径（保证建筑外接圆完全在六角内切圆 ≈ size·√3/2 内） */
    const innerRadius = size * 0.866;

    type Building = {
      cx: number;
      cy: number;
      w: number;
      h: number;
      angle: number;
      r: number;
      colorIdx: number;
    };
    const placed: Building[] = [];
    const maxAttemptsPer = 120;

    for (let i = 0; i < target; i++) {
      let placedThis = false;
      for (let attempt = 0; attempt < maxAttemptsPer; attempt++) {
        // 矩形尺寸：长 0.40~0.60 size，宽 0.26~0.36 size（在原版基础上整体放大约 100%）
        const w = size * (0.40 + rng.next() * 0.20);
        const h = size * (0.26 + rng.next() * 0.10);
        const halfDiag = Math.hypot(w, h) * 0.5;
        // 位置：极坐标在 hex 内（半径上限随建筑大小收缩，避免压到格边）
        const rMax = Math.max(0, innerRadius - halfDiag);
        if (rMax <= 0) break; // 建筑过大，放弃此尝试
        const rPos = Math.sqrt(rng.next()) * rMax; // sqrt 让分布更均匀（按面积），不偏聚格心
        const theta = rng.next() * Math.PI * 2;
        const bx = cx + rPos * Math.cos(theta);
        const by = cy + rPos * Math.sin(theta);
        const angle = rng.next() * Math.PI * 2;

        // 与已放建筑互斥（圆-圆，半径 = 外接圆 + padding）
        let okOther = true;
        for (const o of placed) {
          if (Math.hypot(bx - o.cx, by - o.cy) < halfDiag + o.r + buildingPadding) {
            okOther = false;
            break;
          }
        }
        if (!okOther) continue;

        // 与道路条带互斥（点到线段距离 ≥ 路面半宽 + 建筑外接圆 + padding）
        let okRoad = true;
        const minDistToRoad = roadHalfW + halfDiag + roadPadding;
        for (const seg of roadSegs) {
          if (distToSeg(bx, by, seg.ax, seg.ay, seg.bx, seg.by) < minDistToRoad) {
            okRoad = false;
            break;
          }
        }
        if (!okRoad) continue;
        // 单方向公路尽头额外避开格心圆（半径放大版）
        if (dirCount === 1) {
          if (Math.hypot(bx - cx, by - cy) < endR + halfDiag + roadPadding) continue;
        }

        // 屋顶颜色：从调色板按种子选一索引（屋脊高光从同序的 RIDGE 调色板取）
        const colorIdx = rng.intRange(0, BUILDING_ROOF_PALETTE.length - 1);
        placed.push({ cx: bx, cy: by, w, h, angle, r: halfDiag, colorIdx });
        placedThis = true;
        break;
      }
      // 若某个建筑实在放不下（如全格被三向路面 + 尽头圆挤满），则少放一个，不强求
      if (!placedThis) break;
    }

    // ---- 4) 绘制每栋建筑：双坡瓦顶分层（底面 → 阴坡 → 瓦楞 → 外缘 + 屋脊高光） ----
    if (placed.length === 0) {
      const w = size * 0.34;
      const h = size * 0.24;
      const halfDiag = Math.hypot(w, h) * 0.5;
      const rMax = Math.max(0, innerRadius - halfDiag);
      const fallbackOffsets: Array<[number, number]> = [
        [0.00, -0.42],
        [0.34, -0.22],
        [-0.34, -0.22],
        [0.34, 0.22],
        [-0.34, 0.22],
        [0.00, 0.42],
        [0.00, 0.00],
      ];
      let best = fallbackOffsets[fallbackOffsets.length - 1];
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const off of fallbackOffsets) {
        const ox = off[0] * size;
        const oy = off[1] * size;
        if (Math.hypot(ox, oy) > rMax) continue;
        let score = roadSegs.length === 0 ? -Math.hypot(ox, oy) : Number.POSITIVE_INFINITY;
        for (const seg of roadSegs) {
          score = Math.min(score, distToSeg(cx + ox, cy + oy, seg.ax, seg.ay, seg.bx, seg.by) - roadHalfW);
        }
        if (score > bestScore) {
          bestScore = score;
          best = off;
        }
      }
      const colorIdx = (seedRaw >>> 3) % BUILDING_ROOF_PALETTE.length;
      placed.push({
        cx: cx + best[0] * size,
        cy: cy + best[1] * size,
        w,
        h,
        angle: (seedRaw % 6) * Math.PI / 6,
        r: halfDiag,
        colorIdx,
      });
    }

    for (const b of placed) {
      const cosA = Math.cos(b.angle);
      const sinA = Math.sin(b.angle);
      const hw = b.w * 0.5;
      const hh = b.h * 0.5;
      /** 本地 (lx, ly) → 屏幕坐标（已包含 angle 旋转 + 中心平移） */
      const rotate = (lx: number, ly: number): [number, number] => [
        b.cx + lx * cosA - ly * sinA,
        b.cy + lx * sinA + ly * cosA,
      ];
      const c0 = rotate(-hw, -hh);
      const c1 = rotate(hw, -hh);
      const c2 = rotate(hw, hh);
      const c3 = rotate(-hw, hh);

      // (4-1) 屋顶底色：整张矩形铺满（亮坡视为屋顶基色）
      g.fillColor = BUILDING_ROOF_PALETTE[b.colorIdx];
      g.lineWidth = 0;
      g.moveTo(c0[0], c0[1]);
      g.lineTo(c1[0], c1[1]);
      g.lineTo(c2[0], c2[1]);
      g.lineTo(c3[0], c3[1]);
      g.close();
      g.fill();

      // (4-2) 阴坡覆盖：屋脊线（局部 y=0）以下半幅再覆盖一层 −28 亮度的同色，
      //       与上半幅形成「双坡屋顶俯视」的明暗对比，让矩形不再像扁箱子
      const cM0 = rotate(-hw, 0);
      const cM1 = rotate(hw, 0);
      g.fillColor = BUILDING_SHADE_PALETTE[b.colorIdx];
      g.moveTo(cM0[0], cM0[1]);
      g.lineTo(cM1[0], cM1[1]);
      g.lineTo(c2[0], c2[1]);
      g.lineTo(c3[0], c3[1]);
      g.close();
      g.fill();

      // (4-3) 瓦楞 / 椽口短线：与屋脊垂直、跨整宽，等距分布。BUILDING_RIB_STROKE 自带半透明，
      //       即使在亮屋顶上也只是淡淡的"瓦面分块感"，不会喧宾夺主
      const ribGap = size * 0.075;
      const ribN = Math.max(3, Math.round(b.w / ribGap));
      g.strokeColor = BUILDING_RIB_STROKE;
      g.lineWidth = 0.6;
      for (let k = 1; k < ribN; k++) {
        const lx = -hw + (b.w * k) / ribN;
        const ra = rotate(lx, -hh);
        const rb = rotate(lx, hh);
        g.moveTo(ra[0], ra[1]);
        g.lineTo(rb[0], rb[1]);
        g.stroke();
      }

      // (4-4) 外缘描边：放最后才画，覆盖到阴坡 fill / 瓦楞线压住的下半边缘上，避免轮廓被吃掉
      g.strokeColor = BUILDING_OUTLINE;
      g.lineWidth = 1.5;
      g.moveTo(c0[0], c0[1]);
      g.lineTo(c1[0], c1[1]);
      g.lineTo(c2[0], c2[1]);
      g.lineTo(c3[0], c3[1]);
      g.close();
      g.stroke();

      // (4-5) 屋脊高光：长边中线，使用「屋顶 +35 亮度」的同色系亮线，比原版略加粗（1.5 px）
      //       并稍超出 hw·0.96 端点，模拟屋脊金属脊瓦在山墙处的轻微外凸
      const ridgeA = rotate(-hw * 0.96, 0);
      const ridgeB = rotate(hw * 0.96, 0);
      g.strokeColor = BUILDING_RIDGE_PALETTE[b.colorIdx];
      g.lineWidth = 1.5;
      g.moveTo(ridgeA[0], ridgeA[1]);
      g.lineTo(ridgeB[0], ridgeB[1]);
      g.stroke();
    }

    g.lineWidth = 2;
  }

  /**
   * 桥梁叠加（GDD §3.2，仅水域格 + 配置了 `bridgeEnds`）：
   * 在水面上画出贯通两端方向的木桥。两端方向 `[a, b]` 的物理边由「-30° + 60°·i」分割得到，
   * 与树篱使用同一套 `HEDGE_DRAW_EDGE_BY_AXIAL` 轴向→几何边映射。
   *
   * 桥面：连接两条边中点的木色矩形带；两侧加平行栏杆线，强调"通道"语义；
   * 与 drawBuildingOverlay 一样不改变基底填色，仅在原色上叠绘。
   */
  private drawBridgeOverlay(cx: number, cy: number, size: number, ends: [Direction, Direction]) {
    const g = this.g!;
    // 取两端方向对应的几何边中点（与 drawHedgeEdge 对边的端点定义同步）
    const mid = (axial: Direction): { x: number; y: number } => {
      const edge = HEDGE_DRAW_EDGE_BY_AXIAL[axial];
      const a1 = (-30 + 60 * edge) * Math.PI / 180;
      const a2 = (-30 + 60 * (edge + 1)) * Math.PI / 180;
      const x0 = cx + size * Math.cos(a1);
      const y0 = cy + size * Math.sin(a1);
      const x1 = cx + size * Math.cos(a2);
      const y1 = cy + size * Math.sin(a2);
      return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    };
    const p0 = mid(ends[0]);
    const p1 = mid(ends[1]);
    // 桥面方向单位向量与法线：用法线偏移得到带状矩形 4 角
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const bridgeHalfW = size * 0.26;
    const roadHalfW = size * 0.18;

    g.lineWidth = 1.5;
    g.strokeColor = BRIDGE_PLANK_OUTLINE;
    g.fillColor = BRIDGE_PLANK_FILL;
    g.moveTo(p0.x + nx * bridgeHalfW, p0.y + ny * bridgeHalfW);
    g.lineTo(p1.x + nx * bridgeHalfW, p1.y + ny * bridgeHalfW);
    g.lineTo(p1.x - nx * bridgeHalfW, p1.y - ny * bridgeHalfW);
    g.lineTo(p0.x - nx * bridgeHalfW, p0.y - ny * bridgeHalfW);
    g.close();
    g.fill();
    g.stroke();

    g.fillColor = ROAD_PATH_FILL;
    g.strokeColor = ROAD_PATH_OUTLINE;
    g.lineWidth = 1.2;
    g.moveTo(p0.x + nx * roadHalfW, p0.y + ny * roadHalfW);
    g.lineTo(p1.x + nx * roadHalfW, p1.y + ny * roadHalfW);
    g.lineTo(p1.x - nx * roadHalfW, p1.y - ny * roadHalfW);
    g.lineTo(p0.x - nx * roadHalfW, p0.y - ny * roadHalfW);
    g.close();
    g.fill();
    g.stroke();

    // 两侧栏杆：再外移一点，以便玩家一眼看出"边界 / 不可越水"语义
    g.strokeColor = BRIDGE_RAIL_STROKE;
    g.lineWidth = 2;
    const railOffset = bridgeHalfW + size * 0.055;
    g.moveTo(p0.x + nx * railOffset, p0.y + ny * railOffset);
    g.lineTo(p1.x + nx * railOffset, p1.y + ny * railOffset);
    g.stroke();
    g.moveTo(p0.x - nx * railOffset, p0.y - ny * railOffset);
    g.lineTo(p1.x - nx * railOffset, p1.y - ny * railOffset);
    g.stroke();

    // 桥面上等距画几条板缝，明确"木桥"质感
    g.strokeColor = BRIDGE_PLANK_SEAM;
    g.lineWidth = 1;
    const PLANKS = 5;
    for (let k = 1; k <= PLANKS; k++) {
      const f = k / (PLANKS + 1);
      const cxk = p0.x + dx * f;
      const cyk = p0.y + dy * f;
      g.moveTo(cxk + nx * bridgeHalfW, cyk + ny * bridgeHalfW);
      g.lineTo(cxk + nx * roadHalfW, cyk + ny * roadHalfW);
      g.moveTo(cxk - nx * roadHalfW, cyk - ny * roadHalfW);
      g.lineTo(cxk - nx * bridgeHalfW, cyk - ny * bridgeHalfW);
      g.stroke();
    }
    g.lineWidth = 2;
  }

  /**
   * 水陆河岸过渡：仅在水域格（非桥梁）内沿"邻格非水域 / 非地图外"的方向画双层沙带（外深 + 内浅），
   * 模拟由水→陆的渐变。
   *
   * **跨格连续性**：当沙带边 `e` 的某端 V 处的相邻边 `e'` 是「水-水共享边」时，沙带在 V 处会
   * 沿 e' 边方向**额外延伸 `d/√3`**（"L 形角部"），且内角点选用 V→格心 方向 `d/cos(30°)` 的对角偏移点。
   * 这样：
   *  - 内角点同时距 e 边和 e' 边的垂直距离均为 d；
   *  - 沙带外缘从 V 沿 e' 边方向延伸的小段 + 内缘的对角偏移点 → 在 V 处自然合成一个 L 形角部；
   *  - 两侧水域格 A、B 在共享边的同一 V 上做对称的 L 形延伸 → 颜色相同的两段沙带在共享边附近
   *    完全对接，跨越水-水边界形成视觉连续的沙带（不再有 V 形断口）。
   *
   * 端点情形：
   *  - 'land'：相邻边也画沙带（同格内两沙带衔接），内角点用对角偏移；无 L 形延伸；
   *  - 'water'：相邻边是水-水共享边（不画主沙带，但需 L 形角部延伸过共享边对接邻格沙带）；
   *  - 'edge'：地图外（沙带封口），内角点用 e 法线方向偏移 d，无 L 形延伸。
   */
  private drawWaterBankOverlay(
    cx: number,
    cy: number,
    size: number,
    tile: Tile,
    map: HexMap,
  ) {
    const g = this.g!;
    const totalDepth = size * 0.22;
    const outerRatio = 0.55;
    const outerDepth = totalDepth * outerRatio;

    // ---- 1) 标记 6 条几何边的邻格类型 ----
    // 轴向 ax → 几何边 e 通过 HEDGE_DRAW_EDGE_BY_AXIAL；该映射为自逆置换 [0,5,4,3,2,1]。
    type EdgeType = 'land' | 'water' | 'edge';
    const edgeType: EdgeType[] = [];
    for (let e = 0; e < 6; e++) {
      const ax = HEDGE_DRAW_EDGE_BY_AXIAL[e];
      const np = neighbor(tile.pos, ax as Direction);
      const n = map.get(np);
      if (!n) edgeType.push('edge');
      else if (n.terrain === 'water') edgeType.push('water');
      else edgeType.push('land');
    }
    if (!edgeType.includes('land')) return;

    // ---- 2) 6 个几何顶点 V[i] = (-30°+60°·i) 上的方向数据 ----
    const V: { x: number; y: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (-30 + 60 * i) * Math.PI / 180;
      V.push({ x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) });
    }
    /** 顶点 i 的"V → 格心"单位向量（即两条相邻边法线的角平分线方向） */
    const vToCenter = V.map((v) => {
      const ux = cx - v.x;
      const uy = cy - v.y;
      const l = Math.hypot(ux, uy) || 1;
      return { ux: ux / l, uy: uy / l };
    });
    /** 几何边 e（V[e] → V[e+1]）的方向单位向量 */
    const edgeDir: { ux: number; uy: number }[] = [];
    /** 几何边 e 的法线（朝格心）单位向量 */
    const edgeNorm: { ux: number; uy: number }[] = [];
    for (let e = 0; e < 6; e++) {
      const v0 = V[e];
      const v1 = V[(e + 1) % 6];
      const dx = v1.x - v0.x;
      const dy = v1.y - v0.y;
      const l = Math.hypot(dx, dy) || 1;
      edgeDir.push({ ux: dx / l, uy: dy / l });
      const mx = (v0.x + v1.x) * 0.5;
      const my = (v0.y + v1.y) * 0.5;
      const ux = cx - mx;
      const uy = cy - my;
      const ll = Math.hypot(ux, uy) || 1;
      edgeNorm.push({ ux: ux / ll, uy: uy / ll });
    }

    /** L 形延伸的沿邻边长度：使外缘起点距 e 边的垂直距离正好为 d（与对角偏移点同高） */
    const patchLen = (d: number) => d / Math.sqrt(3);

    /**
     * 一条沙带边 e 的多边形顶点（按外缘 → 内缘 顺时针）。两端按 type_a / type_b 分别决定
     * 外缘起点 + 内缘内角点；空形或重复点会在闭合时自动合并。
     */
    const stripPolygon = (e: number, d: number): { x: number; y: number }[] => {
      const va = V[e];
      const vb = V[(e + 1) % 6];
      const vbi = (e + 1) % 6;
      const ePrev = (e + 5) % 6;
      const eNext = (e + 1) % 6;
      const tA = edgeType[ePrev];
      const tB = edgeType[eNext];

      // 外缘起 / 终点：'water' 时沿邻边延伸 patchLen(d)
      // V_a 沿 e_prev 边方向（朝 V_a 之外的另一端 V[ePrev]）= -edgeDir[ePrev]
      const vaPatch =
        tA === 'water'
          ? {
              x: va.x - edgeDir[ePrev].ux * patchLen(d),
              y: va.y - edgeDir[ePrev].uy * patchLen(d),
            }
          : va;
      // V_b 沿 e_next 边方向（朝 V_b 之外的另一端 V[(eNext+1)%6]）= +edgeDir[eNext]
      const vbPatch =
        tB === 'water'
          ? {
              x: vb.x + edgeDir[eNext].ux * patchLen(d),
              y: vb.y + edgeDir[eNext].uy * patchLen(d),
            }
          : vb;

      // 内角点：
      // - 相邻边也是 land 时，当前条带先收在自己的内偏移线上，稍后由圆角补丁连接两条岸线；
      // - water 时仍使用对角偏移，补齐跨水-水共享边的 L 形过渡；
      // - edge 时沿 e 法线偏移 d（封口）。
      const f = d / Math.cos(Math.PI / 6);
      const vaInner =
        tA === 'edge'
          ? { x: va.x + edgeNorm[e].ux * d, y: va.y + edgeNorm[e].uy * d }
          : tA === 'land'
            ? { x: va.x + edgeNorm[e].ux * d, y: va.y + edgeNorm[e].uy * d }
            : { x: va.x + vToCenter[e].ux * f, y: va.y + vToCenter[e].uy * f };
      const vbInner =
        tB === 'edge'
          ? { x: vb.x + edgeNorm[e].ux * d, y: vb.y + edgeNorm[e].uy * d }
          : tB === 'land'
            ? { x: vb.x + edgeNorm[e].ux * d, y: vb.y + edgeNorm[e].uy * d }
            : { x: vb.x + vToCenter[vbi].ux * f, y: vb.y + vToCenter[vbi].uy * f };

      // 多边形：外缘 vaPatch → V_a → V_b → vbPatch  → 内缘 vbInner → vaInner
      // 退化：tA=='land'/'edge' 时 vaPatch == V_a，连续两个相同点不影响 fill；
      //       tB 同理。
      return [vaPatch, va, vb, vbPatch, vbInner, vaInner];
    };

    // ---- 3) 先画整体（深度=totalDepth, inner color），再画外层（深度=outerDepth, outer color）覆盖外侧 ----
    g.lineWidth = 0;
    g.fillColor = WATER_BANK_INNER;
    for (let e = 0; e < 6; e++) {
      if (edgeType[e] !== 'land') continue;
      const poly = stripPolygon(e, totalDepth);
      g.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x, poly[i].y);
      g.close();
      g.fill();
    }
    g.fillColor = WATER_BANK_OUTER;
    for (let e = 0; e < 6; e++) {
      if (edgeType[e] !== 'land') continue;
      const poly = stripPolygon(e, outerDepth);
      g.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x, poly[i].y);
      g.close();
      g.fill();
    }
  }

  /**
   * 公路条带叠加（依 `Tile.roads` 6 位轴向位绘制）：将 6 向折成 3 条轴对（0-3 / 1-4 / 2-5）：
   *
   * - **直道**（同轴 a 与 a+3 同时为 1）：作为一条**整段**条带从边中点 A 直接画到边中点 B；
   *   两侧描边贯穿整格不截断 → 与相邻格内同向直道无缝连为一条连续公路。
   * - **半条带**（仅 a 或仅 a+3 为 1）：边中点 → 格心；汇合圆作为多向交汇时的填充连续区。
   * - **道路尽头**（`dirCount === 1` 单方向）：格心圆放大到 `halfW * 1.6` + 圆周描边。
   *
   * 「描边只保留在路面并集的外轮廓上」做法（fill → stroke → fill again）：
   *   1) 一次填充：所有路面（halfW 半宽 + 汇合圆 endR）；
   *   2) 描边：直道两侧贯穿、半条带两侧从边中点到格心、单方向圆周；
   *   3) 二次填充：用同色再画一次，半宽缩 `lineWidth/2 ≈ 0.75px` →
   *      把描边的"路面内侧"部分覆盖回米褐，仅保留路面边缘外侧的 0.75 像素描边。
   *   这样：
   *    - 直道穿过半条带的那段描边被半条带 inner-fill 擦掉 → T/Y 字交汇处不再有"线穿过路面"；
   *    - 弯道两条 half 的内端描边被汇合圆 inner-fill 擦掉 → 描边自然沿汇合圆缘弯过去，
   *      而不是各自留一个缺口。
   *
   * 与桥梁同样使用 `HEDGE_DRAW_EDGE_BY_AXIAL` 完成「轴向 → 几何边」映射；几何边端点定义与
   * `drawHedgeEdge` / `drawBridgeOverlay` 保持一致（`-30°+60°·i` 弦边法）。
   */
  private drawDeepWaterOverlay(cx: number, cy: number, size: number, tile: Tile) {
    const g = this.g!;
    const seed = ((tile.pos.q | 0) * 92837111 + (tile.pos.r | 0) * 689287499 + 0x51f15e) >>> 0;
    const rng = new RNG(seed === 0 ? 1 : seed);
    g.lineWidth = 2;
    g.strokeColor = DEEP_WATER_LIGHT;
    for (let i = 0; i < 11; i++) {
      const x = cx + (rng.next() * 2 - 1) * size * 0.62;
      const y = cy + (rng.next() * 2 - 1) * size * 0.68;
      const len = size * (0.12 + rng.next() * 0.22);
      g.moveTo(x - len * 0.5, y);
      g.bezierCurveTo(x - len * 0.15, y + size * 0.05, x + len * 0.15, y - size * 0.05, x + len * 0.5, y);
      g.stroke();
    }
    g.lineWidth = 2;
  }

  private drawAirstripOverlay(
    cx: number,
    cy: number,
    size: number,
    roads: NonNullable<Tile['roads']>,
    tile: Tile,
  ) {
    const g = this.g!;
    const dirs: number[] = [];
    for (let i = 0; i < 6; i++) if (roads[i]) dirs.push(i);
    if (dirs.length === 0) return;

    const axis = dirs.find((d) => roads[(d + 3) % 6]) ?? dirs[0]!;
    const axisKey = axis % 3;
    const sameAxisAirstripAt = (dir: number): boolean => {
      const n = this.mission?.map.get(neighbor(tile.pos, dir as Direction));
      if (!n || n.terrain !== 'airstrip' || !n.roads) return false;
      const ndirs: number[] = [];
      for (let i = 0; i < 6; i++) if (n.roads[i]) ndirs.push(i);
      if (ndirs.length === 0) return false;
      const nAxis = ndirs.find((d) => n.roads![(d + 3) % 6]) ?? ndirs[0]!;
      return nAxis % 3 === axisKey;
    };
    const edgeMid = (ax: number): { mx: number; my: number } => {
      const edge = HEDGE_DRAW_EDGE_BY_AXIAL[ax];
      const a1 = (-30 + 60 * edge) * Math.PI / 180;
      const a2 = (-30 + 60 * (edge + 1)) * Math.PI / 180;
      const x0 = cx + size * Math.cos(a1);
      const y0 = cy + size * Math.sin(a1);
      const x1 = cx + size * Math.cos(a2);
      const y1 = cy + size * Math.sin(a2);
      return { mx: (x0 + x1) / 2, my: (y0 + y1) / 2 };
    };

    const a = edgeMid(axis);
    const b = edgeMid((axis + 3) % 6);
    const trimA = sameAxisAirstripAt(axis) ? 0 : 0.20;
    const trimB = sameAxisAirstripAt((axis + 3) % 6) ? 0 : 0.20;
    const ax = a.mx + (b.mx - a.mx) * trimA;
    const ay = a.my + (b.my - a.my) * trimA;
    const bx = b.mx + (a.mx - b.mx) * trimB;
    const by = b.my + (a.my - b.my) * trimB;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const halfW = size * 0.42;

    g.fillColor = AIRSTRIP_FILL;
    g.strokeColor = AIRSTRIP_OUTLINE;
    g.lineWidth = 1.5;
    g.moveTo(ax + nx * halfW, ay + ny * halfW);
    g.lineTo(bx + nx * halfW, by + ny * halfW);
    g.lineTo(bx - nx * halfW, by - ny * halfW);
    g.lineTo(ax - nx * halfW, ay - ny * halfW);
    g.close();
    g.fill();

    g.moveTo(ax + nx * halfW, ay + ny * halfW);
    g.lineTo(bx + nx * halfW, by + ny * halfW);
    g.moveTo(ax - nx * halfW, ay - ny * halfW);
    g.lineTo(bx - nx * halfW, by - ny * halfW);
    if (trimA > 0) {
      g.moveTo(ax + nx * halfW, ay + ny * halfW);
      g.lineTo(ax - nx * halfW, ay - ny * halfW);
    }
    if (trimB > 0) {
      g.moveTo(bx + nx * halfW, by + ny * halfW);
      g.lineTo(bx - nx * halfW, by - ny * halfW);
    }
    g.stroke();
  }

  private drawBreakwaterEdge(
    cx: number,
    cy: number,
    size: number,
    edgeIndex: number,
    q: number,
    r: number,
    usedKeys: Set<string>,
  ) {
    const g = this.g!;
    const a1 = (-30 + 60 * edgeIndex) * Math.PI / 180;
    const a2 = (-30 + 60 * (edgeIndex + 1)) * Math.PI / 180;
    const x0 = cx + size * Math.cos(a1);
    const y0 = cy + size * Math.sin(a1);
    const x1 = cx + size * Math.cos(a2);
    const y1 = cy + size * Math.sin(a2);
    const tx = x1 - x0;
    const ty = y1 - y0;
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const seed = ((q | 0) * 73856093 + (r | 0) * 19349663 + edgeIndex * 83492791 + 0xbad011) >>> 0;
    const rng = new RNG(seed === 0 ? 1 : seed);
    for (let k = 0; k < 8; k++) {
      const f = (k + 0.5) / 8;
      const baseX = x0 + tx * f;
      const baseY = y0 + ty * f;
      const key = `${Math.round(baseX * 6)},${Math.round(baseY * 6)}`;
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      const px = baseX + nx * (size * (0.035 + rng.next() * 0.045));
      const py = baseY + ny * (size * (0.035 + rng.next() * 0.045));
      const rr = size * (0.035 + rng.next() * 0.025);
      const roll = rng.next();
      g.fillColor = roll < 0.35 ? BREAKWATER_DARK : roll < 0.78 ? BREAKWATER_MID : BREAKWATER_LIGHT;
      g.circle(px, py, rr);
      g.fill();
    }
  }

  private drawRoadOverlay(
    cx: number,
    cy: number,
    size: number,
    roads: NonNullable<Tile['roads']>,
    tile: Tile,
  ) {
    const g = this.g!;
    const dirCount = roads.reduce((n, b) => n + (b ? 1 : 0), 0);
    if (dirCount === 0) return;

    const halfW = size * 0.18;
    const lineW = 1.5;
    /** 二次填充用的"内缩"量：只保留 `lineW/2` 的外缘描边幸存 */
    const inset = lineW / 2;
    const innerHalf = Math.max(0, halfW - inset);
    /** 单方向时格心圆放大成"道路尽头"图案；其它情况下作为汇合圆，半径 = halfW。 */
    const endR = dirCount === 1 ? halfW * 1.6 : halfW;
    const innerEndR = Math.max(0, endR - inset);

    /** 计算第 ax 轴向的边中点（与 drawBridgeOverlay 同步）。 */
    const edgeMid = (ax: number): { mx: number; my: number } => {
      const edge = HEDGE_DRAW_EDGE_BY_AXIAL[ax];
      const a1 = (-30 + 60 * edge) * Math.PI / 180;
      const a2 = (-30 + 60 * (edge + 1)) * Math.PI / 180;
      const x0 = cx + size * Math.cos(a1);
      const y0 = cy + size * Math.sin(a1);
      const x1 = cx + size * Math.cos(a2);
      const y1 = cy + size * Math.sin(a2);
      return { mx: (x0 + x1) / 2, my: (y0 + y1) / 2 };
    };

    // 三轴分类：0-3 / 1-4 / 2-5。同轴两端都通 → through（整段直道）；
    // 仅一端 → half（半条带 + 该轴 0..2 的方向）；都不通 → 跳过。
    const through: number[] = []; // 含轴号 0/1/2（绘制时用边中点 a 与 a+3 的连线）
    const halves: number[] = [];  // 含具体方向 0..5
    for (let a = 0; a < 3; a++) {
      const fwd = !!roads[a];
      const bwd = !!roads[a + 3];
      if (fwd && bwd) through.push(a);
      else if (fwd) halves.push(a);
      else if (bwd) halves.push(a + 3);
    }

    /** 矩形条带填充：从 pA 到 pB 沿垂直方向取 ±w 的矩形，仅 fill 不 stroke。 */
    const fillStrip = (
      pA: { mx: number; my: number },
      pB: { mx: number; my: number },
      w: number,
    ) => {
      const dx = pB.mx - pA.mx;
      const dy = pB.my - pA.my;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      g.moveTo(pA.mx + nx * w, pA.my + ny * w);
      g.lineTo(pB.mx + nx * w, pB.my + ny * w);
      g.lineTo(pB.mx - nx * w, pB.my - ny * w);
      g.lineTo(pA.mx - nx * w, pA.my - ny * w);
      g.close();
      g.fill();
    };

    g.fillColor = ROAD_PATH_FILL;
    g.strokeColor = ROAD_PATH_OUTLINE;

    // ---- 1) 一次填充（halfW）：所有 through / half / 汇合圆 ----
    g.lineWidth = 0;
    for (const a of through) {
      fillStrip(edgeMid(a), edgeMid(a + 3), halfW);
    }
    for (const ax of halves) {
      fillStrip(edgeMid(ax), { mx: cx, my: cy }, halfW);
    }
    if (halves.length > 0 || dirCount === 1) {
      g.circle(cx, cy, endR);
      g.fill();
    }

    // ---- 2) 描边：所有边线（直道贯穿、半条带边中点→格心、单方向圆周） ----
    g.lineWidth = lineW;
    for (const a of through) {
      const A = edgeMid(a);
      const B = edgeMid(a + 3);
      const dx = B.mx - A.mx;
      const dy = B.my - A.my;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      g.moveTo(A.mx + nx * halfW, A.my + ny * halfW);
      g.lineTo(B.mx + nx * halfW, B.my + ny * halfW);
      g.stroke();
      g.moveTo(A.mx - nx * halfW, A.my - ny * halfW);
      g.lineTo(B.mx - nx * halfW, B.my - ny * halfW);
      g.stroke();
    }
    for (const ax of halves) {
      const { mx, my } = edgeMid(ax);
      const dx = mx - cx;
      const dy = my - cy;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      // 描边一直画到格心；二次填充会擦除汇合圆内部的部分
      g.moveTo(cx + nx * halfW, cy + ny * halfW);
      g.lineTo(mx + nx * halfW, my + ny * halfW);
      g.stroke();
      g.moveTo(cx - nx * halfW, cy - ny * halfW);
      g.lineTo(mx - nx * halfW, my - ny * halfW);
      g.stroke();
    }
    // 汇合圆周描边：
    //  - 单方向：恒描，形成"道路尽头"圆轮廓；
    //  - 无 through 且 ≥2 个 half（弯道 / Y 字 / 多向 half）：描，让凹角弧上的轮廓连续；
    //  - 其它（含直道、T 字、十字等含 through 的情况）：不描——through 矩形已完整覆盖汇合圆，
    //    描了反而在格心位置出现两小段"凸起"的圆周描边。
    const needsHubStroke =
      dirCount === 1 || (through.length === 0 && halves.length >= 2);
    if (needsHubStroke) {
      g.circle(cx, cy, endR);
      g.stroke();
    }

    // ---- 3) 二次填充（halfW - inset）：擦除描边的"路面内侧"部分 ----
    g.lineWidth = 0;
    for (const a of through) {
      fillStrip(edgeMid(a), edgeMid(a + 3), innerHalf);
    }
    for (const ax of halves) {
      fillStrip(edgeMid(ax), { mx: cx, my: cy }, innerHalf);
    }
    if (halves.length > 0 || dirCount === 1) {
      g.circle(cx, cy, innerEndR);
      g.fill();
    }

    // ---- 4) 路面颗粒：模拟说明书图例里夯土路面的碎屑感（按 axial 种子稳定，重绘不抖动） ----
    //         颗粒中心限制在 `innerHalf - gritMargin` 范围内 → 不会越过外缘描边、不会溢出到泥/草。
    const seed =
      ((tile.pos.q | 0) * 374761393 + (tile.pos.r | 0) * 668265263 + 0xcafebabe) >>> 0;
    const rng = new RNG(seed === 0 ? 1 : seed);
    /** 颗粒最大半径 + 安全间距，避免颗粒贴到外缘描边 */
    const gritMargin = 2.0;
    const stripHalfForGrit = Math.max(0, innerHalf - gritMargin);
    const hubRForGrit = Math.max(0, innerEndR - gritMargin);
    /** 在 (pA → pB) 矩形条带内撒 count 个颗粒（条带局部坐标 t∈[0.05,0.95], s∈[-h, +h]） */
    const stripGrits = (
      pA: { mx: number; my: number },
      pB: { mx: number; my: number },
      count: number,
    ) => {
      const dx = pB.mx - pA.mx;
      const dy = pB.my - pA.my;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      for (let i = 0; i < count; i++) {
        const tt = 0.05 + rng.next() * 0.90;
        const ss = (rng.next() * 2 - 1) * stripHalfForGrit;
        const px = pA.mx + ux * tt * len + nx * ss;
        const py = pA.my + uy * tt * len + ny * ss;
        const v = rng.next();
        const col = v < 0.40 ? ROAD_GRIT_LIGHT : v < 0.85 ? ROAD_GRIT_MID : ROAD_GRIT_DARK;
        const rr = 0.5 + rng.next() * 1.4;
        g.fillColor = col;
        g.circle(px, py, rr);
        g.fill();
      }
    };
    /** 在格心圆（半径 hubRForGrit）内撒 count 个颗粒（√U 极坐标 → 面积均匀） */
    const hubGrits = (count: number) => {
      if (hubRForGrit <= 0) return;
      for (let i = 0; i < count; i++) {
        const r = Math.sqrt(rng.next()) * hubRForGrit;
        const a = rng.next() * Math.PI * 2;
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        const v = rng.next();
        const col = v < 0.40 ? ROAD_GRIT_LIGHT : v < 0.85 ? ROAD_GRIT_MID : ROAD_GRIT_DARK;
        const rr = 1.0 + rng.next() * 1.4;
        g.fillColor = col;
        g.circle(px, py, rr);
        g.fill();
      }
    };
    if (stripHalfForGrit > 0) {
      for (const a of through) stripGrits(edgeMid(a), edgeMid(a + 3), rng.intRange(14, 20));
      for (const ax of halves) stripGrits(edgeMid(ax), { mx: cx, my: cy }, rng.intRange(7, 11));
    }
    if (halves.length > 0 || dirCount === 1) hubGrits(rng.intRange(4, 8));

    g.lineWidth = 2;
  }

  /** 仅描边的六边形（用于高亮） */
  private drawHexOutline(cx: number, cy: number, size: number) {
    const g = this.g!;
    for (let i = 0; i < 6; i++) {
      const angle = (-30 + 60 * i) * Math.PI / 180;
      const x = cx + size * Math.cos(angle);
      const y = cy + size * Math.sin(angle);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.close();
    g.stroke();
  }

  /** 每条六角边上的树篱树木数量：两个端点 + 中点；端点会跨相邻树篱去重共用。 */
  private static readonly HEDGE_TREES_PER_EDGE = 3;

  /**
   * 第 `edgeIndex` 条**几何边**上的树篱（`edgeIndex` = `-30°+60°·i` 划分法中的 i∈0..5），与**轴向**下标不混用：若表示 `HEX_DIRECTIONS[ax]/Tile.hedges[ax]/h[ax]/ef`，入参应取 `HEDGE_DRAW_EDGE_BY_AXIAL[ax]`。
   * 单丛大小统一，在原先基准半径 `size*0.086` 上整体放大 30%。
   * 沿边用 `k/(n+1)` 均匀取点，使两端与顶点留出相同空隙、丛与丛之间等距。
   */
  private drawHedgeEdgeTrees(
    cx: number,
    cy: number,
    size: number,
    edgeIndex: number,
    q: number,
    r: number,
    usedKeys: Set<string>,
  ) {
    const a1 = (-30 + 60 * edgeIndex) * Math.PI / 180;
    const a2 = (-30 + 60 * (edgeIndex + 1)) * Math.PI / 180;
    const x0 = cx + size * Math.cos(a1);
    const y0 = cy + size * Math.sin(a1);
    const x1 = cx + size * Math.cos(a2);
    const y1 = cy + size * Math.sin(a2);
    const tx = x1 - x0;
    const ty = y1 - y0;
    const len = Math.hypot(tx, ty) || 1;
    const ux = tx / len;
    const uy = ty / len;
    let nx = cx - (x0 + x1) * 0.5;
    let ny = cy - (y0 + y1) * 0.5;
    const nlen = Math.hypot(nx, ny) || 1;
    nx /= nlen;
    ny /= nlen;
    const seedRaw =
      ((q | 0) * 73856093 + (r | 0) * 19349663 + (edgeIndex | 0) * 83492791 + 0x6d2b79f5) >>> 0;
    const rng = new RNG(seedRaw === 0 ? 1 : seedRaw);

    const n = BattleScene.HEDGE_TREES_PER_EDGE;
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1);
      const baseX = x0 + tx * f;
      const baseY = y0 + ty * f;
      const key = `${Math.round(baseX * 8)},${Math.round(baseY * 8)}`;
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      const keySeed = this.hashStringToSeed(key);
      const local = new RNG(keySeed);
      const along = (local.next() - 0.5) * size * (k === 1 ? 0.08 : 0.025);
      const across = (local.next() - 0.5) * size * 0.14;
      const px = x0 + tx * f + ux * along + nx * across;
      const py = y0 + ty * f + uy * along + ny * across;
      const scale = 0.40 + local.next() * 0.12;
      if (!this.drawTreeSprite(px, py, size, keySeed, scale)) {
        this.drawHedgeTreeClump(px, py, size * scale * 0.30, rng);
      }
    }
  }

  private drawTreeSprite(cx: number, cy: number, hexSize: number, seed: number, scale: number): boolean {
    if (this.foliageSpritePoolNext >= this.foliageSpritePool.length) return false;
    const frames = this.treeSpriteFrames.filter((sf): sf is SpriteFrame => !!sf);
    if (frames.length === 0) return false;
    const rng = new RNG(seed || 1);
    const slot = this.foliageSpritePool[this.foliageSpritePoolNext++];
    slot.sprite.spriteFrame = frames[Math.abs(seed) % frames.length];
    slot.node.getComponent(UITransform)!.setContentSize(hexSize * scale, hexSize * scale);
    slot.node.setPosition(cx, cy, 0);
    slot.node.angle = (rng.next() - 0.5) * 18;
    const s = 0.92 + rng.next() * 0.18;
    slot.node.setScale(s, s, 1);
    slot.node.active = true;
    return true;
  }

  private hashStringToSeed(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0 || 1;
  }

  /** 树篱单丛：结构与林地树冠类似，配色略深以便与田地/公路上的树篱区分 */
  private drawHedgeTreeClump(x: number, y: number, r: number, rng?: RNG) {
    const g = this.g!;
    const local = rng ?? new RNG(1);
    const sh = r * 0.24;
    g.lineWidth = 0;
    g.fillColor = HEDGE_SHADE;
    g.circle(x - sh, y - sh, r * 0.92);
    g.fill();
    const blobs = 5 + Math.floor(local.next() * 3);
    for (let i = 0; i < blobs; i++) {
      const a = local.next() * Math.PI * 2;
      const d = r * local.next() * 0.52;
      const rr = r * (0.42 + local.next() * 0.32);
      const roll = local.next();
      g.fillColor = roll < 0.32 ? HEDGE_BUSH_DEEP : roll < 0.68 ? HEDGE_BUSH_DARK : HEDGE_BUSH_MID;
      g.circle(x + Math.cos(a) * d, y + Math.sin(a) * d, rr);
      g.fill();
    }
    g.fillColor = HEDGE_BUSH_LIGHT;
    g.circle(x - r * 0.16, y + r * 0.18, r * (0.18 + local.next() * 0.10));
    g.fill();
    g.lineWidth = 1;
  }

  /** 某朝向在屏幕上的单位方向向量（从格心指向该向邻居中心）。 */
  private facingToScreenUnitVec(pos: { q: number; r: number }, facing: number): { ux: number; uy: number } {
    const d = (((facing % 6) + 6) % 6) as Direction;
    const c = this.project(pos.q, pos.r);
    const np = this.project(neighbor({ q: pos.q, r: pos.r }, d).q, neighbor({ q: pos.q, r: pos.r }, d).r);
    const len = Math.hypot(np.x - c.x, np.y - c.y) || 1;
    return { ux: (np.x - c.x) / len, uy: (np.y - c.y) / len };
  }

  /** 两个相邻朝向之间插值（用于 60° 转向动画）。 */
  private facingBlendScreenVec(
    pos: { q: number; r: number }, from: number, to: number, tRaw: number,
  ): { ux: number; uy: number } {
    const t = easeOutCubic(tRaw);
    const a = this.facingToScreenUnitVec(pos, from);
    const b = this.facingToScreenUnitVec(pos, to);
    let ux = a.ux + (b.ux - a.ux) * t;
    let uy = a.uy + (b.uy - a.uy) * t;
    const len = Math.hypot(ux, uy) || 1;
    return { ux: ux / len, uy: uy / len };
  }

  /**
   * 坦克俯视图通用：CUSTOM 尺寸 + 裁切宽高缓存；炮管朝左（-X）时对齐六角朝向用 +180°。
   * 长宽比：`fitScale` 定整体最长边；`aspectRatioMul` 按车型单独改「显宽÷显高」相对贴图自然比。
   */
  private applyTopDownTankSprite(
    node: Node,
    sp: Sprite,
    sf: SpriteFrame,
    displayW: number,
    displayH: number,
    u: Unit,
    c: { x: number; y: number },
    facingLerp?: DirectionLerp | null,
    preserveAspectRatio = false,
  ) {
    node.active = true;
    const w = displayW > 0 ? displayW : sf.width;
    const h = displayH > 0 ? displayH : sf.height;
    sp.spriteFrame = sf;
    const ut = node.getComponent(UITransform)!;

    // 取本车视觉配置（大小 + 自身朝向局部偏移）
    const cfg = tankVisualConfigOf(u.kind);

    const fit = this.hexSize * 1.8 * cfg.fitScale;
    const maxDim = Math.max(w, h) || 1;
    const tw0 = (w / maxDim) * fit;
    const th0 = (h / maxDim) * fit;
    const m = Math.max(1e-6, cfg.aspectRatioMul);
    const k = preserveAspectRatio ? 1 : Math.sqrt(m);
    const tw = tw0 * k;
    const th = th0 / k;
    ut.setContentSize(tw, th);
    node.setScale(1, 1, 1);

    // forward 单位向量（屏幕坐标系，y 向上）
    let ux: number;
    let uy: number;
    if (facingLerp) {
      const v = this.facingBlendScreenVec(u.pos, facingLerp.from, facingLerp.to, facingLerp.t);
      ux = v.ux;
      uy = v.uy;
    } else if (u.facing !== null) {
      const np = this.project(neighbor(u.pos, u.facing).q, neighbor(u.pos, u.facing).r);
      const dx = np.x - c.x;
      const dy = np.y - c.y;
      const len = Math.hypot(dx, dy) || 1;
      ux = dx / len;
      uy = dy / len;
    } else {
      ux = 1;
      uy = 0;
    }

    // 局部偏移 → 世界偏移：right = forward 顺时针 90°（屏幕 y 向上）= (uy, -ux)
    // dx = forward·ux + right·uy；dy = forward·uy + right·(-ux)
    // 单位采用「一格距离」= 相邻六角中心间距 = hexSize × √3，让 offset = 1.0 直观对应"挪一格"。
    const offsetUnit = this.hexSize * Math.sqrt(3);
    const f = cfg.offsetForward * offsetUnit;
    const r = cfg.offsetRight * offsetUnit;
    const ox = f * ux + r * uy;
    const oy = f * uy + r * (-ux);
    const angle = (Math.atan2(uy, ux) * 180) / Math.PI + 180;
    ut.setAnchorPoint(0.5, 0.5);
    node.setPosition(c.x + ox, c.y + oy, 0);
    node.angle = angle;
  }

  private splitHullDisplayBasis(kind: UnitKind): { trimW: number; trimH: number; fitScale: number; offsetForward: number; offsetRight: number } | null {
    switch (kind) {
      case 'sherman':
        return {
          trimW: BattleScene.SHERMAN_TOP_TRIM_W,
          trimH: BattleScene.SHERMAN_TOP_TRIM_H,
          fitScale: SHERMAN_SPLIT_VISUAL_CONFIG.hullFitScale,
          offsetForward: SHERMAN_SPLIT_VISUAL_CONFIG.hullOffsetForward,
          offsetRight: SHERMAN_SPLIT_VISUAL_CONFIG.hullOffsetRight,
        };
      case 'tiger':
        return {
          trimW: BattleScene.TIGER_TOP_TRIM_W,
          trimH: BattleScene.TIGER_TOP_TRIM_H,
          fitScale: TIGER_SPLIT_VISUAL_CONFIG.hullFitScale,
          offsetForward: TIGER_SPLIT_VISUAL_CONFIG.hullOffsetForward,
          offsetRight: TIGER_SPLIT_VISUAL_CONFIG.hullOffsetRight,
        };
      case 'panzer4':
        return {
          trimW: BattleScene.PANZER4_TOP_TRIM_W,
          trimH: BattleScene.PANZER4_TOP_TRIM_H,
          fitScale: PANZER4_SPLIT_VISUAL_CONFIG.hullFitScale,
          offsetForward: PANZER4_SPLIT_VISUAL_CONFIG.hullOffsetForward,
          offsetRight: PANZER4_SPLIT_VISUAL_CONFIG.hullOffsetRight,
        };
      case 'panzer3':
        return {
          trimW: BattleScene.PANZER3_TOP_TRIM_W,
          trimH: BattleScene.PANZER3_TOP_TRIM_H,
          fitScale: PANZER3_SPLIT_VISUAL_CONFIG.hullFitScale,
          offsetForward: PANZER3_SPLIT_VISUAL_CONFIG.hullOffsetForward,
          offsetRight: PANZER3_SPLIT_VISUAL_CONFIG.hullOffsetRight,
        };
      default:
        return null;
    }
  }

  private destroyedTankDisplaySize(kind: UnitKind, displayW: number, displayH: number, radius: number): { w: number; h: number } {
    const w = Math.max(1, displayW);
    const h = Math.max(1, displayH);
    const split = this.splitHullDisplayBasis(kind);
    if (split && split.trimH > 0) {
      const hullFit = radius * 1.8 * split.fitScale;
      const hullScale = hullFit / (Math.max(split.trimW, split.trimH) || 1);
      const targetVehicleWidth = split.trimH * hullScale;
      const scale = targetVehicleWidth / h;
      return { w: w * scale, h: h * scale };
    }

    const cfg = tankVisualConfigOf(kind);
    const fit = radius * 1.8 * cfg.fitScale;
    const scale = fit / (Math.max(w, h) || 1);
    const k = Math.sqrt(Math.max(1e-6, cfg.aspectRatioMul));
    return { w: w * scale * k, h: h * scale / k };
  }

  private destroyedTankOffset(kind: UnitKind, offsetUnit: number): { forward: number; right: number } {
    const cfg = tankVisualConfigOf(kind);
    const split = this.splitHullDisplayBasis(kind);
    return {
      forward: (split ? split.offsetForward : cfg.offsetForward) * offsetUnit + cfg.destroyedOffsetForward,
      right: (split ? split.offsetRight : cfg.offsetRight) * offsetUnit + cfg.destroyedOffsetRight,
    };
  }

  private applyDestroyedTopDownTankSprite(
    node: Node,
    sp: Sprite,
    sf: SpriteFrame,
    displayW: number,
    displayH: number,
    u: Unit,
    c: { x: number; y: number },
    facingLerp?: DirectionLerp | null,
  ) {
    node.active = true;
    const w = displayW > 0 ? displayW : sf.width;
    const h = displayH > 0 ? displayH : sf.height;
    const size = this.destroyedTankDisplaySize(u.kind, w, h, this.hexSize);
    const body = this.topDownForwardVec(u, c, facingLerp);
    const offsetUnit = this.hexSize * Math.sqrt(3);
    const offset = this.destroyedTankOffset(u.kind, offsetUnit);
    const f = offset.forward;
    const r = offset.right;

    sp.spriteFrame = sf;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    const ut = node.getComponent(UITransform)!;
    ut.setContentSize(size.w, size.h);
    ut.setAnchorPoint(0.5, 0.5);
    node.setScale(1, 1, 1);
    node.setPosition(c.x + f * body.ux + r * body.uy, c.y + f * body.uy + r * (-body.ux), 0);
    node.angle = (Math.atan2(body.uy, body.ux) * 180) / Math.PI + 180;
  }

  private applyShermanTurretSprite(
    u: Unit,
    c: { x: number; y: number },
    bodyFacingLerp?: DirectionLerp | null,
    turretFacingLerp?: DirectionLerp | null,
  ) {
    if (!this.shermanTurretSpriteNode || !this.shermanTurretTopSprite || !this.shermanTurretSpriteFrame) return;
    this.applyShermanTurretSpriteTo(
      { node: this.shermanTurretSpriteNode, sprite: this.shermanTurretTopSprite },
      u,
      c,
      bodyFacingLerp,
      turretFacingLerp,
    );
  }

  private applyShermanTurretSpriteTo(
    slot: { node: Node; sprite: Sprite },
    u: Unit,
    c: { x: number; y: number },
    bodyFacingLerp?: DirectionLerp | null,
    turretFacingLerp?: DirectionLerp | null,
  ) {
    if (!this.shermanTurretSpriteFrame) return;
    const sf = this.shermanTurretSpriteFrame;
    const node = slot.node;
    const sp = slot.sprite;
    const ut = node.getComponent(UITransform)!;
    const cfg = SHERMAN_SPLIT_VISUAL_CONFIG;
    const srcW = BattleScene.SHERMAN_TOP_TRIM_W;
    const srcH = BattleScene.SHERMAN_TOP_TRIM_H;
    const fit = this.hexSize * 1.8 * cfg.hullFitScale;
    const maxDim = Math.max(srcW, srcH) || 1;
    const tw0 = (srcW / maxDim) * fit;
    const th0 = (srcH / maxDim) * fit;
    const topW = tw0;
    const topH = th0;
    const scaleX = topW / srcW;
    const scaleY = topH / srcH;

    const body = this.topDownForwardVec(u, c, bodyFacingLerp);
    const turret = this.topDownForwardVec(u, c, turretFacingLerp);
    const offsetUnit = this.hexSize * Math.sqrt(3);
    const f = cfg.hullOffsetForward * offsetUnit;
    const r = cfg.hullOffsetRight * offsetUnit;
    const baseX = c.x + f * body.ux + r * body.uy;
    const baseY = c.y + f * body.uy + r * (-body.ux);
    const turretOffsetF = BattleScene.SHERMAN_TURRET_OFFSET_FORWARD * scaleX;
    const turretOffsetR = BattleScene.SHERMAN_TURRET_OFFSET_RIGHT * scaleY;

    const pivotLocalX = (BattleScene.SHERMAN_TURRET_PIVOT_X
      - (BattleScene.SHERMAN_TOP_TRIM_X + BattleScene.SHERMAN_TOP_TRIM_W / 2)) * scaleX;
    const pivotLocalY = ((BattleScene.SHERMAN_TOP_TRIM_Y + BattleScene.SHERMAN_TOP_TRIM_H / 2)
      - BattleScene.SHERMAN_TURRET_PIVOT_Y) * scaleY;
    const bodyAngle = Math.atan2(body.uy, body.ux) + Math.PI;
    const cos = Math.cos(bodyAngle);
    const sin = Math.sin(bodyAngle);

    sp.spriteFrame = sf;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    ut.setContentSize(
      BattleScene.SHERMAN_TURRET_TRIM_W * scaleX * cfg.turretScale,
      BattleScene.SHERMAN_TURRET_TRIM_H * scaleY * cfg.turretScale,
    );
    ut.setAnchorPoint(
      (BattleScene.SHERMAN_TURRET_SPRITE_PIVOT_X - BattleScene.SHERMAN_TURRET_TRIM_X) / BattleScene.SHERMAN_TURRET_TRIM_W,
      1 - ((BattleScene.SHERMAN_TURRET_SPRITE_PIVOT_Y - BattleScene.SHERMAN_TURRET_TRIM_Y) / BattleScene.SHERMAN_TURRET_TRIM_H),
    );
    node.setScale(1, 1, 1);
    node.setPosition(
      baseX + (pivotLocalX + turretOffsetF) * cos - (pivotLocalY + turretOffsetR) * sin,
      baseY + (pivotLocalX + turretOffsetF) * sin + (pivotLocalY + turretOffsetR) * cos,
      0,
    );
    node.angle = (Math.atan2(turret.uy, turret.ux) * 180) / Math.PI + 180;
    node.active = true;
  }

  private applySplitTankHullSprite(
    slot: { node: Node; sprite: Sprite },
    u: Unit,
    kind: SplitTankKind,
    c: { x: number; y: number },
    facingLerp?: DirectionLerp | null,
  ) {
    const assets = this.splitTankSprites[kind];
    if (!assets?.hull) return;

    const node = slot.node;
    const sp = slot.sprite;
    const ut = node.getComponent(UITransform)!;
    const cfg = splitTankVisualConfigOf(kind);
    const geometry = splitTankGeometryConfigOf(kind);
    const body = this.topDownForwardVec(u, c, facingLerp);
    const fit = this.hexSize * 1.8 * cfg.hullFitScale;
    const scale = fit / (Math.max(geometry.topTrim.w, geometry.topTrim.h) || 1);
    const offsetUnit = this.hexSize * Math.sqrt(3);
    const f = cfg.hullOffsetForward * offsetUnit;
    const r = cfg.hullOffsetRight * offsetUnit;

    sp.spriteFrame = assets.hull;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    ut.setContentSize(geometry.topTrim.w * scale, geometry.topTrim.h * scale);
    ut.setAnchorPoint(0.5, 0.5);
    node.setScale(1, 1, 1);
    node.setPosition(
      c.x + f * body.ux + r * body.uy,
      c.y + f * body.uy + r * (-body.ux),
      0,
    );
    node.angle = (Math.atan2(body.uy, body.ux) * 180) / Math.PI + 180;
    node.active = true;
  }

  private applySplitTankTurretSprite(
    slot: { node: Node; sprite: Sprite },
    u: Unit,
    kind: SplitTankKind,
    c: { x: number; y: number },
    bodyFacingLerp?: DirectionLerp | null,
    turretFacingLerp?: DirectionLerp | null,
  ) {
    const assets = this.splitTankSprites[kind];
    if (!assets?.turret) return;

    const node = slot.node;
    const sp = slot.sprite;
    const ut = node.getComponent(UITransform)!;
    const cfg = splitTankVisualConfigOf(kind);
    const geometry = splitTankGeometryConfigOf(kind);
    const topTrim = geometry.topTrim;
    const turretTrim = geometry.turretTrim;
    const pivot = geometry.pivot;
    const fit = this.hexSize * 1.8 * cfg.hullFitScale;
    const scale = fit / (Math.max(topTrim.w, topTrim.h) || 1);
    const turretScale = scale * cfg.turretScale;

    const body = this.topDownForwardVec(u, c, bodyFacingLerp);
    const turret = this.topDownForwardVec(u, c, turretFacingLerp);
    const offsetUnit = this.hexSize * Math.sqrt(3);
    const f = cfg.hullOffsetForward * offsetUnit;
    const r = cfg.hullOffsetRight * offsetUnit;
    const turretF = cfg.turretOffsetForward * offsetUnit;
    const turretR = cfg.turretOffsetRight * offsetUnit;
    const baseX = c.x + f * body.ux + r * body.uy;
    const baseY = c.y + f * body.uy + r * (-body.ux);

    const pivotLocalX = (pivot.bodyX - (topTrim.x + topTrim.w / 2)) * scale;
    const pivotLocalY = ((topTrim.y + topTrim.h / 2) - pivot.bodyY) * scale;
    const bodyAngle = Math.atan2(body.uy, body.ux) + Math.PI;
    const cos = Math.cos(bodyAngle);
    const sin = Math.sin(bodyAngle);

    sp.spriteFrame = assets.turret;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    ut.setContentSize(turretTrim.w * turretScale, turretTrim.h * turretScale);
    const anchorX = (pivot.spriteX - turretTrim.x) / turretTrim.w;
    const anchorY = 1 - ((pivot.spriteY - turretTrim.y) / turretTrim.h);
    ut.setAnchorPoint(
      anchorX + turretF / (turretTrim.w * turretScale),
      anchorY - turretR / (turretTrim.h * turretScale),
    );
    node.setScale(1, 1, 1);
    node.setPosition(
      baseX + pivotLocalX * cos - pivotLocalY * sin,
      baseY + pivotLocalX * sin + pivotLocalY * cos,
      0,
    );
    node.angle = (Math.atan2(turret.uy, turret.ux) * 180) / Math.PI + 180;
    node.active = true;
  }

  private topDownForwardVec(
    u: Unit,
    c: { x: number; y: number },
    facingLerp?: DirectionLerp | null,
  ): { ux: number; uy: number } {
    if (facingLerp) {
      if (!facingLerp.angular) {
        return this.facingBlendScreenVec(u.pos, facingLerp.from, facingLerp.to, facingLerp.t);
      }
      const a = this.directionScreenAngle(u.pos, c, facingLerp.from);
      const b = this.directionScreenAngle(u.pos, c, facingLerp.to);
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const ang = a + d * Math.min(1, Math.max(0, facingLerp.t));
      return { ux: Math.cos(ang), uy: Math.sin(ang) };
    }
    if (u.facing !== null) {
      const ang = this.directionScreenAngle(u.pos, c, u.facing);
      return { ux: Math.cos(ang), uy: Math.sin(ang) };
    }
    return { ux: 1, uy: 0 };
  }

  private directionScreenAngle(
    pos: { q: number; r: number },
    c: { x: number; y: number },
    dir: Direction,
  ): number {
    const np = this.project(neighbor(pos, dir).q, neighbor(pos, dir).r);
    return Math.atan2(np.y - c.y, np.x - c.x);
  }

  private updateShermanTopSprite(
    u: Unit,
    c: { x: number; y: number },
    facingLerp?: DirectionLerp | null,
  ) {
    const splitReady =
      this.shermanHullSpriteFrame &&
      this.shermanTurretSpriteFrame &&
      this.shermanTurretSpriteNode &&
      this.shermanTurretTopSprite;

    this.applyTopDownTankSprite(
      this.shermanSpriteNode!,
      this.shermanTopSprite!,
      splitReady ? this.shermanHullSpriteFrame! : this.shermanTopSpriteFrame!,
      splitReady ? this.shermanHullSpriteDisplayW : this.shermanSpriteDisplayW,
      splitReady ? this.shermanHullSpriteDisplayH : this.shermanSpriteDisplayH,
      u,
      c,
      facingLerp,
    );
    if (splitReady) {
      this.applyShermanTurretSprite(u, c, facingLerp, this.currentShermanTurretLerp(u) ?? facingLerp);
    }
    if (!u.destroyed && this.mapNode) {
      this.shermanSpriteNode!.setSiblingIndex(this.mapNode.children.length - 1);
      if (splitReady) {
        this.shermanTurretSpriteNode!.setSiblingIndex(this.mapNode.children.length - 1);
      }
    }
  }

  private currentShermanTurretLerp(u: Unit): DirectionLerp | null {
    if (this.turretAimAnim && this.turretAimAnim.unit === u) {
      return {
        from: this.turretAimAnim.from,
        to: this.turretAimAnim.to,
        t: easeInOutCubic(Math.min(1, Math.max(0, this.turretAimAnim.t))),
        angular: true,
      };
    }

    if (u === this.mission?.sherman && this.anim?.unit === u && u.facing !== null) {
      const from = (this.shermanTurretFacing ?? (this.anim.kind === 'turn' ? this.anim.turnFrom : u.facing)) as Direction;
      const to = (this.anim.kind === 'turn' ? this.anim.turnTo! : u.facing) as Direction;
      if (from === to) return null;
      if (this.anim.kind === 'turn' && from === this.anim.turnFrom) {
        return {
          from,
          to,
          t: Math.min(1, Math.max(0, this.anim.t)),
        };
      }
      return {
        from,
        to,
        t: easeInOutCubic(Math.min(1, Math.max(0, this.anim.t))),
        angular: true,
      };
    }

    if (this.shermanTurretFacing === null) return null;
    return {
      from: this.shermanTurretFacing,
      to: this.shermanTurretFacing,
      t: 1,
    };
  }

  private currentEnemyTurretLerp(u: Unit): DirectionLerp | null {
    if (this.turretAimAnim && this.turretAimAnim.unit === u) {
      return {
        from: this.turretAimAnim.from,
        to: this.turretAimAnim.to,
        t: easeInOutCubic(Math.min(1, Math.max(0, this.turretAimAnim.t))),
        angular: true,
      };
    }

    if (this.anim?.unit === u && u.facing !== null) {
      const stored = this.enemyTurretFacing.get(u.id);
      const from = (stored ?? (this.anim.kind === 'turn' ? this.anim.turnFrom : u.facing)) as Direction;
      const to = (this.anim.kind === 'turn' ? this.anim.turnTo! : u.facing) as Direction;
      if (from === to) return null;
      if (this.anim.kind === 'turn' && from === this.anim.turnFrom) {
        return {
          from,
          to,
          t: Math.min(1, Math.max(0, this.anim.t)),
        };
      }
      return {
        from,
        to,
        t: easeInOutCubic(Math.min(1, Math.max(0, this.anim.t))),
        angular: true,
      };
    }

    const facing = this.enemyTurretFacing.get(u.id);
    if (facing === undefined) return null;
    return { from: facing, to: facing, t: 1 };
  }

  private enemySupportsSplitTurret(u: Unit): boolean {
    if (!isSplitTankKind(u.kind)) return false;
    const assets = this.splitTankSprites[u.kind];
    return !!assets?.hull && !!assets.turret;
  }

  private drawDestroyedTankSprite(
    u: Unit,
    c: { x: number; y: number },
    facingLerp?: DirectionLerp | null,
  ): boolean {
    if (!isDestroyedTopKind(u.kind)) return false;
    const meta = this.destroyedTopMeta[u.kind];
    if (!meta) return false;

    if (u.kind === 'sherman' && u === this.mission?.sherman) {
      if (!this.shermanSpriteNode || !this.shermanTopSprite) return false;
      this.applyDestroyedTopDownTankSprite(
        this.shermanSpriteNode,
        this.shermanTopSprite,
        meta.sf,
        meta.dw,
        meta.dh,
        u,
        c,
        facingLerp,
      );
      return true;
    }

    if (this.enemyTopPoolNext >= this.enemyTopSpritePool.length) return false;
    const slot = this.enemyTopSpritePool[this.enemyTopPoolNext++];
    this.applyDestroyedTopDownTankSprite(
      slot.node,
      slot.sprite,
      meta.sf,
      meta.dw,
      meta.dh,
      u,
      c,
      facingLerp,
    );
    return true;
  }

  /**
   * 单位：俯视贴图坦克仅画精灵（朝向由贴图）；矢量回退车体为圆 + 黄色朝向短线。
   * overrideX/Y：动画插值格心；facingLerp：转向动画时插值炮口方向（不读 u.facing）。
   */
  private drawUnit(
    u: Unit,
    overrideX?: number,
    overrideY?: number,
    facingLerp?: DirectionLerp | null,
  ) {
    const g = this.g!;
    const c = overrideX !== undefined && overrideY !== undefined
      ? { x: overrideX, y: overrideY }
      : this.project(u.pos.q, u.pos.r);
    // 徒步类（步兵 / 军官）单独走一条更"像小人"的绘制路径，与坦克的大圆 + 朝向线拉开辨识度。
    if (isFootUnit(u)) {
      this.drawInfantry(u, c.x, c.y);
      return;
    }
    if (u.kind === 'sherman' && u === this.mission?.sherman && this.shermanSpriteNode) {
      if (u.destroyed || !this.shermanTopSpriteFrame) {
        this.shermanSpriteNode.active = false;
        if (this.shermanTurretSpriteNode) this.shermanTurretSpriteNode.active = false;
      }
    }
    const r = this.hexSize * 0.5;

    // 摧毁：暗灰色 + 穿心 X（仅本回合内显示；下回合起格上不再留残骸图）
    if (u.destroyed) {
      if (this.drawDestroyedTankSprite(u, c, facingLerp)) {
        return;
      }
      if (this.shouldShowDestroyWreckVisual(u)) {
        g.fillColor = DESTROYED_FILL;
        g.strokeColor = DESTROYED_BORDER;
        g.lineWidth = 2;
        g.circle(c.x, c.y, r);
        g.fill();
        g.stroke();
        g.strokeColor = DESTROYED_BORDER;
        g.lineWidth = 3;
        const d = r * 0.8;
        g.moveTo(c.x - d, c.y - d); g.lineTo(c.x + d, c.y + d); g.stroke();
        g.moveTo(c.x - d, c.y + d); g.lineTo(c.x + d, c.y - d); g.stroke();
        g.lineWidth = 2;
      }
      return; // 摧毁的单位不再画朝向线 / 车体精灵
    }

    // 谢尔曼俯视图精灵（已加载、未摧毁）：起火等状态用格子下图标表示，不再替换为矢量橙圆
    if (u.kind === 'sherman'
        && u === this.mission?.sherman
        && this.shermanTopSpriteFrame
        && this.shermanSpriteNode
        && this.shermanTopSprite) {
      this.updateShermanTopSprite(u, c, facingLerp);
      return;
    }

    // 德军俯视图：四号 / 三号 / 虎 / 卡（多辆用池；与谢尔曼同一套缩放/朝向/裁切缓存）
    if (isEnemyTopKind(u.kind)
        && this.enemyTopPoolNext < this.enemyTopSpritePool.length) {
      if (u.kind === 'sherman'
          && this.shermanHullSpriteFrame
          && this.shermanTurretSpriteFrame
          && this.enemyTopPoolNext + 1 < this.enemyTopSpritePool.length) {
        const hullSlot = this.enemyTopSpritePool[this.enemyTopPoolNext++];
        this.applyTopDownTankSprite(
          hullSlot.node,
          hullSlot.sprite,
          this.shermanHullSpriteFrame,
          this.shermanHullSpriteDisplayW,
          this.shermanHullSpriteDisplayH,
          u,
          c,
          facingLerp,
        );
        const turretSlot = this.enemyTopSpritePool[this.enemyTopPoolNext++];
        this.applyShermanTurretSpriteTo(turretSlot, u, c, facingLerp, this.currentEnemyTurretLerp(u) ?? facingLerp);
        return;
      }
      if (isSplitTankKind(u.kind)
          && u.kind !== 'sherman'
          && this.enemySupportsSplitTurret(u)
          && this.enemyTopPoolNext + 1 < this.enemyTopSpritePool.length) {
        const hullSlot = this.enemyTopSpritePool[this.enemyTopPoolNext++];
        this.applySplitTankHullSprite(hullSlot, u, u.kind, c, facingLerp);
        const turretSlot = this.enemyTopSpritePool[this.enemyTopPoolNext++];
        this.applySplitTankTurretSprite(turretSlot, u, u.kind, c, facingLerp, this.currentEnemyTurretLerp(u) ?? facingLerp);
        return;
      }
      const meta = this.enemyTopMeta[u.kind];
      if (meta?.sf) {
        const slot = this.enemyTopSpritePool[this.enemyTopPoolNext++];
        this.applyTopDownTankSprite(
          slot.node,
          slot.sprite,
          meta.sf,
          meta.dw,
          meta.dh,
          u,
          c,
          facingLerp,
        );
        return;
      }
    }

    // 起火：鲜橙填充 + 亮黄边 + 外层橙红环；只由 fireLevel 触发，普通 damaged 不再套用火焰外观。
    if (this.isOnFire(u)) {
      g.fillColor = ONFIRE_FILL;
      g.strokeColor = ONFIRE_BORDER;
      g.lineWidth = 3;
      g.circle(c.x, c.y, r);
      g.fill();
      g.stroke();
      // 外层橙红环（半透明），制造"火苗外沿"感
      g.strokeColor = ONFIRE_RING_OUT;
      g.lineWidth = 4;
      g.circle(c.x, c.y, r + 5);
      g.stroke();
      g.lineWidth = 2;
    } else {
      g.fillColor = FACTION_COLORS[u.faction];
      g.strokeColor = UNIT_BORDER;
      g.lineWidth = 2;
      g.circle(c.x, c.y, r);
      g.fill();
      g.stroke();
    }

    // PNG 车辆通过炮管/炮塔表达朝向；fallback 矢量车体不再额外画长朝向线，避免出现多余细边线。
  }

  /**
   * 步兵 / 军官渲染：用 Infantry01~03.png 三张俯视图组成"3 人小队"棋子，整体半径约占格 50%。
   *
   * 布局：等边三角形（朝上顶点 + 左下 / 右下两个底点），三角内接圆半径 `teamRadius·0.40`；
   * 单兵 sprite 显示尺寸 `hexSize·0.55`，最远点 ≈ teamRadius·0.475 → 占格半径 ≈ 50% ✓
   *
   * 资源未加载完时回退到老版本"圆头 + 圆身"矢量小人；击毙后不留残骸 / 标志 / 名字。
   * 军官 (kind='officer') 在小队外缘叠一圈红色光环，与说明书原图"红框建筑里的德军步兵"呼应。
   */
  private drawInfantry(u: Unit, cx: number, cy: number) {
    const g = this.g!;
    const teamRadius = this.hexSize * 0.5;

    if (u.destroyed) return;

    // 军官（kind='officer'）：单兵棋子（一张 Officer.png），与步兵主图（Infantry01）同尺寸；
    // "高级目标"的视觉提示由格子边线红框（OFFICER_TILE_STROKE，绘制于格 stroke 阶段）承担，
    // 不再在棋子周围画红圈光环，避免与红框重复。
    if (u.kind === 'officer') {
      const officerFit = this.hexSize * 0.58; // 与步兵 spriteFit 保持一致

      if (
        this.officerSpriteFrame &&
        this.officerTopPoolNext < this.officerTopSpritePool.length
      ) {
        const slot = this.officerTopSpritePool[this.officerTopPoolNext++];
        const sf = this.officerSpriteFrame;
        const { dw, dh } = this.officerSpriteDim;
        const w = dw > 0 ? dw : sf.width;
        const h = dh > 0 ? dh : sf.height;
        const maxDim = Math.max(w, h) || 1;
        const tw = (w / maxDim) * officerFit;
        const th = (h / maxDim) * officerFit;
        slot.sprite.spriteFrame = sf;
        slot.node.getComponent(UITransform)!.setContentSize(tw, th);
        slot.node.setPosition(cx, cy, 0);
        slot.node.angle = 0;
        slot.node.setScale(1, 1, 1);
        slot.node.active = true;
      } else {
        // 矢量回退（资源未加载完 / 池满）：圆头 + 身，与步兵回退一致
        const bodyR = this.hexSize * 0.30;
        const headR = this.hexSize * 0.16;
        const headOffset = this.hexSize * 0.28;
        g.fillColor = FACTION_COLORS[u.faction];
        g.strokeColor = UNIT_BORDER;
        g.lineWidth = 2;
        g.circle(cx, cy - bodyR * 0.15, bodyR);
        g.fill(); g.stroke();
        g.circle(cx, cy + headOffset, headR);
        g.fill(); g.stroke();
      }
      return;
    }

    // 资源加载完毕才用 sprite 小队；否则回退矢量小人，避免空白
    const allLoaded =
      this.infantrySpriteFrames[0] !== null &&
      this.infantrySpriteFrames[1] !== null &&
      this.infantrySpriteFrames[2] !== null;

    if (!allLoaded) {
      const bodyR = this.hexSize * 0.30;
      const headR = this.hexSize * 0.16;
      const headOffset = this.hexSize * 0.28;
      g.fillColor = FACTION_COLORS[u.faction];
      g.strokeColor = UNIT_BORDER;
      g.lineWidth = 2;
      g.circle(cx, cy - bodyR * 0.15, bodyR);
      g.fill(); g.stroke();
      g.circle(cx, cy + headOffset, headR);
      g.fill(); g.stroke();
      return;
    }

    // 同格车辆（坦克 / 卡车）检测：步兵棋子默认贴近格心 → 与同格的车辆几何重叠会糊成一团；
    // 当本格仍有非摧毁的车辆类单位时，把 3 个士兵从 0.27·hexSize 散开到 0.58·hexSize，
    // 让出格心给车辆显示，3 人各自朝顶 / 右下 / 左下方向退到格内切圆附近（仍保留三角阵相对关系）。
    let coLocateVehicle = false;
    if (this.mission && !u.destroyed) {
      const all: Unit[] = [this.mission.sherman, ...this.mission.allies, ...this.mission.enemies];
      for (const o of all) {
        if (o === u) continue;
        if (o.destroyed) continue;
        if (isFootUnit(o)) continue; // 同为徒步类不需要避让
        if (o.pos.q === u.pos.q && o.pos.r === u.pos.r) {
          coLocateVehicle = true;
          break;
        }
      }
    }

    // 等边三角形布局（顶点朝上）：3 个士兵中心位于半径 ringR 的小圆周上，间隔 120°
    //   位置 0（Infantry01，主图）：顶（cy + ringR）
    //   位置 1（Infantry02）：右下（cx + ringR·sin60°, cy - ringR·cos60°）
    //   位置 2（Infantry03）：左下（cx - ringR·sin60°, cy - ringR·cos60°）
    // 默认 ringR = teamRadius·0.546 ≈ hexSize·0.273（紧凑成队）；
    // 同格有车辆时 ringR = hexSize·0.58，三人散到格内切圆（≈ hexSize·0.866）附近，避开车辆体型。
    const ringR = coLocateVehicle ? this.hexSize * 0.58 : teamRadius * 0.546;
    const sin60 = Math.sqrt(3) / 2;
    const offsets: Array<{ ox: number; oy: number }> = [
      { ox: 0,                oy:  ringR },
      { ox:  ringR * sin60,   oy: -ringR * 0.5 },
      { ox: -ringR * sin60,   oy: -ringR * 0.5 },
    ];
    /** 单兵 sprite 显示尺寸（按图最长边等比缩放到该值） */
    const spriteFit = this.hexSize * 0.58;
    /** 第 1 个兵（Infantry01）保持基础大小，其余两个放大 15% 以视觉拉开「主兵 / 后排」层次 */
    const spriteFitByIndex = [spriteFit, spriteFit * 1.00, spriteFit * 1.15];

    for (let i = 0; i < BattleScene.INFANTRY_SPRITES_PER_UNIT; i++) {
      if (this.infantryTopPoolNext >= this.infantryTopSpritePool.length) break;
      const sf = this.infantrySpriteFrames[i];
      if (!sf) continue;
      const slot = this.infantryTopSpritePool[this.infantryTopPoolNext++];
      const dim = this.infantrySpriteDims[i];
      const w = dim.dw > 0 ? dim.dw : sf.width;
      const h = dim.dh > 0 ? dim.dh : sf.height;
      const maxDim = Math.max(w, h) || 1;
      const fitI = spriteFitByIndex[i];
      const tw = (w / maxDim) * fitI;
      const th = (h / maxDim) * fitI;
      slot.sprite.spriteFrame = sf;
      const ut = slot.node.getComponent(UITransform)!;
      ut.setContentSize(tw, th);
      const off = offsets[i];
      slot.node.setPosition(cx + off.ox, cy + off.oy, 0);
      slot.node.angle = 0;
      slot.node.setScale(1, 1, 1);
      slot.node.active = true;
    }
  }

  // ---------- HUD ----------

  /** 一次性创建 HUD：左上关卡 id+名、回合/阶段条、多行目标 + 右下角"结束回合"按钮。无需任何美术资源。 */
  private buildHUD() {
    // ---- 左上角最上行：关卡 id + 名（任务加载后由 `updateHUD` 灌文案）----
    const mNode = new Node('MissionTitleLabel');
    mNode.layer = this.node.layer;
    const mUT = mNode.addComponent(UITransform);
    mUT.setContentSize(540, HUD_MISSION_TITLE_H);
    mUT.setAnchorPoint(0, 1);
    const mLab = mNode.addComponent(Label);
    mLab.fontSize = 26;
    mLab.lineHeight = 30;
    mLab.color = HUD_MISSION_META_COLOR;
    mLab.horizontalAlign = HorizontalTextAlignment.LEFT;
    mLab.verticalAlign = VerticalTextAlignment.TOP;
    mLab.overflow = Label.Overflow.SHRINK;
    mLab.string = '';
    mNode.setPosition(-624, 344, 0);
    this.node.addChild(mNode);
    this.missionTitleLabel = mLab;

    // ---- 第二行起：回合数 + 阶段信息 ----
    const labelNode = new Node('HUDLabel');
    labelNode.layer = this.node.layer;
    const lUT = labelNode.addComponent(UITransform);
    lUT.setContentSize(420, 60);
    lUT.setAnchorPoint(0, 1); // 锚点在左上，方便对齐屏幕角
    const label = labelNode.addComponent(Label);
    label.fontSize = 22;
    label.lineHeight = 26;
    label.color = HUD_TEXT_COLOR;
    label.horizontalAlign = HorizontalTextAlignment.LEFT;
    label.verticalAlign = VerticalTextAlignment.TOP;
    label.string = t('hud.init');
    // 相对旧版下推：原顶 y=344
    labelNode.setPosition(-624, 344 - HUD_SHIFT_FOR_MISSION, 0);
    this.node.addChild(labelNode);
    this.hudLabel = label;

    // ---- 回合行下方：多行任务目标 ----
    const OBJ_FONT = 20;
    const OBJ_LINE = 26;
    const objStartY = 296 - HUD_SHIFT_FOR_MISSION;
    for (let i = 0; i < BattleScene.OBJECTIVE_HUD_MAX; i++) {
      const on = new Node(`ObjectiveHud${i}`);
      on.layer = this.node.layer;
      const out = on.addComponent(UITransform);
      out.setContentSize(520, OBJ_LINE);
      out.setAnchorPoint(0, 1);
      on.setPosition(-624, objStartY - i * OBJ_LINE, 0);
      const ol = on.addComponent(Label);
      ol.fontSize = OBJ_FONT;
      ol.lineHeight = OBJ_LINE;
      ol.horizontalAlign = HorizontalTextAlignment.LEFT;
      ol.verticalAlign = VerticalTextAlignment.TOP;
      ol.overflow = Label.Overflow.SHRINK;
      ol.string = '';
      ol.color = OBJ_HUD_ACTIVE;
      on.active = false;
      this.node.addChild(on);
      this.objectiveHudLabels.push(ol);
    }

    // ---- 右下角"结束回合"按钮 ----
    const btn = new Node('EndTurnButton');
    btn.layer = this.node.layer;
    const bUT = btn.addComponent(UITransform);
    const BTN_W = ADVANCE_BTN_W;
    const BTN_H = ADVANCE_BTN_H;
    bUT.setContentSize(BTN_W, BTN_H);
    bUT.setAnchorPoint(0.5, 0.5);
    // 与底部阶段条 / 骰子托盘同一水平中线，靠右留边距
    btn.setPosition(CANVAS_W * 0.5 - BTN_W * 0.5 - 20, BOTTOM_PHASE_ROW_Y, 0);

    // 背景 Graphics（直接挂在 btn 上）
    const bg = btn.addComponent(Graphics);
    this.endTurnBg = bg;
    this.drawEndTurnBg(false);

    // 文字 Label 作为子节点，自动叠在背景之上
    const txtNode = new Node('Label');
    txtNode.layer = this.node.layer;
    const tUT = txtNode.addComponent(UITransform);
    tUT.setContentSize(BTN_W, BTN_H);
    const txt = txtNode.addComponent(Label);
    txt.fontSize = 28;
    txt.lineHeight = 32;
    txt.color = HUD_TEXT_COLOR;
    txt.horizontalAlign = HorizontalTextAlignment.CENTER;
    txt.verticalAlign = VerticalTextAlignment.CENTER;
    txt.string = t('btn.nextPhase');
    btn.addChild(txtNode);
    this.endTurnLabel = txt;

    btn.on(Node.EventType.TOUCH_END, this.onAdvanceClicked, this);
    this.node.addChild(btn);
    this.endTurnBtn = btn;

    // ---- 右侧谢尔曼状态面板：须先于 ⚙ 创建，否则面板会盖在设置按钮上 ----
    this.buildStatusPanel();

    // ---- 右上角：事件表（先 addChild）→ 设置（后 addChild，保证 ⚙ 叠在上层可点） ----
    this.makeBattleCircleButton(
      this.node, BATTLE_TURNEND_LIST_CX, BATTLE_SETTINGS_CY, BATTLE_SETTINGS_R, '☰',
      () => this.openTurnEndEventsReference(),
    );
    this.makeBattleCircleButton(
      this.node, BATTLE_SETTINGS_CX, BATTLE_SETTINGS_CY, BATTLE_SETTINGS_R, '⚙',
      () => this.openBattleSettings(),
    );
  }

  /** 左下角战斗记录：ScrollView + 标题条点击放大；展开时全屏半透明遮罩点击缩小。 */
  private buildCombatLog() {
    const W0 = BattleScene.COMBAT_LOG_W0;
    const H0 = BattleScene.COMBAT_LOG_H0;
    const pad = BattleScene.COMBAT_LOG_PAD;
    const th = BattleScene.COMBAT_LOG_TITLE_H;
    const lx = -CANVAS_W * 0.5 + 12;
    const ly = -CANVAS_H * 0.5 + 12;

    const root = new Node('CombatLogRoot');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(1, 1);
    root.setPosition(0, 0, 0);
    this.node.addChild(root);
    this.combatLogRoot = root;

    const dim = new Node('CombatLogDimmer');
    dim.layer = this.node.layer;
    dim.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    dim.setPosition(0, 0, 0);
    dim.addComponent(BlockInputEvents);
    const dg = dim.addComponent(Graphics);
    dg.fillColor = new Color(0, 0, 0, 140);
    dg.rect(-CANVAS_W * 0.5, -CANVAS_H * 0.5, CANVAS_W, CANVAS_H);
    dg.fill();
    dim.active = false;
    dim.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      this.setCombatLogExpanded(false);
      e.propagationStopped = true;
    }, this);
    root.addChild(dim);
    this.combatLogDimmer = dim;

    const panel = new Node('CombatLogPanel');
    panel.layer = this.node.layer;
    const put = panel.addComponent(UITransform);
    put.setAnchorPoint(0, 0);
    put.setContentSize(W0, H0);
    panel.setPosition(lx, ly, 0);
    const pbg = panel.addComponent(Graphics);
    this.combatLogPanelBg = pbg;
    root.addChild(panel);
    this.combatLogPanel = panel;

    const scrollN = new Node('CombatLogScroll');
    scrollN.layer = this.node.layer;
    const sW = W0 - pad * 2;
    const sH = H0 - th - pad * 2.5;
    const scrollUT = scrollN.addComponent(UITransform);
    scrollUT.setContentSize(sW, sH);
    scrollUT.setAnchorPoint(0, 0);
    scrollN.setPosition(pad, pad, 0);
    panel.addChild(scrollN);
    const sv = scrollN.addComponent(ScrollView);
    sv.vertical = true;
    sv.horizontal = false;
    sv.inertia = true;
    sv.brake = 0.5;
    sv.verticalScrollBar = null;
    sv.horizontalScrollBar = null;

    const viewN = new Node('view');
    viewN.layer = this.node.layer;
    viewN.addComponent(Mask);
    const vut = viewN.addComponent(UITransform);
    vut.setAnchorPoint(0, 0);
    vut.setContentSize(sW, sH);
    viewN.setPosition(0, 0, 0);
    scrollN.addChild(viewN);
    this.combatLogViewN = viewN;

    const contentN = new Node('content');
    contentN.layer = this.node.layer;
    const cut = contentN.addComponent(UITransform);
    cut.setAnchorPoint(0.5, 1);
    cut.setContentSize(sW - 4, 80);
    // 与 view 锚点 (0,0)、尺寸 sW×sH 一致：顶中放在视口上沿（勿用默认 view 中心锚点 + (0,sH/2)，否则整段正文会错位到屏角）
    contentN.setPosition(sW * 0.5, sH, 0);
    viewN.addChild(contentN);
    const labN = new Node('Label');
    labN.layer = this.node.layer;
    const labUT = labN.addComponent(UITransform);
    labUT.setAnchorPoint(0, 1);
    labUT.setContentSize(sW - 4, 80);
    labN.setPosition(-(sW - 4) * 0.5, 0, 0);
    contentN.addChild(labN);
    const lab = labN.addComponent(Label);
    // 与标题「战斗记录」同档字号，避免正文过细；行高略大于字号保证正常长宽比
    lab.fontSize = BattleScene.COMBAT_LOG_BODY_FONT0;
    lab.lineHeight = BattleScene.COMBAT_LOG_BODY_LINE0;
    lab.color = new Color(230, 235, 242, 255);
    lab.horizontalAlign = HorizontalTextAlignment.LEFT;
    lab.verticalAlign = VerticalTextAlignment.TOP;
    lab.overflow = Label.Overflow.RESIZE_HEIGHT;
    lab.string = '';
    this.combatLogLabel = lab;
    this.combatLogContent = contentN;
    sv.content = contentN;
    this.combatLogScroll = sv;

    const head = new Node('CombatLogHead');
    head.layer = this.node.layer;
    const headUT = head.addComponent(UITransform);
    headUT.setContentSize(W0 - pad * 2, th);
    headUT.setAnchorPoint(0, 0);
    head.setPosition(pad, H0 - th - pad * 0.5, 0);
    const hl = head.addComponent(Label);
    hl.fontSize = 15;
    hl.lineHeight = 18;
    hl.color = new Color(200, 210, 225, 255);
    hl.horizontalAlign = HorizontalTextAlignment.LEFT;
    hl.verticalAlign = VerticalTextAlignment.CENTER;
    hl.string = t('battleLog.title');
    panel.addChild(head);
    this.combatLogTitleLab = hl;
    head.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      if (!this.combatLogExpanded) {
        playUiClick();
        this.setCombatLogExpanded(true);
      }
      e.propagationStopped = true;
    }, this);

    this.applyCombatLogChrome(false);
    this.combatLogLines = [];
    this.battleLogI18n('battleLog.ready');

    root.setSiblingIndex(Math.max(0, this.node.children.length - 1));
  }

  /**
   * 战斗记录正文可用宽度：必须以 ScrollView 的 view 视口宽为准，勿用内容节点在
   * `Label.updateRenderData` 之后的 `contentSize.width`（同节点上 Label 可能把宽收成「单行最窄宽」导致整段字被压成竖条）。
   */
  private getCombatLogBodyWidth(): number {
    const v = this.combatLogViewN?.getComponent(UITransform);
    if (!v) return 200;
    return Math.max(8, v.contentSize.width - 4);
  }

  private setCombatLogLabelFrame(width: number) {
    const lab = this.combatLogLabel;
    if (!lab) return;
    const lut = lab.node.getComponent(UITransform);
    if (!lut) return;
    lut.setAnchorPoint(0, 1);
    lut.setContentSize(width, Math.max(1, lut.contentSize.height));
    lab.node.setPosition(-width * 0.5, 0, 0);
  }

  private applyCombatLogTypography() {
    const lab = this.combatLogLabel;
    if (!lab) return;
    lab.fontSize = this.combatLogExpanded
      ? BattleScene.COMBAT_LOG_BODY_FONT1
      : BattleScene.COMBAT_LOG_BODY_FONT0;
    lab.lineHeight = this.combatLogExpanded
      ? BattleScene.COMBAT_LOG_BODY_LINE1
      : BattleScene.COMBAT_LOG_BODY_LINE0;
  }

  private combatLogText(entry: CombatLogEntry): string {
    if (typeof entry === 'string') return entry;
    const params = entry.params;
    if (entry.key === 'battleLog.hatch' && params?.stateKey) {
      return t(entry.key, { state: t(String(params.stateKey)) });
    }
    if (entry.key === 'battleLog.diceRoll' && params) {
      return t(entry.key, {
        dice: params.dice,
        count: params.count,
        phase: t(String(params.phaseKey)),
        terrain: t(String(params.terrainKey)),
        hatch: t(String(params.hatchKey)),
      });
    }
    if (entry.key === 'battleLog.diceAutoEnd' && params?.phaseKey) {
      return t(entry.key, { phase: t(String(params.phaseKey)) });
    }
    if (entry.key === 'battleLog.missionLoaded' && params) {
      return t(entry.key, {
        name: params.nameKey ? t(String(params.nameKey)) : params.name,
        tiles: params.tiles,
        allies: params.allies,
        enemies: params.enemies,
      });
    }
    if (entry.key === 'battleLog.unitArrived' && params) {
      return t(entry.key, {
        unit: t(`unit.name.${params.unitKind}`),
        q: params.q,
        r: params.r,
      });
    }
    if (entry.key === 'battleLog.unitTurnDone' && params) {
      return t(entry.key, {
        unit: t(`unit.name.${params.unitKind}`),
        facing: params.facing,
      });
    }
    if (entry.key === 'battleLog.unitEvacuated' && params) {
      return t(entry.key, {
        unit: t(`unit.name.${params.unitKind}`),
        outcome: t(`battleLog.outcome.${params.outcome}`),
      });
    }
    if (entry.key === 'battleLog.truckExitDefeat' && params) {
      return t(entry.key, { outcome: t(`battleLog.outcome.${params.outcome}`) });
    }
    if (entry.key === 'battleLog.move.turn' && params) {
      return t(entry.key, { dir: params.dir, facing: params.facing });
    }
    if (entry.key === 'battleLog.move.drive' && params) {
      return t(entry.key, {
        action: t(String(params.actionKey)),
        q: params.q,
        r: params.r,
      });
    }
    if (entry.key === 'battleLog.move.doublesDrive' && params) {
      return t(entry.key, { q: params.q, r: params.r });
    }
    if (entry.key === 'battleLog.move.doublesTurn' && params) {
      return t(entry.key, { dir: params.dir, facing: params.facing });
    }
    if (entry.key === 'battleLog.phaseSide' && params) {
      return t(entry.key, {
        turn: params.turn,
        side: t(String(params.sideKey)),
        count: params.count,
      });
    }
    if (entry.key === 'battleLog.combatMg' && params) {
      return t(entry.key, {
        diceExpr: params.diceExpr,
        need: params.need,
        result: t(String(params.resultKey)),
      });
    }
    if (entry.key.startsWith('battleLog.combat.') && params) {
      if (entry.key === 'battleLog.combat.cannotAttack') {
        return t(entry.key, { reason: t(String(params.reasonKey ?? 'attack.reason.unknown')) });
      }
      const actor = params.actorKey
        ? t(String(params.actorKey))
        : params.actorNameKey
          ? t('actor.enemyPrefix', { name: t(String(params.actorNameKey)) })
          : String(params.actorText ?? '');
      const target = params.targetKind ? t(`unit.name.${params.targetKind}`) : '';
      return t(entry.key, {
        actor,
        target,
        d1: params.d1,
        d2: params.d2,
        roll: params.roll,
        need: params.need,
        face: params.faceKey ? t(String(params.faceKey)) : params.face,
        armor: params.armor,
        pen: params.pen,
        penDie: params.penDie,
        penNeed: params.penNeed,
        dmgDie: params.dmgDie,
        effect: params.effectKey ? t(String(params.effectKey)) : String(params.effect ?? ''),
      });
    }
    if (entry.key === 'battleLog.misc.fireSuppress' && params) {
      return t(entry.key, { from: params.from, to: params.to });
    }
    return t(entry.key, params);
  }

  /** 写入战斗 UI 记录（并保留 console 便于开发器查看） */
  private battleLog(msg: string) {
    this.pushCombatLogEntry(msg);
  }

  private battleLogI18n(key: string, params?: CombatLogParams) {
    this.pushCombatLogEntry({ key, params });
  }

  private pushCombatLogEntry(entry: CombatLogEntry) {
    console.log(this.combatLogText(entry));
    if (!this.combatLogLabel) return;
    this.combatLogLines.push(entry);
    if (this.combatLogLines.length > BattleScene.COMBAT_LOG_MAX) {
      this.combatLogLines.splice(0, this.combatLogLines.length - BattleScene.COMBAT_LOG_MAX);
    }
    this.refreshCombatLogText();
  }

  private refreshCombatLogText() {
    if (!this.combatLogLabel) return;
    this.applyCombatLogTypography();
    this.setCombatLogLabelFrame(this.getCombatLogBodyWidth());
    this.combatLogLabel.string = this.combatLogLines.map(e => this.combatLogText(e)).join('\n');
    this.combatLogLabel.updateRenderData(true);
    const ut = this.combatLogContent?.getComponent(UITransform);
    if (ut && this.combatLogScroll) {
      const wBody = this.getCombatLogBodyWidth();
      this.setCombatLogLabelFrame(wBody);
      const h = Math.max(40, this.combatLogLabel.node.getComponent(UITransform)!.contentSize.height + BattleScene.COMBAT_LOG_BOTTOM_PAD);
      ut.setContentSize(wBody, h);
      this.scheduleOnce(() => this.syncCombatLogScrollAfterLayout(), 0);
    }
  }

  /**
   * 顶对齐战斗记录：内容高度 = 文本高度（至少 40）。
   * 仅当文本高于视口时才滚到底部看最新；否则滚到顶部，避免 scrollToBottom 把短正文滚没。
   */
  private syncCombatLogScrollAfterLayout() {
    const sv = this.combatLogScroll;
    const viewN = this.combatLogViewN;
    const contentN = this.combatLogContent;
    const lab = this.combatLogLabel;
    if (!sv?.isValid || !viewN || !contentN || !lab) return;
    const vh = viewN.getComponent(UITransform)!.contentSize.height;
    const cut = contentN.getComponent(UITransform)!;
    this.applyCombatLogTypography();
    this.setCombatLogLabelFrame(this.getCombatLogBodyWidth());
    lab.updateRenderData(true);
    const h = Math.max(40, lab.node.getComponent(UITransform)!.contentSize.height + BattleScene.COMBAT_LOG_BOTTOM_PAD);
    cut.setContentSize(this.getCombatLogBodyWidth(), h);
    const eps = 2;
    if (h > vh + eps) sv.scrollToBottom(0);
    else sv.scrollToTop(0);
  }

  private applyCombatLogChrome(_expanded: boolean) {
    const p = this.combatLogPanel;
    const bg = this.combatLogPanelBg;
    const lab = this.combatLogLabel;
    const tl = this.combatLogTitleLab;
    if (!p || !bg || !lab || !tl) return;
    // 放大后仍与折叠时相同的半透明深色底 + 浅色字（仅尺寸与字号在变）
    bg.fillColor = new Color(22, 24, 32, 245);
    bg.strokeColor = new Color(90, 96, 118, 255);
    lab.color = new Color(228, 233, 240, 255);
    tl.color = new Color(190, 200, 215, 255);
    const utp = p.getComponent(UITransform)!;
    const w = utp.contentSize.width;
    const h = utp.contentSize.height;
    bg.clear();
    bg.lineWidth = 2;
    bg.rect(0, 0, w, h);
    bg.fill();
    bg.rect(0, 0, w, h);
    bg.stroke();
  }

  private setCombatLogExpanded(expanded: boolean) {
    if (this.combatLogExpanded === expanded) return;
    this.combatLogExpanded = expanded;
    const panel = this.combatLogPanel;
    const dim = this.combatLogDimmer;
    const scrollN = this.combatLogScroll?.node;
    const viewN = this.combatLogViewN;
    const contentN = this.combatLogContent;
    if (!panel || !dim || !scrollN || !viewN || !contentN || !this.combatLogScroll) return;

    const W = expanded ? BattleScene.COMBAT_LOG_W1 : BattleScene.COMBAT_LOG_W0;
    const H = expanded ? BattleScene.COMBAT_LOG_H1 : BattleScene.COMBAT_LOG_H0;
    const pad = BattleScene.COMBAT_LOG_PAD;
    const th = BattleScene.COMBAT_LOG_TITLE_H;
    const lx = -CANVAS_W * 0.5 + 12;
    const ly = -CANVAS_H * 0.5 + 12;

    dim.active = expanded;
    const put = panel.getComponent(UITransform)!;
    put.setContentSize(W, H);
    panel.setPosition(lx, ly, 0);

    const head = panel.getChildByName('CombatLogHead');
    if (head) {
      head.getComponent(UITransform)!.setContentSize(W - pad * 2, th);
      head.setPosition(pad, H - th - pad * 0.5, 0);
    }

    const sW = W - pad * 2;
    const sH = H - th - pad * 2.5;
    scrollN.getComponent(UITransform)!.setContentSize(sW, sH);
    const vutE = viewN.getComponent(UITransform)!;
    vutE.setAnchorPoint(0, 0);
    vutE.setContentSize(sW, sH);
    contentN.setPosition(sW * 0.5, sH, 0);
    const cut = contentN.getComponent(UITransform)!;
    cut.setContentSize(sW - 4, cut.contentSize.height);

    this.applyCombatLogChrome(expanded);
    if (this.combatLogLabel) {
      this.applyCombatLogTypography();
      this.setCombatLogLabelFrame(sW - 4);
      this.combatLogLabel.updateRenderData(true);
      const lh = Math.max(40, this.combatLogLabel.node.getComponent(UITransform)!.contentSize.height + BattleScene.COMBAT_LOG_BOTTOM_PAD);
      cut.setContentSize(sW - 4, lh);
    }
    this.scheduleOnce(() => {
      this.syncCombatLogScrollAfterLayout();
    }, 0);
    panel.setSiblingIndex(this.combatLogRoot!.children.length - 1);
  }

  /** 简版按钮工厂：静态背景色，无状态切换，比结束回合按钮简单。 */
  private makeSimpleButton(
    name: string,
    text: string,
    x: number, y: number,
    bgColor: Color,
    onClick: () => void,
  ): Node {
    const W = 140, H = 48;
    const btn = new Node(name);
    btn.layer = this.node.layer;
    const bUT = btn.addComponent(UITransform);
    bUT.setContentSize(W, H);
    bUT.setAnchorPoint(0.5, 0.5);
    btn.setPosition(x, y, 0);

    const bg = btn.addComponent(Graphics);
    drawFieldPanel(bg, W, H, bgColor, BTN_BORDER, STATUS_TITLE_COLOR);

    const txtNode = new Node('Label');
    txtNode.layer = this.node.layer;
    txtNode.addComponent(UITransform).setContentSize(W, H);
    const txt = txtNode.addComponent(Label);
    txt.fontSize = 24;
    txt.lineHeight = 28;
    txt.color = HUD_TEXT_COLOR;
    txt.horizontalAlign = HorizontalTextAlignment.CENTER;
    txt.verticalAlign = VerticalTextAlignment.CENTER;
    txt.string = text;
    btn.addChild(txtNode);

    btn.on(Node.EventType.TOUCH_END, () => {
      playUiClick();
      onClick();
    }, this);
    this.node.addChild(btn);
    return btn;
  }

  // ---------- 谢尔曼状态面板 ----------

  /**
   * 右侧常驻信息面板（自上而下）：
   *   ┌──────────────────┐
   *   │   谢尔曼状态       │
   *   │  装填    已装填    │
   *   │  炮塔    完好      │
   *   │  机动    正常      │
   *   │  着火程度  2 / -   │
   *   │  ─────────────     │
   *   │   乘员             │
   *   │  ① 车长  打开/关闭  │  ← 与舱盖合并：阵亡显示「阵亡」；存活可点切换舱盖
   *   │  ② 装填手 …        │
   *   │  …                 │
   *   └──────────────────┘
   *
   * 每行左列 = 灰色固定名字，右列 = 根据数据着色的状态文字；
   * refresh 时只改 string + color，不重建节点。
   */
  private buildStatusPanel() {
    const W = 240;
    const GAP_BELOW_GEAR = 10;
    const panelTopY = BATTLE_SETTINGS_CY - BATTLE_SETTINGS_R - GAP_BELOW_GEAR;
    const H = 312;
    const y = panelTopY - H / 2;
    // 整体靠右，贴近屏缘（与 ⚙ 错层由子节点顺序保证可点）
    const x = CANVAS_W * 0.5 - W * 0.5 - 10;

    const CREW_GAP = 22;
    const BODY_GAP = 22;
    const innerTop = H / 2 - 8;
    const shermanTitleY = innerTop - 14;
    const bodyFirstY = shermanTitleY - 24;
    const bodyRowY = [0, 1, 2, 3].map(j => bodyFirstY - j * BODY_GAP);
    const sepY = bodyRowY[bodyRowY.length - 1] - 20;
    const crewTitleY = sepY - 18;
    const crewFirstY = crewTitleY - 26;

    const panel = new Node('ShermanStatus');
    panel.layer = this.node.layer;
    panel.addComponent(UITransform).setContentSize(W, H);
    panel.setPosition(x, y, 0);
    const bg = panel.addComponent(Graphics);
    drawFieldPanel(bg, W, H, STATUS_PANEL_BG, STATUS_PANEL_BORDER, STATUS_TITLE_COLOR);
    bg.strokeColor = new Color(145, 138, 100, 190);
    bg.lineWidth = 1;
    bg.moveTo(-W / 2 + 16, sepY);
    bg.lineTo( W / 2 - 16, sepY);
    bg.stroke();
    this.node.addChild(panel);
    this.statusPanel = panel;

    this.statusBodyLeftLabels = [];
    this.statusCrewLeftLabels = [];

    // 1) 乘员区（在「谢尔曼状态」之下）
    this.statusCrewTitleLabel = this.makeCenteredLabel(panel, t('status.row.crewTitle'),
      0, crewTitleY, W - 20, 22, 18, STATUS_TITLE_COLOR);

    const crewNames = [
      t('status.crew.1'),
      t('status.crew.2'),
      t('status.crew.3'),
      t('status.crew.4'),
      t('status.crew.5'),
    ];
    this.statusCrewLabels = [];
    for (let i = 0; i < crewNames.length; i++) {
      const rowY = crewFirstY - i * CREW_GAP;
      const crewLeft = this.makeLeftLabel(panel, crewNames[i], -W / 2 + 20, rowY, 116, 22, 18, STATUS_LABEL_COLOR);
      this.statusCrewLeftLabels.push(crewLeft);
      const val = this.makeRightLabel(panel, t('status.val.crewAlive'), W / 2 - 20, rowY, 88, 22, 18, STATUS_VALUE_OK);
      this.statusCrewLabels.push(val);
    }

    // 2) 谢尔曼状态：装填 → 炮塔 → 机动 → 着火程度（仅层数 / 未着火「-」）
    this.statusPanelTitleLabel = this.makeCenteredLabel(panel, t('status.panelTitle'),
      0, shermanTitleY, W - 20, 28, 22, STATUS_TITLE_COLOR);
    const bodyRows: Array<[string, 'loaded' | 'turret' | 'mobility' | 'fire']> = [
      [t('status.row.loaded'),    'loaded'],
      [t('status.row.turret'),    'turret'],
      [t('status.row.mobility'),  'mobility'],
      [t('status.row.fireLevel'), 'fire'],
    ];
    for (let i = 0; i < bodyRows.length; i++) {
      const [label, key] = bodyRows[i];
      const leftLab = this.makeLeftLabel(panel, label, -W / 2 + 20, bodyRowY[i], 100, 22, 18, STATUS_LABEL_COLOR);
      this.statusBodyLeftLabels.push(leftLab);
      const val = this.makeRightLabel(panel, '—', W / 2 - 20, bodyRowY[i], 120, 22, 18, STATUS_VALUE_DOWN);
      switch (key) {
        case 'loaded':   this.statusLoaded = val; break;
        case 'fire':     this.statusFire = val; break;
        case 'turret':   this.statusTurret = val; break;
        case 'mobility': this.statusMobility = val; break;
      }
    }
  }

  /** 左对齐 Label；用 anchor(0, 0.5) 让 x 成为"左边线位置"。 */
  private makeLeftLabel(
    parent: Node, text: string,
    x: number, y: number, w: number, h: number,
    fontSize: number, color: Color,
  ): Label {
    const n = new Node('L');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(w, h);
    ut.setAnchorPoint(0, 0.5);
    n.setPosition(x, y, 0);
    const l = n.addComponent(Label);
    l.fontSize = fontSize;
    l.lineHeight = fontSize + 4;
    l.color = color;
    l.horizontalAlign = HorizontalTextAlignment.LEFT;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.overflow = Label.Overflow.CLAMP;
    l.string = text;
    parent.addChild(n);
    return l;
  }

  /** 右对齐 Label；用 anchor(1, 0.5) 让 x 成为"右边线位置"。 */
  private makeRightLabel(
    parent: Node, text: string,
    x: number, y: number, w: number, h: number,
    fontSize: number, color: Color,
  ): Label {
    const n = new Node('R');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(w, h);
    ut.setAnchorPoint(1, 0.5);
    n.setPosition(x, y, 0);
    const l = n.addComponent(Label);
    l.fontSize = fontSize;
    l.lineHeight = fontSize + 4;
    l.color = color;
    l.horizontalAlign = HorizontalTextAlignment.RIGHT;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.overflow = Label.Overflow.CLAMP;
    l.string = text;
    parent.addChild(n);
    return l;
  }

  /**
   * 把当前谢尔曼状态同步到右侧面板。调用点：每次 redraw() 末尾，
   * 或任何改动 loaded/damaged/destroyed/crew 的分支显式调用。
   */
  private refreshStatusPanel() {
    if (!this.statusPanel || !this.mission) return;
    const s = this.mission.sherman;

    // 装填
    if (this.statusLoaded) {
      if (s.destroyed) {
        this.statusLoaded.string = '—';
        this.statusLoaded.color = STATUS_VALUE_DOWN;
      } else if (s.loaded) {
        this.statusLoaded.string = t('status.val.loaded');
        this.statusLoaded.color = STATUS_VALUE_OK;
      } else {
        this.statusLoaded.string = t('status.val.unloaded');
        this.statusLoaded.color = STATUS_VALUE_DOWN;
      }
    }

    // 着火程度：仅当前层数；未着火「-」；已毁该行无意义
    if (this.statusFire) {
      if (s.destroyed) {
        this.statusFire.string = '—';
        this.statusFire.color = STATUS_VALUE_DOWN;
      } else if ((s.fireLevel ?? 0) > 0) {
        this.statusFire.string = String(s.fireLevel ?? 0);
        this.statusFire.color = STATUS_VALUE_FIRE;
      } else {
        this.statusFire.string = '-';
        this.statusFire.color = STATUS_VALUE_DOWN;
      }
    }

    // 炮塔（受损后不能主炮射击）
    if (this.statusTurret) {
      if (s.destroyed) {
        this.statusTurret.string = '—';
        this.statusTurret.color = STATUS_VALUE_DOWN;
      } else if (s.turretDamaged) {
        this.statusTurret.string = t('status.val.damaged');
        this.statusTurret.color = STATUS_VALUE_DEAD;
      } else {
        this.statusTurret.string = t('status.val.intact');
        this.statusTurret.color = STATUS_VALUE_OK;
      }
    }

    // 机动（痛痪后不能前进/后退/转向）
    if (this.statusMobility) {
      if (s.destroyed) {
        this.statusMobility.string = '—';
        this.statusMobility.color = STATUS_VALUE_DOWN;
      } else if (s.paralyzed) {
        this.statusMobility.string = t('status.val.paralyzed');
        this.statusMobility.color = STATUS_VALUE_DEAD;
      } else {
        this.statusMobility.string = t('status.val.normal');
        this.statusMobility.color = STATUS_VALUE_OK;
      }
    }

    // 乘员：车长行显示舱盖三态，其余乘员显示存活 / 阵亡。
    const crew = s.crew;
    const crewFlags: boolean[] = crew
      ? [crew.commander, crew.loader, crew.gunner, crew.driver, crew.coDriver]
      : [true, true, true, true, true];

    for (let i = 0; i < this.statusCrewLabels.length; i++) {
      const lab = this.statusCrewLabels[i];
      if (s.destroyed) {
        lab.string = t('status.val.crewDead');
        lab.color = STATUS_VALUE_DEAD;
      } else if (i === 0 && crewFlags[i]) {
        lab.string = s.hatchOpen ? t('status.val.hatchOpen') : t('status.val.hatchClosed');
        lab.color = s.hatchOpen ? STATUS_VALUE_WARN : STATUS_VALUE_DOWN;
      } else if (!crewFlags[i]) {
        lab.string = t('status.val.crewDead');
        lab.color = STATUS_VALUE_DEAD;
      } else {
        lab.string = t('status.val.crewAlive');
        lab.color = STATUS_VALUE_OK;
      }
    }
    this.refreshChooseHatchButton();
  }

  /** 绘制结束回合按钮的背景。urgent=true 时换提醒色。 */
  private drawEndTurnBg(urgent: boolean) {
    if (!this.endTurnBg) return;
    const g = this.endTurnBg;
    g.clear();
    drawFieldPanel(g, ADVANCE_BTN_W, ADVANCE_BTN_H, urgent ? BTN_BG_URGENT : BTN_BG_NORMAL, BTN_BORDER, STATUS_TITLE_COLOR);
  }

  private updateHUD() {
    if (this.missionTitleLabel && this.mission) {
      const d = this.mission.data;
      const meta = findLevelByMissionId(d.id);
      const nameStr = meta ? t(meta.titleKey) : d.name;
      this.missionTitleLabel.string = t('hud.missionLine', { id: missionDisplayId(d.id), name: nameStr });
    }

    if (this.hudLabel) {
      if (this.phase !== 'player') {
        this.hudLabel.string = t('hud.enemyTurn', { n: this.turn });
      } else if (this.playerStep === 'choose') {
        const doneTag = [
          this.movementDone ? t('hud.moveDone')   : t('hud.moveTodo'),
          this.attackDone   ? t('hud.attackDone') : t('hud.attackTodo'),
        ].join(' ');
        this.hudLabel.string = t('hud.playerChoose', { n: this.turn, tags: doneTag });
      } else if (this.playerStep === 'movement') {
        this.hudLabel.string = t('hud.movePhase', { n: this.turn, dice: this.remainingDice() });
      } else if (this.playerStep === 'misc') {
        this.hudLabel.string = t('hud.miscPhase', { n: this.turn, dice: this.remainingDice() });
      } else {
        const sherman = this.mission?.sherman;
        const loaded = sherman?.loaded ? t('hud.loaded') : t('hud.unloaded');
        // 选中主炮 → "点敌人开火"；选中机枪 → "点步兵扫射"；两者互斥
        let sel = '';
        if (this.selectedGunDieIdx >= 0) sel = ` | ${t('hud.attackSelectHint')}`;
        else if (this.selectedMGDieIdx >= 0) sel = ` | ${t('hud.mgSelectHint')}`;
        this.hudLabel.string = t('hud.attackPhase', {
          n: this.turn,
          loaded,
          dice: this.remainingDice(),
          sel,
        });
      }
    }

    const adv = this.computeAdvanceButton();
    this.drawEndTurnBg(adv.urgent);
    if (this.endTurnLabel) this.endTurnLabel.string = adv.label;

    this.refreshObjectiveHud();
  }

  /** 将单条目标模板展开为带序号的完整行（i18n）。 */
  private formatObjectiveHudLine(line: ObjHudLine): string {
    const pfx = t('objective.prefix', { n: line.displayIndex });
    const tpl = line.template;
    switch (tpl.key) {
      case 'destroyProgress':
        return pfx + t(objectiveDestroyProgressLangKey(tpl.unitKind), {
          unit: t(`unit.name.${tpl.unitKind}`),
          cur: tpl.cur,
          total: tpl.total,
        });
      case 'evacFromMark':
        return pfx + t('objective.evacFromMark');
      case 'destroyAll':
        return pfx + t('objective.destroyAllProgress', { cur: tpl.cur, total: tpl.total });
      case 'destroyTruck':
        return pfx + t('objective.destroyTruckProgress', { cur: tpl.cur, total: tpl.total });
      case 'usCasualties':
        return t('objective.usCasualties', { cur: tpl.cur, limit: tpl.limit });
      case 'exitEdge':
        return pfx + t('objective.exitEdge');
      case 'unknownType':
        return pfx + t('objective.typeUnknown', { type: tpl.type });
      default:
        return pfx;
    }
  }

  private objectiveHudColor(state: ObjHudLine['state']): Color {
    if (state === 'done') return OBJ_HUD_DONE;
    if (state === 'locked') return OBJ_HUD_LOCKED;
    return OBJ_HUD_ACTIVE;
  }

  /** 刷新左上角任务目标多行（胜负已分仍显示最终状态）。 */
  private refreshObjectiveHud() {
    for (let i = 0; i < this.objectiveHudLabels.length; i++) {
      const lab = this.objectiveHudLabels[i];
      lab.node.active = false;
    }
    if (!this.mission) return;

    const rows = buildObjectiveHudLines(this.mission);
    for (let i = 0; i < rows.length && i < this.objectiveHudLabels.length; i++) {
      const lab = this.objectiveHudLabels[i];
      const row = rows[i];
      lab.string = this.formatObjectiveHudLine(row);
      lab.color = this.objectiveHudColor(row.state);
      lab.node.active = true;
    }
  }

  /** 托盘里还剩几颗骰子未执行（用于 HUD 展示） */
  private remainingDice(): string {
    if (this.phaseDice.length === 0) return '-';
    const left = this.phaseDice.filter(d => !d.used).length;
    return `${left}/${this.phaseDice.length}`;
  }

  /**
   * 根据当前子状态算出右下角按钮的显示文字与配色：
   *   - 杂项子阶段内 →「结束回合」强调色（结束杂项并进入敌方）
   *   - 移动 / 攻击子阶段 →「下一阶段」（提前结束本子阶段）
   *   - 选择阶段且 A+B 已完成、杂项未自动触发前 →「下一阶段」（与自动进杂项并存，作补点）
   *   - 其余玩家选择阶段 →「下一阶段」（蓝）
   *   - 敌方阶段 →「敌方回合中」
   */
  private computeAdvanceButton(): { label: string; urgent: boolean } {
    if (this.phase !== 'player') return { label: t('btn.enemyTurnRunning'), urgent: false };
    if (this.playerStep === 'misc') return { label: t('btn.endTurn'), urgent: true };
    if (this.playerStep === 'movement' || this.playerStep === 'attack') {
      return { label: t('btn.nextPhase'), urgent: false };
    }
    return { label: t('btn.nextPhase'), urgent: false };
  }

  /** 胜负覆盖层：懒创建，仅在 outcome 非 ongoing 时显示，并联动"再来一局"按钮的可见性 */
  private updateOutcomeOverlay() {
    if (this.outcome === 'ongoing') {
      if (this.outcomeLabel) this.outcomeLabel.node.active = false;
      if (this.restartBtn) this.restartBtn.active = false;
      if (this.backToMenuBtn) this.backToMenuBtn.active = false;
      return;
    }
    // 胜利时回写菜单进度，下次主菜单会显示 ★ 并解锁下一关。
    // markCompleted 内部幂等，重复调用无副作用。
    const completedLevel = findLevelByMissionId(this.missionId);
    if (this.outcome === 'victory' && completedLevel) {
      MenuProgress.markCompleted(completedLevel.id, completedLevel.chapterId);
    }
    if (!this.outcomeLabel) {
      const n = new Node('OutcomeLabel');
      n.layer = this.node.layer;
      const ut = n.addComponent(UITransform);
      ut.setContentSize(600, 120);
      ut.setAnchorPoint(0.5, 0.5);
      n.setPosition(0, 0, 0);
      const l = n.addComponent(Label);
      l.fontSize = 72;
      l.lineHeight = 84;
      l.horizontalAlign = HorizontalTextAlignment.CENTER;
      l.verticalAlign = VerticalTextAlignment.CENTER;
      this.node.addChild(n);
      this.outcomeLabel = l;
    }
    this.outcomeLabel.node.active = true;
    if (this.outcome === 'victory') {
      this.outcomeLabel.string = t('outcome.win');
      this.outcomeLabel.color = new Color(255, 230, 80, 255);
    } else {
      this.outcomeLabel.string = t('outcome.lose');
      this.outcomeLabel.color = new Color(255, 80, 80, 255);
    }

    // "再来一局"按钮：左，"返回主菜单"按钮：右。makeSimpleButton 宽 140，间距 20。
    if (!this.restartBtn) {
      this.restartBtn = this.makeSimpleButton(
        'RestartBtn', t('btn.restart'),
        -80, -90,
        BTN_BG_NORMAL,
        () => this.restartMission(),
      );
      this.restartBtnLabel = this.restartBtn.getChildByName('Label')?.getComponent(Label) ?? null;
    }
    if (!this.backToMenuBtn) {
      this.backToMenuBtn = this.makeSimpleButton(
        'BackToMenuBtn', t('btn.backToMenu'),
        80, -90,
        new Color(80, 60, 130, 230),
        () => this.onBackToMenu(),
      );
      this.backToMenuBtnLabel = this.backToMenuBtn.getChildByName('Label')?.getComponent(Label) ?? null;
    }
    this.restartBtn.active = true;
    this.backToMenuBtn.active = true;
    // 保证按钮在最上层（避免被后续 redraw 创建的浮字 / 状态文字盖住的视觉印象）
    this.restartBtn.setSiblingIndex(this.node.children.length - 1);
    this.backToMenuBtn.setSiblingIndex(this.node.children.length - 1);
  }

  private onBackToMenu() {
    this.battleLog('[BattleScene] 返回主菜单');
    director.loadScene(this.mainMenuSceneName, (err) => {
      if (err) console.error('[BattleScene] 加载主菜单场景失败:', this.mainMenuSceneName, err);
    });
  }

  /**
   * 重开当前任务：丢弃 mission 引用并用同一份 MissionData 重新走 loadAndDraw，
   * 这样所有 Unit 都会被 makeUnit 重新构造（damaged/destroyed 自然为 undefined）。
   * 同时清干净动画 / 敌方调度残留状态，避免上一局尾巴串到下一局。
   */
  private restartMission() {
    if (!this.mission) return;
    const data = this.mission.data;
    // 中断动画与敌方阶段调度，丢弃所有过场视觉 / 阶段残留
    stopManeuverSound();
    this.anim = null;
    this.animQueue = [];
    this.pendingAfterAnimChain = null;
    this.finalizeDiceShow(true);
    this.destroyTurnEndEventUI();
    this.destroyFireCheckEventUI();
    this.destroyUsCasualtyEventUI();
    this.enemyOrder = [];
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceUsed = [];
    this.destroyEnemyDiceTray();
    this.playerDiceRollAnim = null;
    this.playerDiceSortAnim = null;
    this.phaseDice = [];
    this.clearGunSelection();
    this.movementDone = false;
    this.attackDone = false;
    this.miscDone = false;
    this.playerStep = 'choose';
    this.closeDiePopover();
    this.clearFloaters();
    this.clearMuzzleFlashes();
    // 隐藏胜负覆盖层与按钮（loadAndDraw 内部 updateOutcomeOverlay 也会再做一次保险）
    if (this.outcomeLabel) this.outcomeLabel.node.active = false;
    if (this.restartBtn) this.restartBtn.active = false;
    this.loadAndDraw(data);
    this.battleLog('[BattleScene] === 重开当前任务 ===');
  }

  // ---------- 阶段选择条 + 骰子托盘 ----------

  /** 底部阶段选择条：舱盖 + 移动 / 攻击 三个大按钮水平居中，仅在 playerStep === 'choose' 时可见。 */
  private buildChooseBar() {
    const bar = new Node('ChooseBar');
    bar.layer = this.node.layer;
    const ut = bar.addComponent(UITransform);
    const BTN_W = 200;
    const GAP = 20;
    const BTN_H = 72;
    // 三钮：舱盖 + 移动 + 攻击
    ut.setContentSize(BTN_W * 3 + GAP * 2, 80);
    ut.setAnchorPoint(0.5, 0.5);
    bar.setPosition(0, BOTTOM_PHASE_ROW_Y, 0);
    this.node.addChild(bar);
    this.chooseBar = bar;

    const makeBtn = (name: string, text: string, x: number, color: Color,
                     onClick: () => void): { root: Node; label: Label } => {
      const W = BTN_W, H = BTN_H;
      const b = new Node(name);
      b.layer = this.node.layer;
      b.addComponent(UITransform).setContentSize(W, H);
      b.setPosition(x, 0, 0);
      const bg = b.addComponent(Graphics);
      bg.fillColor = color;
      bg.strokeColor = BTN_BORDER;
      bg.lineWidth = 2;
      bg.rect(-W / 2, -H / 2, W, H);
      bg.fill();
      bg.stroke();
      const txtNode = new Node('Label');
      txtNode.layer = this.node.layer;
      txtNode.addComponent(UITransform).setContentSize(W, H);
      const tx = txtNode.addComponent(Label);
      tx.fontSize = 28;
      tx.lineHeight = 32;
      tx.color = HUD_TEXT_COLOR;
      tx.horizontalAlign = HorizontalTextAlignment.CENTER;
      tx.verticalAlign = VerticalTextAlignment.CENTER;
      tx.overflow = Label.Overflow.SHRINK;
      tx.string = this.fitEnglishText(text, W, tx.fontSize);
      b.addChild(txtNode);
      b.on(Node.EventType.TOUCH_END, () => {
        playUiClick();
        onClick();
      }, this);
      bar.addChild(b);
      return { root: b, label: tx };
    };
    const step = BTN_W + GAP;
    const hx = makeBtn('ChooseHatch', t('btn.hatchOpen'), -step,
      PHASE_BTN_HATCH, () => this.onChooseHatchClick());
    this.chooseHatchBtn = hx.root;
    this.chooseHatchLabel = hx.label;
    const mv = makeBtn('ChooseMove', t('btn.movePhase'), 0,
      PHASE_BTN_MOVE, () => this.enterPhase('movement'));
    this.chooseMoveBtn = mv.root;
    this.chooseMoveLabel = mv.label;
    const at = makeBtn('ChooseAttack', t('btn.attackPhase'), step,
      PHASE_BTN_ATTACK, () => this.enterPhase('attack'));
    this.chooseAttackBtn = at.root;
    this.chooseAttackLabel = at.label;
  }

  /** 选择阶段条上的舱盖按钮：与右侧状态栏点击共享 tryToggleHatch 规则。车长阵亡时灰显且无声。 */
  private onChooseHatchClick() {
    if (this.isBusy()) return;
    if (!this.mission) return;
    const s = this.mission.sherman;
    if (s.crew && !s.crew.commander) return;
    this.tryToggleHatch();
  }

  /** 刷新舱盖按钮文案与底色（选择阶段、车长存活状态、当前舱盖开闭）。 */
  private refreshChooseHatchButton() {
    if (!this.chooseHatchBtn || !this.chooseHatchLabel || !this.mission) return;
    const s = this.mission.sherman;
    const commanderDead = !!(s.crew && !s.crew.commander);
    if (commanderDead) {
      this.chooseHatchLabel.string = this.fitTextForLabel(this.chooseHatchLabel, t('btn.hatchCommanderKia'), 200);
      this.setPhaseBtnEnabled(this.chooseHatchBtn, false, PHASE_BTN_HATCH);
    } else {
      const hatchText = s.hatchOpen ? t('btn.hatchClose') : t('btn.hatchOpen');
      this.chooseHatchLabel.string = this.fitTextForLabel(this.chooseHatchLabel, hatchText, 200);
      this.setPhaseBtnEnabled(this.chooseHatchBtn, true, PHASE_BTN_HATCH);
    }
  }

  /** 底部骰子托盘：有 5 个最大容量的空位；实际数量按 phaseDice.length 决定可见性。 */
  private buildDiceTray() {
    const tray = new Node('DiceTray');
    tray.layer = this.node.layer;
    tray.addComponent(UITransform).setContentSize(640, 120);
    tray.setPosition(0, BOTTOM_PHASE_ROW_Y, 0);
    this.node.addChild(tray);
    this.diceTrayRoot = tray;

    // 托盘标题（"移动阶段骰 / 攻击阶段骰 ..."），放在骰子上方
    const titleNode = new Node('DiceTitle');
    titleNode.layer = this.node.layer;
    titleNode.addComponent(UITransform).setContentSize(420, 28);
    titleNode.setPosition(0, 52, 0);
    const tl = titleNode.addComponent(Label);
    tl.fontSize = 22;
    tl.lineHeight = 26;
    tl.color = HUD_TEXT_COLOR;
    tl.horizontalAlign = HorizontalTextAlignment.CENTER;
    tl.verticalAlign = VerticalTextAlignment.CENTER;
    tl.overflow = Label.Overflow.SHRINK;
    tl.string = '';
    tray.addChild(titleNode);
    this.diceTitleLabel = tl;

    // 5 个骰子槽位；初始排布见 refreshDiceTray（按实际颗数水平居中）
    const SLOT = BattleScene.DICE_TRAY_SLOT;
    const GAP = BattleScene.DICE_TRAY_GAP;
    const total = SLOT * 5 + GAP * 4;
    const startX = -total / 2 + SLOT / 2;
    for (let i = 0; i < 5; i++) {
      const slot = new Node(`Die${i}`);
      slot.layer = this.node.layer;
      slot.addComponent(UITransform).setContentSize(SLOT, SLOT);
      slot.setPosition(startX + i * (SLOT + GAP), 0, 0);
      const bg = slot.addComponent(Graphics);

      const faceNode = new Node('Face');
      faceNode.layer = this.node.layer;
      faceNode.addComponent(UITransform).setContentSize(SLOT, SLOT);
      const face = faceNode.addComponent(Label);
      face.fontSize = 40;
      face.lineHeight = 44;
      face.color = DIE_FACE_TEXT;
      face.horizontalAlign = HorizontalTextAlignment.CENTER;
      face.verticalAlign = VerticalTextAlignment.CENTER;
      face.string = '';
      slot.addChild(faceNode);

      const pipsNode = new Node('Pips');
      pipsNode.layer = this.node.layer;
      pipsNode.addComponent(UITransform).setContentSize(SLOT, SLOT);
      const pips = pipsNode.addComponent(Graphics);
      slot.addChild(pipsNode);

      const hintNode = new Node('Hint');
      hintNode.layer = this.node.layer;
      hintNode.addComponent(UITransform).setContentSize(SLOT + 12, 22);
      hintNode.setPosition(0, -SLOT / 2 - 14, 0);
      const hint = hintNode.addComponent(Label);
      hint.fontSize = 18;
      hint.lineHeight = 20;
      hint.color = DIE_HINT_GREEN;
      hint.horizontalAlign = HorizontalTextAlignment.CENTER;
      hint.verticalAlign = VerticalTextAlignment.CENTER;
      hint.overflow = Label.Overflow.SHRINK;
      hint.string = '';
      slot.addChild(hintNode);

      const idx = i;
      slot.on(Node.EventType.TOUCH_END, () => this.onClickDie(idx), this);
      tray.addChild(slot);

      this.diceVisuals.push({ root: slot, bg, pips, faceLabel: face, hintLabel: hint });
    }

    tray.active = false;
  }

  /** 根据 playerStep / 胜负 / 敌方阶段等状态切换底部 UI 的可见性与文字。 */
  private refreshPhaseUI() {
    const inBattle = this.phase === 'player' && this.outcome === 'ongoing';
    /** 即将自动进杂项：本帧不应亮选择条，否则会闪一帧移动/攻击按钮再消失 */
    const pendingMiscAuto = inBattle && this.playerStep === 'choose'
      && this.movementDone && this.attackDone && !this.miscDone;
    // 1) 阶段选择条
    if (this.chooseBar) {
      const barOn = inBattle && this.playerStep === 'choose' && !pendingMiscAuto;
      this.chooseBar.active = barOn;
      if (barOn) this.refreshChooseHatchButton();
    }
    const canMove   = !this.movementDone;
    const canAttack = !this.attackDone;
    if (this.chooseMoveBtn)   this.setPhaseBtnEnabled(this.chooseMoveBtn,   canMove,   PHASE_BTN_MOVE);
    if (this.chooseAttackBtn) this.setPhaseBtnEnabled(this.chooseAttackBtn, canAttack, PHASE_BTN_ATTACK);

    // 2) 骰子托盘
    if (this.diceTrayRoot) {
      this.diceTrayRoot.active = inBattle && (
        this.playerStep === 'movement'
        || this.playerStep === 'attack'
        || this.playerStep === 'misc'
      );
    }
    if (this.diceTitleLabel) {
      const titleText = this.playerStep === 'movement'
        ? t('dice.tray.move')
        : this.playerStep === 'attack'
          ? t('dice.tray.attack')
          : this.playerStep === 'misc'
            ? t('dice.tray.misc')
            : '';
      this.diceTitleLabel.string = this.fitTextForLabel(this.diceTitleLabel, titleText, 420);
    }
    this.refreshDiceTray();
    // 点击骰子后弹出的菜单，状态变化时（比如骰子被消耗）一并关闭
    if (!inBattle || this.playerStep === 'choose') this.closeDiePopover();

    // A+B 均已完成且尚未进杂项：同步进杂项（非 busy）；避免 scheduleOnce(0) 晚一帧导致选择条闪屏
    if (pendingMiscAuto) {
      if (!this.isBusy()) {
        this.enterPhaseIfChoose('misc');
        return;
      }
      this.scheduleOnce(() => {
        if (this.phase !== 'player' || this.outcome !== 'ongoing') return;
        if (this.playerStep !== 'choose') return;
        if (!this.movementDone || !this.attackDone || this.miscDone) return;
        this.enterPhaseIfChoose('misc');
      }, 0);
    }
  }

  private setPhaseBtnEnabled(btn: Node, enabled: boolean, baseColor: Color) {
    const g = btn.getComponent(Graphics);
    if (!g) return;
    const ut = btn.getComponent(UITransform);
    if (!ut) return;
    g.clear();
    g.fillColor = enabled ? baseColor : PHASE_BTN_DISABLED;
    g.strokeColor = BTN_BORDER;
    g.lineWidth = 2;
    g.rect(-ut.contentSize.width / 2, -ut.contentSize.height / 2,
           ut.contentSize.width, ut.contentSize.height);
    g.fill();
    g.stroke();
  }

  /** 遍历 diceVisuals，按 phaseDice 的当前内容重绘每个骰子（点数 + 动作提示 + 用/未用态）。 */
  private estimateEnLabelWidth(text: string, fontSize: number): number {
    let units = 0;
    for (const ch of text) {
      if (ch === ' ') units += 0.32;
      else if (ch === 'i' || ch === 'l' || ch === 'I' || ch === '.' || ch === ',' || ch === ':' || ch === ';' || ch === "'") units += 0.28;
      else if (ch === 'W' || ch === 'M' || ch === 'w' || ch === 'm') units += 0.86;
      else if (ch.charCodeAt(0) > 127) units += 0.9;
      else units += BattleScene.EN_LABEL_AVG_CHAR_W;
    }
    return units * fontSize;
  }

  private abbreviateEnglishWords(text: string): string {
    return text.replace(/[A-Za-z]+/g, word => word.length <= 2 ? word : word.slice(0, 2));
  }

  private fitEnglishText(text: string, maxWidth: number, fontSize: number): string {
    if (getLang() !== 'en') return text;
    const usableWidth = Math.max(0, maxWidth - BattleScene.EN_LABEL_SAFE_PAD);
    if (this.estimateEnLabelWidth(text, fontSize) <= usableWidth) return text;
    return this.abbreviateEnglishWords(text);
  }

  private fitTextForLabel(label: Label, text: string, fallbackWidth: number): string {
    const ut = label.node.getComponent(UITransform);
    const width = ut ? ut.contentSize.width : fallbackWidth;
    return this.fitEnglishText(text, width, label.fontSize);
  }

  private refreshDiceTray() {
    const SLOT = BattleScene.DICE_TRAY_SLOT;
    const GAP = BattleScene.DICE_TRAY_GAP;
    const n = this.phaseDice.length;
    const total = n > 0 ? SLOT * n + GAP * (n - 1) : 0;
    const startX = n > 0 ? -total * 0.5 + SLOT * 0.5 : 0;
    let shown = 0;
    for (let i = 0; i < this.diceVisuals.length; i++) {
      const vis = this.diceVisuals[i];
      const slot = this.phaseDice[i];
      if (!slot) {
        vis.root.active = false;
        continue;
      }
      vis.root.active = true;
      const anim = this.playerDiceSortAnim;
      const x = anim && i < anim.fromX.length
        ? anim.fromX[i] + (anim.toX[i] - anim.fromX[i]) * easeInOutCubic(Math.min(1, anim.t / anim.dur))
        : startX + shown * (SLOT + GAP);
      vis.root.setPosition(x, 0, 0);
      shown++;
      // 主炮 / 机枪选中都复用同一种"已高亮"视觉，玩家以颜色与 HUD 文案区分
      this.drawDieSlot(vis, slot, i === this.selectedGunDieIdx || i === this.selectedMGDieIdx);
    }
  }

  private playerDiceSlotX(index: number, count: number): number {
    const SLOT = BattleScene.DICE_TRAY_SLOT;
    const GAP = BattleScene.DICE_TRAY_GAP;
    const total = count > 0 ? SLOT * count + GAP * (count - 1) : 0;
    return count > 0 ? -total * 0.5 + SLOT * 0.5 + index * (SLOT + GAP) : 0;
  }

  private placeEnemyDiceTrayRoot(tray: Node) {
    tray.setPosition(0, BOTTOM_PHASE_ROW_Y, 0);
  }

  private beginPlayerDiceSortAnim(): boolean {
    const n = this.phaseDice.length;
    if (n <= 1) return false;

    const order = this.phaseDice
      .map((slot, index) => ({ slot, index }))
      .sort((a, b) => (a.slot.pip - b.slot.pip) || (a.index - b.index));

    let changed = false;
    for (let i = 0; i < n; i++) {
      if (order[i].index !== i) {
        changed = true;
        break;
      }
    }
    if (!changed) return false;

    this.phaseDice = order.map(o => o.slot);
    this.playerDiceSortAnim = {
      t: 0,
      dur: BattleScene.PLAYER_DICE_SORT_DUR,
      fromX: order.map(o => this.playerDiceSlotX(o.index, n)),
      toX: order.map((_, i) => this.playerDiceSlotX(i, n)),
    };
    return true;
  }

  private advancePlayerDiceSortAnim(dt: number) {
    const anim = this.playerDiceSortAnim;
    if (!anim) return;
    anim.t += dt;
    if (anim.t >= anim.dur) {
      anim.t = anim.dur;
      this.refreshDiceTray();
      this.playerDiceSortAnim = null;
      this.refreshPhaseUI();
      this.updateHUD();
      this.redraw();
      return;
    }
    this.refreshDiceTray();
  }

  private drawDieSlot(vis: DieVisual, slot: DieSlot, highlighted: boolean) {
    const ut = vis.root.getComponent(UITransform);
    if (!ut) return;
    const W = ut.contentSize.width, H = ut.contentSize.height;
    const g = vis.bg;
    g.clear();
    this.drawDieBody(g, W, H, {
      fill: slot.used ? DIE_FACE_USED_FILL : DIE_FACE_FILL,
      border: highlighted ? DIE_FACE_SELECTED : DIE_FACE_BORDER,
      lineWidth: highlighted ? 4 : 2,
      shadow: !slot.used,
    });

    vis.pips.clear();
    this.drawDiePips(
      vis.pips,
      slot.pip,
      Math.min(W, H),
      slot.used ? DIE_FACE_TEXT_USED : DIE_FACE_TEXT,
    );

    vis.faceLabel.string = '';
    vis.faceLabel.color = slot.used ? DIE_FACE_TEXT_USED : DIE_FACE_TEXT;

    const hint = this.dieActionHint(slot.pip);
    const hintText = this.playerDiceRollAnim ? '' : slot.used ? t('dice.slot.used') : hint.text;
    vis.hintLabel.string = this.fitTextForLabel(vis.hintLabel, hintText, BattleScene.DICE_TRAY_SLOT + 12);
    vis.hintLabel.color = slot.used ? DIE_HINT_GREY : DIE_HINT_ACTIVE;
  }

  private advancePlayerDiceRollAnim(dt: number) {
    const anim = this.playerDiceRollAnim;
    if (!anim) return;
    anim.t += dt;
    if (anim.t < anim.dur) {
      const frame = Math.floor(anim.t / DICE_CYCLE_INTERVAL);
      for (let i = 0; i < this.phaseDice.length; i++) {
        const slot = this.phaseDice[i];
        if (!slot) continue;
        slot.pip = (((frame + 1) * (17 + i * 6) + i * 11) % 6) + 1;
      }
      this.refreshDiceTray();
      return;
    }

    for (let i = 0; i < this.phaseDice.length; i++) {
      const slot = this.phaseDice[i];
      if (slot) slot.pip = anim.finalPips[i] ?? slot.pip;
    }
    this.playerDiceRollAnim = null;
    this.pushCombatLogEntry(anim.logEntry);
    if (this.beginPlayerDiceSortAnim()) {
      this.refreshDiceTray();
      this.updateHUD();
      this.redraw();
      return;
    }
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
  }

  private drawDieBody(
    g: Graphics,
    w: number,
    h: number,
    opts: { fill: Color; border: Color; lineWidth: number; shadow?: boolean },
  ) {
    const r = Math.max(8, Math.min(w, h) * 0.16);
    if (opts.shadow) {
      g.fillColor = new Color(0, 0, 0, 70);
      g.roundRect(-w / 2 + 4, -h / 2 - 5, w, h, r);
      g.fill();
    }
    g.fillColor = opts.fill;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();

    // A small bevel keeps the flat UI square reading as a physical die.
    g.strokeColor = new Color(255, 255, 255, 155);
    g.lineWidth = 2;
    g.moveTo(-w / 2 + r, h / 2 - 5);
    g.lineTo(w / 2 - r, h / 2 - 5);
    g.moveTo(-w / 2 + 5, -h / 2 + r);
    g.lineTo(-w / 2 + 5, h / 2 - r);
    g.stroke();

    g.strokeColor = new Color(115, 105, 90, 120);
    g.lineWidth = 2;
    g.moveTo(w / 2 - 5, h / 2 - r);
    g.lineTo(w / 2 - 5, -h / 2 + r);
    g.moveTo(-w / 2 + r, -h / 2 + 5);
    g.lineTo(w / 2 - r, -h / 2 + 5);
    g.stroke();

    g.strokeColor = opts.border;
    g.lineWidth = opts.lineWidth;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.stroke();
  }

  private drawDiePips(g: Graphics, pip: number, size: number, color: Color) {
    const p = Math.max(1, Math.min(6, Math.floor(pip)));
    const d = size * 0.24;
    const r = size * 0.065;
    const spots: Record<number, Array<[number, number]>> = {
      1: [[0, 0]],
      2: [[-d, d], [d, -d]],
      3: [[-d, d], [0, 0], [d, -d]],
      4: [[-d, d], [d, d], [-d, -d], [d, -d]],
      5: [[-d, d], [d, d], [0, 0], [-d, -d], [d, -d]],
      6: [[-d, d], [d, d], [-d, 0], [d, 0], [-d, -d], [d, -d]],
    };
    g.fillColor = color;
    for (const [x, y] of spots[p]) {
      g.circle(x, y, r);
      g.fill();
    }
  }

  /** 给定点数，返回当前阶段该骰面对应的动作名 + 配色，用于骰子下方小字提示。 */
  private dieActionHint(pip: number): { text: string; color: Color } {
    if (this.playerStep === 'movement') {
      const a = classifyMoveDie(pip);
      switch (a) {
        case 'turn':    return { text: t('die.hint.turn'),    color: DIE_HINT_GREEN };
        case 'drive':   return { text: t('die.hint.drive'),   color: DIE_HINT_GREEN };
        case 'reverse': return { text: t('die.hint.reverse'), color: DIE_HINT_GREEN };
        case 'start':   return { text: t('die.hint.start'),   color: DIE_HINT_GREY };
        default:        return { text: t('die.hint.none'),    color: DIE_HINT_GREY };
      }
    }
    if (this.playerStep === 'attack') {
      const a = classifyAttackDie(pip);
      switch (a) {
        case 'reload': return { text: t('die.hint.reload'), color: DIE_HINT_RED };
        case 'gun':    return { text: t('die.hint.gun'),    color: DIE_HINT_RED };
        case 'mg':     return { text: t('die.hint.mg'),     color: DIE_HINT_GREY };
        default:       return { text: t('die.hint.none'),   color: DIE_HINT_GREY };
      }
    }
    if (this.playerStep === 'misc') {
      const m = classifyMiscDie(pip);
      switch (m) {
        case 'fire_suppress':         return { text: t('die.hint.fireSuppress'),      color: DIE_HINT_GREEN };
        case 'repair':                return { text: t('die.hint.repair'),            color: DIE_HINT_GREEN };
        case 'smoke_or_repair':       return { text: t('die.hint.smokeOrRepair'),     color: DIE_HINT_GREEN };
        case 'driver_turn_or_drive':  return { text: t('die.hint.driverTurnOrDrive'), color: DIE_HINT_GREEN };
        case 'gunner_gun_or_reload':  return { text: t('die.hint.gunOrLoad'),         color: DIE_HINT_RED   };
        case 'codriver_mg':           return { text: t('die.hint.codriverMG'),        color: DIE_HINT_GREY  };
        case 'concealment':           return { text: t('die.hint.conceal'),           color: DIE_HINT_GREY  };
        default:                      return { text: t('die.hint.none'),              color: DIE_HINT_GREY  };
      }
    }
    return { text: '', color: DIE_HINT_GREY };
  }

  // ---------- 阶段进入 / 结束 ----------

  // ---------- 车长舱盖 ----------

  /**
   * GDD §2.1：舱盖仅在"选择阶段"且本回合未进入任何子阶段时可切换；
   * 车长阵亡 / 已进入移动或攻击 / 坦克被毁 → 禁止切换。
   *
   * 返回 null 表示允许；否则返回浮字用的 i18n key。
   */
  private canToggleHatch(): string | null {
    if (!this.mission) return 'floater.hatchLocked';
    const s = this.mission.sherman;
    if (s.destroyed) return 'floater.hatchLocked';
    // 车长存活检查必须先于"阶段锁"，否则车长已阵亡但恰好还在 choose 的情况下
    // 会误报"本回合已锁定"，让玩家困惑到底是哪种原因。
    if (s.crew && !s.crew.commander) return 'floater.hatchCommanderDead';
    if (this.phase !== 'player' || this.outcome !== 'ongoing') return 'floater.hatchLocked';
    if (this.playerStep !== 'choose' || this.movementDone || this.attackDone) {
      return 'floater.hatchLocked';
    }
    return null;
  }

  /** 点击"舱盖"行：允许则翻转 hatchOpen 并刷新面板；否则弹红色浮字。 */
  private tryToggleHatch() {
    if (this.isBusy()) return;
    if (!this.mission) return;
    const s = this.mission.sherman;
    const reason = this.canToggleHatch();
    if (reason) {
      this.spawnFloater(s.pos.q, s.pos.r, t(reason),
        new Color(255, 120, 120, 255), { size: 22, dur: 1.2, rise: 28 });
      return;
    }
    s.hatchOpen = !s.hatchOpen;
    this.battleLogI18n('battleLog.hatch', {
      stateKey: s.hatchOpen ? 'status.val.hatchOpen' : 'status.val.hatchClosed',
    });
    this.refreshStatusPanel();
    this.refreshChooseHatchButton();
  }

  /** 若仍在选择阶段则进入指定子阶段（供自动链与载档补调用）。 */
  private enterPhaseIfChoose(which: 'movement' | 'attack' | 'misc') {
    if (this.phase !== 'player' || this.outcome !== 'ongoing') return;
    if (this.playerStep !== 'choose') return;
    this.enterPhase(which);
  }

  /** 玩家在"选择阶段"时点了移动/攻击按钮，或系统自动进入杂项 → 摇一批骰子，进入对应子阶段。 */
  private enterPhase(which: 'movement' | 'attack' | 'misc') {
    if (!this.mission) return;
    if (this.isBusy()) return;
    if (this.phase !== 'player') return;
    if (this.outcome !== 'ongoing') return;
    if (this.playerStep !== 'choose') return;
    if (which === 'movement' && this.movementDone) return;
    if (which === 'attack'   && this.attackDone) return;
    // 杂项阶段门禁：GDD §2.3 C 必须最后 —— 只有 A + B 都完成后才允许进入
    if (which === 'misc' && (this.miscDone || !this.movementDone || !this.attackDone)) return;

    const { map, sherman } = this.mission;
    const tile = map.get(sherman.pos);
    // 桥梁叠加（GDD §3.2）：水域+桥梁 → 等效公路读骰子基数；其他基底原样返回。
    const terrain = effectiveDiceTerrain(tile);
    const crew = sherman.crew ?? {
      commander: false,
      loader: false,
      gunner: false,
      driver: false,
      coDriver: false,
    };
    const subPhase = which === 'movement' ? 'movement' : which === 'attack' ? 'attack' : 'misc';
    const hatchOpenRaw = !!sherman.hatchOpen;
    const count = actionDicePool({
      subPhase,
      terrain,
      hatchOpen: hatchOpenRaw,
      crew,
    });
    const pips = rollActionDice(this.rng, count);
    this.phaseDice = pips.map((_, i) => ({ pip: ((i * 2) % 6) + 1, used: false }));
    this.clearGunSelection();
    this.playerStep = which;
    this.closeDiePopover();

    const phaseKey = which === 'movement' ? 'battleLog.phase.movement'
      : which === 'attack' ? 'battleLog.phase.attack' : 'battleLog.phase.misc';
    const hatchForLog = hatchOpenRaw && !!crew.commander;
    this.playerDiceRollAnim = {
      t: 0,
      dur: 0.65,
      finalPips: pips,
      logEntry: {
        key: 'battleLog.diceRoll',
        params: {
          phaseKey,
          dice: pips.join(', '),
          count,
          terrainKey: `terrain.${terrain}`,
          hatchKey: hatchForLog ? 'status.val.hatchOpen' : 'status.val.hatchClosed',
        },
      },
    };
    playDiceRoll();

    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
  }

  /**
   * 结束当前子阶段（movement / attack / misc），回到 choose；
   * 若结束的是杂项阶段 → 直接进入敌方阶段。
   * 若结束的是移动或攻击：另一翼未完成则下一帧自动进入该翼；两翼均完成则由 refreshPhaseUI 自动进杂项。
   */
  private endCurrentSubPhase() {
    const was = this.playerStep;
    const wasMisc = was === 'misc';
    if (was === 'movement') this.movementDone = true;
    else if (was === 'attack') this.attackDone = true;
    else if (was === 'misc') this.miscDone = true;
    this.playerDiceRollAnim = null;
    this.playerDiceSortAnim = null;
    this.phaseDice = [];
    this.clearGunSelection();
    this.closeDiePopover();
    if (wasMisc && this.phase === 'player' && this.outcome === 'ongoing'
        && this.movementDone && this.attackDone) {
      this.playerStep = 'choose';
      this.beginEnemyPhase();
      return;
    }
    this.playerStep = 'choose';
    // 另一翼未完成：优先同步 enterPhase，避免与「进杂项」相同的一帧 chooseBar 闪屏（busy 时仍延后一帧）
    if (this.phase === 'player' && this.outcome === 'ongoing' && (was === 'movement' || was === 'attack')
      && (!this.movementDone || !this.attackDone)) {
      const next = !this.movementDone ? 'movement' : 'attack';
      if (!this.isBusy()) {
        this.enterPhase(next);
        return;
      }
    }
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    if (this.phase !== 'player' || this.outcome !== 'ongoing') return;
    if (was === 'movement' || was === 'attack') {
      if (!this.movementDone || !this.attackDone) {
        const next = !this.movementDone ? 'movement' : 'attack';
        if (this.isBusy()) {
          this.scheduleOnce(() => this.enterPhaseIfChoose(next), 0);
        }
      }
    }
  }

  /**
   * 阶段内每做完一个动作后检查：如果所有骰子都已消耗，自动结束当前子阶段，
   * 省得玩家还要手动再点一次按钮。未消耗的骰子会被"废弃"在阶段结束时自然丢失。
   */
  private autoEndPhaseIfDone() {
    if (this.playerStep !== 'movement'
      && this.playerStep !== 'attack'
      && this.playerStep !== 'misc') return;
    if (this.phaseDice.length === 0) return;
    const anyLeft = this.phaseDice.some(d => !d.used);
    if (!anyLeft) {
      const phaseKey = this.playerStep === 'movement' ? 'battleLog.phase.movement'
        : this.playerStep === 'attack' ? 'battleLog.phase.attack' : 'battleLog.phase.misc';
      this.battleLogI18n('battleLog.diceAutoEnd', { phaseKey });
      this.endCurrentSubPhase();
    }
  }

  // ---------- 骰子点击菜单 ----------

  private onClickDie(idx: number) {
    playUiClick();
    if (this.isBusy()) return;
    if (this.phase !== 'player') return;
    if (this.outcome !== 'ongoing') return;
    if (this.playerStep !== 'movement'
      && this.playerStep !== 'attack'
      && this.playerStep !== 'misc') return;
    const slot = this.phaseDice[idx];
    if (!slot || slot.used) {
      this.closeDiePopover();
      return;
    }
    // GDD §3.6：移动阶段的"前进"(5/6) 与"后退"(1)，以及攻击阶段的"装填"(1/2)
    // 都只有单一动作、无分支选择 → 点一下直接执行，不再弹菜单。
    // 但若存在同点搭档（= §3.6 对子动作可用），仍要走 popover 让玩家选择对子动作。
    const hasDoubles = this.findDoublesPartner(idx) >= 0;
    if (this.playerStep === 'movement') {
      const a = classifyMoveDie(slot.pip);
      if (a === 'drive' && !hasDoubles) {
        this.closeDiePopover();
        this.tryDriveSherman(idx, +1);
        return;
      }
      if (a === 'reverse' && !hasDoubles) {
        this.closeDiePopover();
        this.tryDriveSherman(idx, -1);
        return;
      }
    } else if (this.playerStep === 'attack') {
      const a = classifyAttackDie(slot.pip);
      if (a === 'reload' && !hasDoubles) {
        this.closeDiePopover();
        this.tryReload(idx);
        return;
      }
    } else if (this.playerStep === 'misc') {
      // 杂项阶段 6 点 = 灭火，无分支 → 直接执行。
      // 但若有同点搭档（= 可走"隐蔽"对子动作），则改走 popover 让玩家选择。
      const m = classifyMiscDie(slot.pip);
      if (m === 'fire_suppress' && !hasDoubles) {
        this.closeDiePopover();
        this.tryFireSuppress(idx);
        return;
      }
    }
    this.showDiePopover(idx);
  }

  /** 关闭弹出动作菜单（如果有）。 */
  private closeDiePopover() {
    if (this.diePopover) {
      this.diePopover.destroy();
      this.diePopover = null;
    }
  }

  /**
   * 在骰子正上方弹出一个竖排动作菜单（最多 2~3 项），每项一个按钮，点击即执行动作。
   * 菜单按当前阶段 + 骰面枚举可用动作；再点同一颗骰 / 点别处都会重建或关闭。
   */
  private showDiePopover(idx: number) {
    this.closeDiePopover();
    const vis = this.diceVisuals[idx];
    const slot = this.phaseDice[idx];
    if (!vis || !slot || slot.used) return;

    // 构造动作项
    type Item = { text: string; color: Color; onClick: () => void };
    const items: Item[] = [];

    const hasDoublesPartner = this.findDoublesPartner(idx) >= 0;

    if (this.playerStep === 'movement') {
      const a = classifyMoveDie(slot.pip);
      if (a === 'turn') {
        items.push({ text: t('action.turnCW'), color: PHASE_BTN_MOVE,
          onClick: () => this.tryTurnSherman(idx, +1) });
        items.push({ text: t('action.turnCCW'), color: PHASE_BTN_MOVE,
          onClick: () => this.tryTurnSherman(idx, -1) });
      } else if (a === 'drive') {
        // GDD §3.6：点数 5 / 6 只能前进，不再提供后退选项
        items.push({ text: t('action.advance'), color: PHASE_BTN_MOVE,
          onClick: () => this.tryDriveSherman(idx, +1) });
      } else if (a === 'reverse') {
        // GDD §3.6：点数 1 → 后退 1 格
        items.push({ text: t('action.reverse'), color: PHASE_BTN_MOVE,
          onClick: () => this.tryDriveSherman(idx, -1) });
      } else {
        // 'start' / 'none'：没有有效动作，提供"放弃"
        items.push({ text: t('action.skip'), color: PHASE_BTN_DISABLED,
          onClick: () => this.discardDie(idx) });
      }
      // §3.6 A 列对子：驾驶员前进 / 副驾驶 ↻ 60° / 副驾驶 ↺ 60°
      if (hasDoublesPartner) {
        items.push({ text: t('action.doublesDriverAdvance'), color: PHASE_BTN_MOVE,
          onClick: () => this.tryDoublesDriverAdvance(idx) });
        items.push({ text: t('action.doublesCoDriverTurnCW'), color: PHASE_BTN_MOVE,
          onClick: () => this.tryDoublesCoDriverTurn(idx, +1) });
        items.push({ text: t('action.doublesCoDriverTurnCCW'), color: PHASE_BTN_MOVE,
          onClick: () => this.tryDoublesCoDriverTurn(idx, -1) });
      }
    } else if (this.playerStep === 'attack') {
      const a = classifyAttackDie(slot.pip);
      if (a === 'reload') {
        items.push({ text: t('action.reload'), color: PHASE_BTN_ATTACK,
          onClick: () => this.tryReload(idx) });
      } else if (a === 'gun') {
        items.push({ text: t('action.fire'), color: PHASE_BTN_ATTACK,
          onClick: () => this.selectGunDie(idx) });
      } else if (a === 'mg') {
        items.push({ text: t('action.fireMG'), color: PHASE_BTN_ATTACK,
          onClick: () => this.selectMGDie(idx) });
      } else {
        items.push({ text: t('action.skip'), color: PHASE_BTN_DISABLED,
          onClick: () => this.discardDie(idx) });
      }
      // §3.6 B 列对子：装填手装填（+同点骰）/ 炮手主炮射击（+同点骰）
      if (hasDoublesPartner) {
        items.push({ text: t('action.doublesLoaderReload'), color: PHASE_BTN_ATTACK,
          onClick: () => this.tryDoublesLoaderReload(idx) });
        items.push({ text: t('action.doublesGunnerFire'), color: PHASE_BTN_ATTACK,
          onClick: () => this.selectGunDieDoubles(idx) });
      }
    } else if (this.playerStep === 'misc') {
      const m = classifyMiscDie(slot.pip);
      const sherman = this.mission ? this.mission.sherman : null;
      switch (m) {
        case 'gunner_gun_or_reload':
          // 1 点 C 列：炮手主炮射击 / 装填手装填 → 二选一
          items.push({ text: t('action.reload'), color: PHASE_BTN_ATTACK,
            onClick: () => this.tryReload(idx) });
          items.push({ text: t('action.fire'), color: PHASE_BTN_ATTACK,
            onClick: () => this.selectGunDie(idx) });
          break;
        case 'codriver_mg':
          // 2 点 C 列：副驾驶机枪射击步兵
          items.push({ text: t('action.fireMGCoDriver'), color: PHASE_BTN_ATTACK,
            onClick: () => this.selectMGDie(idx) });
          break;
        case 'driver_turn_or_drive':
          // 3 点 C 列：驾驶员转向 / 前进
          items.push({ text: t('action.turnCW'),  color: PHASE_BTN_MOVE,
            onClick: () => this.tryTurnSherman(idx, +1) });
          items.push({ text: t('action.turnCCW'), color: PHASE_BTN_MOVE,
            onClick: () => this.tryTurnSherman(idx, -1) });
          items.push({ text: t('action.advance'), color: PHASE_BTN_MOVE,
            onClick: () => this.tryDriveSherman(idx, +1) });
          break;
        case 'repair':
          // 4 点 C 列：修复炮塔 或 瘫痪；无损则只给"放弃"
          if (sherman && tileForbidsSmokeOrConcealment(this.mission?.map.get(sherman.pos))) {
            items.push({ text: t('action.repairTurret'), color: PHASE_BTN_MISC,
              onClick: () => this.tryRepair(idx, 'turret') });
            items.push({ text: t('action.repairMobility'), color: PHASE_BTN_MISC,
              onClick: () => this.tryRepair(idx, 'mobility') });
          } else if (sherman && sherman.turretDamaged) {
            items.push({ text: t('action.repairTurret'), color: PHASE_BTN_MISC,
              onClick: () => this.tryRepair(idx, 'turret') });
          }
          if (sherman && sherman.paralyzed) {
            items.push({ text: t('action.repairMobility'), color: PHASE_BTN_MISC,
              onClick: () => this.tryRepair(idx, 'mobility') });
          }
          if (items.length === 0) {
            items.push({ text: t('action.skip'), color: PHASE_BTN_DISABLED,
              onClick: () => { this.discardDie(idx); this.spawnNoRepairFloater(); } });
          }
          break;
        case 'smoke_or_repair':
          // 5 点 C 列：烟雾 / 修复（炮塔 / 瘫痪）
          items.push({ text: t('action.smoke'), color: PHASE_BTN_MISC,
            onClick: () => this.trySmoke(idx) });
          if (sherman && sherman.turretDamaged) {
            items.push({ text: t('action.repairTurret'), color: PHASE_BTN_MISC,
              onClick: () => this.tryRepair(idx, 'turret') });
          }
          if (sherman && sherman.paralyzed) {
            items.push({ text: t('action.repairMobility'), color: PHASE_BTN_MISC,
              onClick: () => this.tryRepair(idx, 'mobility') });
          }
          break;
        case 'fire_suppress':
          // 6 点 C 列：灭火（着火程度 -1）—— 正常走 onClickDie 直接执行；
          // 若 popover 被触发（比如玩家通过其他途径），这里兜底给一个按钮
          items.push({ text: t('action.fireSuppress'), color: PHASE_BTN_MISC,
            onClick: () => this.tryFireSuppress(idx) });
          break;
        default:
          items.push({ text: t('action.skip'), color: PHASE_BTN_DISABLED,
            onClick: () => this.discardDie(idx) });
      }
      // §3.6 对子 C 列：只要存在同点搭档，就追加"隐蔽（+同点骰）"
      if (hasDoublesPartner) {
        items.push({ text: t('action.concealPair'), color: PHASE_BTN_MISC,
          onClick: () => this.tryConcealment(idx) });
      }
    }

    if (items.length === 0) return;

    const ITEM_W = 180, ITEM_H = 40, GAP = 6;
    const panelH = items.length * ITEM_H + (items.length - 1) * GAP;

    const panel = new Node('DiePopover');
    panel.layer = this.node.layer;
    panel.addComponent(UITransform).setContentSize(ITEM_W, panelH);
    const slotWorldPos = vis.root.worldPosition;
    const parentUT = this.node.getComponent(UITransform);
    const local = parentUT ? parentUT.convertToNodeSpaceAR(slotWorldPos) : new Vec3(0, 0, 0);
    panel.setPosition(local.x, local.y + 96 + panelH / 2, 0);
    this.node.addChild(panel);

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const btn = new Node(`DieAction${i}`);
      btn.layer = this.node.layer;
      btn.addComponent(UITransform).setContentSize(ITEM_W, ITEM_H);
      btn.setPosition(0, panelH / 2 - ITEM_H / 2 - i * (ITEM_H + GAP), 0);
      const bg = btn.addComponent(Graphics);
      bg.fillColor = it.color;
      bg.strokeColor = BTN_BORDER;
      bg.lineWidth = 2;
      bg.rect(-ITEM_W / 2, -ITEM_H / 2, ITEM_W, ITEM_H);
      bg.fill();
      bg.stroke();
      const tn = new Node('Label');
      tn.layer = this.node.layer;
      tn.addComponent(UITransform).setContentSize(ITEM_W, ITEM_H);
      const lab = tn.addComponent(Label);
      lab.fontSize = 20;
      lab.lineHeight = 24;
      lab.color = HUD_TEXT_COLOR;
      lab.horizontalAlign = HorizontalTextAlignment.CENTER;
      lab.verticalAlign = VerticalTextAlignment.CENTER;
      lab.overflow = Label.Overflow.SHRINK;
      lab.string = this.fitTextForLabel(lab, it.text, ITEM_W);
      btn.addChild(tn);
      btn.on(Node.EventType.TOUCH_END, () => {
        playUiClick();
        it.onClick();
      }, this);
      panel.addChild(btn);
    }
    this.diePopover = panel;
  }

  // ---------- 移动阶段动作 ----------

  /**
   * 转向：dirSign +1=顺时针，-1=逆时针；消耗一颗转向骰。
   *
   * 移动阶段：骰面 = 'turn' 时合法。
   * 杂项阶段：骰面 = 'driver_turn_or_drive' (die=3) 时合法（调用方已通过 popover 分支路由）。
   */
  private tryTurnSherman(dieIdx: number, dirSign: 1 | -1) {
    if (!this.mission) return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used) return;
    if (this.playerStep === 'movement') {
      if (classifyMoveDie(slot.pip) !== 'turn') return;
    } else if (this.playerStep === 'misc') {
      if (classifyMiscDie(slot.pip) !== 'driver_turn_or_drive') return;
    } else {
      return;
    }

    const sherman = this.mission.sherman;
    // §3.5 瘫痪：不可转向 / 前进 / 后退；骰子保留不消耗，玩家可用来走修复或放弃
    if (sherman.paralyzed) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.paralyzedBlocked'),
        new Color(255, 160, 160, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    if (sherman.facing === null) sherman.facing = 0;
    const step = dirSign === 1 ? 1 : 5;
    const from = sherman.facing;
    const to = rotateDirection(from, step);
    // §3.5 隐蔽：任何移动动作（转向 / 前进 / 后退）都会脱离隐蔽
    this.breakConcealment(sherman);
    slot.used = true;
    this.closeDiePopover();
    this.anim = {
      unit: sherman,
      kind: 'turn',
      fromQ: sherman.pos.q,
      fromR: sherman.pos.r,
      toQ: sherman.pos.q,
      toR: sherman.pos.r,
      t: 0,
      dur: Math.max(0.05, this.moveDuration),
      turnFrom: from,
      turnTo: to,
    };
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.battleLogI18n('battleLog.move.turn', {
      dir: dirSign === 1 ? 'CW' : 'CCW',
      facing: to,
    });
  }

  /**
   * 前进 / 后退 1 格：dirSign +1=沿当前 facing，-1=反向。
   *
   * GDD §3.6 约束：
   *   - 骰面 5 / 6（action='drive'）只允许前进（dirSign=+1）
   *   - 骰面 1    （action='reverse'）只允许后退（dirSign=-1）
   *
   * 若骰子动作与请求方向不匹配，直接忽略（按钮层已分开提供，这里是双保险）。
   * 若目标格无法进入（越界 / 水域或林地 / 被活着的敌方占据），弹警告浮字并 *不* 消耗骰子。
   */
  private tryDriveSherman(dieIdx: number, dirSign: 1 | -1) {
    if (!this.mission) return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used) return;
    if (this.playerStep === 'movement') {
      const act = classifyMoveDie(slot.pip);
      if (act === 'drive' && dirSign !== +1) return;
      if (act === 'reverse' && dirSign !== -1) return;
      if (act !== 'drive' && act !== 'reverse') return;
    } else if (this.playerStep === 'misc') {
      // 杂项阶段 driver_turn_or_drive (die=3) 只允许前进 1 格
      if (classifyMiscDie(slot.pip) !== 'driver_turn_or_drive') return;
      if (dirSign !== +1) return;
    } else {
      return;
    }

    const { map, sherman } = this.mission;
    // §3.5 瘫痪：不可前进 / 后退；骰子保留不消耗
    if (sherman.paralyzed) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.paralyzedBlocked'),
        new Color(255, 160, 160, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    if (sherman.facing === null) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.noFacing'),
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      return;
    }
    const driveDir = dirSign === 1 ? sherman.facing : rotateDirection(sherman.facing, 3);
    const to = neighbor(sherman.pos, driveDir as 0 | 1 | 2 | 3 | 4 | 5);
    if (isShermanEvacDrive(this.mission, sherman.pos, sherman.facing as Direction, dirSign, to)) {
      slot.used = true;
      this.closeDiePopover();
      this.breakConcealment(sherman);
      this.anim = {
        unit: sherman,
        kind: 'move',
        fromQ: sherman.pos.q,
        fromR: sherman.pos.r,
        toQ: to.q,
        toR: to.r,
        t: 0,
        dur: Math.max(0.05, this.moveDuration),
        evacExit: true,
      };
      this.refreshPhaseUI();
      this.updateHUD();
      this.redraw();
      this.battleLogI18n('battleLog.move.evacuate', { q: to.q, r: to.r });
      return;
    }
    const tile = map.get(to);
    // 桥梁规则（GDD §3.2）：水域+桥梁可入；入 / 出方向须落在 bridgeEnds 端，否则等同越水阻挡。
    const canCrossBreakwater = this.playerStep === 'misc' && dirSign === 1;
    if (!tile || !map.canTankCrossEdge(sherman.pos, to, { ignoreBreakwater: canCrossBreakwater })) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.blockedTerrain'),
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    const blocker = this.allUnits().find(e => e !== sherman && !e.destroyed && e.pos.q === to.q && e.pos.r === to.r);
    if (blocker) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.enemyBlock'),
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }

    slot.used = true;
    this.closeDiePopover();
    // §3.5 隐蔽：前进 / 后退都会脱离隐蔽
    this.breakConcealment(sherman);
    this.anim = {
      unit: sherman,
      kind: 'move',
      fromQ: sherman.pos.q,
      fromR: sherman.pos.r,
      toQ: to.q,
      toR: to.r,
      t: 0,
      dur: Math.max(0.05, this.moveDuration),
    };
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.battleLogI18n('battleLog.move.drive', {
      actionKey: dirSign === 1 ? 'die.hint.drive' : 'die.hint.reverse',
      q: to.q,
      r: to.r,
    });
    // 动画结束时的 update() 回调里不再派发敌方阶段；
    // 但我们需要在动画完成后检查骰子是否用完。
    // 简单做法：标记"驱动动画结束时要检查"。这里直接留给 update() 的分支处理：
    // 见 update() 里的 this.phase === 'player' 分支。
  }

  /** 放弃一颗无效骰（如 1 / 2 / 机枪等 MVP 未实装的动作）。 */
  private discardDie(dieIdx: number) {
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used) return;
    slot.used = true;
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.autoEndPhaseIfDone();
  }

  // ---------- 攻击阶段动作 ----------

  /**
   * 装填主炮：消耗一颗装填骰；若已装填则拒绝（浪费骰）。
   *
   * 攻击阶段：骰面 = 'reload' (die=1/2) 时合法。
   * 杂项阶段：骰面 = 'gunner_gun_or_reload' (die=1) 时合法（由 popover 路由）。
   */
  private tryReload(dieIdx: number) {
    if (!this.mission) return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used) return;
    if (this.playerStep === 'attack') {
      if (classifyAttackDie(slot.pip) !== 'reload') return;
    } else if (this.playerStep === 'misc') {
      if (classifyMiscDie(slot.pip) !== 'gunner_gun_or_reload') return;
    } else {
      return;
    }
    const sherman = this.mission.sherman;
    if (sherman.loaded) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('hud.loaded'),
        new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    sherman.loaded = true;
    slot.used = true;
    playCannonReload();
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.battleLogI18n('battleLog.attack.reload');
    this.autoEndPhaseIfDone();
  }

  /**
   * 选择一颗主炮骰进入"选目标"态；之后点敌人格才真正开火。
   *
   * 攻击阶段：骰面 = 'gun' (die=5/6) 时合法。
   * 杂项阶段：骰面 = 'gunner_gun_or_reload' (die=1) 时合法（由 popover 路由）。
   */
  private selectGunDie(dieIdx: number) {
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used) return;
    if (this.playerStep === 'attack') {
      if (classifyAttackDie(slot.pip) !== 'gun') return;
    } else if (this.playerStep === 'misc') {
      if (classifyMiscDie(slot.pip) !== 'gunner_gun_or_reload') return;
    } else {
      return;
    }
    // 再次点同一颗 → 取消选择
    if (this.selectedGunDieIdx === dieIdx) {
      this.clearGunSelection();
    } else {
      this.selectedGunDieIdx = dieIdx;
      // 普通单骰主炮选择：不连带对子 partner
      this.selectedGunDoublesIdx = -1;
      // 主炮与机枪选中互斥
      this.selectedMGDieIdx = -1;
    }
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
  }

  /** §3.6 B 列对子：炮手主炮射击（+同点骰）。选中后走普通开火流程，tryAttack 会一并消耗 partner。 */
  private selectGunDieDoubles(dieIdx: number) {
    if (!this.mission) return;
    if (this.playerStep !== 'attack') return; // 对子 B 列仅用于攻击阶段
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used) return;
    const partnerIdx = this.findDoublesPartner(dieIdx);
    if (partnerIdx < 0) {
      const s = this.mission.sherman;
      this.spawnFloater(s.pos.q, s.pos.r, t('floater.needPair'),
        new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    // 炮手阵亡则无法行动
    if (!this.checkCrewAlive('gunner')) return;
    this.selectedGunDieIdx = dieIdx;
    this.selectedGunDoublesIdx = partnerIdx;
    this.selectedMGDieIdx = -1;
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.battleLogI18n('battleLog.attack.doublesGunReady', {
      dieIdx,
      partnerIdx,
      pip: slot.pip,
    });
  }

  /**
   * 统一清理主炮 / 机枪的选中态（包括 doubles partner）。
   *
   * 虽然名字只提"Gun"，但绝大多数调用点都是"重置本阶段的攻击目标选择"——
   * 回合 / 阶段切换、开火结束、任务重启等场景下机枪选中也必须一起清，
   * 避免跨阶段保留脏状态。保留名字不改是为了兼容现有调用链。
   */
  private clearGunSelection() {
    this.selectedGunDieIdx = -1;
    this.selectedGunDoublesIdx = -1;
    this.selectedMGDieIdx = -1;
  }

  /**
   * 选中一颗机枪骰进入"选步兵"态；之后点合法步兵格触发扫射。
   *
   * 合法骰面：
   *   - 攻击阶段：pip ∈ {3, 4}（classifyAttackDie == 'mg'）
   *   - 杂项阶段：pip == 2（classifyMiscDie == 'codriver_mg'，副驾驶机枪）
   *
   * 乘员约束：攻击阶段 3/4 点机枪 **不** 因乘员阵亡禁用；杂项阶段 2 点「副驾驶机枪」需副驾驶存活。
   */
  private selectMGDie(dieIdx: number) {
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used) return;
    if (this.playerStep === 'attack') {
      if (classifyAttackDie(slot.pip) !== 'mg') return;
    } else if (this.playerStep === 'misc') {
      if (classifyMiscDie(slot.pip) !== 'codriver_mg') return;
      if (!this.checkCrewAlive('coDriver')) return;
    } else {
      return;
    }
    // 再次点同一颗 → 取消选择
    if (this.selectedMGDieIdx === dieIdx) {
      this.selectedMGDieIdx = -1;
    } else {
      // 机枪与主炮选中互斥：先把所有攻击相关选中清零（clearGunSelection 会把 MG 也清零），
      // 再把本次 MG 选中写回。顺序不能反，否则自己把自己清掉。
      this.clearGunSelection();
      this.selectedMGDieIdx = dieIdx;
    }
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
  }

  /**
   * 检查指定乘员是否存活；不存活时浮一条"{role}已阵亡..."提示并返回 false。
   * §3.6 对子动作均与特定乘员强绑定（驾驶员 / 副驾驶 / 装填手 / 炮手），阵亡即不可执行。
   * slot: 'driver'(4) / 'coDriver'(5) / 'loader'(2) / 'gunner'(3) / 'commander'(1)
   */
  private checkCrewAlive(slot: 'commander' | 'loader' | 'gunner' | 'driver' | 'coDriver'): boolean {
    if (!this.mission) return false;
    const crew = this.mission.sherman.crew;
    if (!crew) return true; // 未定义 crew 视作都活着（老存档兼容）
    const alive = !!crew[slot];
    if (!alive) {
      const roleKey = {
        commander: 'crew.role.1',
        loader: 'crew.role.2',
        gunner: 'crew.role.3',
        driver: 'crew.role.4',
        coDriver: 'crew.role.5',
      }[slot];
      const s = this.mission.sherman;
      this.spawnFloater(s.pos.q, s.pos.r,
        t('floater.roleUnavailable', { role: t(roleKey) }),
        new Color(255, 160, 160, 255), { size: 22, dur: 0.9, rise: 24 });
    }
    return alive;
  }

  // ---------- 杂项阶段动作 ----------

  /**
   * 修复：消耗一颗 'repair' / 'smoke_or_repair' 骰，清除一项受损状态。
   *   - target='turret'   → 清除 turretDamaged
   *   - target='mobility' → 清除 paralyzed
   *
   * 调用方（popover）已确保对应状态存在；此处再校验一次做防御。
   */
  private tryRepair(dieIdx: number, target: 'turret' | 'mobility') {
    if (!this.mission) return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used || this.playerStep !== 'misc') return;
    const m = classifyMiscDie(slot.pip);
    if (m !== 'repair' && m !== 'smoke_or_repair') return;

    const sherman = this.mission.sherman;
    if ((m === 'repair' || m === 'smoke_or_repair') && tileForbidsSmokeOrConcealment(this.mission.map.get(sherman.pos))) {
      this.closeDiePopover();
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.beachNoRepair'),
        new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      return;
    }
    if (target === 'turret') {
      if (!sherman.turretDamaged) return;
      sherman.turretDamaged = false;
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.turretFixed'),
        new Color(180, 240, 160, 255), { size: 22, dur: 0.9, rise: 24 });
      this.battleLogI18n('battleLog.misc.repairTurret');
    } else {
      if (!sherman.paralyzed) return;
      sherman.paralyzed = false;
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.mobilityFixed'),
        new Color(180, 240, 160, 255), { size: 22, dur: 0.9, rise: 24 });
      this.battleLogI18n('battleLog.misc.repairMobility');
    }
    slot.used = true;
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.refreshStatusPanel();
    this.autoEndPhaseIfDone();
  }

  /** 灭火：消耗 die=6 骰，若 fireLevel > 0 则 -1；否则弹浮字并放弃。 */
  private tryFireSuppress(dieIdx: number) {
    if (!this.mission) return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used || this.playerStep !== 'misc') return;
    if (classifyMiscDie(slot.pip) !== 'fire_suppress') return;

    const sherman = this.mission.sherman;
    const lvl = sherman.fireLevel ?? 0;
    if (lvl <= 0) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.noFire'),
        new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      // 无火可灭 → 视为放弃本骰（不白费点击）
      this.discardDie(dieIdx);
      return;
    }
    sherman.fireLevel = lvl - 1;
    slot.used = true;
    this.closeDiePopover();
    this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.fireReduced'),
      new Color(180, 240, 160, 255), { size: 22, dur: 0.9, rise: 24 });
    this.battleLogI18n('battleLog.misc.fireSuppress', { from: lvl, to: sherman.fireLevel ?? 0 });
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.refreshStatusPanel();
    this.autoEndPhaseIfDone();
  }

  /** 修复动作在无可修项时顺便飘一条提示。 */
  private spawnNoRepairFloater() {
    if (!this.mission) return;
    const s = this.mission.sherman;
    this.spawnFloater(s.pos.q, s.pos.r, t('floater.noRepair'),
      new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
  }

  /**
   * 玩家机枪扫射：必须已选中机枪骰 + target 为 canMGAttack 认可的步兵。
   *
   * 命中模型与 Pacific 机枪一致：1d6 ≥ 动态命中阈值即命中，命中直接击毙步兵。
   * 不吃装甲检定、不消耗 loaded、不受 turretDamaged 影响。
   *
   * 动画路径与主炮 DiceShow 分离 —— 走一条轻量"骰面浮字 + 结果浮字"的路线，
   * 避免在玩家扫射 1 名步兵时出现整块遮罩面板（视觉成本与 impact 不对等）。
   */
  private tryMGAttack(target: Unit) {
    if (!this.mission) return;
    if (this.playerStep !== 'attack' && this.playerStep !== 'misc') return;
    if (this.selectedMGDieIdx < 0) return;
    const { map, sherman } = this.mission;
    const units = this.allUnits();
    const slot = this.phaseDice[this.selectedMGDieIdx];
    if (!slot || slot.used) return;

    const check = canMGAttack({ attacker: sherman, target, map, theater: this.mission.data.theater, units });
    if (!check.ok) {
      this.battleLogI18n('battleLog.combat.cannotAttack', {
        reasonKey: check.reason ?? 'attack.reason.unknown',
      });
      const msg = t(check.reason ?? 'attack.reason.unknown');
      this.spawnFloater(sherman.pos.q, sherman.pos.r, msg,
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      return;
    }

    const ctx = { attacker: sherman, target, map, theater: this.mission.data.theater, units };
    const maxRoll = maxMGHitRoll(ctx);
    const impossibleThreshold = mgHitThreshold(ctx);
    const impossible = maxRoll < impossibleThreshold;
    const report = impossible
      ? {
          dice: [0, 0] as [number, number],
          hitDiceCount: maxRoll <= 7 ? 1 : 2,
          hitBonus: maxRoll === 7 ? 1 : 0,
          roll: maxRoll,
          threshold: impossibleThreshold,
          hit: false,
        }
      : rollMGAttack(ctx, this.rng);
    this.battleLogI18n('battleLog.combatMg', {
      d1: report.dice[0],
      d2: report.dice[1],
      diceExpr: impossible ? `max ${maxRoll}` : this.mgDiceExpr(report),
      roll: report.roll,
      need: report.threshold,
      resultKey: report.hit ? 'battleLog.combatMg.hit' : 'battleLog.combatMg.miss',
    });

    if (impossible) {
      playMgFire();
      slot.used = true;
      this.selectedMGDieIdx = -1;
      this.spawnFloater(target.pos.q, target.pos.r, t('dice.panel.outcomeMiss'),
        new Color(220, 220, 220, 255), { size: 32, dur: 0.9, rise: 44 });
      this.refreshPhaseUI();
      this.updateHUD();
      this.redraw();
      this.refreshStatusPanel();
      this.autoEndPhaseIfDone();
      return;
    }

    // MGReport → 面板可用的 AttackReport 视图：只用命中骰/threshold/hit 四个字段，
    // 其余 pen/dmg/crew 分段字段都留空；mg=true 下 advanceDiceShow 不会读它们。
    const panelReport: AttackReport = {
      dice: report.dice,
      hitDiceCount: report.hitDiceCount,
      hitBonus: report.hitBonus,
      roll: report.roll,
      threshold: report.threshold,
      hit: report.hit,
      statusChange: report.hit ? 'destroyed' : 'none',
    };

    const capturedSlot = slot;
    this.startDiceShow(
      panelReport,
      t('actor.player'),
      unitDisplayName(target.kind),
      () => {
        if (!this.mission) return;
        applyMGAttack(target, report);
        if (target.destroyed) this.registerDestroyWreckVisual(target);
        capturedSlot.used = true;
        this.selectedMGDieIdx = -1;
        // 面板结束后再补一条目标格上方的短浮字，强化"这次扫射打谁"的视觉记忆
        if (report.hit) {
          this.spawnFloater(target.pos.q, target.pos.r, t('floater.mgHit'),
            new Color(255, 120, 120, 255), { size: 32, dur: 1.0, rise: 48 });
        } else {
          this.spawnFloater(target.pos.q, target.pos.r, t('dice.panel.outcomeMiss'),
            new Color(220, 220, 220, 255), { size: 32, dur: 0.9, rise: 44 });
        }
        this.outcome = checkOutcome(this.mission);
        if (this.outcome !== 'ongoing') this.updateOutcomeOverlay();
        this.refreshPhaseUI();
        this.updateHUD();
        this.redraw();
        this.refreshStatusPanel();
        this.autoEndPhaseIfDone();
      },
      { mg: true },
    );
    // 立即刷一次 HUD，让 "点步兵扫射" 提示消失，避免玩家以为还能再点
    this.updateHUD();
    this.redraw();
  }

  /**
   * 烟雾（杂项 5 点 smoke_or_repair 的烟雾支）：
   * 消耗该骰；把 sherman.smoked 置 true —— 下一次对谢尔曼的命中检定 +1。
   * 烟雾在下一次"阶段①（玩家回合开始时）"自动消散。
   */
  private trySmoke(dieIdx: number) {
    if (!this.mission) return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used || this.playerStep !== 'misc') return;
    if (classifyMiscDie(slot.pip) !== 'smoke_or_repair') return;
    const s = this.mission.sherman;
    if (tileForbidsSmokeOrConcealment(this.mission.map.get(s.pos))) {
      this.closeDiePopover();
      this.spawnFloater(s.pos.q, s.pos.r, t('floater.beachNoSmoke'),
        new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      return;
    }
    s.smoked = true;
    slot.used = true;
    this.closeDiePopover();
    this.spawnFloater(s.pos.q, s.pos.r, t('floater.smokeDeployed'),
      new Color(200, 200, 220, 255), { size: 22, dur: 0.9, rise: 24 });
    this.battleLogI18n('battleLog.misc.smoke');
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.refreshStatusPanel();
    this.autoEndPhaseIfDone();
  }

  /**
   * 隐蔽（§3.6 对子 C 列 concealment）：
   * 需要一对同点骰；消耗两颗，置 sherman.hidden=true（被攻击命中阈值 +2）。
   * 隐蔽保持到下一次该单位做出移动动作（转向 / 前进 / 后退）才清除，见 breakConcealment()；
   * 该规则对**德军坦克**同样生效（阶段⑥ AI `turn` / `advance` / `reverse` 分支同步调用）。
   *
   * dieIdx 对应被玩家点击的那颗；第二颗 = phaseDice 中第一颗同点且未用的骰。
   * 若找不到同点搭档，弹"需要两颗同点骰"并不消耗。
   */
  private tryConcealment(dieIdx: number) {
    if (!this.mission) return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used || this.playerStep !== 'misc') return;
    const partnerIdx = this.findDoublesPartner(dieIdx);
    const s = this.mission.sherman;
    if (tileForbidsSmokeOrConcealment(this.mission.map.get(s.pos))) {
      this.closeDiePopover();
      this.spawnFloater(s.pos.q, s.pos.r, t('floater.beachNoConceal'),
        new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      return;
    }
    if (partnerIdx < 0) {
      this.spawnFloater(s.pos.q, s.pos.r, t('floater.needPair'),
        new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    const partner = this.phaseDice[partnerIdx];
    slot.used = true;
    partner.used = true;
    s.hidden = true;
    this.closeDiePopover();
    this.spawnFloater(s.pos.q, s.pos.r, t('floater.concealed'),
      new Color(160, 220, 180, 255), { size: 22, dur: 0.9, rise: 24 });
    this.battleLogI18n('battleLog.misc.conceal', { dieIdx, partnerIdx, pip: slot.pip });
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.refreshStatusPanel();
    this.autoEndPhaseIfDone();
  }

  /**
   * 在当前 phaseDice 中寻找一个"点数相同、未使用、不同于 dieIdx"的索引。
   * 用于 §3.6 对子动作：
   *   - A 移动：驾驶员前进 / 副驾驶转向
   *   - B 攻击：炮手主炮射击 / 装填手装填
   *   - C 杂项：隐蔽
   */
  private findDoublesPartner(dieIdx: number): number {
    const slot = this.phaseDice[dieIdx];
    if (!slot) return -1;
    for (let i = 0; i < this.phaseDice.length; i++) {
      if (i === dieIdx) continue;
      const p = this.phaseDice[i];
      if (p && !p.used && p.pip === slot.pip) return i;
    }
    return -1;
  }

  /**
   * §3.5 隐蔽破除：任意坦克执行 **前进 / 后退 / 转向** 动作时调用；若 `hidden=true` 则清除并飘一条提示。
   *
   * 规则覆盖：
   *  - 谢尔曼：移动阶段 / 杂项阶段的「驾驶员前进」「副驾驶转向」「驾驶员撤离离场」「对子前进 / 转向」；
   *  - 德军坦克：阶段⑥ AI `executeEnemyAction` 的 `turn` / `advance` / `reverse` 分支；
   *  - 与隐蔽态字段 `unit.hidden` 一一对应（§3.5.1 解除方式列）。
   *
   * 参数 u 任意单位都安全：未隐蔽则直接 return；隐蔽即去除并广播浮字 + 状态面板刷新。
   */
  private breakConcealment(u: Unit) {
    if (!u.hidden) return;
    u.hidden = false;
    this.spawnFloater(u.pos.q, u.pos.r, t('floater.revealed'),
      new Color(220, 200, 160, 255), { size: 20, dur: 0.8, rise: 22 });
    this.refreshStatusPanel();
  }

  // ---------- §3.6 对子动作（跨列统一入口） ----------

  /**
   * 对子通用消耗：把主骰 + partner 两颗标记已用；返回 partner 是否找到。
   * 若找不到 partner，飘"需要两颗同点骰"并返回 false。
   */
  private consumeDoubles(dieIdx: number): boolean {
    if (!this.mission) return false;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used) return false;
    const partnerIdx = this.findDoublesPartner(dieIdx);
    if (partnerIdx < 0) {
      const s = this.mission.sherman;
      this.spawnFloater(s.pos.q, s.pos.r, t('floater.needPair'),
        new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return false;
    }
    slot.used = true;
    this.phaseDice[partnerIdx].used = true;
    return true;
  }

  /**
   * §3.6 A 列对子：驾驶员前进 1 格（仅移动阶段）。
   * 消耗一对同点骰；走 tryDriveSherman 的几何 / 地形校验逻辑，但绕过"骰面=drive"的判定。
   * 若驾驶员阵亡或瘫痪或地形 / 敌方阻挡，骰子不消耗。
   */
  private tryDoublesDriverAdvance(dieIdx: number) {
    if (!this.mission) return;
    if (this.playerStep !== 'movement') return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used) return;
    if (!this.checkCrewAlive('driver')) { this.closeDiePopover(); return; }

    const { map, sherman } = this.mission;
    if (sherman.paralyzed) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.paralyzedBlocked'),
        new Color(255, 160, 160, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    if (sherman.facing === null) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.noFacing'),
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    const driveDir = sherman.facing;
    const to = neighbor(sherman.pos, driveDir as 0 | 1 | 2 | 3 | 4 | 5);
    if (isShermanEvacDrive(this.mission, sherman.pos, sherman.facing as Direction, 1, to)) {
      if (!this.consumeDoubles(dieIdx)) return;
      this.closeDiePopover();
      this.breakConcealment(sherman);
      this.anim = {
        unit: sherman,
        kind: 'move',
        fromQ: sherman.pos.q,
        fromR: sherman.pos.r,
        toQ: to.q,
        toR: to.r,
        t: 0,
        dur: Math.max(0.05, this.moveDuration),
        evacExit: true,
      };
      this.refreshPhaseUI();
      this.updateHUD();
      this.redraw();
      this.battleLogI18n('battleLog.move.doublesEvacuate', { q: to.q, r: to.r });
      return;
    }
    const tile = map.get(to);
    // 桥梁规则（GDD §3.2）：与单骰 drive 路径一致 —— 水域+桥梁需边向落在 bridgeEnds 端
    if (!tile || !map.canTankCrossEdge(sherman.pos, to)) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.blockedTerrain'),
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    const blocker = this.allUnits().find(e => e !== sherman && !e.destroyed && e.pos.q === to.q && e.pos.r === to.r);
    if (blocker) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.enemyBlock'),
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }

    // 几何校验通过 → 消耗对子并开始前进动画
    if (!this.consumeDoubles(dieIdx)) return;
    this.closeDiePopover();
    this.breakConcealment(sherman);
    this.anim = {
      unit: sherman,
      kind: 'move',
      fromQ: sherman.pos.q,
      fromR: sherman.pos.r,
      toQ: to.q,
      toR: to.r,
      t: 0,
      dur: Math.max(0.05, this.moveDuration),
    };
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.battleLogI18n('battleLog.move.doublesDrive', { q: to.q, r: to.r });
  }

  /**
   * §3.6 A 列对子：副驾驶转向 60°（仅移动阶段）。
   * dirSign +1 = CW，-1 = CCW。副驾驶阵亡或瘫痪则拒绝。
   */
  private tryDoublesCoDriverTurn(dieIdx: number, dirSign: 1 | -1) {
    if (!this.mission) return;
    if (this.playerStep !== 'movement') return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used) return;
    if (!this.checkCrewAlive('coDriver')) { this.closeDiePopover(); return; }

    const sherman = this.mission.sherman;
    if (sherman.paralyzed) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.paralyzedBlocked'),
        new Color(255, 160, 160, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    if (!this.consumeDoubles(dieIdx)) return;
    if (sherman.facing === null) sherman.facing = 0;
    const step = dirSign === 1 ? 1 : 5;
    const from = sherman.facing;
    const to = rotateDirection(from, step);
    this.breakConcealment(sherman);
    this.closeDiePopover();
    this.anim = {
      unit: sherman,
      kind: 'turn',
      fromQ: sherman.pos.q,
      fromR: sherman.pos.r,
      toQ: sherman.pos.q,
      toR: sherman.pos.r,
      t: 0,
      dur: Math.max(0.05, this.moveDuration),
      turnFrom: from,
      turnTo: to,
    };
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.battleLogI18n('battleLog.move.doublesTurn', {
      dir: dirSign === 1 ? 'CW' : 'CCW',
      facing: to,
    });
  }

  /**
   * §3.6 B 列对子：装填手装填（仅攻击阶段）。
   * 若已装填则不消耗；装填手阵亡则拒绝。
   */
  private tryDoublesLoaderReload(dieIdx: number) {
    if (!this.mission) return;
    if (this.playerStep !== 'attack') return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used) return;
    if (!this.checkCrewAlive('loader')) { this.closeDiePopover(); return; }

    const sherman = this.mission.sherman;
    if (sherman.loaded) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('hud.loaded'),
        new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    if (!this.consumeDoubles(dieIdx)) return;
    sherman.loaded = true;
    playCannonReload();
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.refreshStatusPanel();
    this.battleLogI18n('battleLog.attack.doublesReload');
    this.autoEndPhaseIfDone();
  }

  // ---------- 智能"下一阶段" ----------

  /**
   * 右下角按钮点击：
   *   - 移动 / 攻击 / 杂项子阶段内 → endCurrentSubPhase（杂项结束会进敌方）
   *   - 选择阶段且 A+B 已完成、杂项未开始 → 手动进入杂项（与自动进杂项二选一即可）
   */
  private onAdvanceClicked() {
    playUiClick();
    if (this.isBusy()) return;
    if (this.phase !== 'player') return;
    if (this.outcome !== 'ongoing') return;

    if (this.playerStep === 'movement' || this.playerStep === 'attack' || this.playerStep === 'misc') {
      this.endCurrentSubPhase();
      return;
    }
    if (this.movementDone && this.attackDone && !this.miscDone) {
      this.enterPhase('misc');
    }
  }

  private allUnits(): Unit[] {
    if (!this.mission) return [];
    return [this.mission.sherman, ...this.mission.allies, ...this.mission.enemies];
  }

  private aiTargetsFor(actor: Unit): Unit[] {
    if (!this.mission) return [];
    return actor.faction !== 'allied'
      ? [this.mission.sherman, ...this.mission.allies]
      : this.mission.enemies;
  }

  private currentAITarget(actor: Unit): Unit | null {
    if (!this.mission) return null;
    return currentTargetFor(actor, this.aiTargetsFor(actor), this.mission.sherman, this.rng);
  }

  private selectAIShootTarget(actor: Unit, randomizeTies: boolean, adjacentOnly = false): Unit | null {
    if (!this.mission) return null;
    const { map } = this.mission;
    let bestDist = Infinity;
    const tied: Unit[] = [];
    for (const target of this.aiTargetsFor(actor)) {
      if (target.faction === actor.faction) continue;
      if (isFootUnit(target) || target.kind === 'truck') continue;
      if (adjacentOnly && hexDistance(actor.pos, target.pos) !== 1) continue;
      if (!canAttack({ attacker: actor, target, map }).ok) continue;
      const d = hexDistance(actor.pos, target.pos);
      if (d < bestDist) {
        bestDist = d;
        tied.length = 0;
        tied.push(target);
      } else if (d === bestDist) {
        tied.push(target);
      }
    }
    if (tied.length === 0) return null;
    if (tied.length === 1 || !randomizeTies) return tied[0];
    return tied[this.rng.intRange(0, tied.length - 1)];
  }

  private beginAllyPhase() {
    if (!this.mission) return;
    this.phase = 'enemy';
    this.aiSide = 'ally';
    this.outcome = checkOutcome(this.mission);
    this.updateOutcomeOverlay();
    if (this.outcome !== 'ongoing') {
      this.refreshPhaseUI();
      this.updateHUD();
      this.redraw();
      return;
    }
    const aiCandidates = this.mission.allies.filter(e => !isFootUnit(e) && e.kind !== 'truck');
    this.enemyOrder = selectAIOrder(aiCandidates, this.mission.enemies, this.mission.sherman, this.rng);
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceUsed = [];
    this.destroyEnemyDiceTray();
    this.closeDiePopover();
    if (this.enemyOrder.length === 0) {
      this.beginGermanAIPhase();
      return;
    }
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.battleLogI18n('battleLog.phaseSide', {
      turn: this.turn,
      sideKey: 'battleLog.side.ally',
      count: this.enemyOrder.length,
    });
    this.beginCurrentEnemyTurn();
  }

  private beginGermanAIPhase() {
    if (!this.mission) return;
    this.phase = 'enemy';
    this.aiSide = 'german';
    const aiCandidates = this.mission.enemies.filter(e => !isFootUnit(e) && e.kind !== 'truck');
    this.enemyOrder = selectAIOrder(
      aiCandidates,
      [this.mission.sherman, ...this.mission.allies],
      this.mission.sherman,
      this.rng,
    );
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceUsed = [];
    this.destroyEnemyDiceTray();
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.battleLogI18n('battleLog.phaseSide', {
      turn: this.turn,
      sideKey: 'battleLog.side.german',
      count: this.enemyOrder.length,
    });
    this.beginCurrentEnemyTurn();
  }

  private beginPlayerPhaseForNewTurn() {
    this.phase = 'player';
    this.aiSide = 'german';
    this.enemyOrder = [];
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceUsed = [];
    this.destroyEnemyDiceTray();
    this.playerStep = 'choose';
    this.movementDone = false;
    this.attackDone = false;
    this.miscDone = false;
    this.playerDiceRollAnim = null;
    this.playerDiceSortAnim = null;
    this.phaseDice = [];
    this.clearGunSelection();
    if (this.mission) {
      for (const u of [this.mission.sherman, ...this.mission.allies]) {
        if (!u.destroyed && u.smoked) {
          u.smoked = false;
          this.spawnFloater(u.pos.q, u.pos.r, t('floater.smokeCleared'),
            new Color(200, 200, 220, 255), { size: 20, dur: 0.8, rise: 22 });
          this.battleLog(`[Phase 1] ${unitDisplayName(u.kind)} smoke cleared`);
        }
      }
      this.outcome = checkOutcome(this.mission);
      this.updateOutcomeOverlay();
    }
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.battleLogI18n('battleLog.playerTurnStart', { turn: this.turn });
  }

  private beginEnemyPhase() {
    if (!this.mission) return;
    this.phase = 'enemy';
    this.aiSide = 'ally';
    // §2.1 阶段④：移除德军烟雾（烟雾只保留一回合）
    for (const e of this.mission.enemies) {
      if (!e.destroyed && e.smoked) {
        e.smoked = false;
        this.spawnFloater(e.pos.q, e.pos.r, t('floater.smokeCleared'),
          new Color(200, 200, 220, 255), { size: 20, dur: 0.8, rise: 22 });
        this.battleLog(`[Phase④] ${e.kind} 烟雾消散`);
      }
    }
    // §2.1 阶段⑤：着火程度检定（有 UI 时异步，无火则直接进入后续）
    this.startFireCheckFlowAndContinue();
  }

  /** 阶段⑤ 之后：胜负判定 → 建敌方顺序 → 首辆敌坦回合 */
  private continueEnemyPhaseAfterFireCheck() {
    if (!this.mission) return;
    this.outcome = checkOutcome(this.mission);
    this.updateOutcomeOverlay();
    if (this.outcome !== 'ongoing') {
      this.closeDiePopover();
      this.refreshPhaseUI();
      this.updateHUD();
      this.redraw();
      return;
    }
    // 徒步类（步兵 / 军官）无俯视图 AI；卡车仅在回合结束事件 german_truck_move 中沿路移动，不参与敌方阶段掷骰
    if (this.aiSide !== 'german') {
      this.beginAllyPhase();
      return;
    }
    const aiCandidates = this.mission.enemies.filter(e => !isFootUnit(e) && e.kind !== 'truck');
    this.enemyOrder = selectAIOrder(
      aiCandidates,
      [this.mission.sherman, ...this.mission.allies],
      this.mission.sherman,
      this.rng,
    );
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceUsed = [];
    this.destroyEnemyDiceTray();
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.battleLogI18n('battleLog.phaseSide', {
      turn: this.turn,
      sideKey: 'battleLog.side.german',
      count: this.enemyOrder.length,
    });
    this.beginCurrentEnemyTurn();
  }

  /**
   * §2.1 阶段⑤：无着火则直接 continue；否则预掷全部 d6、弹面板，确认后再写回谢尔曼并 continue。
   */
  private startFireCheckFlowAndContinue() {
    if (!this.mission) return;
    const s = this.mission.sherman;
    const nSnap = s.fireLevel ?? 0;
    if (nSnap <= 0 || s.destroyed) {
      this.continueEnemyPhaseAfterFireCheck();
      return;
    }
    this.battleLog(`[Phase⑤] 着火检定 ×${nSnap}（面板）`);
    this.spawnFloater(s.pos.q, s.pos.r, t('floater.fireCheck'),
      new Color(255, 180, 80, 255), { size: 22, dur: 1.0, rise: 28 });
    const prep = this.prepareFireCheckSteps(nSnap);
    if (prep.steps.length === 0 || prep.allDice.length === 0) {
      this.continueEnemyPhaseAfterFireCheck();
      return;
    }
    const bodyText = this.formatFireCheckBodyText(prep.steps, prep.pendingFire, nSnap);
    const introKey = 'fireCheck.intro';
    const introParams: Record<string, string | number> = {
      n: nSnap,
      rolls: prep.allDice.length,
      dice: prep.allDice.join('+'),
      lowest: prep.steps[0]?.die ?? 0,
    };
    this.destroyFireCheckEventUI();
    this.destroyUsCasualtyEventUI();
    const refs = this.buildFireCheckEventPanel(prep.allDice);
    for (const lab of refs.dieLabels) this.setDieLabelFace(lab, '?');
    refs.sumLabel.string = '';
    refs.bodyLabel.string = '';
    this.fireCheckEventUI = {
      root: refs.root,
      stage: 'roll',
      t: 0,
      dieLabels: refs.dieLabels,
      allDice: prep.allDice,
      sumLabel: refs.sumLabel,
      bodyLabel: refs.bodyLabel,
      introKey,
      introParams,
      bodyText,
      apply: () => {
        let pendingFire = 0;
        for (const st of prep.steps) {
          if (s.destroyed) break;
          const preCrew = st.effect === 'crewCheck' && st.crewDie !== undefined
            ? { crewDie: st.crewDie, crewSlot: st.crewSlot ?? null }
            : undefined;
          this.applyFireCheckEffect(s, st.effect, () => { pendingFire += 1; }, preCrew);
        }
        if (!s.destroyed && pendingFire > 0) {
          s.fireLevel = (s.fireLevel ?? 0) + pendingFire;
          this.battleLog(`[Phase⑤] fireLevel += ${pendingFire} → ${s.fireLevel}`);
        }
        this.refreshStatusPanel();
        this.redraw();
      },
    };
  }

  /**
   * 预掷本批次全部着火检定骰，用于 UI 展示；只按最低点数生成 1 次伤害结算。
   * 阵亡检定二次骰复用 Combat.resolveCrewCheck，保持已死乘员重掷等细节一致。
   */
  private prepareFireCheckSteps(nSnap: number): {
    steps: FireCheckPreparedStep[];
    pendingFire: number;
    allDice: number[];
  } {
    const steps: FireCheckPreparedStep[] = [];
    const allDice: number[] = [];

    for (let i = 0; i < nSnap; i++) {
      allDice.push(this.rng.d6());
    }

    if (allDice.length === 0) {
      return { steps, pendingFire: 0, allDice };
    }

    const die = Math.min(...allDice);
    const effect = resolveDamageEffect(this.mission!.sherman, die, true);
    this.battleLog(`[Phase⑤] dice=${allDice.join('+')} min=${die} → ${effect}`);

    if (effect === 'crewCheck') {
      const crew = resolveCrewCheck(this.mission!.sherman, this.rng);
      steps.push({ die, effect, crewDie: crew.die, crewSlot: crew.slot });
    } else {
      steps.push({ die, effect });
    }
    return { steps, pendingFire: effect === 'fire' ? 1 : 0, allDice };
  }

  private formatFireCheckBodyText(
    steps: FireCheckPreparedStep[],
    pendingFire: number,
    nSnap: number,
  ): string {
    const lines: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      let outcome = '';
      if (st.effect === 'crewCheck') {
        outcome = st.crewSlot != null
          ? t('fireCheck.crewKia', { role: t(`crew.role.${st.crewSlot}`), cd: st.crewDie ?? 0 })
          : t('fireCheck.crewSafe', { cd: st.crewDie ?? 0 });
      } else {
        outcome = this.fireCheckOutcomePhrase(st.effect);
      }
      lines.push(t('fireCheck.lowestLine', { die: st.die, outcome }));
    }
    if (pendingFire > 0) {
      lines.push(t('fireCheck.batchFire', { k: pendingFire, n: nSnap }));
    }
    return lines.join('\n');
  }

  private fireCheckOutcomePhrase(effect: DamageEffect): string {
    switch (effect) {
      case 'destroyed': return t('dmg.outcome.destroyed');
      case 'fire': return t('dmg.effect.fire');
      case 'turret': return t('dmg.outcome.turret');
      case 'paralyzed': return t('dmg.outcome.paralyzed');
      case 'damaged': return t('dmg.outcome.damaged');
      case 'crewCheck': return t('dmg.outcome.crewCheck');
      default: return String(effect);
    }
  }

  /**
   * 着火检定单次结果 → 状态写回 + 浮字反馈。
   * 'fire' 不就地累加 fireLevel，而是通过 onFire 回调交给调用方批量结算。
   * `preCrew` 有值时（面板确认回放）不再掷二次骰，与预掷一致。
   */
  private applyFireCheckEffect(
    s: Unit,
    effect: DamageEffect,
    onFire: () => void,
    preCrew?: { crewDie: number; crewSlot: number | null },
  ) {
    const pos = s.pos;
    const color = new Color(255, 180, 80, 255);
    switch (effect) {
      case 'destroyed':
        s.destroyed = true;
        this.registerDestroyWreckVisual(s);
        this.spawnFloater(pos.q, pos.r, t('dmg.outcome.destroyed'),
          new Color(255, 100, 100, 255), { size: 26, dur: 1.2, rise: 32 });
        break;
      case 'fire':
        onFire();
        this.spawnFloater(pos.q, pos.r, t('dmg.effect.fire'), color,
          { size: 22, dur: 0.9, rise: 24 });
        break;
      case 'turret':
        if (s.kind !== 'sherman') s.damaged = true;
        s.turretDamaged = true;
        this.spawnFloater(pos.q, pos.r, t('dmg.outcome.turret'), color,
          { size: 22, dur: 0.9, rise: 24 });
        break;
      case 'paralyzed':
        if (s.kind !== 'sherman') s.damaged = true;
        s.paralyzed = true;
        this.spawnFloater(pos.q, pos.r, t('dmg.outcome.paralyzed'), color,
          { size: 22, dur: 0.9, rise: 24 });
        break;
      case 'crewCheck': {
        // §3.4 Step 3 d6=2：再掷一次决定哪位乘员阵亡（与受击穿同机制）
        if (s.kind !== 'sherman') s.damaged = true;
        const crewDie = preCrew?.crewDie ?? this.rng.d6();
        const slot = preCrew
          ? preCrew.crewSlot
          : (crewDie >= 1 && crewDie <= 5
            ? crewDie as 1 | 2 | 3 | 4 | 5
            : (s.hatchOpen ? 1 : null));
        if (slot !== null && s.crew) {
          switch (slot) {
            case 1:
              s.crew.commander = false;
              if (s.kind === 'sherman') s.hatchOpen = false;
              break;
            case 2: s.crew.loader = false;    break;
            case 3: s.crew.gunner = false;    break;
            case 4: s.crew.driver = false;    break;
            case 5: s.crew.coDriver = false;  break;
          }
          this.spawnFloater(pos.q, pos.r, t('crew.death.kia', { role: t('crew.role.' + slot) }),
            new Color(255, 120, 120, 255), { size: 22, dur: 1.0, rise: 26 });
          this.battleLog(`[Phase⑤] 阵亡检定 d6=${crewDie} → slot=${slot}`);
        } else {
          this.spawnFloater(pos.q, pos.r, t('crew.death.falseAlarm'),
            new Color(200, 200, 200, 255), { size: 20, dur: 0.9, rise: 24 });
          this.battleLog(`[Phase⑤] 阵亡检定 d6=${crewDie} → 虚惊`);
        }
        break;
      }
      case 'damaged':
        if (s.kind !== 'sherman') s.damaged = true;
        break;
    }
  }

  // ---------- 战斗内设置 / 退出确认模态 ----------

  private closeBattleModal() {
    if (this.battleModalRoot && this.battleModalRoot.isValid) this.battleModalRoot.destroy();
    this.battleModalRoot = null;
    this.battleSettingsRefs = null;
  }

  private closeBattleExitModal() {
    if (this.battleExitModalRoot && this.battleExitModalRoot.isValid) {
      this.battleExitModalRoot.destroy();
    }
    this.battleExitModalRoot = null;
  }

  private closeAllBattleModals() {
    this.closeBattleExitModal();
    this.closeBattleModal();
    this.closeTileInspectModal();
    this.destroyUsCasualtyEventUI();
    this.setCombatLogExpanded(false);
  }

  private closeTileInspectModal() {
    if (this.onTileInspectBarFrame) {
      this.unschedule(this.onTileInspectBarFrame);
      this.onTileInspectBarFrame = null;
    }
    this.tileInspectScroll = null;
    this.tileInspectVBar = null;
    const r = this.tileInspectModalRoot;
    this.tileInspectModalRoot = null;
    if (r && r.isValid) r.destroy();
  }

  /** 触点 UI 坐标 → 离格心最近的六角格（空白处返回 null） */
  private pickTileAtScreenUi(event: EventTouch): Tile | null {
    if (!this.mission || !this.mapNode) return null;
    const ut = this.mapNode.getComponent(UITransform);
    if (!ut) return null;
    const uiPos = event.getUILocation();
    const localPos = ut.convertToNodeSpaceAR(new Vec3(uiPos.x, uiPos.y, 0));
    const tiles = this.mission.map.all();
    let target: Tile | null = null;
    let minDist = Infinity;
    for (const t of tiles) {
      const c = this.project(t.pos.q, t.pos.r);
      const d = Math.hypot(c.x - localPos.x, c.y - localPos.y);
      if (d < minDist) {
        minDist = d;
        target = t;
      }
    }
    if (!target || minDist > this.hexSize) return null;
    return target;
  }

  private unitOnTileAxial(pos: { q: number; r: number }): Unit | null {
    return this.unitsOnTileAxial(pos)[0] ?? null;
  }

  private unitsOnTileAxial(pos: { q: number; r: number }): Unit[] {
    if (!this.mission) return [];
    const { sherman, enemies } = this.mission;
    const all = [sherman, ...this.mission.allies, ...enemies];
    const units = all.filter(u => !u.destroyed && u.pos.q === pos.q && u.pos.r === pos.r);
    return units.sort((a, b) => {
      const af = isFootUnit(a) ? 1 : 0;
      const bf = isFootUnit(b) ? 1 : 0;
      return af - bf;
    });
  }

  private collectUnitInspectStatusLines(u: Unit): string[] {
    const parts: string[] = [];
    const tankLike = !isFootUnit(u);
    if (u.kind === 'sherman') {
      if ((u.fireLevel ?? 0) > 0) {
        parts.push(t('tileInspect.status.shermanFire', { n: u.fireLevel ?? 0 }));
      }
      if (u.turretDamaged) parts.push(t('tileInspect.status.turretDamaged'));
      if (u.paralyzed) parts.push(t('tileInspect.status.paralyzed'));
      if (u.hidden) parts.push(t('tileInspect.status.hidden'));
      if (u.smoked) parts.push(t('tileInspect.status.smoked'));
      parts.push(u.loaded ? t('tileInspect.status.loaded') : t('tileInspect.status.unloaded'));
      if (u.hatchOpen) parts.push(t('tileInspect.status.hatchOpen'));
    } else if (tankLike) {
      if (u.damaged) parts.push(t('tileInspect.status.enemyDamaged'));
      if (u.turretDamaged) parts.push(t('tileInspect.status.turretDamaged'));
      if (u.paralyzed) parts.push(t('tileInspect.status.paralyzed'));
      if (u.hidden) parts.push(t('tileInspect.status.hidden'));
      if (u.smoked) parts.push(t('tileInspect.status.smoked'));
    } else {
      if (u.hidden) parts.push(t('tileInspect.status.hidden'));
      if (u.smoked) parts.push(t('tileInspect.status.smoked'));
    }
    return parts;
  }

  /** 格子文字（不含最上行地形名——见左上角；不含单位——见下方面板） */
  private buildTileInspectTerrainText(tile: Tile): string {
    const blocks: string[] = [];
    if (tile.hasBuilding) {
      blocks.push(t('tileInspect.building'));
    }
    if (tile.terrain === 'forest') {
      blocks.push(t('tileInspect.rules.forest'));
    } else if (tile.terrain === 'water' && !tileHasBridge(tile)) {
      // 仅"未叠桥的水域"才提示「不可入」；叠桥后该格变为可通行 → 改用桥梁说明文案。
      blocks.push(t('tileInspect.rules.water'));
    }
    if (tileHasBridge(tile)) {
      blocks.push(t('tileInspect.rules.bridge', {
        a: tile.bridgeEnds![0],
        b: tile.bridgeEnds![1],
      }));
    }
    if (this.tileInspectVisibleHedgeDirs(tile).some(Boolean)) {
      blocks.push(t('tileInspect.hedges'));
    }
    if (this.tileInspectVisibleBreakwaterDirs(tile).some(Boolean)) {
      blocks.push(t('tileInspect.breakwaters'));
    }
    if (tile.reinforceId != null) {
      blocks.push(t('tileInspect.markerRid', { n: tile.reinforceId }));
    }
    if (tile.enemyStartId != null) {
      blocks.push(t('tileInspect.markerEid', { n: tile.enemyStartId }));
    }

    // 桥梁叠加（GDD §3.2）：水域+桥梁的骰子基数读取按公路；这里 tile 面板与实际掷骰一致。
    const pool = PLAYER_DICE_POOL;
    const b = pool.baseByPhaseTerrain;
    const eff = effectiveDiceTerrain(tile);
    const mv = b.movement[eff];
    const at = b.attack[eff];
    const ms = b.misc[eff];
    blocks.push(t('tileInspect.diceRow.move', {
      n: mv,
      md: pool.moveMods.driver,
      mc: pool.moveMods.codriver,
      mh: pool.moveMods.hatch,
    }));
    blocks.push(t('tileInspect.diceRow.attack', {
      n: at,
      ag: pool.attackMods.gunner,
      al: pool.attackMods.loader,
      ah: pool.attackMods.hatch,
    }));
    blocks.push(t('tileInspect.diceRow.misc', {
      n: ms,
      xc: pool.miscMods.hatch,
    }));

    return blocks.join('\n\n');
  }

  /** 左栏多行文本，返回量得的高度（Cocos 需 updateRenderData 后高度才准） */
  private makeTileScrollText(
    parent: Node, x: number, topY: number, w: number, str: string, size: number,
  ): { node: Node; h: number; label: Label } {
    const n = new Node('T');
    n.layer = this.node.layer;
    n.addComponent(UITransform).setContentSize(w, 0);
    const ut = n.getComponent(UITransform)!;
    ut.setAnchorPoint(0, 1);
    n.setPosition(x, topY, 0);
    const l = n.addComponent(Label);
    l.fontSize = size;
    l.lineHeight = size + 4;
    l.string = str;
    l.color = new Color(220, 225, 230, 255);
    l.horizontalAlign = HorizontalTextAlignment.LEFT;
    l.verticalAlign = VerticalTextAlignment.TOP;
    l.overflow = Label.Overflow.RESIZE_HEIGHT;
    parent.addChild(n);
    l.updateRenderData(true);
    const h = Math.max(1, n.getComponent(UITransform)!.contentSize.height);
    return { node: n, h, label: l };
  }

  private makeTileScrollSmallCaptions(
    parent: Node, x0: number, topY: number, colW: number, strs: string[], size: number, gap: number,
  ): { h: number } {
    let hMax = 0;
    for (let i = 0; i < strs.length; i++) {
      const n = new Node('C');
      n.layer = this.node.layer;
      n.addComponent(UITransform).setContentSize(colW, 0);
      n.getComponent(UITransform)!.setAnchorPoint(0, 1);
      n.setPosition(x0 + i * (colW + gap), topY, 0);
      const l = n.addComponent(Label);
      l.fontSize = size;
      l.lineHeight = size + 3;
      l.string = strs[i]!;
      l.color = new Color(185, 195, 210, 255);
      l.horizontalAlign = HorizontalTextAlignment.CENTER;
      l.verticalAlign = VerticalTextAlignment.TOP;
      l.overflow = Label.Overflow.RESIZE_HEIGHT;
      parent.addChild(n);
      l.updateRenderData(true);
      hMax = Math.max(hMax, n.getComponent(UITransform)!.contentSize.height);
    }
    return { h: hMax };
  }

  private makeTileScrollValueRow(
    parent: Node, x0: number, topY: number, colW: number, vals: number[], size: number, gap: number,
  ): { h: number } {
    let hMax = 0;
    for (let i = 0; i < vals.length; i++) {
      const n = new Node('V');
      n.layer = this.node.layer;
      n.addComponent(UITransform).setContentSize(colW, 0);
      n.getComponent(UITransform)!.setAnchorPoint(0, 1);
      n.setPosition(x0 + i * (colW + gap), topY, 0);
      const l = n.addComponent(Label);
      l.fontSize = size;
      l.lineHeight = size + 4;
      l.string = String(vals[i]!);
      l.color = new Color(250, 252, 255, 255);
      l.horizontalAlign = HorizontalTextAlignment.CENTER;
      l.verticalAlign = VerticalTextAlignment.TOP;
      l.overflow = Label.Overflow.RESIZE_HEIGHT;
      parent.addChild(n);
      l.updateRenderData(true);
      hMax = Math.max(hMax, n.getComponent(UITransform)!.contentSize.height);
    }
    return { h: hMax };
  }

  private fillTileInspectScrollContent(
    content: Node, innerW: number, tile: Tile, padL: number,
  ): { totalH: number; lowest: number } {
    const pl = padL;
    const pr = 8;
    const imageColW = 132;
    const imageGap = 18;
    const textW = innerW - pl - pr - imageColW - imageGap;
    const imageCX = -innerW / 2 + pl + imageColW * 0.5;
    const x0 = -innerW / 2 + pl + imageColW + imageGap;
    let y = -10;
    let low = 0;
    const mark = (top: number, h: number) => { low = Math.min(low, top - h); };
    const gapL = 12;
    // 地形/骰子
    {
      this.addTileInspectTilePreview(content, tile, imageCX, y, 38);
      const { h } = this.makeTileScrollText(content, x0, y, textW, this.buildTileInspectTerrainText(tile), 16);
      const blockH = Math.max(h, 114);
      mark(y, blockH);
      y = y - blockH - gapL;
    }
    // 分割线
    {
      const divH = 1;
      const padDiv = 10;
      const d = new Node('Div');
      d.layer = this.node.layer;
      d.addComponent(UITransform).setContentSize(textW, padDiv);
      d.getComponent(UITransform)!.setAnchorPoint(0, 1);
      d.setPosition(x0, y, 0);
      const g = d.addComponent(Graphics);
      g.lineWidth = 0;
      g.fillColor = BATTLE_MODAL_DIVIDER;
      g.rect(0, 0, textW, divH);
      g.fill();
      content.addChild(d);
      mark(y, padDiv);
      y = y - padDiv - 2;
    }
    // 单位区
    const units = this.unitsOnTileAxial(tile.pos);
    if (units.length === 0) {
      const { h } = this.makeTileScrollText(content, x0, y, textW, t('tileInspect.noUnit'), 16);
      mark(y, h);
      return { totalH: -low + 16, lowest: low };
    }
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const unitTopY = y;
      this.addTileInspectUnitPreview(content, u, imageCX, unitTopY, 34);
      const title = t('tileInspect.currentUnit', { name: t(`unit.name.${u.kind}`) });
      const { h } = this.makeTileScrollText(content, x0, y, textW, title, 17);
      y = y - h - 8;

      if (isFootUnit(u)) {
        // 徒步类（步兵 / 军官）：无装甲 / 穿甲数据表，仅显示提示
        const { h: footH } = this.makeTileScrollText(content, x0, y, textW, t('tileInspect.infantryNoTable'), 15);
        y = y - footH - gapL;
      } else {
        const st = u.stats;
        const cols = 5;
        const gap = 4;
        const colW = (textW - (cols - 1) * gap) / cols;
        const heads = [t('tileInspect.colFront'), t('tileInspect.colFrontSide'), t('tileInspect.colRearSide'),
          t('tileInspect.colRear'), t('tileInspect.colPen')];
        const th = this.makeTileScrollSmallCaptions(content, x0, y, colW, heads, 12, gap).h;
        y = y - th - 6;
        const { h: vh } = this.makeTileScrollValueRow(content, x0, y, colW, [
          st.armorFront, st.armorFrontSide, st.armorRearSide, st.armorRear, st.penetration,
        ], 17, gap);
        y = y - vh - gapL;
      }

      const stLines = this.collectUnitInspectStatusLines(u);
      const stText = stLines.length ? stLines.join(t('tileInspect.statusSep')) : t('tileInspect.statusNone');
      const { h: hs } = this.makeTileScrollText(
        content, x0, y, textW, t('tileInspect.currentStatus', { status: stText }), 16,
      );
      y = y - hs;
      const unitBlockH = Math.max(unitTopY - y, 92);
      mark(unitTopY, unitBlockH);
      y = unitTopY - unitBlockH;
      if (i < units.length - 1) {
        const divPad = 18;
        const d = new Node('UnitDiv');
        d.layer = this.node.layer;
        d.addComponent(UITransform).setContentSize(textW, divPad);
        d.getComponent(UITransform)!.setAnchorPoint(0, 1);
        d.setPosition(x0, y - 8, 0);
        const g = d.addComponent(Graphics);
        g.lineWidth = 0;
        g.fillColor = BATTLE_MODAL_DIVIDER;
        g.rect(0, 0, textW, 1);
        g.fill();
        content.addChild(d);
        mark(y - 8, divPad);
        y = y - divPad - 2;
      }
    }
    return { totalH: -low + 16, lowest: low };
  }

  /** 在模态小预览区绘制六角地形 + 林冠/建筑示意 */
  private paintTileInspectPreview(g: Graphics, tile: Tile, cx: number, cy: number, hexR: number) {
    const oldG = this.g;
    this.g = g;
    const hasTerrainSprite = !!this.terrainSpriteFrames[tile.terrain];
    if (!hasTerrainSprite) {
      this.drawHexFill(cx, cy, hexR, tile.terrain === 'airstrip' ? TERRAIN_COLORS.clear : TERRAIN_COLORS[tile.terrain]);
      if (tile.terrain === 'field') this.drawFieldBrushOverlay(cx, cy, hexR, tile);
    }
    if (!hasTerrainSprite && tile.terrain !== 'deep_water') this.drawHexStroke(cx, cy, hexR);
    if (tile.terrain === 'deep_water') this.drawDeepWaterOverlay(cx, cy, hexR, tile);
    if (tile.terrain === 'water' && this.mission?.map) {
      this.drawWaterBankOverlay(cx, cy, hexR, tile, this.mission.map);
    }
    if (tile.terrain === 'mud' && !hasTerrainSprite) this.drawMudOverlay(cx, cy, hexR, tile);
    if (tile.terrain === 'road' && !hasTerrainSprite) this.drawRoadHexOverlay(cx, cy, hexR, tile);
    if (tileHasBridge(tile)) this.drawBridgeOverlay(cx, cy, hexR, tile.bridgeEnds!);
    if (tile.roads) {
      if (tile.terrain === 'airstrip') this.drawAirstripOverlay(cx, cy, hexR, tile.roads, tile);
      else this.drawRoadOverlay(cx, cy, hexR, tile.roads, tile);
    }
    if (tile.hasBuilding) this.drawBuildingOverlay(cx, cy, hexR, tile);
    if (tile.breakwaters) {
      const usedKeys = new Set<string>();
      for (let ax = 0; ax < 6; ax++) {
        if (tile.breakwaters[ax]) {
          this.drawBreakwaterEdge(cx, cy, hexR, HEDGE_DRAW_EDGE_BY_AXIAL[ax], tile.pos.q, tile.pos.r, usedKeys);
        }
      }
    }
    if (!hasTerrainSprite && tile.terrain !== 'deep_water') this.drawHexStroke(cx, cy, hexR);
    this.g = oldG;
  }

  private tileInspectVisibleHedgeDirs(tile: Tile): boolean[] {
    const map = this.mission?.map;
    const dirs: boolean[] = [];
    for (let ax = 0; ax < 6; ax++) {
      if (tile.hedges?.[ax]) {
        dirs[ax] = true;
        continue;
      }
      const np = neighbor(tile.pos, ax as Direction);
      const nt = map?.get(np);
      const back = directionTo(np, tile.pos);
      dirs[ax] = back !== null && !!nt?.hedges?.[back];
    }
    return dirs;
  }

  private tileInspectVisibleBreakwaterDirs(tile: Tile): boolean[] {
    const map = this.mission?.map;
    const dirs: boolean[] = [];
    for (let ax = 0; ax < 6; ax++) {
      if (tile.breakwaters?.[ax]) {
        dirs[ax] = true;
        continue;
      }
      const np = neighbor(tile.pos, ax as Direction);
      const nt = map?.get(np);
      const back = directionTo(np, tile.pos);
      dirs[ax] = back !== null && !!nt?.breakwaters?.[back];
    }
    return dirs;
  }

  private addTileInspectForestSprites(parent: Node, cx: number, cy: number, size: number, tile: Tile) {
    if (tile.terrain !== 'forest') return;
    const frames = this.treeSpriteFrames.filter((sf): sf is SpriteFrame => !!sf);
    if (frames.length === 0) return;
    const seedRaw =
      ((tile.pos.q | 0) * 92811 + (tile.pos.r | 0) * 6899 + 0x4f2a91) >>> 0;
    const rng = new RNG(seedRaw === 0 ? 1 : seedRaw);
    const trees: Array<{ ox: number; oy: number; scale: number }> = [
      { ox: -0.22, oy: 0.22, scale: 0.60 },
      { ox: 0.20, oy: 0.26, scale: 0.66 },
      { ox: -0.04, oy: -0.02, scale: 0.52 },
      { ox: -0.26, oy: -0.25, scale: 0.48 },
      { ox: 0.24, oy: -0.22, scale: 0.58 },
    ];
    if (rng.next() < 0.55) trees.push({ ox: 0.02, oy: 0.43, scale: 0.44 });

    for (let i = 0; i < trees.length; i++) {
      const p = trees[i];
      const x = cx + (p.ox + (rng.next() - 0.5) * 0.07) * size;
      const y = cy + (p.oy + (rng.next() - 0.5) * 0.07) * size;
      const scale = p.scale * (0.92 + rng.next() * 0.18);
      this.addTileInspectTreeSprite(parent, x, y, size, seedRaw + i * 101, scale);
    }
  }

  private addTileInspectTreeSprite(parent: Node, cx: number, cy: number, hexSize: number, seed: number, scale: number) {
    const frames = this.treeSpriteFrames.filter((sf): sf is SpriteFrame => !!sf);
    if (frames.length === 0) return;
    const rng = new RNG(seed || 1);
    const n = new Node('TileInspectTreeSprite');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    const sp = n.addComponent(Sprite);
    sp.spriteFrame = frames[Math.abs(seed) % frames.length];
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    ut.setContentSize(hexSize * scale, hexSize * scale);
    n.setPosition(cx, cy, 0);
    n.angle = (rng.next() - 0.5) * 18;
    const spriteScale = 0.92 + rng.next() * 0.18;
    n.setScale(spriteScale, spriteScale, 1);
    parent.addChild(n);
  }

  private addTileInspectHedgeSprites(parent: Node, cx: number, cy: number, size: number, tile: Tile) {
    const frames = this.treeSpriteFrames.filter((sf): sf is SpriteFrame => !!sf);
    if (frames.length === 0) return;
    const dirs = this.tileInspectVisibleHedgeDirs(tile);
    const usedKeys = new Set<string>();
    for (let ax = 0; ax < 6; ax++) {
      if (!dirs[ax]) continue;
      this.addTileInspectHedgeEdgeSprites(
        parent,
        cx,
        cy,
        size,
        HEDGE_DRAW_EDGE_BY_AXIAL[ax],
        tile.pos.q,
        tile.pos.r,
        usedKeys,
      );
    }
  }

  private addTileInspectHedgeEdgeSprites(
    parent: Node,
    cx: number,
    cy: number,
    size: number,
    edgeIndex: number,
    q: number,
    r: number,
    usedKeys: Set<string>,
  ) {
    const a1 = (-30 + 60 * edgeIndex) * Math.PI / 180;
    const a2 = (-30 + 60 * (edgeIndex + 1)) * Math.PI / 180;
    const x0 = cx + size * Math.cos(a1);
    const y0 = cy + size * Math.sin(a1);
    const x1 = cx + size * Math.cos(a2);
    const y1 = cy + size * Math.sin(a2);
    const tx = x1 - x0;
    const ty = y1 - y0;
    const len = Math.hypot(tx, ty) || 1;
    const ux = tx / len;
    const uy = ty / len;
    let nx = cx - (x0 + x1) * 0.5;
    let ny = cy - (y0 + y1) * 0.5;
    const nlen = Math.hypot(nx, ny) || 1;
    nx /= nlen;
    ny /= nlen;

    const n = BattleScene.HEDGE_TREES_PER_EDGE;
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1);
      const baseX = x0 + tx * f;
      const baseY = y0 + ty * f;
      const key = `${Math.round(baseX * 8)},${Math.round(baseY * 8)}`;
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      const keySeed = this.hashStringToSeed(key);
      const local = new RNG(keySeed);
      const along = (local.next() - 0.5) * size * (k === 1 ? 0.08 : 0.025);
      const across = (local.next() - 0.5) * size * 0.14;
      const px = baseX + ux * along + nx * across;
      const py = baseY + uy * along + ny * across;
      const scale = 0.40 + local.next() * 0.12;
      this.addTileInspectTreeSprite(parent, px, py, size, keySeed, scale);
    }
  }

  private addTileInspectTerrainSprite(parent: Node, tile: Tile, cx: number, cy: number, hexR: number) {
    const sf = this.terrainSpriteFrames[tile.terrain];
    if (!sf) return;
    const n = new Node('TileInspectTerrainSprite');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    const sp = n.addComponent(Sprite);
    sp.spriteFrame = sf;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    ut.setContentSize(hexR * Math.sqrt(3), hexR * 2);
    n.setPosition(cx, cy, 0);
    parent.addChild(n);
  }

  private addTileInspectTilePreview(parent: Node, tile: Tile, centerX: number, topY: number, hexR: number) {
    const h = 114;
    const preview = new Node('TilePreview');
    preview.layer = this.node.layer;
    preview.addComponent(UITransform).setContentSize(132, h);
    preview.setPosition(centerX, topY - h * 0.5, 0);
    parent.addChild(preview);

    const hexCY = 24;
    this.addTileInspectTerrainSprite(preview, tile, 0, hexCY, hexR);
    const overlay = new Node('TilePreviewOverlay');
    overlay.layer = this.node.layer;
    overlay.addComponent(UITransform).setContentSize(132, h);
    preview.addChild(overlay);
    const pvg = overlay.addComponent(Graphics);
    this.paintTileInspectPreview(pvg, tile, 0, hexCY, hexR);
    this.addTileInspectForestSprites(preview, 0, hexCY, hexR, tile);
    this.addTileInspectHedgeSprites(preview, 0, hexCY, hexR, tile);

    const baseTerrainName = t(`terrain.${tile.terrain}`);
    const titleStr = tileHasBridge(tile)
      ? `${baseTerrainName} + ${t('terrain.bridge')}`
      : baseTerrainName;
    const lab = this.makeBattleModalLabel(
      preview, titleStr,
      0, -42, 132, 24, 18, new Color(235, 240, 245, 255),
    );
    lab.horizontalAlign = HorizontalTextAlignment.CENTER;
    lab.verticalAlign = VerticalTextAlignment.CENTER;
  }

  private addTileInspectSprite(
    parent: Node,
    sf: SpriteFrame,
    dw: number,
    dh: number,
    fit: number,
    x = 0,
    y = 0,
    angle = 0,
  ) {
    const n = new Node('TileInspectUnitSprite');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    const sp = n.addComponent(Sprite);
    sp.spriteFrame = sf;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    const w = dw > 0 ? dw : sf.width;
    const h = dh > 0 ? dh : sf.height;
    const maxDim = Math.max(w, h) || 1;
    ut.setContentSize((w / maxDim) * fit, (h / maxDim) * fit);
    n.setPosition(x, y, 0);
    n.angle = angle;
    parent.addChild(n);
  }

  private addTileInspectCustomSprite(
    parent: Node,
    sf: SpriteFrame,
    w: number,
    h: number,
    x: number,
    y: number,
    angle: number,
    anchorX = 0.5,
    anchorY = 0.5,
  ) {
    const n = new Node('TileInspectUnitSprite');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    const sp = n.addComponent(Sprite);
    sp.spriteFrame = sf;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    ut.setContentSize(w, h);
    ut.setAnchorPoint(anchorX, anchorY);
    n.setPosition(x, y, 0);
    n.angle = angle;
    parent.addChild(n);
  }

  private tileInspectFacingAngle(u: Unit): number {
    if (u.facing === null) return 180;
    const edge = HEDGE_DRAW_EDGE_BY_AXIAL[u.facing];
    const a = (60 * edge * Math.PI) / 180;
    return (Math.atan2(Math.sin(a), Math.cos(a)) * 180) / Math.PI + 180;
  }

  private tileInspectForwardVec(u: Unit): { ux: number; uy: number } {
    const a = ((this.tileInspectFacingAngle(u) - 180) * Math.PI) / 180;
    return { ux: Math.cos(a), uy: Math.sin(a) };
  }

  private addTileInspectTopDownTankSprite(
    parent: Node,
    u: Unit,
    sf: SpriteFrame,
    displayW: number,
    displayH: number,
    hexR: number,
    preserveAspectRatio = false,
  ) {
    const cfg = tankVisualConfigOf(u.kind);
    const w = displayW > 0 ? displayW : sf.width;
    const h = displayH > 0 ? displayH : sf.height;
    const fit = hexR * 1.8 * cfg.fitScale;
    const maxDim = Math.max(w, h) || 1;
    const tw0 = (w / maxDim) * fit;
    const th0 = (h / maxDim) * fit;
    const k = preserveAspectRatio ? 1 : Math.sqrt(Math.max(1e-6, cfg.aspectRatioMul));
    const body = this.tileInspectForwardVec(u);
    const offsetUnit = hexR * Math.sqrt(3);
    const f = cfg.offsetForward * offsetUnit;
    const r = cfg.offsetRight * offsetUnit;
    this.addTileInspectCustomSprite(
      parent,
      sf,
      tw0 * k,
      th0 / k,
      f * body.ux + r * body.uy,
      f * body.uy + r * (-body.ux),
      this.tileInspectFacingAngle(u),
    );
  }

  private addTileInspectDestroyedTankSprite(
    parent: Node,
    u: Unit,
    sf: SpriteFrame,
    displayW: number,
    displayH: number,
    hexR: number,
  ) {
    const w = displayW > 0 ? displayW : sf.width;
    const h = displayH > 0 ? displayH : sf.height;
    const size = this.destroyedTankDisplaySize(u.kind, w, h, hexR);
    const body = this.tileInspectForwardVec(u);
    const offsetUnit = hexR * Math.sqrt(3);
    const offset = this.destroyedTankOffset(u.kind, offsetUnit);
    const f = offset.forward;
    const r = offset.right;
    this.addTileInspectCustomSprite(
      parent,
      sf,
      size.w,
      size.h,
      f * body.ux + r * body.uy,
      f * body.uy + r * (-body.ux),
      this.tileInspectFacingAngle(u),
    );
  }

  private addTileInspectShermanSplit(parent: Node, u: Unit, hexR: number): boolean {
    const hull = this.shermanHullSpriteFrame;
    const turret = this.shermanTurretSpriteFrame;
    if (!hull || !turret) return false;
    const cfg = SHERMAN_SPLIT_VISUAL_CONFIG;
    const srcW = BattleScene.SHERMAN_TOP_TRIM_W;
    const srcH = BattleScene.SHERMAN_TOP_TRIM_H;
    const fit = hexR * 1.8 * cfg.hullFitScale;
    const maxDim = Math.max(srcW, srcH) || 1;
    const tw0 = (srcW / maxDim) * fit;
    const th0 = (srcH / maxDim) * fit;
    const topW = tw0;
    const topH = th0;
    const scaleX = topW / srcW;
    const scaleY = topH / srcH;
    const body = this.tileInspectForwardVec(u);
    const offsetUnit = hexR * Math.sqrt(3);
    const f = cfg.hullOffsetForward * offsetUnit;
    const r = cfg.hullOffsetRight * offsetUnit;
    const baseX = f * body.ux + r * body.uy;
    const baseY = f * body.uy + r * (-body.ux);
    const turretOffsetF = BattleScene.SHERMAN_TURRET_OFFSET_FORWARD * scaleX;
    const turretOffsetR = BattleScene.SHERMAN_TURRET_OFFSET_RIGHT * scaleY;
    const angle = this.tileInspectFacingAngle(u);

    this.addTileInspectCustomSprite(parent, hull, topW, topH, baseX, baseY, angle);

    const pivotLocalX = (BattleScene.SHERMAN_TURRET_PIVOT_X
      - (BattleScene.SHERMAN_TOP_TRIM_X + BattleScene.SHERMAN_TOP_TRIM_W / 2)) * scaleX;
    const pivotLocalY = ((BattleScene.SHERMAN_TOP_TRIM_Y + BattleScene.SHERMAN_TOP_TRIM_H / 2)
      - BattleScene.SHERMAN_TURRET_PIVOT_Y) * scaleY;
    const bodyAngle = Math.atan2(body.uy, body.ux) + Math.PI;
    const cos = Math.cos(bodyAngle);
    const sin = Math.sin(bodyAngle);
    this.addTileInspectCustomSprite(
      parent,
      turret,
      BattleScene.SHERMAN_TURRET_TRIM_W * scaleX * cfg.turretScale,
      BattleScene.SHERMAN_TURRET_TRIM_H * scaleY * cfg.turretScale,
      baseX + (pivotLocalX + turretOffsetF) * cos - (pivotLocalY + turretOffsetR) * sin,
      baseY + (pivotLocalX + turretOffsetF) * sin + (pivotLocalY + turretOffsetR) * cos,
      angle,
      (BattleScene.SHERMAN_TURRET_SPRITE_PIVOT_X - BattleScene.SHERMAN_TURRET_TRIM_X) / BattleScene.SHERMAN_TURRET_TRIM_W,
      1 - ((BattleScene.SHERMAN_TURRET_SPRITE_PIVOT_Y - BattleScene.SHERMAN_TURRET_TRIM_Y) / BattleScene.SHERMAN_TURRET_TRIM_H),
    );
    return true;
  }

  private addTileInspectSplitTank(
    parent: Node,
    u: Unit,
    hexR: number,
    hullFrame: SpriteFrame | null,
    turretFrame: SpriteFrame | null,
    cfg: SplitTankVisualConfig,
    topTrim: { x: number; y: number; w: number; h: number },
    turretTrim: { x: number; y: number; w: number; h: number },
    pivot: { bodyX: number; bodyY: number; spriteX: number; spriteY: number },
  ): boolean {
    if (!hullFrame || !turretFrame) return false;
    const body = this.tileInspectForwardVec(u);
    const angle = this.tileInspectFacingAngle(u);
    const fit = hexR * 1.8 * cfg.hullFitScale;
    const scale = fit / (Math.max(topTrim.w, topTrim.h) || 1);
    const offsetUnit = hexR * Math.sqrt(3);
    const f = cfg.hullOffsetForward * offsetUnit;
    const r = cfg.hullOffsetRight * offsetUnit;
    const baseX = f * body.ux + r * body.uy;
    const baseY = f * body.uy + r * (-body.ux);

    this.addTileInspectCustomSprite(
      parent,
      hullFrame,
      topTrim.w * scale,
      topTrim.h * scale,
      baseX,
      baseY,
      angle,
    );

    const turretScale = scale * cfg.turretScale;
    const turretF = cfg.turretOffsetForward * offsetUnit;
    const turretR = cfg.turretOffsetRight * offsetUnit;
    const pivotLocalX = (pivot.bodyX - (topTrim.x + topTrim.w / 2)) * scale;
    const pivotLocalY = ((topTrim.y + topTrim.h / 2) - pivot.bodyY) * scale;
    const bodyAngle = Math.atan2(body.uy, body.ux) + Math.PI;
    const cos = Math.cos(bodyAngle);
    const sin = Math.sin(bodyAngle);
    const anchorX = (pivot.spriteX - turretTrim.x) / turretTrim.w;
    const anchorY = 1 - ((pivot.spriteY - turretTrim.y) / turretTrim.h);
    this.addTileInspectCustomSprite(
      parent,
      turretFrame,
      turretTrim.w * turretScale,
      turretTrim.h * turretScale,
      baseX + pivotLocalX * cos - pivotLocalY * sin,
      baseY + pivotLocalX * sin + pivotLocalY * cos,
      angle,
      anchorX + turretF / (turretTrim.w * turretScale),
      anchorY - turretR / (turretTrim.h * turretScale),
    );
    return true;
  }

  private paintTileInspectUnitPreview(parent: Node, u: Unit, hexR: number) {
    const g = parent.addComponent(Graphics);
    const oldG = this.g;
    this.g = g;
    g.strokeColor = new Color(220, 225, 210, 75);
    g.lineWidth = 2;
    this.drawHexOutline(0, 0, hexR);

    if (isFootUnit(u)) {
      if (u.kind === 'officer' && this.officerSpriteFrame) {
        this.addTileInspectSprite(parent, this.officerSpriteFrame, this.officerSpriteDim.dw, this.officerSpriteDim.dh, hexR * 1.06);
        this.g = oldG;
        return;
      }
      const allLoaded = this.infantrySpriteFrames.every((sf) => !!sf);
      if (!allLoaded) {
        const bodyR = hexR * 0.30;
        const headR = hexR * 0.16;
        g.fillColor = FACTION_COLORS[u.faction];
        g.strokeColor = UNIT_BORDER;
        g.lineWidth = 2;
        g.circle(0, -bodyR * 0.15, bodyR);
        g.fill(); g.stroke();
        g.circle(0, hexR * 0.28, headR);
        g.fill(); g.stroke();
        this.g = oldG;
        return;
      }
      const ringR = hexR * 0.50 * 0.546;
      const sin60 = Math.sqrt(3) / 2;
      const offsets = [
        { ox: 0, oy: ringR },
        { ox: ringR * sin60, oy: -ringR * 0.5 },
        { ox: -ringR * sin60, oy: -ringR * 0.5 },
      ];
      const spriteFit = hexR * 0.58;
      for (let i = 0; i < BattleScene.INFANTRY_SPRITES_PER_UNIT; i++) {
        const sf = this.infantrySpriteFrames[i];
        if (!sf) continue;
        const dim = this.infantrySpriteDims[i];
        const fit = i === 0 ? spriteFit : spriteFit * 1.15;
        this.addTileInspectSprite(parent, sf, dim.dw, dim.dh, fit, offsets[i].ox, offsets[i].oy);
      }
      this.g = oldG;
      return;
    }

    const destroyedMeta = u.destroyed ? this.destroyedTopMeta[u.kind as DestroyedTopKind] : null;
    if (destroyedMeta?.sf) {
      this.addTileInspectDestroyedTankSprite(parent, u, destroyedMeta.sf, destroyedMeta.dw, destroyedMeta.dh, hexR);
      this.g = oldG;
      return;
    }
    if (u.kind === 'sherman' && this.shermanTopSpriteFrame) {
      if (this.addTileInspectShermanSplit(parent, u, hexR)) {
        this.g = oldG;
        return;
      }
      this.addTileInspectTopDownTankSprite(parent, u, this.shermanTopSpriteFrame, this.shermanSpriteDisplayW, this.shermanSpriteDisplayH, hexR);
      this.g = oldG;
      return;
    }
    if (isEnemyTopKind(u.kind)) {
      if (isSplitTankKind(u.kind) && u.kind !== 'sherman') {
        const assets = this.splitTankSprites[u.kind];
        if (this.addTileInspectSplitTank(
          parent,
          u,
          hexR,
          assets?.hull ?? null,
          assets?.turret ?? null,
          splitTankVisualConfigOf(u.kind),
          splitTankGeometryConfigOf(u.kind).topTrim,
          splitTankGeometryConfigOf(u.kind).turretTrim,
          splitTankGeometryConfigOf(u.kind).pivot,
        )) {
          this.g = oldG;
          return;
        }
      }
      const meta = this.enemyTopMeta[u.kind];
      if (meta?.sf) {
        this.addTileInspectTopDownTankSprite(parent, u, meta.sf, meta.dw, meta.dh, hexR);
        this.g = oldG;
        return;
      }
    }

    g.fillColor = FACTION_COLORS[u.faction];
    g.strokeColor = UNIT_BORDER;
    g.lineWidth = 2;
    g.circle(0, 0, hexR * 0.5);
    g.fill();
    g.stroke();
    this.g = oldG;
  }

  private addTileInspectUnitPreview(parent: Node, u: Unit, centerX: number, topY: number, hexR: number) {
    const h = 92;
    const unitPreview = new Node('UnitPreview');
    unitPreview.layer = this.node.layer;
    unitPreview.addComponent(UITransform).setContentSize(116, h);
    unitPreview.setPosition(centerX, topY - h * 0.5, 0);
    parent.addChild(unitPreview);
    this.paintTileInspectUnitPreview(unitPreview, u, hexR);
  }

  private syncTileInspectVBar() {
    const v = this.tileInspectVBar;
    const sv = this.tileInspectScroll;
    if (!v || !v.g?.node?.isValid || !sv?.isValid) return;
    const content = sv.content;
    if (!content?.isValid) return;
    const ch = Math.max(1, content.getComponent(UITransform)!.contentSize.height);
    const { g, viewH, trackH } = v;
    g.clear();
    g.lineWidth = 0;
    const ty = -trackH * 0.5;
    // 底轨（在 vbar 节点内垂直居中）
    g.fillColor = new Color(64, 72, 86, 255);
    g.roundRect(-3, ty, 6, trackH, 2);
    g.fill();
    const maxO = Math.max(0, sv.getMaxScrollOffset().y);
    if (maxO < 0.5) {
      g.fillColor = new Color(160, 168, 180, 255);
      g.roundRect(-3, ty, 6, trackH, 2);
      g.fill();
      return;
    }
    const cur = Math.max(0, sv.getScrollOffset().y);
    const ratio = maxO < 0.5 ? 0 : Math.max(0, Math.min(1, cur / maxO));
    const th = Math.max(22, Math.min(trackH, (viewH / ch) * trackH));
    const tTop = ty + (1 - ratio) * (trackH - th);
    g.fillColor = new Color(190, 198, 210, 255);
    g.roundRect(-3, tTop, 6, th, 2);
    g.fill();
  }

  private openTileInspectModal(tile: Tile) {
    this.closeTileInspectModal();
    const panelW = 600;
    const panelH = 520;
    const barW = 10;
    const marginX = 12;
    const contentTopY = panelH / 2 - 64;
    const contentBottomY = -panelH / 2 + 24;
    const scrollH = contentTopY - contentBottomY;
    const rightAreaW = panelW - 2 * marginX - 8;
    const viewW = rightAreaW - barW;
    const innerW = viewW - 6;
    const root = new Node('TileInspectModal');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    root.setPosition(0, 0, 0);
    this.node.addChild(root);
    root.setSiblingIndex(this.node.children.length - 1);
    this.tileInspectModalRoot = root;

    const backdrop = new Node('Backdrop');
    backdrop.layer = this.node.layer;
    backdrop.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    const bd = backdrop.addComponent(Graphics);
    bd.fillColor = MODAL_BACKDROP;
    bd.rect(-CANVAS_W / 2, -CANVAS_H / 2, CANVAS_W, CANVAS_H);
    bd.fill();
    backdrop.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      this.closeTileInspectModal();
      e.propagationStopped = true;
    }, this);
    root.addChild(backdrop);

    const panel = new Node('Panel');
    panel.layer = this.node.layer;
    panel.addComponent(UITransform).setContentSize(panelW, panelH);
    const pgg = panel.addComponent(Graphics);
    pgg.fillColor = MODAL_PANEL_BG;
    pgg.strokeColor = MODAL_PANEL_BORDER;
    pgg.lineWidth = 2;
    pgg.rect(-panelW / 2, -panelH / 2, panelW, panelH);
    pgg.fill();
    pgg.stroke();
    pgg.strokeColor = BATTLE_MODAL_DIVIDER;
    pgg.lineWidth = 1;
    pgg.moveTo(-panelW / 2 + 24, panelH / 2 - 56);
    pgg.lineTo(panelW / 2 - 24, panelH / 2 - 56);
    pgg.stroke();
    panel.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; }, this);
    panel.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; }, this);
    root.addChild(panel);

    const titleLab = this.makeBattleModalLabel(panel, t('tileInspect.title'),
      0, panelH / 2 - 36, panelW - 100, 36, 26, STATUS_TITLE_COLOR);
    titleLab.enableOutline = true;
    titleLab.outlineColor = BATTLE_MODAL_TEXT_OUTLINE;
    titleLab.outlineWidth = 2;

    const closeBtnTop = this.makeBattleRectButton(
      panel, panelW / 2 - 28, panelH / 2 - 28, 36, 36,
      MODAL_CLOSE_BG, () => this.closeTileInspectModal(),
    );
    const closeLabTop = this.makeBattleModalLabel(closeBtnTop.node, '✕', 0, 0, 36, 36, 22, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(closeLabTop, () => this.closeTileInspectModal());

    // 右侧可滚动区 + 纵轴指示条
    const scrollN = new Node('TileInspectScroll');
    scrollN.layer = this.node.layer;
    scrollN.addComponent(UITransform).setContentSize(rightAreaW, scrollH);
    const rightBlockLeft = -panelW * 0.5 + marginX;
    const rightBlockRight = panelW * 0.5 - marginX;
    const scx = (rightBlockLeft + rightBlockRight) * 0.5;
    const scy = (contentTopY + contentBottomY) * 0.5;
    scrollN.setPosition(scx, scy, 0);
    panel.addChild(scrollN);
    const sv = scrollN.addComponent(ScrollView);
    sv.vertical = true;
    sv.horizontal = false;
    sv.inertia = true;
    sv.brake = 0.5;
    sv.bounceDuration = 0.18;
    sv.verticalScrollBar = null;
    sv.horizontalScrollBar = null;

    const viewN = new Node('view');
    viewN.layer = this.node.layer;
    viewN.addComponent(Mask);
    const vut = viewN.addComponent(UITransform);
    vut.setContentSize(viewW, scrollH);
    viewN.setPosition(-barW / 2, 0, 0);
    scrollN.addChild(viewN);
    const contentN = new Node('content');
    contentN.layer = this.node.layer;
    const cut = contentN.addComponent(UITransform);
    cut.setAnchorPoint(0.5, 1);
    cut.setContentSize(innerW, 200);
    const contentTopInset = 14;
    contentN.setPosition(0, scrollH * 0.5 - contentTopInset, 0);
    viewN.addChild(contentN);
    contentN.removeAllChildren();
    const { totalH: firstH } = this.fillTileInspectScrollContent(contentN, innerW, tile, 8);
    cut.setContentSize(innerW, Math.max(scrollH, firstH));

    this.scheduleOnce(() => {
      contentN.removeAllChildren();
      const { totalH: th1 } = this.fillTileInspectScrollContent(contentN, innerW, tile, 8);
      cut.setContentSize(innerW, Math.max(th1, scrollH));
      this.syncTileInspectVBar();
      if (this.tileInspectScroll) this.tileInspectScroll.scrollToTop(0);
    }, 0);

    // Cocos 3.8+：view 为只读 getter（= content.parent 的 UITransform），禁止赋值；只设 content 即可。
    sv.content = contentN;
    // 滚动条挂在 panel 上、对齐右侧内边距，避免作为 ScrollView 子节点时被引擎改位导致「飞到屏边」
    const vbarWpix = 6;
    // 视口右缘在 panel 空间：scrollN 中心 + view 左偏(-barW/2) + 半宽（勿用 rightBlockRight，否则会偏到面板外边线）
    const viewportRightPanel = scx - barW * 0.5 + viewW * 0.5;
    const vbarCenterX = viewportRightPanel + vbarWpix * 0.5;
    const vbarN = new Node('VBar');
    vbarN.layer = this.node.layer;
    vbarN.addComponent(UITransform).setContentSize(vbarWpix, scrollH);
    vbarN.setPosition(vbarCenterX, scy, 0);
    const vG = vbarN.addComponent(Graphics);
    panel.addChild(vbarN);
    this.tileInspectScroll = sv;
    sv.scrollToTop(0);
    this.tileInspectVBar = { g: vG, viewH: scrollH, trackH: Math.max(8, scrollH - 6) };
    this.onTileInspectBarFrame = () => { this.syncTileInspectVBar(); };
    this.schedule(this.onTileInspectBarFrame, 0);
    this.syncTileInspectVBar();
  }

  /** 全屏遮罩 + 居中面板 + 标题 + ✕（与 MainMenuScene.openModal 同构） */
  private openBattleModal(titleText: string, panelW: number, panelH: number): {
    panel: Node;
    contentY: number;
  } {
    this.setCombatLogExpanded(false);
    const root = new Node('BattleModal');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    root.setPosition(0, 0, 0);
    this.node.addChild(root);

    const backdrop = new Node('Backdrop');
    backdrop.layer = this.node.layer;
    backdrop.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    const bd = backdrop.addComponent(Graphics);
    bd.fillColor = MODAL_BACKDROP;
    bd.rect(-CANVAS_W / 2, -CANVAS_H / 2, CANVAS_W, CANVAS_H);
    bd.fill();
    backdrop.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      this.closeBattleModal();
      e.propagationStopped = true;
    }, this);
    root.addChild(backdrop);

    const panel = new Node('Panel');
    panel.layer = this.node.layer;
    panel.addComponent(UITransform).setContentSize(panelW, panelH);
    const pg = panel.addComponent(Graphics);
    drawFieldPanel(pg, panelW, panelH, MODAL_PANEL_BG, MODAL_PANEL_BORDER, BATTLE_MODAL_DIVIDER);
    pg.strokeColor = BATTLE_MODAL_DIVIDER;
    pg.lineWidth = 1;
    pg.moveTo(-panelW / 2 + 30, panelH / 2 - 64);
    pg.lineTo( panelW / 2 - 30, panelH / 2 - 64);
    pg.stroke();
    panel.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; }, this);
    panel.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; }, this);
    root.addChild(panel);

    const titleY = panelH / 2 - 36;
    const titleLab = this.makeBattleModalLabel(panel, titleText,
      0, titleY, panelW - 100, 36, 28, STATUS_TITLE_COLOR);
    titleLab.enableOutline = true;
    titleLab.outlineColor = BATTLE_MODAL_TEXT_OUTLINE;
    titleLab.outlineWidth = 2;

    const closeBtn = this.makeBattleRectButton(
      panel, panelW / 2 - 28, panelH / 2 - 28, 36, 36,
      MODAL_CLOSE_BG, () => this.closeBattleModal(),
    );
    const closeLab = this.makeBattleModalLabel(closeBtn.node, '✕', 0, 0, 36, 36, 22, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(closeLab, () => this.closeBattleModal());

    this.battleModalRoot = root;
    return { panel, contentY: panelH / 2 - 80 };
  }

  /** 查阅本关 `turn_end_events` 表：主骰点之和区间 → 效果类型（不参与掷骰） */
  private openTurnEndEventsReference() {
    this.closeTileInspectModal();
    this.closeBattleExitModal();
    this.closeBattleModal();
    const mid = this.missionId || this.mission?.data.id || '';
    const theater = this.mission?.data.theater;
    const rows = turnEndEventsForMission(mid);
    const panelW = 560;
    const panelH = 480;
    const { panel, contentY } = this.openBattleModal(t('battle.turnEndList.title'), panelW, panelH);

    const textBlockW = panelW - 56;
    const bodyN = new Node('TurnEndListBody');
    bodyN.layer = this.node.layer;
    panel.addChild(bodyN);
    const bodyUt = bodyN.addComponent(UITransform);
    bodyUt.setAnchorPoint(0.5, 1);
    bodyUt.setContentSize(textBlockW, 1);
    const bodyL = bodyN.addComponent(Label);
    bodyL.fontSize = 18;
    bodyL.lineHeight = 26;
    bodyL.color = new Color(220, 225, 230, 255);
    bodyL.overflow = Label.Overflow.RESIZE_HEIGHT;
    bodyL.horizontalAlign = HorizontalTextAlignment.LEFT;
    bodyL.verticalAlign = VerticalTextAlignment.TOP;
    if (rows.length === 0) {
      bodyL.string = t('battle.turnEndList.empty');
    } else {
      bodyL.string = rows
        .map((r) => {
          const range = r.sumMin === r.sumMax ? String(r.sumMin) : `${r.sumMin}–${r.sumMax}`;
          return t('battle.turnEndList.line', {
            range,
            n: r.diceCount,
            effect: t(turnEndListEffectKey(r.effectType, theater)),
          });
        })
        .join('\n');
    }
    bodyN.setPosition(0, contentY - 8);
  }

  private openBattleSettings() {
    this.closeTileInspectModal();
    this.closeBattleModal();
    this.closeBattleExitModal();
    const panelW = 480;
    const panelH = 520;
    const { panel, contentY } = this.openBattleModal(t('battle.settings.title'), panelW, panelH);
    const halfW = panelW / 2;

    const bgmRowY = contentY - 28;
    this.makeBattleModalLabel(panel, t('menu.settings.bgmVolume'),
      -halfW + 80, bgmRowY, 100, 28, 20, HUD_TEXT_COLOR);
    const state = MenuProgress.load();
    const bgmTrack = this.buildBattleVolumeSlider(panel, 40, bgmRowY, 220, state.bgmVolume, (vol) => {
      MenuProgress.setBgmVolume(vol);
      onMenuVolumesChanged();
      if (this.battleSettingsRefs?.bgmLabel) this.battleSettingsRefs.bgmLabel.string = `${vol}%`;
      this.syncProfileToServer();
    });
    const bgmLabel = this.makeBattleModalLabel(panel, `${state.bgmVolume}%`,
      200, bgmRowY, 60, 28, 20, HUD_TEXT_COLOR);

    const sfxRowY = contentY - 88;
    this.makeBattleModalLabel(panel, t('menu.settings.sfxVolume'),
      -halfW + 80, sfxRowY, 100, 28, 20, HUD_TEXT_COLOR);
    const sfxTrack = this.buildBattleVolumeSlider(panel, 40, sfxRowY, 220, state.sfxVolume, (vol) => {
      MenuProgress.setSfxVolume(vol);
      onMenuVolumesChanged();
      if (this.battleSettingsRefs?.sfxLabel) this.battleSettingsRefs.sfxLabel.string = `${vol}%`;
      this.syncProfileToServer();
    });
    const sfxLabel = this.makeBattleModalLabel(panel, `${state.sfxVolume}%`,
      200, sfxRowY, 60, 28, 20, HUD_TEXT_COLOR);

    const langRowY = contentY - 152;
    this.makeBattleModalLabel(panel, t('menu.settings.lang'),
      -halfW + 80, langRowY, 80, 28, 20, HUD_TEXT_COLOR);
    const curLang = getLang();
    const zhBtn = this.makeBattleRectButton(panel, 10, langRowY, 100, 40, LANG_BTN_IDLE,
      () => this.switchBattleLang('zh'));
    const zhLab = this.makeBattleModalLabel(zhBtn.node, t('menu.settings.langZh'), 0, 0, 100, 40, 18, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(zhLab, () => this.switchBattleLang('zh'));
    const enBtn = this.makeBattleRectButton(panel, 130, langRowY, 100, 40, LANG_BTN_IDLE,
      () => this.switchBattleLang('en'));
    const enLab = this.makeBattleModalLabel(enBtn.node, t('menu.settings.langEn'), 0, 0, 100, 40, 18, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(enLab, () => this.switchBattleLang('en'));

    this.battleSettingsRefs = {
      bgmFill: bgmTrack.fill,
      bgmThumb: bgmTrack.thumb,
      bgmLabel,
      sfxFill: sfxTrack.fill,
      sfxThumb: sfxTrack.thumb,
      sfxLabel,
      langZhBtn: zhBtn,
      langEnBtn: enBtn,
    };
    this.refreshLangBattleButtons(curLang);

    const saveRowY = contentY - 216;
    const saveB = this.makeBattleRectButton(panel, -110, saveRowY, 140, 44, new Color(60, 120, 80, 230),
      () => { this.onSave(); },
    );
    const saveLab = this.makeBattleModalLabel(saveB.node, t('btn.save'), 0, 0, 140, 44, 20, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(saveLab, () => { this.onSave(); });
    const loadB = this.makeBattleRectButton(panel, 110, saveRowY, 140, 44, new Color(80, 60, 130, 230),
      () => { this.onLoad_Save(); },
    );
    const loadLab = this.makeBattleModalLabel(loadB.node, t('btn.load'), 0, 0, 140, 44, 20, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(loadLab, () => { this.onLoad_Save(); });

    const exitRowY = contentY - 280;
    const exitB = this.makeBattleRectButton(panel, 0, exitRowY, 200, 44, BTN_EXIT_WARN,
      () => this.openBattleExitConfirm(),
    );
    const exitSetLab = this.makeBattleModalLabel(exitB.node, t('battle.settings.exit'), 0, 0, 200, 44, 20, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(exitSetLab, () => this.openBattleExitConfirm());
  }

  private openBattleExitConfirm() {
    this.closeBattleExitModal();
    this.setCombatLogExpanded(false);
    const root = new Node('BattleExitModal');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    root.setPosition(0, 0, 0);
    this.node.addChild(root);
    root.setSiblingIndex(this.node.children.length - 1);

    const backdrop = new Node('Backdrop');
    backdrop.layer = this.node.layer;
    backdrop.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    const bd = backdrop.addComponent(Graphics);
    bd.fillColor = MODAL_BACKDROP;
    bd.rect(-CANVAS_W / 2, -CANVAS_H / 2, CANVAS_W, CANVAS_H);
    bd.fill();
    backdrop.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      this.closeBattleExitModal();
      e.propagationStopped = true;
    }, this);
    root.addChild(backdrop);

    const panelW = 440;
    const panelH = 220;
    const panel = new Node('Panel');
    panel.layer = this.node.layer;
    panel.addComponent(UITransform).setContentSize(panelW, panelH);
    const pg = panel.addComponent(Graphics);
    pg.fillColor = MODAL_PANEL_BG;
    pg.strokeColor = MODAL_PANEL_BORDER;
    pg.lineWidth = 2;
    pg.rect(-panelW / 2, -panelH / 2, panelW, panelH);
    pg.fill();
    pg.stroke();
    panel.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; }, this);
    panel.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; }, this);
    root.addChild(panel);

    const titleLab = this.makeBattleModalLabel(panel, t('battle.exit.title'),
      0, panelH / 2 - 40, panelW - 40, 36, 24, STATUS_TITLE_COLOR);
    titleLab.enableOutline = true;
    titleLab.outlineColor = BATTLE_MODAL_TEXT_OUTLINE;
    titleLab.outlineWidth = 2;

    const closeBtn = this.makeBattleRectButton(
      panel, panelW / 2 - 26, panelH / 2 - 26, 32, 32,
      MODAL_CLOSE_BG, () => this.closeBattleExitModal(),
    );
    const exitCloseLab = this.makeBattleModalLabel(closeBtn.node, '✕', 0, 0, 32, 32, 18, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(exitCloseLab, () => this.closeBattleExitModal());

    const yBtn = -panelH / 2 + 56;
    const saveQuitB = this.makeBattleRectButton(panel, -105, yBtn, 190, 48, new Color(60, 120, 80, 230),
      () => this.saveAndExitLevel(),
    );
    const saveQuitLab = this.makeBattleModalLabel(saveQuitB.node, t('battle.exit.saveAndQuit'), 0, 0, 190, 48, 18, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(saveQuitLab, () => this.saveAndExitLevel());
    const abandonB = this.makeBattleRectButton(panel, 105, yBtn, 190, 48, BTN_EXIT_WARN,
      () => this.abandonExitLevel(),
    );
    const abandonLab = this.makeBattleModalLabel(abandonB.node, t('battle.exit.abandon'), 0, 0, 190, 48, 18, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(abandonLab, () => this.abandonExitLevel());

    this.battleExitModalRoot = root;
  }

  private saveAndExitLevel() {
    if (!this.onSave()) return;
    this.closeAllBattleModals();
    this.onBackToMenu();
  }

  private abandonExitLevel() {
    this.closeAllBattleModals();
    this.onBackToMenu();
  }

  private buildBattleVolumeSlider(
    panel: Node, centerX: number, centerY: number, width: number, initial: number,
    onChange: (vol: number) => void,
  ): { fill: Graphics; thumb: Node } {
    const trackH = 8;
    const root = new Node('VolumeSlider');
    root.layer = this.node.layer;
    const ut = root.addComponent(UITransform);
    ut.setContentSize(width, 36);
    root.setPosition(centerX, centerY, 0);
    panel.addChild(root);

    const trackNode = new Node('Track');
    trackNode.layer = this.node.layer;
    trackNode.addComponent(UITransform).setContentSize(width, trackH);
    const trackG = trackNode.addComponent(Graphics);
    trackG.fillColor = SLIDER_TRACK;
    trackG.rect(-width / 2, -trackH / 2, width, trackH);
    trackG.fill();
    root.addChild(trackNode);

    const fillNode = new Node('Fill');
    fillNode.layer = this.node.layer;
    fillNode.addComponent(UITransform).setContentSize(width, trackH);
    const fillG = fillNode.addComponent(Graphics);
    root.addChild(fillNode);

    const thumb = new Node('Thumb');
    thumb.layer = this.node.layer;
    thumb.addComponent(UITransform).setContentSize(20, 20);
    const thumbG = thumb.addComponent(Graphics);
    thumbG.fillColor = SLIDER_THUMB;
    thumbG.strokeColor = BATTLE_MODAL_TEXT_OUTLINE;
    thumbG.lineWidth = 2;
    thumbG.circle(0, 0, 9);
    thumbG.fill();
    thumbG.stroke();
    root.addChild(thumb);

    const refreshBar = (vol: number) => {
      const pct = Math.max(0, Math.min(100, vol)) / 100;
      fillG.clear();
      fillG.fillColor = SLIDER_FILL;
      fillG.rect(-width / 2, -trackH / 2, width * pct, trackH);
      fillG.fill();
      thumb.setPosition(-width / 2 + width * pct, 0, 0);
    };
    refreshBar(initial);

    const setVolFromTouch = (ev: EventTouch) => {
      const uiPos = ev.getUILocation();
      const local = ut.convertToNodeSpaceAR(new Vec3(uiPos.x, uiPos.y, 0));
      const pct = Math.max(0, Math.min(1, (local.x + width / 2) / width));
      const vol = Math.round(pct * 100);
      onChange(vol);
      refreshBar(vol);
      ev.propagationStopped = true;
    };
    root.on(Node.EventType.TOUCH_START, setVolFromTouch, this);
    root.on(Node.EventType.TOUCH_MOVE, setVolFromTouch, this);

    return { fill: fillG, thumb };
  }

  private makeBattleRectButton(
    parent: Node,
    x: number, y: number, w: number, h: number,
    color: Color,
    onClick: () => void,
  ): BattleRectButtonRefs {
    const n = new Node('RectBtn');
    n.layer = this.node.layer;
    n.addComponent(UITransform).setContentSize(w, h);
    n.setPosition(x, y, 0);
    const g = n.addComponent(Graphics);
    const redraw = (c: Color, opts?: { border?: boolean }) => {
      g.clear();
      drawFieldPanel(g, w, h, c, opts?.border ? BATTLE_MODAL_LEVEL_BORDER : BATTLE_MODAL_DIVIDER, STATUS_TITLE_COLOR);
    };
    redraw(color);
    n.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
      playUiClick();
      onClick();
      ev.propagationStopped = true;
    }, this);
    parent.addChild(n);
    return { node: n, graphics: g, label: null, redraw };
  }

  private makeBattleCircleButton(
    parent: Node, x: number, y: number, r: number,
    iconText: string, onClick: () => void,
  ): BattleRectButtonRefs {
    const n = new Node('CircleBtn');
    n.layer = this.node.layer;
    n.addComponent(UITransform).setContentSize(r * 2, r * 2);
    n.setPosition(x, y, 0);
    const g = n.addComponent(Graphics);
    const redraw = (c: Color) => {
      g.clear();
      g.fillColor = new Color(0, 0, 0, 70);
      g.circle(2, -3, r);
      g.fill();
      g.fillColor = c;
      g.strokeColor = SETTINGS_ICON_BD;
      g.lineWidth = 2;
      g.circle(0, 0, r);
      g.fill();
      g.stroke();
      g.strokeColor = new Color(230, 215, 160, 110);
      g.lineWidth = 1;
      g.circle(0, 0, r - 5);
      g.stroke();
    };
    redraw(SETTINGS_ICON_BG);
    this.makeBattleModalLabel(n, iconText, 0, 0, r * 2, r * 2, r + 2, HUD_TEXT_COLOR);
    n.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
      playUiClick();
      onClick();
      ev.propagationStopped = true;
    }, this);
    parent.addChild(n);
    return { node: n, graphics: g, label: null, redraw: (c: Color) => redraw(c) };
  }

  private makeBattleModalLabel(
    parent: Node, text: string,
    x: number, y: number, w: number, h: number,
    fontSize: number, color: Color,
  ): Label {
    const n = new Node('Label');
    n.layer = this.node.layer;
    n.addComponent(UITransform).setContentSize(w, h);
    n.setPosition(x, y, 0);
    const l = n.addComponent(Label);
    l.fontSize = fontSize;
    l.lineHeight = fontSize + 4;
    l.color = color;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.string = text;
    parent.addChild(n);
    return l;
  }

  private switchBattleLang(lang: LangCode) {
    if (getLang() === lang) return;
    setLang(lang);
    MenuProgress.setLang(lang);
    this.syncProfileToServer();
    this.closeDiePopover();
    // 与主菜单一致：切语言后关掉模态，避免面板上残留旧语言文案
    this.closeAllBattleModals();
    this.refreshBattleStaticI18n();
  }

  private refreshLangBattleButtons(cur: LangCode) {
    if (!this.battleSettingsRefs) return;
    const zh = this.battleSettingsRefs.langZhBtn;
    const en = this.battleSettingsRefs.langEnBtn;
    if (zh) zh.redraw(cur === 'zh' ? LANG_BTN_ACTIVE : LANG_BTN_IDLE, { border: cur === 'zh' });
    if (en) en.redraw(cur === 'en' ? LANG_BTN_ACTIVE : LANG_BTN_IDLE, { border: cur === 'en' });
  }

  /** 语言切换后刷新战斗 HUD 内所有固定文案（不重建节点） */
  private refreshBattleStaticI18n() {
    if (this.statusPanelTitleLabel) this.statusPanelTitleLabel.string = t('status.panelTitle');
    const bodyKeys = [
      'status.row.loaded',
      'status.row.turret',
      'status.row.mobility',
      'status.row.fireLevel',
    ] as const;
    for (let i = 0; i < this.statusBodyLeftLabels.length && i < bodyKeys.length; i++) {
      this.statusBodyLeftLabels[i].string = t(bodyKeys[i]);
    }
    if (this.statusCrewTitleLabel) this.statusCrewTitleLabel.string = t('status.row.crewTitle');
    for (let i = 0; i < this.statusCrewLeftLabels.length; i++) {
      const key = `status.crew.${i + 1}` as const;
      this.statusCrewLeftLabels[i].string = t(key);
    }
    if (this.chooseMoveLabel) this.chooseMoveLabel.string = this.fitTextForLabel(this.chooseMoveLabel, t('btn.movePhase'), 200);
    if (this.chooseAttackLabel) this.chooseAttackLabel.string = this.fitTextForLabel(this.chooseAttackLabel, t('btn.attackPhase'), 200);
    if (this.combatLogTitleLab) this.combatLogTitleLab.string = t('battleLog.title');
    this.refreshCombatLogText();
    if (this.restartBtnLabel) this.restartBtnLabel.string = t('btn.restart');
    if (this.backToMenuBtnLabel) this.backToMenuBtnLabel.string = t('btn.backToMenu');
    if (this.outcomeLabel && this.outcome !== 'ongoing') {
      if (this.outcome === 'victory') {
        this.outcomeLabel.string = t('outcome.win');
      } else {
        this.outcomeLabel.string = t('outcome.lose');
      }
    }
    this.updateHUD();
    this.refreshPhaseUI();
    this.refreshStatusPanel();
    this.redraw();
  }

  // ---------- 存档 / 读档 ----------

  /**
   * 存读档结果提示：屏幕正中央、挂在 `this.node` 最顶层，避免被设置/退出模态挡住。
   * 不依赖地图坐标；约 1.7s 后自毁。
   */
  private flashBattleSettingsHint(msg: string) {
    if (this.battleSettingsToastRoot?.isValid) {
      this.battleSettingsToastRoot.destroy();
      this.battleSettingsToastRoot = null;
    }
    const root = new Node('BattleSaveToast');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    root.setPosition(0, 0, 0);
    this.node.addChild(root);
    root.setSiblingIndex(Math.max(0, this.node.children.length - 1));

    const lab = this.makeBattleModalLabel(
      root, msg,
      0, 0, 560, 72, 30,
      new Color(255, 245, 210, 255),
    );
    lab.enableOutline = true;
    lab.outlineColor = new Color(0, 0, 0, 230);
    lab.outlineWidth = 3;
    lab.horizontalAlign = HorizontalTextAlignment.CENTER;
    lab.verticalAlign = VerticalTextAlignment.CENTER;

    this.battleSettingsToastRoot = root;
    const toastRef = root;
    this.scheduleOnce(() => {
      if (this.battleSettingsToastRoot === toastRef && toastRef.isValid) {
        toastRef.destroy();
        if (this.battleSettingsToastRoot === toastRef) this.battleSettingsToastRoot = null;
      }
    }, 1.7);
  }

  /**
   * 模态矩形按钮上的文字 Label 在部分环境下会先命中触摸，父节点收不到 TOUCH_END；
   * 在文字节点上镜像挂一次相同回调。
   */
  private mirrorBattleModalButtonLabel(label: Label, onClick: () => void) {
    label.node.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
      onClick();
      ev.propagationStopped = true;
    }, this);
  }

  /** @returns 是否已成功写入 localStorage */
  private onSave(): boolean {
    if (!this.mission) return false;
    if (this.isBusy()) {
      this.flashBattleSettingsHint(t('battle.save.busy'));
      return false;
    }
    if (this.outcome !== 'ongoing') {
      this.flashBattleSettingsHint(t('battle.save.notOngoing'));
      return false;
    }
    if (this.phase !== 'player') {
      this.flashBattleSettingsHint(t('battle.save.playerOnly'));
      return false;
    }
    const data = captureSave({
      missionId: this.missionId,
      mission: this.mission,
      turn: this.turn,
      phase: this.phase,
      // 旧存档结构里的 movesLeft/attacksLeft 在新玩法下用做布尔位保存"是否做过该阶段"：
      // 2 = 未做过（仍可执行），0 = 已做过。读档时按此复原。
      movesLeft: this.movementDone ? 0 : 2,
      attacksLeft: this.attackDone ? 0 : 1,
      miscDone: this.miscDone,
      playerStep: this.playerStep as SavePlayerStep,
      phaseDice: this.phaseDice.map(s => ({ pip: s.pip, used: s.used })),
    });
    try {
      writeActiveSaveRaw(JSON.stringify(data));
      this.battleLog(`[Save] 已存档：回合 ${data.turn}`);
      this.flashBattleSettingsHint(t('battle.save.ok'));
      return true;
    } catch (e) {
      console.error('[Save] 写入失败:', e);
      this.flashBattleSettingsHint(t('battle.save.fail'));
      return false;
    }
  }

  private syncProfileToServer() {
    syncServerProfile(MenuProgress.load());
  }

  /** @param skipHint 主菜单「继续游戏」自动读档时为 true，不飘「已读档」以免干扰开场 */
  private onLoad_Save(skipHint?: boolean) {
    if (!this.mission) return;
    if (this.isBusy()) {
      this.flashBattleSettingsHint(t('battle.load.busy'));
      return;
    }
    const raw = readActiveSaveRaw();
    if (!raw) {
      this.flashBattleSettingsHint(t('battle.load.none'));
      return;
    }
    let save: SaveData;
    try {
      save = JSON.parse(raw);
    } catch (e) {
      console.error('[Load] 存档损坏:', e);
      this.flashBattleSettingsHint(t('battle.load.badJson'));
      return;
    }
    const result = applySave(this.mission, this.missionId, save);
    if (!result.ok) {
      console.warn('[Load] 读档失败:', result.reason);
      this.flashBattleSettingsHint(t('battle.load.fail', { reason: result.reason ?? '' }));
      return;
    }
    // 写回场景状态；中断任何敌方阶段调度 / 骰子态 / 动画
    this.turn = result.turn!;
    this.phase = result.phase!;
    this.movementDone = (result.movesLeft ?? 2) === 0;
    this.attackDone   = (result.attacksLeft ?? 1) === 0;
    this.miscDone = result.miscDone ?? false;
    if (this.phase === 'player') {
      this.playerStep = (result.playerStep ?? 'choose') as PlayerStep;
      this.playerDiceRollAnim = null;
      this.playerDiceSortAnim = null;
      this.phaseDice = (result.phaseDice ?? []).map(s => ({ pip: s.pip, used: s.used }));
    } else {
      this.playerStep = 'choose';
      this.playerDiceRollAnim = null;
      this.playerDiceSortAnim = null;
      this.phaseDice = [];
    }
    this.clearGunSelection();
    this.enemyOrder = [];
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceUsed = [];
    this.destroyEnemyDiceTray();
    stopManeuverSound();
    this.anim = null;          // 若在动画中点读档，直接丢弃动画状态
    this.animQueue = [];
    this.pendingAfterAnimChain = null;
    this.finalizeDiceShow(true);
    this.destroyTurnEndEventUI();
    this.destroyFireCheckEventUI();
    this.destroyUsCasualtyEventUI();
    this.closeDiePopover();
    this.clearFloaters();
    this.clearMuzzleFlashes();
    this.clearDestroyWreckVisuals();
    // 胜负状态也要随读档重新判定
    this.outcome = checkOutcome(this.mission);
    this.updateOutcomeOverlay();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    if (!skipHint) this.flashBattleSettingsHint(t('battle.load.ok'));
    this.battleLog(`[Load] 已读档：回合 ${this.turn}, 移动 ${this.movementDone ? '已做' : '未做'}, 攻击 ${this.attackDone ? '已做' : '未做'}`);
  }

  /**
   * 开启 `enemyOrder[enemyIndex]` 这辆敌坦的回合：
   *   1. 跳过已摧毁 / 不存在 的条目
   *   2. 按起始格地形 & damaged 状态查 AI 列，掷骰子
   *   3. 在 UI 层建立迷你骰子托盘（展示本回合全部点数）
   *   4. 进入 runNextEnemyStep 开始逐颗消耗
   *
   * 若已轮完所有敌坦 → 结束敌方阶段。
   */
  private beginCurrentEnemyTurn() {
    if (!this.mission) return;
    // 跳过死亡 / 越界
    while (this.enemyIndex < this.enemyOrder.length) {
      const e = this.enemyOrder[this.enemyIndex];
      if (!e || e.destroyed) {
        this.enemyIndex++;
        continue;
      }
      break;
    }
    if (this.enemyIndex >= this.enemyOrder.length) {
      this.destroyEnemyDiceTray();
      if (this.aiSide === 'ally') {
        this.beginGermanAIPhase();
      } else {
        this.maybeBeginTurnEndEventOrEndEnemyPhase();
      }
      return;
    }

    const enemy = this.enemyOrder[this.enemyIndex];
    const tile = this.mission.map.get(enemy.pos);
    const terrain = effectiveDiceTerrain(tile);
    this.enemyAICol = aiColumnFor(enemy, terrain);
    const count = AI_DICE_COUNT[this.enemyAICol];
    this.enemyDice = rollAIDice(this.rng, count);
    this.enemyDiceUsed = this.enemyDice.map(() => false);
    this.enemyDiceExecOrder = this.computeEnemyDiceExecOrder();

    this.battleLog(
      `[AI] ${unitDisplayName(enemy.kind)}@(${enemy.pos.q},${enemy.pos.r}) 列=${aiColumnDisplayName(this.enemyAICol)} 掷 ${count} 骰 → [${this.enemyDice.join(',')}] 执行序=${this.enemyDiceExecOrder.map(i => this.enemyDice[i]).join(',')}`
    );

    this.buildEnemyDiceTray(enemy, { playSort: true });
    if (!this.enemyDiceSortAnim) this.runNextEnemyStep();
  }

  /**
   * 敌方阶段调度核心：找到当前敌坦下一颗未消耗的骰 → 执行对应 AI 行动。
   *
   * 单颗骰执行完毕的 3 种结果：
   *   - 同步完成（原地行为如 turn='stay' / smoke / repair / 被动跳过） → 消耗骰子，继续下一颗
   *   - 启动移动动画 → return，交给 update() 的动画结束分支再回调
   *   - 启动掷骰动画（shoot） → return，交给 DiceShow.onDone 回调
   *
   * 所有骰消耗完 → 切换到下一辆敌坦（beginCurrentEnemyTurn）。
   *
   * 用 while(true) + return 避免递归调用栈（所有骰都失败时会原地循环）。
   */
  private runNextEnemyStep() {
    if (!this.mission) return;
    // 胜负已决则完全停手
    if (this.outcome !== 'ongoing') return;

    const enemy = this.enemyOrder[this.enemyIndex];
    if (!enemy || enemy.destroyed) {
      this.enemyIndex++;
      this.beginCurrentEnemyTurn();
      return;
    }

    while (true) {
      // 按「点数升序（同点原序）」依次消耗骰子，而非数组下标顺序
      const dieIdx = this.enemyDiceExecOrder.find(i => !this.enemyDiceUsed[i]);
      if (dieIdx === undefined) {
        this.enemyDiceHighlightIdx = -1;
        this.refreshEnemyDiceTray();
        // 本敌坦全部骰子用完：切下一个
        this.enemyIndex++;
        this.beginCurrentEnemyTurn();
        return;
      }

      const pip = this.enemyDice[dieIdx];
      const entry = actionFor(DEFAULT_AI_TABLE, this.enemyAICol, pip);
      const chosen = this.chooseActionForEntry(enemy, entry);
      const entryLabel = describeEntry(entry);
      this.battleLog(
        `[AI] ${unitDisplayName(enemy.kind)} #${dieIdx + 1} d6=${pip} → ${entryLabel}` +
        (chosen ? ` ⇒ ${chosen}` : ' ⇒ 无可行动作（空转）')
      );

      this.enemyDiceHighlightIdx = dieIdx;
      // 消耗这颗骰子（无论是否真正执行成功，都算"本骰已用")
      this.refreshEnemyDiceTray();

      if (!chosen) {
        this.enemyNoActionHold = { t: 0, dur: 1.0, dieIdx };
        return;
      }

      // 执行选中的动作；返回表明本次是否"挂起"（有动画在播）
      this.enemyDiceUsed[dieIdx] = true;
      this.refreshEnemyDiceTray();
      const result = this.executeEnemyAction(enemy, chosen);
      if (this.outcome !== 'ongoing') return; // 可能谢尔曼被击毁
      if (result === 'animating') return;     // 等动画 / dice-show 回调再 runNextEnemyStep
      this.enemyDiceHighlightIdx = -1;
      this.refreshEnemyDiceTray();
      // 'done' → 原地完成，循环取下一颗骰
    }
  }

  /**
   * 从 A>B 条目里挑一个"当前能做"的动作。
   *   - 先试 primary；能做就用它
   *   - 否则试 fallback；能做就用它
   *   - 都做不了返回 null（空转骰子）
   */
  private chooseActionForEntry(enemy: Unit, entry: AIActionEntry): EnemyAction | null {
    if (!this.mission) return null;
    const { map } = this.mission;
    const target = this.currentAITarget(enemy);
    if (!target) return null;
    const occupied = this.buildOccupiedSet(enemy);

    // shoot 的真正可行性必须由 canAttack 决定，这里先做再说
    const tryOne = (a: EnemyAction): boolean => {
      if (a === 'shoot') {
        return !!this.selectAIShootTarget(enemy, false);
      }
      if (a === 'shoot_adjacent') {
        return !!this.selectAIShootTarget(enemy, false, true);
      }
      if (a === 'infantry_move') {
        return !!this.findJapaneseInfantryMove(enemy);
      }
      return canExecuteAction(enemy, a, target, map, occupied);
    };

    if (entry.primary !== 'none' && tryOne(entry.primary)) return entry.primary;
    if (entry.fallback && entry.fallback !== 'none' && tryOne(entry.fallback)) return entry.fallback;
    if (entry.fallback2 && entry.fallback2 !== 'none' && tryOne(entry.fallback2)) return entry.fallback2;
    return null;
  }

  /**
   * 真正执行一次 EnemyAction。返回 'done' = 同步完成，继续下一颗；
   * 返回 'animating' = 已启动动画（移动 / 掷骰 show），调用方必须 return。
   */
  private executeEnemyAction(enemy: Unit, action: EnemyAction): 'done' | 'animating' {
    if (!this.mission) return 'done';
    const { map } = this.mission;

    switch (action) {
      case 'none':
        return 'done';

      case 'shoot': {
        const started = this.tryEnemyAttack(enemy);
        return started ? 'animating' : 'done';
      }

      case 'shoot_adjacent': {
        const started = this.tryEnemyAttack(enemy, { adjacentOnly: true });
        return started ? 'animating' : 'done';
      }

      case 'turn': {
        const target = this.currentAITarget(enemy);
        if (!target) return 'done';
        if (enemy.facing === null) enemy.facing = 0;
        const occupied = this.buildOccupiedSet(enemy);
        const decision = decideEnemyTurn(enemy, target, map, occupied, this.rng);
        if (decision === 'stay') {
          this.battleLog(`[AI] ${unitDisplayName(enemy.kind)} 转向 → 保持 facing=${enemy.facing}`);
          this.redraw();
          return 'done';
        }
        const step = decision === 'cw' ? 1 : 5;
        const from = enemy.facing;
        const to = rotateDirection(from, step);
        // §3.5 隐蔽：坦克任何移动动作（转向 / 前进 / 后退）都会脱离隐蔽，与谢尔曼一致
        this.breakConcealment(enemy);
        this.battleLog(`[AI] ${unitDisplayName(enemy.kind)} 转向 ${decision.toUpperCase()} → facing=${to}（动画中）`);
        this.anim = {
          unit: enemy,
          kind: 'turn',
          fromQ: enemy.pos.q,
          fromR: enemy.pos.r,
          toQ: enemy.pos.q,
          toR: enemy.pos.r,
          t: 0,
          dur: Math.max(0.05, this.moveDuration),
          turnFrom: from,
          turnTo: to,
        };
        this.redraw();
        return 'animating';
      }

      case 'advance':
      case 'advance_to_building':
      case 'reverse': {
        if (enemy.facing === null) return 'done';
        const dir = action === 'advance' || action === 'advance_to_building'
          ? enemy.facing
          : rotateDirection(enemy.facing, 3);
        const to = neighbor(enemy.pos, dir);
        // §3.5 隐蔽：坦克前进 / 后退也会脱离隐蔽
        this.breakConcealment(enemy);
        // 发起移动动画；骰子托盘保留在 UI 上展示全套点数
        this.anim = {
          unit: enemy,
          kind: 'move',
          fromQ: enemy.pos.q,
          fromR: enemy.pos.r,
          toQ: to.q,
          toR: to.r,
          t: 0,
          dur: Math.max(0.05, this.moveDuration),
        };
        this.battleLog(`[AI] ${unitDisplayName(enemy.kind)} ${action === 'advance' ? '前进' : '后退'} → (${to.q},${to.r})`);
        this.redraw();
        return 'animating';
      }

      case 'infantry_move': {
        const to = this.findJapaneseInfantryMove(enemy);
        if (!to) return 'done';
        this.breakConcealment(enemy);
        this.anim = {
          unit: enemy,
          kind: 'move',
          fromQ: enemy.pos.q,
          fromR: enemy.pos.r,
          toQ: to.q,
          toR: to.r,
          t: 0,
          dur: Math.max(0.05, this.moveDuration),
        };
        this.battleLog(`[AI] ${unitDisplayName(enemy.kind)} 步兵移动 → (${to.q},${to.r})`);
        this.redraw();
        return 'animating';
      }

      case 'smoke': {
        if (tileForbidsSmokeOrConcealment(map.get(enemy.pos))) return 'done';
        enemy.smoked = true;
        this.battleLog(`[AI] ${unitDisplayName(enemy.kind)} 施放烟雾`);
        this.spawnFloater(enemy.pos.q, enemy.pos.r, t('floater.smoke'),
          new Color(200, 200, 220, 255), { size: 24 });
        this.redraw();
        return 'done';
      }

      case 'repair': {
        if (enemy.damaged) {
          enemy.damaged = false;
          this.battleLog(`[AI] ${unitDisplayName(enemy.kind)} 修复成功`);
          this.spawnFloater(enemy.pos.q, enemy.pos.r, t('floater.repair'),
            new Color(160, 220, 160, 255), { size: 24 });
          this.redraw();
        }
        return 'done';
      }

      case 'conceal': {
        if (tileForbidsSmokeOrConcealment(map.get(enemy.pos))) return 'done';
        enemy.hidden = true;
        this.battleLog(`[AI] ${unitDisplayName(enemy.kind)} 进入隐蔽`);
        this.spawnFloater(enemy.pos.q, enemy.pos.r, t('floater.concealed'),
          new Color(160, 200, 160, 255), { size: 24 });
        this.redraw();
        return 'done';
      }

      case 'hull_down': {
        if (tileForbidsSmokeOrConcealment(map.get(enemy.pos))) return 'done';
        enemy.hidden = true;
        this.battleLog(`[AI] ${unitDisplayName(enemy.kind)} Hull Down`);
        this.spawnFloater(enemy.pos.q, enemy.pos.r, 'Hull Down',
          new Color(160, 200, 160, 255), { size: 24 });
        this.redraw();
        return 'done';
      }
    }
  }

  private findJapaneseInfantryMove(enemy: Unit): Axial | null {
    if (!this.mission || enemy.kind !== 'japanese_infantry') return null;
    const target = this.currentAITarget(enemy);
    if (!target) return null;
    const currentDist = hexDistance(enemy.pos, target.pos);
    const occupied = this.buildOccupiedSet(enemy);
    let best: Axial | null = null;
    let bestPriority = Infinity;
    let bestDist = currentDist;
    const candidates: Axial[] = [];

    for (const n of neighbors(enemy.pos)) {
      const tile = this.mission.map.get(n);
      if (!tile) continue;
      if (tile.terrain === 'beach' || tile.terrain === 'deep_water') continue;
      if (occupied.has(`${n.q},${n.r}`)) continue;
      const d = hexDistance(n, target.pos);
      if (d >= currentDist) continue;
      const priority = this.japaneseInfantryMovePriority(tile);
      if (priority < bestPriority || (priority === bestPriority && d < bestDist)) {
        bestPriority = priority;
        bestDist = d;
        candidates.length = 0;
        candidates.push(n);
      } else if (priority === bestPriority && d === bestDist) {
        candidates.push(n);
      }
    }
    if (candidates.length === 0) return null;
    best = candidates.length === 1 ? candidates[0] : candidates[this.rng.intRange(0, candidates.length - 1)];
    return best ? { ...best } : null;
  }

  private japaneseInfantryMovePriority(tile: Tile): number {
    if (tile.terrain === 'rocky') return 0;
    if (tile.hasBuilding) return 1;
    if (tile.terrain === 'trees') return 2;
    return 3;
  }

  /** 构造"其他单位占格"集合，供 canExecuteAction / decideEnemyTurn 使用 */
  private buildOccupiedSet(self: Unit): Set<string> {
    const occ = new Set<string>();
    if (!this.mission) return occ;
    for (const u of this.allUnits()) {
      if (u === self || u.destroyed) continue;
      // 坦克/卡车可与己方徒步单位叠格，但不能驶入敌对徒步单位所在格。
      if (!isFootUnit(self) && isFootUnit(u) && u.faction === self.faction) continue;
      occ.add(`${u.pos.q},${u.pos.r}`);
    }
    return occ;
  }

  private endEnemyPhase() {
    this.turn += 1;
    this.clearDestroyWreckVisuals();
    // 清理敌方调度中间态
    this.enemyOrder = [];
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceUsed = [];
    this.destroyEnemyDiceTray();
    // 敌方阶段也可能击毁谢尔曼；重入玩家回合时复查胜负
    if (this.mission) {
      this.outcome = checkOutcome(this.mission);
      this.updateOutcomeOverlay();
    }
    this.beginPlayerPhaseForNewTurn();
  }

  // ---------- 交互 ----------

  /**
   * 地图点击：玩家回合下，优先处理「攻击/杂项 + 已选骰 + 点敌人」开火；
   * 其余情况打开格子介绍（地形、骰子规则、单位状态）。
   */
  private onTouchMap(event: EventTouch) {
    if (!this.mission || !this.mapNode) return;
    if (this.isBusy()) return;
    if (this.phase !== 'player') return;
    if (this.outcome !== 'ongoing') return;

    this.closeDiePopover();

    const target = this.pickTileAtScreenUi(event);
    if (!target) return;

    const enemiesOnTile = this.mission.enemies.filter(
      e => !e.destroyed && e.pos.q === target.pos.q && e.pos.r === target.pos.r,
    );
    const attackOrMisc = this.playerStep === 'attack' || this.playerStep === 'misc';
    const gunSel = this.selectedGunDieIdx >= 0;
    const mgSel = this.selectedMGDieIdx >= 0;

    if (attackOrMisc && enemiesOnTile.length > 0) {
      // 叠格场景：机枪挑 canMGAttack 认可的步兵目标；主炮只打坦克类（含 truck）。按选中的武器骰挑同格中合适的目标
      if (mgSel) {
        const units = this.allUnits();
        const inf = enemiesOnTile.find(e => canMGAttack({ attacker: this.mission!.sherman, target: e, map: this.mission!.map, theater: this.mission!.data.theater, units }).ok) ?? enemiesOnTile[0]!;
        this.tryMGAttack(inf);
        return;
      }
      if (gunSel) {
        const tank = enemiesOnTile.find(e => !isFootUnit(e)) ?? enemiesOnTile[0]!;
        this.tryAttack(tank);
        return;
      }
    }
    this.openTileInspectModal(target);
  }

  /**
   * 玩家开火：必须已选中主炮骰 + 已装填 + canAttack 通过。
   * 结算后消耗那颗骰子 + 清空 loaded（手册：一炮一装）。
   */
  private startShermanTurretAim(target: Unit, onDone: () => void) {
    if (!this.mission || !this.shermanTurretSpriteFrame || !this.shermanHullSpriteFrame) {
      onDone();
      return;
    }
    const sherman = this.mission.sherman;
    const to = (directionTo(sherman.pos, target.pos) ?? approximateDirection(sherman.pos, target.pos)) as Direction;
    const from = (this.shermanTurretFacing ?? sherman.facing ?? to) as Direction;
    if (from === to) {
      this.shermanTurretFacing = to;
      this.redraw();
      onDone();
      return;
    }
    this.turretAimAnim = {
      unit: sherman,
      from,
      to,
      t: 0,
      dur: 0.22,
      onDone,
    };
    this.redraw();
  }

  private startEnemyTurretAim(enemy: Unit, target: Unit, onDone: () => void) {
    const splitReady = this.enemySupportsSplitTurret(enemy);
    if (!splitReady) {
      onDone();
      return;
    }
    const to = (directionTo(enemy.pos, target.pos) ?? approximateDirection(enemy.pos, target.pos)) as Direction;
    const from = (this.enemyTurretFacing.get(enemy.id) ?? enemy.facing ?? to) as Direction;
    if (from === to) {
      this.enemyTurretFacing.set(enemy.id, to);
      this.redraw();
      onDone();
      return;
    }
    this.turretAimAnim = {
      unit: enemy,
      from,
      to,
      t: 0,
      dur: 0.22,
      onDone,
    };
    this.redraw();
  }

  private tryAttack(target: Unit) {
    if (!this.mission) return;
    if (this.playerStep !== 'attack' && this.playerStep !== 'misc') return;
    if (this.selectedGunDieIdx < 0) return;
    const { map, sherman } = this.mission;
    const slot = this.phaseDice[this.selectedGunDieIdx];
    if (!slot || slot.used) return;
    // 主炮禁瞄徒步类（步兵 / 军官）：引导玩家改用机枪骰；不消耗骰，避免误操作损失行动资源
    if (isFootUnit(target)) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('attack.reason.gunVsInfantry'),
        new Color(255, 200, 120, 255), { size: 22, dur: 1.0, rise: 26 });
      return;
    }
    if (!sherman.loaded) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('hud.unloaded'),
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      return;
    }
    const check = canAttack({ attacker: sherman, target, map });
    if (!check.ok) {
      this.battleLogI18n('battleLog.combat.cannotAttack', {
        reasonKey: check.reason ?? 'attack.reason.unknown',
      });
      // 玩家点到一个"其实打不到"的敌人（比如偏出六向直线 / 被树遮挡），给一条
      // 从射击者向上飘的浮字，免得玩家以为点击没响应。
      // 非六向直线有专门的简短提示，其他原因用对应文案；缺失时兜底到"无法攻击"。
      const msg = check.reason === 'attack.reason.notStraight'
        ? t('attack.reason.notStraightHint')
        : t(check.reason ?? 'attack.reason.unknown');
      const warnColor = new Color(255, 120, 120, 255);
      this.spawnFloater(sherman.pos.q, sherman.pos.r, msg, warnColor, { size: 22, dur: 0.9, rise: 24 });
      return;
    }

    // 先掷骰拿到确定结果，再让面板按这个结果播 2d6→1d6 两段动画；
    // 真正 applyAttack / 消耗骰子 / 推进胜负判定全部放到 onDone 里执行，
    // 这样动画过程中玩家看到的状态（骰子托盘 / 敌人图示）不会提前变。
    const report = rollAttack({ attacker: sherman, target, map, protagonist: sherman }, this.rng);
    // 骰子先标"用掉了"不行 —— 动画期间得看出主炮骰仍在选中态。
    // 直接把它本局引用在外层闭包，onDone 里再 used = true。
    // §3.6 B 列对子（炮手主炮射击）：开火前记住 partner idx，onDone 时一并消耗。
    const doublesPartnerIdx = this.selectedGunDoublesIdx;
    this.startShermanTurretAim(target, () => {
      this.startDiceShow(report, t('actor.player'), unitDisplayName(target.kind), () => {
        if (!this.mission) return;
        applyAttack(target, report);
        if (target.destroyed) this.registerDestroyWreckVisual(target);
        slot.used = true;
        if (doublesPartnerIdx >= 0) {
          const p = this.phaseDice[doublesPartnerIdx];
          if (p) p.used = true;
        }
        sherman.loaded = false;
        this.clearGunSelection();
        this.presentAttackResult(t('actor.player'), report, sherman, target);
        this.refreshPhaseUI();
        this.updateHUD();
        this.autoEndPhaseIfDone();
      }, { attackSound: sherman.stats.attackSound, attacker: sherman, target });
    });
    // 立即刷新一次 HUD，让"点敌人开火"提示消失
    this.updateHUD();
    this.redraw();
  }

  /**
   * AI 坦克执行主炮射击时，会在所有视野内合法敌方坦克中选择最近目标。
   *
   * 返回值：
   *   true  → 本敌人已启动掷骰动画，runNextEnemyStep 应"暂停"，由 onDone 回调恢复调度
   *   false → 本次未开火（目标已毁 / 无视线 / 胜负已决等），调用方可立即推进下一个敌人
   */
  private tryEnemyAttack(enemy: Unit, opts: { adjacentOnly?: boolean } = {}): boolean {
    if (!this.mission) return false;
    if (enemy.destroyed) return false;
    if (this.outcome !== 'ongoing') return false; // 谢尔曼已死，无需再补刀
    const { map } = this.mission;
    const target = this.selectAIShootTarget(enemy, true, !!opts.adjacentOnly);
    if (!target) return false;

    const splitTurretReady = this.enemySupportsSplitTurret(enemy);
    if (splitTurretReady) {
      if (!this.enemyTurretFacing.has(enemy.id) && enemy.facing !== null) {
        this.enemyTurretFacing.set(enemy.id, enemy.facing);
      }
    }

    // 保留本车 AI 行动骰托盘；掷骰面板打开时会挂到 DiceShow 遮罩之上（见 liftEnemyDiceTrayIntoDiceShowIfNeeded）

    const report = rollAttack({ attacker: enemy, target, map, protagonist: this.mission.sherman }, this.rng);
    const enemyActor = enemy.faction !== 'allied'
      ? t('actor.enemyPrefix', { name: unitDisplayName(enemy.kind) })
      : t('actor.allyPrefix', { name: unitDisplayName(enemy.kind) });
    const targetLabel = target === this.mission.sherman
      ? t('actor.sherman')
      : target.faction !== 'allied'
        ? t('actor.enemyPrefix', { name: unitDisplayName(target.kind) })
        : t('actor.allyPrefix', { name: unitDisplayName(target.kind) });
    const showDice = () => this.startDiceShow(report, enemyActor, targetLabel, () => {
      if (!this.mission) return;
      applyAttack(target, report);
      if (target.destroyed) this.registerDestroyWreckVisual(target);
      this.presentAttackResult(enemyActor, report, enemy, target);
      // 本骰打完：回到当前敌坦的下一颗骰（DiceShow 里已经消耗掉的那颗之外）
      if (this.outcome === 'ongoing' && this.phase === 'enemy') {
        // 重新浮出托盘（可能还剩骰子），再继续调度
        if (this.enemyDiceUsed.some(u => !u)) {
          const current = this.enemyOrder[this.enemyIndex];
          if (current && !current.destroyed) this.buildEnemyDiceTray(current, { playSort: false });
        }
        this.runNextEnemyStep();
      }
    }, { attackSound: enemy.stats.attackSound, attacker: enemy, target });
    if (splitTurretReady) {
      this.startEnemyTurretAim(enemy, target, showDice);
    } else {
      showDice();
    }
    return true;
  }

  // ---------- 攻击掷骰动画面板 ----------

  /**
   * 启动攻击掷骰动画。调用方应已经 rollAttack 完拿到 report（保证结果不会在动画中变化），
   * 但 *不要* 自己 applyAttack —— 让本面板在动画末尾回调 onDone，调用方在 onDone
   * 里真正写入伤害 / 弹浮字 / 推进调度。
   *
   * 期间所有玩家与敌方新指令被屏蔽（见 isBusy()）；关闭骰子弹窗。
   * 敌方主炮开火时：敌方 AI 骰子托盘挂到 DiceShow 内、遮罩之上，与命中/穿甲结果同屏可见。
   */
  private startDiceShow(
    report: AttackReport,
    attackerLabel: string,
    targetLabel: string,
    onDone: () => void,
    opts: { mg?: boolean; keepTurnEndPanel?: boolean; attackSound?: string; attacker?: Unit | null; target?: Unit | null } = {},
  ) {
    // 已有一个面板在播（理论上不该走到这里，守一下）：先强结束旧的，避免叠加
    if (this.diceShow) this.finalizeDiceShow(/*skip=*/true);
    if (!opts.keepTurnEndPanel) this.destroyTurnEndEventUI();
    this.destroyFireCheckEventUI();
    this.closeDiePopover();

    const mg = !!opts.mg;
    const panel = this.buildDiceShowPanel(report, attackerLabel, targetLabel, mg);
    this.liftEnemyDiceTrayIntoDiceShowIfNeeded(panel.root);
    this.diceShow = {
      stage: 'hit-roll',
      t: 0,
      report,
      attackerLabel,
      targetLabel,
      mg,
      attackSound: opts.attackSound ?? '',
      attacker: opts.attacker ?? null,
      target: opts.target ?? null,
      onDone,
      finalized: false,
      panelRoot: panel.root,
      hitDieLabels: panel.hitDieLabels,
      hitSumLabel: panel.hitSumLabel,
      hitNeedLabel: panel.hitNeedLabel,
      hitVerdictLabel: panel.hitVerdictLabel,
      hitSpecialLabel: panel.hitSpecialLabel,
      penDieLabels: panel.penDieLabels,
      penNeedLabel: panel.penNeedLabel,
      penVerdictLabel: panel.penVerdictLabel,
      dmgDieLabel: panel.dmgDieLabel,
      dmgTitleLabel: panel.dmgTitleLabel,
      dmgEffectLabel: panel.dmgEffectLabel,
      crewDieLabel: panel.crewDieLabel,
      crewTitleLabel: panel.crewTitleLabel,
      crewEffectLabel: panel.crewEffectLabel,
      outcomeLabel: panel.outcomeLabel,
      confirmButton: panel.confirmButton,
    };
    playDiceRoll();
  }

  /**
   * 构造居中弹出的掷骰面板，返回需要在动画中被 update 的 Label 引用。
   *
   * 布局（Canvas 1280×720 下约占 560×440，居中）：
   *   ┌─────────────────────────────────────┐
   *   │  玩家 → panzer4                      │   标题
   *   │  命中需 ≥7                           │
   *   │   ┌──┐ ┌──┐                          │
   *   │   │ 5│        = 5     命中！          │   1d6 + 判定
   *   │   └──┘ └──┘                          │
   *   │   ┌──┐                                │
   *   │   │ 4│        需 ≥2     击穿！        │   2d6 穿甲（仅命中时出现）
   *   │   └──┘                                │
   *   │   ┌──┐                                │
   *   │   │ 3│        伤害检定    起火         │   1d6 伤害（仅击穿时出现）
   *   │   └──┘                                │
   *   │                起火                   │   底部大字结果
   *   └─────────────────────────────────────┘
   *
   * 伤害骰行在 'dmg-roll' 阶段才被置 active=true；未命中 / 跳弹时整行保持隐藏，
   * 让画面只显示"推进到哪一段"的信息，避免空白"?"误导玩家。
   */
  private buildDiceShowPanel(
    report: AttackReport,
    attackerLabel: string,
    targetLabel: string,
    mg: boolean = false,
  ): {
    root: Node;
    hitDieLabels: Label[];
    hitSumLabel: Label;
    hitNeedLabel: Label;
    hitVerdictLabel: Label;
    hitSpecialLabel: Label | null;
    penDieLabels: Label[];
    penNeedLabel: Label | null;
    penVerdictLabel: Label | null;
    dmgDieLabel: Label | null;
    dmgTitleLabel: Label | null;
    dmgEffectLabel: Label | null;
    crewDieLabel: Label | null;
    crewTitleLabel: Label | null;
    crewEffectLabel: Label | null;
    outcomeLabel: Label;
    confirmButton: Node | null;
  } {
    // 按"一次性预掷所有可能骰子"建行；日军击穿即毁不建伤害行。
    const needsDamageRow = !mg && report.stagedDamageDie !== undefined;
    const needsCrewRow = needsDamageRow && !!report.stagedCrewCheck;
    const hasHitDoublesCommanderKill = !mg && report.hit && !!report.commanderKilledByHitDoubles;
    const PANEL_W = 560;
    // 机枪模式：只有标题 + 命中阈值 + 1d6 + 结果大字，用更矮的面板
    const PANEL_H = mg ? 280 : needsCrewRow ? 560 : hasHitDoublesCommanderKill ? 520 : 440;

    // 半透明全屏遮罩 + 面板：都是 Graphics，不需要 Sprite 资源
    const root = new Node('DiceShow');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(1280, 720);
    root.setPosition(0, 0, 0);
    this.node.addChild(root);

    // 背景遮罩（占满 Canvas）
    const backdrop = new Node('Backdrop');
    backdrop.layer = this.node.layer;
    backdrop.addComponent(UITransform).setContentSize(1280, 720);
    const bd = backdrop.addComponent(Graphics);
    bd.fillColor = DICE_BACKDROP;
    bd.rect(-640, -360, 1280, 720);
    bd.fill();
    // 消耗点击事件，让遮罩背后的地图 / 骰子托盘都不会被触发
    backdrop.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; }, this);
    root.addChild(backdrop);

    // 面板本体
    const panel = new Node('Panel');
    panel.layer = this.node.layer;
    panel.addComponent(UITransform).setContentSize(PANEL_W, PANEL_H);
    const pg = panel.addComponent(Graphics);
    drawDicePopupPanel(pg, PANEL_W, PANEL_H, DICE_PANEL_BG, DICE_PANEL_BORDER);
    root.addChild(panel);

    // 标题
    const title = this.makeCenteredLabel(panel, `${attackerLabel} → ${targetLabel}`,
      0, PANEL_H / 2 - 34, PANEL_W - 40, 34, 26, HUD_TEXT_COLOR);

    // 命中需求：机枪用单独文案（"机枪扫射 命中需 ≥N"），主炮走原来的命中阈值行
    const hitNeedText = mg
      ? t('dice.panel.mgHitNeed', { n: report.threshold })
      : t('dice.panel.hitNeed', { n: report.threshold });
    const hitNeed = this.makeCenteredLabel(panel, hitNeedText,
      0, PANEL_H / 2 - 72, PANEL_W - 40, 28, 20, DICE_INFO_TEXT);

    // 三/四行使用固定列：骰子列 / 数值或需求列 / 结果列，避免各行文字左右漂移。
    const DIE_SIZE = 68, DIE_GAP = 24, ROW_GAP = 82;
    const hitDiceY = PANEL_H / 2 - 148;
    const penDiceY = hitDiceY - ROW_GAP;
    const dmgDiceY = penDiceY - ROW_GAP;
    const crewDiceY = dmgDiceY - ROW_GAP;
    const DIE_COL_1 = -126;
    const DIE_COL_2 = DIE_COL_1 + DIE_SIZE + DIE_GAP;
    const MID_COL_X = 52;
    const RESULT_COL_X = 178;
    const MID_COL_W = 120;
    const RESULT_COL_W = 190;

    const hitDiceCount = Math.max(1, Math.min(2, report.hitDiceCount ?? 2));

    // 命中骰：主炮 2d6；机枪 1d6（正面 -1 已计入命中所需）。
    const d1 = this.makeDieSquare(panel, DIE_COL_1, hitDiceY, DIE_SIZE);
    const d2 = this.makeDieSquare(panel, DIE_COL_2, hitDiceY, DIE_SIZE);
    if (hitDiceCount === 1) {
      d1.node.parent!.setPosition(DIE_COL_1 + (DIE_SIZE + DIE_GAP) / 2, hitDiceY, 0);
      d2.node.parent!.active = false;
    }

    // "= N"
    const hitSum = this.makeCenteredLabel(panel, '= ?',
      MID_COL_X, hitDiceY, MID_COL_W, 40, 30, DICE_INFO_TEXT);

    // 命中判定文字
    const hitVerdict = this.makeCenteredLabel(panel, '',
      RESULT_COL_X, hitDiceY, RESULT_COL_W, 40, 28, DICE_OK_TEXT);
    const hitSpecial = hasHitDoublesCommanderKill
      ? this.makeCenteredLabel(panel, '',
        0, -PANEL_H / 2 + 132, PANEL_W - 52, 30, 24, new Color(255, 90, 90, 255))
      : null;
    if (hitSpecial) hitSpecial.node.active = false;

    // 2d6 穿甲 / 伤害 / 阵亡检定三行只在主炮模式需要；机枪扫射只有命中这一段。
    const penDice: Label[] = [];
    let penNeed: Label | null = null;
    let penVerdict: Label | null = null;
    let dmgDie: Label | null = null;
    let dmgTitle: Label | null = null;
    let dmgEffect: Label | null = null;
    let crewDie: Label | null = null;
    let crewTitle: Label | null = null;
    let crewEffect: Label | null = null;
    if (!mg) {
      // 2d6 穿甲骰 + 需求 + 判定
      const penDiceCount = Math.max(1, report.penDice?.length ?? 1);
      const penStartX = penDiceCount >= 2 ? DIE_COL_1 : DIE_COL_1 + (DIE_SIZE + DIE_GAP) / 2;
      for (let i = 0; i < penDiceCount; i++) {
        penDice.push(this.makeDieSquare(panel, penStartX + i * (DIE_SIZE + DIE_GAP), penDiceY, DIE_SIZE));
      }
      penNeed = this.makeCenteredLabel(panel, '',
        MID_COL_X, penDiceY, MID_COL_W, 28, 18, DICE_INFO_TEXT);
      penVerdict = this.makeCenteredLabel(panel, '',
        RESULT_COL_X, penDiceY, RESULT_COL_W, 40, 28, DICE_OK_TEXT);

      // 1d6 伤害骰 + "伤害检定" + 效果文字
      if (needsDamageRow) {
        dmgDie = this.makeDieSquare(panel, DIE_COL_1, dmgDiceY, DIE_SIZE);
        dmgTitle = this.makeCenteredLabel(panel, t('dice.panel.dmgTitle'),
          MID_COL_X, dmgDiceY, MID_COL_W, 28, 18, DICE_INFO_TEXT);
        dmgEffect = this.makeCenteredLabel(panel, '',
          RESULT_COL_X, dmgDiceY, RESULT_COL_W, 40, 28, DICE_OUTCOME_HIT);
      }

      // 可选：1d6 阵亡检定骰（仅谢尔曼被击穿 + 伤害表 d6=2 时才会出现）
      if (needsCrewRow) {
        crewDie = this.makeDieSquare(panel, DIE_COL_1, crewDiceY, DIE_SIZE);
        crewTitle = this.makeCenteredLabel(panel, t('dice.panel.crewTitle'),
          MID_COL_X, crewDiceY, MID_COL_W, 28, 18, DICE_INFO_TEXT);
        crewEffect = this.makeCenteredLabel(panel, '',
          RESULT_COL_X, crewDiceY, RESULT_COL_W, 40, 28, DICE_OUTCOME_CREW);
      }

      // 主炮三段检定同屏滚动；未命中 / 未击穿时，伤害行在揭示时显示"无效"。
    }

    // 底部大字结果
    const outcome = this.makeCenteredLabel(panel, '',
      0, -PANEL_H / 2 + 86, PANEL_W - 40, 48, 36, DICE_OUTCOME_MISS);
    outcome.node.active = false;
    const confirmButton = this.makeDiceShowConfirmButton(panel, 0, -PANEL_H / 2 + 52);
    confirmButton.active = false;

    // title / hitNeed 仅作标题用，外部不再更新它们，但避免 TS 报"未使用"，
    // 保留到返回结构里（外部不用就不用，Label 生命周期跟随 root.destroy 自动回收）
    void title;

    return {
      root,
      hitDieLabels: hitDiceCount === 1 ? [d1] : [d1, d2],
      hitSumLabel: hitSum,
      hitNeedLabel: hitNeed,
      hitVerdictLabel: hitVerdict,
      hitSpecialLabel: hitSpecial,
      penDieLabels: penDice,
      penNeedLabel: penNeed,
      penVerdictLabel: penVerdict,
      dmgDieLabel: dmgDie,
      dmgTitleLabel: dmgTitle,
      dmgEffectLabel: dmgEffect,
      crewDieLabel: crewDie,
      crewTitleLabel: crewTitle,
      crewEffectLabel: crewEffect,
      outcomeLabel: outcome,
      confirmButton,
    };
  }

  /** 在 panel 下挂一个带白底黑边的骰子方块 + 内部点数 Label，返回 Label 便于后续 setString。 */
  private makeDiceShowConfirmButton(parent: Node, x: number, y: number): Node {
    const W = 200, H = 44;
    const btn = this.makeBattleRectButton(
      parent,
      x,
      y,
      W,
      H,
      BATTLE_BTN_ACCENT,
      () => this.finalizeDiceShow(false),
    );
    const lab = this.makeBattleModalLabel(
      btn.node,
      t('turnEnd.confirm'),
      0,
      0,
      W,
      H,
      22,
      Color.WHITE,
    );
    this.mirrorBattleModalButtonLabel(lab, () => this.finalizeDiceShow(false));
    return btn.node;
  }

  private makeDieSquare(parent: Node, x: number, y: number, size: number): Label {
    const container = new Node('Die');
    container.layer = this.node.layer;
    container.addComponent(UITransform).setContentSize(size, size);
    container.setPosition(x, y, 0);
    const bg = container.addComponent(Graphics);
    this.drawDieBody(bg, size, size, {
      fill: DICE_DIE_FILL,
      border: DICE_DIE_BORDER,
      lineWidth: 2,
      shadow: true,
    });
    parent.addChild(container);

    const labelNode = new Node('Face');
    labelNode.layer = this.node.layer;
    labelNode.addComponent(UITransform).setContentSize(size, size);
    const l = labelNode.addComponent(Label);
    l.fontSize = Math.floor(size * 0.6);
    l.lineHeight = l.fontSize + 4;
    l.color = DICE_DIE_TEXT;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.string = '?';
    container.addChild(labelNode);

    const pipsNode = new Node('Pips');
    pipsNode.layer = this.node.layer;
    pipsNode.addComponent(UITransform).setContentSize(size, size);
    const pips = pipsNode.addComponent(Graphics);
    container.addChild(pipsNode);

    return l;
  }

  private setDieLabelFace(label: Label | null | undefined, value: number | string) {
    if (!label) return;
    const text = String(value);
    const n = Number(text);
    const container = label.node.parent;
    const body = container?.getComponent(Graphics);
    const bodyUt = container?.getComponent(UITransform);
    const size = bodyUt ? Math.min(bodyUt.contentSize.width, bodyUt.contentSize.height) : 48;
    if (body) {
      body.clear();
      this.drawDieBody(body, size, size, {
        fill: DICE_DIE_FILL,
        border: DICE_DIE_BORDER,
        lineWidth: 2,
        shadow: true,
      });
    }
    const pips = label.node.parent
      ?.getChildByName('Pips')
      ?.getComponent(Graphics);
    if (pips && Number.isInteger(n) && n >= 1 && n <= 6) {
      pips.clear();
      if (body) this.drawDiePips(body, n, size, DICE_DIE_TEXT);
      else this.drawDiePips(pips, n, size, DICE_DIE_TEXT);
      label.string = '';
      return;
    }
    if (pips) pips.clear();
    label.string = text;
  }

  private spinMainGunDiceRows(show: DiceShow, frame: number) {
    for (let i = 0; i < show.penDieLabels.length; i++) {
      this.setDieLabelFace(show.penDieLabels[i], ((frame * (13 + i * 4)) % 6) + 1);
    }
    this.setDieLabelFace(show.dmgDieLabel, ((frame * 11) % 6) + 1);
    this.setDieLabelFace(show.crewDieLabel, ((frame * 29) % 6) + 1);
    if (show.penNeedLabel && show.penNeedLabel.string === '') show.penNeedLabel.string = '= ?';
    if (show.penVerdictLabel) show.penVerdictLabel.string = '';
    if (show.dmgEffectLabel) show.dmgEffectLabel.string = '';
    if (show.crewEffectLabel) show.crewEffectLabel.string = '';
  }

  private revealMainGunDiceRows(show: DiceShow) {
    if (show.report.hit) {
      if (show.report.penDice?.length) {
        show.penDieLabels.forEach((label, i) => this.setDieLabelFace(label, show.report.penDice![i] ?? '?'));
      } else if (show.report.penDie !== undefined) {
        show.penDieLabels.forEach(label => this.setDieLabelFace(label, show.report.penDie ?? '?'));
      }
      if (show.penNeedLabel && show.report.penThreshold !== undefined) {
        const thr = show.report.penThreshold;
        show.penNeedLabel.string = thr <= 0
          ? t('dice.panel.penMustPen')
          : t('dice.panel.penNeed', { n: thr });
      }
      if (show.penVerdictLabel) {
        if (show.report.penetrated) {
          show.penVerdictLabel.string = show.report.stagedDamageDie === undefined && show.report.damageEffect === 'destroyed'
            ? t('dmg.outcome.destroyed')
            : t('dice.panel.penYes');
          show.penVerdictLabel.color = DICE_OK_TEXT;
        } else {
          show.penVerdictLabel.string = t('dice.panel.penNo');
          show.penVerdictLabel.color = DICE_FAIL_TEXT;
        }
      }
    } else {
      if (show.penNeedLabel) {
        show.penNeedLabel.string = t('dice.panel.invalid');
        show.penNeedLabel.color = DICE_FAIL_TEXT;
      }
      if (show.penVerdictLabel) {
        show.penVerdictLabel.string = t('dice.panel.invalid');
        show.penVerdictLabel.color = DICE_FAIL_TEXT;
      }
    }

    if (show.report.stagedDamageDie !== undefined) {
      this.setDieLabelFace(show.dmgDieLabel, show.report.stagedDamageDie);
    }
    if (!show.report.hit || !show.report.penetrated) {
      if (show.dmgEffectLabel) {
        show.dmgEffectLabel.string = t('dice.panel.invalid');
        show.dmgEffectLabel.color = DICE_FAIL_TEXT;
      }
      if (show.report.stagedCrewCheck) {
        this.setDieLabelFace(show.crewDieLabel, show.report.stagedCrewCheck.die > 0 ? show.report.stagedCrewCheck.die : '-');
        if (show.crewEffectLabel) {
          show.crewEffectLabel.string = t('dice.panel.invalid');
          show.crewEffectLabel.color = DICE_FAIL_TEXT;
        }
      }
      return;
    }

    if (show.dmgEffectLabel) {
      const lab = damageEffectLabel(show.report.damageEffect);
      show.dmgEffectLabel.string = lab.text;
      show.dmgEffectLabel.color = lab.color;
    }
    if (show.report.stagedCrewCheck) {
      this.setDieLabelFace(show.crewDieLabel, show.report.stagedCrewCheck.die > 0 ? show.report.stagedCrewCheck.die : '-');
      if (show.crewEffectLabel) {
        if (show.report.damageEffect === 'crewCheck') {
          const lab = crewDeathLabel(show.report.stagedCrewCheck);
          show.crewEffectLabel.string = lab.text;
          show.crewEffectLabel.color = lab.color;
        } else {
          show.crewEffectLabel.string = t('dice.panel.invalid');
          show.crewEffectLabel.color = DICE_FAIL_TEXT;
        }
      }
    }
  }

  private setMainGunDiceOutcome(show: DiceShow) {
    if (!show.report.hit) {
      show.outcomeLabel.string = t('dice.panel.outcomeMiss');
      show.outcomeLabel.color = DICE_OUTCOME_MISS;
    } else if (!show.report.penetrated) {
      show.outcomeLabel.string = t('dice.panel.outcomeRic');
      show.outcomeLabel.color = DICE_OUTCOME_RIC;
    } else if (show.report.damageEffect === 'crewCheck' && show.report.crewCheck) {
      const out = crewOutcomeLabel(show.report.crewCheck);
      show.outcomeLabel.string = out.text;
      show.outcomeLabel.color = out.color;
    } else {
      const out = damageOutcomeLabel(show.report.damageEffect);
      show.outcomeLabel.string = out.text;
      show.outcomeLabel.color = out.color;
    }
  }

  private enterDiceShowHold(show: DiceShow) {
    show.stage = 'hold';
    show.t = 0;
    show.outcomeLabel.node.active = false;
    if (show.confirmButton) show.confirmButton.active = !show.mg;
  }

  // ---------- 敌方 AI 骰子迷你托盘 ----------

  /** 按点数升序排骰下标，同点保留原数组顺序（稳定排序） */
  private computeEnemyDiceExecOrder(): number[] {
    const n = this.enemyDice.length;
    const idx = Array.from({ length: n }, (_, i) => i);
    idx.sort((a, b) => {
      const va = this.enemyDice[a];
      const vb = this.enemyDice[b];
      if (va !== vb) return va - vb;
      return a - b;
    });
    return idx;
  }

  /** 托盘下方短标签：当前规则下该骰将执行的具体动作（无可行则空转） */
  private enemyDieActionSubtitle(enemy: Unit, dieIdx: number): string {
    const pip = this.enemyDice[dieIdx];
    const entry = actionFor(DEFAULT_AI_TABLE, this.enemyAICol, pip);
    const chosen = this.chooseActionForEntry(enemy, entry);
    if (!chosen || chosen === 'none') return t('dice.aiEnemy.waste');
    return t(`dice.aiEnemy.${chosen}`);
  }

  /** k∈[0,1]：各骰列根节点从 fromSlot 插值到 toSlot 的屏幕 x */
  private applyEnemyDiceSortLayout(k01: number) {
    const m = this.enemyTrayMetrics;
    const s = this.enemyDiceSortAnim;
    if (!m || !s) return;
    const slotCenterX = (slot: number) => this.playerDiceSlotX(slot, m.count);
    for (let i = 0; i < m.count; i++) {
      const root = this.enemyDiceTrayDieRoots[i];
      if (!root || !root.isValid) continue;
      const x0 = slotCenterX(s.fromSlot[i]);
      const x1 = slotCenterX(s.toSlot[i]);
      root.setPosition(x0 + (x1 - x0) * k01, m.rowY, 0);
    }
  }

  /**
   * 在 UI 层（`this.node` 子节点**最顶层**）固定位置展示本辆敌坦当回合全部 AI 骰：
   * 勿插在 MapGraphics 与 HUD 之间，否则会被右侧状态栏等后绘制的 UI 完全遮挡。
   * @param playSort true：新回合掷骰后播约 1s 排序动画再开始执行；false：直接摆在升序槽位（如射击面板关闭后重建托盘）
   */
  private buildEnemyDiceTray(enemy: Unit, opts: { playSort?: boolean } = {}) {
    const playSort = opts.playSort !== false;
    this.destroyEnemyDiceTray();
    const count = this.enemyDice.length;
    if (count <= 0) return;

    const DIE_SIZE = BattleScene.DICE_TRAY_SLOT;
    const GAP = BattleScene.DICE_TRAY_GAP;
    const totalW = count * DIE_SIZE + (count - 1) * GAP;
    const subtitleH = 22;
    const trayH = 120;
    const rowY = 0;

    this.enemyTrayMetrics = { dieSize: DIE_SIZE, gap: GAP, totalW, count, rowY };

    const exec = this.enemyDiceExecOrder.length === count
      ? this.enemyDiceExecOrder
      : this.computeEnemyDiceExecOrder();
    const toSlot = this.enemyDice.map((_, i) => exec.indexOf(i));
    const fromSlot = this.enemyDice.map((_, i) => i);

    const root = new Node('EnemyDiceTray');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(640, trayH);
    this.placeEnemyDiceTrayRoot(root);
    this.node.addChild(root);
    root.setSiblingIndex(this.node.children.length - 1);

    const header = new Node('AICol');
    header.layer = this.node.layer;
    header.addComponent(UITransform).setContentSize(420, 28);
    header.setPosition(0, 52, 0);
    const hl = header.addComponent(Label);
    hl.fontSize = 22;
    hl.lineHeight = 26;
    hl.color = new Color(230, 230, 200, 255);
    hl.horizontalAlign = HorizontalTextAlignment.CENTER;
    hl.verticalAlign = VerticalTextAlignment.CENTER;
    hl.string = t('dice.aiHeader', { col: aiColumnDisplayName(this.enemyAICol), n: count });
    hl.enableOutline = true;
    hl.outlineColor = new Color(0, 0, 0, 220);
    hl.outlineWidth = 2;
    root.addChild(header);

    this.enemyDiceTraySubject = enemy;
    this.enemyDiceTrayLabels = [];
    this.enemyDiceTrayTileGraphics = [];
    this.enemyDiceTrayDieRoots = [];
    this.enemyDiceTraySubtitleLabels = [];

    const slotCenterX = (slot: number) => this.playerDiceSlotX(slot, count);

    for (let i = 0; i < count; i++) {
      const dieRoot = new Node(`D${i}`);
      dieRoot.layer = this.node.layer;
      dieRoot.addComponent(UITransform).setContentSize(DIE_SIZE + 4, DIE_SIZE + subtitleH + 6);
      const startSlot = playSort ? fromSlot[i] : toSlot[i];
      dieRoot.setPosition(slotCenterX(startSlot), rowY, 0);
      root.addChild(dieRoot);
      this.enemyDiceTrayDieRoots.push(dieRoot);

      const tile = new Node('Tile');
      tile.layer = this.node.layer;
      tile.addComponent(UITransform).setContentSize(DIE_SIZE, DIE_SIZE);
      tile.setPosition(0, 0, 0);
      const g = tile.addComponent(Graphics);
      this.drawDieBody(g, DIE_SIZE, DIE_SIZE, {
        fill: DICE_DIE_FILL,
        border: DICE_DIE_BORDER,
        lineWidth: 2,
        shadow: true,
      });
      dieRoot.addChild(tile);

      const labNode = new Node('Face');
      labNode.layer = this.node.layer;
      labNode.addComponent(UITransform).setContentSize(DIE_SIZE, DIE_SIZE);
      const l = labNode.addComponent(Label);
      l.fontSize = 40;
      l.lineHeight = 44;
      l.color = DIE_FACE_TEXT;
      l.horizontalAlign = HorizontalTextAlignment.CENTER;
      l.verticalAlign = VerticalTextAlignment.CENTER;
      l.string = '';
      tile.addChild(labNode);

      this.enemyDiceTrayLabels.push(l);
      this.enemyDiceTrayTileGraphics.push(g);

      const subNode = new Node('Action');
      subNode.layer = this.node.layer;
      subNode.addComponent(UITransform).setContentSize(DIE_SIZE + 12, subtitleH);
      subNode.setPosition(0, -DIE_SIZE / 2 - 14, 0);
      const sub = subNode.addComponent(Label);
      sub.fontSize = 18;
      sub.lineHeight = 20;
      sub.color = new Color(200, 200, 180, 255);
      sub.horizontalAlign = HorizontalTextAlignment.CENTER;
      sub.verticalAlign = VerticalTextAlignment.TOP;
      sub.string = this.enemyDieActionSubtitle(enemy, i);
      dieRoot.addChild(subNode);
      this.enemyDiceTraySubtitleLabels.push(sub);
    }

    this.enemyDiceTrayRoot = root;
    if (playSort) {
      this.enemyDiceSortAnim = { t: 0, dur: ENEMY_TRAY_SORT_DUR, fromSlot, toSlot };
      this.applyEnemyDiceSortLayout(0);
    } else {
      this.enemyDiceSortAnim = null;
      for (let i = 0; i < count; i++) {
        const dr = this.enemyDiceTrayDieRoots[i];
        if (dr) dr.setPosition(slotCenterX(toSlot[i]), rowY, 0);
      }
    }

    this.refreshEnemyDiceTray();
  }

  /** 重刷托盘里每颗骰的已用 / 当前执行高亮 */
  private refreshEnemyDiceTray() {
    if (!this.enemyDiceTrayRoot) return;
    const m = this.enemyTrayMetrics;
    const DIE_SIZE = m?.dieSize ?? BattleScene.DICE_TRAY_SLOT;
    const enemy = this.enemyDiceTraySubject;
    for (let i = 0; i < this.enemyDiceTrayLabels.length; i++) {
      const used = !!this.enemyDiceUsed[i];
      const hi = i === this.enemyDiceHighlightIdx;
      const lab = this.enemyDiceTrayLabels[i];
      if (lab) {
        lab.string = '';
        lab.color = used
          ? new Color(120, 120, 120, 200)
          : new Color(20, 20, 20, 255);
      }
      const sub = this.enemyDiceTraySubtitleLabels[i];
      if (sub && enemy && !enemy.destroyed) {
        sub.string = this.enemyDieActionSubtitle(enemy, i);
        sub.color = used
          ? new Color(130, 130, 120, 160)
          : new Color(200, 200, 180, 255);
      }
      const g = this.enemyDiceTrayTileGraphics[i];
      if (!g) continue;
      g.clear();
      this.drawDieBody(g, DIE_SIZE, DIE_SIZE, {
        fill: DICE_DIE_FILL,
        border: hi
          ? new Color(255, 200, 80, 255)
          : DICE_DIE_BORDER,
        lineWidth: hi ? 3.5 : 2,
        shadow: !used,
      });
      this.drawDiePips(
        g,
        this.enemyDiceSortAnim
          ? (((Math.floor(this.enemyDiceSortAnim.t / DICE_CYCLE_INTERVAL) + 1) * (13 + i * 4) + i * 7) % 6) + 1
          : this.enemyDice[i],
        DIE_SIZE,
        used ? new Color(90, 90, 80, 180) : new Color(20, 20, 20, 255),
      );
      const parent = lab?.node.parent;
      if (parent) parent.setScale(used && !hi ? 0.9 : 1, used && !hi ? 0.9 : 1, 1);
    }
  }

  /**
   * 敌方阶段：把 AI 骰子托盘挂到 DiceShow 根节点内、Backdrop 与 Panel 之间，避免被全屏遮罩盖住。
   */
  private liftEnemyDiceTrayIntoDiceShowIfNeeded(diceShowRoot: Node) {
    if (this.phase !== 'enemy') return;
    const tray = this.enemyDiceTrayRoot;
    if (!tray || !tray.isValid || !diceShowRoot.isValid) return;
    if (tray.parent === diceShowRoot) return;
    tray.removeFromParent();
    const back = diceShowRoot.getChildByName('Backdrop');
    const insertAt = back ? 1 : 0;
    diceShowRoot.insertChild(tray, insertAt);
    this.placeEnemyDiceTrayRoot(tray);
  }

  /** 关闭 DiceShow 前将托盘移回 this.node，避免随 panelRoot.destroy 一起被销毁 */
  private lowerEnemyDiceTrayFromDiceShowIfNeeded() {
    const tray = this.enemyDiceTrayRoot;
    if (!tray || !tray.isValid) return;
    if (tray.parent?.name !== 'DiceShow') return;
    tray.removeFromParent();
    this.node.addChild(tray);
    this.placeEnemyDiceTrayRoot(tray);
    tray.setSiblingIndex(this.node.children.length - 1);
  }

  /** 销毁敌方骰子托盘（切敌方单位 / 结束敌方阶段等） */
  private destroyEnemyDiceTray() {
    this.lowerEnemyDiceTrayFromDiceShowIfNeeded();
    this.enemyDiceSortAnim = null;
    this.enemyNoActionHold = null;
    this.enemyTrayMetrics = null;
    this.enemyDiceTraySubject = null;
    this.enemyDiceTrayDieRoots = [];
    this.enemyDiceTraySubtitleLabels = [];
    if (this.enemyDiceTrayRoot) {
      this.enemyDiceTrayRoot.destroy();
      this.enemyDiceTrayRoot = null;
    }
    this.enemyDiceTrayLabels = [];
    this.enemyDiceTrayTileGraphics = [];
    this.enemyDiceHighlightIdx = -1;
  }

  /** 在 parent 下挂一个居中 Label，并返回供外部 setString。 */
  private makeCenteredLabel(
    parent: Node, text: string,
    x: number, y: number, w: number, h: number,
    fontSize: number, color: Color,
  ): Label {
    const n = new Node('Label');
    n.layer = this.node.layer;
    n.addComponent(UITransform).setContentSize(w, h);
    n.setPosition(x, y, 0);
    const l = n.addComponent(Label);
    l.fontSize = fontSize;
    l.lineHeight = fontSize + 4;
    l.color = color;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.string = text;
    parent.addChild(n);
    return l;
  }

  /**
   * 每帧推进掷骰面板（§3.4 三段式）。
   *
   * 状态机：
   *   hit-roll (滚动 DICE_HIT_ROLL_DUR)
   *     → hit-show (揭示 2d6 真值 + 命中/未命中，停 DICE_HIT_SHOW_DUR)
   *   若未命中：hit-show → hold（骰子不再动，底部大字 MISS，停 DICE_HOLD_DUR）→ done
   *   若命中：hit-show → pen-roll (DICE_PEN_ROLL_DUR)
   *     → pen-show (揭示 1d6 + 击穿/跳弹，DICE_PEN_SHOW_DUR)
   *   若跳弹：pen-show → hold（底部出 跳弹）→ done
   *   若击穿且有伤害骰：pen-show → dmg-roll (DICE_DMG_ROLL_DUR) → dmg-show (揭示 1d6 + 伤害效果)
   *   若击穿即摧毁（如 Pacific 日军单位）：pen-show → hold
   *     → hold（底部出 起火 / 击毁 / 炮塔 / 痛痪 / 阵亡检定 / 受损）→ done
   */
  private advanceDiceShow(dt: number) {
    const show = this.diceShow;
    if (!show) return;
    show.t += dt;

    switch (show.stage) {
      case 'hit-roll': {
        // 按间隔切换 2d6 的显示面，营造"在转"的感觉
        const frame = Math.floor(show.t / DICE_CYCLE_INTERVAL);
        // 用 frame 当种子简单伪随机：不用真随机以免过于抖动
        const p1 = ((frame * 17) % 6) + 1;
        const p2 = ((frame * 23) % 6) + 1;
        this.setDieLabelFace(show.hitDieLabels[0], p1);
        if (show.hitDieLabels[1]) this.setDieLabelFace(show.hitDieLabels[1], p2);
        show.hitSumLabel.string = '= ?';
        if (!show.mg) this.spinMainGunDiceRows(show, frame);
        if (show.t >= DICE_HIT_ROLL_DUR) {
          show.stage = 'hit-show';
          show.t = 0;
          this.setDieLabelFace(show.hitDieLabels[0], show.report.dice[0]);
          if (show.hitDieLabels[1]) this.setDieLabelFace(show.hitDieLabels[1], show.report.dice[1]);
          show.hitSumLabel.string = show.report.hitBonus
            ? `+${show.report.hitBonus} = ${show.report.roll}`
            : `= ${show.report.roll}`;
          if (show.report.hit) {
            show.hitVerdictLabel.string = t('dice.panel.hitYes');
            show.hitVerdictLabel.color = DICE_OK_TEXT;
          } else {
            show.hitVerdictLabel.string = t('dice.panel.hitNo');
            show.hitVerdictLabel.color = DICE_FAIL_TEXT;
          }
          if (show.hitSpecialLabel && show.report.hit && show.report.commanderKilledByHitDoubles) {
            show.hitSpecialLabel.node.active = true;
            show.hitSpecialLabel.string = t('dice.panel.hitDoublesCommanderKia');
          }
          if (!show.mg) {
            this.revealMainGunDiceRows(show);
            this.setMainGunDiceOutcome(show);
            this.enterDiceShowHold(show);
          }
          // 射击音效与「骰子落定」同步：主炮 / 机枪在命中与未命中时均播放（onDone 过晚且机枪曾仅命中播）
          if (show.mg) playMgFire();
          else {
            this.spawnMuzzleFlash(show.attacker, show.target);
            playConfiguredAttackSound(show.attackSound);
          }
        }
        break;
      }
      case 'hit-show': {
        if (show.t >= DICE_HIT_SHOW_DUR) {
          show.t = 0;
          if (show.mg) {
            // 机枪模式：2d6 一段式，hit-show 结束后直接到 hold；
            // 命中 = 步兵击毙，未命中 = MISS。不会进入 pen/dmg/crew。
            if (show.report.hit) {
              show.outcomeLabel.string = t('dice.panel.outcomeMGKill');
              show.outcomeLabel.color = DICE_OUTCOME_HIT;
            } else {
              show.outcomeLabel.string = t('dice.panel.outcomeMiss');
              show.outcomeLabel.color = DICE_OUTCOME_MISS;
            }
            this.enterDiceShowHold(show);
          } else if (!show.report.hit) {
            // 未命中直接跳到 hold 显示 MISS，并隐藏穿甲骰那一行（视觉更干净）
            for (const label of show.penDieLabels) label.node.parent!.active = false;
            if (show.penNeedLabel) show.penNeedLabel.node.active = false;
            if (show.penVerdictLabel) show.penVerdictLabel.node.active = false;
            if (show.report.hit && show.report.commanderKilledByHitDoubles) {
              show.outcomeLabel.string = t('dice.panel.outcomeCommanderKia');
              show.outcomeLabel.color = DICE_OUTCOME_CREW;
            } else {
              show.outcomeLabel.string = t('dice.panel.outcomeMiss');
              show.outcomeLabel.color = DICE_OUTCOME_MISS;
            }
            this.enterDiceShowHold(show);
          } else {
            // 准备 pen 阶段：标题文字 + 骰子进入滚动
            show.stage = 'pen-roll';
            if (show.penNeedLabel && show.report.penThreshold !== undefined) {
              const thr = show.report.penThreshold;
              show.penNeedLabel.string = thr <= 0
                ? t('dice.panel.penMustPen')
                : t('dice.panel.penNeed', { n: thr });
            }
            if (show.penVerdictLabel) show.penVerdictLabel.string = '';
          }
        }
        break;
      }
      case 'pen-roll': {
        const frame = Math.floor(show.t / DICE_CYCLE_INTERVAL);
        const p = ((frame * 13) % 6) + 1;
        for (let i = 0; i < show.penDieLabels.length; i++) {
          this.setDieLabelFace(show.penDieLabels[i], ((frame * (13 + i * 4)) % 6) + 1);
        }
        if (show.t >= DICE_PEN_ROLL_DUR) {
          show.stage = 'pen-show';
          show.t = 0;
          if (show.report.penDice?.length) {
            show.penDieLabels.forEach((label, i) => this.setDieLabelFace(label, show.report.penDice![i] ?? '?'));
          } else if (show.report.penDie !== undefined) {
            show.penDieLabels.forEach((label) => this.setDieLabelFace(label, show.report.penDie ?? '?'));
          }
          if (show.penVerdictLabel) {
            if (show.report.penetrated) {
              show.penVerdictLabel.string = show.report.stagedDamageDie === undefined && show.report.damageEffect === 'destroyed'
                ? t('dmg.outcome.destroyed')
                : t('dice.panel.penYes');
              show.penVerdictLabel.color = DICE_OK_TEXT;
            } else {
              show.penVerdictLabel.string = t('dice.panel.penNo');
              show.penVerdictLabel.color = DICE_FAIL_TEXT;
            }
          }
        }
        break;
      }
      case 'pen-show': {
        if (show.t >= DICE_PEN_SHOW_DUR) {
          show.t = 0;
          if (!show.report.penetrated) {
            // 跳弹：不再进入伤害检定，直接到 hold
            if (show.dmgDieLabel) show.dmgDieLabel.node.parent!.active = false;
            if (show.dmgEffectLabel) show.dmgEffectLabel.node.active = false;
            show.outcomeLabel.string = t('dice.panel.outcomeRic');
            show.outcomeLabel.color = DICE_OUTCOME_RIC;
            this.enterDiceShowHold(show);
          } else if (show.report.damageDie === undefined) {
            const out = damageOutcomeLabel(show.report.damageEffect);
            show.outcomeLabel.string = out.text;
            show.outcomeLabel.color = out.color;
            this.enterDiceShowHold(show);
          } else {
            // 准备伤害检定阶段：打开该行可见性 + 骰子进入滚动
            show.stage = 'dmg-roll';
            if (show.dmgDieLabel) {
              show.dmgDieLabel.node.parent!.active = true;
              this.setDieLabelFace(show.dmgDieLabel, '?');
            }
            if (show.dmgEffectLabel) {
              show.dmgEffectLabel.node.active = true;
              show.dmgEffectLabel.string = '';
            }
            if (show.dmgTitleLabel) show.dmgTitleLabel.node.active = true;
          }
        }
        break;
      }
      case 'dmg-roll': {
        const frame = Math.floor(show.t / DICE_CYCLE_INTERVAL);
        const p = ((frame * 11) % 6) + 1;
        this.setDieLabelFace(show.dmgDieLabel, p);
        if (show.t >= DICE_DMG_ROLL_DUR) {
          show.stage = 'dmg-show';
          show.t = 0;
          if (show.dmgDieLabel && show.report.damageDie !== undefined) {
            this.setDieLabelFace(show.dmgDieLabel, show.report.damageDie);
          }
          if (show.dmgEffectLabel) {
            const lab = damageEffectLabel(show.report.damageEffect);
            show.dmgEffectLabel.string = lab.text;
            show.dmgEffectLabel.color = lab.color;
          }
        }
        break;
      }
      case 'dmg-show': {
        if (show.t >= DICE_DMG_SHOW_DUR) {
          show.t = 0;
          if (show.report.stagedDamageEffect === 'crewCheck' && show.report.stagedCrewCheck) {
            // 阵亡检定：再掷一颗 1d6 决定死谁
            show.stage = 'crew-roll';
            if (show.crewDieLabel) {
              show.crewDieLabel.node.parent!.active = true;
              this.setDieLabelFace(show.crewDieLabel, '?');
            }
            if (show.crewTitleLabel) show.crewTitleLabel.node.active = true;
            if (show.crewEffectLabel) {
              show.crewEffectLabel.node.active = true;
              show.crewEffectLabel.string = '';
            }
          } else {
            const out = damageOutcomeLabel(show.report.damageEffect);
            show.outcomeLabel.string = out.text;
            show.outcomeLabel.color = out.color;
            this.enterDiceShowHold(show);
          }
        }
        break;
      }
      case 'crew-roll': {
        const frame = Math.floor(show.t / DICE_CYCLE_INTERVAL);
        const p = ((frame * 29) % 6) + 1;
        this.setDieLabelFace(show.crewDieLabel, p);
        if (show.t >= DICE_CREW_ROLL_DUR) {
          show.stage = 'crew-show';
          show.t = 0;
          const cc = show.report.stagedCrewCheck;
          if (show.crewDieLabel && cc) {
            // 重抛过的情况下仍然展示最终那次的点数
            this.setDieLabelFace(show.crewDieLabel, cc.die > 0 ? cc.die : '-');
          }
          if (show.crewEffectLabel) {
            if (!show.report.hit || !show.report.penetrated || show.report.damageEffect !== 'crewCheck') {
              show.crewEffectLabel.string = t('dice.panel.invalid');
              show.crewEffectLabel.color = DICE_FAIL_TEXT;
            } else {
              const lab = crewDeathLabel(cc);
              show.crewEffectLabel.string = lab.text;
              show.crewEffectLabel.color = lab.color;
            }
          }
        }
        break;
      }
      case 'crew-show': {
        if (show.t >= DICE_CREW_SHOW_DUR) {
          show.t = 0;
          if (show.report.hit && show.report.penetrated && show.report.damageEffect === 'crewCheck') {
            const out = crewOutcomeLabel(show.report.crewCheck);
            show.outcomeLabel.string = out.text;
            show.outcomeLabel.color = out.color;
          }
          this.enterDiceShowHold(show);
        }
        break;
      }
      case 'hold': {
        if (show.mg && show.t >= DICE_HOLD_DUR) {
          show.stage = 'done';
          this.finalizeDiceShow(false);
        }
        break;
      }
      case 'done':
        // 已触发 finalize，保险：下一帧自清
        break;
    }
  }

  /**
   * 真正销毁面板 + 触发 onDone 回调。
   * skip=true 时仅清 UI，不再调用 onDone（用于被另一次攻击打断的极端场景）。
   */
  private finalizeDiceShow(skip: boolean) {
    const show = this.diceShow;
    if (!show) return;
    this.lowerEnemyDiceTrayFromDiceShowIfNeeded();
    this.diceShow = null;
    if (show.panelRoot.isValid) show.panelRoot.destroy();
    if (!skip && !show.finalized) {
      show.finalized = true;
      show.onDone();
    }
  }

  /** 当前是否处于"不接受新指令"的过场态：移动动画中 / 掷骰动画中都算。 */
  private isBusy(): boolean {
    return this.anim !== null || this.diceShow !== null || this.playerDiceRollAnim !== null
      || this.playerDiceSortAnim !== null
      || this.turretAimAnim !== null
      || this.enemyDiceSortAnim !== null
      || this.enemyNoActionHold !== null
      || this.turnEndEventUI !== null || this.fireCheckEventUI !== null || this.usCasualtyEventUI !== null
      || this.tileInspectModalRoot !== null;
  }

  private destroyFireCheckEventUI() {
    const ui = this.fireCheckEventUI;
    if (!ui) return;
    this.fireCheckEventUI = null;
    if (ui.root.isValid) ui.root.destroy();
  }

  private buildFireCheckEventPanel(allDice: number[]): {
    root: Node;
    dieLabels: Label[];
    sumLabel: Label;
    bodyLabel: Label;
  } {
    const n = allDice.length;
    const perRow = 6;
    const rows = Math.max(1, Math.ceil(n / perRow));
    const dieSize = n > 8 ? 38 : 46;
    const gap = n > 8 ? 34 : 50;
    const diceBlockH = rows * (dieSize + 10) - 10;

    const root = new Node('FireCheckEventPanel');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    root.setPosition(0, 0, 0);
    this.node.addChild(root);
    root.setSiblingIndex(this.node.children.length - 1);

    const mask = new Node('Mask');
    mask.layer = this.node.layer;
    mask.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    root.addChild(mask);
    const maskG = mask.addComponent(Graphics);
    maskG.fillColor = DICE_BACKDROP;
    maskG.rect(-CANVAS_W * 0.5, -CANVAS_H * 0.5, CANVAS_W, CANVAS_H);
    maskG.fill();
    mask.addComponent(BlockInputEvents);

    const pw = Math.min(720, CANVAS_W - 40);
    const ph = Math.min(420 + (rows - 1) * 40, CANVAS_H - 64);
    const panel = new Node('Panel');
    panel.layer = this.node.layer;
    root.addChild(panel);
    panel.addComponent(UITransform).setContentSize(pw, ph);
    const panelG = panel.addComponent(Graphics);
    drawDicePopupPanel(panelG, pw, ph, DICE_PANEL_BG, DICE_PANEL_BORDER);

    const title = new Node('Title');
    title.layer = this.node.layer;
    panel.addChild(title);
    const titleL = title.addComponent(Label);
    titleL.string = t('fireCheck.title');
    titleL.fontSize = 26;
    titleL.color = new Color(240, 240, 240, 255);
    title.setPosition(0, ph * 0.5 - 30);

    const dieWrap = new Node('DieWrap');
    dieWrap.layer = this.node.layer;
    panel.addChild(dieWrap);
    dieWrap.setPosition(0, ph * 0.5 - 56 - diceBlockH * 0.5);
    const dieLabels: Label[] = [];
    for (let r = 0; r < rows; r++) {
      const inRow = Math.min(perRow, n - r * perRow);
      const startX = -((inRow - 1) * gap) * 0.5;
      for (let c = 0; c < inRow; c++) {
        dieLabels.push(this.makeDieSquare(dieWrap, startX + c * gap, -r * (dieSize + 10), dieSize));
      }
    }

    const textBlockW = Math.min(560, pw - 96);
    const sumLabelN = new Node('SumLabel');
    sumLabelN.layer = this.node.layer;
    panel.addChild(sumLabelN);
    sumLabelN.addComponent(UITransform).setContentSize(textBlockW, 36);
    const sumL = sumLabelN.addComponent(Label);
    sumL.fontSize = 19;
    sumL.lineHeight = 24;
    sumL.color = new Color(200, 210, 220, 255);
    sumL.horizontalAlign = HorizontalTextAlignment.CENTER;
    sumL.verticalAlign = VerticalTextAlignment.CENTER;
    sumL.overflow = Label.Overflow.CLAMP;
    sumL.string = '';
    sumLabelN.setPosition(0, ph * 0.5 - 86 - diceBlockH);

    const bodyN = new Node('BodyLabel');
    bodyN.layer = this.node.layer;
    panel.addChild(bodyN);
    const bodyUt = bodyN.addComponent(UITransform);
    bodyUt.setAnchorPoint(0.5, 1);
    bodyUt.setContentSize(textBlockW, 1);
    const bodyL = bodyN.addComponent(Label);
    bodyL.fontSize = 18;
    bodyL.lineHeight = 24;
    bodyL.color = new Color(220, 225, 230, 255);
    bodyL.overflow = Label.Overflow.RESIZE_HEIGHT;
    bodyL.horizontalAlign = HorizontalTextAlignment.LEFT;
    bodyL.verticalAlign = VerticalTextAlignment.TOP;
    bodyL.string = '';
    bodyN.setPosition(0, ph * 0.5 - 126 - diceBlockH);

    const confirmB = this.makeBattleRectButton(
      panel,
      0,
      -ph * 0.5 + 52,
      200,
      44,
      BATTLE_BTN_ACCENT,
      () => this.onFireCheckConfirmClick(),
    );
    const confirmLab = this.makeBattleModalLabel(
      confirmB.node,
      t('fireCheck.confirm'),
      0,
      0,
      200,
      44,
      22,
      Color.WHITE,
    );
    this.mirrorBattleModalButtonLabel(confirmLab, () => this.onFireCheckConfirmClick());

    return { root, dieLabels, sumLabel: sumL, bodyLabel: bodyL };
  }

  private advanceFireCheckEventUI(dt: number) {
    const ui = this.fireCheckEventUI;
    if (!ui || ui.stage !== 'roll') return;
    ui.t += dt;
    const DUR = 0.55;
    if (ui.t < DUR) {
      const tick = Math.floor(ui.t / 0.08) % 6;
      for (const lab of ui.dieLabels) this.setDieLabelFace(lab, (tick % 6) + 1);
      return;
    }
    for (let i = 0; i < ui.dieLabels.length; i++) {
      const lab = ui.dieLabels[i];
      if (lab) this.setDieLabelFace(lab, ui.allDice[i] ?? '?');
    }
    ui.sumLabel.string = t(ui.introKey, ui.introParams);
    ui.bodyLabel.string = ui.bodyText;
    ui.stage = 'hold';
  }

  private onFireCheckConfirmClick() {
    const ui = this.fireCheckEventUI;
    if (!ui || ui.stage !== 'hold') return;
    try {
      ui.apply();
    } catch (e) {
      console.error('[FireCheck] apply failed', e);
    }
    this.destroyFireCheckEventUI();
    this.continueEnemyPhaseAfterFireCheck();
  }

  private destroyUsCasualtyEventUI() {
    const ui = this.usCasualtyEventUI;
    if (!ui) return;
    this.usCasualtyEventUI = null;
    if (ui.root.isValid) ui.root.destroy();
  }

  private buildUsCasualtyEventPanel(diceCount: number, providerLineCount: number): {
    root: Node;
    dieLabels: Label[];
    providerLabel: Label;
    resultLabel: Label;
  } {
    const perRow = 8;
    const rows = Math.max(1, Math.ceil(Math.max(1, diceCount) / perRow));
    const dieSize = diceCount > 12 ? 36 : 44;
    const gap = diceCount > 12 ? 38 : 50;
    const diceBlockH = diceCount > 0 ? rows * (dieSize + 10) - 10 : 32;
    const providerBlockH = Math.min(176, Math.max(56, providerLineCount * 24 + 28));

    const root = new Node('UsCasualtyEventPanel');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    root.setPosition(0, 0, 0);
    this.node.addChild(root);
    root.setSiblingIndex(this.node.children.length - 1);

    const mask = new Node('Mask');
    mask.layer = this.node.layer;
    mask.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    root.addChild(mask);
    const maskG = mask.addComponent(Graphics);
    maskG.fillColor = DICE_BACKDROP;
    maskG.rect(-CANVAS_W * 0.5, -CANVAS_H * 0.5, CANVAS_W, CANVAS_H);
    maskG.fill();
    mask.addComponent(BlockInputEvents);

    const pw = Math.min(760, CANVAS_W - 40);
    const ph = Math.min(310 + providerBlockH + diceBlockH, CANVAS_H - 64);
    const panel = new Node('Panel');
    panel.layer = this.node.layer;
    root.addChild(panel);
    panel.addComponent(UITransform).setContentSize(pw, ph);
    const panelG = panel.addComponent(Graphics);
    drawDicePopupPanel(panelG, pw, ph, DICE_PANEL_BG, DICE_PANEL_BORDER);

    this.makeBattleModalLabel(panel, t('usCasualty.title'), 0, ph * 0.5 - 34, pw - 48, 34, 26, HUD_TEXT_COLOR);

    const providerNode = new Node('ProviderLabel');
    providerNode.layer = this.node.layer;
    panel.addChild(providerNode);
    const providerUt = providerNode.addComponent(UITransform);
    providerUt.setAnchorPoint(0.5, 1);
    providerUt.setContentSize(Math.min(620, pw - 96), providerBlockH);
    const providerL = providerNode.addComponent(Label);
    providerL.fontSize = 18;
    providerL.lineHeight = 24;
    providerL.color = new Color(225, 225, 215, 255);
    providerL.horizontalAlign = HorizontalTextAlignment.LEFT;
    providerL.verticalAlign = VerticalTextAlignment.TOP;
    providerL.overflow = Label.Overflow.CLAMP;
    providerL.string = '';
    providerNode.setPosition(0, ph * 0.5 - 76);

    const dieWrap = new Node('DieWrap');
    dieWrap.layer = this.node.layer;
    panel.addChild(dieWrap);
    dieWrap.setPosition(0, ph * 0.5 - 106 - providerBlockH - diceBlockH * 0.5);
    const dieLabels: Label[] = [];
    if (diceCount > 0) {
      for (let r = 0; r < rows; r++) {
        const inRow = Math.min(perRow, diceCount - r * perRow);
        const startX = -((inRow - 1) * gap) * 0.5;
        for (let c = 0; c < inRow; c++) {
          dieLabels.push(this.makeDieSquare(dieWrap, startX + c * gap, -r * (dieSize + 10), dieSize));
        }
      }
    } else {
      this.makeBattleModalLabel(dieWrap, t('usCasualty.noDice'), 0, 0, 360, 32, 19, DICE_INFO_TEXT);
    }

    const resultNode = new Node('ResultLabel');
    resultNode.layer = this.node.layer;
    panel.addChild(resultNode);
    resultNode.addComponent(UITransform).setContentSize(Math.min(620, pw - 96), 52);
    const resultL = resultNode.addComponent(Label);
    resultL.fontSize = 28;
    resultL.lineHeight = 34;
    resultL.color = DICE_OUTCOME_KO;
    resultL.horizontalAlign = HorizontalTextAlignment.CENTER;
    resultL.verticalAlign = VerticalTextAlignment.CENTER;
    resultL.overflow = Label.Overflow.CLAMP;
    resultL.string = '';
    resultNode.setPosition(0, ph * 0.5 - 170 - providerBlockH - diceBlockH);

    const confirmB = this.makeBattleRectButton(
      panel,
      0,
      -ph * 0.5 + 52,
      200,
      44,
      BATTLE_BTN_ACCENT,
      () => this.onUsCasualtyConfirmClick(),
    );
    const confirmLab = this.makeBattleModalLabel(
      confirmB.node,
      t('usCasualty.confirm'),
      0,
      0,
      200,
      44,
      22,
      Color.WHITE,
    );
    this.mirrorBattleModalButtonLabel(confirmLab, () => this.onUsCasualtyConfirmClick());

    return { root, dieLabels, providerLabel: providerL, resultLabel: resultL };
  }

  private setUsCasualtyDieFace(label: Label | null | undefined, value: number | string, hot: boolean) {
    if (!label) return;
    const n = Number(value);
    const container = label.node.parent;
    const body = container?.getComponent(Graphics);
    const bodyUt = container?.getComponent(UITransform);
    const size = bodyUt ? Math.min(bodyUt.contentSize.width, bodyUt.contentSize.height) : 44;
    if (body) {
      body.clear();
      this.drawDieBody(body, size, size, {
        fill: hot ? new Color(255, 244, 196, 255) : DICE_DIE_FILL,
        border: hot ? new Color(255, 196, 48, 255) : DICE_DIE_BORDER,
        lineWidth: hot ? 4 : 2,
        shadow: true,
      });
    }
    const pips = label.node.parent?.getChildByName('Pips')?.getComponent(Graphics);
    if (pips) pips.clear();
    if (body && Number.isInteger(n) && n >= 1 && n <= 6) {
      this.drawDiePips(body, n, size, hot ? new Color(160, 38, 24, 255) : DICE_DIE_TEXT);
      label.string = '';
    } else {
      label.string = String(value);
      label.color = hot ? new Color(160, 38, 24, 255) : DICE_DIE_TEXT;
    }
  }

  private advanceUsCasualtyEventUI(dt: number) {
    const ui = this.usCasualtyEventUI;
    if (!ui) return;
    ui.t += dt;
    if (ui.stage === 'roll') {
      const DUR = 0.55;
      if (ui.t < DUR) {
        const tick = Math.floor(ui.t / 0.08) % 6;
        for (const lab of ui.dieLabels) this.setUsCasualtyDieFace(lab, (tick % 6) + 1, false);
        return;
      }
      ui.stage = 'hold';
      ui.t = 0;
      ui.resultLabel.string = t('usCasualty.result', { hits: ui.hits });
      this.battleLogI18n('battleLog.usCasualtyCheck', {
        dice: ui.dice.length > 0 ? ui.dice.join('+') : '-',
        hits: ui.hits,
        cur: this.mission?.usCasualties ?? 0,
        limit: ui.limit,
      });
      this.refreshObjectiveHud();
      this.outcome = this.mission ? checkOutcome(this.mission) : this.outcome;
      if (this.outcome !== 'ongoing') {
        this.battleLogI18n('battleLog.usCasualtyDefeat', {
          cur: this.mission?.usCasualties ?? 0,
          limit: ui.limit,
        });
      }
    }
    if (ui.stage === 'hold') {
      const hotOn = Math.floor(ui.t / 0.22) % 2 === 0;
      for (let i = 0; i < ui.dieLabels.length; i++) {
        const value = ui.dice[i] ?? '?';
        this.setUsCasualtyDieFace(ui.dieLabels[i], value, value === 6 && hotOn);
      }
    }
  }

  private onUsCasualtyConfirmClick() {
    const ui = this.usCasualtyEventUI;
    if (!ui || ui.stage !== 'hold') return;
    this.destroyUsCasualtyEventUI();
    if (this.outcome !== 'ongoing') {
      this.refreshObjectiveHud();
      this.updateOutcomeOverlay();
      return;
    }
    this.continueAfterPacificUsCasualtyCheck();
  }

  private destroyTurnEndEventUI() {
    const ui = this.turnEndEventUI;
    if (!ui) return;
    this.turnEndEventUI = null;
    if (ui.root.isValid) ui.root.destroy();
  }

  /** 敌方阶段全部结束后：若有回合结束事件表则先播主骰与说明，否则直接进入下一玩家回合。 */
  private maybeBeginTurnEndEventOrEndEnemyPhase() {
    if (!this.mission) {
      this.endEnemyPhase();
      return;
    }
    const mid = this.mission.data.id;
    /** 胜负态在 BattleScene.this.outcome；mission 对象无 outcome 字段，勿用 this.mission.outcome */
    if (this.outcome !== 'ongoing') {
      this.endEnemyPhase();
      return;
    }
    if (this.beginPacificUsCasualtyCheckOrContinue()) return;
    this.continueAfterPacificUsCasualtyCheck();
  }

  private continueAfterPacificUsCasualtyCheck() {
    if (!this.mission) {
      this.endEnemyPhase();
      return;
    }
    const mid = this.mission.data.id;
    if (!hasTurnEndEvents(mid)) {
      this.endEnemyPhase();
      return;
    }
    this.startTurnEndEventFlow(mid);
  }

  private beginPacificUsCasualtyCheckOrContinue(): boolean {
    if (!this.mission) return false;
    const limit = this.mission.data.usCasualtyLimit ?? 0;
    if (this.mission.data.theater !== 'pacific' || limit <= 0) return false;

    const dice: number[] = [];
    const providerByKind = new Map<UnitKind, { unitCount: number; diceCount: number }>();
    for (const enemy of this.mission.enemies) {
      if (enemy.destroyed || enemy.faction !== 'japanese') continue;
      const count = Math.max(0, Math.floor(enemy.stats.usCasualtyDice ?? 0));
      if (count <= 0) continue;
      const prev = providerByKind.get(enemy.kind) ?? { unitCount: 0, diceCount: 0 };
      prev.unitCount += 1;
      prev.diceCount += count;
      providerByKind.set(enemy.kind, prev);
      for (let i = 0; i < count; i++) dice.push(this.rng.d6());
    }

    const providerLines = Array.from(providerByKind.entries()).map(([kind, info]) => t('usCasualty.providerLine', {
      unit: unitDisplayName(kind),
      units: info.unitCount,
      dice: info.diceCount,
    }));
    const hits = dice.filter(d => d === 6).length;
    this.mission.usCasualties = (this.mission.usCasualties ?? 0) + hits;
    this.destroyUsCasualtyEventUI();
    const refs = this.buildUsCasualtyEventPanel(dice.length, Math.max(1, providerLines.length));
    refs.providerLabel.string = providerLines.length > 0
      ? t('usCasualty.providers', { lines: providerLines.join('\n') })
      : t('usCasualty.noProviders');
    refs.resultLabel.string = '';
    for (const lab of refs.dieLabels) this.setUsCasualtyDieFace(lab, '?', false);
    this.usCasualtyEventUI = {
      root: refs.root,
      stage: 'roll',
      t: 0,
      dieLabels: refs.dieLabels,
      dice,
      providerLabel: refs.providerLabel,
      resultLabel: refs.resultLabel,
      hits,
      limit,
    };
    return true;
  }

  private startTurnEndEventFlow(missionId: string) {
    if (!this.mission) return;
    const diceCount = turnEndDiceCountForMission(missionId);
    const primaryDice: number[] = [];
    for (let i = 0; i < diceCount; i++) primaryDice.push(this.rng.d6());
    const sum = primaryDice.reduce((a, b) => a + b, 0);
    const row = turnEndRowForSum(missionId, sum);
    if (!row) {
      console.warn(`[TurnEnd] no row for mission=${missionId} sum=${sum}`);
      this.endEnemyPhase();
      return;
    }
    const ctx = {
      mission: this.mission,
      rng: this.rng,
      nextEnemyId: () => {
        this.turnEndUnitSeq += 1;
        return `turnend_${this.turnEndUnitSeq}`;
      },
    };
    const prepared = prepareTurnEndEvent(row, primaryDice, sum, ctx);
    const extraPhases = prepared.extraDicePhases ?? [];
    const adjacentVolleys = prepared.adjacentInfantryVolleys ?? [];
    const effectName = t(turnEndListEffectKey(row.effectType, this.mission.data.theater));
    this.destroyTurnEndEventUI();
    const refs = this.buildTurnEndEventPanel(primaryDice, extraPhases.length > 0);
    for (const lab of refs.dieLabels) this.setDieLabelFace(lab, '?');
    refs.sumLabel.string = '';
    refs.bodyLabel.string = '';
    this.turnEndEventUI = {
      root: refs.root,
      stage: 'roll_primary',
      t: 0,
      dieLabels: refs.dieLabels,
      primaryDice,
      sumLabel: refs.sumLabel,
      bodyLabel: refs.bodyLabel,
      bodyKey: prepared.bodyKey,
      bodyParams: prepared.bodyParams,
      effectName,
      apply: prepared.apply,
      extraPhases,
      extraIdx: 0,
      extraSection: refs.extraSection,
      extraCaptionLabel: refs.extraCaptionLabel,
      extraDieLabels: refs.extraDieLabels,
      germanTruckMoveSegments: prepared.germanTruckMoveSegments,
      germanTruckDefeatAfterExitMove: prepared.germanTruckDefeatAfterExitMove,
      tankReinforceMove: prepared.tankReinforceMove,
      adjacentInfantryVolleys: adjacentVolleys.length > 0 ? adjacentVolleys : undefined,
    };
  }

  private buildTurnEndEventPanel(primaryDice: number[], hasExtraDice: boolean): {
    root: Node;
    dieLabels: Label[];
    sumLabel: Label;
    bodyLabel: Label;
    extraSection: Node | null;
    extraCaptionLabel: Label | null;
    extraDieLabels: Label[];
  } {
    const root = new Node('TurnEndEventPanel');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    root.setPosition(0, 0, 0);
    this.node.addChild(root);
    root.setSiblingIndex(this.node.children.length - 1);

    const mask = new Node('Mask');
    mask.layer = this.node.layer;
    mask.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    root.addChild(mask);
    const maskG = mask.addComponent(Graphics);
    maskG.fillColor = DICE_BACKDROP;
    maskG.rect(-CANVAS_W * 0.5, -CANVAS_H * 0.5, CANVAS_W, CANVAS_H);
    maskG.fill();
    mask.addComponent(BlockInputEvents);

    const panel = new Node('Panel');
    panel.layer = this.node.layer;
    root.addChild(panel);
    const pw = Math.min(720, CANVAS_W - 40);
    const ph = Math.min(420, CANVAS_H - 80);
    panel.addComponent(UITransform).setContentSize(pw, ph);
    const panelG = panel.addComponent(Graphics);
    drawDicePopupPanel(panelG, pw, ph, DICE_PANEL_BG, DICE_PANEL_BORDER);

    const title = new Node('Title');
    title.layer = this.node.layer;
    panel.addChild(title);
    const titleL = title.addComponent(Label);
    titleL.string = t('turnEnd.title');
    titleL.fontSize = 26;
    titleL.color = new Color(240, 240, 240, 255);
    title.setPosition(0, ph * 0.5 - 32);

    const dieWrap = new Node('DieWrap');
    dieWrap.layer = this.node.layer;
    panel.addChild(dieWrap);
    dieWrap.setPosition(0, ph * 0.5 - 98);
    const gap = 56;
    const startX = -((primaryDice.length - 1) * gap) * 0.5;
    const dieLabels: Label[] = [];
    for (let i = 0; i < primaryDice.length; i++) {
      dieLabels.push(this.makeDieSquare(dieWrap, startX + i * gap, 0, 48));
    }

    /** 正文区左右留白略大于面板边线，避免「贴边太满」；与主骰行同宽便于对齐 */
    const textBlockW = Math.min(560, pw - 96);
    const sumLabelN = new Node('SumLabel');
    sumLabelN.layer = this.node.layer;
    panel.addChild(sumLabelN);
    sumLabelN.addComponent(UITransform).setContentSize(textBlockW, 30);
    const sumL = sumLabelN.addComponent(Label);
    sumL.fontSize = 20;
    sumL.lineHeight = 24;
    sumL.color = new Color(200, 210, 220, 255);
    sumL.horizontalAlign = HorizontalTextAlignment.CENTER;
    sumL.verticalAlign = VerticalTextAlignment.CENTER;
    sumL.overflow = Label.Overflow.CLAMP;
    sumL.string = '';
    sumLabelN.setPosition(0, ph * 0.5 - 154);

    let extraSection: Node | null = null;
    let extraCaptionLabel: Label | null = null;
    const extraDieLabels: Label[] = [];
    const bodyTopY = hasExtraDice ? ph * 0.5 - 268 : ph * 0.5 - 176;
    if (hasExtraDice) {
      extraSection = new Node('ExtraSection');
      extraSection.layer = this.node.layer;
      panel.addChild(extraSection);
      extraSection.setPosition(0, ph * 0.5 - 206);
      extraSection.active = false;

      const capN = new Node('ExtraCaption');
      capN.layer = this.node.layer;
      extraSection.addChild(capN);
      capN.addComponent(UITransform).setContentSize(textBlockW, 26);
      extraCaptionLabel = capN.addComponent(Label);
      extraCaptionLabel.fontSize = 18;
      extraCaptionLabel.lineHeight = 22;
      extraCaptionLabel.color = new Color(190, 200, 215, 255);
      extraCaptionLabel.horizontalAlign = HorizontalTextAlignment.CENTER;
      extraCaptionLabel.verticalAlign = VerticalTextAlignment.CENTER;
      extraCaptionLabel.overflow = Label.Overflow.CLAMP;
      extraCaptionLabel.string = '';
      capN.setPosition(0, 18);

      const extraDieWrap = new Node('ExtraDieWrap');
      extraDieWrap.layer = this.node.layer;
      extraSection.addChild(extraDieWrap);
      extraDieWrap.setPosition(0, -16);
      const egap = 56;
      const estart = -egap * 0.5;
      extraDieLabels.push(this.makeDieSquare(extraDieWrap, estart, 0, 48));
      extraDieLabels.push(this.makeDieSquare(extraDieWrap, estart + egap, 0, 48));
    }

    const bodyN = new Node('BodyLabel');
    bodyN.layer = this.node.layer;
    panel.addChild(bodyN);
    const bodyUt = bodyN.addComponent(UITransform);
    bodyUt.setAnchorPoint(0.5, 1);
    bodyUt.setContentSize(textBlockW, 1);
    const bodyL = bodyN.addComponent(Label);
    bodyL.fontSize = 19;
    bodyL.lineHeight = 24;
    bodyL.color = new Color(220, 225, 230, 255);
    bodyL.overflow = Label.Overflow.RESIZE_HEIGHT;
    bodyL.horizontalAlign = HorizontalTextAlignment.LEFT;
    bodyL.verticalAlign = VerticalTextAlignment.TOP;
    bodyL.string = '';
    bodyN.setPosition(0, bodyTopY);

    const confirmB = this.makeBattleRectButton(
      panel,
      0,
      -ph * 0.5 + 52,
      200,
      44,
      BATTLE_BTN_ACCENT,
      () => this.onTurnEndConfirmClick(),
    );
    const confirmLab = this.makeBattleModalLabel(
      confirmB.node,
      t('turnEnd.confirm'),
      0,
      0,
      200,
      44,
      22,
      Color.WHITE,
    );
    this.mirrorBattleModalButtonLabel(confirmLab, () => this.onTurnEndConfirmClick());

    return {
      root,
      dieLabels,
      sumLabel: sumL,
      bodyLabel: bodyL,
      extraSection,
      extraCaptionLabel,
      extraDieLabels,
    };
  }

  /**
   * 回合结束「相邻步兵集火」：完整回合结束说明停顿后再逐发串联主炮同款 DiceShow，每段结束补浮字（与 tryEnemyAttack 一致），
   * 全部播完再显示回合结束正文与确认（此时再 applyAttack）。
   */
  private beginAdjacentInfantryDiceChain(idx: number) {
    const ui = this.turnEndEventUI;
    if (!ui || !this.mission) return;
    const volleys = ui.adjacentInfantryVolleys;
    if (!volleys || volleys.length === 0) return;

    ui.stage = 'hold';

    if (idx >= volleys.length) {
      ui.root.active = true;
      ui.bodyLabel.string = t(ui.bodyKey, ui.bodyParams);
      return;
    }

    if (idx === 0) {
      ui.root.active = false;
    }

    const v = volleys[idx];
    const actor = t('actor.enemyPrefix', { name: unitDisplayName(v.attackerKind) });
    const sh = this.mission.sherman;

    this.startDiceShow(
      v.report,
      actor,
      t('actor.sherman'),
      () => {
        this.presentAttackResult(actor, v.report, sh, sh);
        this.beginAdjacentInfantryDiceChain(idx + 1);
      },
      {
        mg: false,
        keepTurnEndPanel: true,
        attackSound: getUnitStats(v.attackerKind, this.mission.data.theater ?? 'europe').attackSound,
      },
    );
  }

  /** 进入当前 extraPhases[extraIdx] 的掷骰动画前：重置问号与可见骰数 */
  private setupTurnEndExtraRoll(ui: {
    extraPhases: TurnEndExtraDicePhase[];
    extraIdx: number;
    extraDieLabels: Label[];
    extraCaptionLabel: Label | null;
  }) {
    const phase = ui.extraPhases[ui.extraIdx];
    if (!phase) return;
    const n = phase.dice.length;
    for (let i = 0; i < ui.extraDieLabels.length; i++) {
      const lab = ui.extraDieLabels[i];
      if (!lab) continue;
      this.setDieLabelFace(lab, '?');
      const cont = lab.node.parent;
      if (cont) cont.active = i < n;
    }
    if (ui.extraCaptionLabel) {
      ui.extraCaptionLabel.string = t(phase.captionKey);
    }
  }

  private advanceTurnEndEventUI(dt: number) {
    const ui = this.turnEndEventUI;
    if (!ui || ui.stage === 'hold') return;
    const DUR = 0.55;
    const PAUSE_AFTER_PRIMARY = 0.2;
    const PAUSE_BEFORE_ADJACENT_DICE = 1.0;
    const PAUSE_AFTER_EXTRA = 0.35;

    if (ui.stage === 'roll_primary') {
      ui.t += dt;
      if (ui.t < DUR) {
        const tick = Math.floor(ui.t / 0.08) % 6;
        for (const lab of ui.dieLabels) this.setDieLabelFace(lab, (tick % 6) + 1);
        return;
      }
      for (let i = 0; i < ui.dieLabels.length; i++) {
        const lab = ui.dieLabels[i];
        if (lab) this.setDieLabelFace(lab, ui.primaryDice[i] ?? '?');
      }
      const s = ui.primaryDice.reduce((a, b) => a + b, 0);
      ui.sumLabel.string = t('turnEnd.sumLine', { sum: s, dice: ui.primaryDice.join('+') });
      ui.bodyLabel.string = '';
      const hasAdjacentDice = (ui.adjacentInfantryVolleys?.length ?? 0) > 0;
      if (!ui.extraPhases.length && !hasAdjacentDice) {
        ui.bodyLabel.string = t(ui.bodyKey, ui.bodyParams);
        ui.stage = 'hold';
        return;
      }
      // 相邻步兵集火：先完整展示回合结束表判定结果（正文），停顿后再逐发展示骰子动画
      if (hasAdjacentDice) {
        ui.bodyLabel.string = t(ui.bodyKey, ui.bodyParams);
        ui.stage = 'pause_before_adjacent_dice';
        ui.t = 0;
        return;
      }
      ui.stage = 'wait_after_primary';
      ui.t = 0;
      return;
    }

    if (ui.stage === 'pause_before_adjacent_dice') {
      ui.t += dt;
      if (ui.t < PAUSE_BEFORE_ADJACENT_DICE) return;
      if (ui.adjacentInfantryVolleys && ui.adjacentInfantryVolleys.length > 0) {
        this.beginAdjacentInfantryDiceChain(0);
      }
      return;
    }

    if (ui.stage === 'wait_after_primary') {
      ui.t += dt;
      if (ui.t < PAUSE_AFTER_PRIMARY) return;
      if (ui.extraSection) ui.extraSection.active = true;
      ui.extraIdx = 0;
      ui.stage = 'roll_extra';
      ui.t = 0;
      this.setupTurnEndExtraRoll(ui);
      return;
    }

    if (ui.stage === 'roll_extra') {
      ui.t += dt;
      const phase = ui.extraPhases[ui.extraIdx];
      if (!phase) {
        ui.bodyLabel.string = t(ui.bodyKey, ui.bodyParams);
        ui.stage = 'hold';
        return;
      }
      const n = phase.dice.length;
      if (ui.t < DUR) {
        const tick = Math.floor(ui.t / 0.08) % 6;
        for (let i = 0; i < n; i++) {
          const lab = ui.extraDieLabels[i];
          if (lab) this.setDieLabelFace(lab, (tick % 6) + 1);
        }
        return;
      }
      for (let i = 0; i < n; i++) {
        const lab = ui.extraDieLabels[i];
        if (lab) this.setDieLabelFace(lab, phase.dice[i] ?? '?');
      }
      ui.stage = 'wait_after_extra';
      ui.t = 0;
      return;
    }

    if (ui.stage === 'wait_after_extra') {
      ui.t += dt;
      if (ui.t < PAUSE_AFTER_EXTRA) return;
      ui.extraIdx += 1;
      if (ui.extraIdx < ui.extraPhases.length) {
        ui.stage = 'roll_extra';
        ui.t = 0;
        this.setupTurnEndExtraRoll(ui);
        return;
      }
      ui.bodyLabel.string = t(ui.bodyKey, ui.bodyParams);
      if (ui.extraCaptionLabel) ui.extraCaptionLabel.string = '';
      ui.stage = 'hold';
    }
  }

  private onTurnEndConfirmClick() {
    const ui = this.turnEndEventUI;
    if (!ui || ui.stage !== 'hold') return;
    const sum = ui.primaryDice.reduce((a, b) => a + b, 0);
    const applyFn = ui.apply;
    const truckSegments = ui.germanTruckMoveSegments;
    const tankReinforceMove = ui.tankReinforceMove;
    this.battleLog(
      `[回合结束] ${t('turnEnd.sumLine', { sum, dice: ui.primaryDice.join('+') })} → ${ui.effectName}`,
    );
    for (const ph of ui.extraPhases) {
      this.battleLog(`[回合结束] ${t(ph.captionKey)}: ${ph.dice.join('+')}`);
    }
    const body = ui.bodyLabel.string.trim();
    if (body) this.battleLog(`[回合结束] ${body}`);

    const destroyedSnap = this.snapshotDestroyedUnitIds();

    const truck =
      truckSegments && truckSegments.length > 0 && this.mission
        ? this.mission.enemies.find(e => e.kind === 'truck' && !e.destroyed)
        : undefined;

    if (truck && truckSegments && truckSegments.length > 0) {
      const defeatAfterExitMove = !!ui.germanTruckDefeatAfterExitMove;
      this.destroyTurnEndEventUI();
      this.pendingAfterAnimChain = () => {
        try {
          applyFn();
        } catch (e) {
          console.error('[TurnEnd] apply failed', e);
        }
        this.registerNewlyDestroyedSince(destroyedSnap);
        this.refreshStatusPanel();
        this.redraw();
        this.endEnemyPhase();
      };
      this.enqueueGermanTruckMoveAnims(truck, truckSegments, {
        markLastMoveTruckExitDefeat: defeatAfterExitMove,
      });
      return;
    }

    if (tankReinforceMove && this.mission) {
      this.destroyTurnEndEventUI();
      try {
        applyFn();
      } catch (e) {
        console.error('[TurnEnd] apply failed', e);
      }
      this.registerNewlyDestroyedSince(destroyedSnap);
      const unit = this.mission.enemies.find(e => e.id === tankReinforceMove.unitId);
      if (unit) {
        this.pendingAfterAnimChain = () => {
          this.refreshStatusPanel();
          this.redraw();
          this.endEnemyPhase();
        };
        this.enqueueTankReinforceMoveAnim(unit, tankReinforceMove);
        return;
      }
      this.refreshStatusPanel();
      this.redraw();
      this.endEnemyPhase();
      return;
    }

    try {
      applyFn();
    } catch (e) {
      console.error('[TurnEnd] apply failed', e);
    }
    this.registerNewlyDestroyedSince(destroyedSnap);
    this.destroyTurnEndEventUI();
    this.refreshStatusPanel();
    this.redraw();
    this.endEnemyPhase();
  }

  private enqueueTankReinforceMoveAnim(unit: Unit, move: TurnEndTankReinforceMove) {
    const dur = Math.max(0.05, this.moveDuration);
    unit.pos = { ...move.from };
    unit.facing = move.facing;
    this.animQueue = [];
    if (move.facing !== move.finalFacing) {
      this.animQueue.push({
        unit,
        kind: 'turn',
        fromQ: move.to.q,
        fromR: move.to.r,
        toQ: move.to.q,
        toR: move.to.r,
        t: 0,
        dur,
        turnFrom: move.facing,
        turnTo: move.finalFacing,
      });
    }
    this.anim = {
      unit,
      kind: 'move',
      fromQ: move.from.q,
      fromR: move.from.r,
      toQ: move.to.q,
      toR: move.to.r,
      t: 0,
      dur,
    };
    this.redraw();
  }

  /** 回合结束 german_truck_move：与敌方坦克相同的转向 / 平移片段与时序 */
  private enqueueGermanTruckMoveAnims(
    truck: Unit,
    segments: GermanTruckMoveSegment[],
    opts: { markLastMoveTruckExitDefeat?: boolean } = {},
  ) {
    const dur = Math.max(0.05, this.moveDuration);
    const queue: MoveAnim[] = [];
    for (const seg of segments) {
      if (seg.type === 'turn') {
        queue.push({
          unit: truck,
          kind: 'turn',
          fromQ: seg.at.q,
          fromR: seg.at.r,
          toQ: seg.at.q,
          toR: seg.at.r,
          t: 0,
          dur,
          turnFrom: seg.from,
          turnTo: seg.to,
        });
      } else {
        queue.push({
          unit: truck,
          kind: 'move',
          fromQ: seg.from.q,
          fromR: seg.from.r,
          toQ: seg.to.q,
          toR: seg.to.r,
          t: 0,
          dur,
        });
      }
    }
    if (opts.markLastMoveTruckExitDefeat) {
      for (let i = queue.length - 1; i >= 0; i--) {
        const m = queue[i];
        if (m && m.kind === 'move') {
          m.truckExitDefeat = true;
          break;
        }
      }
    }
    this.animQueue = queue;
    if (queue.length > 0) {
      this.anim = queue.shift()!;
      this.redraw();
    } else if (this.pendingAfterAnimChain) {
      const cb = this.pendingAfterAnimChain;
      this.pendingAfterAnimChain = null;
      cb();
    }
  }

  /**
   * 攻击结算后的统一展示：console 日志 + 目标格上方浮字 + 重绘 + 胜负判定。
   * 玩家与敌方都走这条路径，确保战报格式与 UI 反馈一致。
   *
   * 未命中 → "MISS"；命中未击穿 → "跳弹"；命中并击穿 → 按 §3.4 Step 3 伤害效果浮字
   * （击毁 / 起火 / 炮塔受损 / 痛痪 / 阵亡检定 / 受损）。
   */
  private presentAttackResult(actor: string, report: AttackReport, _attacker: Unit, target: Unit) {
    if (!this.mission) return;
    const actorParams: CombatLogParams = _attacker === this.mission.sherman && target !== this.mission.sherman
      ? { actorKey: 'actor.player' }
      : _attacker.faction !== 'allied'
        ? { actorNameKey: `unit.name.${_attacker.kind}` }
        : { actorText: actor };
    const baseParams: CombatLogParams = {
      ...actorParams,
      d1: report.dice[0],
      d2: report.dice[1],
      roll: report.roll,
      need: report.threshold,
      targetKind: target.kind,
    };
    let text: string;
    let color: Color;
    let size: number;
    if (!report.hit) {
      this.battleLogI18n('battleLog.combat.miss', baseParams);
      text = t('dice.panel.outcomeMiss'); color = new Color(230, 230, 230, 255); size = 32;
    } else {
      const armorParams: CombatLogParams = {
        ...baseParams,
        faceKey: `battleLog.armorFace.${report.armorFace}`,
        armor: report.armor ?? 0,
        pen: report.penetration ?? 0,
        penDie: report.penDie ?? 0,
        penDiceExpr: this.penDiceExpr(report),
        penNeed: report.penThreshold ?? 0,
      };
      if (!report.penetrated) {
        this.battleLogI18n('battleLog.combat.ricochet', armorParams);
        text = t('dice.panel.outcomeRic'); color = new Color(180, 200, 240, 255); size = 34;
      } else {
        const effect = report.damageEffect;
        const damageParams: CombatLogParams = {
          ...armorParams,
          dmgDie: report.damageDie ?? 0,
          effectKey: this.damageEffectLogKey(effect),
        };
        if (effect === 'crewCheck' && report.crewCheck) {
          const cc = report.crewCheck;
          this.battleLogI18n('battleLog.combat.damage', damageParams);
          const out = crewOutcomeLabel(cc);
          text = out.text;
          color = out.color;
          size = cc.slot === null ? 36 : 44;
        } else if (effect === 'destroyed' && report.damageDie === undefined) {
          this.battleLogI18n('battleLog.combat.directDestroy', damageParams);
          const out = damageOutcomeLabel(effect);
          text = out.text;
          color = out.color;
          size = 50;
        } else {
          this.battleLogI18n('battleLog.combat.damage', damageParams);
          const out = damageOutcomeLabel(effect);
          text = out.text;
          color = out.color;
          // 摧毁用最大号字，其余中号；受损系列视觉权重稍低
          size = effect === 'destroyed' ? 50 : effect === 'damaged' ? 38 : 42;
        }
      }
    }
    if (report.hit && report.commanderKilledByHitDoubles) {
      this.battleLogI18n('battleLog.combat.hitDoublesCommanderKia', baseParams);
    }
    this.spawnFloater(target.pos.q, target.pos.r, text, color, { size });
    this.redraw();

    this.outcome = checkOutcome(this.mission);
    if (this.outcome !== 'ongoing') {
      this.updateOutcomeOverlay();
    }
  }

  private damageEffectLogKey(effect: DamageEffect | undefined): string {
    switch (effect) {
      case 'destroyed': return 'dmg.outcome.destroyed';
      case 'damaged': return 'dmg.outcome.damaged';
      case 'fire': return 'dmg.outcome.fire';
      case 'turret': return 'dmg.outcome.turret';
      case 'paralyzed': return 'dmg.outcome.paralyzed';
      case 'crewCheck': return 'dmg.outcome.crewCheck';
      default: return 'battleLog.unknown';
    }
  }

  private penDiceExpr(report: AttackReport): string {
    const dice = report.penDice;
    if (dice && dice.length > 1) return `${dice.join('+')}=${report.penDie ?? dice.reduce((a, b) => a + b, 0)}`;
    return `${report.penDie ?? dice?.[0] ?? 0}`;
  }

  private mgDiceExpr(report: { dice: [number, number]; hitDiceCount?: number; hitBonus?: number; roll: number }): string {
    if ((report.hitDiceCount ?? 2) <= 1) {
      const die = report.dice[0] > 0 ? String(report.dice[0]) : '-';
      const bonus = report.hitBonus ? `+${report.hitBonus}` : '';
      return `${die}${bonus}=${report.roll}`;
    }
    return `${report.dice[0]}+${report.dice[1]}=${report.roll}`;
  }

  /**
   * 与主菜单 `MainMenuScene.buildBackground` 相同：双段竖直渐变 + 顶/底装饰线。
   * 须最先 `addChild`，叠在摄像机清屏色之上、六角地图与 HUD 之下。
   */
  private buildMainMenuStyleBattleBackground() {
    const n = new Node('BattleMenuStyleBG');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(CANVAS_W, CANVAS_H);
    n.setPosition(0, 0, 0);
    const g = n.addComponent(Graphics);
    const STEPS = 24;
    for (let i = 0; i < STEPS; i++) {
      const tRatio = i / (STEPS - 1);
      const c = tRatio < 0.5
        ? lerpColorMainMenuStyle(MAIN_MENU_STYLE_BG_TOP, MAIN_MENU_STYLE_BG_MID, tRatio * 2)
        : lerpColorMainMenuStyle(MAIN_MENU_STYLE_BG_MID, MAIN_MENU_STYLE_BG_BOTTOM, (tRatio - 0.5) * 2);
      const y = CANVAS_H / 2 - (i + 1) * (CANVAS_H / STEPS);
      g.fillColor = c;
      g.rect(-CANVAS_W / 2, y, CANVAS_W, CANVAS_H / STEPS + 1);
      g.fill();
    }
    g.strokeColor = MAIN_MENU_STYLE_DIVIDER;
    g.lineWidth = 1;
    g.moveTo(-CANVAS_W / 2 + 60, CANVAS_H / 2 - 80);
    g.lineTo(CANVAS_W / 2 - 60, CANVAS_H / 2 - 80);
    g.stroke();
    g.moveTo(-CANVAS_W / 2 + 60, -CANVAS_H / 2 + 60);
    g.lineTo(CANVAS_W / 2 - 60, -CANVAS_H / 2 + 60);
    g.stroke();
    this.node.addChild(n);
  }
}

function lerpColorMainMenuStyle(a: Color, b: Color, tRatio: number): Color {
  const k = Math.max(0, Math.min(1, tRatio));
  return new Color(
    Math.round(a.r + (b.r - a.r) * k),
    Math.round(a.g + (b.g - a.g) * k),
    Math.round(a.b + (b.b - a.b) * k),
    Math.round(a.a + (b.a - a.a) * k),
  );
}
