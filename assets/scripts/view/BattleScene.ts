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
 *   - 右下角按钮："下一阶段"（结束当前阶段或直接进入下一个未执行阶段；两阶段都用完后变红
 *     切成"结束回合"，点击才真正进入敌方阶段）
 *   - 敌方坦克贪心地向谢尔曼移动，移动结束后若有视线 → 立即开火（每敌 1 发/回合）
 *   - 摧毁任务目标单位 → 屏幕中央"胜利！"；谢尔曼被摧毁 → "战败"
 *   - 胜负出现后下方"再来一局"按钮可点击重置整局，使用同一份任务 JSON
 *   - 右上"存档 / 读档"：单槽 localStorage，仅"阶段选择"子步骤且无动画时可存
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
  sys,
  UITransform,
  Vec3,
  VerticalTextAlignment,
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
  classifyMoveDie,
  rollActionDice,
} from '../core/ActionDice';
import { applyAttack, AttackReport, canAttack, CrewDeathResult, DamageEffect, hitThreshold, rollAttack } from '../core/Combat';
import { RNG } from '../core/Dice';
import { t } from '../core/Lang';
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
import { applySave, captureSave, SAVE_KEY, SaveData } from '../core/SaveLoad';
import { MissionData, TerrainType, Tile, Unit } from '../core/types';

const { ccclass, property } = _decorator;

/** 三阶缓出：起步快、收尾慢，最适合"惯性滑停"的坦克移动 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

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

/** 任意单位正在播放的移动动画（谢尔曼 / 敌坦克通用） */
interface MoveAnim {
  unit: Unit;    // 当前正在动画的单位
  fromQ: number;
  fromR: number;
  toQ: number;
  toR: number;
  t: number;     // 0..1
  dur: number;   // 秒
}

type Phase = 'player' | 'enemy';

/**
 * 玩家回合内的细分状态机：
 *   - 'choose'     : 等待玩家选择进入"移动阶段"还是"攻击阶段"
 *   - 'movement'   : 正在执行移动阶段，骰子托盘展示着本阶段剩余移动骰
 *   - 'attack'     : 正在执行攻击阶段；选中一颗主炮骰后进入"选目标"态，
 *                    点击敌人开火，结算后骰子从托盘消失
 * 两个阶段同一回合内互不可重复执行；两个都执行过后回合内"下一阶段"按钮变红切为
 * "结束回合"，再点才真正把控制权交给敌方。
 */
type PlayerStep = 'choose' | 'movement' | 'attack';

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
  forest:   new Color( 70, 130,  60, 255),
  building: new Color(110, 100,  90, 255),
  water:    new Color( 90, 145, 200, 255),
};

const FACTION_COLORS = {
  allied: new Color( 60, 160,  80, 255),
  german: new Color( 60,  60,  60, 255),
};

const HEDGE_COLOR        = new Color( 35,  90,  35, 255);
const TILE_BORDER        = new Color( 40,  40,  40, 220);
const FACING_COLOR       = new Color(255, 210,  60, 255);
const UNIT_BORDER        = new Color(255, 255, 255, 255);
// HUD 配色：两阶段都执行过后按钮换成"提醒色"，引导玩家结束回合
const BTN_BG_NORMAL  = new Color( 60,  90, 140, 230);
const BTN_BG_URGENT  = new Color(190,  80,  60, 240);
const BTN_BORDER     = new Color(255, 255, 255, 255);
const HUD_TEXT_COLOR = new Color(255, 255, 255, 255);

// 阶段选择条配色：两个按钮，红/蓝不同色；已执行过的阶段被灰掉禁用
const PHASE_BTN_MOVE      = new Color( 60, 130,  80, 230);
const PHASE_BTN_ATTACK    = new Color(160,  70,  70, 230);
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
// 持久化状态文字（"起火" / "已毁"），在单位下方绘制
const STATUS_TEXT_FIRE = new Color(255, 200,  60, 255);
const STATUS_TEXT_DEAD = new Color(220,  60,  60, 255);
const STATUS_TEXT_OUT  = new Color(  0,   0,   0, 220);
// 可攻击目标（视线中、非摧毁敌方）高亮
const ATTACKABLE_COLOR = new Color(255,  60,  60, 255);

// 命中预览：按 2d6≥N 的成功概率分四档配色
const PREVIEW_COLOR_GREAT = new Color(120, 240, 120, 255); // ≥70%
const PREVIEW_COLOR_GOOD  = new Color(240, 220,  90, 255); // 40%~70%
const PREVIEW_COLOR_FAIR  = new Color(240, 160,  60, 255); // 20%~40%
const PREVIEW_COLOR_BAD   = new Color(240,  90,  90, 255); // <20%
// 黑色描边让浅色字在任意地形上都能看清
const PREVIEW_OUTLINE     = new Color(  0,   0,   0, 200);

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

@ccclass('BattleScene')
export class BattleScene extends Component {

  @property({ tooltip: '六角形单边长度（像素）。地图过大请调小，过小请调大。' })
  hexSize: number = 26;

  @property({ tooltip: '任务 JSON 在 resources/ 下的相对路径，无需扩展名。' })
  missionPath: string = 'missions/mission_01';

  @property({ tooltip: '是否在谢尔曼周围高亮可移动的相邻格' })
  showReachable: boolean = true;

  @property({ tooltip: '谢尔曼移动一格的动画时长（秒）' })
  moveDuration: number = 0.28;

  @property({ tooltip: '【已废弃】敌方旧版贪心移动预算；GDD §3.7 骰子驱动 AI 已接管，保留仅为场景资源兼容' })
  movesPerTurn: number = 2;

  @property({ tooltip: '战斗随机种子；留 0 用时间种子，非 0 便于复现' })
  rngSeed: number = 0;

  private g: Graphics | null = null;
  private mapNode: Node | null = null;
  private mission: LoadedMission | null = null;
  private offsetX = 0;
  private offsetY = 0;
  private anim: MoveAnim | null = null;

