/**
 * BattleScene —— 把 mission_01.json 渲染为六角格地图，支持骰子驱动的"移动阶段 /
 * 攻击阶段"双子阶段、敌方贪心 AI 与存读档。
 *
 * 玩法（按说明书 3.6 行动表拆分为两个独立阶段）：
 *   - 回合开始时底部弹出阶段选择条："移动阶段 / 攻击阶段"，两个子阶段可任意顺序进入
 *   - 进入某阶段时，按谢尔曼当前格地形 + 舱盖状态摇 3~5 颗骰子，落在屏幕底部骰子托盘
 *     - 移动阶段：1=无 / 2=启动（未实装，可跳过）/ 3,4=转向 60° / 5,6=前进或后退 1 格
 *     - 攻击阶段：1,2=装填 / 3,4=机枪（暂无步兵，置灰）/ 5,6=主炮射击（需已装填）
 *   - 点击骰子弹出动作菜单，选择具体执行方式（↻顺时针 / ↺逆时针 / ▲前进 / ▼后退…）
 *   - 前进 / 后退沿谢尔曼当前朝向 ±1 格移动；若目标格地形或敌方占据无法进入，
 *     该次移动无效、骰子不消耗、只弹警告浮字
 *   - 主炮骰点击进入"选择目标"态；点击视线内敌人 → 掷骰结算并消耗骰，之后 loaded 归 false
 *   - 右下角按钮："下一阶段"（移动/攻击子阶段内用于结束该阶段回到选择条；A+B 完成后变红
 *     「结束回合」进入敌方阶段）。杂项阶段在骰子用尽或手动结束阶段后，直接进入敌方阶段，
 *     无需再在「结束回合」上多点一次。
 *   - 敌方阶段：UI 固定区展示该敌坦本回合全部 AI 骰并按序执行；移动 / 转向约 0.5s 过程动画，
 *     谢尔曼移动与转向同样播放过程动画
 *   - 摧毁任务目标单位 → 屏幕中央"胜利！"；谢尔曼被摧毁 → "战败"
 *   - 胜负出现后下方"再来一局"按钮可点击重置整局，使用同一份任务 JSON
 *   - 右上 ⚙ 战斗设置：音量 / 语言 / 存档读档 / 退出关卡（退出二次确认：保存后退出 / 放弃关卡）
 *
 * 用法：
 *   1. 打开任意场景（如 changjing2.scene）
 *   2. 在 Canvas 下新建一个空 Node（命名随意，如 "battle"）
 *   3. 把本脚本拖到该 Node 上
 *   4. 预览即可看到地图与 HUD
 *
 * Inspector 可调：hexSize / missionPath / showReachable / moveDuration /
 *                 movesPerTurn（仅敌方 AI 用） / rngSeed
 */

import {
  _decorator,
  Color,
  Component,
  EventTouch,
  Graphics,
  HorizontalTextAlignment,
  JsonAsset,
  Label,
  Node,
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
  axialToPixel,
  approximateDirection,
  directionTo,
  neighbor,
  rotateDirection,
} from '../core/HexGrid';
import {
  actionDicePool,
  classifyAttackDie,
  classifyMiscDie,
  classifyMoveDie,
  rollActionDice,
} from '../core/ActionDice';
import { applyAttack, applyMGAttack, AttackReport, canAttack, canMGAttack, CrewDeathResult, DamageEffect, hitThreshold, resolveDamageEffect, rollAttack, rollMGAttack } from '../core/Combat';
import { RNG } from '../core/Dice';
import { t, setLang, getLang, LangCode } from '../core/Lang';
import {
  actionFor,
  AI_DICE_COUNT,
  aiColumnFor,
  AIActionEntry,
  AIColumn,
  canExecuteAction,
  DEFAULT_AI_TABLE,
  decideEnemyTurn,
  EnemyAction,
  rollAIDice,
  selectEnemyOrder,
} from '../core/EnemyAI';
import { loadMission, LoadedMission } from '../core/MissionLoader';
import { checkOutcome, MissionOutcome } from '../core/Objective';
import { applySave, captureSave, SAVE_KEY, SaveData, SavePlayerStep } from '../core/SaveLoad';
import { GameSession } from '../core/GameSession';
import { findLevelByMissionId, MenuProgress } from '../core/LevelDB';
import { Direction, MissionData, TerrainType, Tile, Unit, UnitKind } from '../core/types';

const { ccclass, property } = _decorator;

/** 使用俯视 PNG 的德军单位（与谢尔曼同一套 normalizeTankSprites 白边处理） */
type EnemyTopKind = Extract<UnitKind, 'panzer4' | 'panzer3' | 'tiger' | 'truck'>;

function isEnemyTopKind(k: UnitKind): k is EnemyTopKind {
  return k === 'panzer4' || k === 'panzer3' || k === 'tiger' || k === 'truck';
}

/** 三阶缓出：起步快、收尾慢，最适合"惯性滑停"的坦克移动 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** 三阶缓入缓出：排序位移动画用 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 敌方 AI 骰子迷你托盘：相对原 28px 约 +100% */
const ENEMY_AI_DIE_SIZE = 56;
const ENEMY_AI_DIE_GAP = 12;
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
      case 'none':    return '无';
    }
  };
  return entry.fallback && entry.fallback !== 'none'
    ? `${name(entry.primary)}>${name(entry.fallback)}`
    : name(entry.primary);
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
}

type Phase = 'player' | 'enemy';

/**
 * 玩家回合内的细分状态机：
 *   - 'choose'     : 等待玩家选择进入"移动阶段 / 攻击阶段 / 杂项阶段"
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
  faceLabel: Label;     // 大号点数
  hintLabel: Label;     // 下方动作提示（"转向 / 驾驶 / 主炮 / 装填 / —"）
}

/**
 * 攻击掷骰展示面板的状态机（§3.4 三段式）：
 *   - hit-roll : 2d6 骰子面在飞速循环
 *   - hit-show : 锁定 2d6 真值并显示"命中 / 未命中"
 *   - pen-roll : （仅命中时进入）1d6 穿甲骰在飞速循环
 *   - pen-show : 锁定 1d6 并显示"击穿 / 跳弹"
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
  onDone: () => void;        // 动画结束回调：真正 applyAttack + 浮字 + 继续调度
  finalized: boolean;        // 保险位，避免 onDone 被回调多次
  // 视觉
  panelRoot: Node;
  hitDieLabels: Label[];     // 2 颗命中骰
  hitSumLabel: Label;        // "= N"
  hitNeedLabel: Label;       // "需≥N"
  hitVerdictLabel: Label;    // "命中！" / "未命中"
  penDieLabel: Label | null; // 1 颗穿甲骰（只在 hit 时非空）
  penNeedLabel: Label | null;
  penVerdictLabel: Label | null;
  dmgDieLabel: Label | null; // 1 颗伤害骰（仅 penetrated 时展示）
  dmgTitleLabel: Label | null;  // "伤害检定" 标题
  dmgEffectLabel: Label | null; // "起火 / 炮塔受损 / 痛痪 / 阵亡检定 / 摧毁 / 受损"
  crewDieLabel: Label | null;    // 1 颗阵亡检定骰（仅 damageEffect==='crewCheck' 时存在）
  crewTitleLabel: Label | null;  // "阵亡检定" 标题
  crewEffectLabel: Label | null; // "驾驶员阵亡 / 虚惊 / …"
  outcomeLabel: Label;       // 底部大字：起火 / 击毁 / 跳弹 / MISS / 炮塔 / 痛痪 / 乘员阵亡
}

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
const TERRAIN_COLORS: Record<TerrainType, Color> = {
  road:     new Color(190, 175, 145, 255),
  field:    new Color(196, 220, 130, 255),
  mud:      new Color(140, 110,  80, 255),
  forest:   new Color( 58, 112,  50, 255), // 稍压暗，树冠叠上去后更像林间地面
  water:    new Color( 90, 145, 200, 255),
};
/** 林地表冠层（多圆+阴影示意俯视树丛，Y 轴向上） */
const FOREST_TREE_DARK  = new Color( 28,  88,  30, 255);
const FOREST_TREE_MID   = new Color( 45, 118,  42, 255);
const FOREST_TREE_LIGHT = new Color( 70, 148,  58, 255);
const FOREST_SHADE      = new Color(  0,   0,   0,  50);
/** 格心建筑图案（不改变六角格基底填色，仅叠加绘制） */
const BUILDING_ROOF_FILL  = new Color( 95,  78,  62, 255);
const BUILDING_WALL_FILL  = new Color(160, 145, 125, 255);
const BUILDING_OUTLINE    = new Color( 45,  38,  32, 255);
const BUILDING_DOOR_STROKE= new Color( 55,  48,  42, 255);

const FACTION_COLORS = {
  allied: new Color( 60, 160,  80, 255),
  german: new Color( 60,  60,  60, 255),
};

/** 树篱上离散「灌木丛」：比林地略深、略灰，与 FOREST_* 区分 */
const HEDGE_SHADE       = new Color(22, 38, 24, 185);
const HEDGE_BUSH_DARK  = new Color(36, 78, 38, 255);
const HEDGE_BUSH_MID   = new Color(48, 98, 46, 255);
const HEDGE_BUSH_LIGHT = new Color(62, 118, 56, 255);
const TILE_BORDER        = new Color( 40,  40,  40, 220);
const FACING_COLOR       = new Color(255, 210,  60, 255);
const UNIT_BORDER        = new Color(255, 255, 255, 255);
// HUD 配色：两阶段都执行过后按钮换成"提醒色"，引导玩家结束回合
const BTN_BG_NORMAL  = new Color( 60,  90, 140, 230);
const BTN_BG_URGENT  = new Color(190,  80,  60, 240);
const BTN_BORDER     = new Color(255, 255, 255, 255);
const HUD_TEXT_COLOR = new Color(255, 255, 255, 255);
/** 右上角 ⚙ 与 `buildStatusPanel` 竖向对齐（改一处须同步） */
const BATTLE_SETTINGS_CX = 580;
const BATTLE_SETTINGS_CY = 318;
const BATTLE_SETTINGS_R = 24;

// 战斗内设置 / 退出确认模态（与主菜单风格一致）
const CANVAS_W = 1280;
const CANVAS_H = 720;
const MODAL_BACKDROP     = new Color(  0,   0,   0, 180);
const MODAL_PANEL_BG     = new Color( 34,  40,  54, 240);
const MODAL_PANEL_BORDER = new Color(180, 180, 180, 220);
const MODAL_CLOSE_BG     = new Color(180,  60,  60, 240);
const SETTINGS_ICON_BG   = new Color( 40,  50,  60, 220);
const SETTINGS_ICON_BD   = new Color(200, 200, 200, 180);
const SLIDER_TRACK       = new Color( 70,  80,  90, 255);
const SLIDER_FILL        = new Color(170, 110,  50, 255);
const SLIDER_THUMB       = new Color(240, 215, 150, 255);
const LANG_BTN_IDLE      = new Color( 60,  70,  80, 230);
const LANG_BTN_ACTIVE    = new Color(170, 110,  50, 240);
const LANG_BTN_ACTIVE_BD = new Color(240, 215, 150, 255);
const BTN_EXIT_WARN      = new Color(160,  70,  70, 230);
const BATTLE_BTN_ACCENT  = new Color(170, 110,  50, 240);
const BATTLE_MODAL_DIVIDER = new Color(120, 150, 120, 200);
const BATTLE_MODAL_TEXT_OUTLINE = new Color(0, 0, 0, 220);
const BATTLE_MODAL_LEVEL_BORDER = new Color(200, 200, 200, 220);

// 阶段选择条配色：三个按钮（移动=绿 / 攻击=红 / 杂项=紫）；已执行过的阶段被灰掉禁用
const PHASE_BTN_MOVE      = new Color( 60, 130,  80, 230);
const PHASE_BTN_ATTACK    = new Color(160,  70,  70, 230);
const PHASE_BTN_MISC      = new Color(110,  80, 160, 230);
const PHASE_BTN_DISABLED  = new Color( 80,  80,  80, 200);

// 骰子配色：底色白/灰（已用）+ 边框；分类颜色直接在动作提示文字上体现
const DIE_FACE_FILL      = new Color(240, 240, 230, 255);
const DIE_FACE_USED_FILL = new Color(120, 120, 120, 230);
const DIE_FACE_BORDER    = new Color( 30,  30,  30, 255);
const DIE_FACE_SELECTED  = new Color(250, 215,  90, 255); // 当前选中的主炮骰高亮边框
const DIE_FACE_TEXT      = new Color( 20,  20,  20, 255);
const DIE_FACE_TEXT_USED = new Color( 60,  60,  60, 200);
// 动作提示配色：转向/驾驶 = 绿系；装填/主炮 = 红系；机枪/无 = 灰
const DIE_HINT_GREEN = new Color( 70, 180,  70, 255);
const DIE_HINT_RED   = new Color(220, 100,  80, 255);
const DIE_HINT_GREY  = new Color(130, 130, 130, 255);

// 驾驶候选格高亮：前进 = 亮绿，后退 = 琥珀（让玩家一眼区分两个方向）
const DRIVE_FWD_COLOR = new Color(120, 230, 120, 255);
const DRIVE_BWD_COLOR = new Color(240, 190,  80, 255);
const DRIVE_BLOCKED   = new Color(200,  80,  80, 200);

// 掷骰展示面板配色
const DICE_BACKDROP    = new Color(  0,   0,   0, 160);
const DICE_PANEL_BG    = new Color( 34,  40,  54, 240);
const DICE_PANEL_BORDER= new Color(230, 230, 230, 255);
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
const STATUS_PANEL_BG     = new Color( 28,  34,  48, 220);
const STATUS_PANEL_BORDER = new Color(220, 220, 220, 220);
const STATUS_TITLE_COLOR  = new Color(255, 230, 120, 255);
const STATUS_LABEL_COLOR  = new Color(200, 200, 200, 255);
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
// 持久化状态文字（仅「已毁」；起火等改由格子下矢量状态图标）
const STATUS_TEXT_DEAD = new Color(220,  60,  60, 255);
const STATUS_TEXT_OUT  = new Color(  0,   0,   0, 220);

/** 坦克格子下方状态图标（顺序：受损→烟雾→隐蔽→着火→瘫痪→炮塔） */
type TankStatusBadgeKind = 'damaged' | 'smoke' | 'hidden' | 'fire' | 'paralyzed' | 'turret';