  // 回合状态
  private turn: number = 1;
  private phase: Phase = 'player';
  /** 玩家回合内的子状态机（见 PlayerStep 注释） */
  private playerStep: PlayerStep = 'choose';
  /** 本回合是否已经执行过移动阶段 / 攻击阶段；两个都 true → 下一阶段按钮切为"结束回合" */
  private movementDone: boolean = false;
  private attackDone: boolean = false;
  /** 当前子阶段（movement/attack）手上的骰子；回到 choose 时清空 */
  private phaseDice: DieSlot[] = [];
  /** 攻击阶段玩家点击某颗主炮骰 → 进入"选目标"态，这里记录那颗骰在 phaseDice 的下标。-1 = 未选 */
  private selectedGunDieIdx: number = -1;

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
  // 战斗 / 胜负
  private rng: RNG = new RNG(1);
  private outcome: MissionOutcome = 'ongoing';
  private outcomeLabel: Label | null = null;
  private restartBtn: Node | null = null;
  // 战报浮字池：挂在 mapNode 下，随 update() 上浮 + 渐隐自毁
  private floaters: Floater[] = [];
  // 命中预览 Label 池：常驻显示，随 redraw 整批重建
  private previewLabels: Node[] = [];
  // 单位状态文字池（起火 / 已毁）：随 redraw 整批重建
  private statusLabels: Node[] = [];

  // HUD
  private hudLabel: Label | null = null;
  private endTurnBtn: Node | null = null;
  private endTurnBg: Graphics | null = null;
  private endTurnLabel: Label | null = null;
  /** 底部"阶段选择"条的两个按钮；在 choose 子步骤可见，其他子步骤隐藏 */
  private chooseBar: Node | null = null;
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

  // ---- 右侧谢尔曼状态面板 ----
  private statusPanel: Node | null = null;
  private statusLoaded: Label | null = null;   // 装填 / 未装填
  private statusHatch: Label | null = null;    // 舱盖开 / 舱盖关
  private statusFire: Label | null = null;     // 完好 / 起火 / 已毁
  private statusTurret: Label | null = null;   // 完好 / 受损
  private statusMobility: Label | null = null; // 正常 / 痛痪
  private statusCrewLabels: Label[] = [];      // 5 个乘员值标签（车长..副驾驶）

  // 存档/读档
  private missionId: string = '';

  onLoad() {
    // 把 battle 节点提到 Canvas 兄弟列表最末（=渲染最上层），
    // 避免被同 Canvas 的其他 UI 元素（SpriteSplash / 登录 等）遮挡。
    const parentNode = this.node.parent;
    if (parentNode) {
      this.node.setSiblingIndex(parentNode.children.length - 1);
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

    // 注册触摸事件（点击地图任意位置）
    gNode.on(Node.EventType.TOUCH_END, this.onTouchMap, this);

    // HUD：回合数 + 阶段信息 + 下一阶段按钮
    this.buildHUD();
    // 底部阶段选择条 + 骰子托盘（空的，交给 refreshPhaseUI 根据状态切换可见性）
    this.buildChooseBar();
    this.buildDiceTray();

    // 从 resources/ 加载任务 JSON（注意：路径不含扩展名）
    resources.load(this.missionPath, JsonAsset, (err, asset) => {
      if (err || !asset) {
        console.error('[BattleScene] 加载任务失败:', this.missionPath, err);
        return;
      }
      this.loadAndDraw(asset.json as MissionData);
    });
  }

  // ---------- 状态 ----------

  private loadAndDraw(data: MissionData) {
    this.missionId = data.id;
    this.mission = loadMission(data);
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
    this.phaseDice = [];
    this.selectedGunDieIdx = -1;
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
    // 命中预览 Label 是常驻节点（非纯 Graphics），需要随每次重绘整批重建，
    // 否则谢尔曼移动后旧位置的预览会留在屏幕上误导玩家。
    this.clearPreviewLabels();

    // 右侧状态面板同步。redraw 是唯一"真相源"：任何动作（移动/转向/装填/
    // 开舱盖/命中/摧毁）走到 redraw 前，相关状态字段都已落位。
    this.refreshStatusPanel();

    const { map, sherman, enemies } = this.mission;
    const tiles = map.all();

    // 1. 地形格
    for (const t of tiles) {
      const c = this.project(t.pos.q, t.pos.r);
      this.drawHex(c.x, c.y, this.hexSize, TERRAIN_COLORS[t.terrain]);
    }

    // 2. 树篱
    for (const t of tiles) {
      if (!t.hedges) continue;
      const c = this.project(t.pos.q, t.pos.r);
      for (let i = 0; i < 6; i++) {
        if (t.hedges[i]) this.drawHedgeEdge(c.x, c.y, this.hexSize, i);
      }
    }

    // 3. 驾驶候选格高亮：仅"移动阶段"+ 未在动画 + 胜负未决；两格方向分色
    if (this.showReachable && !this.anim
        && this.phase === 'player' && this.playerStep === 'movement'
        && this.outcome === 'ongoing') {
      this.drawDriveCandidates();
    }

    // 4. 可攻击目标高亮：仅"攻击阶段 + 已选中主炮骰"时展示
    //    —— 避免玩家在装填未做/未选骰时被红圈误导以为能直接点敌人开火
    if (!this.anim && this.phase === 'player'
        && this.playerStep === 'attack' && this.selectedGunDieIdx >= 0
        && this.outcome === 'ongoing') {
      this.drawAttackableHighlights();
    }

    // 5. 单位 —— 正在动画的那个用插值像素坐标，其余用本格坐标
    this.drawUnitMaybeAnim(sherman);
    for (const e of enemies) this.drawUnitMaybeAnim(e);

    // 6. 单位状态常驻文字（起火 / 已毁），整批重建
    this.clearStatusLabels();
    this.spawnStatusLabelIfAny(sherman);
    for (const e of enemies) this.spawnStatusLabelIfAny(e);
  }

  private drawAttackableHighlights() {
    if (!this.g || !this.mission) return;
    const { map, sherman, enemies } = this.mission;
    for (const e of enemies) {
      if (e.destroyed) continue;
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

  /** 给"起火/已毁"的单位在格子下方挂一条短文字，整批生成、整批销毁。 */
  private spawnStatusLabelIfAny(u: Unit) {
    if (!this.mapNode) return;
    if (!u.damaged && !u.destroyed) return;
    const c = (this.anim && this.anim.unit === u)
      ? this.interpolatedPos(u)
      : this.project(u.pos.q, u.pos.r);
    const text = u.destroyed ? t('unit.status.destroyed') : t('unit.status.fire');
    const color = u.destroyed ? STATUS_TEXT_DEAD : STATUS_TEXT_FIRE;

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

  /** 单位若正在动画，返回插值像素位置；否则等价 project(u.pos)。给状态文字定位用。 */
  private interpolatedPos(u: Unit): { x: number; y: number } {
    if (!this.anim || this.anim.unit !== u) return this.project(u.pos.q, u.pos.r);
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

  /** 同一接口画任意单位：若该单位正是当前动画对象，使用插值位置 */
  private drawUnitMaybeAnim(u: Unit) {
    if (this.anim && this.anim.unit === u) {
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

    if (!this.anim || !this.mission) return;
    this.anim.t += dt / this.anim.dur;
    if (this.anim.t < 1) {
      this.redraw();
      return;
    }
    // 动画结束：把数据真正落到目标格，清空状态
    const finishedUnit = this.anim.unit;
    finishedUnit.pos = { q: this.anim.toQ, r: this.anim.toR };
    this.anim = null;
    this.redraw();
    console.log(
      `[BattleScene] ${finishedUnit.kind} 到达 (q=${finishedUnit.pos.q}, r=${finishedUnit.pos.r})`,
    );
    // 若处于敌方阶段，紧接着调度下一步
    if (this.phase === 'enemy') {
      // 动画结束后若该敌坦还剩骰子，重新浮出托盘再继续
      if (this.outcome === 'ongoing' && this.enemyDiceUsed.some(u => !u)) {
        const current = this.enemyOrder[this.enemyIndex];
        if (current && !current.destroyed) this.buildEnemyDiceTray(current);
      }
      this.runNextEnemyStep();
      return;
    }
    // 玩家驾驶结束后：更新 HUD（移动后可能改变可攻目标）+ 检查骰子是否用尽
    if (this.phase === 'player' && this.playerStep === 'movement') {
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
   *   - 如果该方向的目标格越界 / 地形不可入 / 有活着的敌人 => 画红描边提示不可入
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

  /** 实心六边形 */
  private drawHex(cx: number, cy: number, size: number, fill: Color) {
    const g = this.g!;
    g.fillColor = fill;
    g.strokeColor = TILE_BORDER;
    for (let i = 0; i < 6; i++) {
      const angle = (-30 + 60 * i) * Math.PI / 180;
      const x = cx + size * Math.cos(angle);
      const y = cy + size * Math.sin(angle);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.close();
    g.fill();
    g.stroke();
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

  /** 第 dir 条边的树篱 */
  private drawHedgeEdge(cx: number, cy: number, size: number, dir: number) {
    const g = this.g!;
    const a1 = (-30 + 60 * (dir)) * Math.PI / 180;
    const a2 = (-30 + 60 * (dir + 1)) * Math.PI / 180;
    g.strokeColor = HEDGE_COLOR;
    g.lineWidth = 5;
    g.moveTo(cx + size * Math.cos(a1), cy + size * Math.sin(a1));
    g.lineTo(cx + size * Math.cos(a2), cy + size * Math.sin(a2));
    g.stroke();
    g.lineWidth = 2;
  }

  /** 单位：圆 + 朝向短线。可传 overrideX/Y 以画在动画插值位置。 */
  private drawUnit(u: Unit, overrideX?: number, overrideY?: number) {
    const g = this.g!;
    const c = overrideX !== undefined && overrideY !== undefined
      ? { x: overrideX, y: overrideY }
      : this.project(u.pos.q, u.pos.r);
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

    // 起火：鲜橙填充 + 亮黄边 + 外层橙红环（保留阵营辨识度时仍以"危险色"为主）
    if (u.damaged) {
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

    if (u.facing !== null) {
      // 用"邻居中心 - 自身中心"得到屏幕方向，避免手算 Y 轴翻转
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

    // ---- 右上角"存档 / 读档"按钮 ----
    // 放在右上角而非底部，视觉上和"战局操作"（结束回合）分区：上=元操作，下=回合内行动
    this.makeSimpleButton('SaveBtn', t('btn.save'),
      640 - 70 - 16, 360 - 24 - 16,
      new Color(60, 120, 80, 230),
      () => this.onSave());
    this.makeSimpleButton('LoadBtn', t('btn.load'),
      640 - 70 - 16 - 140 - 10, 360 - 24 - 16,
      new Color(80, 60, 130, 230),
      () => this.onLoad_Save());

    // ---- 右侧谢尔曼状态面板（车体 + 乘员） ----
    this.buildStatusPanel();
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
   * 右侧常驻信息面板，按 GDD 5.1 的"右侧信息面板"简化实装：
   *   ┌──────────────────┐
   *   │   谢尔曼状态       │
   *   │  装填    未装填    │
   *   │  舱盖    关闭      │
   *   │  车体    起火(2)   │
   *   │  炮塔    受损      │
   *   │  机动    痛痪      │
   *   │  ─────────────     │
   *   │   乘员             │
   *   │  ① 车长    存活    │
   *   │  ② 装填手  存活    │
   *   │  ③ 炮手    存活    │
   *   │  ④ 驾驶员  存活    │
   *   │  ⑤ 副驾驶  存活    │
   *   └──────────────────┘
   *
   * 每行左列 = 灰色固定名字，右列 = 根据数据着色的状态文字；
   * refresh 时只改 string + color，不重建节点。
   */
  private buildStatusPanel() {
    const W = 220, H = 400;
    // 锚在右侧：存档/读档按钮下方再留一点空隙
    const x = 640 - W / 2 - 10;
    const y = 360 - 16 - 24 - 16 - H / 2 - 8;

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
    // 车体 5 行与乘员 5 行之间的分隔线
    const sepY = -H / 2 + 160;
    bg.strokeColor = new Color(120, 120, 120, 200);
    bg.lineWidth = 1;
    bg.moveTo(-W / 2 + 16, sepY);
    bg.lineTo( W / 2 - 16, sepY);
    bg.stroke();
    this.node.addChild(panel);
    this.statusPanel = panel;

    // 顶部标题
    this.makeCenteredLabel(panel, t('status.panelTitle'),
      0, H / 2 - 22, W - 20, 28, 22, STATUS_TITLE_COLOR);

    // 车体状态 5 行（装填 / 舱盖 / 车体 / 炮塔 / 机动）—— 等距 28px
    const BODY_TOP = H / 2 - 60;
    const BODY_GAP = 28;
    const bodyRowY = [0, 1, 2, 3, 4].map(i => BODY_TOP - i * BODY_GAP);
    const bodyRows: Array<[string, 'loaded' | 'hatch' | 'fire' | 'turret' | 'mobility']> = [
      [t('status.row.loaded'),   'loaded'],
      [t('status.row.hatch'),    'hatch'],
      [t('status.row.fire'),     'fire'],
      [t('status.row.turret'),   'turret'],
      [t('status.row.mobility'), 'mobility'],
    ];
    let hatchRowY = 0;
    for (let i = 0; i < bodyRows.length; i++) {
      const [label, key] = bodyRows[i];
      this.makeLeftLabel(panel, label, -W / 2 + 20, bodyRowY[i], 100, 22, 18, STATUS_LABEL_COLOR);
      const val = this.makeRightLabel(panel, '—', W / 2 - 20, bodyRowY[i], 120, 22, 18, STATUS_VALUE_DOWN);
      switch (key) {
        case 'loaded':   this.statusLoaded = val; break;
        case 'hatch':    this.statusHatch = val; hatchRowY = bodyRowY[i]; break;
        case 'fire':     this.statusFire = val; break;
        case 'turret':   this.statusTurret = val; break;
        case 'mobility': this.statusMobility = val; break;
      }
    }

    // GDD §2.1：舱盖在"选择阶段"可自由切换；进入移动/攻击后本回合锁定。
    // 为避免额外按钮挤占界面，直接把整行做成点击热区 → 调用 tryToggleHatch()。
    const hatchHit = new Node('HatchHit');
    hatchHit.layer = this.node.layer;
    hatchHit.addComponent(UITransform).setContentSize(W - 24, BODY_GAP);
    hatchHit.setPosition(0, hatchRowY, 0);
    hatchHit.on(Node.EventType.TOUCH_END, () => this.tryToggleHatch(), this);
    panel.addChild(hatchHit);

    // 乘员小标题
    this.makeCenteredLabel(panel, t('status.row.crewTitle'),
      0, sepY - 22, W - 20, 24, 20, STATUS_TITLE_COLOR);

    // 5 名乘员行：编号 + 称谓 + 状态
    const crewNames = [
      t('status.crew.1'),
      t('status.crew.2'),
      t('status.crew.3'),
      t('status.crew.4'),
      t('status.crew.5'),
    ];
    const crewTopY = sepY - 54;
    this.statusCrewLabels = [];
    for (let i = 0; i < crewNames.length; i++) {
      const rowY = crewTopY - i * 26;
      this.makeLeftLabel(panel, crewNames[i], -W / 2 + 20, rowY, 120, 22, 18, STATUS_LABEL_COLOR);
      const val = this.makeRightLabel(panel, t('status.val.crewAlive'), W / 2 - 20, rowY, 70, 22, 18, STATUS_VALUE_OK);
      this.statusCrewLabels.push(val);
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

    // 舱盖
    if (this.statusHatch) {
      if (s.destroyed) {
        this.statusHatch.string = '—';
        this.statusHatch.color = STATUS_VALUE_DOWN;
      } else if (s.hatchOpen) {
        // 舱盖开 = 行动骰+1 但易被步兵 / 对子击杀车长 → 用警告色
        this.statusHatch.string = t('status.val.hatchOpen');
        this.statusHatch.color = STATUS_VALUE_WARN;
      } else {
        this.statusHatch.string = t('status.val.hatchClosed');
        this.statusHatch.color = STATUS_VALUE_DOWN;
      }
    }

    // 车体（已毁 / 起火 (程度) / 完好）
    if (this.statusFire) {
      if (s.destroyed) {
        this.statusFire.string = t('status.val.destroyed');
        this.statusFire.color = STATUS_VALUE_DEAD;
      } else if ((s.fireLevel ?? 0) > 0) {
        // 有明确的着火程度：显示数字让玩家看到严重性（来自 §3.4 Step 3 的 'fire' 效果）
        this.statusFire.string = t('status.val.fireN', { n: s.fireLevel ?? 0 });
        this.statusFire.color = STATUS_VALUE_FIRE;
      } else if (s.damaged) {
        this.statusFire.string = t('status.val.damaged');
        this.statusFire.color = STATUS_VALUE_WARN;
      } else {
        this.statusFire.string = t('status.val.intact');
        this.statusFire.color = STATUS_VALUE_OK;
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

    // 5 名乘员。MVP 还没实装乘员阵亡机制，默认全员存活；摧毁后统一标为阵亡。
    //   crew 字段：commander / loader / gunner / driver / coDriver
    const crew = s.crew;
    const crewFlags: boolean[] = crew
      ? [crew.commander, crew.loader, crew.gunner, crew.driver, crew.coDriver]
      : [true, true, true, true, true];
    for (let i = 0; i < this.statusCrewLabels.length; i++) {
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
        ].join(' ');
        this.hudLabel.string = t('hud.playerChoose', { n: this.turn, tags: doneTag });
      } else if (this.playerStep === 'movement') {
        this.hudLabel.string = t('hud.movePhase', { n: this.turn, dice: this.remainingDice() });
      } else {
        const sherman = this.mission?.sherman;
        const loaded = sherman?.loaded ? t('hud.loaded') : t('hud.unloaded');
        const sel = this.selectedGunDieIdx >= 0 ? ` | ${t('hud.attackSelectHint')}` : '';
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
    const allDone = this.movementDone && this.attackDone;
    if (allDone) return { label: t('btn.endTurn'), urgent: true };
    return { label: t('btn.nextPhase'), urgent: false };
  }

  /** 胜负覆盖层：懒创建，仅在 outcome 非 ongoing 时显示，并联动"再来一局"按钮的可见性 */
  private updateOutcomeOverlay() {
    if (this.outcome === 'ongoing') {
      if (this.outcomeLabel) this.outcomeLabel.node.active = false;
      if (this.restartBtn) this.restartBtn.active = false;
      return;
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

    // "再来一局"按钮：放在标题正下方
    if (!this.restartBtn) {
      this.restartBtn = this.makeSimpleButton(
        'RestartBtn', t('btn.restart'),
        0, -90,
        BTN_BG_NORMAL,
        () => this.restartMission(),
      );
    }
    this.restartBtn.active = true;
    // 保证按钮在最上层（避免被后续 redraw 创建的浮字 / 状态文字盖住的视觉印象）
    this.restartBtn.setSiblingIndex(this.node.children.length - 1);
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
    this.selectedGunDieIdx = -1;
    this.movementDone = false;
    this.attackDone = false;
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

  /** 底部阶段选择条：两个大按钮，仅在 playerStep === 'choose' 时可见。 */
  private buildChooseBar() {
    const bar = new Node('ChooseBar');
    bar.layer = this.node.layer;
    const ut = bar.addComponent(UITransform);
    ut.setContentSize(640, 80);
    ut.setAnchorPoint(0.5, 0.5);
    bar.setPosition(0, -260, 0);
    this.node.addChild(bar);
    this.chooseBar = bar;

    const makeBtn = (name: string, text: string, x: number, color: Color,
                     onClick: () => void): Node => {
      const W = 220, H = 72;
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
      tx.fontSize = 30;
      tx.lineHeight = 34;
      tx.color = HUD_TEXT_COLOR;
      tx.horizontalAlign = HorizontalTextAlignment.CENTER;
      tx.verticalAlign = VerticalTextAlignment.CENTER;
      tx.string = text;
      b.addChild(txtNode);
      b.on(Node.EventType.TOUCH_END, onClick, this);
      bar.addChild(b);
      return b;
    };
    this.chooseMoveBtn = makeBtn('ChooseMove', t('btn.movePhase'), -130,
      PHASE_BTN_MOVE, () => this.enterPhase('movement'));
    this.chooseAttackBtn = makeBtn('ChooseAttack', t('btn.attackPhase'), +130,
      PHASE_BTN_ATTACK, () => this.enterPhase('attack'));
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
    if (this.chooseMoveBtn) this.setPhaseBtnEnabled(this.chooseMoveBtn, !this.movementDone, PHASE_BTN_MOVE);
    if (this.chooseAttackBtn) this.setPhaseBtnEnabled(this.chooseAttackBtn, !this.attackDone, PHASE_BTN_ATTACK);

    // 2) 骰子托盘
    if (this.diceTrayRoot) {
      this.diceTrayRoot.active = inBattle && (this.playerStep === 'movement' || this.playerStep === 'attack');
    }
    if (this.diceTitleLabel) {
      this.diceTitleLabel.string = this.playerStep === 'movement'
        ? t('dice.tray.move')
        : this.playerStep === 'attack'
          ? t('dice.tray.attack')
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
      this.drawDieSlot(vis, slot, i === this.selectedGunDieIdx);
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

  /** 玩家在"选择阶段"时点了移动或攻击按钮 → 摇一批骰子，进入对应子阶段。 */
  private enterPhase(which: 'movement' | 'attack') {
    if (!this.mission) return;
    if (this.isBusy()) return;
    if (this.phase !== 'player') return;
    if (this.outcome !== 'ongoing') return;
    if (this.playerStep !== 'choose') return;
    if (which === 'movement' && this.movementDone) return;
    if (which === 'attack' && this.attackDone) return;

    const { map, sherman } = this.mission;
    const tile = map.get(sherman.pos);
    const terrain = tile ? tile.terrain : 'field';
    const count = actionDicePool({ terrain, hatchOpen: !!sherman.hatchOpen });
    const pips = rollActionDice(this.rng, count);
    this.phaseDice = pips.map(pip => ({ pip, used: false }));
    this.selectedGunDieIdx = -1;
    this.playerStep = which;
    this.closeDiePopover();

    console.log(`[Dice] ${which === 'movement' ? '移动' : '攻击'}阶段掷骰: `
      + `[${pips.join(', ')}]（地形 ${terrain}, 舱盖 ${sherman.hatchOpen ? '开' : '关'}）`);

    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
  }

  /**
   * 结束当前子阶段（movement / attack），回到 choose；
   * 根据已完成阶段判断是继续选剩余那个，还是两阶段都完成 → 按钮切为"结束回合"。
   */
  private endCurrentSubPhase() {
    if (this.playerStep === 'movement') this.movementDone = true;
    else if (this.playerStep === 'attack') this.attackDone = true;
    this.phaseDice = [];
    this.selectedGunDieIdx = -1;
    this.playerStep = 'choose';
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
  }

  /**
   * 阶段内每做完一个动作后检查：如果所有骰子都已消耗，自动结束当前子阶段，
   * 省得玩家还要手动再点一次按钮。未消耗的骰子会被"废弃"在阶段结束时自然丢失。
   */
  private autoEndPhaseIfDone() {
    if (this.playerStep !== 'movement' && this.playerStep !== 'attack') return;
    if (this.phaseDice.length === 0) return;
    const anyLeft = this.phaseDice.some(d => !d.used);
    if (!anyLeft) {
      console.log(`[Dice] ${this.playerStep === 'movement' ? '移动' : '攻击'}阶段骰子用尽，自动结束阶段`);
      this.endCurrentSubPhase();
    }
  }

  // ---------- 骰子点击菜单 ----------

  private onClickDie(idx: number) {
    if (this.isBusy()) return;
    if (this.phase !== 'player') return;
    if (this.outcome !== 'ongoing') return;
    if (this.playerStep !== 'movement' && this.playerStep !== 'attack') return;
    const slot = this.phaseDice[idx];
    if (!slot || slot.used) {
      this.closeDiePopover();
      return;
    }
    // GDD §3.6：点数 5 / 6 只能前进，无分支需要选择 → 点一下直接走，不再弹菜单
    if (this.playerStep === 'movement' && classifyMoveDie(slot.pip) === 'drive') {
      this.closeDiePopover();
      this.tryDriveSherman(idx, +1);
      return;
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
    } else if (this.playerStep === 'attack') {
      const a = classifyAttackDie(slot.pip);
      if (a === 'reload') {
        items.push({ text: t('action.reload'), color: PHASE_BTN_ATTACK,
          onClick: () => this.tryReload(idx) });
      } else if (a === 'gun') {
        items.push({ text: t('action.fire'), color: PHASE_BTN_ATTACK,
          onClick: () => this.selectGunDie(idx) });
      } else {
        items.push({ text: t('action.skip'), color: PHASE_BTN_DISABLED,
          onClick: () => this.discardDie(idx) });
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

  /** 转向：dirSign +1=顺时针，-1=逆时针；消耗一颗转向骰。 */
  private tryTurnSherman(dieIdx: number, dirSign: 1 | -1) {
    if (!this.mission) return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used || this.playerStep !== 'movement') return;
    if (classifyMoveDie(slot.pip) !== 'turn') return;

    const sherman = this.mission.sherman;
    if (sherman.facing === null) sherman.facing = 0;
    // rotateDirection 的参数是"顺时针旋转 N 步"，所以 CCW 用 5（= -1 mod 6）
    const step = dirSign === 1 ? 1 : 5;
    sherman.facing = rotateDirection(sherman.facing, step);
    slot.used = true;
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    console.log(`[Move] 转向 ${dirSign === 1 ? 'CW' : 'CCW'} → facing=${sherman.facing}`);
    this.autoEndPhaseIfDone();
  }

  /**
   * 前进 / 后退 1 格：dirSign +1=沿当前 facing，-1=反向。
   *
   * GDD §3.6 约束：
   *   - 骰面 5 / 6（action='drive'）只允许前进（dirSign=+1）
   *   - 骰面 1    （action='reverse'）只允许后退（dirSign=-1）
   *
   * 若骰子动作与请求方向不匹配，直接忽略（按钮层已分开提供，这里是双保险）。
   * 若目标格无法进入（越界 / 水域林地建筑 / 被活着的敌方占据），弹警告浮字并 *不* 消耗骰子。
   */
  private tryDriveSherman(dieIdx: number, dirSign: 1 | -1) {
    if (!this.mission) return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used || this.playerStep !== 'movement') return;
    const act = classifyMoveDie(slot.pip);
    if (act === 'drive' && dirSign !== +1) return;
    if (act === 'reverse' && dirSign !== -1) return;
    if (act !== 'drive' && act !== 'reverse') return;

    const { map, sherman, enemies } = this.mission;
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
    this.anim = {
      unit: sherman,
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

  /** 装填主炮：消耗一颗装填骰；若已装填则拒绝（浪费骰）。 */
  private tryReload(dieIdx: number) {
    if (!this.mission) return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used || this.playerStep !== 'attack') return;
    if (classifyAttackDie(slot.pip) !== 'reload') return;
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

  /** 选择一颗主炮骰进入"选目标"态；之后点敌人格才真正开火。 */
  private selectGunDie(dieIdx: number) {
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used || this.playerStep !== 'attack') return;
    if (classifyAttackDie(slot.pip) !== 'gun') return;
    // 再次点同一颗 → 取消选择
    this.selectedGunDieIdx = this.selectedGunDieIdx === dieIdx ? -1 : dieIdx;
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
  }

  // ---------- 智能"下一阶段" ----------

  /**
   * 右下角按钮点击：
   *   - 当前在移动/攻击阶段 → 先 endCurrentSubPhase，再根据剩余阶段自动进下一个或回到 choose
   *   - 当前在 choose：两阶段都 done → 真正把控制权交给敌方；否则什么都不做（让玩家点底部条选）
   */
  private onAdvanceClicked() {
    if (this.isBusy()) return;
    if (this.phase !== 'player') return;
    if (this.outcome !== 'ongoing') return;

    if (this.playerStep === 'movement' || this.playerStep === 'attack') {
      this.endCurrentSubPhase();
      return;
    }
    // choose 状态
    if (this.movementDone && this.attackDone) {
      this.beginEnemyPhase();
    }
  }

  private beginEnemyPhase() {
    if (!this.mission) return;
    this.phase = 'enemy';
    // GDD §3.7：按距谢尔曼最近 → 最远排序；同距随机
    this.enemyOrder = selectEnemyOrder(this.mission.enemies, this.mission.sherman, this.rng);
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

  // ---------- 存档 / 读档 ----------

  private onSave() {
    if (!this.mission) return;
    // 仅在玩家"阶段选择"子步骤且无动画时存档；骰子托盘中态不保存，避免读档后骰子状态错乱
    if (this.isBusy() || this.phase !== 'player' || this.playerStep !== 'choose') {
      console.log('[Save] 当前不可存档：仅玩家阶段选择态且无动画时允许');
      return;
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
    });
    try {
      sys.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      console.log(`[Save] 已存档：回合 ${data.turn}`);
    } catch (e) {
      console.error('[Save] 写入失败:', e);
    }
  }

  private onLoad_Save() {
    if (!this.mission) return;
    if (this.isBusy()) {
      console.log('[Load] 动画进行中，稍后再试');
      return;
    }
    const raw = sys.localStorage.getItem(SAVE_KEY);
    if (!raw) {
      console.log('[Load] 无存档');
      return;
    }
    let save: SaveData;
    try {
      save = JSON.parse(raw);
    } catch (e) {
      console.error('[Load] 存档损坏:', e);
      return;
    }
    const result = applySave(this.mission, this.missionId, save);
    if (!result.ok) {
      console.warn('[Load] 读档失败:', result.reason);
      return;
    }
    // 写回场景状态；中断任何敌方阶段调度 / 骰子态 / 动画
    this.turn = result.turn!;
    this.phase = result.phase!;
    this.playerStep = 'choose';
    this.movementDone = (result.movesLeft ?? 2) === 0;
    this.attackDone   = (result.attacksLeft ?? 1) === 0;
    this.phaseDice = [];
    this.selectedGunDieIdx = -1;
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
    console.log(`[Load] 已读档：回合 ${this.turn}, 移动 ${this.movementDone ? '已做' : '未做'}, 攻击 ${this.attackDone ? '已做' : '未做'}`);
  }

  /**
   * 开启 `enemyOrder[enemyIndex]` 这辆敌坦的回合：
   *   1. 跳过已摧毁 / 不存在 的条目
   *   2. 按起始格地形 & damaged 状态查 AI 列，掷骰子
   *   3. 建立迷你骰子托盘浮在该敌坦上方
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

    console.log(
      `[AI] ${enemy.kind}@(${enemy.pos.q},${enemy.pos.r}) 列=${this.enemyAICol} 掷 ${count} 骰 → [${this.enemyDice.join(',')}]`
    );

    this.buildEnemyDiceTray(enemy);
    this.runNextEnemyStep();
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
      // 找下一颗未消耗的骰
      const dieIdx = this.enemyDiceUsed.findIndex(u => !u);
      if (dieIdx < 0) {
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

      // 消耗这颗骰子（无论是否真正执行成功，都算"本骰已用")
      this.enemyDiceUsed[dieIdx] = true;
      this.refreshEnemyDiceTray();

      if (!chosen) {
        // 无可行动作：直接进下一颗
        continue;
      }

      // 执行选中的动作；返回表明本次是否"挂起"（有动画在播）
      const result = this.executeEnemyAction(enemy, chosen);
      if (this.outcome !== 'ongoing') return; // 可能谢尔曼被击毁
      if (result === 'animating') return;     // 等动画 / dice-show 回调再 runNextEnemyStep
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
        } else {
          const step = decision === 'cw' ? 1 : 5;
          enemy.facing = rotateDirection(enemy.facing, step);
          console.log(`[AI] ${enemy.kind} 转向 ${decision.toUpperCase()} → facing=${enemy.facing}`);
        }
        this.redraw();
        this.refreshEnemyDiceTray();
        return 'done';
      }

      case 'advance':
      case 'reverse': {
        if (enemy.facing === null) return 'done';
        const dir = action === 'advance'
          ? enemy.facing
          : rotateDirection(enemy.facing, 3);
        const to = neighbor(enemy.pos, dir);
        // 发起移动动画；在 update() 动画结束分支里会再次调 runNextEnemyStep
        this.destroyEnemyDiceTray();
        this.anim = {
          unit: enemy,
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
    // 清理敌方调度中间态
    this.enemyOrder = [];
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceUsed = [];
    this.destroyEnemyDiceTray();
    // 新回合：两个子阶段重置为"未执行"，由玩家重新选先移动还是先攻击
    this.playerStep = 'choose';
    this.movementDone = false;
    this.attackDone = false;
    this.phaseDice = [];
    this.selectedGunDieIdx = -1;
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

    // 仅在"攻击阶段 + 已选主炮骰"时响应（否则地图点击无效果，视觉上也无红圈）
    if (this.playerStep !== 'attack' || this.selectedGunDieIdx < 0) return;

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
    if (enemyOnTile) this.tryAttack(enemyOnTile);
  }

  /**
   * 玩家开火：必须已选中主炮骰 + 已装填 + canAttack 通过。
   * 结算后消耗那颗骰子 + 清空 loaded（手册：一炮一装）。
   */
  private tryAttack(target: Unit) {
    if (!this.mission) return;
    if (this.playerStep !== 'attack') return;
    if (this.selectedGunDieIdx < 0) return;
    const { map, sherman } = this.mission;
    const slot = this.phaseDice[this.selectedGunDieIdx];
    if (!slot || slot.used) return;
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
    this.startDiceShow(report, t('actor.player'), target.kind, () => {
      if (!this.mission) return;
      applyAttack(target, report);
      slot.used = true;
      sherman.loaded = false;
      this.selectedGunDieIdx = -1;
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
          if (current && !current.destroyed) this.buildEnemyDiceTray(current);
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
  ) {
    // 已有一个面板在播（理论上不该走到这里，守一下）：先强结束旧的，避免叠加
    if (this.diceShow) this.finalizeDiceShow(/*skip=*/true);
    this.closeDiePopover();

    const panel = this.buildDiceShowPanel(report, attackerLabel, targetLabel);
    this.diceShow = {
      stage: 'hit-roll',
      t: 0,
      report,
      attackerLabel,
      targetLabel,
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
    const needsCrewRow = report.hit && report.penetrated && report.damageEffect === 'crewCheck';
    const PANEL_W = 560;
    const PANEL_H = needsCrewRow ? 520 : 440;

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

    // 命中需求
    const hitNeed = this.makeCenteredLabel(panel, t('dice.panel.hitNeed', { n: report.threshold }),
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

    // 1d6 穿甲骰 + 需求 + 判定
    const penDie = this.makeDieSquare(panel, -(DIE_SIZE / 2 + 60), penDiceY, DIE_SIZE);
    const penNeed = this.makeCenteredLabel(panel, '',
      70, penDiceY, 170, 28, 18, DICE_INFO_TEXT);
    const penVerdict = this.makeCenteredLabel(panel, '',
      200, penDiceY, 160, 40, 28, DICE_OK_TEXT);

    // 1d6 伤害骰 + "伤害检定" + 效果文字
    const dmgDie = this.makeDieSquare(panel, -(DIE_SIZE / 2 + 60), dmgDiceY, DIE_SIZE);
    const dmgTitle = this.makeCenteredLabel(panel, t('dice.panel.dmgTitle'),
      70, dmgDiceY, 170, 28, 18, DICE_INFO_TEXT);
    const dmgEffect = this.makeCenteredLabel(panel, '',
      200, dmgDiceY, 180, 40, 28, DICE_OUTCOME_HIT);

    // 可选：1d6 阵亡检定骰（仅谢尔曼被击穿 + 伤害表 d6=2 时才会出现）
    let crewDie: Label | null = null;
    let crewTitle: Label | null = null;
    let crewEffect: Label | null = null;
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

    // 底部大字结果
    const outcome = this.makeCenteredLabel(panel, '',
      0, -PANEL_H / 2 + 44, PANEL_W - 40, 48, 36, DICE_OUTCOME_MISS);

    // 伤害骰行在 dmg-roll 前不应该出现，默认整行 hidden
    // （骰子方块容器 / 标题 / 效果文字 三个节点一起关掉）
    dmgDie.node.parent!.active = false;
    dmgTitle.node.active = false;
    dmgEffect.node.active = false;

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

  /**
   * 在 mapNode 上方浮起一排迷你骰子，跟随当前敌坦格子。
   *
   *   - 上一行文字：AI 列名 + 列骰数，例如 "road 4"
   *   - 下一行：count 个 24×24 方块，每块内部显示点数；已消耗的变灰
   */
  private buildEnemyDiceTray(enemy: Unit) {
    this.destroyEnemyDiceTray();
    if (!this.mapNode) return;
    const count = this.enemyDice.length;
    if (count <= 0) return;

    const DIE_SIZE = 24;
    const GAP = 4;
    const totalW = count * DIE_SIZE + (count - 1) * GAP;
    const root = new Node('EnemyDiceTray');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(totalW, DIE_SIZE + 18);
    const { x, y } = this.project(enemy.pos.q, enemy.pos.r);
    // 漂在单位上方约 1 格高
    root.setPosition(x, y + this.hexSize + 8, 0);
    this.mapNode.addChild(root);

    // 列名标签
    const header = new Node('AICol');
    header.layer = this.node.layer;
    header.addComponent(UITransform).setContentSize(totalW + 40, 14);
    header.setPosition(0, DIE_SIZE / 2 + 10, 0);
    const hl = header.addComponent(Label);
    hl.fontSize = 11;
    hl.lineHeight = 13;
    hl.color = new Color(230, 230, 200, 255);
    hl.horizontalAlign = HorizontalTextAlignment.CENTER;
    hl.verticalAlign = VerticalTextAlignment.CENTER;
    hl.string = t('dice.aiHeader', { col: this.enemyAICol, n: count });
    hl.enableOutline = true;
    hl.outlineColor = new Color(0, 0, 0, 220);
    hl.outlineWidth = 2;
    root.addChild(header);

    this.enemyDiceTrayLabels = [];
    const x0 = -totalW / 2 + DIE_SIZE / 2;
    for (let i = 0; i < count; i++) {
      const cx = x0 + i * (DIE_SIZE + GAP);
      const tile = new Node(`D${i}`);
      tile.layer = this.node.layer;
      tile.addComponent(UITransform).setContentSize(DIE_SIZE, DIE_SIZE);
      tile.setPosition(cx, -2, 0);
      const g = tile.addComponent(Graphics);
      g.lineWidth = 2;
      g.strokeColor = new Color(30, 30, 30, 255);
      g.fillColor = new Color(240, 230, 130, 255);
      g.rect(-DIE_SIZE / 2, -DIE_SIZE / 2, DIE_SIZE, DIE_SIZE);
      g.fill();
      g.stroke();
      root.addChild(tile);

      const labNode = new Node('Face');
      labNode.layer = this.node.layer;
      labNode.addComponent(UITransform).setContentSize(DIE_SIZE, DIE_SIZE);
      const l = labNode.addComponent(Label);
      l.fontSize = 14;
      l.lineHeight = 16;
      l.color = new Color(20, 20, 20, 255);
      l.horizontalAlign = HorizontalTextAlignment.CENTER;
      l.verticalAlign = VerticalTextAlignment.CENTER;
      l.string = String(this.enemyDice[i]);
      tile.addChild(labNode);

      this.enemyDiceTrayLabels.push(l);
    }

    this.enemyDiceTrayRoot = root;
    this.refreshEnemyDiceTray();
  }

  /** 重刷托盘里每颗骰的"已用/未用"视觉：已用 → 暗色 + 半透 */
  private refreshEnemyDiceTray() {
    if (!this.enemyDiceTrayRoot) return;
    for (let i = 0; i < this.enemyDiceTrayLabels.length; i++) {
      const used = !!this.enemyDiceUsed[i];
      const lab = this.enemyDiceTrayLabels[i];
      if (!lab) continue;
      // 变文字颜色即可，骰子面不需要每次重绘 Graphics
      lab.color = used
        ? new Color(120, 120, 120, 180)
        : new Color(20, 20, 20, 255);
      const parent = lab.node.parent;
      if (parent) {
        parent.setScale(used ? 0.85 : 1, used ? 0.85 : 1, 1);
      }
    }
  }

  /** 销毁敌方骰子托盘（切敌方单位 / 结束敌方阶段 / 动画期间临时收起用） */
  private destroyEnemyDiceTray() {
    if (this.enemyDiceTrayRoot) {
      this.enemyDiceTrayRoot.destroy();
      this.enemyDiceTrayRoot = null;
    }
    this.enemyDiceTrayLabels = [];
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
          if (!show.report.hit) {
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
    return this.anim !== null || this.diceShow !== null;
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