const TANK_BADGE_CELL = 17;
const TANK_BADGE_GAP = 4;
const BADGE_BG = new Color(18, 20, 26, 235);
const BADGE_FRAME = new Color(0, 0, 0, 220);
// 单位名字标签：常驻显示在每个棋子正下方，方便玩家一眼识别兵种
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
  hexSize: number = 39;

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
  private mapNode: Node | null = null;
  private shermanSpriteNode: Node | null = null;
  private shermanTopSprite: Sprite | null = null;
  private shermanTopSpriteFrame: SpriteFrame | null = null;
  /** 加载时锁定的裁切显示宽高；避免每帧 `sprite.spriteFrame = sf` 后引擎改写 sf.width/height 导致宽高比崩（日志里 movement 阶段 th 被拉成与 tw 相等）。 */
  private shermanSpriteDisplayW = 0;
  private shermanSpriteDisplayH = 0;
  /** 德军俯视图（四号/三号/虎/卡）：多单位共用节点池；每帧 redraw 开头清零再按绘制顺序占用 */
  private enemyTopMeta: Partial<Record<EnemyTopKind, { sf: SpriteFrame; dw: number; dh: number }>> = {};
  private enemyTopSpritePool: Array<{ node: Node; sprite: Sprite }> = [];
  private enemyTopPoolNext = 0;
  private static readonly ENEMY_TOP_SPRITE_POOL = 16;
  private mission: LoadedMission | null = null;
  private offsetX = 0;
  private offsetY = 0;
  private anim: MoveAnim | null = null;

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
  // 命中预览 Label 池：常驻显示，随 redraw 整批重建
  private previewLabels: Node[] = [];
  // 单位状态文字池（仅已毁短标签）：随 redraw 整批重建
  private statusLabels: Node[] = [];
  /** 坦克状态图标条（矢量），在格心下方横向排列 */
  private statusBadgeNodes: Node[] = [];
  // 单位名字文字池（"谢尔曼" / "虎式" 等）：常驻显示，随 redraw 整批重建
  private nameLabels: Node[] = [];

  // HUD
  private hudLabel: Label | null = null;
  private endTurnBtn: Node | null = null;
  private endTurnBg: Graphics | null = null;
  private endTurnLabel: Label | null = null;
  /** 底部"阶段选择"条的三个按钮；在 choose 子步骤可见，其他子步骤隐藏 */
  private chooseBar: Node | null = null;
  private chooseMoveBtn: Node | null = null;
  private chooseAttackBtn: Node | null = null;
  private chooseMiscBtn: Node | null = null;
  /** 底部骰子托盘：movement/attack 子步骤时显示 */
  private diceTrayRoot: Node | null = null;
  private diceVisuals: DieVisual[] = [];
  private diceTitleLabel: Label | null = null;
  /** 点击某颗骰子时弹出的动作菜单；每次弹出都重建 */
  private diePopover: Node | null = null;
  /** 攻击掷骰动画面板；非 null 时锁定所有输入 */
  private diceShow: DiceShow | null = null;

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
  private chooseMiscLabel: Label | null = null;
  /** 胜负界「再来一局 / 返回主菜单」子 Label */
  private restartBtnLabel: Label | null = null;
  private backToMenuBtnLabel: Label | null = null;

  // 存档/读档
  private missionId: string = '';

  /** 战斗内模态（设置）；退出确认单独一层叠在上面 */
  private battleModalRoot: Node | null = null;
  private battleExitModalRoot: Node | null = null;
  /** 存读档飘字：叠在所有模态之上，短显后自毁 */
  private battleSettingsToastRoot: Node | null = null;
  private battleSettingsRefs: {
    volumeFill: Graphics | null;
    volumeThumb: Node | null;
    volumeLabel: Label | null;
    langZhBtn: BattleRectButtonRefs | null;
    langEnBtn: BattleRectButtonRefs | null;
  } | null = null;

  onLoad() {
    setLang(MenuProgress.load().lang);
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

    const enemyTopPaths: Record<EnemyTopKind, string> = {
      panzer4: 'textures/units/panzer4_top/spriteFrame',
      panzer3: 'textures/units/panzer3_top/spriteFrame',
      tiger: 'textures/units/tiger_top/spriteFrame',
      truck: 'textures/units/truck_top/spriteFrame',
    };
    (['panzer4', 'panzer3', 'tiger', 'truck'] as const).forEach((kind) => {
      resources.load(enemyTopPaths[kind], SpriteFrame, (err, sf) => {
        if (err || !sf) {
          console.warn(`[BattleScene] 俯视图加载失败 (${kind})，该类型将回退矢量车体:`, err);
          return;
        }
        const rw = sf.rect.width;
        const rh = sf.rect.height;
        this.enemyTopMeta[kind] = {
          sf,
          dw: rw > 0 ? rw : sf.width,
          dh: rh > 0 ? rh : sf.height,
        };
        this.redraw();
      });
    });

    // 3.x 动态加载 SpriteFrame 必须指向图片子资源路径 …/spriteFrame（见官方「动态加载资源」）
    resources.load('textures/units/sherman_top/spriteFrame', SpriteFrame, (err, sf) => {
      if (err || !sf) {
        console.warn('[BattleScene] 谢尔曼俯视图加载失败，使用矢量车体:', err);
        return;
      }
      const rw = sf.rect.width;
      const rh = sf.rect.height;
      this.shermanSpriteDisplayW = rw > 0 ? rw : sf.width;
      this.shermanSpriteDisplayH = rh > 0 ? rh : sf.height;
      this.shermanTopSpriteFrame = sf;
      if (this.shermanTopSprite) this.shermanTopSprite.spriteFrame = sf;
      this.redraw();
    });

    // 注册触摸事件（点击地图任意位置）
    gNode.on(Node.EventType.TOUCH_END, this.onTouchMap, this);

    // HUD：回合数 + 阶段信息 + 下一阶段按钮
    this.buildHUD();
    // 底部阶段选择条 + 骰子托盘（空的，交给 refreshPhaseUI 根据状态切换可见性）
    this.buildChooseBar();
    this.buildDiceTray();

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
    this.mission = loadMission(data);
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
    this.offsetY = (minY + maxY) / 2;

    // 初始化回合状态
    this.turn = 1;
    this.phase = 'player';
    this.playerStep = 'choose';
    this.movementDone = false;
    this.attackDone = false;
    this.miscDone = false;
    this.phaseDice = [];
    this.clearGunSelection();
    this.outcome = 'ongoing';
    this.rng = new RNG(this.rngSeed || undefined);
    this.clearFloaters();
    this.closeDiePopover();
    this.finalizeDiceShow(true);
    this.refreshPhaseUI();
    this.updateHUD();
    this.updateOutcomeOverlay();

    this.redraw();
    console.log(
      `[BattleScene] 任务加载成功: ${data.name}, ${tiles.length} 格, ` +
      `1 + ${this.mission.enemies.length} 个单位`
    );
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
    this.enemyTopPoolNext = 0;
    for (const { node } of this.enemyTopSpritePool) node.active = false;
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
    for (const t of tiles) {
      const c = this.project(t.pos.q, t.pos.r);
      this.drawHexFill(c.x, c.y, this.hexSize, TERRAIN_COLORS[t.terrain]);
    }
    g.lineWidth = 2;
    g.strokeColor = TILE_BORDER;
    for (const t of tiles) {
      const c = this.project(t.pos.q, t.pos.r);
      this.drawHexStroke(c.x, c.y, this.hexSize);
    }

    // 1a. 林地表冠层：示意树木（在基底之上、建筑/树篱之前）
    for (const t of tiles) {
      if (t.terrain !== 'forest') continue;
      const c = this.project(t.pos.q, t.pos.r);
      this.drawForestCanopy(c.x, c.y, this.hexSize, t);
    }

    // 1b. 建筑图案（不改变基底地形色，仅格心矢量房屋）
    for (const t of tiles) {
      if (!t.hasBuilding) continue;
      const c = this.project(t.pos.q, t.pos.r);
      this.drawBuildingOverlay(c.x, c.y, this.hexSize);
    }

    // 2. 树篱
    for (const t of tiles) {
      if (!t.hedges) continue;
      const c = this.project(t.pos.q, t.pos.r);
      for (let i = 0; i < 6; i++) {
        if (t.hedges[i]) this.drawHedgeEdge(c.x, c.y, this.hexSize, i, t.pos.q, t.pos.r);
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
    // 4b. 机枪目标高亮：选中机枪骰时，把 *相邻步兵* 圈出来
    if (!this.anim && this.phase === 'player'
        && (this.playerStep === 'attack' || this.playerStep === 'misc')
        && this.selectedMGDieIdx >= 0
        && this.outcome === 'ongoing') {
      this.drawMGTargetHighlights();
    }

    // 4c. 谢尔曼出生格入场箭头（固定画在 JSON 出生格，谢尔曼离开后仍保留；在机体之下绘制）
    this.drawShermanSpawnEntryArrow();

    // 5. 单位 —— 正在动画的那个用插值像素坐标，其余用本格坐标
    this.drawUnitMaybeAnim(sherman);
    for (const e of enemies) this.drawUnitMaybeAnim(e);

    // 6. 单位状态：已毁短标签 + 坦克矢量状态图标条
    this.clearStatusLabels();
    this.spawnStatusLabelIfAny(sherman);
    for (const e of enemies) this.spawnStatusLabelIfAny(e);
    this.clearStatusBadges();
    this.spawnStatusBadgesIfAny(sherman);
    for (const e of enemies) this.spawnStatusBadgesIfAny(e);

    // 7. 单位名字常驻文字（"谢尔曼" / "虎式" …），整批重建
    this.clearNameLabels();
    this.spawnUnitNameLabel(sherman);
    for (const e of enemies) this.spawnUnitNameLabel(e);
  }

  private drawAttackableHighlights() {
    if (!this.g || !this.mission) return;
    const { map, sherman, enemies } = this.mission;
    for (const e of enemies) {
      if (e.destroyed) continue;
      // 主炮不瞄步兵：步兵专属机枪（§3.1.2 / §3.6），避免大红圈误导
      if (e.kind === 'infantry') continue;
      const ctx = { attacker: sherman, target: e, map };
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
   * 仅把 *相邻* 且 *未被摧毁* 的步兵圈出来，并在格上方标"≥7  58%"（2d6≥7 固定概率 21/36 = 58%）。
   */
  private drawMGTargetHighlights() {
    if (!this.g || !this.mission) return;
    const { map, sherman, enemies } = this.mission;
    for (const e of enemies) {
      if (e.destroyed) continue;
      const ctx = { attacker: sherman, target: e, map };
      if (!canMGAttack(ctx).ok) continue;

      const c = this.project(e.pos.q, e.pos.r);
      this.g.strokeColor = ATTACKABLE_COLOR;
      this.g.lineWidth = 3;
      this.drawHexOutline(c.x, c.y, this.hexSize - 3);
      // 2d6 ≥ 7 恒定概率，直接复用现有 preview label（need=7）
      this.spawnPreviewLabel(c.x, c.y - this.hexSize * 0.7, 7);
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

  /** 命中概率分档配色：成功率越高越绿，越低越红 */
  private previewColor(prob: number): Color {
    if (prob >= 0.7)  return PREVIEW_COLOR_GREAT;
    if (prob >= 0.4)  return PREVIEW_COLOR_GOOD;
    if (prob >= 0.2)  return PREVIEW_COLOR_FAIR;
    return PREVIEW_COLOR_BAD;
  }

  /** 在地图上某像素点生成一条"≥N\n##%"的命中预览 Label。 */
  private spawnPreviewLabel(x: number, y: number, need: number) {
    if (!this.mapNode) return;
    const idx = Math.max(0, Math.min(13, need));
    const prob = HIT_PROB_GE[idx];
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
   * 判定单位的"起火外观"是否应当点亮：
   *   - 谢尔曼：看 fireLevel > 0（0 = 已灭 / 从未起火，回归常色）
   *   - 其他（敌坦）：沿用 MVP 语义 —— damaged=true 即等价于"起火中（下次击穿摧毁）"
   *
   * 这样 §3.5 的"灭火行动 (杂项 6 点) -1"在 fireLevel 降到 0 时，
   * 谢尔曼的橙圆 + 外火苗环会自动退回普通阵营色。
   */
  private isOnFire(u: Unit): boolean {
    if (u.kind === 'sherman') return (u.fireLevel ?? 0) > 0;
    return !!u.damaged;
  }

  /** 给已毁单位在格子下方挂「已毁」短文字；起火与其它状态由状态图标条表示。 */
  private spawnStatusLabelIfAny(u: Unit) {
    if (!this.mapNode) return;
    if (!u.destroyed) return;
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
   * 收集当前应显示的坦克状态图标（固定顺序；德坦 damaged 与起火同义时只显示「着火」避免重复）。
   * 谢尔曼：仅 `damaged`（乘员检定/阵亡等）不再出「受损」标——乘员状态由右侧状态栏负责。
   */
  private collectTankStatusBadgeKinds(u: Unit): TankStatusBadgeKind[] {
    if (u.kind === 'infantry' || u.destroyed) return [];
    const out: TankStatusBadgeKind[] = [];
    if (u.kind === 'sherman') {
      if (u.damaged && (this.isOnFire(u) || !!u.turretDamaged || !!u.paralyzed)) {
        out.push('damaged');
      }
    } else if (u.damaged && !this.isOnFire(u)) {
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
   * 状态图标在格心下约 hex*0.56；已毁短标签约 hex*0.65；名字更靠下避免遮挡。
   */
  private spawnUnitNameLabel(u: Unit) {
    if (!this.mapNode) return;
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
      : (u.faction === 'allied' ? UNIT_NAME_TEXT_ALLIED : UNIT_NAME_TEXT_GERMAN);
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.string = t(`unit.name.${u.kind}`);
    l.enableOutline = true;
    l.outlineColor = UNIT_NAME_OUTLINE;
    l.outlineWidth = 2;

    this.mapNode.addChild(n);
    // 叠放：车体 → 状态图标条(hex*0.56) → 已毁字(hex*0.65) → 名字
    n.setPosition(c.x, c.y - this.hexSize * 1.3, 0);
    this.nameLabels.push(n);
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

    // 攻击掷骰动画：最高优先级推进（在 anim 之前，避免被 return 提前打断）
    if (this.diceShow) this.advanceDiceShow(dt);

    // 敌方 AI 骰：掷完后的槽位排序动画（约 1s），播完再开始按序执行各骰
    if (this.enemyDiceSortAnim && this.mission && this.enemyDiceTrayRoot) {
      const s = this.enemyDiceSortAnim;
      s.t += dt;
      const p = Math.min(1, s.t / s.dur);
      this.applyEnemyDiceSortLayout(easeInOutCubic(p));
      if (p >= 1) {
        this.applyEnemyDiceSortLayout(1);
        this.enemyDiceSortAnim = null;
        this.runNextEnemyStep();
      }
      this.redraw();
      return;
    }

    if (!this.anim || !this.mission) return;
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
      console.log(
        `[BattleScene] ${finishedUnit.kind} 到达 (q=${finishedUnit.pos.q}, r=${finishedUnit.pos.r})`,
      );
    } else {
      finishedUnit.facing = anim.turnTo!;
      console.log(
        `[BattleScene] ${finishedUnit.kind} 转向完成 facing=${finishedUnit.facing}`,
      );
    }
    this.anim = null;
    this.redraw();
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
    const { map, sherman, enemies } = this.mission;
    if (sherman.facing === null) return;
    const occupied = new Set(
      enemies.filter(e => !e.destroyed).map(e => `${e.pos.q},${e.pos.r}`),
    );

    const cands: Array<{ dir: number; color: Color }> = [
      { dir: sherman.facing,                    color: DRIVE_FWD_COLOR },
      { dir: rotateDirection(sherman.facing, 3), color: DRIVE_BWD_COLOR },
    ];

    for (const c of cands) {
      const pos = neighbor(sherman.pos, c.dir as 0 | 1 | 2 | 3 | 4 | 5);
      const tile = map.get(pos);
      const blocked = !tile
        || !map.canTankEnter(pos)
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

  /** 仅填充实心六边形（格线见 drawHexStroke / redraw 第二遍） */
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

  /**
   * 林地格上叠画多簇「俯视树冠」（多圆+半透明阴影）。
   * 冠幅约为原先 2 倍、丛数 2 倍，排布为上下两带，尽量占满格内可绘区域；格 (q,r) 轻微错纹。
   */
  private drawForestCanopy(cx: number, cy: number, size: number, t: Tile) {
    const s = size;
    const hash = t.pos.q * 92811 + t.pos.r * 6899;
    const jx = (((hash % 7) + 7) % 7) - 3;
    const h2 = (hash >> 4) ^ (t.pos.r * 3);
    const jy = (((h2 % 5) + 5) % 5) - 2;
    const bx = cx + (jx * s) / 85;
    const by = cy + (jy * s) / 90;
    const baseR = s * 0.26; // 原 0.13 放大 100%
    // 6 丛：上排 3 + 下排 3，覆盖格子上半与中部，冠缘相接以「铺满」
    const clumps: Array<{ ox: number; oy: number; m: number }> = [
      { ox: -0.32, oy: 0.40, m: 0.95 },
      { ox: 0.0,  oy: 0.52, m: 1.0  },
      { ox: 0.32, oy: 0.40, m: 0.95 },
      { ox: -0.33, oy: 0.05, m: 0.9 },
      { ox: 0.0,  oy: 0.02, m: 0.95 },
      { ox: 0.33, oy: 0.05, m: 0.9 },
    ];
    for (const c of clumps) {
      this.drawOneTreeClump(
        bx + c.ox * s,
        by + c.oy * s,
        baseR * c.m,
      );
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
   * 格心简易侧视房屋（与基底地形填色分离）。
   * 坐标系：Cocos 画布 Y 向上。旧版中 `yTop` 命名反了：较小 Y 在屏幕下侧、较大 Y
   * 在屏幕上侧，导致山墙朝「下」；现已改为屋身在下、人字顶（尖）在上。
   */
  private drawBuildingOverlay(cx: number, cy: number, size: number) {
    const g = this.g!;
    const s = size;
    const bodyW = s * 0.5;
    const roofW = s * 0.62;
    // 墙：从下沿到「檐口」矩形；人字顶：以檐口为底、尖在上方
    const yBase = cy - s * 0.26;    // 墙下沿（格心偏下）
    const yWallTop = cy - s * 0.08; // 檐口 / 人字底边
    const yRoofPeak = cy + s * 0.20; // 人字尖（Y 较大 = 更靠上）
    const xL = cx - bodyW * 0.5;
    const xR = cx + bodyW * 0.5;

    g.lineWidth = 2;

    g.fillColor = BUILDING_WALL_FILL;
    g.strokeColor = BUILDING_OUTLINE;
    g.moveTo(xL, yBase);
    g.lineTo(xR, yBase);
    g.lineTo(xR, yWallTop);
    g.lineTo(xL, yWallTop);
    g.close();
    g.fill();
    g.stroke();

    g.fillColor = BUILDING_ROOF_FILL;
    g.moveTo(cx - roofW * 0.5, yWallTop);
    g.lineTo(cx, yRoofPeak);
    g.lineTo(cx + roofW * 0.5, yWallTop);
    g.close();
    g.fill();
    g.stroke();

    g.strokeColor = BUILDING_DOOR_STROKE;
    g.lineWidth = 1.5;
    const dw = s * 0.12;
    const dh = s * 0.12;
    const dTop = yBase + s * 0.05;
    const dLeft = cx - dw * 0.5;
    g.moveTo(dLeft, dTop);
    g.lineTo(dLeft + dw, dTop);
    g.lineTo(dLeft + dw, dTop + dh);
    g.lineTo(dLeft, dTop + dh);
    g.close();
    g.stroke();

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

  /** 每条六角边上的树篱丛数（不含顶点，等分弦长；两端留白 = 相邻丛间距） */
  private static readonly HEDGE_CLUMPS_PER_EDGE = 5;

  /**
   * 第 dir 条边的树篱：中心落在该边弦上，与格线重合。
   * 单丛大小统一，在原先基准半径 `size*0.086` 上整体放大 30%。
   * 沿边用 `k/(n+1)` 均匀取点，使两端与顶点留出相同空隙、丛与丛之间等距。
   */
  private drawHedgeEdge(cx: number, cy: number, size: number, dir: number, _q: number, _r: number) {
    const a1 = (-30 + 60 * dir) * Math.PI / 180;
    const a2 = (-30 + 60 * (dir + 1)) * Math.PI / 180;
    const x0 = cx + size * Math.cos(a1);
    const y0 = cy + size * Math.sin(a1);
    const x1 = cx + size * Math.cos(a2);
    const y1 = cy + size * Math.sin(a2);
    const tx = x1 - x0;
    const ty = y1 - y0;

    const br = size * 0.086 * 1.3;
    const n = BattleScene.HEDGE_CLUMPS_PER_EDGE;
    for (let k = 1; k <= n; k++) {
      const f = k / (n + 1);
      const px = x0 + tx * f;
      const py = y0 + ty * f;
      this.drawHedgeTreeClump(px, py, br);
    }
  }

  /** 树篱单丛：结构与林地树冠类似，配色略深以便与田地/公路上的树篱区分 */
  private drawHedgeTreeClump(x: number, y: number, r: number) {
    const g = this.g!;
    const sh = r * 0.22;
    g.lineWidth = 0;
    g.fillColor = HEDGE_SHADE;
    g.circle(x - sh, y - sh, r * 0.9);
    g.fill();
    g.fillColor = HEDGE_BUSH_DARK;
    g.circle(x - r * 0.08, y + r * 0.05, r);
    g.fill();
    g.fillColor = HEDGE_BUSH_MID;
    g.circle(x + r * 0.18, y - r * 0.05, r * 0.78);
    g.fill();
    g.fillColor = HEDGE_BUSH_LIGHT;
    g.circle(x, y, r * 0.48);
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
   */
  private applyTopDownTankSprite(
    node: Node,
    sp: Sprite,
    sf: SpriteFrame,
    displayW: number,
    displayH: number,
    u: Unit,
    c: { x: number; y: number },
    facingLerp?: { from: number; to: number; t: number } | null,
  ) {
    node.active = true;
    node.setPosition(c.x, c.y, 0);
    const w = displayW > 0 ? displayW : sf.width;
    const h = displayH > 0 ? displayH : sf.height;
    sp.spriteFrame = sf;
    const ut = node.getComponent(UITransform)!;
    const fit = this.hexSize * 1.8;
    const maxDim = Math.max(w, h) || 1;
    const tw = (w / maxDim) * fit;
    const th = (h / maxDim) * fit;
    ut.setContentSize(tw, th);
    node.setScale(1, 1, 1);
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
    node.angle = (Math.atan2(uy, ux) * 180) / Math.PI + 180;
  }

  private updateShermanTopSprite(
    u: Unit,
    c: { x: number; y: number },
    facingLerp?: { from: number; to: number; t: number } | null,
  ) {
    this.applyTopDownTankSprite(
      this.shermanSpriteNode!,
      this.shermanTopSprite!,
      this.shermanTopSpriteFrame!,
      this.shermanSpriteDisplayW,
      this.shermanSpriteDisplayH,
      u,
      c,
      facingLerp,
    );
  }

  /**
   * 单位：俯视贴图坦克仅画精灵（朝向由贴图）；矢量回退车体为圆 + 黄色朝向短线。
   * overrideX/Y：动画插值格心；facingLerp：转向动画时插值炮口方向（不读 u.facing）。
   */
  private drawUnit(
    u: Unit,
    overrideX?: number,
    overrideY?: number,
    facingLerp?: { from: number; to: number; t: number } | null,
  ) {
    const g = this.g!;
    const c = overrideX !== undefined && overrideY !== undefined
      ? { x: overrideX, y: overrideY }
      : this.project(u.pos.q, u.pos.r);
    // 步兵单独走一条更"像小人"的绘制路径，与坦克的大圆 + 朝向线拉开辨识度。
    if (u.kind === 'infantry') {
      this.drawInfantry(u, c.x, c.y);
      return;
    }
    if (u.kind === 'sherman' && this.shermanSpriteNode) {
      if (u.destroyed || !this.shermanTopSpriteFrame) {
        this.shermanSpriteNode.active = false;
      }
    }
    const r = this.hexSize * 0.5;

    // 摧毁：暗灰色 + 穿心 X
    if (u.destroyed) {
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
      return; // 摧毁的单位不再画朝向线
    }

    // 谢尔曼俯视图精灵（已加载、未摧毁）：起火等状态用格子下图标表示，不再替换为矢量橙圆
    if (u.kind === 'sherman'
        && this.shermanTopSpriteFrame
        && this.shermanSpriteNode
        && this.shermanTopSprite) {
      this.updateShermanTopSprite(u, c, facingLerp);
      return;
    }

    // 德军俯视图：四号 / 三号 / 虎 / 卡（多辆用池；与谢尔曼同一套缩放/朝向/裁切缓存）
    if (isEnemyTopKind(u.kind)
        && this.enemyTopPoolNext < this.enemyTopSpritePool.length) {
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

    // 起火：鲜橙填充 + 亮黄边 + 外层橙红环（保留阵营辨识度时仍以"危险色"为主）
    // 谢尔曼看 fireLevel（被灭火后可退出起火外观），敌方看 damaged（MVP 首次受伤即入"起火"状态）
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

    if (facingLerp) {
      const { ux, uy } = this.facingBlendScreenVec(u.pos, facingLerp.from, facingLerp.to, facingLerp.t);
      g.strokeColor = FACING_COLOR;
      g.lineWidth = 4;
      g.moveTo(c.x, c.y);
      g.lineTo(c.x + ux * r * 1.1, c.y + uy * r * 1.1);
      g.stroke();
      g.lineWidth = 2;
    } else if (u.facing !== null) {
      const np = this.project(neighbor(u.pos, u.facing).q, neighbor(u.pos, u.facing).r);
      const dx = np.x - c.x;
      const dy = np.y - c.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;

      g.strokeColor = FACING_COLOR;
      g.lineWidth = 4;
      g.moveTo(c.x, c.y);
      g.lineTo(c.x + ux * r * 1.1, c.y + uy * r * 1.1);
      g.stroke();
      g.lineWidth = 2;
    }
  }

  /**
   * 步兵渲染：头（上方小圆）+ 身（下方略大圆），整体比坦克更小更"瘦"，
   * 没有朝向线（`facing=null`）。摧毁时用灰色 + 红 X，与坦克保持一致的"残骸"观感。
   *
   * 小字说明：
   *   - 体积更小是因为 §3.1.2 步兵 size=0，只能被机枪打（主炮打不到），视觉上理应与坦克区分
   *   - 头和身用两个同心的小圆叠出剪影，不依赖任何外部美术资源
   */
  private drawInfantry(u: Unit, cx: number, cy: number) {
    const g = this.g!;
    const bodyR = this.hexSize * 0.30;
    const headR = this.hexSize * 0.16;
    const headOffset = this.hexSize * 0.28; // 头部在身体上方

    if (u.destroyed) {
      // 残骸：暗灰身 + 红 X
      g.fillColor = DESTROYED_FILL;
      g.strokeColor = DESTROYED_BORDER;
      g.lineWidth = 2;
      g.circle(cx, cy, bodyR);
      g.fill();
      g.stroke();
      g.strokeColor = DESTROYED_BORDER;
      g.lineWidth = 3;
      const d = bodyR * 0.9;
      g.moveTo(cx - d, cy - d); g.lineTo(cx + d, cy + d); g.stroke();
      g.moveTo(cx - d, cy + d); g.lineTo(cx + d, cy - d); g.stroke();
      g.lineWidth = 2;
      return;
    }

    const fill = FACTION_COLORS[u.faction];
    g.fillColor = fill;
    g.strokeColor = UNIT_BORDER;
    g.lineWidth = 2;
    // 身
    g.circle(cx, cy - bodyR * 0.15, bodyR);
    g.fill();
    g.stroke();
    // 头
    g.circle(cx, cy + headOffset, headR);
    g.fill();
    g.stroke();
  }

  // ---------- HUD ----------

  /** 一次性创建 HUD：左上角状态 Label + 右下角"结束回合"按钮。无需任何美术资源。 */
  private buildHUD() {
    // ---- 左上角状态 Label ----
    const labelNode = new Node('HUDLabel');
    labelNode.layer = this.node.layer;
    const lUT = labelNode.addComponent(UITransform);
    lUT.setContentSize(420, 60);
    lUT.setAnchorPoint(0, 1); // 锚点在左上，方便对齐屏幕角
    const label = labelNode.addComponent(Label);
    label.fontSize = 26;
    label.lineHeight = 30;
    label.color = HUD_TEXT_COLOR;
    label.horizontalAlign = HorizontalTextAlignment.LEFT;
    label.verticalAlign = VerticalTextAlignment.TOP;
    label.string = t('hud.init');
    // Canvas 1280x720，左上角对应 (-640, 360)，再留 16px 边距
    labelNode.setPosition(-624, 344, 0);
    this.node.addChild(labelNode);
    this.hudLabel = label;

    // ---- 右下角"结束回合"按钮 ----
    const btn = new Node('EndTurnButton');
    btn.layer = this.node.layer;
    const bUT = btn.addComponent(UITransform);
    const BTN_W = 180, BTN_H = 60;
    bUT.setContentSize(BTN_W, BTN_H);
    bUT.setAnchorPoint(0.5, 0.5);
    // 右下角 (640, -360)，往内收 110/40 让按钮不贴边
    btn.setPosition(640 - BTN_W / 2 - 20, -360 + BTN_H / 2 + 20, 0);

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

    // ---- 右上角设置（后 addChild，保证叠在最上可点） ----
    this.makeBattleCircleButton(
      this.node, BATTLE_SETTINGS_CX, BATTLE_SETTINGS_CY, BATTLE_SETTINGS_R, '⚙',
      () => this.openBattleSettings(),
    );
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
    bg.fillColor = bgColor;
    bg.strokeColor = BTN_BORDER;
    bg.lineWidth = 2;
    bg.rect(-W / 2, -H / 2, W, H);
    bg.fill();
    bg.stroke();

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

    btn.on(Node.EventType.TOUCH_END, onClick, this);
    this.node.addChild(btn);
    return btn;
  }

  // ---------- 谢尔曼状态面板 ----------

  /**
   * 右侧常驻信息面板（自上而下）：
   *   ┌──────────────────┐
   *   │   乘员             │
   *   │  ① 车长  打开/关闭  │  ← 与舱盖合并：阵亡显示「阵亡」；存活可点切换舱盖
   *   │  ② 装填手 …        │
   *   │  …                 │
   *   │  ─────────────     │
   *   │   谢尔曼状态       │
   *   │  装填    已装填    │
   *   │  炮塔    完好      │
   *   │  机动    正常      │
   *   │  着火程度  2 / -   │
   *   └──────────────────┘
   *
   * 每行左列 = 灰色固定名字，右列 = 根据数据着色的状态文字；
   * refresh 时只改 string + color，不重建节点。
   */
  private buildStatusPanel() {
    const W = 220;
    const GAP_BELOW_GEAR = 10;
    const panelTopY = BATTLE_SETTINGS_CY - BATTLE_SETTINGS_R - GAP_BELOW_GEAR;
    const H = 312;
    const y = panelTopY - H / 2;
    const x = BATTLE_SETTINGS_CX - W / 2;

    const CREW_GAP = 22;
    const BODY_GAP = 24;
    const innerTop = H / 2 - 8;
    const crewTitleY = innerTop - 14;
    const crewFirstY = crewTitleY - 26;
    const sepY = crewFirstY - 5 * CREW_GAP - 10;
    const shermanTitleY = sepY - 16;
    const bodyFirstY = shermanTitleY - 24;
    const bodyRowY = [0, 1, 2, 3].map(j => bodyFirstY - j * BODY_GAP);

    const panel = new Node('ShermanStatus');
    panel.layer = this.node.layer;
    panel.addComponent(UITransform).setContentSize(W, H);
    panel.setPosition(x, y, 0);
    const bg = panel.addComponent(Graphics);
    bg.fillColor = STATUS_PANEL_BG;
    bg.strokeColor = STATUS_PANEL_BORDER;
    bg.lineWidth = 2;
    bg.rect(-W / 2, -H / 2, W, H);
    bg.fill();
    bg.stroke();
    bg.strokeColor = new Color(120, 120, 120, 200);
    bg.lineWidth = 1;
    bg.moveTo(-W / 2 + 16, sepY);
    bg.lineTo( W / 2 - 16, sepY);
    bg.stroke();
    this.node.addChild(panel);
    this.statusPanel = panel;

    this.statusBodyLeftLabels = [];
    this.statusCrewLeftLabels = [];

    // 1) 乘员区（在「谢尔曼状态」之上）
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
      const crewLeft = this.makeLeftLabel(panel, crewNames[i], -W / 2 + 20, rowY, 120, 22, 18, STATUS_LABEL_COLOR);
      this.statusCrewLeftLabels.push(crewLeft);
      const valW = i === 0 ? 128 : 70;
      const val = this.makeRightLabel(panel, t('status.val.crewAlive'), W / 2 - 20, rowY, valW, 22, 18, STATUS_VALUE_OK);
      this.statusCrewLabels.push(val);
    }

    // 车长行整行热区：存活时切换舱盖（逻辑见 tryToggleHatch / canToggleHatch）
    const commanderHatchHit = new Node('CommanderHatchHit');
    commanderHatchHit.layer = this.node.layer;
    commanderHatchHit.addComponent(UITransform).setContentSize(W - 24, CREW_GAP);
    commanderHatchHit.setPosition(0, crewFirstY, 0);
    commanderHatchHit.on(Node.EventType.TOUCH_END, () => this.tryToggleHatch(), this);
    panel.addChild(commanderHatchHit);

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

    // 乘员：① 车长与舱盖合并（阵亡 →「阵亡」；存活 → 打开/关闭，点行切换舱盖）
    //       ②—⑤ 仅存活 / 阵亡
    const crew = s.crew;
    const crewFlags: boolean[] = crew
      ? [crew.commander, crew.loader, crew.gunner, crew.driver, crew.coDriver]
      : [true, true, true, true, true];

    const lab0 = this.statusCrewLabels[0];
    if (lab0) {
      if (s.destroyed || !crewFlags[0]) {
        lab0.string = t('status.val.crewDead');
        lab0.color = STATUS_VALUE_DEAD;
      } else if (s.hatchOpen) {
        lab0.string = t('status.val.hatchOpen');
        lab0.color = STATUS_VALUE_WARN;
      } else {
        lab0.string = t('status.val.hatchClosed');
        lab0.color = STATUS_VALUE_DOWN;
      }
    }
    for (let i = 1; i < this.statusCrewLabels.length; i++) {
      const lab = this.statusCrewLabels[i];
      if (s.destroyed) {
        lab.string = t('status.val.crewDead');
        lab.color = STATUS_VALUE_DEAD;
      } else if (!crewFlags[i]) {
        lab.string = t('status.val.crewDead');
        lab.color = STATUS_VALUE_DEAD;
      } else {
        lab.string = t('status.val.crewAlive');
        lab.color = STATUS_VALUE_OK;
      }
    }
  }

  /** 绘制结束回合按钮的背景。urgent=true 时换提醒色。 */
  private drawEndTurnBg(urgent: boolean) {
    if (!this.endTurnBg) return;
    const g = this.endTurnBg;
    g.clear();
    g.fillColor = urgent ? BTN_BG_URGENT : BTN_BG_NORMAL;
    g.strokeColor = BTN_BORDER;
    g.lineWidth = 2;
    // 锚点 0.5 → 矩形围绕原点
    g.rect(-90, -30, 180, 60);
    g.fill();
    g.stroke();
  }

  private updateHUD() {
    if (this.hudLabel) {
      if (this.phase !== 'player') {
        this.hudLabel.string = t('hud.enemyTurn', { n: this.turn });
      } else if (this.playerStep === 'choose') {
        const doneTag = [
          this.movementDone ? t('hud.moveDone')   : t('hud.moveTodo'),
          this.attackDone   ? t('hud.attackDone') : t('hud.attackTodo'),
          this.miscDone     ? t('hud.miscDone')   : t('hud.miscTodo'),
        ].join(' ');
        this.hudLabel.string = t('hud.playerChoose', { n: this.turn, tags: doneTag });
      } else if (this.playerStep === 'movement') {
        this.hudLabel.string = t('hud.movePhase', { n: this.turn, dice: this.remainingDice() });
      } else if (this.playerStep === 'misc') {
        this.hudLabel.string = t('hud.miscPhase', { n: this.turn, dice: this.remainingDice() });
      } else {
        const sherman = this.mission?.sherman;
        const loaded = sherman?.loaded ? t('hud.loaded') : t('hud.unloaded');
        // 选中主炮 → "点敌人开火"；选中机枪 → "点相邻步兵扫射"；两者互斥
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
  }

  /** 托盘里还剩几颗骰子未执行（用于 HUD 展示） */
  private remainingDice(): string {
    if (this.phaseDice.length === 0) return '-';
    const left = this.phaseDice.filter(d => !d.used).length;
    return `${left}/${this.phaseDice.length}`;
  }

  /**
   * 根据当前子状态算出右下角按钮的显示文字与配色：
   *   - 玩家阶段 + 有任何"未执行阶段" → "下一阶段"（蓝）
   *   - 玩家阶段 + 两阶段都做过       → "结束回合"（红）
   *   - 敌方阶段                      → "敌方回合中"（灰-蓝，点不了）
   */
  private computeAdvanceButton(): { label: string; urgent: boolean } {
    if (this.phase !== 'player') return { label: t('btn.enemyTurnRunning'), urgent: false };
    // 回合可以结束的条件：A + B 都完成即可（C 是可选的尾部阶段，玩家可做可跳）。
    const allDone = this.movementDone && this.attackDone;
    if (allDone) return { label: t('btn.endTurn'), urgent: true };
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
    if (this.outcome === 'victory'
        && GameSession.selectedLevelId > 0
        && findLevelByMissionId(this.missionId)) {
      MenuProgress.markCompleted(GameSession.selectedLevelId);
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
    console.log('[BattleScene] 返回主菜单');
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
    this.anim = null;
    this.finalizeDiceShow(true);
    this.enemyOrder = [];
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceUsed = [];
    this.destroyEnemyDiceTray();
    this.phaseDice = [];
    this.clearGunSelection();
    this.movementDone = false;
    this.attackDone = false;
    this.miscDone = false;
    this.playerStep = 'choose';
    this.closeDiePopover();
    this.clearFloaters();
    // 隐藏胜负覆盖层与按钮（loadAndDraw 内部 updateOutcomeOverlay 也会再做一次保险）
    if (this.outcomeLabel) this.outcomeLabel.node.active = false;
    if (this.restartBtn) this.restartBtn.active = false;
    this.loadAndDraw(data);
    console.log('[BattleScene] === 重开当前任务 ===');
  }

  // ---------- 阶段选择条 + 骰子托盘 ----------

  /** 底部阶段选择条：三个大按钮（移动 / 攻击 / 杂项），仅在 playerStep === 'choose' 时可见。 */
  private buildChooseBar() {
    const bar = new Node('ChooseBar');
    bar.layer = this.node.layer;
    const ut = bar.addComponent(UITransform);
    ut.setContentSize(700, 80);
    ut.setAnchorPoint(0.5, 0.5);
    bar.setPosition(0, -260, 0);
    this.node.addChild(bar);
    this.chooseBar = bar;

    const makeBtn = (name: string, text: string, x: number, color: Color,
                     onClick: () => void): { root: Node; label: Label } => {
      const W = 200, H = 72;
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
      tx.string = text;
      b.addChild(txtNode);
      b.on(Node.EventType.TOUCH_END, onClick, this);
      bar.addChild(b);
      return { root: b, label: tx };
    };
    const mv = makeBtn('ChooseMove', t('btn.movePhase'), -220,
      PHASE_BTN_MOVE, () => this.enterPhase('movement'));
    this.chooseMoveBtn = mv.root;
    this.chooseMoveLabel = mv.label;
    const at = makeBtn('ChooseAttack', t('btn.attackPhase'), 0,
      PHASE_BTN_ATTACK, () => this.enterPhase('attack'));
    this.chooseAttackBtn = at.root;
    this.chooseAttackLabel = at.label;
    // 杂项按钮的颜色单独选一支紫色，避免和移动（蓝）/攻击（红）混淆
    const mc = makeBtn('ChooseMisc', t('btn.miscPhase'), +220,
      PHASE_BTN_MISC, () => this.enterPhase('misc'));
    this.chooseMiscBtn = mc.root;
    this.chooseMiscLabel = mc.label;
  }

  /** 底部骰子托盘：有 5 个最大容量的空位；实际数量按 phaseDice.length 决定可见性。 */
  private buildDiceTray() {
    const tray = new Node('DiceTray');
    tray.layer = this.node.layer;
    tray.addComponent(UITransform).setContentSize(640, 120);
    tray.setPosition(0, -260, 0);
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
    tl.string = '';
    tray.addChild(titleNode);
    this.diceTitleLabel = tl;

    // 5 个骰子槽位（居中摆放），实际数量由 phaseDice.length 决定 active
    const SLOT = 72, GAP = 12;
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
      hint.string = '';
      slot.addChild(hintNode);

      const idx = i;
      slot.on(Node.EventType.TOUCH_END, () => this.onClickDie(idx), this);
      tray.addChild(slot);

      this.diceVisuals.push({ root: slot, bg, faceLabel: face, hintLabel: hint });
    }

    tray.active = false;
  }

  /** 根据 playerStep / 胜负 / 敌方阶段等状态切换底部 UI 的可见性与文字。 */
  private refreshPhaseUI() {
    const inBattle = this.phase === 'player' && this.outcome === 'ongoing';
    // 1) 阶段选择条
    if (this.chooseBar) {
      this.chooseBar.active = inBattle && this.playerStep === 'choose';
    }
    // GDD §2.3：C 必须最后执行 —— 杂项按钮要等 A + B 都做完后才"出现"；
    // 此时它既是可选动作，也是"跳过 C 直接结束回合"的替代（玩家也可以直接点右下角的"结束回合"）。
    const canMove   = !this.movementDone;
    const canAttack = !this.attackDone;
    const canMisc   = this.movementDone && this.attackDone && !this.miscDone;
    if (this.chooseMoveBtn)   this.setPhaseBtnEnabled(this.chooseMoveBtn,   canMove,   PHASE_BTN_MOVE);
    if (this.chooseAttackBtn) this.setPhaseBtnEnabled(this.chooseAttackBtn, canAttack, PHASE_BTN_ATTACK);
    if (this.chooseMiscBtn) {
      // A / B 任一未完成 → 杂项按钮整体隐藏（不是灰掉）；完成后再淡入
      this.chooseMiscBtn.active = canMisc;
      this.setPhaseBtnEnabled(this.chooseMiscBtn, canMisc, PHASE_BTN_MISC);
    }

    // 2) 骰子托盘
    if (this.diceTrayRoot) {
      this.diceTrayRoot.active = inBattle && (
        this.playerStep === 'movement'
        || this.playerStep === 'attack'
        || this.playerStep === 'misc'
      );
    }
    if (this.diceTitleLabel) {
      this.diceTitleLabel.string = this.playerStep === 'movement'
        ? t('dice.tray.move')
        : this.playerStep === 'attack'
          ? t('dice.tray.attack')
          : this.playerStep === 'misc'
            ? t('dice.tray.misc')
            : '';
    }
    this.refreshDiceTray();
    // 点击骰子后弹出的菜单，状态变化时（比如骰子被消耗）一并关闭
    if (!inBattle || this.playerStep === 'choose') this.closeDiePopover();
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
  private refreshDiceTray() {
    for (let i = 0; i < this.diceVisuals.length; i++) {
      const vis = this.diceVisuals[i];
      const slot = this.phaseDice[i];
      if (!slot) {
        vis.root.active = false;
        continue;
      }
      vis.root.active = true;
      // 主炮 / 机枪选中都复用同一种"已高亮"视觉，玩家以颜色与 HUD 文案区分
      this.drawDieSlot(vis, slot, i === this.selectedGunDieIdx || i === this.selectedMGDieIdx);
    }
  }

  private drawDieSlot(vis: DieVisual, slot: DieSlot, highlighted: boolean) {
    const ut = vis.root.getComponent(UITransform);
    if (!ut) return;
    const W = ut.contentSize.width, H = ut.contentSize.height;
    const g = vis.bg;
    g.clear();
    g.fillColor = slot.used ? DIE_FACE_USED_FILL : DIE_FACE_FILL;
    g.strokeColor = highlighted ? DIE_FACE_SELECTED : DIE_FACE_BORDER;
    g.lineWidth = highlighted ? 4 : 2;
    g.rect(-W / 2, -H / 2, W, H);
    g.fill();
    g.stroke();

    vis.faceLabel.string = String(slot.pip);
    vis.faceLabel.color = slot.used ? DIE_FACE_TEXT_USED : DIE_FACE_TEXT;

    const hint = this.dieActionHint(slot.pip);
    vis.hintLabel.string = slot.used ? t('dice.slot.used') : hint.text;
    vis.hintLabel.color = slot.used ? DIE_HINT_GREY : hint.color;
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
    console.log(`[Hatch] 车长舱盖 → ${s.hatchOpen ? '打开' : '关闭'}`);
    this.refreshStatusPanel();
  }

  /** 玩家在"选择阶段"时点了移动/攻击/杂项按钮 → 摇一批骰子，进入对应子阶段。 */
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
    const terrain = tile ? tile.terrain : 'field';
    const count = actionDicePool({ terrain, hatchOpen: !!sherman.hatchOpen });
    const pips = rollActionDice(this.rng, count);
    this.phaseDice = pips.map(pip => ({ pip, used: false }));
    this.clearGunSelection();
    this.playerStep = which;
    this.closeDiePopover();

    const label = which === 'movement' ? '移动' : which === 'attack' ? '攻击' : '杂项';
    console.log(`[Dice] ${label}阶段掷骰: `
      + `[${pips.join(', ')}]（地形 ${terrain}, 舱盖 ${sherman.hatchOpen ? '开' : '关'}）`);

    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
  }

  /**
   * 结束当前子阶段（movement / attack / misc），回到 choose；
   * 若结束的是杂项阶段，则本回合 A+B 已必然完成 → 直接进入敌方阶段（省一次「结束回合」点击）。
   */
  private endCurrentSubPhase() {
    const wasMisc = this.playerStep === 'misc';
    if (this.playerStep === 'movement') this.movementDone = true;
    else if (this.playerStep === 'attack') this.attackDone = true;
    else if (this.playerStep === 'misc') this.miscDone = true;
    this.phaseDice = [];
    this.clearGunSelection();
    this.playerStep = 'choose';
    this.closeDiePopover();
    if (wasMisc && this.phase === 'player' && this.outcome === 'ongoing'
        && this.movementDone && this.attackDone) {
      this.beginEnemyPhase();
      return;
    }
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
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
      const label = this.playerStep === 'movement' ? '移动'
        : this.playerStep === 'attack' ? '攻击' : '杂项';
      console.log(`[Dice] ${label}阶段骰子用尽，自动结束阶段`);
      this.endCurrentSubPhase();
    }
  }

  // ---------- 骰子点击菜单 ----------

  private onClickDie(idx: number) {
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
          // 2 点 C 列：副驾驶机枪射击相邻步兵
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
          if (sherman && sherman.turretDamaged) {
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
      lab.string = it.text;
      btn.addChild(tn);
      btn.on(Node.EventType.TOUCH_END, () => { it.onClick(); }, this);
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
    console.log(`[Move] 转向 ${dirSign === 1 ? 'CW' : 'CCW'} → facing=${to}（动画中）`);
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

    const { map, sherman, enemies } = this.mission;
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
    const tile = map.get(to);
    if (!tile || !map.canTankEnter(to)) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.blockedTerrain'),
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    const blocker = enemies.find(e => !e.destroyed && e.pos.q === to.q && e.pos.r === to.r);
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
    console.log(`[Move] ${dirSign === 1 ? '前进' : '后退'} → (${to.q},${to.r})`);
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
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    console.log('[Attack] 装填完成');
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
    console.log(`[Attack] 对子 炮手主炮射击已备（主骰 ${dieIdx} + 搭档 ${partnerIdx}，点数 ${slot.pip}）`);
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
   * 选中一颗机枪骰进入"选步兵"态；之后点相邻步兵格触发扫射。
   *
   * 合法骰面：
   *   - 攻击阶段：pip ∈ {3, 4}（classifyAttackDie == 'mg'）
   *   - 杂项阶段：pip == 2（classifyMiscDie == 'codriver_mg'，副驾驶机枪）
   *
   * 乘员约束：
   *   - 攻击阶段 MG：装填手负责同轴机枪；装填手阵亡则无法使用
   *   - 杂项阶段 codriver_mg：副驾驶机枪；副驾驶阵亡则无法使用
   */
  private selectMGDie(dieIdx: number) {
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used) return;
    if (this.playerStep === 'attack') {
      if (classifyAttackDie(slot.pip) !== 'mg') return;
      if (!this.checkCrewAlive('loader')) return;
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
    if (target === 'turret') {
      if (!sherman.turretDamaged) return;
      sherman.turretDamaged = false;
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.turretFixed'),
        new Color(180, 240, 160, 255), { size: 22, dur: 0.9, rise: 24 });
      console.log('[Misc] 修复炮塔');
    } else {
      if (!sherman.paralyzed) return;
      sherman.paralyzed = false;
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.mobilityFixed'),
        new Color(180, 240, 160, 255), { size: 22, dur: 0.9, rise: 24 });
      console.log('[Misc] 修复瘫痪');
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
    console.log(`[Misc] 灭火 → fireLevel ${lvl} → ${sherman.fireLevel}`);
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
   * 玩家机枪扫射：必须已选中机枪骰 + target 为相邻步兵（canMGAttack 通过）。
   *
   * 命中模型（§3.6 行动表 B3/B4 / C2）：2d6 ≥ 7 即命中，命中直接击毙步兵。
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
    const slot = this.phaseDice[this.selectedMGDieIdx];
    if (!slot || slot.used) return;

    const check = canMGAttack({ attacker: sherman, target, map });
    if (!check.ok) {
      console.log(`[Combat-MG] cannot attack: ${check.reason}`);
      const msg = t(check.reason ?? 'attack.reason.unknown');
      this.spawnFloater(sherman.pos.q, sherman.pos.r, msg,
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      return;
    }

    // 先掷骰拿到确定结果，再让面板按这个结果播动画；
    // 真正 applyMGAttack / 消耗骰子 / 胜负判定都放到 onDone 里，
    // 这样动画期间托盘 + 敌人图示不会提前变。
    const report = rollMGAttack({ attacker: sherman, target, map }, this.rng);
    console.log(
      `[Combat-MG] 玩家机枪 2d6=${report.dice[0]}+${report.dice[1]}=${report.roll}`
      + ` 需要≥${report.threshold} → ${report.hit ? 'HIT 击毙' : 'MISS'}`
    );

    // MGReport → 面板可用的 AttackReport 视图：只用 2d6/threshold/hit 四个字段，
    // 其余 pen/dmg/crew 分段字段都留空；mg=true 下 advanceDiceShow 不会读它们。
    const panelReport: AttackReport = {
      dice: report.dice,
      roll: report.roll,
      threshold: report.threshold,
      hit: report.hit,
      statusChange: report.hit ? 'destroyed' : 'none',
    };

    const capturedSlot = slot;
    this.startDiceShow(
      panelReport,
      t('actor.player'),
      target.kind,
      () => {
        if (!this.mission) return;
        applyMGAttack(target, report);
        capturedSlot.used = true;
        this.selectedMGDieIdx = -1;
        // 面板结束后再补一条目标格上方的短浮字，强化"这次扫射打谁"的视觉记忆
        if (report.hit) {
          this.spawnFloater(target.pos.q, target.pos.r, t('floater.mgHit'),
            new Color(255, 120, 120, 255), { size: 32, dur: 1.0, rise: 48 });
        } else {
          this.spawnFloater(target.pos.q, target.pos.r, t('floater.mgMiss'),
            new Color(220, 220, 220, 255), { size: 26, dur: 0.9, rise: 44 });
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
    // 立即刷一次 HUD，让 "点相邻步兵扫射" 提示消失，避免玩家以为还能再点
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
    s.smoked = true;
    slot.used = true;
    this.closeDiePopover();
    this.spawnFloater(s.pos.q, s.pos.r, t('floater.smokeDeployed'),
      new Color(200, 200, 220, 255), { size: 22, dur: 0.9, rise: 24 });
    console.log('[Misc] 施放烟雾 → sherman.smoked=true');
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.refreshStatusPanel();
    this.autoEndPhaseIfDone();
  }

  /**
   * 隐蔽（§3.6 对子 C 列 concealment）：
   * 需要一对同点骰；消耗两颗，置 sherman.hidden=true（被攻击命中阈值 +2）。
   * 隐蔽保持到下一次谢尔曼做出移动（转向 / 前进 / 后退），见 breakConcealment()。
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
    console.log(`[Misc] 进入隐蔽（消耗骰 ${dieIdx} + ${partnerIdx}，点数 ${slot.pip}）`);
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

  /** §3.5 隐蔽破除：任何移动动作结束后调用；若 hidden=true 则清除并飘一条提示。 */
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

    const { map, sherman, enemies } = this.mission;
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
    const tile = map.get(to);
    if (!tile || !map.canTankEnter(to)) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.blockedTerrain'),
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    const blocker = enemies.find(e => !e.destroyed && e.pos.q === to.q && e.pos.r === to.r);
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
    console.log(`[Move] 对子 驾驶员前进 → (${to.q},${to.r})（消耗两颗骰）`);
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
    console.log(`[Move] 对子 副驾驶转向 ${dirSign === 1 ? 'CW' : 'CCW'} → facing=${to}（动画中）`);
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
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.refreshStatusPanel();
    console.log('[Attack] 对子 装填手装填完成（消耗两颗骰）');
    this.autoEndPhaseIfDone();
  }

  // ---------- 智能"下一阶段" ----------

  /**
   * 右下角按钮点击：
   *   - 当前在移动/攻击阶段 → endCurrentSubPhase 回到 choose
   *   - 当前在杂项阶段 → endCurrentSubPhase 内会直接 beginEnemyPhase（见该函数）
   *   - 当前在 choose：A+B 都 done → beginEnemyPhase（未做杂项时由此结束回合）
   */
  private onAdvanceClicked() {
    if (this.isBusy()) return;
    if (this.phase !== 'player') return;
    if (this.outcome !== 'ongoing') return;

    if (this.playerStep === 'movement' || this.playerStep === 'attack' || this.playerStep === 'misc') {
      this.endCurrentSubPhase();
      return;
    }
    // choose 状态：A + B 都完成即可结束回合（C 为可选尾段，不强制）
    if (this.movementDone && this.attackDone) {
      this.beginEnemyPhase();
    }
  }

  private beginEnemyPhase() {
    if (!this.mission) return;
    this.phase = 'enemy';
    // §2.1 阶段④：移除德军烟雾（烟雾只保留一回合）
    for (const e of this.mission.enemies) {
      if (!e.destroyed && e.smoked) {
        e.smoked = false;
        this.spawnFloater(e.pos.q, e.pos.r, t('floater.smokeCleared'),
          new Color(200, 200, 220, 255), { size: 20, dur: 0.8, rise: 22 });
        console.log(`[Phase④] ${e.kind} 烟雾消散`);
      }
    }
    // §2.1 阶段⑤：着火程度检定 —— 谢尔曼若着火，按 fireLevel 次掷骰结算
    this.runFireCheck();
    // 阶段⑤ 结算后可能已阵亡 → 更新胜负
    this.outcome = checkOutcome(this.mission);
    this.updateOutcomeOverlay();
    if (this.outcome !== 'ongoing') {
      this.closeDiePopover();
      this.refreshPhaseUI();
      this.updateHUD();
      this.redraw();
      return;
    }
    // GDD §3.7：按距谢尔曼最近 → 最远排序；同距随机
    // 步兵 §3.1.2 规定"只在回合结束事件中行动"，因此敌方阶段不参与骰子驱动。
    const aiCandidates = this.mission.enemies.filter(e => e.kind !== 'infantry');
    this.enemyOrder = selectEnemyOrder(aiCandidates, this.mission.sherman, this.rng);
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceUsed = [];
    this.destroyEnemyDiceTray();
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    console.log(`[BattleScene] === 回合 ${this.turn} 敌方阶段开始 (${this.enemyOrder.length} 辆敌坦)`);
    this.beginCurrentEnemyTurn();
  }

  /**
   * §2.1 阶段⑤ + §3.5 着火程度检定：
   * 谢尔曼 fireLevel 有多少就掷多少颗 d6，每颗按"谢尔曼伤害表" (§3.4 Step 3) 结算，
   * 但与受击穿不同的是：不再做命中 / 穿甲检定 —— 火已经在车里了。
   *
   * 为了避免同一轮检定中"着火 → fireLevel 升级 → 又多掷一次"的链式 bug：
   * - 先快照 N = 当前 fireLevel；
   * - 本批次所有"3/4 着火" 结果累计到 pendingFire，最后一次性加到 fireLevel 上；
   * - 其他结果（摧毁 / 炮塔 / 瘫痪 / crewCheck）直接就地应用。
   *
   * MVP：不走动画面板，仅以浮字 + 日志呈现；后续可扩展为迷你掷骰面板。
   */
  private runFireCheck() {
    if (!this.mission) return;
    const s = this.mission.sherman;
    const n = s.fireLevel ?? 0;
    if (n <= 0) return;
    console.log(`[Phase⑤] 着火检定 ×${n}`);
    this.spawnFloater(s.pos.q, s.pos.r, t('floater.fireCheck'),
      new Color(255, 180, 80, 255), { size: 22, dur: 1.0, rise: 28 });
    let pendingFire = 0;
    for (let i = 0; i < n; i++) {
      if (s.destroyed) break;
      const die = this.rng.d6();
      const effect = resolveDamageEffect(s, die);
      console.log(`[Phase⑤] d6=${die} → ${effect}`);
      this.applyFireCheckEffect(s, effect, () => { pendingFire += 1; });
    }
    if (!s.destroyed && pendingFire > 0) {
      s.fireLevel = (s.fireLevel ?? 0) + pendingFire;
      console.log(`[Phase⑤] fireLevel += ${pendingFire} → ${s.fireLevel}`);
    }
    this.refreshStatusPanel();
    this.redraw();
  }

  /**
   * 着火检定单次结果 → 状态写回 + 浮字反馈。
   * 'fire' 不就地累加 fireLevel，而是通过 onFire 回调交给调用方批量结算（见 runFireCheck）。
   */
  private applyFireCheckEffect(s: Unit, effect: DamageEffect, onFire: () => void) {
    const pos = s.pos;
    const color = new Color(255, 180, 80, 255);
    switch (effect) {
      case 'destroyed':
        s.destroyed = true;
        this.spawnFloater(pos.q, pos.r, t('dmg.outcome.destroyed'),
          new Color(255, 100, 100, 255), { size: 26, dur: 1.2, rise: 32 });
        break;
      case 'fire':
        onFire();
        this.spawnFloater(pos.q, pos.r, t('dmg.effect.fire'), color,
          { size: 22, dur: 0.9, rise: 24 });
        break;
      case 'turret':
        s.damaged = true;
        s.turretDamaged = true;
        this.spawnFloater(pos.q, pos.r, t('dmg.outcome.turret'), color,
          { size: 22, dur: 0.9, rise: 24 });
        break;
      case 'paralyzed':
        s.damaged = true;
        s.paralyzed = true;
        this.spawnFloater(pos.q, pos.r, t('dmg.outcome.paralyzed'), color,
          { size: 22, dur: 0.9, rise: 24 });
        break;
      case 'crewCheck': {
        // §3.4 Step 3 d6=2：再掷一次决定哪位乘员阵亡（与受击穿同机制）
        s.damaged = true;
        const crewDie = this.rng.d6();
        const slot = crewDie >= 1 && crewDie <= 5
          ? crewDie as 1 | 2 | 3 | 4 | 5
          : (s.hatchOpen ? 1 : null);
        if (slot !== null && s.crew) {
          switch (slot) {
            case 1: s.crew.commander = false; break;
            case 2: s.crew.loader = false;    break;
            case 3: s.crew.gunner = false;    break;
            case 4: s.crew.driver = false;    break;
            case 5: s.crew.coDriver = false;  break;
          }
          this.spawnFloater(pos.q, pos.r, t('crew.death.kia', { role: t('crew.role.' + slot) }),
            new Color(255, 120, 120, 255), { size: 22, dur: 1.0, rise: 26 });
          console.log(`[Phase⑤] 阵亡检定 d6=${crewDie} → slot=${slot}`);
        } else {
          this.spawnFloater(pos.q, pos.r, t('crew.death.falseAlarm'),
            new Color(200, 200, 200, 255), { size: 20, dur: 0.9, rise: 24 });
          console.log(`[Phase⑤] 阵亡检定 d6=${crewDie} → 虚惊`);
        }
        break;
      }
      case 'damaged':
        // 谢尔曼伤害表不会给出 'damaged'（对应的是德坦路线），兜底处理
        s.damaged = true;
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
  }

  /** 全屏遮罩 + 居中面板 + 标题 + ✕（与 MainMenuScene.openModal 同构） */
  private openBattleModal(titleText: string, panelW: number, panelH: number): {
    panel: Node;
    contentY: number;
  } {
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
    pg.fillColor = MODAL_PANEL_BG;
    pg.strokeColor = MODAL_PANEL_BORDER;
    pg.lineWidth = 2;
    pg.rect(-panelW / 2, -panelH / 2, panelW, panelH);
    pg.fill();
    pg.stroke();
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

  private openBattleSettings() {
    this.closeBattleModal();
    this.closeBattleExitModal();
    const panelW = 480;
    const panelH = 420;
    const { panel, contentY } = this.openBattleModal(t('battle.settings.title'), panelW, panelH);
    const halfW = panelW / 2;

    const volRowY = contentY - 28;
    this.makeBattleModalLabel(panel, t('menu.settings.volume'),
      -halfW + 80, volRowY, 80, 28, 20, HUD_TEXT_COLOR);
    const state = MenuProgress.load();
    const track = this.buildBattleVolumeSlider(panel, 40, volRowY, 220, state.volume);
    const volLabel = this.makeBattleModalLabel(panel, `${state.volume}%`,
      200, volRowY, 60, 28, 20, HUD_TEXT_COLOR);

    const langRowY = contentY - 92;
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
      volumeFill: track.fill,
      volumeThumb: track.thumb,
      volumeLabel: volLabel,
      langZhBtn: zhBtn,
      langEnBtn: enBtn,
    };
    this.refreshLangBattleButtons(curLang);

    const saveRowY = contentY - 156;
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

    const exitRowY = contentY - 220;
    const exitB = this.makeBattleRectButton(panel, 0, exitRowY, 200, 44, BTN_EXIT_WARN,
      () => this.openBattleExitConfirm(),
    );
    const exitSetLab = this.makeBattleModalLabel(exitB.node, t('battle.settings.exit'), 0, 0, 200, 44, 20, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(exitSetLab, () => this.openBattleExitConfirm());

    const closeRowY = contentY - 290;
    const closeB = this.makeBattleRectButton(panel, 0, closeRowY, 160, 44, BATTLE_BTN_ACCENT,
      () => this.closeBattleModal(),
    );
    const closeSetLab = this.makeBattleModalLabel(closeB.node, t('menu.settings.close'), 0, 0, 160, 44, 20, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(closeSetLab, () => this.closeBattleModal());
  }

  private openBattleExitConfirm() {
    this.closeBattleExitModal();
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
      MenuProgress.setVolume(vol);
      refreshBar(vol);
      if (this.battleSettingsRefs?.volumeLabel) {
        this.battleSettingsRefs.volumeLabel.string = `${vol}%`;
      }
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
      g.fillColor = c;
      g.rect(-w / 2, -h / 2, w, h);
      g.fill();
      if (opts?.border) {
        g.strokeColor = BATTLE_MODAL_LEVEL_BORDER;
        g.lineWidth = 2;
        g.rect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);
        g.stroke();
      }
    };
    redraw(color);
    n.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
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
      g.fillColor = c;
      g.strokeColor = SETTINGS_ICON_BD;
      g.lineWidth = 2;
      g.circle(0, 0, r);
      g.fill();
      g.stroke();
    };
    redraw(SETTINGS_ICON_BG);
    this.makeBattleModalLabel(n, iconText, 0, 0, r * 2, r * 2, r + 2, HUD_TEXT_COLOR);
    n.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
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
    if (this.chooseMoveLabel) this.chooseMoveLabel.string = t('btn.movePhase');
    if (this.chooseAttackLabel) this.chooseAttackLabel.string = t('btn.attackPhase');
    if (this.chooseMiscLabel) this.chooseMiscLabel.string = t('btn.miscPhase');
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
      sys.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      console.log(`[Save] 已存档：回合 ${data.turn}`);
      this.flashBattleSettingsHint(t('battle.save.ok'));
      return true;
    } catch (e) {
      console.error('[Save] 写入失败:', e);
      this.flashBattleSettingsHint(t('battle.save.fail'));
      return false;
    }
  }

  /** @param skipHint 主菜单「继续游戏」自动读档时为 true，不飘「已读档」以免干扰开场 */
  private onLoad_Save(skipHint?: boolean) {
    if (!this.mission) return;
    if (this.isBusy()) {
      this.flashBattleSettingsHint(t('battle.load.busy'));
      return;
    }
    const raw = sys.localStorage.getItem(SAVE_KEY);
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
      this.phaseDice = (result.phaseDice ?? []).map(s => ({ pip: s.pip, used: s.used }));
    } else {
      this.playerStep = 'choose';
      this.phaseDice = [];
    }
    this.clearGunSelection();
    this.enemyOrder = [];
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceUsed = [];
    this.destroyEnemyDiceTray();
    this.anim = null;          // 若在动画中点读档，直接丢弃动画状态
    this.finalizeDiceShow(true);
    this.closeDiePopover();
    this.clearFloaters();
    // 胜负状态也要随读档重新判定
    this.outcome = checkOutcome(this.mission);
    this.updateOutcomeOverlay();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    if (!skipHint) this.flashBattleSettingsHint(t('battle.load.ok'));
    console.log(`[Load] 已读档：回合 ${this.turn}, 移动 ${this.movementDone ? '已做' : '未做'}, 攻击 ${this.attackDone ? '已做' : '未做'}`);
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
      this.endEnemyPhase();
      return;
    }

    const enemy = this.enemyOrder[this.enemyIndex];
    const tile = this.mission.map.get(enemy.pos);
    const terrain = tile ? tile.terrain : 'field';
    this.enemyAICol = aiColumnFor(enemy, terrain);
    const count = AI_DICE_COUNT[this.enemyAICol];
    this.enemyDice = rollAIDice(this.rng, count);
    this.enemyDiceUsed = this.enemyDice.map(() => false);
    this.enemyDiceExecOrder = this.computeEnemyDiceExecOrder();

    console.log(
      `[AI] ${enemy.kind}@(${enemy.pos.q},${enemy.pos.r}) 列=${this.enemyAICol} 掷 ${count} 骰 → [${this.enemyDice.join(',')}] 执行序=${this.enemyDiceExecOrder.map(i => this.enemyDice[i]).join(',')}`
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
      console.log(
        `[AI] ${enemy.kind} #${dieIdx + 1} d6=${pip} → ${entryLabel}` +
        (chosen ? ` ⇒ ${chosen}` : ' ⇒ 无可行动作（空转）')
      );

      this.enemyDiceHighlightIdx = dieIdx;
      // 消耗这颗骰子（无论是否真正执行成功，都算"本骰已用")
      this.enemyDiceUsed[dieIdx] = true;
      this.refreshEnemyDiceTray();

      if (!chosen) {
        this.enemyDiceHighlightIdx = -1;
        this.refreshEnemyDiceTray();
        continue;
      }

      // 执行选中的动作；返回表明本次是否"挂起"（有动画在播）
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
    const { map, sherman, enemies } = this.mission;
    const occupied = new Set<string>();
    for (const u of enemies) {
      if (u === enemy || u.destroyed) continue;
      occupied.add(`${u.pos.q},${u.pos.r}`);
    }
    occupied.add(`${sherman.pos.q},${sherman.pos.r}`);

    // shoot 的真正可行性必须由 canAttack 决定，这里先做再说
    const tryOne = (a: EnemyAction): boolean => {
      if (a === 'shoot') {
        return canAttack({ attacker: enemy, target: sherman, map }).ok;
      }
      return canExecuteAction(enemy, a, sherman, map, occupied);
    };

    if (entry.primary !== 'none' && tryOne(entry.primary)) return entry.primary;
    if (entry.fallback && entry.fallback !== 'none' && tryOne(entry.fallback)) return entry.fallback;
    return null;
  }

  /**
   * 真正执行一次 EnemyAction。返回 'done' = 同步完成，继续下一颗；
   * 返回 'animating' = 已启动动画（移动 / 掷骰 show），调用方必须 return。
   */
  private executeEnemyAction(enemy: Unit, action: EnemyAction): 'done' | 'animating' {
    if (!this.mission) return 'done';
    const { map, sherman } = this.mission;

    switch (action) {
      case 'none':
        return 'done';

      case 'shoot': {
        const started = this.tryEnemyAttack(enemy);
        return started ? 'animating' : 'done';
      }

      case 'turn': {
        if (enemy.facing === null) enemy.facing = 0;
        const occupied = this.buildOccupiedSet(enemy);
        const decision = decideEnemyTurn(enemy, sherman, map, occupied);
        if (decision === 'stay') {
          console.log(`[AI] ${enemy.kind} 转向 → 保持 facing=${enemy.facing}`);
          this.redraw();
          return 'done';
        }
        const step = decision === 'cw' ? 1 : 5;
        const from = enemy.facing;
        const to = rotateDirection(from, step);
        console.log(`[AI] ${enemy.kind} 转向 ${decision.toUpperCase()} → facing=${to}（动画中）`);
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
      case 'reverse': {
        if (enemy.facing === null) return 'done';
        const dir = action === 'advance'
          ? enemy.facing
          : rotateDirection(enemy.facing, 3);
        const to = neighbor(enemy.pos, dir);
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
        console.log(`[AI] ${enemy.kind} ${action === 'advance' ? '前进' : '后退'} → (${to.q},${to.r})`);
        this.redraw();
        return 'animating';
      }

      case 'smoke': {
        enemy.smoked = true;
        console.log(`[AI] ${enemy.kind} 施放烟雾`);
        this.spawnFloater(enemy.pos.q, enemy.pos.r, t('floater.smoke'),
          new Color(200, 200, 220, 255), { size: 24 });
        this.redraw();
        return 'done';
      }

      case 'repair': {
        if (enemy.damaged) {
          enemy.damaged = false;
          console.log(`[AI] ${enemy.kind} 修复成功`);
          this.spawnFloater(enemy.pos.q, enemy.pos.r, t('floater.repair'),
            new Color(160, 220, 160, 255), { size: 24 });
          this.redraw();
        }
        return 'done';
      }

      case 'conceal': {
        enemy.hidden = true;
        console.log(`[AI] ${enemy.kind} 进入隐蔽`);
        this.spawnFloater(enemy.pos.q, enemy.pos.r, t('floater.concealed'),
          new Color(160, 200, 160, 255), { size: 24 });
        this.redraw();
        return 'done';
      }
    }
  }

  /** 构造"其他单位占格"集合，供 canExecuteAction / decideEnemyTurn 使用 */
  private buildOccupiedSet(self: Unit): Set<string> {
    const occ = new Set<string>();
    if (!this.mission) return occ;
    for (const u of this.mission.enemies) {
      if (u === self || u.destroyed) continue;
      occ.add(`${u.pos.q},${u.pos.r}`);
    }
    occ.add(`${this.mission.sherman.pos.q},${this.mission.sherman.pos.r}`);
    return occ;
  }

  private endEnemyPhase() {
    this.turn += 1;
    this.phase = 'player';
    // §2.1 阶段①：移除谢尔曼烟雾（烟雾只保留一回合）
    if (this.mission && this.mission.sherman.smoked) {
      this.mission.sherman.smoked = false;
      this.spawnFloater(this.mission.sherman.pos.q, this.mission.sherman.pos.r,
        t('floater.smokeCleared'), new Color(200, 200, 220, 255),
        { size: 20, dur: 0.8, rise: 22 });
      console.log('[Phase①] 谢尔曼烟雾消散');
    }
    // 清理敌方调度中间态
    this.enemyOrder = [];
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceUsed = [];
    this.destroyEnemyDiceTray();
    // 新回合：三个子阶段重置为"未执行"，由玩家重新选移动/攻击/杂项
    this.playerStep = 'choose';
    this.movementDone = false;
    this.attackDone = false;
    this.miscDone = false;
    this.phaseDice = [];
    this.clearGunSelection();
    // 敌方阶段也可能击毁谢尔曼；重入玩家回合时复查胜负
    if (this.mission) {
      this.outcome = checkOutcome(this.mission);
      this.updateOutcomeOverlay();
    }
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    console.log(`[BattleScene] === 进入回合 ${this.turn}（玩家） ===`);
  }

  // ---------- 交互 ----------

  /**
   * 地图点击统一入口。在新骰子驱动下，玩家只剩下一个"点地图上的敌人"的用处：
   * 攻击阶段选中一颗主炮骰 → 点敌人格触发开火。
   *
   * 移动不走点地图路径了（改为点骰子 → 弹菜单 → 前进/后退/转向），
   * 所以这里除了攻击开火以外不做任何事，避免误点触发。
   */
  private onTouchMap(event: EventTouch) {
    if (!this.mission || !this.mapNode) return;
    if (this.isBusy()) return;         // 移动动画 / 掷骰动画期间都不接受新指令
    if (this.phase !== 'player') return; // 敌方回合不响应点击
    if (this.outcome !== 'ongoing') return; // 胜负已决，不再响应

    // 点骰子托盘上方时由骰子节点自己处理；点在地图上 → 关菜单顺便走后面流程
    this.closeDiePopover();

    // 仅在"攻击阶段 / 杂项阶段 + 已选主炮 / 机枪骰"时响应（否则地图点击无效果，视觉上也无红圈）
    if (this.playerStep !== 'attack' && this.playerStep !== 'misc') return;
    if (this.selectedGunDieIdx < 0 && this.selectedMGDieIdx < 0) return;

    const ut = this.mapNode.getComponent(UITransform);
    if (!ut) return;

    // UI 触点 → MapGraphics 局部坐标
    const uiPos = event.getUILocation();
    const localPos = ut.convertToNodeSpaceAR(new Vec3(uiPos.x, uiPos.y, 0));

    // 找到离触点最近的格
    const tiles = this.mission.map.all();
    let target: Tile | null = null;
    let minDist = Infinity;
    for (const t of tiles) {
      const c = this.project(t.pos.q, t.pos.r);
      const d = Math.hypot(c.x - localPos.x, c.y - localPos.y);
      if (d < minDist) { minDist = d; target = t; }
    }
    if (!target || minDist > this.hexSize) return; // 点空白处

    const enemyOnTile = this.mission.enemies.find(
      e => !e.destroyed && e.pos.q === target!.pos.q && e.pos.r === target!.pos.r,
    );
    if (!enemyOnTile) return;
    // 机枪选中优先：选机枪骰时只对步兵生效；主炮选中走 tryAttack 主炮路径
    if (this.selectedMGDieIdx >= 0) {
      this.tryMGAttack(enemyOnTile);
    } else {
      this.tryAttack(enemyOnTile);
    }
  }

  /**
   * 玩家开火：必须已选中主炮骰 + 已装填 + canAttack 通过。
   * 结算后消耗那颗骰子 + 清空 loaded（手册：一炮一装）。
   */
  private tryAttack(target: Unit) {
    if (!this.mission) return;
    if (this.playerStep !== 'attack' && this.playerStep !== 'misc') return;
    if (this.selectedGunDieIdx < 0) return;
    const { map, sherman } = this.mission;
    const slot = this.phaseDice[this.selectedGunDieIdx];
    if (!slot || slot.used) return;
    // 主炮禁瞄步兵：引导玩家改用机枪骰；不消耗骰，避免误操作损失行动资源
    if (target.kind === 'infantry') {
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
      console.log(`[Combat] cannot attack: ${check.reason}`);
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
    const report = rollAttack({ attacker: sherman, target, map }, this.rng);
    // 骰子先标"用掉了"不行 —— 动画期间得看出主炮骰仍在选中态。
    // 直接把它本局引用在外层闭包，onDone 里再 used = true。
    // §3.6 B 列对子（炮手主炮射击）：开火前记住 partner idx，onDone 时一并消耗。
    const doublesPartnerIdx = this.selectedGunDoublesIdx;
    this.startDiceShow(report, t('actor.player'), target.kind, () => {
      if (!this.mission) return;
      applyAttack(target, report);
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
    });
    // 立即刷新一次 HUD，让"点敌人开火"提示消失
    this.updateHUD();
    this.redraw();
  }

  /**
   * 敌方在结束自身移动子阶段时尝试朝谢尔曼开火（每个敌人 1 发/回合）。
   *
   * 返回值：
   *   true  → 本敌人已启动掷骰动画，runNextEnemyStep 应"暂停"，由 onDone 回调恢复调度
   *   false → 本次未开火（目标已毁 / 无视线 / 胜负已决等），调用方可立即推进下一个敌人
   */
  private tryEnemyAttack(enemy: Unit): boolean {
    if (!this.mission) return false;
    if (enemy.destroyed) return false;
    if (this.outcome !== 'ongoing') return false; // 谢尔曼已死，无需再补刀
    const { map, sherman } = this.mission;
    if (!canAttack({ attacker: enemy, target: sherman, map }).ok) return false;

    // 开火前转向目标，否则可能用错装甲面（其实算的是 sherman 的面，但视觉上敌人面对玩家更合理）
    enemy.facing = approximateDirection(enemy.pos, sherman.pos);
    this.redraw();

    // 发起攻击前把骰子托盘临时收起（避免被 DiceShow 遮罩叠加）
    this.destroyEnemyDiceTray();

    const report = rollAttack({ attacker: enemy, target: sherman, map }, this.rng);
    this.startDiceShow(report, t('actor.enemyPrefix', { name: enemy.kind }), t('actor.sherman'), () => {
      if (!this.mission) return;
      applyAttack(sherman, report);
      this.presentAttackResult(t('actor.enemyPrefix', { name: enemy.kind }), report, enemy, sherman);
      // 本骰打完：回到当前敌坦的下一颗骰（DiceShow 里已经消耗掉的那颗之外）
      if (this.outcome === 'ongoing' && this.phase === 'enemy') {
        // 重新浮出托盘（可能还剩骰子），再继续调度
        if (this.enemyDiceUsed.some(u => !u)) {
          const current = this.enemyOrder[this.enemyIndex];
          if (current && !current.destroyed) this.buildEnemyDiceTray(current, { playSort: false });
        }
        this.runNextEnemyStep();
      }
    });
    return true;
  }

  // ---------- 攻击掷骰动画面板 ----------

  /**
   * 启动攻击掷骰动画。调用方应已经 rollAttack 完拿到 report（保证结果不会在动画中变化），
   * 但 *不要* 自己 applyAttack —— 让本面板在动画末尾回调 onDone，调用方在 onDone
   * 里真正写入伤害 / 弹浮字 / 推进调度。
   *
   * 期间所有玩家与敌方新指令被屏蔽（见 isBusy()），骰子托盘和点击菜单会被关闭。
   */
  private startDiceShow(
    report: AttackReport,
    attackerLabel: string,
    targetLabel: string,
    onDone: () => void,
    opts: { mg?: boolean } = {},
  ) {
    // 已有一个面板在播（理论上不该走到这里，守一下）：先强结束旧的，避免叠加
    if (this.diceShow) this.finalizeDiceShow(/*skip=*/true);
    this.closeDiePopover();

    const mg = !!opts.mg;
    const panel = this.buildDiceShowPanel(report, attackerLabel, targetLabel, mg);
    this.diceShow = {
      stage: 'hit-roll',
      t: 0,
      report,
      attackerLabel,
      targetLabel,
      mg,
      onDone,
      finalized: false,
      panelRoot: panel.root,
      hitDieLabels: panel.hitDieLabels,
      hitSumLabel: panel.hitSumLabel,
      hitNeedLabel: panel.hitNeedLabel,
      hitVerdictLabel: panel.hitVerdictLabel,
      penDieLabel: panel.penDieLabel,
      penNeedLabel: panel.penNeedLabel,
      penVerdictLabel: panel.penVerdictLabel,
      dmgDieLabel: panel.dmgDieLabel,
      dmgTitleLabel: panel.dmgTitleLabel,
      dmgEffectLabel: panel.dmgEffectLabel,
      crewDieLabel: panel.crewDieLabel,
      crewTitleLabel: panel.crewTitleLabel,
      crewEffectLabel: panel.crewEffectLabel,
      outcomeLabel: panel.outcomeLabel,
    };
  }

  /**
   * 构造居中弹出的掷骰面板，返回需要在动画中被 update 的 Label 引用。
   *
   * 布局（Canvas 1280×720 下约占 560×440，居中）：
   *   ┌─────────────────────────────────────┐
   *   │  玩家 → panzer4                      │   标题
   *   │  命中需 ≥7                           │
   *   │   ┌──┐ ┌──┐                          │
   *   │   │ 5│ │ 3│   = 8     命中！          │   2d6 + 判定
   *   │   └──┘ └──┘                          │
   *   │   ┌──┐                                │
   *   │   │ 4│        需 ≥2     击穿！        │   1d6 穿甲（仅命中时出现）
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
    penDieLabel: Label | null;
    penNeedLabel: Label | null;
    penVerdictLabel: Label | null;
    dmgDieLabel: Label | null;
    dmgTitleLabel: Label | null;
    dmgEffectLabel: Label | null;
    crewDieLabel: Label | null;
    crewTitleLabel: Label | null;
    crewEffectLabel: Label | null;
    outcomeLabel: Label;
  } {
    // 只有"命中 + 击穿 + 伤害效果为阵亡检定"时才需要第 4 行
    const needsCrewRow = !mg && report.hit && report.penetrated && report.damageEffect === 'crewCheck';
    const PANEL_W = 560;
    // 机枪模式：只有标题 + 命中阈值 + 2d6 + 结果大字，用更矮的面板
    const PANEL_H = mg ? 280 : needsCrewRow ? 520 : 440;

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
    pg.fillColor = DICE_PANEL_BG;
    pg.strokeColor = DICE_PANEL_BORDER;
    pg.lineWidth = 2;
    pg.rect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H);
    pg.fill();
    pg.stroke();
    root.addChild(panel);

    // 标题
    const title = this.makeCenteredLabel(panel, `${attackerLabel} → ${targetLabel}`,
      0, PANEL_H / 2 - 34, PANEL_W - 40, 34, 26, HUD_TEXT_COLOR);

    // 命中需求：机枪用单独文案（"机枪扫射 需 ≥7"），主炮走原来的命中阈值行
    const hitNeedText = mg
      ? t('dice.panel.mgHitNeed', { n: report.threshold })
      : t('dice.panel.hitNeed', { n: report.threshold });
    const hitNeed = this.makeCenteredLabel(panel, hitNeedText,
      0, PANEL_H / 2 - 72, PANEL_W - 40, 28, 20, DICE_INFO_TEXT);

    // 三/四行骰子等距摆放：hit / pen / dmg (/ crew)
    const DIE_SIZE = 72, DIE_GAP = 24, ROW_GAP = 82;
    const hitDiceY = PANEL_H / 2 - 148;
    const penDiceY = hitDiceY - ROW_GAP;
    const dmgDiceY = penDiceY - ROW_GAP;
    const crewDiceY = dmgDiceY - ROW_GAP;
    const leftDieCenter = -(DIE_SIZE + DIE_GAP / 2);

    // 2d6 两颗骰
    const d1 = this.makeDieSquare(panel, leftDieCenter, hitDiceY, DIE_SIZE);
    const d2 = this.makeDieSquare(panel, leftDieCenter + DIE_SIZE + DIE_GAP, hitDiceY, DIE_SIZE);

    // "= N"
    const hitSum = this.makeCenteredLabel(panel, '= ?',
      96, hitDiceY, 80, 40, 30, DICE_INFO_TEXT);

    // 命中判定文字
    const hitVerdict = this.makeCenteredLabel(panel, '',
      190, hitDiceY, 160, 40, 28, DICE_OK_TEXT);

    // 1d6 穿甲 / 伤害 / 阵亡检定三行只在主炮模式需要；机枪扫射只有 2d6 命中这一段。
    let penDie: Label | null = null;
    let penNeed: Label | null = null;
    let penVerdict: Label | null = null;
    let dmgDie: Label | null = null;
    let dmgTitle: Label | null = null;
    let dmgEffect: Label | null = null;
    let crewDie: Label | null = null;
    let crewTitle: Label | null = null;
    let crewEffect: Label | null = null;
    if (!mg) {
      // 1d6 穿甲骰 + 需求 + 判定
      penDie = this.makeDieSquare(panel, -(DIE_SIZE / 2 + 60), penDiceY, DIE_SIZE);
      penNeed = this.makeCenteredLabel(panel, '',
        70, penDiceY, 170, 28, 18, DICE_INFO_TEXT);
      penVerdict = this.makeCenteredLabel(panel, '',
        200, penDiceY, 160, 40, 28, DICE_OK_TEXT);

      // 1d6 伤害骰 + "伤害检定" + 效果文字
      dmgDie = this.makeDieSquare(panel, -(DIE_SIZE / 2 + 60), dmgDiceY, DIE_SIZE);
      dmgTitle = this.makeCenteredLabel(panel, t('dice.panel.dmgTitle'),
        70, dmgDiceY, 170, 28, 18, DICE_INFO_TEXT);
      dmgEffect = this.makeCenteredLabel(panel, '',
        200, dmgDiceY, 180, 40, 28, DICE_OUTCOME_HIT);

      // 可选：1d6 阵亡检定骰（仅谢尔曼被击穿 + 伤害表 d6=2 时才会出现）
      if (needsCrewRow) {
        crewDie = this.makeDieSquare(panel, -(DIE_SIZE / 2 + 60), crewDiceY, DIE_SIZE);
        crewTitle = this.makeCenteredLabel(panel, t('dice.panel.crewTitle'),
          70, crewDiceY, 170, 28, 18, DICE_INFO_TEXT);
        crewEffect = this.makeCenteredLabel(panel, '',
          200, crewDiceY, 180, 40, 28, DICE_OUTCOME_CREW);
        // 阵亡检定行默认 hidden，直到 crew-roll 才亮
        crewDie.node.parent!.active = false;
        crewTitle.node.active = false;
        crewEffect.node.active = false;
      }

      // 伤害骰行在 dmg-roll 前不应该出现，默认整行 hidden
      // （骰子方块容器 / 标题 / 效果文字 三个节点一起关掉）
      dmgDie.node.parent!.active = false;
      dmgTitle.node.active = false;
      dmgEffect.node.active = false;
    }

    // 底部大字结果
    const outcome = this.makeCenteredLabel(panel, '',
      0, -PANEL_H / 2 + 44, PANEL_W - 40, 48, 36, DICE_OUTCOME_MISS);

    // title / hitNeed 仅作标题用，外部不再更新它们，但避免 TS 报"未使用"，
    // 保留到返回结构里（外部不用就不用，Label 生命周期跟随 root.destroy 自动回收）
    void title;

    return {
      root,
      hitDieLabels: [d1, d2],
      hitSumLabel: hitSum,
      hitNeedLabel: hitNeed,
      hitVerdictLabel: hitVerdict,
      penDieLabel: penDie,
      penNeedLabel: penNeed,
      penVerdictLabel: penVerdict,
      dmgDieLabel: dmgDie,
      dmgTitleLabel: dmgTitle,
      dmgEffectLabel: dmgEffect,
      crewDieLabel: crewDie,
      crewTitleLabel: crewTitle,
      crewEffectLabel: crewEffect,
      outcomeLabel: outcome,
    };
  }

  /** 在 panel 下挂一个带白底黑边的骰子方块 + 内部点数 Label，返回 Label 便于后续 setString。 */
  private makeDieSquare(parent: Node, x: number, y: number, size: number): Label {
    const container = new Node('Die');
    container.layer = this.node.layer;
    container.addComponent(UITransform).setContentSize(size, size);
    container.setPosition(x, y, 0);
    const bg = container.addComponent(Graphics);
    bg.fillColor = DICE_DIE_FILL;
    bg.strokeColor = DICE_DIE_BORDER;
    bg.lineWidth = 2;
    bg.rect(-size / 2, -size / 2, size, size);
    bg.fill();
    bg.stroke();
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
    return l;
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
    const slotCenterX = (slot: number) =>
      -m.totalW / 2 + m.dieSize / 2 + slot * (m.dieSize + m.gap);
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

    const DIE_SIZE = ENEMY_AI_DIE_SIZE;
    const GAP = ENEMY_AI_DIE_GAP;
    const totalW = count * DIE_SIZE + (count - 1) * GAP;
    const subtitleH = 22;
    const headerBand = 28;
    const trayH = headerBand + DIE_SIZE + subtitleH + 8;
    const rowY = -subtitleH / 2 - 4;

    this.enemyTrayMetrics = { dieSize: DIE_SIZE, gap: GAP, totalW, count, rowY };

    const exec = this.enemyDiceExecOrder.length === count
      ? this.enemyDiceExecOrder
      : this.computeEnemyDiceExecOrder();
    const toSlot = this.enemyDice.map((_, i) => exec.indexOf(i));
    const fromSlot = this.enemyDice.map((_, i) => i);

    const root = new Node('EnemyDiceTray');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(totalW, trayH);
    // 左上固定区：避免与右侧状态栏/齿轮重叠；且必须挂在 this.node 子节点**最后**，
    // 否则 insertChild 插在 Map 后、仍排在全部 HUD 之前，会被半透明状态栏整块盖住。
    root.setPosition(-400, 268, 0);
    this.node.addChild(root);
    root.setSiblingIndex(this.node.children.length - 1);

    const header = new Node('AICol');
    header.layer = this.node.layer;
    header.addComponent(UITransform).setContentSize(totalW + 48, 24);
    header.setPosition(0, trayH / 2 - headerBand / 2 - 2, 0);
    const hl = header.addComponent(Label);
    hl.fontSize = 22;
    hl.lineHeight = 26;
    hl.color = new Color(230, 230, 200, 255);
    hl.horizontalAlign = HorizontalTextAlignment.CENTER;
    hl.verticalAlign = VerticalTextAlignment.CENTER;
    hl.string = t('dice.aiHeader', { col: this.enemyAICol, n: count });
    hl.enableOutline = true;
    hl.outlineColor = new Color(0, 0, 0, 220);
    hl.outlineWidth = 2;
    root.addChild(header);

    this.enemyDiceTraySubject = enemy;
    this.enemyDiceTrayLabels = [];
    this.enemyDiceTrayTileGraphics = [];
    this.enemyDiceTrayDieRoots = [];
    this.enemyDiceTraySubtitleLabels = [];

    const slotCenterX = (slot: number) =>
      -totalW / 2 + DIE_SIZE / 2 + slot * (DIE_SIZE + GAP);

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
      tile.setPosition(0, subtitleH / 2 + 2, 0);
      const g = tile.addComponent(Graphics);
      g.lineWidth = 2;
      g.strokeColor = new Color(30, 30, 30, 255);
      g.fillColor = new Color(240, 230, 130, 255);
      g.rect(-DIE_SIZE / 2, -DIE_SIZE / 2, DIE_SIZE, DIE_SIZE);
      g.fill();
      g.stroke();
      dieRoot.addChild(tile);

      const labNode = new Node('Face');
      labNode.layer = this.node.layer;
      labNode.addComponent(UITransform).setContentSize(DIE_SIZE, DIE_SIZE);
      const l = labNode.addComponent(Label);
      l.fontSize = 30;
      l.lineHeight = 34;
      l.color = new Color(20, 20, 20, 255);
      l.horizontalAlign = HorizontalTextAlignment.CENTER;
      l.verticalAlign = VerticalTextAlignment.CENTER;
      l.string = String(this.enemyDice[i]);
      tile.addChild(labNode);

      this.enemyDiceTrayLabels.push(l);
      this.enemyDiceTrayTileGraphics.push(g);

      const subNode = new Node('Action');
      subNode.layer = this.node.layer;
      subNode.addComponent(UITransform).setContentSize(DIE_SIZE + 16, subtitleH);
      subNode.setPosition(0, -DIE_SIZE / 2 - 8, 0);
      const sub = subNode.addComponent(Label);
      sub.fontSize = 13;
      sub.lineHeight = 15;
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
    const DIE_SIZE = m?.dieSize ?? ENEMY_AI_DIE_SIZE;
    const enemy = this.enemyDiceTraySubject;
    for (let i = 0; i < this.enemyDiceTrayLabels.length; i++) {
      const used = !!this.enemyDiceUsed[i];
      const hi = i === this.enemyDiceHighlightIdx;
      const lab = this.enemyDiceTrayLabels[i];
      if (lab) {
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
      g.fillColor = used
        ? new Color(160, 150, 100, 220)
        : new Color(240, 230, 130, 255);
      g.strokeColor = hi
        ? new Color(255, 200, 80, 255)
        : new Color(30, 30, 30, 255);
      g.lineWidth = hi ? 3.5 : 2;
      g.rect(-DIE_SIZE / 2, -DIE_SIZE / 2, DIE_SIZE, DIE_SIZE);
      g.fill();
      g.stroke();
      const parent = lab?.node.parent;
      if (parent) parent.setScale(used && !hi ? 0.9 : 1, used && !hi ? 0.9 : 1, 1);
    }
  }

  /** 销毁敌方骰子托盘（切敌方单位 / 结束敌方阶段 / 开火掷骰前收起用） */
  private destroyEnemyDiceTray() {
    this.enemyDiceSortAnim = null;
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
   *   若击穿：pen-show → dmg-roll (DICE_DMG_ROLL_DUR) → dmg-show (揭示 1d6 + 伤害效果)
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
        show.hitDieLabels[0].string = String(p1);
        show.hitDieLabels[1].string = String(p2);
        show.hitSumLabel.string = '= ?';
        if (show.t >= DICE_HIT_ROLL_DUR) {
          show.stage = 'hit-show';
          show.t = 0;
          show.hitDieLabels[0].string = String(show.report.dice[0]);
          show.hitDieLabels[1].string = String(show.report.dice[1]);
          show.hitSumLabel.string = `= ${show.report.roll}`;
          if (show.report.hit) {
            show.hitVerdictLabel.string = t('dice.panel.hitYes');
            show.hitVerdictLabel.color = DICE_OK_TEXT;
          } else {
            show.hitVerdictLabel.string = t('dice.panel.hitNo');
            show.hitVerdictLabel.color = DICE_FAIL_TEXT;
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
            show.stage = 'hold';
            if (show.report.hit) {
              show.outcomeLabel.string = t('dice.panel.outcomeMGKill');
              show.outcomeLabel.color = DICE_OUTCOME_HIT;
            } else {
              show.outcomeLabel.string = t('dice.panel.outcomeMiss');
              show.outcomeLabel.color = DICE_OUTCOME_MISS;
            }
          } else if (!show.report.hit) {
            // 未命中直接跳到 hold 显示 MISS，并隐藏穿甲骰那一行（视觉更干净）
            show.stage = 'hold';
            if (show.penDieLabel) show.penDieLabel.node.parent!.active = false;
            if (show.penNeedLabel) show.penNeedLabel.node.active = false;
            if (show.penVerdictLabel) show.penVerdictLabel.node.active = false;
            show.outcomeLabel.string = t('dice.panel.outcomeMiss');
            show.outcomeLabel.color = DICE_OUTCOME_MISS;
          } else {
            // 准备 pen 阶段：标题文字 + 骰子进入滚动
            show.stage = 'pen-roll';
            if (show.penNeedLabel && show.report.penThreshold !== undefined) {
              const thr = show.report.penThreshold;
              show.penNeedLabel.string = thr <= 0
                ? t('dice.panel.penMustPen')
                : thr >= 7
                  ? t('dice.panel.penCantPen')
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
        if (show.penDieLabel) show.penDieLabel.string = String(p);
        if (show.t >= DICE_PEN_ROLL_DUR) {
          show.stage = 'pen-show';
          show.t = 0;
          if (show.penDieLabel && show.report.penDie !== undefined) {
            show.penDieLabel.string = String(show.report.penDie);
          }
          if (show.penVerdictLabel) {
            if (show.report.penetrated) {
              show.penVerdictLabel.string = t('dice.panel.penYes');
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
            show.stage = 'hold';
            if (show.dmgDieLabel) show.dmgDieLabel.node.parent!.active = false;
            if (show.dmgEffectLabel) show.dmgEffectLabel.node.active = false;
            show.outcomeLabel.string = t('dice.panel.outcomeRic');
            show.outcomeLabel.color = DICE_OUTCOME_RIC;
          } else {
            // 准备伤害检定阶段：打开该行可见性 + 骰子进入滚动
            show.stage = 'dmg-roll';
            if (show.dmgDieLabel) {
              show.dmgDieLabel.node.parent!.active = true;
              show.dmgDieLabel.string = '?';
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
        if (show.dmgDieLabel) show.dmgDieLabel.string = String(p);
        if (show.t >= DICE_DMG_ROLL_DUR) {
          show.stage = 'dmg-show';
          show.t = 0;
          if (show.dmgDieLabel && show.report.damageDie !== undefined) {
            show.dmgDieLabel.string = String(show.report.damageDie);
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
          if (show.report.damageEffect === 'crewCheck' && show.report.crewCheck) {
            // 阵亡检定：再掷一颗 1d6 决定死谁
            show.stage = 'crew-roll';
            if (show.crewDieLabel) {
              show.crewDieLabel.node.parent!.active = true;
              show.crewDieLabel.string = '?';
            }
            if (show.crewTitleLabel) show.crewTitleLabel.node.active = true;
            if (show.crewEffectLabel) {
              show.crewEffectLabel.node.active = true;
              show.crewEffectLabel.string = '';
            }
          } else {
            show.stage = 'hold';
            const out = damageOutcomeLabel(show.report.damageEffect);
            show.outcomeLabel.string = out.text;
            show.outcomeLabel.color = out.color;
          }
        }
        break;
      }
      case 'crew-roll': {
        const frame = Math.floor(show.t / DICE_CYCLE_INTERVAL);
        const p = ((frame * 29) % 6) + 1;
        if (show.crewDieLabel) show.crewDieLabel.string = String(p);
        if (show.t >= DICE_CREW_ROLL_DUR) {
          show.stage = 'crew-show';
          show.t = 0;
          const cc = show.report.crewCheck;
          if (show.crewDieLabel && cc) {
            // 重抛过的情况下仍然展示最终那次的点数
            show.crewDieLabel.string = cc.die > 0 ? String(cc.die) : '-';
          }
          if (show.crewEffectLabel) {
            const lab = crewDeathLabel(cc);
            show.crewEffectLabel.string = lab.text;
            show.crewEffectLabel.color = lab.color;
          }
        }
        break;
      }
      case 'crew-show': {
        if (show.t >= DICE_CREW_SHOW_DUR) {
          show.t = 0;
          show.stage = 'hold';
          const out = crewOutcomeLabel(show.report.crewCheck);
          show.outcomeLabel.string = out.text;
          show.outcomeLabel.color = out.color;
        }
        break;
      }
      case 'hold': {
        if (show.t >= DICE_HOLD_DUR) {
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
    this.diceShow = null;
    if (show.panelRoot.isValid) show.panelRoot.destroy();
    if (!skip && !show.finalized) {
      show.finalized = true;
      show.onDone();
    }
  }

  /** 当前是否处于"不接受新指令"的过场态：移动动画中 / 掷骰动画中都算。 */
  private isBusy(): boolean {
    return this.anim !== null || this.diceShow !== null || this.enemyDiceSortAnim !== null;
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
    const base = `[Combat] ${actor} 2d6=${report.dice[0]}+${report.dice[1]}=${report.roll} 需要${report.threshold}`;
    let text: string;
    let color: Color;
    let size: number;
    if (!report.hit) {
      console.log(`${base} → miss`);
      text = t('dice.panel.outcomeMiss'); color = new Color(230, 230, 230, 255); size = 32;
    } else {
      const armorInfo = `hit ${report.armorFace} (armor${report.armor} / pen${report.penetration})`
        + ` 1d6=${report.penDie} need${report.penThreshold}`;
      if (!report.penetrated) {
        console.log(`${base} → ${armorInfo} → ricochet`);
        text = t('dice.panel.outcomeRic'); color = new Color(180, 200, 240, 255); size = 34;
      } else {
        const effect = report.damageEffect;
        const dmgInfo = `伤害1d6=${report.damageDie} → ${effect ?? 'unknown'}`;
        if (effect === 'crewCheck' && report.crewCheck) {
          // 阵亡检定：把 crew 骰 + 结果也打到日志
          const cc = report.crewCheck;
          const crewInfo = cc.slot === null
            ? `阵亡检定1d6=${cc.die} → 虚惊（舱盖关）`
            : `阵亡检定1d6=${cc.die} → ${crewRoleName(cc.slot)} 阵亡`
              + (cc.rerolled ? '（有已死乘员重抛）' : '');
          console.log(`${base} → ${armorInfo} → 击穿 → ${dmgInfo} → ${crewInfo} → ${target.kind}`);
          const out = crewOutcomeLabel(cc);
          text = out.text;
          color = out.color;
          size = cc.slot === null ? 36 : 44;
        } else {
          console.log(`${base} → ${armorInfo} → 击穿 → ${dmgInfo} → ${target.kind}`);
          const out = damageOutcomeLabel(effect);
          text = out.text;
          color = out.color;
          // 摧毁用最大号字，其余中号；受损系列视觉权重稍低
          size = effect === 'destroyed' ? 50 : effect === 'damaged' ? 38 : 42;
        }
      }
    }
    this.spawnFloater(target.pos.q, target.pos.r, text, color, { size });
    this.redraw();

    this.outcome = checkOutcome(this.mission);
    if (this.outcome !== 'ongoing') {
      this.updateOutcomeOverlay();
    }
  }
}
