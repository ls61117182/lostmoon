/**
 * BattleScene —— 把 mission_01.json 渲染为六角格地图，支持骰子驱动的"移动阶段 /
 * 攻击阶段"双子阶段、敌方贪心 AI 与存读档。
 *
 * 玩法（按说明书 3.6 行动表拆分为两个独立阶段）：
 *   - 回合开始时底部弹出阶段选择条：「打开舱盖/关闭舱盖」+「移动阶段 / 攻击阶段」；舱盖每回合最多切换一次，点击后立即灰显并刷新视野，车长阵亡则舱盖钮灰显为「车长阵亡」；两子阶段可任意顺序进入
 *   - 进入某阶段时，按谢尔曼当前格地形 + 舱盖状态计算并摇出本阶段骰子，落在屏幕底部骰子托盘
 *     - 移动阶段：1=无 / 2=启动（未实装，可跳过）/ 3,4=转向 60° / 5,6=前进或后退 1 格
 *     - 攻击阶段：1,2=装填 / 3,4=机枪 / 5,6=主炮射击（硬核模式下也可用于旋转炮塔侦察）
 *     - 机枪：攻击阶段 3/4 点不受乘员阵亡影响；杂项阶段「副驾驶机枪」需副驾驶存活
 *   - 点击骰子弹出动作菜单，选择具体执行方式（↻顺时针 / ↺逆时针 / ▲前进 / ▼后退…）
 *   - 前进 / 后退沿谢尔曼当前朝向 ±1 格移动；若目标格地形或敌方占据无法进入，
 *     该次移动无效、骰子不消耗、只弹警告浮字
 *   - 主炮骰点击进入"选择目标"态；已装填时点击视线内敌人可开炮，点击眼睛标记格可只旋转炮塔（开舱时同样可用）
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
  RichText,
  Rect,
  ScrollView,
  Size,
  Sprite,
  SpriteFrame,
  sys,
  UITransform,
  UIOpacity,
  Vec3,
  VerticalTextAlignment,
  director,
  resources,
} from 'cc';
import {
  HEDGE_DRAW_EDGE_BY_AXIAL,
  HexMap,
  axialToPixel,
  axialAdd,
  axialEquals,
  approximateFireDirection,
  diagonalFlankFireDirectionTo,
  directionTo,
  fireDirectionTo,
  fireDirectionVector,
  hexDistance,
  neighbor,
  neighbors,
  axialToOffset,
  offsetToAxial,
  rotateDirection,
} from '../core/HexGrid';
import {
  limitTurretTraverse,
  turretTurnDistance,
  turretFacingAfterHullTurn,
  turretTraverseAnimationDuration,
} from '../core/TurretTraverse';
import {
  actionDicePool,
  classifyAttackDie,
  classifyMiscDie,
  classifyMoveDie,
  rollActionDice,
} from '../core/ActionDice';
import { PLAYER_DICE_POOL, PLAYER_HARDCORE_DICE_POOL } from '../core/PlayerActionDB';
import { applyAttack, applyHighExplosiveAttack, applyMGAttack, AttackReport, canAttack, canMGAttack, CrewDeathResult, DamageEffect, effectivePenetrationBreakdown, HighExplosiveReport, hitBreakdown, hitThreshold, infantryHighExplosiveCoverValue, maxMGHitRoll, mgHitBreakdown, mgHitThreshold, mgHitThresholdModifierDetails, nonPlayerTankWeaponForTarget, probHit2d6, resolveCrewCheck, resolveDamageEffect, rollAttack, rollHighExplosiveAttack, rollMGAttack, selectTankMachineGun, TankMachineGunSelection } from '../core/Combat';
import { DAMAGE_TABLE } from '../core/DamageTableDB';
import type { DamageTableEffect, DamageTargetClass } from '../core/DamageTableDB';
import { fireCheckProfileFor, resolveFireCheckEffect, resolveFireCheckLowest, FireCheckEffect } from '../core/FireCheck';
import { RNG } from '../core/Dice';
import { t, setLang, getLang, LangCode } from '../core/Lang';
import { bindButtonPressScale } from './ButtonFeedback';
import {
  applyAdaptiveResolution,
  createAdaptiveFullscreenMask,
  subscribeAdaptiveResolution,
  visibleSizeInRootSpace,
} from './ResolutionAdapter';
import {
  actionFor,
  actionForHardcoreTankDie,
  aiTargetPriorityForActor,
  AI_DICE_COUNT,
  aiColumnFor,
  AIActionEntry,
  AIColumn,
  canExecuteAction,
  currentTargetFor,
  DEFAULT_AI_TABLE,
  decideEnemyTurn,
  EnemyAction,
  EnemyTankDieType,
  hardcoreAttackDieIsInvalid,
  hardcoreTankAIDiceCount,
  hardcoreTankDiceTerrain,
  isAIActorUnit,
  rollAIDice,
  rollHardcoreTankAIDice,
  selectAIOrder,
  visibleAITurnTargetPositionFor,
} from '../core/EnemyAI';
import type { CrewSlot } from '../core/EnemyAIDB';
import { loadMission, LoadedMission } from '../core/MissionLoader';
import { computePlayerVisibleHexes, computeRadioSharedVisibleHexes, computeUnitVisibleHexes, currentGunnerVisionRange, currentVisionRange, diagonalGunnerClickPreference, diagonalGunnerRuleDirectionForVisibleHex, fogOfWarEnabled, HEAVY_ARTILLERY_VISION_RANGE, isUnitInVision, reconcileDiagonalGunnerSideAfterMove } from '../core/FogOfWar';
import { getUnitStats } from '../core/UnitDB';
import { buildObjectiveHudLines, objectiveDestroyProgressLangKey, ObjHudLine } from '../core/MissionObjectiveHud';
import { checkOutcome, isPlayerTankEvacDrive, MissionOutcome } from '../core/Objective';
import {
  AdjacentInfantryVolleyPreview,
  GermanTruckMoveSegment,
  prepareTurnEndEvent,
  TurnEndExtraDicePhase,
  TurnEndTankReinforceMove,
} from '../core/TurnEndEventApply';
import {
  TurnEndEffectType,
} from '../core/TurnEndEventDB';
import {
  createCustomTurnEndEventProvider,
  OfficialTurnEndEventProvider,
} from '../core/TurnEndEventRuntime';
import type { TurnEndEventProvider } from '../core/TurnEndEventRuntime';

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
import { missionWithSelectedPlayerTank } from '../core/PlayerTankSelection';
import { CAMPAIGN_CHAPTER_ID, getCampaign } from '../core/CampaignDB';
import {
  StitchedCampaignData,
  campaignSegmentForOffset,
  carryPlayerTankToNextSegment,
  stitchCampaignMissions,
} from '../core/CampaignRuntime';
import {
  applyCampaignUpgradesToSherman,
  campaignUpgradeDefinition,
  campaignUpgradeDiceBonus,
  campaignUpgradeHitThresholdModifier,
  drawCampaignUpgradeCandidates,
  hasCampaignUpgrade,
  loadCampaignShell,
  resetCampaignUpgradeSegmentCharges,
  reviveFirstCampaignCrewMember,
} from '../core/CampaignUpgrade';
import type { CampaignUpgradeDefinition, CampaignUpgradeId } from '../core/CampaignUpgrade';
import { getGameModeConfig } from '../core/GameMode';
import { firstDamagedRepairableComponent, repairableComponentById, repairableComponentsFor, RepairableComponentId } from '../core/RepairableComponents';
import { commanderHatchVisualState, shouldNonPlayerTankOpenCommanderHatch } from '../core/CommanderHatch';
import { pvpFactionOf, pvpParityLabel } from '../core/PvpConfig';
import type { PvpFactionId, PvpParity } from '../core/PvpConfig';
import { factionUiFor } from '../core/FactionUI';
import { PvpBattleSnapshot, PvpBattleUnitSnapshot, PvpService } from '../core/PvpService';
import { CustomMissionStore } from '../core/CustomMissionStore';
import type { MissionSource } from '../core/CustomMissionStore';
import { findLevelByMissionId, MenuProgress } from '../core/LevelDB';
import { normalizeWeather } from '../core/Weather';
import { HEAVY_SNOW_VISUAL_SLOT_COUNT, LIGHT_SNOW_VISUAL_SLOT_COUNT, RAIN_VISUAL_SLOT_COUNT, sampleRainVisual, sampleSnowVisual } from './WeatherVisual';
import type { RainVisualSample, SnowVisualSample } from './WeatherVisual';
import { infantrySpriteAngle, infantrySquadOffsets, infantryVisualDirection } from './InfantryVisualFacing';
import {
  TANK_EXHAUST_IDLE_RATE,
  TANK_EXHAUST_MAX_PARTICLES,
  TANK_EXHAUST_MOVING_RATE,
  TankExhaustParticle,
  TankExhaustPoint,
  advanceTankExhaustParticle,
  resetTankExhaustParticle,
  sampleTankExhaustTrailFractions,
  tankExhaustParticleAlpha,
  tankExhaustParticleRadius,
  tankExhaustPortWorldPosition,
} from './TankEngineExhaust';
import {
  TANK_ENGINE_VIBRATION_DEFAULT_ENABLED,
  TANK_ENGINE_VIBRATION_FREQUENCY_HZ,
  tankEngineVibrationPhaseOffset,
  tankEngineVibrationSample,
  unitKindHasEngineVibration,
} from './TankEngineVibration';
import { orderMachineGunBurstEndpointsByLateralOffset } from './MachineGunBurstOrder';
import { clampMachineGunTracerTail, machineGunBurstStartPoint } from './MachineGunBurstGeometry';
import {
  renderedTankBodyLength,
  renderedTankBodyWidth,
  tankTrackAlphaAfterTurns,
  tankTrackEdgeKey,
  tankTrackHalfGap,
  tankTrackEdgesContinueStraight,
  tankTrackLineWidth,
  tankTrackProgressSegment,
  tankTrackStyleForTerrain,
  TANK_TRACK_STYLE_ORDER,
  TankTrackStyle,
} from './TankTrackVisual';
import {
  MAIN_GUN_RECOIL_BACK_TIME,
  MAIN_GUN_RECOIL_RETURN_TIME,
  MainGunRecoilMode,
  mainGunRecoilMode,
  mainGunRecoilOffset,
} from './MainGunRecoil';
import { syncServerProfile } from '../core/AuthService';
import { readActiveSaveRaw, writeActiveSaveRaw } from '../core/SaveSlot';
import { readCampaignCheckpoint, writeCampaignCheckpoint } from '../core/CampaignCheckpointStore';
import {
  SPLIT_TANK_KINDS,
  EMPTY_COMMANDER_HATCH_SPRITE_SIZE,
  SHERMAN_EMPTY_COMMANDER_HATCH_SCALE,
  SplitTankKind,
  SplitTankGeometryConfig,
  SplitTankVisualConfig,
  TANK_VISUAL_KINDS,
  TankVisualConfig,
  TankVisualKind,
  splitTankGeometryConfigOf,
  splitTankVisualConfigOf,
  tankVisualAssetConfigOf,
  tankVisualConfigOf,
  emptyCommanderHatchScaleOf,
} from '../core/TankVisualDB';
import {
  INFANTRY_VISUAL_KINDS,
  InfantryVisualKind,
  infantryVisualConfigOf,
  infantryVisualKindOf,
} from '../core/InfantryVisualDB';
import {
  initGameAudio,
  onMenuVolumesChanged,
  playBgmBattle,
  stopBgm,
  stopBattleSfx,
  playCannonReload,
  playCommanderHatch,
  playConfiguredAttackSound,
  playDiceRoll,
  playInfantryAntiTankFire,
  playInfantryAttack,
  playInfantryMove,
  playMgFire,
  playSniperFire,
  playTankHitPenetration,
  playTankHitRicochet,
  playStukaFlyover,
  startManeuverSound,
  startTurretTraverseSound,
  stopManeuverSound,
  stopTurretTraverseSound,
  playUiClick,
} from '../audio/GameAudio';
import { visualDamageSmokeLevel, visualFireEffectLevel } from '../core/UnitVisualState';
import { commanderHasSkill, crewLevelFor, infantryTurnActions, normalizePlayerCrewLevels, normalizeUnitLevel, unitLevelOf } from '../core/UnitLevel';
import {
  advanceAttackPositionMemory,
  AttackPositionMemory,
  cloneAttackPositionMemory,
  createAttackPositionMemory,
  previousEnemyAttackPosition,
  recordAttackPosition as recordAttackPositionForMemory,
} from '../core/AttackPositionMemory';
import { ambushHitThresholdModifier, ambushHitThresholdModifierDetails, beginAmbushTurn, endAmbushTurn, markAmbushAction, markAmbushTargeted } from '../core/Ambush';
import { applyInfantrySuppression, consumeInfantryTurnSuppression, isMainGunSuppressionAttack, selectMainGunTargetsByHex } from '../core/Suppression';
import { Axial, Direction, effectiveDiceTerrain, Faction, FireDirection, infantryKindForFaction, isAbandonedATGun, isAbandonedTank, isAntiTankGunKind, isAntiTankGunUnit, isAttachedATGunCrew, isControlledATGun, isFootUnit, isHeavyArtilleryUnit, isHostile, isMainGunLoaded, isSameSide, isTankUnit, MissionData, neutralizeUncrewedTank, resolvedLoadedShell, restoreFullTankCrew, ShellType, TerrainType, Tile, tileForbidsSmokeOrConcealment, tileHasBridge, Unit, UnitKind, UnitPlacement, WeatherType } from '../core/types';

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

function opaqueButtonFill(color: Color): Color {
  return new Color(color.r, color.g, color.b, 255);
}

function drawFieldPanel(
  g: Graphics,
  w: number,
  h: number,
  fill: Color,
  border: Color,
  accent: Color,
  drawInnerStroke: boolean = true,
) {
  const x = -w / 2;
  const y = -h / 2;
  g.fillColor = new Color(0, 0, 0, 40);
  g.rect(x + 2, y - 2, w, h);
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
  if (drawInnerStroke) {
    g.strokeColor = new Color(14, 16, 14, 185);
    g.lineWidth = 1;
    g.rect(x + 6, y + 6, w - 12, h - 12);
    g.stroke();
  }
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
type EnemyTopKind = TankVisualKind;

function isEnemyTopKind(k: UnitKind): k is EnemyTopKind {
  return (TANK_VISUAL_KINDS as readonly UnitKind[]).includes(k);
}

type DestroyedTopKind = TankVisualKind;

function isDestroyedTopKind(k: UnitKind): k is DestroyedTopKind {
  return (TANK_VISUAL_KINDS as readonly UnitKind[]).includes(k);
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

interface EngineVibrationVisual {
  node: Node;
  baseX: number;
  baseY: number;
  baseAngle: number;
  bodyAngleDeg: number;
  phaseOffset: number;
}

interface TankExhaustEmitterState {
  idleAccumulator: number;
  distanceRemainder: number;
  movingSpacing: number;
  wasMoving: boolean;
  previousOrigins: TankExhaustPoint[];
  currentOrigins: TankExhaustPoint[];
  sampleFractions: number[];
  spawnPoint: TankExhaustPoint;
}

const TIGER_SPLIT_VISUAL_CONFIG = splitTankVisualConfigOf('tiger');
const PANZER4_SPLIT_VISUAL_CONFIG = splitTankVisualConfigOf('panzer4');
const PANZER3_SPLIT_VISUAL_CONFIG = splitTankVisualConfigOf('panzer3');
const TIGER_SPLIT_GEOMETRY_CONFIG = splitTankGeometryConfigOf('tiger');
const PANZER4_SPLIT_GEOMETRY_CONFIG = splitTankGeometryConfigOf('panzer4');
const PANZER3_SPLIT_GEOMETRY_CONFIG = splitTankGeometryConfigOf('panzer3');

/** 着火检定预掷结果：确认后才写入谢尔曼状态 */
interface FireCheckPreparedStep {
  die: number;
  effect: FireCheckEffect;
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

/** 所有骰子转动阶段共用的动画时长（秒）。 */
const DICE_ROLL_DUR = 0.5;

/** 把 AIActionEntry 转成控制台日志里的 "射击>转向" 这种紧凑表达 */
function describeEntry(entry: AIActionEntry): string {
  const name = (a: EnemyAction): string => {
    switch (a) {
      case 'shoot':   return '射击';
      case 'turn':    return '转向';
      case 'advance': return '前进';
      case 'reverse': return '后退';
      case 'smoke':   return '烟雾';
      case 'repair':  return '修复并灭火';
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
    case 'radio':      return { text: t('dmg.effect.radio'),     color: new Color(120, 210, 230, 255) };
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
    case 'radio':      return { text: t('dmg.outcome.radio'),     color: new Color(120, 210, 230, 255) };
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

function tableCrewOutcomeLabel(report: AttackReport): { text: string; color: Color } | null {
  const step = report.damageEffects?.find(e => e.effect === 'crewCheck' && e.crewSlot !== undefined);
  if (!step || step.crewSlot === null || step.crewSlot === undefined) return null;
  return {
    text: t('crew.death.kia', { role: crewRoleName(step.crewSlot) }),
    color: new Color(255,  80,  80, 255),
  };
}

/** 已经确定具体阵亡成员时，直接显示“XX 阵亡”，不再回退成“阵亡检定”。 */
function resolvedCrewDeathLabel(report: AttackReport): { text: string; color: Color } | null {
  const crewCheck = report.crewCheck ?? report.stagedCrewCheck;
  if (crewCheck?.slot !== null && crewCheck?.slot !== undefined) {
    return crewOutcomeLabel(crewCheck);
  }
  return tableCrewOutcomeLabel(report);
}

function damageEffectStepText(report: AttackReport, index: number): string {
  const step = report.damageEffects?.[index];
  if (!step) return damageEffectLabel(report.damageEffect).text;
  if (step.effect === 'crewCheck' && step.crewSlot !== undefined && step.crewSlot !== null) {
    return t('crew.death.kia', { role: crewRoleName(step.crewSlot) });
  }
  return damageEffectLabel(step.effect).text;
}

function damageEffectSummaryLabel(report: AttackReport): { text: string; color: Color } {
  const effects = report.damageEffects;
  const suppressed = report.overpenetrationSuppressedEffects ?? [];
  const suppressedText = suppressed.map(effect => t('dmg.effect.overpenetrationSuppressed', {
    effect: damageEffectLabel(effect).text,
  }));
  if (suppressedText.length === 0 && (!effects || effects.length <= 1)) {
    if (report.damageEffect === 'crewCheck') {
      return resolvedCrewDeathLabel(report) ?? damageEffectLabel(report.damageEffect);
    }
    return damageEffectLabel(report.damageEffect);
  }
  const activeText = effects?.map((_, index) => damageEffectStepText(report, index)) ?? [];
  const text = [...suppressedText, ...activeText].join('\n');
  const crew = tableCrewOutcomeLabel(report);
  return {
    text,
    color: crew?.color ?? (activeText.length > 0
      ? damageEffectLabel(report.damageEffect).color
      : new Color(255, 190, 72, 255)),
  };
}

function overpenetrationOutcomeLabel(): { text: string; color: Color } {
  return { text: t('dmg.outcome.overpenetration'), color: new Color(255, 190, 72, 255) };
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

type DestroyedTurretLaunchCause = 'impact' | 'ammoExplosion';

/** One detached turret sprite animated in map-local screen space. */
interface DestroyedTurretVisual {
  unitId: string;
  node: Node;
  opacity: UIOpacity;
  startX: number;
  startY: number;
  dirX: number;
  dirY: number;
  distance: number;
  duration: number;
  remainTime: number;
  fadeDuration: number;
  maxScale: number;
  /** Final scale relative to the turret's mounted size. */
  groundScale: number;
  startAngle: number;
  rotateAngle: number;
  elapsed: number;
}

/** Permanent ground mark for one completed hex-to-hex tank movement. */
interface TankTrackMove {
  unitId: string;
  fromQ: number;
  fromR: number;
  toQ: number;
  toR: number;
  /** Half the rendered distance between the left and right track centres. */
  halfGap: number;
  /** Half the rendered hull length used to expand the mark to both swept edges. */
  halfBodyLength: number;
  /** Quantized from rendered hull width so similar tanks still share a stroke batch. */
  lineWidth: number;
  /** Only exposed ends extend by half a hull; connected ends meet once at the hex centre. */
  extendFrom: boolean;
  extendTo: boolean;
  /** Uses the same eased 0..1 progress as the tank's movement animation. */
  progress: number;
  /** Number of completed full turns since this mark was created. */
  fadeSteps: number;
}

interface TurretAimAnim {
  unit: Unit;
  from: FireDirection;
  to: FireDirection;
  t: number;
  dur: number;
  onDone: () => void;
  fromVisualTarget?: Axial;
  toVisualTarget?: Axial;
  preserveRuleFacing?: boolean;
  /** Whole-mount animations such as AT-gun rotation must not use the tank turret motor cue. */
  suppressTurretSound?: boolean;
}

interface HardcoreATGunTarget {
  target: Unit;
  attacker: Unit;
  direction: FireDirection;
  turnDistance: number;
  distance: number;
  infantryAttack: boolean;
  attackable: boolean;
  terrainBlocked: boolean;
  smokeBlocked: boolean;
}

interface CampaignPanAnim {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t: number;
  dur: number;
  onDone: () => void;
}

interface CampaignUpgradeCardRefs {
  id: CampaignUpgradeId;
  node: Node;
  redraw: (selected: boolean) => void;
}

const CAMPAIGN_UPGRADE_ICON_ORDER: readonly CampaignUpgradeId[] = [
  'commander_cupola',
  'improved_optics',
  'wet_ammo_rack',
  'spall_liner',
  'automatic_extinguisher',
  'side_skirts',
  'wide_tracks',
  'improved_transmission',
  'smoke_launcher',
  'intercom',
];

const CAMPAIGN_UPGRADE_ICON_ORDER_V2: readonly CampaignUpgradeId[] = [
  'ready_rack',
  'mine_roller',
  'camouflage_net',
  'reinforced_transmission',
  'commander_ballistic_shield',
  'emergency_medical_kit',
  'ammo_handling_optimization',
  'new_gun_mantlet',
];

type DirectionLerp = {
  from: FireDirection;
  to: FireDirection;
  t: number;
  angular?: boolean;
  fromVisualTarget?: Axial;
  toVisualTarget?: Axial;
};

type Phase = 'player' | 'fireCheck' | 'ally' | 'enemy';

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
type DiceRuleKind = 'hit' | 'pen' | 'damage' | 'crew' | 'he';

interface HighExplosiveCollateralResult {
  target: Unit;
  report: HighExplosiveReport;
}

interface DiceShow {
  stage: DiceStage;
  t: number;                 // 当前阶段已经经过的秒数
  report: AttackReport;      // 已 rollAttack 得出的最终结果（不能再变）
  /** Hardcore HE uses the same modal lifecycle with blast-specific labels. */
  highExplosiveReport: HighExplosiveReport | null;
  /** Protected HE blast checks against infantry sharing the primary tank's hex. */
  highExplosiveCollateral: HighExplosiveCollateralResult[];
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
  /** Precision fire already played cannon audio/muzzle flash after its aim hold. */
  fireEffectPlayed: boolean;
  attacker: Unit | null;
  target: Unit | null;
  /** Snapshot before attack resolution, so a doubles kill cannot erase the exposed-commander hint. */
  targetCommanderExposed: boolean;
  onDone: () => void;        // 确认/自动关闭回调：确保已结算并继续后续调度
  /** 骰面最终结果揭示时立即写入状态；确认按钮不负责延迟展示结果。 */
  onHold: (() => void) | null;
  requireManualClose: boolean;
  finalized: boolean;        // 保险位，避免 onDone 被回调多次
  holdNotified: boolean;
  earlyDestroyedVisualApplied: boolean;
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
  highExplosiveCollateralRows: Array<{
    dieLabels: Label[];
    needLabel: Label;
    verdictLabel: Label;
  }>;
  dmgDieLabel: Label | null; // 1 颗伤害骰（仅 penetrated 时展示）
  dmgTitleLabel: Label | null;  // "伤害检定" 标题
  dmgEffectLabel: Label | null; // "起火 / 炮塔受损 / 痛痪 / 阵亡检定 / 摧毁 / 受损"
  crewDieLabel: Label | null;    // 1 颗阵亡检定骰（仅 damageEffect==='crewCheck' 时存在）
  crewTitleLabel: Label | null;  // "阵亡检定" 标题
  crewEffectLabel: Label | null; // "驾驶员阵亡 / 虚惊 / …"
  outcomeLabel: Label;       // 底部大字：起火 / 击毁 / 跳弹 / MISS / 炮塔 / 痛痪 / 乘员阵亡
  confirmButton: Node | null;
  ruleModalRoot: Node | null;
}

type CombatLogParams = Record<string, string | number>;
interface CombatLogI18nEntry {
  key: string;
  params?: CombatLogParams;
}
type CombatLogEntry = string | CombatLogI18nEntry;
type CombatLogTone = 'good' | 'bad' | 'neutral';

const COMBAT_LOG_COLOR = {
  good: '#72f08a',
  bad: '#ff6b6b',
  fire: '#ffad4f',
  damage: '#ffd166',
  mobility: '#c89cff',
  guard: '#9fd3ff',
  neutral: '#e4e9f0',
};

const COMBAT_LOG_ALWAYS_GOOD = [
  '灭火', 'Fire suppression', 'fire suppression', 'fire level -1', 'Fire Level -1',
  '着火层数 -1', '击落', 'shot down', 'unharmed', '虚惊', 'False Alarm', 'false alarm',
];
const COMBAT_LOG_ALWAYS_BAD = [
  '任务失败', 'mission failed', 'limit exceeded', '超过上限', '无法攻击', 'Cannot attack',
];
const COMBAT_LOG_CONTEXTUAL_GOOD = [
  '命中击毙', 'Hit and killed', '目标摧毁', 'target destroyed', '击毁', '摧毁', 'Destroyed',
  'destroyed', '阵亡', 'KIA', '击穿', 'penetrated',
];
const COMBAT_LOG_CONTEXTUAL_BAD = [
  '未命中', 'MISS', 'miss', 'Miss', '跳弹', 'Ricochet', 'ricochet',
];
const COMBAT_LOG_FIRE_WORDS = ['着火', '起火', 'On Fire', 'Fire level', 'fire level'];
const COMBAT_LOG_DAMAGE_WORDS = ['受损', 'Damaged', 'damage', '炮塔受损', 'Turret Hit'];
const COMBAT_LOG_MOBILITY_WORDS = ['瘫痪', 'Immobilized'];
const COMBAT_LOG_HIGHLIGHT_WORDS = [
  ...COMBAT_LOG_ALWAYS_GOOD,
  ...COMBAT_LOG_ALWAYS_BAD,
  ...COMBAT_LOG_CONTEXTUAL_GOOD,
  ...COMBAT_LOG_CONTEXTUAL_BAD,
  ...COMBAT_LOG_FIRE_WORDS,
  ...COMBAT_LOG_DAMAGE_WORDS,
  ...COMBAT_LOG_MOBILITY_WORDS,
].sort((a, b) => b.length - a.length);

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

/** A map-local Stuka pass. The plane is deliberately separate from unit redraws. */
interface StukaFlyover {
  target: Axial;
  fromX: number;
  toX: number;
  y: number;
  t: number;
  dur: number;
  cannonT: number;
  cannonSeed: number;
  onDone: () => void;
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

interface MuzzleSmoke {
  node: Node;
  g: Graphics;
  x: number;
  y: number;
  ux: number;
  uy: number;
  size: number;
  t: number;
  dur: number;
  seed: number;
}

interface MainGunRecoilState {
  elapsed: number;
  ux: number;
  uy: number;
  mode: MainGunRecoilMode;
}

type ProjectileTraceMode = 'miss' | 'ricochet' | 'penetration' | 'overpenetration';
type ProjectileTracePhase = 'flight' | 'ricochet' | 'impact' | 'overpenetration-hidden' | 'overpenetration';

interface ProjectileTrace {
  node: Node;
  g: Graphics;
  mode: ProjectileTraceMode;
  phase: ProjectileTracePhase;
  startX: number;
  startY: number;
  impactX: number;
  impactY: number;
  exitX: number;
  exitY: number;
  endX: number;
  endY: number;
  ux: number;
  uy: number;
  bounceUx: number;
  bounceUy: number;
  t: number;
  dur: number;
  seed: number;
  skipPenetrationImpact?: boolean;
  onPenetrationImpact?: (x: number, y: number) => void;
}

type ProjectileReport = Pick<AttackReport, 'hit' | 'penetrated' | 'roll'>
  & Partial<Pick<AttackReport, 'overpenetrated'>>
  & Partial<Pick<AttackReport, 'penDie' | 'damageDie'>>;

interface HighExplosiveBlast {
  node: Node;
  g: Graphics;
  x: number;
  y: number;
  t: number;
  dur: number;
  seed: number;
}

interface MachineGunBurst {
  node: Node;
  g: Graphics;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  ux: number;
  uy: number;
  t: number;
  dur: number;
  seed: number;
  hit: boolean;
}

interface InfantryBulletLane {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
}

interface InfantryBulletVolley {
  node: Node;
  g: Graphics;
  lanes: readonly InfantryBulletLane[];
  ux: number;
  uy: number;
  t: number;
  dur: number;
}

interface InfantryRocketTrace {
  node: Node;
  g: Graphics;
  mode: ProjectileTraceMode;
  startX: number;
  startY: number;
  impactX: number;
  impactY: number;
  endX: number;
  endY: number;
  ux: number;
  uy: number;
  bounceUx: number;
  bounceUy: number;
  t: number;
  flightDur: number;
  dur: number;
  seed: number;
  impactSoundPlayed: boolean;
  onPenetrationImpact?: () => void;
}

interface SniperBulletTrace {
  node: Node;
  g: Graphics;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  ux: number;
  uy: number;
  t: number;
  dur: number;
  impacted: boolean;
  onImpact: () => void;
}

interface UnitEffectVisual {
  unit: Unit;
  seed: number;
  fireAlpha: number;
  smokeAlpha: number;
  smokeAge: number;
}

interface SmokeScreenVisual {
  seed: number;
  smokeAlpha: number;
  smokeAge: number;
}

interface FogVisionTransition {
  displayedHexKeys: Set<string>;
  pendingLayers: string[][];
  elapsed: number;
  expanding: boolean;
  activeLayer: ReadonlySet<string>;
  layerInterval: number;
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
const WINTER_TERRAIN_COLORS: Partial<Record<TerrainType, Color>> = {
  road: new Color(205, 208, 204, 255),
  field: new Color(225, 234, 231, 255),
  mud: new Color(176, 174, 170, 255),
  forest: new Color(210, 211, 204, 255),
  water: new Color(178, 204, 220, 255),
};
const TANK_TRACK_COLORS: Record<Exclude<TankTrackStyle, 'none'>, Color> = {
  strong: new Color(18, 16, 13, 78),
  normal: new Color(18, 16, 13, 53),
  shallow: new Color(48, 40, 28, 23),
  faint: new Color(20, 18, 15, 14),
};
/** 林地表冠层（多圆+阴影示意俯视树丛，Y 轴向上） */
const FOREST_TREE_DARK  = new Color( 28,  88,  30, 255);
const FOREST_TREE_MID   = new Color( 45, 118,  42, 255);
const FOREST_TREE_LIGHT = new Color( 70, 148,  58, 255);
const FOREST_SHADE      = new Color(  0,   0,   0,  50);
const FOREST_CANOPY_LAYOUT: ReadonlyArray<{ ox: number; oy: number; scale: number }> = [
  { ox: -0.38, oy:  0.25, scale: 0.64 },
  { ox:  0.00, oy:  0.38, scale: 0.70 },
  { ox:  0.38, oy:  0.25, scale: 0.64 },
  { ox: -0.30, oy: -0.05, scale: 0.68 },
  { ox:  0.08, oy:  0.02, scale: 0.74 },
  { ox:  0.38, oy: -0.12, scale: 0.62 },
  { ox: -0.25, oy: -0.39, scale: 0.58 },
  { ox:  0.22, oy: -0.38, scale: 0.64 },
];
const FOG_OVERLAY_COLOR = new Color( 68,  72,  76, 145);
const CAMPAIGN_SHADOW_COLOR = new Color(8, 10, 14, 190);
const EFFECTIVE_BATTLEFIELD_BOUNDARY_COLOR = new Color(245, 225, 150, 210);
const TURRET_AIM_HEX_FILL = new Color(76, 164, 238, 72);
const TURRET_AIM_BOUNDARY_COLOR = new Color(28, 104, 196, 245);
const TURRET_TRAVERSE_REACHABLE_ARC_COLOR = new Color(24, 238, 92, 245);
const TURRET_TRAVERSE_BLOCKED_ARC_COLOR = new Color(58, 62, 68, 235);
const PRECISION_TARGET_RETICLE_COLOR = new Color(224, 42, 48, 245);
const FOG_ATTACK_REVEAL_DURATION = 0.9;
const SMOKE_VISION_LAYER_INTERVAL = 1;
const HATCH_VISION_LAYER_INTERVAL = 0.5;
const PRECISION_AIM_HOLD_DURATION = 0.5;
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
const WINTER_BUILDING_ROOF = new Color(226, 235, 238, 255);
const WINTER_BUILDING_SHADE = new Color(188, 205, 214, 255);
const WINTER_BUILDING_RIDGE = new Color(250, 253, 255, 255);
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
const WINTER_ROAD_PATH_FILL = new Color(205, 211, 212, 255);
const WINTER_ROAD_PATH_OUTLINE = new Color(92, 98, 98, 255);
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
const WINTER_ROAD_GRIT_LIGHT = new Color(244, 249, 250, 150);
const WINTER_ROAD_GRIT_MID = new Color(208, 220, 224, 125);
const WINTER_ROAD_GRIT_DARK = new Color(166, 180, 184, 115);
/**
 * 水陆河岸过渡（仅在水域格内沿"非水域邻格"方向画的内偏移沙带）：双层条带形成由水→陆的渐变错觉
 * - 外层：略深米褐贴近水侧
 * - 内层：浅米黄贴近格心 / 陆地侧；两层在六角顶点处自然重叠成圆滑过渡
 */
const WATER_BANK_OUTER    = new Color(168, 142,  92, 230);
const WATER_BANK_INNER    = new Color(214, 196, 152, 235);
const WINTER_WATER_BANK_OUTER = new Color(176, 195, 202, 230);
const WINTER_WATER_BANK_INNER = new Color(220, 232, 235, 238);

const FACTION_COLORS: Record<Faction, Color> = {
  usa: new Color( 60, 160,  80, 255),
  soviet: new Color( 88, 132,  72, 255),
  german: new Color( 60,  60,  60, 255),
  japanese: new Color(128,  52,  44, 255),
  neutral: new Color(115, 110, 98, 255),
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
const BTN_BG_DISABLED = new Color( 78,  78,  78, 210);
const BTN_BORDER     = new Color(204, 190, 142, 235);
const HUD_TEXT_COLOR = new Color(255, 255, 255, 255);
const PVP_TURN_TIMER_W = 360;
const PVP_TURN_TIMER_H = 22;
const PVP_TURN_DEFAULT_MS = 60000;
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
/** 战斗逻辑继续使用成熟的 1280×720 坐标系，渲染根节点映射到 1920×1080 Canvas。 */
const UI_ROOT_SCALE = 1920 / CANVAS_W;
const BOARD_CENTER_OFFSET_Y = 38;
/** 与 MainMenuScene `BG_TOP` / `BG_MID` / `BG_BOTTOM` / `MENU_DIVIDER` 一致（主菜单渐变底图） */
const MAIN_MENU_STYLE_BG_TOP = new Color(40, 52, 38, 255);
const MAIN_MENU_STYLE_BG_MID = new Color(26, 34, 28, 255);
const MAIN_MENU_STYLE_BG_BOTTOM = new Color(13, 18, 17, 255);
const MAIN_MENU_STYLE_DIVIDER = new Color(145, 138, 100, 210);
/** 底部「阶段选择条 + 玩家骰子托盘」共用行中心 Y（Canvas 坐标，负值越大越靠下） */
const BOTTOM_PHASE_ROW_Y = -288;
/** 骰子下方还有动作说明；为整组底部操作 UI 预留完整内容高度与安全边距。 */
const BOTTOM_CONTROL_SAFE_INSET = 64;
/** 右下角「下一阶段 / 结束回合」与阶段条大按钮同高，且与底部行垂直对齐 */
const ADVANCE_BTN_W = 180;
const ADVANCE_BTN_H = 72;
const MODAL_BACKDROP     = new Color(  0,   0,   0, 180);
const MODAL_PANEL_BG     = new Color( 36,  41,  34, 245);
const DICE_EVENT_PANEL_BG = new Color(40, 44, 52, 51);
const DICE_EVENT_PANEL_BORDER = new Color(90, 98, 110, 255);
const TILE_INSPECT_PANEL_BG = DICE_EVENT_PANEL_BG;
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
/** Matching-dice actions use one accent distinct from every single-die action. */
const DIE_ACTION_DOUBLES  = new Color( 72,  88, 126, 240);
/** 选择阶段条「舱盖」与杂项同紫系，便于与移动/攻击区分 */
const PHASE_BTN_HATCH     = new Color(105,  96,  70, 240);
const PHASE_BTN_DISABLED  = new Color( 68,  68,  63, 210);
const DIE_ACTION_UNAVAILABLE = new Color(170, 170, 164, 235);

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
const ACTIVE_UNIT_PLAYER_FRAME = new Color(150, 245, 170, 255);
const ACTIVE_UNIT_ALLIED_FRAME = new Color(125, 220, 255, 255);
const ACTIVE_UNIT_ENEMY_FRAME  = new Color(255, 230, 135, 255);

// 掷骰展示面板配色
const DICE_BACKDROP    = new Color(  0,   0,   0, 180);
const DICE_PANEL_BG    = DICE_EVENT_PANEL_BG;
const DICE_PANEL_BORDER= DICE_EVENT_PANEL_BORDER;
const DICE_DIE_FILL    = new Color(245, 245, 235, 255);
const AI_ATTACK_DIE_FILL = new Color(255, 210, 210, 255);
const AI_MOVE_DIE_FILL   = new Color(214, 246, 214, 255);
const AI_MISC_DIE_FILL   = new Color(255, 240, 170, 255);
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
const CREW_STATUS_ICON_PATHS = [
  'textures/ui/crew_icons_source_split/crew_icon_01_star/spriteFrame',
  'textures/ui/crew_icons_source_split/crew_icon_02_crosshair/spriteFrame',
  'textures/ui/crew_icons_source_split/crew_icon_03_shell/spriteFrame',
  'textures/ui/crew_icons_source_split/crew_icon_04_steering/spriteFrame',
  'textures/ui/crew_icons_source_split/crew_icon_05_radio/spriteFrame',
] as const;
const CREW_RANK_ICON_PATHS = {
  veteran: 'textures/ui/unit_ranks/rank_veteran_32/spriteFrame',
  elite: 'textures/ui/unit_ranks/rank_elite_32/spriteFrame',
} as const;
const CREW_STATUS_NORMAL_COLOR = new Color(245, 245, 238, 255);
const CREW_STATUS_HATCH_OPEN_COLOR = new Color(40, 255, 80, 255);
const CREW_STATUS_DEAD_COLOR = new Color(125, 125, 125, 220);
const STATUS_CREW_ICON_SIZE = 38;
const STATUS_CREW_ICON_GAP = 6;
const STATUS_CREW_SLOT_COUNT = 5;
const STATUS_CREW_ROW_W = STATUS_CREW_ICON_SIZE * STATUS_CREW_SLOT_COUNT
  + STATUS_CREW_ICON_GAP * (STATUS_CREW_SLOT_COUNT - 1);
const STATUS_CREW_START_X = -STATUS_CREW_ROW_W / 2 + STATUS_CREW_ICON_SIZE / 2;

// 掷骰结果展示时序（秒）；骰面转动统一使用 DICE_ROLL_DUR。
const DICE_HIT_SHOW_DUR   = 0.6;
const DICE_PEN_SHOW_DUR   = 0.6;
const DICE_DMG_SHOW_DUR   = 0.6;
const DICE_CREW_SHOW_DUR  = 0.7;
const DICE_HOLD_DUR       = 0.7;
/** 掷骰阶段内每颗骰子面切换频率 */
const DICE_CYCLE_INTERVAL = 0.06;

// 战斗视觉：起火 / 受损由炮塔黑烟表达；摧毁 = 暗灰 + 红 X
const TANK_CONCEALED_ALPHA = 153; // 隐蔽时保留 60% 不透明度（增加 40% 透明度）
const DESTROYED_FILL   = new Color( 60,  60,  60, 220);
const DESTROYED_BORDER = new Color(220,  40,  40, 255);
// 当回合击毁残骸旁短标签（仅「已毁」；起火等改由格子下矢量状态图标；下回合起不再绘制）
const STATUS_TEXT_DEAD = new Color(220,  60,  60, 255);
const STATUS_TEXT_OUT  = new Color(  0,   0,   0, 220);

/** 坦克格子下方状态图标（受损、烟雾、隐蔽、着火均由车体视觉独立表达） */
type TankStatusBadgeKind = 'paralyzed' | 'turret';
type AIMoveState = 'turn_cw' | 'turn_ccw' | 'advance' | 'reverse';

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
/** 同格单位名称逐行向下排列，间距与名称 Label 的完整高度一致，给描边留足空间。 */
const UNIT_NAME_ROW_GAP = 22;
const UNIT_RANK_GOLD        = new Color(255, 205,  24, 255);
const UNIT_RANK_OUTLINE     = new Color( 20,  16,   8, 255);
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
  moveDuration: number = 0.4;

  @property({ tooltip: '【已废弃】敌方旧版贪心移动预算；GDD §3.7 骰子驱动 AI 已接管，保留仅为场景资源兼容' })
  movesPerTurn: number = 2;

  @property({ tooltip: '战斗随机种子；留 0 用时间种子，非 0 便于复现' })
  rngSeed: number = 0;

  private battleBackgroundNode: Node | null = null;
  private resolutionUnsubscribe: (() => void) | null = null;
  /** Screen-space HUD. It never participates in map panning and is laid out from the visible rect. */
  private hudRoot: Node | null = null;
  private turnEndListButton: Node | null = null;
  private settingsButton: Node | null = null;
  private g: Graphics | null = null;
  private terrainLayerNode: Node | null = null;
  private mapNode: Node | null = null;
  private mapInputNode: Node | null = null;
  private turretAimOverlayNode: Node | null = null;
  private turretAimOverlayGraphics: Graphics | null = null;
  private fogNode: Node | null = null;
  private fogGraphics: Graphics | null = null;
  private unitVisibilityMaskNode: Node | null = null;
  private unitVisibilityMaskGraphics: Graphics | null = null;
  private trackVisibilityMaskGraphics: Graphics | null = null;
  private unitGraphics: Graphics | null = null;
  /** Exhaust is clipped with units but drawn below every hull sprite. */
  private tankExhaustGraphics: Graphics | null = null;
  private tankExhaustParticles: TankExhaustParticle[] = Array.from(
    { length: TANK_EXHAUST_MAX_PARTICLES },
    () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      age: 0,
      lifetime: 1,
      startRadius: 1,
      endRadius: 2,
      shade: 72,
      moving: false,
    }),
  );
  private tankExhaustEmitterStates = new Map<string, TankExhaustEmitterState>();
  private tankExhaustLiveEmitterIds = new Set<string>();
  private tankExhaustFreeIndices = Array.from(
    { length: TANK_EXHAUST_MAX_PARTICLES },
    (_, index) => TANK_EXHAUST_MAX_PARTICLES - 1 - index,
  );
  private tankExhaustDrawBuckets: number[][] = Array.from({ length: 16 }, () => []);
  private tankExhaustRadiusCache = new Array<number>(TANK_EXHAUST_MAX_PARTICLES).fill(0);
  private tankExhaustBodyColors: Color[] = Array.from({ length: 16 }, (_, index) => {
    const shadeBucket = Math.floor(index / 4);
    const alphaBucket = index % 4;
    const shade = 78 + shadeBucket * 18;
    return new Color(shade, shade, shade - 7, 16 + alphaBucket * 32);
  });
  private tankExhaustHighlightColors: Color[] = Array.from({ length: 16 }, (_, index) => {
    const shadeBucket = Math.floor(index / 4);
    const alphaBucket = index % 4;
    const shade = 78 + shadeBucket * 18;
    return new Color(
      Math.min(170, shade + 22),
      Math.min(168, shade + 20),
      Math.min(160, shade + 13),
      Math.round((16 + alphaBucket * 32) * 0.34),
    );
  });
  private tankExhaustSerial = 0;
  private tankTrackGraphics: Graphics | null = null;
  private tankTracks: TankTrackMove[] = [];
  private activeTankTrackAnim: MoveAnim | null = null;
  private activeTankTrack: TankTrackMove | null = null;
  private mapOcclusionGraphics: Graphics | null = null;
  private mapDeepShadowGraphics: Graphics | null = null;
  private infantryBloodDecalLayerNode: Node | null = null;
  private infantryBloodSpriteFrames: Array<SpriteFrame | null> = [null, null, null, null];
  private infantryBloodDecalNodes: Node[] = [];
  private infantryBloodDecalUnitIds = new Set<string>();
  private pendingInfantryBloodDecals = new Map<string, {
    unit: Unit;
    forceCoLocateOtherUnit: boolean;
    customOffsets?: Array<{ ox: number; oy: number }>;
  }>();
  private unitEffectNode: Node | null = null;
  private unitEffectGraphics: Graphics | null = null;
  /** Smoke screens stay visible above fog so an obscured hex is still identifiable. */
  private smokeScreenEffectNode: Node | null = null;
  private smokeScreenEffectGraphics: Graphics | null = null;
  private unitEffectVisuals = new Map<string, UnitEffectVisual>();
  private smokeScreenAges = new Map<string, number>();
  private unitEffectTime = 0;
  private visibleHexKeys = new Set<string>();
  private fogVisionTransition: FogVisionTransition | null = null;
  private transientFogRevealKeys = new Set<string>();
  /** Tracks living allied tanks between redraws so a newly destroyed tank can keep only its own hex visible briefly. */
  private visibilityTrackingMission: LoadedMission | null = null;
  private livingFriendlyTankHexKeys = new Map<string, string>();
  private destroyedFriendlyTankHexRevealExpiry = new Map<string, number>();
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
  private winterTerrainSpriteFrames: Partial<Record<TerrainType, SpriteFrame | null>> = {};
  private terrainSpritePool: Array<{ node: Node; sprite: Sprite }> = [];
  private terrainSpritePoolNext = 0;
  private treeSpriteFrames: Array<SpriteFrame | null> = [null, null, null, null];
  private winterTreeSpriteFrames: Array<SpriteFrame | null> = [null, null, null, null];
  private foliageSpritePool: Array<{ node: Node; sprite: Sprite }> = [];
  private foliageSpritePoolNext = 0;
  private shermanSpriteNode: Node | null = null;
  private shermanTopSprite: Sprite | null = null;
  private shermanTopSpriteFrame: SpriteFrame | null = null;
  private shermanTurretSpriteNode: Node | null = null;
  private shermanTurretTopSprite: Sprite | null = null;
  private shermanCommanderHatchSprite: Sprite | null = null;
  private shermanCommanderHatchSpriteNode: Node | null = null;
  private shermanCommanderHatchSpriteFrame: SpriteFrame | null = null;
  private emptyCommanderHatchSpriteFrame: SpriteFrame | null = null;
  /** Keyed by the commander SpriteFrame path from units.csv, not by faction or tank kind. */
  private commanderHatchSpriteFrames: Record<string, SpriteFrame> = {};
  private splitTankSprites: Partial<Record<SplitTankKind, SplitTankSpriteAssets>> = {};
  /** 加载时锁定的裁切显示宽高；避免每帧 `sprite.spriteFrame = sf` 后引擎改写 sf.width/height 导致宽高比崩（日志里 movement 阶段 th 被拉成与 tw 相等）。 */
  private shermanSpriteDisplayW = 0;
  private shermanSpriteDisplayH = 0;
  /** 德军俯视图（四号/三号/虎/卡）：多单位共用节点池；每帧 redraw 开头清零再按绘制顺序占用 */
  private enemyTopMeta: Partial<Record<EnemyTopKind, { sf: SpriteFrame; dw: number; dh: number }>> = {};
  private destroyedTopMeta: Partial<Record<DestroyedTopKind, { sf: SpriteFrame; dw: number; dh: number }>> = {};
  private enemyTopSpritePool: Array<{ node: Node; sprite: Sprite }> = [];
  private enemyTopPoolNext = 0;
  private static readonly ENEMY_TOP_SPRITE_POOL = 16;
  /** Presentation-only transforms for living engine-powered vehicles in the current redraw. */
  private engineVibrationTime = 0;
  private engineVibrationVisuals: EngineVibrationVisual[] = [];
  private commanderHatchSpritePool: Array<{ node: Node; sprite: Sprite }> = [];
  private commanderHatchPoolNext = 0;
  private static readonly COMMANDER_HATCH_SPRITE_POOL = 12;
  /**
   * 步兵 / 军官小队俯视图：每个徒步单位用 3 张 Infantry01~03.png 组成"3 人小队"。
   * 池大小 = 单位数上限 × 3；redraw 开头与坦克池一并清零。
   */
  private infantrySpriteFramesByKind: Record<InfantryVisualKind, Array<SpriteFrame | null>> = {
    infantry: [null, null, null],
    german_infantry: [null, null, null],
    soviet_infantry: [null, null, null],
    japanese_infantry: [null, null, null],
    american_infantry: [null, null, null],
  };
  private infantrySpriteDimsByKind: Record<InfantryVisualKind, Array<{ dw: number; dh: number }>> = {
    infantry: [{ dw: 0, dh: 0 }, { dw: 0, dh: 0 }, { dw: 0, dh: 0 }],
    german_infantry: [{ dw: 0, dh: 0 }, { dw: 0, dh: 0 }, { dw: 0, dh: 0 }],
    soviet_infantry: [{ dw: 0, dh: 0 }, { dw: 0, dh: 0 }, { dw: 0, dh: 0 }],
    japanese_infantry: [{ dw: 0, dh: 0 }, { dw: 0, dh: 0 }, { dw: 0, dh: 0 }],
    american_infantry: [{ dw: 0, dh: 0 }, { dw: 0, dh: 0 }, { dw: 0, dh: 0 }],
  };
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
  private suppressionMarkPool: Array<{ node: Node; graphics: Graphics }> = [];
  private suppressionMarkPoolNext = 0;
  private static readonly SUPPRESSION_MARK_POOL = 48;
  /** Stuka presentation sits above unit content; the graphics layer renders its cannon pass. */
  private stukaSpriteFrame: SpriteFrame | null = null;
  private stukaSpriteNode: Node | null = null;
  private stukaBlastNode: Node | null = null;
  private stukaBlastGraphics: Graphics | null = null;
  private stukaFlyover: StukaFlyover | null = null;
  private mission: LoadedMission | null = null;
  private campaignRuntime: StitchedCampaignData | null = null;
  private activeCampaignSegmentIndex = 0;
  private campaignViewSegmentIndexOverride: number | null = null;
  private campaignTransitionActive = false;
  private campaignPanAnim: CampaignPanAnim | null = null;
  private campaignAutoEvacActive = false;
  private campaignUpgradeIds: CampaignUpgradeId[] = [];
  private campaignUpgradeCandidates: CampaignUpgradeId[] = [];
  private campaignUpgradeChosenSegments = new Set<number>();
  private campaignUpgradeSelectedIndex = 1;
  private campaignUpgradeChoiceRoot: Node | null = null;
  private campaignUpgradeDetailRoot: Node | null = null;
  private campaignUpgradeChoiceCards: CampaignUpgradeCardRefs[] = [];
  private campaignUpgradeStatusRoot: Node | null = null;
  private campaignUpgradeStatusTitleLabel: Label | null = null;
  private campaignUpgradeStatusSlots: Node[] = [];
  private campaignUpgradeIconAtlas: SpriteFrame | null = null;
  private campaignUpgradeIconAtlasLoading = false;
  private campaignUpgradeIconWaiters: Array<(atlas: SpriteFrame | null) => void> = [];
  private campaignUpgradeIconAtlasV2: SpriteFrame | null = null;
  private campaignUpgradeIconAtlasV2Loading = false;
  private campaignUpgradeIconV2Waiters: Array<(atlas: SpriteFrame | null) => void> = [];
  private campaignUpgradeHvapIcon: SpriteFrame | null = null;
  private campaignUpgradeHvapIconLoading = false;
  private campaignUpgradeHvapIconWaiters: Array<(icon: SpriteFrame | null) => void> = [];
  private retainedCampaignAttackDiePip: number | null = null;
  private offsetX = 0;
  private offsetY = 0;
  private mapPanEnabled = false;
  private mapPanMoved = false;
  private mapPanDistance = 0;
  private mapPanMinX = 0;
  private mapPanMaxX = 0;
  private mapPanMinY = 0;
  private mapPanMaxY = 0;
  private anim: MoveAnim | null = null;
  private turretAimAnim: TurretAimAnim | null = null;
  private shermanTurretFacing: FireDirection | null = null;
  private enemyTurretFacing = new Map<string, FireDirection>();
  private infantryVisualFacing = new Map<string, Direction>();
  /** Exact inherited heading used when an AT-gun crew is released as infantry. */
  private infantryVisualAngleOverride = new Map<string, number>();

  private resetTurretFacingState() {
    stopTurretTraverseSound();
    this.turretAimAnim = null;
    this.enemyTurretFacing.clear();
    if (!this.mission) {
      this.shermanTurretFacing = null;
      return;
    }

    const { sherman, allies, enemies } = this.mission;
    this.shermanTurretFacing = sherman.turretFacing ?? sherman.facing;
    for (const unit of [...allies, ...enemies]) {
      if (!isSplitTankKind(unit.kind) && !isAntiTankGunUnit(unit)) continue;
      const facing = unit.turretFacing ?? unit.facing;
      if (facing !== null) this.enemyTurretFacing.set(unit.id, facing);
    }
  }
  /** 多段移动/转向衔接（如回合结束德军卡车沿路推进） */
  private animQueue: MoveAnim[] = [];
  /** 当前 animQueue 播完后执行（避免敌方阶段误进 runNextEnemyStep） */
  private pendingAfterAnimChain: (() => void) | null = null;

  /** 任务 JSON 谢尔曼出生格与出生朝向；用于在出生格上永久绘制从场外驶入的灰色箭头 */
  private shermanSpawnQr: { q: number; r: number } | null = null;
  private shermanSpawnFacing: Direction | null = null;

  // 回合状态
  private turn: number = 1;
  private attackPositionMemory: AttackPositionMemory = createAttackPositionMemory();
  private phase: Phase = 'player';
  /** 玩家回合内的子状态机（见 PlayerStep 注释） */
  private playerStep: PlayerStep = 'choose';
  /** 本回合是否已经执行过移动阶段 / 攻击阶段 / 杂项阶段；
   * GDD §2.3：C 列（杂项）必须最后执行，所以 miscDone = true 时同样视为回合子阶段已终结。 */
  private movementDone: boolean = false;
  private attackDone: boolean = false;
  private miscDone: boolean = false;
  /** 防止 busy 期间为同一自动阶段切换启动多条逐帧重试链。 */
  private pendingAutoEnterPhase: 'movement' | 'attack' | 'misc' | null = null;
  /** 某次动作已耗尽当前阶段的未使用骰子；等待该动作完整结束后再推进阶段。 */
  private pendingAutoEndStep: PlayerStep | null = null;
  private hatchChangedThisTurn: boolean = false;
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
  /** Precision fire applies -2 to the final hit threshold while the selected gun dice are active. */
  private selectedGunHitThresholdModifier: number = 0;
  private precisionAimHoldCallback: (() => void) | null = null;
  /**
   * 攻击 mg（3/4）/ 杂项 codriver_mg（2）时玩家点中的机枪骰下标。-1 = 未选。
   * 机枪选中与主炮选中 *互斥* —— 任一进入选中态都会把另一方清零，避免玩家困惑"这颗骰到底选哪一发"。
   */
  private selectedMGDieIdx: number = -1;
  /** A legal target click hides the green range immediately while keeping dice selection for async resolution. */
  private turretTargetOverlaySuppressed = false;

  // 敌方阶段调度（GDD §3.7 AI 表骰子驱动版）
  /** 本回合按"距离谢尔曼最近→最远"排序后的活单位列表；beginEnemyPhase 时锁定一次 */
  private enemyOrder: Unit[] = [];
  /** enemyOrder 的下标指针 */
  private enemyIndex: number = 0;
  private aiSide: 'ally' | 'german' = 'german';
  /** 当前敌坦本回合掷出的一串 d6 点数 */
  private enemyDice: number[] = [];
  private enemyDiceTypes: (EnemyTankDieType | null)[] = [];
  /** 当前非玩家坦克起始格的火力值修正；本组攻击骰执行期间保持不变。 */
  private enemyFirepowerModifier = 0;
  /** 与 enemyDice 同长度：每颗是否已消耗 */
  private enemyDiceUsed: boolean[] = [];
  private enemyDiceResolvedActions: (EnemyAction | null | undefined)[] = [];
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
  /** 当前 AI 单位最近一次真实移动动作，用于避免连续反向空转。 */
  private aiMoveState: { unit: Unit; state: AIMoveState } | null = null;
  private pendingAIMoveState: { unit: Unit; action: EnemyAction; state: AIMoveState | null } | null = null;
  /** 非 null 表示正在播排序位移动画，播完后再 runNextEnemyStep */
  private enemyDiceSortAnim: {
    t: number;
    dur: number;
    fromSlot: number[];
    toSlot: number[];
  } | null = null;
  /** AI 单位所有骰都执行完后，保留整组骰子结果一小段时间再切到下一单位 */
  private enemyDiceResultHold: {
    t: number;
    dur: number;
  } | null = null;
  /** 当前单位本轮 AI 骰是否至少执行过一次有效动作 */
  private enemyDidActThisTurn: boolean = false;
  /** 当前硬核步兵已执行的等级动作序号。 */
  private enemyInfantryActionIndex: number = 0;
  /** 敌方当前正在执行的那颗骰下标；-1 无高亮 */
  private enemyDiceHighlightIdx: number = -1;
  private activeActingUnit: Unit | null = null;
  private activeActingFrameNode: Node | null = null;
  private activeActingFrameGraphics: Graphics | null = null;
  // 战斗 / 胜负
  private rng: RNG = new RNG(1);
  private outcome: MissionOutcome = 'ongoing';
  private outcomeLabel: Label | null = null;
  private restartBtn: Node | null = null;
  private backToMenuBtn: Node | null = null;
  // 战报浮字池：挂在 mapNode 下，随 update() 上浮 + 渐隐自毁
  private floaters: Floater[] = [];
  private muzzleFlashes: MuzzleFlash[] = [];
  private muzzleSmokes: MuzzleSmoke[] = [];
  private muzzleSmokeSerial = 0;
  private projectileTraces: ProjectileTrace[] = [];
  private highExplosiveBlasts: HighExplosiveBlast[] = [];
  private machineGunBursts: MachineGunBurst[] = [];
  private infantryBulletVolleys: InfantryBulletVolley[] = [];
  private infantryRocketTraces: InfantryRocketTrace[] = [];
  private sniperBulletTraces: SniperBulletTrace[] = [];
  private mainGunRecoils = new Map<string, MainGunRecoilState>();
  private firedAttackCueReports = new WeakSet<AttackReport>();
  // 命中预览 Label 池：常驻显示，随 redraw 整批重建
  private previewLabels: Node[] = [];
  private previewLabelNext = 0;
  // 单位状态文字池（仅已毁短标签）：随 redraw 整批重建
  private statusLabels: Node[] = [];
  private statusLabelNext = 0;
  /** 坦克状态图标条（矢量），在格心下方横向排列 */
  private statusBadgeNodes: Node[] = [];
  private statusBadgeNext = 0;
  // 单位名字文字池（"谢尔曼" / "虎式" 等）：常驻显示，随 redraw 整批重建
  private nameLabels: Node[] = [];
  private nameLabelNext = 0;
  /**
   * 本战斗轮次内**刚被击毁**、应绘制残骸（灰圆+红叉）与「已毁」短标签的单位 id。
   * 在 `endEnemyPhase` 转入下一玩家回合时清空，即每回合①开始时清除上一轮留下的击毁标记。
   */
  private destroyWreckVisualIds = new Set<string>();
  /** Tanks whose turret has already detached; prevents duplicate launch effects. */
  private destroyedTurretVisualIds = new Set<string>();
  private destroyedTurretVisuals: DestroyedTurretVisual[] = [];

  // HUD
  /** 左上角最上行：任务 JSON `id` + 关卡名（`LevelDB.titleKey` 或 `MissionData.name`） */
  private missionTitleLabel: Label | null = null;
  private weatherHudLabel: Label | null = null;
  private weatherEffectNode: Node | null = null;
  private weatherEffectGraphics: Graphics | null = null;
  private readonly rainVisualSample: RainVisualSample = {
    phase: 'idle',
    impactX: 0,
    impactY: 0,
    headX: 0,
    headY: 0,
    streakLength: 0,
    slant: 0,
    alpha: 0,
    fallDistance: 0,
    fallSpeed: 0,
    splashRadius: 0,
    splashRayLength: 0,
    splashRayCount: 0,
    splashRotation: 0,
  };
  private readonly snowVisualSample: SnowVisualSample = {
    x: 0,
    y: 0,
    radius: 0,
    alpha: 0,
    depth: 0,
  };
  private pvpHudLabel: Label | null = null;
  private pvpTurnTimerRoot: Node | null = null;
  private pvpTurnTimerBg: Graphics | null = null;
  private pvpTurnTimerFill: Graphics | null = null;
  private pvpTurnTimerLabel: Label | null = null;
  private pvpBattleUnlisten: (() => void) | null = null;
  private pvpBattleStarted = false;
  private pvpOutcomeSent = false;
  private pvpCurrentParity: 'odd' | 'even' | null = null;
  private pvpLastSnapshotTurn = 0;
  private pvpTurnDeadlineAt = 0;
  private pvpTurnDurationMs = PVP_TURN_DEFAULT_MS;
  private pvpTurnServerNowAt = 0;
  private pvpTurnTimerReceivedAt = 0;
  private pvpTurnTimeoutSubmitted = false;
  private pvpApplyingRemoteState = false;
  private pvpLastSentUnitHash = '';
  private pvpPendingRemoteSnapshots: Array<{ snapshot: PvpBattleSnapshot; animate: boolean; action?: unknown }> = [];
  private pvpLastTransitionKey = '';
  private turnTransition: {
    root: Node; panel: Node; panelOpacity: UIOpacity; title: Label; subtitle: Label; icon: Sprite;
    t: number; faction: string; onDone: () => void;
  } | null = null;
  private factionSpriteFrames = new Map<string, SpriteFrame>();
  private hudLabel: Label | null = null;
  /** 回合数下方：多行任务目标（与 `OBJECTIVE_HUD_MAX` 同序） */
  private objectiveHudLabels: Label[] = [];
  private static readonly OBJECTIVE_HUD_MAX = 6;
  private endTurnBtn: Node | null = null;
  private endTurnBg: Graphics | null = null;
  private endTurnLabel: Label | null = null;
  private campaignDebugSkipBtn: Node | null = null;
  /** 底部"阶段选择"条：舱盖 + 移动 / 攻击；在 choose 子步骤可见，其他子步骤隐藏 */
  private chooseBar: Node | null = null;
  private chooseHatchBtn: Node | null = null;
  private chooseHatchLabel: Label | null = null;
  private chooseMoveBtn: Node | null = null;
  private chooseAttackBtn: Node | null = null;
  private disabledPhaseButtons = new Set<Node>();
  /** 底部骰子托盘：movement/attack 子步骤时显示 */
  private diceTrayRoot: Node | null = null;
  private diceVisuals: DieVisual[] = [];
  /** 点击某颗骰子时弹出的动作菜单；每次弹出都重建 */
  private diePopover: Node | null = null;
  /** 当前动作菜单所属的骰子下标；用于再次点击同一颗骰子时切换收起。 */
  private diePopoverDieIdx: number = -1;
  /** 攻击掷骰动画面板；非 null 时锁定所有输入 */
  private diceShow: DiceShow | null = null;
  /** 回合结束事件：主骰 →（若有）额外掷骰各一段动画 → 完整说明，确认后 apply */
  private turnEndEventUI: {
    root: Node;
    stage:
      | 'roll_primary'
      | 'wait_after_primary'
      | 'pause_for_sniper'
      | 'pause_before_adjacent_dice'
      | 'roll_extra'
      | 'wait_after_extra'
      | 'hold';
    t: number;
    dieLabels: Label[];
    primaryDice: number[];
    sumLabel: Label;
    bodyLabel: Label;
    confirmButton: Node;
    bodyKey: string;
    bodyParams: Record<string, string | number>;
    /** 本行效果类型（本地化短名），写入战斗记录用 */
    effectName: string;
    effectType: TurnEndEffectType;
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
    sniperAttackerId?: string;
    sniperWillKill?: boolean;
    sniperRevealKey?: string;
    effectApplied?: boolean;
  } | null = null;
  private turnEndUnitSeq = 0;
  /** §2.1 阶段⑤ 着火检定：播 d6 动画 + 说明，确认后写回状态再继续友方/敌方阶段 */
  private fireCheckEventUI: {
    root: Node;
    stage: 'roll' | 'hold';
    t: number;
    dieLabels: Label[];
    allDice: number[];
    sumLabel: Label;
    bodyLabel: Label;
    confirmButton: Node;
    introKey: string;
    introParams: Record<string, string | number>;
    bodyText: string;
    ruleModalRoot: Node | null;
    apply: () => void;
    onComplete: () => void;
  } | null = null;
  private usCasualtyEventUI: {
    root: Node;
    stage: 'roll' | 'hold';
    t: number;
    dieLabels: Label[];
    dice: number[];
    providerLabel: Label;
    resultLabel: Label;
    confirmButton: Node;
    hits: number;
    limit: number;
    applied: boolean;
  } | null = null;

  // ---- 右侧谢尔曼状态面板 ----
  private statusPanel: Node | null = null;
  private statusLoaded: Label | null = null;   // 装填 / 未装填
  private statusFire: Label | null = null;     // 着火层数 / "-"（车体旧文案已迁出）
  private statusTurret: Label | null = null;   // 完好 / 受损
  private statusMobility: Label | null = null; // 正常 / 痛痪
  private statusRadio: Label | null = null;
  private statusCrewIcons: Sprite[] = [];
  private statusCrewDeadMarkers: Node[] = [];
  private statusCrewRankNodes: Node[] = [];
  private statusCrewRankIcons: Sprite[] = [];
  /** 状态面板固定文案（切语言时刷新） */
  private statusPanelTitleLabel: Label | null = null;
  private statusBodyLeftLabels: Label[] = [];
  private statusCrewTitleLabel: Label | null = null;
  private crewStatusIconFrames: Array<SpriteFrame | null> = [null, null, null, null, null];
  private crewStatusRankFrames: { veteran: SpriteFrame | null; elite: SpriteFrame | null } = {
    veteran: null,
    elite: null,
  };
  /** 底部阶段条按钮文字 */
  private chooseMoveLabel: Label | null = null;
  private chooseAttackLabel: Label | null = null;
  /** 胜负界「再来一局 / 返回主菜单」子 Label */
  private restartBtnLabel: Label | null = null;
  private backToMenuBtnLabel: Label | null = null;

  // 存档/读档
  private missionId: string = '';
  private missionSource: MissionSource = { type: 'resource', missionPath: 'missions/mission_01' };
  private turnEndEventProvider: TurnEndEventProvider = OfficialTurnEndEventProvider;

  /** 战斗内模态（设置）；退出确认单独一层叠在上面 */
  private battleModalRoot: Node | null = null;
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
  private combatLogLabel: RichText | null = null;
  private combatLogPlainLabel: Label | null = null;
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
  private static readonly FOLIAGE_SPRITE_POOL = 384;
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
        },
      );
      this.loadSpriteFrame(
        assets.turretSpritePath,
        `[BattleScene] ${kind} turret split sprite load failed; fallback to top sprite:`,
        (sf) => {
          split.turret = sf;
        },
      );
    });

    this.loadSpriteFrame(
      'textures/units/sherman_commander_hatch_open_v2/spriteFrame',
      '[BattleScene] Sherman commander hatch sprite load failed; hatch will have no commander visual:',
      (sf) => {
        this.shermanCommanderHatchSpriteFrame = sf;
        if (this.shermanCommanderHatchSprite) this.shermanCommanderHatchSprite.spriteFrame = sf;
      },
    );

    this.loadSpriteFrame(
      'textures/units/sherman_commander_hatch_open_dead/spriteFrame',
      '[BattleScene] empty commander hatch sprite load failed; open hatches will be hidden after commander death:',
      (sf) => {
        this.emptyCommanderHatchSpriteFrame = sf;
      },
    );

    const commanderHatchPaths = new Set(
      TANK_VISUAL_KINDS
        .map((kind) => getUnitStats(kind).commanderSpritePath ?? '')
        .filter((path) => !!path),
    );
    commanderHatchPaths.forEach((path) => {
      this.loadSpriteFrame(
        path,
        `[BattleScene] commander hatch sprite load failed (${path}); hatch will have no commander visual:`,
        (sf) => {
          this.commanderHatchSpriteFrames[path] = sf;
        },
      );
    });

    this.loadSpriteFrame(
      'textures/units/stuka_top/spriteFrame',
      '[BattleScene] Stuka sprite load failed; flyover will use its fallback marker:',
      (sf) => {
        this.stukaSpriteFrame = sf;
        if (this.stukaSpriteNode) {
          const sprite = this.stukaSpriteNode.getComponent(Sprite);
          if (sprite) sprite.spriteFrame = sf;
        }
      },
    );
  }

  onLoad() {
    applyAdaptiveResolution();
    this.node.setScale(UI_ROOT_SCALE, UI_ROOT_SCALE, 1);
    setLang(MenuProgress.load().lang);
    initGameAudio();
    stopBgm();
    playBgmBattle();
    this.buildMainMenuStyleBattleBackground();
    this.resolutionUnsubscribe = subscribeAdaptiveResolution(() => {
      this.rebuildBackgroundForResolution();
      this.layoutBattleHud();
      this.layoutTurnTransition();
    });
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

    // Permanent tank tracks sit above terrain but below buildings, foliage,
    // units, campaign darkness and fog. They are redrawn only when movement
    // adds a new segment, never from update().
    const trackMaskNode = new Node('VisibleTrackMask');
    trackMaskNode.layer = this.node.layer;
    trackMaskNode.addComponent(UITransform).setContentSize(1280, 720);
    const trackMask = trackMaskNode.addComponent(Mask);
    trackMask.type = Mask.Type.GRAPHICS_STENCIL;
    this.trackVisibilityMaskGraphics = trackMask.subComp as Graphics;
    gNode.addChild(trackMaskNode);

    const tankTrackNode = new Node('TankTracks');
    tankTrackNode.layer = this.node.layer;
    tankTrackNode.addComponent(UITransform).setContentSize(1280, 720);
    this.tankTrackGraphics = tankTrackNode.addComponent(Graphics);
    trackMaskNode.addChild(tankTrackNode);

    const bloodDecalNode = new Node('InfantryBloodDecals');
    bloodDecalNode.layer = this.node.layer;
    bloodDecalNode.addComponent(UITransform).setContentSize(1280, 720);
    this.infantryBloodDecalLayerNode = bloodDecalNode;
    // Blood is a ground decal: render it above roads/tracks, but below the
    // later MapOcclusion layer that contains buildings and forest canopies.
    // Reusing the track visibility mask also keeps it hidden by fog.
    trackMaskNode.addChild(bloodDecalNode);

    // Targetable/rotatable hex tint: above terrain and permanent decals, but
    // below MapOcclusion (buildings, forest canopies and hedges), foliage sprites,
    // units, status/name labels and hit-chance previews.
    const turretAimOverlayNode = new Node('TurretAimOverlay');
    turretAimOverlayNode.layer = this.node.layer;
    turretAimOverlayNode.addComponent(UITransform).setContentSize(1280, 720);
    this.turretAimOverlayGraphics = turretAimOverlayNode.addComponent(Graphics);
    this.turretAimOverlayNode = turretAimOverlayNode;
    gNode.addChild(turretAimOverlayNode);

    const occlusionNode = new Node('MapOcclusion');
    occlusionNode.layer = this.node.layer;
    occlusionNode.addComponent(UITransform).setContentSize(1280, 720);
    this.mapOcclusionGraphics = occlusionNode.addComponent(Graphics);
    gNode.addChild(occlusionNode);

    const fogNode = new Node('FogOfWar');
    fogNode.layer = this.node.layer;
    fogNode.addComponent(UITransform).setContentSize(1280, 720);
    this.fogGraphics = fogNode.addComponent(Graphics);
    this.fogNode = fogNode;
    gNode.addChild(fogNode);

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

    // Keep inactive-campaign/display-only darkness in its own compositing layer.
    // It must sit above buildings and foliage so those overlays cannot appear lit
    // inside a shadowed hex, while units and the regular fog layer remain separate.
    const deepShadowNode = new Node('MapDeepShadow');
    deepShadowNode.layer = this.node.layer;
    deepShadowNode.addComponent(UITransform).setContentSize(1280, 720);
    this.mapDeepShadowGraphics = deepShadowNode.addComponent(Graphics);
    gNode.addChild(deepShadowNode);

    // 谢尔曼俯视图：子节点在父节点 MapGraphics 的 Graphics 之后绘制 → 叠在地形之上。
    // Units are always rendered, then clipped to the union of currently visible hexes.
    // This lets a moving tank emerge continuously without making terrain fog opaque.
    const unitMaskNode = new Node('VisibleUnitMask');
    unitMaskNode.layer = this.node.layer;
    unitMaskNode.addComponent(UITransform).setContentSize(1280, 720);
    gNode.addChild(unitMaskNode);
    const unitMask = unitMaskNode.addComponent(Mask);
    unitMask.type = Mask.Type.GRAPHICS_STENCIL;
    this.unitVisibilityMaskNode = unitMaskNode;
    this.unitVisibilityMaskGraphics = unitMask.subComp as Graphics;

    const unitContentNode = new Node('UnitContent');
    unitContentNode.layer = this.node.layer;
    unitContentNode.addComponent(UITransform).setContentSize(1280, 720);
    this.unitGraphics = unitContentNode.addComponent(Graphics);
    unitMaskNode.addChild(unitContentNode);

    const tankExhaustNode = new Node('TankEngineExhaust');
    tankExhaustNode.layer = this.node.layer;
    tankExhaustNode.addComponent(UITransform).setContentSize(1280, 720);
    this.tankExhaustGraphics = tankExhaustNode.addComponent(Graphics);
    unitContentNode.addChild(tankExhaustNode);

    const shNode = new Node('ShermanTopSprite');
    shNode.layer = this.node.layer;
    shNode.addComponent(UITransform).setContentSize(1280, 720);
    this.shermanTopSprite = shNode.addComponent(Sprite);
    // CUSTOM：用 UITransform 定最终像素边长，避免 TRIMMED + setScale 与 1280×720 占位在 UI 刷新时叠出异常缩放
    this.shermanTopSprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.shermanSpriteNode = shNode;
    shNode.active = false;

    unitContentNode.addChild(shNode);

    const shTurretNode = new Node('ShermanTurretTopSprite');
    shTurretNode.layer = this.node.layer;
    shTurretNode.addComponent(UITransform).setContentSize(1280, 720);
    this.shermanTurretTopSprite = shTurretNode.addComponent(Sprite);
    this.shermanTurretTopSprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.shermanTurretSpriteNode = shTurretNode;
    shTurretNode.active = false;
    unitContentNode.addChild(shTurretNode);

    // Kept under the turret node so the commander inherits every turret rotation.
    const shCommanderNode = new Node('ShermanCommanderHatchSprite');
    shCommanderNode.layer = this.node.layer;
    shCommanderNode.addComponent(UITransform).setContentSize(1, 1);
    this.shermanCommanderHatchSprite = shCommanderNode.addComponent(Sprite);
    this.shermanCommanderHatchSprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.shermanCommanderHatchSpriteNode = shCommanderNode;
    shCommanderNode.active = false;
    shTurretNode.addChild(shCommanderNode);

    for (let i = 0; i < BattleScene.ENEMY_TOP_SPRITE_POOL; i++) {
      const pz = new Node(`EnemyTop_${i}`);
      pz.layer = this.node.layer;
      pz.addComponent(UITransform).setContentSize(1280, 720);
      const spz = pz.addComponent(Sprite);
      spz.sizeMode = Sprite.SizeMode.CUSTOM;
      pz.active = false;
      this.enemyTopSpritePool.push({ node: pz, sprite: spz });
      unitContentNode.addChild(pz);
    }
    for (let i = 0; i < BattleScene.COMMANDER_HATCH_SPRITE_POOL; i++) {
      const commander = new Node(`CommanderHatch_${i}`);
      commander.layer = this.node.layer;
      commander.addComponent(UITransform).setContentSize(1, 1);
      const sprite = commander.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      commander.active = false;
      this.commanderHatchSpritePool.push({ node: commander, sprite });
      unitContentNode.addChild(commander);
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
      unitContentNode.addChild(inf);
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
      unitContentNode.addChild(ofN);
    }
    for (let i = 0; i < BattleScene.SUPPRESSION_MARK_POOL; i++) {
      const markNode = new Node(`SuppressionMark_${i}`);
      markNode.layer = this.node.layer;
      markNode.addComponent(UITransform).setContentSize(16, 24);
      const graphics = markNode.addComponent(Graphics);
      markNode.active = false;
      this.suppressionMarkPool.push({ node: markNode, graphics });
      unitContentNode.addChild(markNode);
    }

    // 独立状态特效层：位于单位贴图之上、状态文字和战争迷雾之下。
    // Graphics 自行按帧更新，避免烟雾循环迫使整张地图 redraw。
    const effectNode = new Node('UnitEffects');
    effectNode.layer = this.node.layer;
    effectNode.addComponent(UITransform).setContentSize(1280, 720);
    this.unitEffectGraphics = effectNode.addComponent(Graphics);
    this.unitEffectNode = effectNode;
    gNode.addChild(effectNode);

    // Smoke-screen markers must remain identifiable even though the smoke hex
    // itself is no longer visible. Keep them separate from damage fire/smoke,
    // which must still be hidden by fog together with its unit.
    const smokeScreenEffectNode = new Node('SmokeScreenEffects');
    smokeScreenEffectNode.layer = this.node.layer;
    smokeScreenEffectNode.addComponent(UITransform).setContentSize(1280, 720);
    this.smokeScreenEffectGraphics = smokeScreenEffectNode.addComponent(Graphics);
    this.smokeScreenEffectNode = smokeScreenEffectNode;
    gNode.addChild(smokeScreenEffectNode);

    // The blast must cover units, while the aircraft remains the top-most map actor.
    const stukaBlast = new Node('StukaBlast');
    stukaBlast.layer = this.node.layer;
    stukaBlast.addComponent(UITransform).setContentSize(1280, 720);
    this.stukaBlastGraphics = stukaBlast.addComponent(Graphics);
    this.stukaBlastNode = stukaBlast;
    stukaBlast.active = false;
    this.node.addChild(stukaBlast);

    const stuka = new Node('StukaFlyover');
    stuka.layer = this.node.layer;
    stuka.addComponent(UITransform).setContentSize(1, 1);
    const stukaSprite = stuka.addComponent(Sprite);
    stukaSprite.sizeMode = Sprite.SizeMode.CUSTOM;
    if (this.stukaSpriteFrame) stukaSprite.spriteFrame = this.stukaSpriteFrame;
    this.stukaSpriteNode = stuka;
    stuka.active = false;
    this.node.addChild(stuka);

    this.loadTankVisualSprites();
    [
      'infantry_blood_stain',
      'infantry_blood_stain_02',
      'infantry_blood_stain_03',
      'infantry_blood_stain_04',
    ].forEach((name, idx) => {
      resources.load(`textures/effects/${name}/spriteFrame`, SpriteFrame, (err, sf) => {
        if (err || !sf) {
          console.warn(`[BattleScene] 步兵血迹图加载失败 (${name})，将跳过该血迹造型:`, err);
          return;
        }
        this.infantryBloodSpriteFrames[idx] = sf;
        this.flushPendingInfantryBloodDecals();
      });
    });

    for (const kind of INFANTRY_VISUAL_KINDS) {
      const visualConfig = infantryVisualConfigOf(kind);
      visualConfig.soldiers.forEach((soldier, index) => {
        resources.load(soldier.spritePath, SpriteFrame, (err, sf) => {
          if (err || !sf) {
            console.warn(`[BattleScene] ${kind} 步兵图加载失败（位置 ${index + 1}），将回退矢量小人:`, err);
            return;
          }
          const rw = sf.rect.width;
          const rh = sf.rect.height;
          this.infantrySpriteFramesByKind[kind][index] = sf;
          this.infantrySpriteDimsByKind[kind][index] = {
            dw: rw > 0 ? rw : sf.width,
            dh: rh > 0 ? rh : sf.height,
          };
          this.redraw();
        });
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
      resources.load(`textures/terrain/${name}_snow/spriteFrame`, SpriteFrame, (err, sf) => {
        if (err || !sf) {
          console.warn(`[BattleScene] winter tree sprite load failed (${name}_snow), fallback to summer tree:`, err);
          return;
        }
        this.winterTreeSpriteFrames[idx] = sf;
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
    const winterTerrainPaths: Partial<Record<TerrainType, string>> = {
      road: 'textures/terrain/terrain_road_snow/spriteFrame',
      field: 'textures/terrain/terrain_field_snow/spriteFrame',
      mud: 'textures/terrain/terrain_mud_snow/spriteFrame',
      forest: 'textures/terrain/terrain_forest_snow/spriteFrame',
      water: 'textures/terrain/terrain_water_snow/spriteFrame',
    };
    (Object.keys(winterTerrainPaths) as TerrainType[]).forEach((terrain) => {
      resources.load(winterTerrainPaths[terrain]!, SpriteFrame, (err, sf) => {
        if (err || !sf) {
          console.warn(`[BattleScene] winter terrain sprite load failed (${terrain}), fallback to summer terrain:`, err);
          return;
        }
        this.winterTerrainSpriteFrames[terrain] = sf;
        this.redraw();
      });
    });

    const mapInputNode = new Node('MapInput');
    mapInputNode.layer = this.node.layer;
    mapInputNode.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    mapInputNode.setPosition(0, 0, 0);
    this.node.addChild(mapInputNode);
    this.mapInputNode = mapInputNode;

    // Register map touches on a root-level layer so campaign camera offsets do not move the hit area.
    mapInputNode.on(Node.EventType.TOUCH_START, this.onMapPanStart, this);
    mapInputNode.on(Node.EventType.TOUCH_MOVE, this.onMapPanMove, this);
    mapInputNode.on(Node.EventType.TOUCH_END, this.onTouchMap, this);

    this.buildWeatherEffectLayer();
    this.createHudRoot();
    // HUD：回合数 + 阶段信息 + 下一阶段按钮
    this.buildHUD();
    // 底部阶段选择条 + 骰子托盘（空的，交给 refreshPhaseUI 根据状态切换可见性）
    this.buildChooseBar();
    this.buildDiceTray();
    this.buildCombatLog();
    this.buildTurnTransition();
    this.layoutBattleHud();
    this.setupPvpBattleChannel();

    // 主菜单选关时会写入 GameSession.selectedMissionPath；绕过菜单直接启动场景
    // 也安全（GameSession 默认值 = 'missions/mission_01'，与本脚本 @property 默认一致）。
    this.loadSelectedMissionFromSession();
  }

  onDestroy() {
    this.resolutionUnsubscribe?.();
    this.resolutionUnsubscribe = null;
  }

  private setupPvpBattleChannel() {
    if (!GameSession.isPvp) return;
    if (this.pvpBattleUnlisten) this.pvpBattleUnlisten();
    this.pvpBattleUnlisten = PvpService.addListener(event => {
      if (event.type === 'battleStart') {
        this.startPvpBattleAfterBarrier();
        return;
      }
      if (event.type === 'battleSnapshot') {
        this.receivePvpBattleSnapshot(event.state, false);
        return;
      }
      if (event.type === 'battleEvent') {
        const payload = event.event as any;
        if (payload?.kind === 'pvp_action_result' && payload.state) {
          this.receivePvpBattleSnapshot(payload.state as PvpBattleSnapshot, true, payload.action);
          return;
        }
        this.battleLog(`[PVP] received battle event: ${JSON.stringify(event.event)}`);
      }
    });
  }

  /** 屏幕中央的回合横幅；回合号只出现在横幅内，不新增 HUD 回合控件。 */
  private buildTurnTransition() {
    const root = new Node('TurnTransition');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    root.addComponent(BlockInputEvents);
    root.active = false;
    this.node.addChild(root);

    const panel = new Node('Banner');
    panel.layer = this.node.layer;
    // 横幅贯穿整屏；信息组仍留在中部，避免与两侧 HUD 贴边拥挤。
    panel.addComponent(UITransform).setContentSize(CANVAS_W, 132);
    const opacity = panel.addComponent(UIOpacity);
    root.addChild(panel);
    const panelG = panel.addComponent(Graphics);

    const iconNode = new Node('FactionIcon');
    iconNode.layer = this.node.layer;
    iconNode.addComponent(UITransform).setContentSize(72, 72);
    iconNode.setPosition(-240, 0, 0);
    const icon = iconNode.addComponent(Sprite);
    icon.sizeMode = Sprite.SizeMode.CUSTOM;
    panel.addChild(iconNode);

    const title = this.makeCenteredLabel(panel, '', 0, 21, 560, 38, 29, Color.WHITE);
    title.horizontalAlign = HorizontalTextAlignment.CENTER;
    title.enableOutline = true;
    title.outlineColor = new Color(12, 14, 11, 230);
    title.outlineWidth = 2;
    const subtitle = this.makeCenteredLabel(panel, '', 0, -20, 560, 28, 17, new Color(225, 225, 210, 255));
    subtitle.horizontalAlign = HorizontalTextAlignment.CENTER;
    (root as any).__turnTransitionRefs = { panel, panelG, opacity, title, subtitle, icon };
    this.layoutTurnTransition();
  }

  /** 横幅铺满真实可视宽度；中央信息组与横幅高度保持稳定。 */
  private layoutTurnTransition(accentOverride?: Color) {
    const root = this.node.getChildByName('TurnTransition');
    const refs = (root as any)?.__turnTransitionRefs;
    if (!root || !refs) return;
    const { width, height } = visibleSizeInRootSpace(UI_ROOT_SCALE);
    root.getComponent(UITransform)?.setContentSize(width, height);
    const panelTransform = refs.panel.getComponent(UITransform);
    const bannerHeight = panelTransform?.contentSize.height ?? 132;
    panelTransform?.setContentSize(width, bannerHeight);

    const accent: Color | null = accentOverride ?? refs.accent ?? null;
    if (!accent) return;
    const g: Graphics = refs.panelG;
    g.clear();
    g.fillColor = new Color(17, 21, 15, 238);
    g.rect(-width * 0.5, -bannerHeight * 0.5, width, bannerHeight);
    g.fill();
    g.fillColor = new Color(accent.r, accent.g, accent.b, 42);
    g.rect(-width * 0.5, bannerHeight * 0.5 - 10, width, 10);
    g.fill();
    // 开放式横幅：只保留上下横线，不在两侧形成封闭方框。
    g.strokeColor = accent;
    g.lineWidth = 2;
    g.moveTo(-width * 0.5, bannerHeight * 0.5 - 1);
    g.lineTo(width * 0.5, bannerHeight * 0.5 - 1);
    g.moveTo(-width * 0.5, -bannerHeight * 0.5 + 1);
    g.lineTo(width * 0.5, -bannerHeight * 0.5 + 1);
    g.stroke();
  }

  private showTurnTransition(factionId: string, side: 'player' | 'ally' | 'enemy', onDone: () => void) {
    const root = this.node.getChildByName('TurnTransition');
    const refs = (root as any)?.__turnTransitionRefs;
    if (!root || !refs) { onDone(); return; }
    const faction = factionUiFor(factionId as any);
    const accent = side === 'enemy' ? new Color(202, 75, 61, 255) : new Color(faction.accent.r, faction.accent.g, faction.accent.b, 255);
    refs.accent = accent;
    this.layoutTurnTransition(accent);
    const w = refs.panel.getComponent(UITransform)!.contentSize.width;
    refs.title.string = getLang() === 'zh'
      ? `第 ${String(this.turn).padStart(2, '0')} 回合 · ${side === 'player' ? '玩家回合' : side === 'ally' ? '友方 AI 回合' : '敌方回合'}`
      : `TURN ${this.turn} · ${side === 'player' ? 'PLAYER TURN' : side === 'ally' ? 'ALLIED AI TURN' : 'ENEMY TURN'}`;
    refs.subtitle.string = getLang() === 'zh'
      ? (side === 'player' ? '选择行动阶段，指挥你的部队' : side === 'ally' ? '友方单位正在部署行动' : '敌军正在部署行动')
      : (side === 'player' ? 'Choose a phase and command your forces' : side === 'ally' ? 'Allied forces are deploying' : 'Enemy forces are deploying');
    refs.icon.spriteFrame = this.factionSpriteFrames.get(faction.id) ?? null;
    resources.load(faction.iconPath, SpriteFrame, (err, sf) => {
      if (!err && sf && this.turnTransition?.faction === faction.id) {
        this.factionSpriteFrames.set(faction.id, sf);
        refs.icon.spriteFrame = sf;
      }
    });
    root.active = true;
    refs.panel.setPosition(-w, 0, 0);
    refs.opacity.opacity = 255;
    this.turnTransition = { root, panel: refs.panel, panelOpacity: refs.opacity, title: refs.title, subtitle: refs.subtitle, icon: refs.icon, t: 0, faction: faction.id, onDone };
  }

  private advanceTurnTransition(dt: number) {
    const transition = this.turnTransition;
    if (!transition) return;
    transition.t += dt;
    // 入场与淡出各提速 100%；完整展示时长保持不变。
    const enter = 0.12, hold = 1.2, leave = 0.13;
    const width = transition.panel.getComponent(UITransform)?.contentSize.width ?? CANVAS_W;
    if (transition.t < enter) {
      transition.panel.setPosition(-width + width * (transition.t / enter), 0, 0);
      return;
    }
    if (transition.t < enter + hold) { transition.panel.setPosition(0, 0, 0); return; }
    const p = Math.min(1, (transition.t - enter - hold) / leave);
    transition.panel.setPosition(width * 0.12 * p, 0, 0);
    transition.panelOpacity.opacity = Math.round(255 * (1 - p));
    if (p < 1) return;
    transition.root.active = false;
    this.turnTransition = null;
    transition.onDone();
  }

  private beginPvpPhaseWithTransition(snapshot: PvpBattleSnapshot, onDone: () => void) {
    const pvp = GameSession.pvpSession;
    if (!pvp) { onDone(); return; }
    const faction = snapshot.currentParity === pvp.localPlayer.parity ? pvp.localPlayer.factionId : pvp.opponentPlayer.factionId;
    const key = `${snapshot.turn}:${snapshot.currentParity}`;
    if (this.pvpLastTransitionKey === key) { onDone(); return; }
    this.pvpLastTransitionKey = key;
    this.showTurnTransition(faction, snapshot.currentParity === pvp.localPlayer.parity ? 'player' : 'enemy', onDone);
  }

  private startPvpBattleAfterBarrier() {
    if (this.pvpBattleStarted) return;
    const pvp = GameSession.pvpSession;
    if (!pvp?.active || !this.mission) return;
    this.pvpBattleStarted = true;
    this.pvpCurrentParity = pvp.firstParity;
    this.enterPvpWaitingForSnapshot();
  }

  private pvpProtagonistKind(factionId: PvpFactionId): UnitKind {
    if (factionId === 'germany') return 'panzer4';
    if (factionId === 'japan') return 'type97';
    return 'sherman';
  }

  private pvpSupportKind(factionId: PvpFactionId): UnitKind {
    if (factionId === 'japan') return 'japanese_infantry';
    if (factionId === 'usa') return 'american_infantry';
    return 'infantry';
  }

  private pvpInitialProtagonistMarker(parity: PvpParity): { q: number; r: number; facing: Direction } {
    return parity === 'even'
      ? { q: 6, r: 2, facing: 3 }
      : { q: -1, r: 5, facing: 5 };
  }

  private updatePvpSpawnMarkerForLocalParity(parity: PvpParity) {
    const marker = this.pvpInitialProtagonistMarker(parity);
    this.shermanSpawnQr = { q: marker.q, r: marker.r };
    this.shermanSpawnFacing = marker.facing;
  }

  private pvpInitialUnit(
    id: string,
    ownerParity: 'odd' | 'even',
    ownerFactionId: PvpFactionId,
    role: 'protagonist' | 'support',
    kind: UnitKind,
    q: number,
    r: number,
    facing: Direction,
  ): PvpBattleUnitSnapshot {
    return {
      id,
      ownerParity,
      ownerFactionId,
      role,
      kind,
      pos: { q, r },
      facing,
      turretFacing: facing,
      destroyed: false,
      damaged: false,
      loaded: role === 'protagonist' ? false : undefined,
      loadedShell: role === 'protagonist' ? null : undefined,
      hatchOpen: role === 'protagonist' ? false : undefined,
      fireLevel: 0,
      turretDamaged: false,
      paralyzed: false,
      hidden: false,
      smoked: false,
      radioDamaged: false,
      crew: role === 'protagonist'
        ? { commander: true, loader: true, gunner: true, driver: true, coDriver: true }
        : undefined,
      crewLevels: role === 'protagonist' ? normalizePlayerCrewLevels() : undefined,
      unitLevel: role === 'support' ? 'recruit' : undefined,
    };
  }

  private buildLocalPvpInitialSnapshot(): PvpBattleSnapshot | null {
    const pvp = GameSession.pvpSession;
    if (!pvp?.active) return null;
    const odd = pvp.localPlayer.parity === 'odd' ? pvp.localPlayer : pvp.opponentPlayer;
    const even = pvp.localPlayer.parity === 'even' ? pvp.localPlayer : pvp.opponentPlayer;
    const oddSupport = this.pvpSupportKind(odd.factionId);
    const evenSupport = this.pvpSupportKind(even.factionId);
    return {
      version: 1,
      turn: 1,
      currentParity: pvp.firstParity,
      actionPhase: 'player',
      firstParity: pvp.firstParity,
      openingDie: pvp.openingDie,
      smokeHexes: [],
      smokeHexOwners: {},
      units: [
        this.pvpInitialUnit('pvp_odd_protagonist', 'odd', odd.factionId, 'protagonist', this.pvpProtagonistKind(odd.factionId), -1, 5, 5),
        this.pvpInitialUnit('pvp_odd_support_1', 'odd', odd.factionId, 'support', oddSupport, 0, 4, 5),
        this.pvpInitialUnit('pvp_odd_support_2', 'odd', odd.factionId, 'support', oddSupport, 1, 5, 5),
        this.pvpInitialUnit('pvp_even_protagonist', 'even', even.factionId, 'protagonist', this.pvpProtagonistKind(even.factionId), 6, 2, 3),
        this.pvpInitialUnit('pvp_even_support_1', 'even', even.factionId, 'support', evenSupport, 5, 1, 3),
        this.pvpInitialUnit('pvp_even_support_2', 'even', even.factionId, 'support', evenSupport, 4, 0, 3),
      ],
      winnerParity: null,
      updatedAt: Date.now(),
    };
  }

  private prepareLocalPvpInitialView() {
    const pvp = GameSession.pvpSession;
    const snapshot = this.buildLocalPvpInitialSnapshot();
    if (!pvp?.active || !snapshot || !this.mission) return;
    const localParity = pvp.localPlayer.parity;
    const localMain = snapshot.units.find(u => u.ownerParity === localParity && u.role === 'protagonist');
    if (localMain) {
      this.mission.sherman = this.unitFromPvpSnapshot(localMain, 'usa', true);
      this.mission.playerTank = this.mission.sherman;
    }
    this.mission.allies = snapshot.units
      .filter(u => u.ownerParity === localParity && u.role !== 'protagonist')
      .map(u => this.unitFromPvpSnapshot(u, 'usa', true));
    this.mission.enemies = snapshot.units
      .filter(u => u.ownerParity !== localParity)
      .map(u => this.unitFromPvpSnapshot(u, this.factionForPvpUnit(u), false));
    this.resetTurretFacingState();
    this.updatePvpSpawnMarkerForLocalParity(localParity);
    this.pvpCurrentParity = snapshot.currentParity;
    this.pvpLastSnapshotTurn = snapshot.turn;
    this.pvpLastSentUnitHash = this.pvpUnitHash();
  }

  private applyPvpSmokeSnapshot(snapshot: PvpBattleSnapshot) {
    if (!this.mission) return;
    const visibilityBefore = this.displayedFogVisionSnapshot();
    const previousSmokeHexes = new Set(this.mission.smokeHexes);
    const smokeHexes = Array.isArray(snapshot.smokeHexes) ? snapshot.smokeHexes : [];
    const ownerMap = snapshot.smokeHexOwners && typeof snapshot.smokeHexOwners === 'object'
      ? snapshot.smokeHexOwners
      : {};
    this.mission.smokeHexes = new Set(smokeHexes.map(key => String(key)));
    this.mission.smokeHexOwners = new Map();
    const pvp = GameSession.pvpSession;
    const localParity = pvp?.localPlayer.parity;
    for (const key of this.mission.smokeHexes) {
      const owner = ownerMap[key] as string | undefined;
      const localOwner = owner === 'odd' || owner === 'even'
        ? (owner === localParity ? 'friendly' : 'enemy')
        : owner === 'enemy' ? 'enemy' : 'friendly';
      this.mission.smokeHexOwners.set(key, localOwner);
      if (!this.smokeScreenAges.has(key)) this.smokeScreenAges.set(key, 0);
    }
    for (const key of Array.from(this.smokeScreenAges.keys())) {
      if (!this.mission.smokeHexes.has(key)) this.smokeScreenAges.delete(key);
    }
    const addedEnemySmoke = Array.from(this.mission.smokeHexes).some(key =>
      !previousSmokeHexes.has(key) && this.mission!.smokeHexOwners.get(key) === 'enemy'
    );
    if (addedEnemySmoke) {
      this.startFogVisionTransition(visibilityBefore, false, SMOKE_VISION_LAYER_INTERVAL);
    }
  }

  private pvpSmokeHexOwnersForSubmit(): Record<string, 'odd' | 'even'> {
    const owners: Record<string, 'odd' | 'even'> = {};
    const pvp = GameSession.pvpSession;
    if (!this.mission || !pvp?.active) return owners;
    const localParity = pvp.localPlayer.parity;
    const remoteParity = pvp.opponentPlayer.parity;
    for (const key of this.mission.smokeHexes) {
      owners[key] = this.mission.smokeHexOwners.get(key) === 'enemy' ? remoteParity : localParity;
    }
    return owners;
  }

  // ---------- 状态 ----------

  private syncPvpTurnTimerFromSnapshot(snapshot: PvpBattleSnapshot) {
    const serverNow = Number(snapshot.serverNow || snapshot.updatedAt || Date.now());
    const duration = Math.max(1000, Number(snapshot.turnDurationMs || PVP_TURN_DEFAULT_MS));
    const explicitDeadline = Number(snapshot.turnDeadlineAt || 0);
    const explicitRemaining = Number(snapshot.turnRemainingMs);
    const rawRemaining = Number.isFinite(explicitRemaining)
      ? Math.max(0, explicitRemaining)
      : explicitDeadline > 0
        ? Math.max(0, explicitDeadline - serverNow)
        : duration;
    const receivedAt = Number(snapshot.clientReceivedAt || Date.now());
    const applyDelay = Math.max(0, Date.now() - receivedAt);
    const remaining = Math.max(0, rawRemaining - applyDelay);
    this.pvpTurnDurationMs = duration;
    this.pvpTurnServerNowAt = serverNow + applyDelay;
    this.pvpTurnDeadlineAt = Date.now() + remaining;
    this.pvpTurnTimerReceivedAt = receivedAt;
    this.pvpTurnTimeoutSubmitted = false;
    this.refreshPvpTurnTimer();
  }

  private ensurePvpLocalTurnTimer() {
    if (!GameSession.isPvp || this.pvpTurnDeadlineAt > 0) return;
    this.pvpTurnDurationMs = PVP_TURN_DEFAULT_MS;
    this.pvpTurnServerNowAt = Date.now();
    this.pvpTurnDeadlineAt = this.pvpTurnServerNowAt + this.pvpTurnDurationMs;
    this.pvpTurnTimerReceivedAt = Date.now();
    this.pvpTurnTimeoutSubmitted = false;
    this.refreshPvpTurnTimer();
  }

  private pvpTurnRemainingMs(): number {
    if (!this.pvpTurnDeadlineAt) return 0;
    return Math.max(0, this.pvpTurnDeadlineAt - Date.now());
  }

  private refreshPvpTurnTimer() {
    if (!this.pvpTurnTimerRoot || !this.pvpTurnTimerBg || !this.pvpTurnTimerFill || !this.pvpTurnTimerLabel) return;
    const session = GameSession.pvpSession;
    const show = !!session?.active && this.pvpBattleStarted && this.outcome === 'ongoing' && !!this.pvpTurnDeadlineAt;
    this.pvpTurnTimerRoot.active = show;
    if (!show || !session) return;

    const remaining = this.pvpTurnRemainingMs();
    const duration = Math.max(1, this.pvpTurnDurationMs || PVP_TURN_DEFAULT_MS);
    const ratio = Math.max(0, Math.min(1, remaining / duration));
    const fillW = Math.max(0, PVP_TURN_TIMER_W * ratio);
    const seconds = Math.ceil(remaining / 1000);
    const activeName = this.pvpCurrentParity === session.localPlayer.parity
      ? session.localPlayer.name
      : session.opponentPlayer.name;

    this.pvpTurnTimerBg.clear();
    this.pvpTurnTimerBg.fillColor = new Color(24, 27, 24, 210);
    this.pvpTurnTimerBg.strokeColor = BTN_BORDER;
    this.pvpTurnTimerBg.lineWidth = 2;
    this.pvpTurnTimerBg.rect(-PVP_TURN_TIMER_W / 2, -PVP_TURN_TIMER_H / 2, PVP_TURN_TIMER_W, PVP_TURN_TIMER_H);
    this.pvpTurnTimerBg.fill();
    this.pvpTurnTimerBg.stroke();

    this.pvpTurnTimerFill.clear();
    this.pvpTurnTimerFill.fillColor = ratio <= 0.25
      ? new Color(184, 62, 52, 235)
      : ratio <= 0.5
        ? new Color(210, 154, 58, 230)
        : new Color(80, 142, 92, 230);
    this.pvpTurnTimerFill.rect(-PVP_TURN_TIMER_W / 2, -PVP_TURN_TIMER_H / 2 + 3, fillW, PVP_TURN_TIMER_H - 6);
    this.pvpTurnTimerFill.fill();

    this.pvpTurnTimerLabel.string = t('pvp.turnTimer', { player: activeName, seconds });
  }

  private advancePvpTurnTimer() {
    this.refreshPvpTurnTimer();
    if (!GameSession.isPvp || this.pvpTurnTimeoutSubmitted || this.outcome !== 'ongoing') return;
    const pvp = GameSession.pvpSession;
    if (!pvp?.active || this.pvpCurrentParity !== pvp.localPlayer.parity || this.phase !== 'player') return;
    if (!this.pvpTurnDeadlineAt || this.pvpTurnRemainingMs() > 0) return;
    if (this.isBusy()) return;
    this.pvpTurnTimeoutSubmitted = true;
    this.forceEndPvpTurnByTimer();
  }

  private forceEndPvpTurnByTimer() {
    if (!GameSession.isPvp || !this.mission || this.phase !== 'player' || this.outcome !== 'ongoing') return;
    this.playerDiceRollAnim = null;
    this.playerDiceSortAnim = null;
    this.pendingAutoEndStep = null;
    this.phaseDice = [];
    this.movementDone = true;
    this.attackDone = true;
    this.miscDone = true;
    this.playerStep = 'choose';
    this.clearGunSelection();
    this.closeDiePopover();
    this.battleLogI18n('battleLog.pvpTurnTimeout');
    this.submitPvpTurnEnd();
  }

  private receivePvpBattleSnapshot(snapshot: PvpBattleSnapshot, animateChanges = false, action?: unknown) {
    if (this.anim || this.animQueue.length > 0) {
      this.pvpPendingRemoteSnapshots.push({ snapshot, animate: animateChanges, action });
      return;
    }
    this.applyPvpBattleSnapshot(snapshot, animateChanges);
    this.playPvpRemoteActionCue(action);
  }

  private drainPvpPendingRemoteSnapshot() {
    if (!GameSession.isPvp || this.anim || this.animQueue.length > 0) return false;
    let consumed = false;
    while (!this.anim && this.animQueue.length === 0) {
      const next = this.pvpPendingRemoteSnapshots.shift();
      if (!next) break;
      consumed = true;
      this.applyPvpBattleSnapshot(next.snapshot, next.animate);
      this.playPvpRemoteActionCue(next.action);
    }
    return consumed;
  }

  private applyPvpBattleSnapshot(snapshot: PvpBattleSnapshot, animateChanges = false) {
    const pvp = GameSession.pvpSession;
    if (!pvp?.active || !this.mission || !snapshot || !Array.isArray(snapshot.units)) return;
    const oldUnits = new Map(this.allUnits().map(unit => [unit.id, unit]));
    this.pvpApplyingRemoteState = true;
    this.pvpBattleStarted = true;
    this.pvpCurrentParity = snapshot.currentParity;
    this.pvpLastSnapshotTurn = snapshot.turn;
    this.syncPvpTurnTimerFromSnapshot(snapshot);
    this.turn = Math.max(1, Math.ceil(snapshot.turn / 2));

    const localParity = pvp.localPlayer.parity;
    const localMain = snapshot.units.find(u => u.ownerParity === localParity && u.role === 'protagonist');
    if (localMain) {
      this.mission.sherman = this.unitFromPvpSnapshot(localMain, 'usa', true);
      this.mission.playerTank = this.mission.sherman;
    }
    this.mission.allies = snapshot.units
      .filter(u => u.ownerParity === localParity && u.role !== 'protagonist')
      .map(u => this.unitFromPvpSnapshot(u, 'usa', true));
    this.mission.enemies = snapshot.units
      .filter(u => u.ownerParity !== localParity)
      .map(u => this.unitFromPvpSnapshot(u, this.factionForPvpUnit(u), false));
    this.resetTurretFacingState();
    this.applyPvpSmokeSnapshot(snapshot);
    // PVP snapshots replace the unit objects wholesale, bypassing the local
    // combat paths that normally register a newly killed infantry unit's blood.
    // Compare against the pre-snapshot state so both remote kills and a
    // reconnected client's first snapshot produce the persistent decal.
    this.registerNewlyDestroyedSince(new Set(
      Array.from(oldUnits.values())
        .filter(unit => unit.destroyed)
        .map(unit => unit.id),
    ));
    const receivedUnitHash = this.pvpUnitHash();
    if (animateChanges) this.preparePvpRemoteAnimations(oldUnits);

    this.updatePvpSpawnMarkerForLocalParity(localParity);
    this.pvpLastSentUnitHash = receivedUnitHash;
    this.outcome = snapshot.winnerParity
      ? (snapshot.winnerParity === localParity ? 'victory' : 'defeat')
      : this.computeOutcome();
    if (this.outcome !== 'ongoing') {
      this.closeDiePopover();
      this.clearGunSelection();
      this.phaseDice = [];
      this.updateOutcomeOverlay();
      this.refreshPhaseUI();
      this.updateHUD();
      this.redraw();
      this.pvpApplyingRemoteState = false;
      return;
    }
    this.beginPvpPhaseWithTransition(snapshot, () => {
      if (snapshot.actionPhase !== 'ai' && snapshot.currentParity === localParity) {
        this.beginPlayerPhaseForNewTurn();
        this.battleLog(`[PVP] 轮到你行动（同步回合 ${snapshot.turn}）`);
      } else {
        this.enterPvpWaitingForOpponent();
        this.battleLog(snapshot.actionPhase === 'ai'
          ? `[PVP] AI 支援单位行动（同步回合 ${snapshot.turn}）`
          : `[PVP] 等待对手行动（同步回合 ${snapshot.turn}）`);
      }
    });
    this.pvpApplyingRemoteState = false;
  }

  private playPvpRemoteActionCue(action: unknown) {
    if (!action || !this.mission) return;
    const envelope = action as { details?: unknown };
    const details = (envelope.details ?? action) as {
      type?: string;
      attackerId?: string;
      actorId?: string;
      targetId?: string;
      report?: AttackReport;
      heReport?: HighExplosiveReport;
      attackSound?: string;
      unitId?: string;
      q?: number;
      r?: number;
      repairTarget?: RepairableComponentId;
      open?: boolean;
      hit?: boolean;
      effect?: { hit?: boolean; effect?: string };
    };
    const allUnits = this.allUnits();
    const byId = (id?: string) => id ? (allUnits.find(unit => unit.id === id) ?? null) : null;
    const unit = byId(details.unitId ?? details.attackerId ?? details.actorId);
    const atUnit = (fallback?: Unit | null) => fallback ?? unit ?? this.mission.sherman;
    const atQr = (fallback?: Unit | null) => ({
      q: Number.isFinite(Number(details.q)) ? Number(details.q) : atUnit(fallback).pos.q,
      r: Number.isFinite(Number(details.r)) ? Number(details.r) : atUnit(fallback).pos.r,
    });
    switch (details.type) {
      case 'main_gun': {
        if (!details.attackerId || !details.targetId || !details.report) return;
        const attacker = byId(details.attackerId);
        const target = byId(details.targetId);
        if (!attacker || !target) return;
        const playCue = () => this.playAttackFireCue(attacker, target, false, details.attackSound ?? attacker.stats.attackSound ?? '', details.report!);
        if (this.turretAimAnim?.unit === attacker) {
          const prev = this.turretAimAnim.onDone;
          this.turretAimAnim.onDone = () => {
            prev();
            playCue();
          };
          return;
        }
        playCue();
        return;
      }
      case 'main_gun_he': {
        if (!details.attackerId || !details.targetId) return;
        const attacker = byId(details.attackerId);
        const target = byId(details.targetId);
        if (!attacker || !target) return;
        const playCue = () => this.playHighExplosiveSuppressionCue(attacker, target, details.heReport);
        if (this.turretAimAnim?.unit === attacker) {
          const prev = this.turretAimAnim.onDone;
          this.turretAimAnim.onDone = () => {
            prev();
            playCue();
          };
          return;
        }
        playCue();
        return;
      }
      case 'machine_gun': {
        if (!details.attackerId || !details.targetId) return;
        const attacker = byId(details.attackerId);
        const target = byId(details.targetId);
        if (!attacker || !target) return;
        const hit = details.hit === true || details.report?.hit === true;
        if (!(isFootUnit(attacker) && attacker.kind !== 'officer' && isTankUnit(target))) {
          this.setInfantryVisualFacing(attacker, target.pos);
          this.redraw();
        }
        this.playMachineGunFireCue(attacker, target, hit);
        this.spawnFloater(target.pos.q, target.pos.r, hit ? t('floater.mgHit') : t('dice.panel.outcomeMiss'),
          hit ? new Color(255, 120, 120, 255) : new Color(220, 220, 220, 255),
          { size: 32, dur: hit ? 1.0 : 0.9, rise: hit ? 48 : 44 });
        return;
      }
      case 'ai_attack': {
        if (!details.actorId || !details.targetId) return;
        const attacker = byId(details.actorId);
        const target = byId(details.targetId);
        if (!attacker || !target) return;
        const hit = details.effect?.hit === true;
        if (!(isFootUnit(attacker) && attacker.kind !== 'officer' && isTankUnit(target))) {
          this.setInfantryVisualFacing(attacker, target.pos);
          this.redraw();
        }
        this.playMachineGunFireCue(attacker, target, hit);
        const effect = details.effect?.effect;
        const text = effect === 'destroyed'
          ? t('dmg.outcome.destroyed')
          : effect === 'damaged'
            ? t('dmg.outcome.damaged')
            : t('dice.panel.outcomeMiss');
        const color = effect === 'destroyed'
          ? new Color(255, 100, 100, 255)
          : effect === 'damaged'
            ? new Color(240, 200, 100, 255)
            : new Color(220, 220, 220, 255);
        this.spawnFloater(target.pos.q, target.pos.r, text, color,
          { size: effect === 'destroyed' ? 36 : 32, dur: hit ? 1.0 : 0.9, rise: hit ? 48 : 44 });
        return;
      }
      case 'smoke': {
        const p = atQr(unit);
        this.spawnFloater(p.q, p.r, t('floater.smokeDeployed'),
          new Color(200, 200, 220, 255), { size: 22, dur: 0.9, rise: 24 });
        return;
      }
      case 'conceal': {
        const p = atQr(unit);
        this.spawnFloater(p.q, p.r, t('floater.concealed'),
          new Color(160, 220, 180, 255), { size: 22, dur: 0.9, rise: 24 });
        return;
      }
      case 'repair': {
        const p = atQr(unit);
        const component = details.repairTarget ? repairableComponentById(details.repairTarget) : null;
        this.spawnFloater(p.q, p.r, t(component?.floaterKey ?? 'floater.repair'),
          new Color(180, 240, 160, 255), { size: 22, dur: 0.9, rise: 24 });
        return;
      }
      case 'fire_suppress': {
        const p = atQr(unit);
        this.spawnFloater(p.q, p.r, t('floater.fireReduced'),
          new Color(180, 240, 160, 255), { size: 22, dur: 0.9, rise: 24 });
        return;
      }
      case 'hatch_close': {
        const p = atQr(unit);
        playCommanderHatch(false);
        this.spawnFloater(p.q, p.r, t('floater.hatchClosedByDice'),
          new Color(200, 220, 240, 255), { size: 22, dur: 0.9, rise: 24 });
        return;
      }
      case 'hatch_toggle': {
        playCommanderHatch(details.open === true);
        return;
      }
      default:
        return;
    }
  }

  private preparePvpRemoteAnimations(oldUnits: Map<string, Unit>) {
    if (!this.mission) return;
    const nextUnits = this.allUnits();
    const animations: MoveAnim[] = [];
    for (const unit of nextUnits) {
      const old = oldUnits.get(unit.id);
      if (!old) continue;
      const moved = old.pos.q !== unit.pos.q || old.pos.r !== unit.pos.r;
      const turned = old.facing !== unit.facing && old.facing !== null && unit.facing !== null;
      if (moved) {
        const final = { q: unit.pos.q, r: unit.pos.r };
        unit.pos = { q: old.pos.q, r: old.pos.r };
        animations.push({
          unit,
          kind: 'move',
          fromQ: old.pos.q,
          fromR: old.pos.r,
          toQ: final.q,
          toR: final.r,
          t: 0,
          dur: Math.max(0.05, this.moveDuration),
        });
      } else if (turned) {
        const finalFacing = unit.facing as Direction;
        unit.facing = old.facing as Direction;
        unit.turretFacing = old.turretFacing;
        animations.push({
          unit,
          kind: 'turn',
          fromQ: unit.pos.q,
          fromR: unit.pos.r,
          toQ: unit.pos.q,
          toR: unit.pos.r,
          t: 0,
          dur: Math.max(0.05, this.moveDuration),
          turnFrom: old.facing as Direction,
          turnTo: finalFacing,
        });
      } else {
        const oldTurret = old.turretFacing ?? old.facing;
        const nextTurret = unit.turretFacing ?? unit.facing;
        if (oldTurret !== undefined && nextTurret !== undefined && oldTurret !== nextTurret && this.enemySupportsSplitTurret(unit)) {
          const from = (((oldTurret % 12) + 12) % 12) as FireDirection;
          const to = (((nextTurret % 12) + 12) % 12) as FireDirection;
          unit.previousTurretFacing = from;
          unit.turretFacing = from;
          if (unit === this.mission.sherman) {
            this.shermanTurretFacing = from;
          } else {
            this.enemyTurretFacing.set(unit.id, from);
          }
          if (!this.turretAimAnim) {
            this.beginTurretAimAnim({
              unit,
              from,
              to,
              t: 0,
              dur: Math.max(0.01, turretTraverseAnimationDuration(from, to, unit.stats.turretTraverseSpeed)),
              onDone: () => {},
            });
          }
        }
      }
    }
    if (animations.length === 0) return;
    this.anim = animations.shift()!;
    this.animQueue = animations;
  }

  private factionForPvpUnit(unit: PvpBattleUnitSnapshot): Faction {
    if (unit.ownerFactionId === 'japan') return 'japanese';
    if (unit.ownerFactionId === 'germany') return 'german';
    return 'german';
  }

  private unitFromPvpSnapshot(src: PvpBattleUnitSnapshot, faction: Faction, localSide: boolean): Unit {
    const stats = { ...getUnitStats(src.kind, src.ownerFactionId === 'japan' ? 'pacific' : 'europe') };
    stats.faction = faction;
    const facing = src.facing == null ? null : (((src.facing % 6) + 6) % 6) as Direction;
    const turretFacing = src.turretFacing == null
      ? (facing ?? undefined)
      : (((src.turretFacing % 12) + 12) % 12) as FireDirection;
    const previousTurretFacing = src.previousTurretFacing == null
      ? (facing ?? undefined)
      : (((src.previousTurretFacing % 12) + 12) % 12) as FireDirection;
    const diagonalGunnerSidePreference = src.diagonalGunnerSidePreference == null
      ? undefined
      : (((src.diagonalGunnerSidePreference % 12) + 12) % 12) as FireDirection;
    const turretVisualTarget = src.turretVisualTarget == null
      ? undefined
      : { q: Number(src.turretVisualTarget.q), r: Number(src.turretVisualTarget.r) };
    return {
      id: src.id,
      kind: src.kind,
      faction,
      sideId: localSide ? 'player' : 'enemy',
      controller: src.role === 'protagonist'
        ? (localSide ? 'local_player' : 'remote_player')
        : 'ai',
      pos: { q: Number(src.pos?.q ?? 0), r: Number(src.pos?.r ?? 0) },
      facing,
      turretFacing,
      previousTurretFacing,
      diagonalGunnerSidePreference,
      turretVisualTarget,
      stats,
      damaged: !!src.damaged,
      destroyed: !!src.destroyed,
      fireLevel: Math.max(0, Number(src.fireLevel ?? 0)),
      turretDamaged: !!src.turretDamaged,
      paralyzed: !!src.paralyzed,
      hidden: !!src.hidden,
      smoked: !!src.smoked,
      loaded: !!src.loaded,
      loadedShell: src.loadedShell ?? (src.loaded ? 'ap' : null),
      hatchOpen: !!src.hatchOpen,
      visionRange: Number.isFinite(Number(src.visionRange)) ? Number(src.visionRange) : stats.visionRange,
      gunnerVisionRange: Number.isFinite(Number(src.gunnerVisionRange)) ? Number(src.gunnerVisionRange) : stats.gunnerVisionRange,
      interiorVisionRange: Number.isFinite(Number(src.interiorVisionRange)) ? Number(src.interiorVisionRange) : stats.interiorVisionRange,
      radioDamaged: !!src.radioDamaged,
      crew: src.role === 'protagonist'
        ? (src.crew ?? { commander: true, loader: true, gunner: true, driver: true, coDriver: true })
        : undefined,
      crewLevels: src.role === 'protagonist' ? normalizePlayerCrewLevels(src.crewLevels) : undefined,
      crewSkills: src.crewSkills ? Object.fromEntries(
        Object.entries(src.crewSkills).map(([slot, skills]) => [slot, skills?.slice()]),
      ) : undefined,
      ambushAttackedSinceTurnEnd: !!src.ambushAttackedSinceTurnEnd,
      ambushReadyThisTurn: !!src.ambushReadyThisTurn,
      ambushActedThisTurn: !!src.ambushActedThisTurn,
      unitLevel: src.role === 'support' && !isAntiTankGunKind(src.kind) ? normalizeUnitLevel(src.unitLevel) : undefined,
      atGunCrewLevel: isAntiTankGunKind(src.kind) ? normalizeUnitLevel(src.atGunCrewLevel ?? src.unitLevel) : undefined,
    };
  }

  private snapshotUnitFromPvpUnit(unit: Unit, ownerParity: 'odd' | 'even', ownerFactionId: string, role: 'protagonist' | 'support'): PvpBattleUnitSnapshot {
    return {
      id: unit.id,
      ownerParity,
      ownerFactionId: ownerFactionId as any,
      role,
      kind: unit.kind,
      pos: { q: unit.pos.q, r: unit.pos.r },
      facing: unit.facing,
      turretFacing: unit.turretFacing,
      previousTurretFacing: unit.previousTurretFacing,
      diagonalGunnerSidePreference: unit.diagonalGunnerSidePreference,
      turretVisualTarget: unit.turretVisualTarget ? { ...unit.turretVisualTarget } : undefined,
      destroyed: !!unit.destroyed,
      damaged: !!unit.damaged,
      loaded: !!unit.loaded,
      loadedShell: unit.loadedShell ?? (unit.loaded ? 'ap' : null),
      hatchOpen: !!unit.hatchOpen,
      fireLevel: unit.fireLevel ?? 0,
      turretDamaged: !!unit.turretDamaged,
      paralyzed: !!unit.paralyzed,
      hidden: !!unit.hidden,
      smoked: !!unit.smoked,
      radioDamaged: !!unit.radioDamaged,
      visionRange: unit.visionRange ?? unit.stats.visionRange,
      gunnerVisionRange: unit.gunnerVisionRange ?? unit.stats.gunnerVisionRange,
      interiorVisionRange: unit.interiorVisionRange ?? unit.stats.interiorVisionRange,
      crew: unit.crew,
      crewLevels: role === 'protagonist' ? normalizePlayerCrewLevels(unit.crewLevels) : undefined,
      crewSkills: unit.crewSkills ? Object.fromEntries(
        Object.entries(unit.crewSkills).map(([slot, skills]) => [slot, skills?.slice()]),
      ) : undefined,
      ambushAttackedSinceTurnEnd: unit.ambushAttackedSinceTurnEnd,
      ambushReadyThisTurn: unit.ambushReadyThisTurn,
      ambushActedThisTurn: unit.ambushActedThisTurn,
      unitLevel: role === 'support' && !isAntiTankGunUnit(unit) ? unitLevelOf(unit) : undefined,
      atGunCrewLevel: isAntiTankGunUnit(unit) ? unitLevelOf(unit) : undefined,
    };
  }

  private collectPvpBattleUnitsForSubmit(): PvpBattleUnitSnapshot[] {
    const pvp = GameSession.pvpSession;
    if (!pvp?.active || !this.mission) return [];
    const localParity = pvp.localPlayer.parity;
    const remoteParity = pvp.opponentPlayer.parity;
    return [
      this.snapshotUnitFromPvpUnit(this.mission.sherman, localParity, pvp.localPlayer.factionId, 'protagonist'),
      ...this.mission.allies.map(u => this.snapshotUnitFromPvpUnit(u, localParity, pvp.localPlayer.factionId, 'support')),
      ...this.mission.enemies.map(u => this.snapshotUnitFromPvpUnit(
        u,
        remoteParity,
        pvp.opponentPlayer.factionId,
        u.id.endsWith('_protagonist') ? 'protagonist' : 'support',
      )),
    ];
  }

  private pvpUnitHash(): string {
    return JSON.stringify({
      units: this.collectPvpBattleUnitsForSubmit().map(unit => ({
        id: unit.id,
        q: unit.pos.q,
        r: unit.pos.r,
        facing: unit.facing,
        turretFacing: unit.turretFacing,
        previousTurretFacing: unit.previousTurretFacing,
        diagonalGunnerSidePreference: unit.diagonalGunnerSidePreference,
        turretVisualTarget: unit.turretVisualTarget ? { ...unit.turretVisualTarget } : undefined,
        destroyed: !!unit.destroyed,
        damaged: !!unit.damaged,
        loaded: !!unit.loaded,
        loadedShell: unit.loadedShell ?? (unit.loaded ? 'ap' : null),
        hatchOpen: !!unit.hatchOpen,
        fireLevel: unit.fireLevel ?? 0,
        turretDamaged: !!unit.turretDamaged,
        paralyzed: !!unit.paralyzed,
        hidden: !!unit.hidden,
        smoked: !!unit.smoked,
        radioDamaged: !!unit.radioDamaged,
        visionRange: unit.visionRange ?? 0,
        gunnerVisionRange: unit.gunnerVisionRange ?? 0,
        interiorVisionRange: unit.interiorVisionRange ?? 0,
        crew: unit.crew,
        crewLevels: unit.crewLevels ? normalizePlayerCrewLevels(unit.crewLevels) : undefined,
        crewSkills: unit.crewSkills,
        ambushAttackedSinceTurnEnd: unit.ambushAttackedSinceTurnEnd,
        ambushReadyThisTurn: unit.ambushReadyThisTurn,
        ambushActedThisTurn: unit.ambushActedThisTurn,
        unitLevel: !unit.crewLevels && !isAntiTankGunUnit(unit) ? unitLevelOf(unit) : undefined,
        atGunCrewLevel: isAntiTankGunUnit(unit) ? unitLevelOf(unit) : undefined,
      })),
      smokeHexes: this.mission ? Array.from(this.mission.smokeHexes).sort() : [],
      smokeHexOwners: this.pvpSmokeHexOwnersForSubmit(),
    });
  }

  private sendPvpActionResult(label = 'action', action?: unknown) {
    if (!GameSession.isPvp || this.pvpApplyingRemoteState || !this.pvpBattleStarted || !this.mission) return;
    const pvp = GameSession.pvpSession;
    if (!pvp?.active || this.pvpCurrentParity !== pvp.localPlayer.parity || this.phase !== 'player') return;
    const hash = this.pvpUnitHash();
    if (!hash) return;
    this.pvpLastSentUnitHash = hash;
    PvpService.sendBattleEvent({
      kind: 'pvp_action_result',
      label,
      turn: this.pvpLastSnapshotTurn,
      playerParity: pvp.localPlayer.parity,
      action,
      units: this.collectPvpBattleUnitsForSubmit(),
      smokeHexes: Array.from(this.mission.smokeHexes),
      smokeHexOwners: this.pvpSmokeHexOwnersForSubmit(),
    });
  }

  private maybeSendPvpActionResult(label = 'action') {
    const hash = this.pvpUnitHash();
    if (!hash || hash === this.pvpLastSentUnitHash) return;
    this.sendPvpActionResult(label);
  }

  private submitPvpTurnEnd() {
    if (!GameSession.isPvp || !this.mission) return;
    const pvp = GameSession.pvpSession;
    if (!pvp?.active) return;
    this.pvpLastSentUnitHash = this.pvpUnitHash();
    PvpService.sendBattleEvent({
      kind: 'pvp_turn_end',
      turn: this.pvpLastSnapshotTurn,
      playerParity: pvp.localPlayer.parity,
      units: this.collectPvpBattleUnitsForSubmit(),
      smokeHexes: Array.from(this.mission.smokeHexes),
      smokeHexOwners: this.pvpSmokeHexOwnersForSubmit(),
    });
    this.enterPvpWaitingForOpponent();
  }

  private enterPvpWaitingForSnapshot() {
    if (!this.mission) return;
    this.phase = 'enemy';
    this.playerStep = 'choose';
    this.phaseDice = [];
    this.clearGunSelection();
    this.closeDiePopover();
    this.destroyTurnEndEventUI();
    this.destroyFireCheckEventUI();
    this.destroyUsCasualtyEventUI();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.battleLog('[PVP] waiting for synchronized battle snapshot');
  }

  private enterPvpWaitingForOpponent() {
    if (!this.mission) return;
    this.phase = 'enemy';
    this.playerStep = 'choose';
    this.phaseDice = [];
    this.enemyOrder = [];
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceTypes = [];
    this.enemyDiceUsed = [];
    this.enemyDiceResolvedActions = [];
    this.clearAIMoveState();
    this.clearActiveActingUnit();
    this.destroyEnemyDiceTray();
    this.clearGunSelection();
    this.closeDiePopover();
    this.destroyTurnEndEventUI();
    this.destroyFireCheckEventUI();
    this.destroyUsCasualtyEventUI();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
  }

  private loadSelectedMissionFromSession() {
    if (GameSession.isCampaign) {
      this.loadSelectedCampaignFromSession();
      return;
    }
    this.campaignRuntime = null;
    this.activeCampaignSegmentIndex = 0;
    this.campaignViewSegmentIndexOverride = null;
    this.campaignTransitionActive = false;
    this.campaignPanAnim = null;
    this.resetCampaignUpgradeRuntime();
    const source = GameSession.selectedMissionSource;
    if (source.type === 'custom') {
      const pkg = CustomMissionStore.load(source.packageId);
      if (!pkg) {
        console.error('[BattleScene] custom mission package not found:', source.packageId);
        return;
      }
      this.missionSource = source;
      this.turnEndEventProvider = createCustomTurnEndEventProvider(pkg.turnEndEvents);
      this.loadAndDraw(pkg.mission);
      this.resumeAfterMissionLoadedIfNeeded();
      return;
    }

    const missionPath = source.missionPath || GameSession.selectedMissionPath || this.missionPath;
    this.missionPath = missionPath;
    this.missionSource = { type: 'resource', missionPath };
    this.turnEndEventProvider = OfficialTurnEndEventProvider;
    resources.load(this.missionPath, JsonAsset, (err, asset) => {
      if (err || !asset) {
        console.error('[BattleScene] load mission failed:', this.missionPath, err);
        return;
      }
      this.loadAndDraw(asset.json as MissionData);
      this.resumeAfterMissionLoadedIfNeeded();
    });
  }

  private loadSelectedCampaignFromSession() {
    const campaignId = GameSession.selectedCampaignId;
    const campaign = GameSession.selectedCampaign ?? (campaignId ? getCampaign(campaignId) : undefined);
    if (!campaign) {
      console.error('[BattleScene] campaign not found:', campaignId);
      return;
    }

    this.resetCampaignUpgradeRuntime();

    const loaded: MissionData[] = [];
    const finishLoading = (eventProvider: TurnEndEventProvider) => {
      this.campaignRuntime = stitchCampaignMissions(campaign, loaded);
      this.activeCampaignSegmentIndex = 0;
      this.campaignViewSegmentIndexOverride = null;
      this.campaignTransitionActive = false;
      this.campaignPanAnim = null;
      this.missionSource = { type: 'resource', missionPath: campaign.segments[0]?.missionPath ?? '' };
      this.turnEndEventProvider = eventProvider;
      this.loadAndDraw(this.campaignRuntime.data);
      this.applyCampaignSegmentView(0);
      this.openCampaignUpgradeChoiceForCurrentSegment();
    };

    const generatedPackages = GameSession.selectedCampaignPackages;
    if (generatedPackages) {
      if (generatedPackages.length !== campaign.segments.length) {
        console.error('[BattleScene] generated campaign package count mismatch:', generatedPackages.length);
        return;
      }
      loaded.push(...generatedPackages.map(pkg => pkg.mission));
      finishLoading(createCustomTurnEndEventProvider(
        generatedPackages.flatMap(pkg => pkg.turnEndEvents),
      ));
      return;
    }

    const loadNext = (index: number) => {
      const segment = campaign.segments[index];
      if (!segment) {
        finishLoading(OfficialTurnEndEventProvider);
        return;
      }
      resources.load(segment.missionPath, JsonAsset, (err, asset) => {
        if (err || !asset) {
          console.error('[BattleScene] load campaign segment failed:', segment.id, segment.missionPath, err);
          return;
        }
        loaded.push(asset.json as MissionData);
        loadNext(index + 1);
      });
    };
    loadNext(0);
  }

  private cloneMissionData(data: MissionData): MissionData {
    return JSON.parse(JSON.stringify(data)) as MissionData;
  }

  private currentShermanCampaignPlacement(): UnitPlacement | null {
    const s = this.mission?.playerTank;
    if (!s) return null;
    return {
      kind: s.kind,
      faction: s.faction,
      facing: s.facing ?? undefined,
      turretFacing: this.shermanTurretFacing ?? s.turretFacing ?? undefined,
      crew: s.crew ? { ...s.crew } : undefined,
      crewLevels: s.crewLevels ? { ...s.crewLevels } : undefined,
      crewSkills: s.crewSkills ? Object.fromEntries(
        Object.entries(s.crewSkills).map(([slot, skills]) => [slot, skills?.slice()]),
      ) : undefined,
      loaded: s.loaded === true,
      loadedShell: s.loadedShell ?? (s.loaded ? 'ap' : null),
      hatchOpen: s.hatchOpen === true,
      fireLevel: s.fireLevel ?? 0,
      turretDamaged: s.turretDamaged === true,
      paralyzed: s.paralyzed === true,
      hvapAmmoRemaining: s.hvapAmmoRemaining,
    };
  }

  private canAdvanceCampaignSegment(): boolean {
    return !!this.campaignRuntime
      && this.outcome === 'victory'
      && !this.campaignTransitionActive
      && this.activeCampaignSegmentIndex < this.campaignRuntime.segments.length - 1;
  }

  private advanceCampaignSegment() {
    if (!this.campaignRuntime || !this.mission) return;
    const previousIndex = this.activeCampaignSegmentIndex;
    const nextIndex = this.activeCampaignSegmentIndex + 1;
    const nextTemplate = this.campaignRuntime.segmentMissionData[nextIndex];
    if (!nextTemplate) return;

    const carriedSherman = this.currentShermanCampaignPlacement();
    if (carriedSherman && this.campaignUpgradeActive('emergency_medical_kit')) {
      reviveFirstCampaignCrewMember(carriedSherman);
    }
    const nextData = this.cloneMissionData(nextTemplate);
    if (carriedSherman) {
      const nextTemplatePlayer = nextData.playerTank ?? nextData.sherman!;
      const carried = carryPlayerTankToNextSegment(carriedSherman, nextTemplatePlayer);
      nextData.playerTank = carried;
      nextData.sherman = carried;
    }

    this.activeCampaignSegmentIndex = nextIndex;
    this.retainedCampaignAttackDiePip = null;
    this.campaignTransitionActive = true;
    this.campaignViewSegmentIndexOverride = previousIndex;
    this.loadAndDraw(nextData);
    this.campaignViewSegmentIndexOverride = null;
    this.battleLogI18n('battleLog.campaign.advance', { segment: nextIndex + 1 });
    this.startCampaignPanToSegment(nextIndex);
  }

  /** Save the start state of the newly entered campaign segment in its own slot. */
  private writeCampaignSegmentCheckpoint() {
    if (!this.campaignRuntime || !this.mission) return;
    const save = captureSave({
      gameMode: GameSession.gameMode,
      missionId: this.missionId,
      mission: this.mission,
      turn: this.turn,
      phase: this.phase === 'player' ? 'player' : 'enemy',
      movesLeft: this.movementDone ? 0 : 2,
      attacksLeft: this.attackDone ? 0 : 1,
      miscDone: this.miscDone,
      playerStep: this.playerStep as SavePlayerStep,
      hatchChangedThisTurn: this.hatchChangedThisTurn,
      phaseDice: this.phaseDice.map(s => ({ pip: s.pip, used: s.used })),
      attackPositionMemory: this.attackPositionMemory,
      missionSource: this.missionSource,
    });
    try {
      writeCampaignCheckpoint({
        campaignId: this.campaignRuntime.campaign.id,
        segmentIndex: this.activeCampaignSegmentIndex,
        save,
      });
      this.battleLog(`[Campaign] 已保存第 ${this.activeCampaignSegmentIndex + 1} 小关检查点`);
    } catch (e) {
      console.error('[Campaign] 写入小关检查点失败:', e);
    }
  }

  private campaignUpgradesEnabled(): boolean {
    return !!this.campaignRuntime
      && GameSession.gameMode === 'hardcore'
      && !GameSession.isPvp;
  }

  private campaignUpgradeActive(id: CampaignUpgradeId): boolean {
    return this.campaignUpgradesEnabled() && hasCampaignUpgrade(this.campaignUpgradeIds, id);
  }

  private campaignReadyRackCanReloadShootingDice(): boolean {
    return this.campaignUpgradeActive('ready_rack')
      && campaignUpgradeDefinition('ready_rack').shootingDiceCanReload;
  }

  private campaignMovementDiceCanReverseDirection(): boolean {
    return this.campaignUpgradeActive('improved_transmission')
      && campaignUpgradeDefinition('improved_transmission').movementDiceCanReverseDirection;
  }

  private campaignMainGunHitThresholdModifier(): number {
    return this.selectedGunHitThresholdModifier
      + campaignUpgradeHitThresholdModifier(this.campaignUpgradeIds);
  }

  /** 玩家主炮的命中修正逐项展示；总和与 campaignMainGunHitThresholdModifier + 伏击一致。 */
  private playerMainGunHitThresholdModifierDetails() {
    const details: Array<{ labelKey: string; value: number }> = [];
    if (this.selectedGunHitThresholdModifier) {
      details.push({ labelKey: 'dice.rule.precisionFire', value: this.selectedGunHitThresholdModifier });
    }
    const optics = campaignUpgradeHitThresholdModifier(this.campaignUpgradeIds);
    if (optics) details.push({ labelKey: 'campaignUpgrade.improvedOptics.name', value: optics });
    if (this.mission) {
      details.push(...ambushHitThresholdModifierDetails(this.mission.sherman, GameSession.gameMode));
    }
    return details;
  }

  /** 烟雾弹初始可由杂项 3 点使用；烟幕发射器再把该动作扩展到 2、4 点。 */
  private miscDieCanDeploySmoke(pip: number): boolean {
    if (classifyMiscDie(pip) === 'smoke_or_repair') return true;
    if (pip !== 2 && pip !== 4) return false;
    return this.campaignUpgradeActive('smoke_launcher')
      && campaignUpgradeDefinition('smoke_launcher').smokeOnMiscPips2And4;
  }

  private resetCampaignUpgradeRuntime() {
    this.closeCampaignUpgradeDetail();
    if (this.campaignUpgradeChoiceRoot?.isValid) this.campaignUpgradeChoiceRoot.destroy();
    this.campaignUpgradeChoiceRoot = null;
    this.campaignUpgradeChoiceCards = [];
    this.campaignUpgradeIds = [];
    this.campaignUpgradeCandidates = [];
    this.campaignUpgradeChosenSegments.clear();
    this.campaignUpgradeSelectedIndex = 1;
    this.retainedCampaignAttackDiePip = null;
    this.refreshCampaignUpgradeStatusSlots();
  }

  private openCampaignUpgradeChoiceForCurrentSegment() {
    if (!this.campaignUpgradesEnabled() || !this.campaignRuntime || !this.mission) return;
    if (this.campaignUpgradeChosenSegments.has(this.activeCampaignSegmentIndex)) return;
    if (this.campaignUpgradeChoiceRoot?.isValid) return;
    this.closeCampaignUpgradeDetail();
    this.campaignUpgradeCandidates = drawCampaignUpgradeCandidates(this.rng, this.campaignUpgradeIds, 3);
    if (this.campaignUpgradeCandidates.length === 0) return;
    this.campaignUpgradeSelectedIndex = Math.min(1, this.campaignUpgradeCandidates.length - 1);
    this.buildCampaignUpgradeChoiceUI();
  }

  private buildCampaignUpgradeChoiceUI() {
    if (!this.campaignRuntime) return;
    const root = new Node('CampaignUpgradeChoice');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    root.addComponent(BlockInputEvents);
    this.node.addChild(root);
    root.setSiblingIndex(this.node.children.length - 1);
    this.campaignUpgradeChoiceRoot = root;

    const { node: backdrop } = createAdaptiveFullscreenMask(
      root,
      'Backdrop',
      new Color(5, 8, 5, 205),
      UI_ROOT_SCALE,
    );
    backdrop.on(Node.EventType.TOUCH_END, (event: EventTouch) => { event.propagationStopped = true; }, this);

    const panelW = Math.min(1180, CANVAS_W - 44);
    const panelH = Math.min(674, CANVAS_H - 28);
    const panel = new Node('Panel');
    panel.layer = this.node.layer;
    panel.addComponent(UITransform).setContentSize(panelW, panelH);
    const pg = panel.addComponent(Graphics);
    this.drawCampaignUpgradePanel(pg, panelW, panelH);
    panel.on(Node.EventType.TOUCH_START, (event: EventTouch) => { event.propagationStopped = true; }, this);
    panel.on(Node.EventType.TOUCH_END, (event: EventTouch) => { event.propagationStopped = true; }, this);
    root.addChild(panel);

    const plaque = new Node('TitlePlaque');
    plaque.layer = this.node.layer;
    plaque.addComponent(UITransform).setContentSize(550, 88);
    plaque.setPosition(0, panelH / 2 - 50, 0);
    const plaqueG = plaque.addComponent(Graphics);
    this.drawCampaignUpgradePlaque(plaqueG, 550, 88);
    panel.addChild(plaque);
    const titleLabel = this.makeBattleModalLabel(plaque, t('campaignUpgrade.selectTitle'), 0, 2,
      500, 66, 42, new Color(232, 218, 167, 255));
    titleLabel.enableOutline = true;
    titleLabel.outlineColor = new Color(25, 25, 18, 255);
    titleLabel.outlineWidth = 2;
    this.makeBattleModalLabel(panel, t('campaignUpgrade.selectSubtitle'), 0, panelH / 2 - 116,
      panelW - 300, 34, 21, new Color(201, 188, 143, 255));
    this.makeBattleModalLabel(panel, t('campaignUpgrade.progress', {
      current: this.activeCampaignSegmentIndex + 1,
      total: this.campaignRuntime.segments.length,
    }), panelW / 2 - 112, panelH / 2 - 66, 190, 38, 23, new Color(224, 198, 116, 255));

    const cardW = Math.min(340, (panelW - 120) / 3);
    const cardH = 410;
    const gap = 25;
    const cardY = -4;
    this.campaignUpgradeChoiceCards = [];
    this.campaignUpgradeCandidates.forEach((id, index) => {
      const x = (index - 1) * (cardW + gap);
      const refs = this.buildCampaignUpgradeCard(
        panel,
        campaignUpgradeDefinition(id),
        x,
        cardY,
        cardW,
        cardH,
        index === this.campaignUpgradeSelectedIndex,
        () => this.selectCampaignUpgradeCandidate(index),
        'transparent-detail',
      );
      this.campaignUpgradeChoiceCards.push(refs);
    });

    const footerH = 86;
    const bottomY = -panelH / 2 + footerH / 2 + 6;
    const footer = new Node('UpgradeFooter');
    footer.layer = this.node.layer;
    footer.addComponent(UITransform).setContentSize(panelW - 24, footerH);
    footer.setPosition(0, bottomY, 0);
    const footerG = footer.addComponent(Graphics);
    this.drawCampaignUpgradeFooter(footerG, panelW - 24, footerH);
    panel.addChild(footer);
    this.makeBattleModalLabel(footer, t('campaignUpgrade.acquiredTitle'), -panelW / 2 + 132,
      0, 190, 40, 22, new Color(215, 198, 145, 255));
    for (let i = 0; i < 3; i++) {
      const id = this.campaignUpgradeIds[i];
      this.buildCampaignUpgradeCompactSlot(footer, id, -panelW / 2 + 258 + i * 70, 0, 60, 58);
    }
    const confirm = this.makeBattleRectButton(
      footer,
      panelW / 2 - 145,
      0,
      240,
      58,
      new Color(120, 92, 42, 255),
      () => this.confirmCampaignUpgradeChoice(),
    );
    this.redrawCampaignUpgradeConfirmButton(confirm.node, 240, 58);
    const confirmLabel = this.makeBattleModalLabel(confirm.node, t('campaignUpgrade.confirm'), 0, 0,
      224, 50, 25, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(confirmLabel, () => this.confirmCampaignUpgradeChoice());
  }

  private drawCampaignUpgradePanel(g: Graphics, w: number, h: number) {
    g.fillColor = new Color(20, 25, 19, 252);
    g.strokeColor = new Color(137, 123, 78, 255);
    g.lineWidth = 3;
    g.rect(-w / 2, -h / 2, w, h); g.fill(); g.stroke();
    g.strokeColor = new Color(212, 190, 120, 170);
    g.lineWidth = 1;
    g.rect(-w / 2 + 8, -h / 2 + 8, w - 16, h - 16); g.stroke();
    g.strokeColor = new Color(64, 67, 48, 255);
    g.rect(-w / 2 + 15, -h / 2 + 15, w - 30, h - 30); g.stroke();
    g.fillColor = new Color(184, 159, 88, 255);
    for (const [x, y] of [[-w / 2 + 18, -h / 2 + 18], [w / 2 - 18, -h / 2 + 18],
      [-w / 2 + 18, h / 2 - 18], [w / 2 - 18, h / 2 - 18]]) {
      g.circle(x, y, 4); g.fill();
    }
  }

  private drawCampaignUpgradePlaque(g: Graphics, w: number, h: number) {
    g.fillColor = new Color(42, 43, 32, 255);
    g.strokeColor = new Color(126, 112, 70, 255);
    g.lineWidth = 3;
    g.moveTo(-w / 2 + 26, -h / 2); g.lineTo(w / 2 - 26, -h / 2);
    g.lineTo(w / 2, -h / 2 + 22); g.lineTo(w / 2, h / 2 - 22);
    g.lineTo(w / 2 - 26, h / 2); g.lineTo(-w / 2 + 26, h / 2);
    g.lineTo(-w / 2, h / 2 - 22); g.lineTo(-w / 2, -h / 2 + 22); g.close();
    g.fill(); g.stroke();
    g.strokeColor = new Color(211, 185, 105, 125);
    g.lineWidth = 1;
    g.rect(-w / 2 + 12, -h / 2 + 10, w - 24, h - 20); g.stroke();
    g.fillColor = new Color(188, 160, 82, 255);
    g.circle(-w / 2 + 20, 0, 4); g.circle(w / 2 - 20, 0, 4); g.fill();
  }

  private drawCampaignUpgradeFooter(g: Graphics, w: number, h: number) {
    g.fillColor = new Color(33, 35, 27, 255);
    g.strokeColor = new Color(112, 101, 67, 255);
    g.lineWidth = 2;
    g.rect(-w / 2, -h / 2, w, h); g.fill(); g.stroke();
    g.strokeColor = new Color(190, 168, 101, 90);
    g.lineWidth = 1;
    g.moveTo(-w / 2 + 12, h / 2 - 8); g.lineTo(w / 2 - 12, h / 2 - 8); g.stroke();
    g.moveTo(330, -h / 2 + 14); g.lineTo(330, h / 2 - 14); g.stroke();
  }

  private redrawCampaignUpgradeConfirmButton(node: Node, w: number, h: number) {
    const g = node.getComponent(Graphics);
    if (!g) return;
    g.clear();
    g.fillColor = new Color(125, 91, 39, 255);
    g.strokeColor = new Color(224, 192, 105, 255);
    g.lineWidth = 3;
    g.rect(-w / 2, -h / 2, w, h); g.fill(); g.stroke();
    g.strokeColor = new Color(245, 221, 150, 150);
    g.lineWidth = 1;
    g.rect(-w / 2 + 7, -h / 2 + 7, w - 14, h - 14); g.stroke();
    g.fillColor = new Color(236, 205, 116, 255);
    g.circle(-w / 2 + 12, 0, 3); g.circle(w / 2 - 12, 0, 3); g.fill();
  }

  /** 详情页关闭按钮不使用 drawFieldPanel，避免其深色内框在红色按钮上形成黑线。 */
  private redrawCampaignUpgradeDetailCloseButton(node: Node, w: number, h: number) {
    const g = node.getComponent(Graphics);
    if (!g) return;
    g.clear();
    g.fillColor = MODAL_CLOSE_BG;
    g.rect(-w / 2, -h / 2, w, h); g.fill();
    g.strokeColor = new Color(224, 192, 105, 255);
    g.lineWidth = 2;
    g.rect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2); g.stroke();
    g.strokeColor = new Color(255, 226, 150, 220);
    g.lineWidth = 1.5;
    const inset = 7;
    const corner = 13;
    const left = -w / 2 + inset;
    const right = w / 2 - inset;
    const bottom = -h / 2 + inset;
    const top = h / 2 - inset;
    g.moveTo(left, top - corner); g.lineTo(left, top); g.lineTo(left + corner, top);
    g.moveTo(right - corner, top); g.lineTo(right, top); g.lineTo(right, top - corner);
    g.moveTo(left, bottom + corner); g.lineTo(left, bottom); g.lineTo(left + corner, bottom);
    g.moveTo(right - corner, bottom); g.lineTo(right, bottom); g.lineTo(right, bottom + corner);
    g.stroke();
  }

  private buildCampaignUpgradeCard(
    parent: Node,
    def: CampaignUpgradeDefinition,
    x: number,
    y: number,
    w: number,
    h: number,
    selected: boolean,
    onSelect?: () => void,
    visualStyle: 'selection' | 'transparent-detail' = 'selection',
  ): CampaignUpgradeCardRefs {
    const card = new Node(`CampaignUpgradeCard_${def.id}`);
    card.layer = this.node.layer;
    card.addComponent(UITransform).setContentSize(w, h);
    card.setPosition(x, y, 0);
    const frame = card.addComponent(Graphics);
    const redraw = (isSelected: boolean) => {
      frame.clear();
      if (visualStyle === 'transparent-detail') {
        // 选择页和详情页共用透明展示框；选中项只增强金色轮廓，不增加底色。
        if (isSelected) {
          frame.strokeColor = new Color(255, 190, 42, 70);
          frame.lineWidth = 12;
          frame.rect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6); frame.stroke();
        }
        frame.strokeColor = isSelected
          ? new Color(245, 184, 44, 255)
          : new Color(218, 195, 124, 190);
        frame.lineWidth = isSelected ? 4 : 2;
        frame.rect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2); frame.stroke();
        frame.strokeColor = new Color(235, 214, 151, 95);
        frame.lineWidth = 1;
        frame.rect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20); frame.stroke();
        const dividerY = -h * 0.105;
        frame.moveTo(-w / 2 + 28, dividerY); frame.lineTo(-18, dividerY);
        frame.moveTo(18, dividerY); frame.lineTo(w / 2 - 28, dividerY); frame.stroke();
        frame.fillColor = new Color(230, 205, 128, 220);
        frame.moveTo(0, dividerY + 9); frame.lineTo(5, dividerY + 3); frame.lineTo(12, dividerY + 3);
        frame.lineTo(7, dividerY - 2); frame.lineTo(9, dividerY - 10); frame.lineTo(0, dividerY - 5);
        frame.lineTo(-9, dividerY - 10); frame.lineTo(-7, dividerY - 2); frame.lineTo(-12, dividerY + 3);
        frame.lineTo(-5, dividerY + 3); frame.close(); frame.fill();
        return;
      }
      if (isSelected) {
        frame.strokeColor = new Color(255, 190, 42, 70);
        frame.lineWidth = 12;
        frame.rect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6); frame.stroke();
      }
      frame.fillColor = new Color(48, 45, 33, 255);
      frame.rect(-w / 2 - 5, -h / 2 - 6, w + 10, h + 10); frame.fill();
      frame.fillColor = new Color(218, 204, 158, 255);
      frame.rect(-w / 2, -h / 2, w, h); frame.fill();
      frame.fillColor = new Color(236, 224, 184, 65);
      frame.rect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20); frame.fill();
      frame.strokeColor = isSelected ? new Color(245, 184, 44, 255) : new Color(99, 83, 47, 255);
      frame.lineWidth = isSelected ? 5 : 3;
      frame.rect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2); frame.stroke();
      frame.strokeColor = new Color(91, 76, 42, 210);
      frame.lineWidth = 1;
      frame.rect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20); frame.stroke();
      const dividerY = -h * 0.105;
      frame.moveTo(-w / 2 + 28, dividerY); frame.lineTo(-18, dividerY); frame.stroke();
      frame.moveTo(18, dividerY); frame.lineTo(w / 2 - 28, dividerY); frame.stroke();
      frame.fillColor = new Color(97, 80, 40, 255);
      frame.moveTo(0, dividerY + 9); frame.lineTo(5, dividerY + 3); frame.lineTo(12, dividerY + 3);
      frame.lineTo(7, dividerY - 2); frame.lineTo(9, dividerY - 10); frame.lineTo(0, dividerY - 5);
      frame.lineTo(-9, dividerY - 10); frame.lineTo(-7, dividerY - 2); frame.lineTo(-12, dividerY + 3);
      frame.lineTo(-5, dividerY + 3); frame.close(); frame.fill();
      frame.fillColor = new Color(103, 87, 50, 255);
      for (const [rx, ry] of [[-w / 2 + 17, -h / 2 + 17], [w / 2 - 17, -h / 2 + 17],
        [-w / 2 + 17, h / 2 - 17], [w / 2 - 17, h / 2 - 17]]) {
        frame.circle(rx, ry, 3); frame.fill();
      }
    };
    redraw(selected);
    parent.addChild(card);

    const transparentDetail = visualStyle === 'transparent-detail';
    const title = this.makeBattleModalLabel(card, t(def.nameKey), 0, h / 2 - 38, w - 50, 48, 30,
      transparentDetail ? new Color(255, 238, 184, 255) : new Color(47, 41, 25, 255));
    title.overflow = Label.Overflow.SHRINK;
    if (transparentDetail) {
      title.enableOutline = true;
      title.outlineColor = new Color(8, 10, 8, 245);
      title.outlineWidth = 3;
    }
    const iconSize = Math.min(h > 480 ? 245 : 178, h * 0.41);
    this.buildCampaignUpgradeIconNode(card, def.id, 0, h * 0.13, iconSize);

    const body = new Node('Description');
    body.layer = this.node.layer;
    body.addComponent(UITransform).setContentSize(w - 54, h * 0.33);
    body.setPosition(0, -h * 0.32, 0);
    const description = body.addComponent(Label);
    description.string = t(def.descriptionKey);
    description.fontSize = 22;
    description.lineHeight = 31;
    description.color = transparentDetail
      ? new Color(250, 243, 216, 255)
      : new Color(50, 44, 27, 255);
    description.horizontalAlign = HorizontalTextAlignment.LEFT;
    description.verticalAlign = VerticalTextAlignment.CENTER;
    description.enableWrapText = true;
    description.overflow = Label.Overflow.SHRINK;
    if (transparentDetail) {
      description.enableOutline = true;
      description.outlineColor = new Color(6, 8, 6, 245);
      description.outlineWidth = 3;
    }
    card.addChild(body);

    card.on(Node.EventType.TOUCH_START, (event: EventTouch) => { event.propagationStopped = true; }, this);
    bindButtonPressScale(card);
    card.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
      if (onSelect) {
        playUiClick();
        onSelect();
      }
      event.propagationStopped = true;
    }, this);
    return { id: def.id, node: card, redraw };
  }

  private loadCampaignUpgradeIconAtlas(onReady: (atlas: SpriteFrame | null) => void) {
    if (this.campaignUpgradeIconAtlas?.isValid) {
      onReady(this.campaignUpgradeIconAtlas);
      return;
    }
    this.campaignUpgradeIconWaiters.push(onReady);
    if (this.campaignUpgradeIconAtlasLoading) return;
    this.campaignUpgradeIconAtlasLoading = true;
    resources.load('textures/ui/campaign_upgrades/upgrade_icons_atlas_v1/spriteFrame', SpriteFrame, (err, atlas) => {
      this.campaignUpgradeIconAtlasLoading = false;
      this.campaignUpgradeIconAtlas = !err && atlas ? atlas : null;
      if (err || !atlas) console.warn('[CampaignUpgrade] icon atlas load failed:', err);
      const waiters = this.campaignUpgradeIconWaiters.splice(0);
      for (const waiter of waiters) waiter(this.campaignUpgradeIconAtlas);
    });
  }

  private loadCampaignUpgradeIconAtlasV2(onReady: (atlas: SpriteFrame | null) => void) {
    if (this.campaignUpgradeIconAtlasV2?.isValid) {
      onReady(this.campaignUpgradeIconAtlasV2);
      return;
    }
    this.campaignUpgradeIconV2Waiters.push(onReady);
    if (this.campaignUpgradeIconAtlasV2Loading) return;
    this.campaignUpgradeIconAtlasV2Loading = true;
    resources.load('textures/ui/campaign_upgrades/upgrade_icons_atlas_v2/spriteFrame', SpriteFrame, (err, atlas) => {
      this.campaignUpgradeIconAtlasV2Loading = false;
      this.campaignUpgradeIconAtlasV2 = !err && atlas ? atlas : null;
      if (err || !atlas) console.warn('[CampaignUpgrade] extension icon atlas load failed:', err);
      const waiters = this.campaignUpgradeIconV2Waiters.splice(0);
      for (const waiter of waiters) waiter(this.campaignUpgradeIconAtlasV2);
    });
  }

  private loadCampaignUpgradeHvapIcon(onReady: (icon: SpriteFrame | null) => void) {
    if (this.campaignUpgradeHvapIcon?.isValid) {
      onReady(this.campaignUpgradeHvapIcon);
      return;
    }
    this.campaignUpgradeHvapIconWaiters.push(onReady);
    if (this.campaignUpgradeHvapIconLoading) return;
    this.campaignUpgradeHvapIconLoading = true;
    resources.load('textures/ui/campaign_upgrades/upgrade_icon_hvap/spriteFrame', SpriteFrame, (err, icon) => {
      this.campaignUpgradeHvapIconLoading = false;
      this.campaignUpgradeHvapIcon = !err && icon ? icon : null;
      if (err || !icon) console.warn('[CampaignUpgrade] HVAP icon load failed:', err);
      const waiters = this.campaignUpgradeHvapIconWaiters.splice(0);
      for (const waiter of waiters) waiter(this.campaignUpgradeHvapIcon);
    });
  }

  private campaignUpgradeIconFrame(atlas: SpriteFrame, id: CampaignUpgradeId): SpriteFrame | null {
    const legacyIndex = CAMPAIGN_UPGRADE_ICON_ORDER.indexOf(id);
    const extensionIndex = CAMPAIGN_UPGRADE_ICON_ORDER_V2.indexOf(id);
    const index = legacyIndex >= 0 ? legacyIndex : extensionIndex;
    if (index < 0) return null;
    const texture = atlas.texture;
    const columns = legacyIndex >= 0 ? 5 : 4;
    const cellW = texture.width / columns;
    const cellH = texture.height / 2;
    const frame = new SpriteFrame();
    frame.reset({
      texture,
      rect: new Rect((index % columns) * cellW, Math.floor(index / columns) * cellH, cellW, cellH),
      originalSize: new Size(cellW, cellH),
    });
    return frame;
  }

  private buildCampaignUpgradeIconNode(
    parent: Node,
    id: CampaignUpgradeId,
    x: number,
    y: number,
    size: number,
  ): Node {
    const root = new Node(`UpgradeArt_${id}`);
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(size, size);
    root.setPosition(x, y, 0);
    parent.addChild(root);

    const halo = new Node('ArtHalo');
    halo.layer = this.node.layer;
    halo.addComponent(UITransform).setContentSize(size, size * 0.45);
    halo.setPosition(0, -size * 0.22, 0);
    const haloG = halo.addComponent(Graphics);
    haloG.fillColor = new Color(72, 62, 38, 24);
    haloG.ellipse(0, 0, size * 0.43, size * 0.10); haloG.fill();
    root.addChild(halo);

    const art = new Node('Art');
    art.layer = this.node.layer;
    art.addComponent(UITransform).setContentSize(size, size);
    const sprite = art.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    root.addChild(art);

    const fallback = new Node('FallbackArt');
    fallback.layer = this.node.layer;
    fallback.addComponent(UITransform).setContentSize(size, size);
    this.drawCampaignUpgradeIcon(fallback.addComponent(Graphics), id, size * 0.34);
    root.addChild(fallback);

    if (id === 'hvap') {
      this.loadCampaignUpgradeHvapIcon((frame) => {
        if (!root.isValid || !frame) return;
        sprite.spriteFrame = frame;
        if (fallback.isValid) fallback.destroy();
      });
      return root;
    }

    const loadAtlas = CAMPAIGN_UPGRADE_ICON_ORDER_V2.includes(id)
      ? this.loadCampaignUpgradeIconAtlasV2.bind(this)
      : this.loadCampaignUpgradeIconAtlas.bind(this);
    loadAtlas((atlas) => {
      if (!root.isValid || !atlas) return;
      const frame = this.campaignUpgradeIconFrame(atlas, id);
      if (!frame) return;
      sprite.spriteFrame = frame;
      if (fallback.isValid) fallback.destroy();
    });
    return root;
  }

  private drawCampaignUpgradeIcon(g: Graphics, id: CampaignUpgradeId, r: number) {
    const dark = new Color(54, 53, 42, 255);
    const mid = new Color(100, 96, 70, 255);
    g.strokeColor = dark;
    g.fillColor = mid;
    g.lineWidth = Math.max(3, r * 0.07);
    if (id === 'commander_cupola') {
      g.circle(0, -r * 0.15, r * 0.62); g.stroke();
      g.rect(-r * 0.20, r * 0.08, r * 0.40, r * 0.62); g.fill(); g.stroke();
      g.rect(-r * 0.62, r * 0.42, r * 1.24, r * 0.34); g.fill(); g.stroke();
    } else if (id === 'improved_optics') {
      g.circle(0, 0, r * 0.74); g.stroke();
      g.circle(0, 0, r * 0.24); g.stroke();
      g.moveTo(-r, 0); g.lineTo(r, 0); g.moveTo(0, -r); g.lineTo(0, r); g.stroke();
    } else if (id === 'wet_ammo_rack') {
      g.rect(-r * 0.80, -r * 0.70, r * 1.60, r * 1.40); g.stroke();
      for (let i = -2; i <= 2; i++) { g.rect(i * r * 0.27 - r * 0.08, -r * 0.52, r * 0.16, r * 1.04); g.fill(); }
    } else if (id === 'spall_liner') {
      g.moveTo(0, r); g.lineTo(r * 0.78, r * 0.48); g.lineTo(r * 0.60, -r * 0.58);
      g.lineTo(0, -r); g.lineTo(-r * 0.60, -r * 0.58); g.lineTo(-r * 0.78, r * 0.48); g.close(); g.stroke();
      g.moveTo(-r * 0.45, 0); g.lineTo(r * 0.45, 0); g.stroke();
    } else if (id === 'automatic_extinguisher') {
      g.roundRect(-r * 0.42, -r * 0.72, r * 0.84, r * 1.35, r * 0.18); g.fill(); g.stroke();
      g.rect(-r * 0.18, r * 0.63, r * 0.36, r * 0.25); g.fill();
      g.moveTo(r * 0.18, r * 0.78); g.lineTo(r * 0.72, r * 0.62); g.lineTo(r * 0.82, r * 0.22); g.stroke();
    } else if (id === 'side_skirts') {
      g.rect(-r * 0.95, -r * 0.52, r * 1.90, r * 1.04); g.stroke();
      for (let i = -2; i <= 2; i++) { g.moveTo(i * r * 0.36, -r * 0.50); g.lineTo(i * r * 0.36, r * 0.50); }
      g.stroke();
    } else if (id === 'wide_tracks') {
      g.roundRect(-r, -r * 0.58, r * 2, r * 1.16, r * 0.40); g.stroke();
      for (let i = -3; i <= 3; i++) { g.moveTo(i * r * 0.27, -r * 0.52); g.lineTo(i * r * 0.27, r * 0.52); }
      g.stroke();
      g.circle(-r * 0.48, 0, r * 0.27); g.circle(r * 0.48, 0, r * 0.27); g.stroke();
    } else if (id === 'improved_transmission') {
      g.circle(0, 0, r * 0.62); g.stroke();
      g.circle(0, 0, r * 0.22); g.stroke();
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        g.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
        g.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
      }
      g.stroke();
    } else if (id === 'smoke_launcher') {
      g.rect(-r * 0.82, -r * 0.62, r * 1.64, r * 0.42); g.fill(); g.stroke();
      g.circle(-r * 0.48, r * 0.32, r * 0.32); g.circle(0, r * 0.52, r * 0.40); g.circle(r * 0.52, r * 0.30, r * 0.34); g.stroke();
    } else {
      g.circle(-r * 0.55, 0, r * 0.35); g.circle(r * 0.55, 0, r * 0.35); g.stroke();
      g.moveTo(-r * 0.90, 0); g.bezierCurveTo(-r * 0.78, r, r * 0.78, r, r * 0.90, 0); g.stroke();
      g.rect(-r * 0.14, -r * 0.62, r * 0.28, r * 0.72); g.fill();
    }
  }

  private selectCampaignUpgradeCandidate(index: number) {
    if (!this.campaignUpgradeChoiceRoot || index < 0 || index >= this.campaignUpgradeCandidates.length) return;
    this.campaignUpgradeSelectedIndex = index;
    this.campaignUpgradeChoiceCards.forEach((card, i) => card.redraw(i === index));
  }

  private confirmCampaignUpgradeChoice() {
    if (!this.campaignUpgradeChoiceRoot || !this.mission) return;
    const id = this.campaignUpgradeCandidates[this.campaignUpgradeSelectedIndex];
    if (!id || this.campaignUpgradeIds.includes(id)) return;
    this.campaignUpgradeIds.push(id);
    this.campaignUpgradeChosenSegments.add(this.activeCampaignSegmentIndex);
    applyCampaignUpgradesToSherman(this.mission.sherman, this.campaignUpgradeIds);
    if (id === 'emergency_medical_kit' && this.activeCampaignSegmentIndex > 0) {
      reviveFirstCampaignCrewMember(this.mission.sherman);
    }
    this.battleLogI18n('campaignUpgrade.acquiredLog', { name: t(campaignUpgradeDefinition(id).nameKey) });
    this.closeCampaignUpgradeDetail();
    this.campaignUpgradeChoiceRoot.destroy();
    this.campaignUpgradeChoiceRoot = null;
    this.campaignUpgradeChoiceCards = [];
    this.refreshCampaignUpgradeStatusSlots();
    this.refreshPlayerVisibility();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.writeCampaignSegmentCheckpoint();
  }

  private buildCampaignUpgradeCompactSlot(
    parent: Node,
    id: CampaignUpgradeId | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
  ): Node {
    const slot = new Node(id ? `UpgradeSlot_${id}` : 'UpgradeSlot_Empty');
    slot.layer = this.node.layer;
    slot.addComponent(UITransform).setContentSize(w, h);
    slot.setPosition(x, y, 0);
    const g = slot.addComponent(Graphics);
    g.fillColor = id ? new Color(67, 63, 43, 255) : new Color(25, 28, 22, 240);
    g.strokeColor = id ? new Color(210, 175, 79, 255) : new Color(97, 88, 57, 200);
    g.lineWidth = id ? 2 : 1;
    g.rect(-w / 2, -h / 2, w, h); g.fill(); g.stroke();
    g.strokeColor = new Color(222, 195, 116, id ? 105 : 50);
    g.lineWidth = 1;
    g.rect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8); g.stroke();
    if (id) {
      this.buildCampaignUpgradeIconNode(slot, id, 0, 2, Math.min(w, h) - 5);
      bindButtonPressScale(slot);
      slot.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
        playUiClick();
        this.openCampaignUpgradeDetail(id);
        event.propagationStopped = true;
      }, this);
    } else {
      g.fillColor = new Color(116, 102, 62, 120);
      g.moveTo(0, 12); g.lineTo(5, 4); g.lineTo(14, 4); g.lineTo(7, -2);
      g.lineTo(10, -12); g.lineTo(0, -6); g.lineTo(-10, -12); g.lineTo(-7, -2);
      g.lineTo(-14, 4); g.lineTo(-5, 4); g.close(); g.fill();
    }
    parent.addChild(slot);
    return slot;
  }

  private refreshCampaignUpgradeStatusSlots() {
    const root = this.campaignUpgradeStatusRoot;
    if (!root?.isValid) return;
    for (const child of [...root.children]) child.destroy();
    this.campaignUpgradeStatusSlots = [];
    for (let i = 0; i < 3; i++) {
      const slot = this.buildCampaignUpgradeCompactSlot(
        root,
        this.campaignUpgradeIds[i],
        (i - 1) * 64,
        -24,
        56,
        52,
      );
      this.campaignUpgradeStatusSlots.push(slot);
    }
  }

  private openCampaignUpgradeDetail(id: CampaignUpgradeId) {
    if (this.campaignUpgradeDetailRoot?.isValid) return;
    const root = new Node('CampaignUpgradeDetail');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    root.addComponent(BlockInputEvents);
    this.node.addChild(root);
    root.setSiblingIndex(this.node.children.length - 1);
    this.campaignUpgradeDetailRoot = root;

    const { node: backdrop } = createAdaptiveFullscreenMask(
      root,
      'Backdrop',
      new Color(0, 0, 0, 180),
      UI_ROOT_SCALE,
    );
    backdrop.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
      this.closeCampaignUpgradeDetail();
      event.propagationStopped = true;
    }, this);

    const cardW = Math.min(520, CANVAS_W - 180);
    const cardH = Math.min(570, CANVAS_H - 90);
    this.buildCampaignUpgradeCard(
      root,
      campaignUpgradeDefinition(id),
      0,
      0,
      cardW,
      cardH,
      false,
      undefined,
      'transparent-detail',
    );
    const close = this.makeBattleRectButton(root, cardW / 2 - 18, cardH / 2 - 18, 58, 58,
      MODAL_CLOSE_BG, () => this.closeCampaignUpgradeDetail());
    this.redrawCampaignUpgradeDetailCloseButton(close.node, 58, 58);
    const closeLabel = this.makeBattleModalLabel(close.node, '✕', 0, 0, 52, 52, 30, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(closeLabel, () => this.closeCampaignUpgradeDetail());
  }

  private closeCampaignUpgradeDetail() {
    if (this.campaignUpgradeDetailRoot?.isValid) this.campaignUpgradeDetailRoot.destroy();
    this.campaignUpgradeDetailRoot = null;
  }

  private debugSkipCampaignSegment() {
    if (!this.campaignRuntime || !this.mission) return;
    if (this.isBusy()) return;
    if (this.activeCampaignSegmentIndex >= this.campaignRuntime.segments.length - 1) return;
    this.closeDiePopover();
    this.clearGunSelection();
    this.phaseDice = [];
    this.playerDiceRollAnim = null;
    this.playerDiceSortAnim = null;
    this.outcome = 'victory';
    this.battleLog('[Debug] 跳到下一关');
    this.advanceCampaignSegment();
  }

  private currentTurnEndMissionId(): string {
    if (this.campaignRuntime) {
      const segment = this.campaignRuntime.segments[this.activeCampaignSegmentIndex];
      return this.mission?.data.eventTableId
        ?? segment?.sourcePacificMissionId
        ?? segment?.missionId
        ?? this.mission?.data.id
        ?? this.missionId;
    }
    return this.mission?.data.eventTableId ?? this.mission?.data.id ?? this.missionId;
  }

  private campaignViewTiles(): Tile[] {
    if (!this.mission || !this.campaignRuntime) return this.mission?.map.all() ?? [];
    const viewIndex = this.campaignViewSegmentIndexOverride ?? this.activeCampaignSegmentIndex;
    return this.cameraReferenceSegmentTiles(viewIndex);
  }

  private cameraReferenceSegmentTiles(index: number): Tile[] {
    if (!this.mission || !this.campaignRuntime) return [];
    const rowParityOffset = this.mission.data.rowParityOffset === 1 ? 1 : 0;
    return this.mission.map.all().filter(tile => {
      const offset = axialToOffset(tile.pos, rowParityOffset);
      return campaignSegmentForOffset(this.campaignRuntime!, offset) === index;
    });
  }

  private cameraReferenceTilesForSegment(index: number): Tile[] {
    const segmentTiles = this.cameraReferenceSegmentTiles(index);
    const playableTiles = segmentTiles.filter(tile => !tile.displayOnly);
    return playableTiles.length > 0 ? playableTiles : segmentTiles;
  }

  private cameraReferenceTiles(): Tile[] {
    if (!this.mission) return [];
    if (this.campaignRuntime) {
      const viewIndex = this.campaignViewSegmentIndexOverride ?? this.activeCampaignSegmentIndex;
      return this.cameraReferenceTilesForSegment(viewIndex);
    }
    const tiles = this.mission.map.all();
    const playableTiles = tiles.filter(tile => !tile.displayOnly);
    return playableTiles.length > 0 ? playableTiles : tiles;
  }

  private tileBoundsCenter(tiles: Tile[]): { x: number; y: number } | null {
    if (tiles.length <= 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of tiles) {
      const p = axialToPixel(t.pos, this.hexSize);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  private isCampaignNextSegmentEntry(pos: Axial): boolean {
    if (!this.mission || !this.campaignRuntime) return false;
    const nextIndex = this.activeCampaignSegmentIndex + 1;
    if (nextIndex >= this.campaignRuntime.segments.length) return false;
    const rowParityOffset = this.mission.data.rowParityOffset === 1 ? 1 : 0;
    const offset = axialToOffset(pos, rowParityOffset);
    return campaignSegmentForOffset(this.campaignRuntime, offset) === nextIndex;
  }

  private isCurrentCampaignSegmentTile(pos: Axial): boolean {
    if (!this.mission || !this.campaignRuntime) return true;
    const rowParityOffset = this.mission.data.rowParityOffset === 1 ? 1 : 0;
    const offset = axialToOffset(pos, rowParityOffset);
    return campaignSegmentForOffset(this.campaignRuntime, offset) === this.activeCampaignSegmentIndex;
  }

  private canMoveWithinCurrentCampaignSegment(pos: Axial): boolean {
    return this.isCurrentCampaignSegmentTile(pos);
  }

  private isEffectiveBattleTile(tile: Tile | undefined | null): boolean {
    return !!tile && !tile.displayOnly && this.isCurrentCampaignSegmentTile(tile.pos);
  }

  private canMoveToBattleTile(pos: Axial): boolean {
    if (!this.mission) return false;
    return this.isEffectiveBattleTile(this.mission.map.get(pos));
  }

  private resumeAfterMissionLoadedIfNeeded() {
    if (!GameSession.resumeFromSave) return;
    this.onLoad_Save(/* skipHint */ true);
    GameSession.clearResumeFlag();
  }

  private loadAndDraw(data: MissionData) {
    // PVP owns its protagonist/lineup through PvpSessionConfig. The main-menu
    // tank preference is deliberately a single-player-only override.
    if (!GameSession.isPvp) {
      data = missionWithSelectedPlayerTank(data, GameSession.selectedPlayerTankKind);
    }
    this.campaignAutoEvacActive = false;
    this.cancelPrecisionAimHold();
    this.infantryVisualFacing.clear();
    this.infantryVisualAngleOverride.clear();
    this.mainGunRecoils.clear();
    this.clearInfantryBloodDecals();
    this.clearTankTracks();
    this.clearTankEngineExhaust();
    this.missionId = data.id;
    this.rng = new RNG(this.rngSeed || undefined);
    this.mission = loadMission(data, this.rng);
    if (this.campaignUpgradesEnabled()) {
      applyCampaignUpgradesToSherman(this.mission.sherman, this.campaignUpgradeIds);
    }
    this.mapPanEnabled = this.campaignRuntime ? false : data.allowMapPan === true || data.cols > 8 || data.rows > 6;
    this.mapPanMoved = false;
    this.mapPanDistance = 0;
    const { sherman: sh0 } = this.mission;
    this.resetTurretFacingState();
    this.shermanSpawnQr = { q: sh0.pos.q, r: sh0.pos.r };
    this.shermanSpawnFacing = sh0.facing;
    const tiles = this.mission.map.all();
    const viewTiles = this.cameraReferenceTiles();

    // 计算地图像素包围盒，用于居中
    const center = this.tileBoundsCenter(viewTiles.length > 0 ? viewTiles : tiles) ?? { x: 0, y: 0 };
    this.offsetX = -center.x;
    // Cocos Y 朝上，但我们希望 row 0 在屏幕顶部 → Y 取负
    this.offsetY = center.y + BOARD_CENTER_OFFSET_Y;
    this.updateMapPanBounds(data);
    this.applyMapViewPosition(0, 0);

    // 初始化回合状态
    this.turn = 1;
    this.attackPositionMemory = createAttackPositionMemory();
    this.phase = 'player';
    this.playerStep = 'choose';
    this.movementDone = false;
    this.attackDone = false;
    this.miscDone = false;
    this.hatchChangedThisTurn = false;
    this.playerDiceRollAnim = null;
    this.playerDiceSortAnim = null;
    this.phaseDice = [];
    this.clearGunSelection();
    this.outcome = 'ongoing';
    this.pvpBattleStarted = false;
    this.pvpOutcomeSent = false;
    this.pvpCurrentParity = null;
    this.pvpLastSnapshotTurn = 0;
    this.pvpTurnDeadlineAt = 0;
    this.pvpTurnDurationMs = PVP_TURN_DEFAULT_MS;
    this.pvpTurnServerNowAt = 0;
    this.pvpTurnTimerReceivedAt = 0;
    this.pvpTurnTimeoutSubmitted = false;
    this.refreshPvpTurnTimer();
    this.pvpApplyingRemoteState = false;
    this.pvpLastSentUnitHash = '';
    this.pvpPendingRemoteSnapshots = [];
    this.transientFogRevealKeys.clear();
    this.fogVisionTransition = null;
    this.clearFloaters();
    this.clearMuzzleFlashes();
    this.clearMuzzleSmokes();
    this.clearProjectileTraces();
    this.clearHighExplosiveBlasts();
    this.clearMachineGunBursts();
    this.clearInfantryBulletVolleys();
    this.clearInfantryRocketTraces();
    this.clearSniperBulletTraces();
    this.clearDestroyedTurretVisuals();
    this.clearDestroyWreckVisuals();
    this.closeDiePopover();
    this.finalizeDiceShow(true);
    this.destroyTurnEndEventUI();
    this.destroyFireCheckEventUI();
    this.destroyUsCasualtyEventUI();
    this.closeTileInspectModal();
    this.turnEndUnitSeq = 0;
    if (GameSession.isPvp) this.prepareLocalPvpInitialView();
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
    const pvp = GameSession.pvpSession;
    if (pvp?.active) {
      this.refreshPhaseUI();
      this.updateHUD();
      this.battleLog('[PVP] waiting for both players to enter battle scene');
      PvpService.sendBattleEvent({
        kind: 'battle_ready',
        matchId: pvp.matchId,
        player: pvp.localPlayer.name,
        factionId: pvp.localPlayer.factionId,
        firstParity: pvp.firstParity,
        turn: this.turn,
        phase: this.phase,
      });
    } else {
      // 新战斗的第一个玩家回合也应经过与换回合相同的横幅提示。
      this.showTurnTransition(this.mission.sherman.faction, 'player', () => this.beginPlayerPhaseForNewTurn());
    }
  }

  private project(q: number, r: number) {
    const p = axialToPixel({ q, r }, this.hexSize);
    return { x: p.x + this.offsetX, y: -p.y + this.offsetY };
  }

  // ---------- 绘制 ----------

  private redraw() {
    if (!this.g || !this.mapOcclusionGraphics || !this.mapDeepShadowGraphics || !this.unitGraphics || !this.mission) return;
    this.refreshPlayerVisibility();
    this.redrawUnitVisibilityMask();
    const surfaceGraphics = this.g;
    const occlusionGraphics = this.mapOcclusionGraphics;
    const g = surfaceGraphics;
    surfaceGraphics.clear();
    occlusionGraphics.clear();
    this.mapDeepShadowGraphics.clear();
    this.unitGraphics.clear();
    this.terrainSpritePoolNext = 0;
    for (const { node } of this.terrainSpritePool) node.active = false;
    this.foliageSpritePoolNext = 0;
    for (const { node } of this.foliageSpritePool) node.active = false;
    this.enemyTopPoolNext = 0;
    this.engineVibrationVisuals.length = 0;
    for (const { node } of this.enemyTopSpritePool) node.active = false;
    this.commanderHatchPoolNext = 0;
    for (const { node } of this.commanderHatchSpritePool) node.active = false;
    if (this.shermanSpriteNode) this.shermanSpriteNode.active = false;
    if (this.shermanTurretSpriteNode) this.shermanTurretSpriteNode.active = false;
    this.infantryTopPoolNext = 0;
    for (const { node } of this.infantryTopSpritePool) node.active = false;
    this.officerTopPoolNext = 0;
    for (const { node } of this.officerTopSpritePool) node.active = false;
    this.suppressionMarkPoolNext = 0;
    for (const { node } of this.suppressionMarkPool) node.active = false;
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
        this.drawHexFill(c.x, c.y, this.hexSize, this.terrainColorFor('field'));
        this.drawFieldBrushOverlay(c.x, c.y, this.hexSize, t);
        continue;
      }
      if (t.terrain === 'airstrip') {
        this.drawHexFill(c.x, c.y, this.hexSize, TERRAIN_COLORS.clear);
        continue;
      }
      this.drawHexFill(c.x, c.y, this.hexSize, this.terrainColorFor(t.terrain));
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
      if (this.terrainSpriteFrameFor('mud')) continue;
      const c = this.project(t.pos.q, t.pos.r);
      this.drawMudOverlay(c.x, c.y, this.hexSize, t);
    }

    // 1-road-hex. 公路格纹理：在 road 基底色之上叠"软斑 + 路面碎屑颗粒"两层（与泥地同算法、不同色板）。
    // 让 road 格的非条带部分也有路面感，避免整片纯色像塑料。drawRoadOverlay 的方向条带叠在其上。
    for (const t of tiles) {
      if (t.terrain !== 'road') continue;
      if (this.terrainSpriteFrameFor('road')) continue;
      const c = this.project(t.pos.q, t.pos.r);
      this.drawRoadHexOverlay(c.x, c.y, this.hexSize, t);
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

    this.g = occlusionGraphics;
    // 1a. 林地表冠层：示意树木，绘制在血迹之上。
    for (const t of tiles) {
      if (t.terrain !== 'forest') continue;
      const c = this.project(t.pos.q, t.pos.r);
      this.drawForestCanopy(c.x, c.y, this.hexSize, t);
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
    this.g = surfaceGraphics;

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
        && isMainGunLoaded(this.mission.sherman, GameSession.gameMode === 'hardcore')
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
    this.drawActiveActingUnitFrame();
    this.redrawCampaignShadow();
    this.redrawDisplayOnlyShadow();
    this.drawEffectiveBattlefieldBoundary();

    // 5. 单位 —— 残骸先画，活动单位后画；同格时残骸不遮挡活动坦克。
    const units: Unit[] = [sherman, ...this.mission.allies, ...enemies];
    this.g = this.unitGraphics;
    for (const u of units) {
      if (u.destroyed) this.drawUnitMaybeAnim(u);
    }
    for (const u of units) {
      if (!u.destroyed) this.drawUnitMaybeAnim(u);
    }
    // Controlled AT guns are always rendered as a composite: gun sprite first,
    // then the three operator infantry sprites using the controlling faction's visuals.
    for (const u of units) {
      if (isControlledATGun(u)) this.drawATGunCrewMaybeAnim(u);
    }
    this.g = g;
    this.placeUnitEffectLayerAboveUnits();
    this.syncUnitEffects(0);
    this.drawUnitEffects();

    // 6. 单位状态：本回合击毁的「已毁」短标签 + 坦克矢量状态图标条
    this.clearStatusLabels();
    this.spawnStatusLabelIfAny(sherman);
    for (const a of this.mission.allies) this.spawnStatusLabelIfAny(a);
    for (const e of enemies) this.spawnStatusLabelIfAny(e);
    this.clearStatusBadges();
    this.spawnStatusBadgesIfAny(sherman);
    for (const a of this.mission.allies) this.spawnStatusBadgesIfAny(a);
    for (const e of enemies) this.spawnStatusBadgesIfAny(e);

    // 7. 单位名字常驻文字（"谢尔曼" / "虎式" …）。同格时按玩家、友方、敌方，
    //    各阵营内坦克（及其他非徒步单位）优先于步兵，逐行向下排列。
    this.clearNameLabels();
    this.spawnUnitNameLabels(units);

    // 8. 任务目标进度（击毁计数等）随地图状态变，与 redraw 同步以免 HUD 漏刷
    this.refreshObjectiveHud();

    // 9. 刷新独立的炮塔目标底层与战争迷雾；烟雾弹提示层随后置于迷雾之上。
    this.redrawFogOverlay();
    this.placeSmokeScreenEffectLayerAboveFog();
    this.maybeSendPvpActionResult();
  }

  private updateMapPanBounds(data: MissionData) {
    this.mapNode?.getComponent(UITransform)?.setContentSize(CANVAS_W, CANVAS_H);
    if (!this.mapPanEnabled || data.cols <= 0 || data.rows <= 0) {
      this.mapPanMinX = this.mapPanMaxX = 0;
      this.mapPanMinY = this.mapPanMaxY = 0;
      return;
    }

    const halfHexW = this.hexSize * Math.sqrt(3) / 2;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const rowParityOffset = data.rowParityOffset === 1 ? 1 : 0;
    // null 格不进入 HexMap，但仍是编辑器画布的一部分，用来控制游戏内可拖动边界。
    for (let row = 0; row < data.rows; row++) {
      for (let col = 0; col < data.cols; col++) {
        const pos = offsetToAxial({ col, row }, rowParityOffset);
        const center = this.project(pos.q, pos.r);
        minX = Math.min(minX, center.x - halfHexW);
        maxX = Math.max(maxX, center.x + halfHexW);
        minY = Math.min(minY, center.y - this.hexSize);
        maxY = Math.max(maxY, center.y + this.hexSize);
      }
    }

    const mapCenterX = (minX + maxX) / 2;
    const mapCenterY = (minY + maxY) / 2;
    this.mapNode?.getComponent(UITransform)?.setContentSize(
      Math.max(CANVAS_W, maxX - minX + Math.abs(mapCenterX) * 2),
      Math.max(CANVAS_H, maxY - minY + Math.abs(mapCenterY) * 2),
    );

    if (maxX - minX > CANVAS_W) {
      this.mapPanMinX = Math.min(0, CANVAS_W / 2 - maxX);
      this.mapPanMaxX = Math.max(0, -CANVAS_W / 2 - minX);
    } else {
      this.mapPanMinX = this.mapPanMaxX = 0;
    }
    if (maxY - minY > CANVAS_H) {
      this.mapPanMinY = Math.min(0, CANVAS_H / 2 - maxY);
      this.mapPanMaxY = Math.max(0, -CANVAS_H / 2 - minY);
    } else {
      this.mapPanMinY = this.mapPanMaxY = 0;
    }
  }

  private applyMapViewPosition(x: number, y: number) {
    const clampedX = this.campaignRuntime ? x : Math.max(this.mapPanMinX, Math.min(this.mapPanMaxX, x));
    const clampedY = this.campaignRuntime ? y : Math.max(this.mapPanMinY, Math.min(this.mapPanMaxY, y));
    this.terrainLayerNode?.setPosition(clampedX, clampedY, 0);
    this.mapNode?.setPosition(clampedX, clampedY, 0);
  }

  private campaignSegmentPanTarget(index: number): { x: number; y: number } {
    const segmentTiles = this.cameraReferenceTilesForSegment(index);
    const boundsCenter = this.tileBoundsCenter(segmentTiles);
    if (!boundsCenter) return { x: this.mapNode?.position.x ?? 0, y: this.mapNode?.position.y ?? 0 };
    const center = {
      x: boundsCenter.x + this.offsetX,
      y: -boundsCenter.y + this.offsetY,
    };
    const rawX = -center.x;
    const rawY = BOARD_CENTER_OFFSET_Y - center.y;
    if (this.campaignRuntime) return { x: rawX, y: rawY };
    const x = Math.max(this.mapPanMinX, Math.min(this.mapPanMaxX, rawX));
    const y = Math.max(this.mapPanMinY, Math.min(this.mapPanMaxY, rawY));
    return { x, y };
  }

  private applyCampaignSegmentView(index: number) {
    const target = this.campaignSegmentPanTarget(index);
    this.applyMapViewPosition(target.x, target.y);
  }

  private startCampaignPanToSegment(index: number) {
    const target = this.campaignSegmentPanTarget(index);
    const fromX = this.mapNode?.position.x ?? 0;
    const fromY = this.mapNode?.position.y ?? 0;
    this.campaignPanAnim = {
      fromX,
      fromY,
      toX: target.x,
      toY: target.y,
      t: 0,
      dur: 2,
      onDone: () => {
        this.campaignTransitionActive = false;
        this.campaignPanAnim = null;
        this.applyCampaignSegmentView(index);
        this.refreshPlayerVisibility();
        this.refreshPhaseUI();
        this.updateHUD();
        this.redraw();
        if (this.campaignUpgradesEnabled()) this.openCampaignUpgradeChoiceForCurrentSegment();
        else this.writeCampaignSegmentCheckpoint();
      },
    };
  }

  private advanceCampaignPanAnim(dt: number) {
    const anim = this.campaignPanAnim;
    if (!anim) return;
    anim.t += dt;
    const p = Math.min(1, anim.t / anim.dur);
    const eased = easeInOutCubic(p);
    this.applyMapViewPosition(
      anim.fromX + (anim.toX - anim.fromX) * eased,
      anim.fromY + (anim.toY - anim.fromY) * eased,
    );
    if (p >= 1) anim.onDone();
  }

  private onMapPanStart() {
    if (!this.mapPanEnabled) return;
    this.mapPanMoved = false;
    this.mapPanDistance = 0;
  }

  private onMapPanMove(event: EventTouch) {
    if (!this.mapPanEnabled || !this.mapNode) return;
    const delta = event.getDelta();
    const x = this.mapNode.position.x + delta.x;
    const y = this.mapNode.position.y + delta.y;
    this.applyMapViewPosition(x, y);
    this.mapPanDistance += Math.hypot(delta.x, delta.y);
    this.mapPanMoved = this.mapPanDistance > 6;
    event.propagationStopped = true;
  }

  private refreshPlayerVisibility() {
    this.visibleHexKeys.clear();
    if (!this.mission) return;
    if (!fogOfWarEnabled(GameSession.gameMode)) {
      for (const tile of this.mission.map.all()) {
        this.visibleHexKeys.add(HexMap.keyOf(tile.pos));
      }
    } else {
      this.visibleHexKeys = computePlayerVisibleHexes(
        this.mission.map,
        this.mission.sherman,
        this.mission.allies,
        getGameModeConfig(GameSession.gameMode).radioVisionSharing,
        this.currentWeather(),
        this.mission.smokeHexes,
      );
    }
    this.applyDestroyedFriendlyTankHexVisionDelay();
  }

  /**
   * Hardcore-only presentation rule: destroying an allied tank removes its
   * radio-shared sight immediately, but leaves the wreck's own hex visible for
   * one second. The normal visibility set is checked first, so a hex which is
   * still visible from another source never receives a transient reveal.
   */
  private applyDestroyedFriendlyTankHexVisionDelay() {
    if (!this.mission) return;

    const livingNow = new Map<string, string>();
    for (const ally of this.mission.allies) {
      if (ally.destroyed || !isTankUnit(ally)) continue;
      livingNow.set(ally.id, HexMap.keyOf(ally.pos));
    }

    if (this.visibilityTrackingMission !== this.mission) {
      this.visibilityTrackingMission = this.mission;
      this.livingFriendlyTankHexKeys = livingNow;
      this.destroyedFriendlyTankHexRevealExpiry.clear();
      return;
    }

    if (GameSession.gameMode === 'hardcore') {
      const now = Date.now();
      for (const [unitId, hexKey] of this.livingFriendlyTankHexKeys) {
        if (livingNow.has(unitId) || this.visibleHexKeys.has(hexKey)) continue;
        const expiry = now + 1000;
        this.destroyedFriendlyTankHexRevealExpiry.set(hexKey, expiry);
        this.scheduleOnce(() => {
          if (this.destroyedFriendlyTankHexRevealExpiry.get(hexKey) !== expiry) return;
          this.destroyedFriendlyTankHexRevealExpiry.delete(hexKey);
          this.redraw();
        }, 1);
      }
    }
    this.livingFriendlyTankHexKeys = livingNow;

    const now = Date.now();
    for (const [hexKey, expiry] of this.destroyedFriendlyTankHexRevealExpiry) {
      if (expiry <= now) {
        this.destroyedFriendlyTankHexRevealExpiry.delete(hexKey);
      } else if (!this.mission.smokeHexes.has(hexKey)) {
        this.visibleHexKeys.add(hexKey);
      }
    }
  }

  private isHexVisible(pos: Axial): boolean {
    if (!this.mission || !fogOfWarEnabled(GameSession.gameMode)) return true;
    const key = HexMap.keyOf(pos);
    // Smoke normally keeps its hex out of visibleHexKeys. If an intact-radio
    // ally occupies it, radio sharing deliberately adds that one hex back.
    const displayedHexKeys = this.fogVisionTransition?.displayedHexKeys ?? this.visibleHexKeys;
    return displayedHexKeys.has(key) || this.transientFogRevealKeys.has(key);
  }

  private displayedFogVisionSnapshot(): Set<string> {
    return new Set(this.fogVisionTransition?.displayedHexKeys ?? this.visibleHexKeys);
  }

  private startFogVisionTransition(
    before: ReadonlySet<string>,
    expanding: boolean,
    layerInterval: number,
  ): void {
    if (!this.mission || !fogOfWarEnabled(GameSession.gameMode)) {
      this.fogVisionTransition = null;
      return;
    }

    // Smoke rules take effect immediately. Only the displayed visibility set is
    // stepped through the changed distance rings to make the cloud feel gradual.
    this.refreshPlayerVisibility();
    const target = new Set(this.visibleHexKeys);
    const changed = expanding
      ? Array.from(target).filter(key => !before.has(key))
      : Array.from(before).filter(key => !target.has(key));
    if (changed.length === 0) {
      this.fogVisionTransition = null;
      return;
    }

    const origin = this.mission.sherman.pos;
    const byDistance = new Map<number, string[]>();
    for (const key of changed) {
      const pos = this.smokeHexPos(key);
      if (!pos) continue;
      const distance = hexDistance(origin, pos);
      const layer = byDistance.get(distance) ?? [];
      layer.push(key);
      byDistance.set(distance, layer);
    }
    const distances = Array.from(byDistance.keys()).sort((a, b) => expanding ? a - b : b - a);
    const displayedHexKeys = expanding
      ? new Set(Array.from(before).filter(key => target.has(key)))
      : new Set([...target, ...before]);
    const pendingLayers = distances.map(distance => byDistance.get(distance)!);
    this.fogVisionTransition = {
      displayedHexKeys,
      activeLayer: new Set(pendingLayers.shift() ?? []),
      pendingLayers,
      elapsed: 0,
      expanding,
      layerInterval,
    };
  }

  private advanceFogVisionTransition(dt: number): void {
    const transition = this.fogVisionTransition;
    if (!transition) return;
    transition.elapsed += dt;
    let crossedLayerBoundary = false;
    while (transition.elapsed >= transition.layerInterval) {
      transition.elapsed -= transition.layerInterval;
      for (const key of transition.activeLayer) {
        if (transition.expanding) transition.displayedHexKeys.add(key);
        else transition.displayedHexKeys.delete(key);
      }
      crossedLayerBoundary = true;
      const nextLayer = transition.pendingLayers.shift();
      if (!nextLayer) {
        this.fogVisionTransition = null;
        break;
      }
      transition.activeLayer = new Set(nextLayer);
    }
    // Only the fog layer needs per-frame work for the fade. A full redraw is
    // reserved for ring boundaries, when unit clipping/visibility also changes.
    if (crossedLayerBoundary) this.redraw();
    else this.redrawFogOverlay();
  }

  private fogOverlayAlpha(pos: Axial): number {
    if (this.transientFogRevealKeys.has(HexMap.keyOf(pos))) return 0;
    const transition = this.fogVisionTransition;
    const key = HexMap.keyOf(pos);
    if (transition?.activeLayer.has(key)) {
      const progress = Math.min(1, transition.elapsed / transition.layerInterval);
      return FOG_OVERLAY_COLOR.a * (transition.expanding ? 1 - progress : progress);
    }
    return this.isHexVisible(pos) ? 0 : FOG_OVERLAY_COLOR.a;
  }

  private isUnitVisible(unit: Unit): boolean {
    return unit === this.mission?.sherman || this.isHexVisible(unit.pos);
  }

  private isCommanderHatchOpen(): boolean {
    const sherman = this.mission?.sherman;
    return !!sherman && sherman.crew?.commander !== false && sherman.hatchOpen === true;
  }

  private fogTurretAimDirection(pos: Axial): FireDirection | null {
    if (!this.mission || !fogOfWarEnabled(GameSession.gameMode)) return null;
    if (this.isHexVisible(pos)) return null;
    const sherman = this.mission.sherman;
    if (hexDistance(sherman.pos, pos) > currentGunnerVisionRange(sherman)) return null;
    const direction = fireDirectionTo(sherman.pos, pos) ?? diagonalFlankFireDirectionTo(sherman.pos, pos);
    return direction !== null && this.canWeaponAimDirection(sherman, direction) ? direction : null;
  }

  private visibleTurretAimDirection(pos: Axial): FireDirection | null {
    if (!this.mission || !this.isHexVisible(pos)) return null;
    const sherman = this.mission.sherman;
    const direction = fireDirectionTo(sherman.pos, pos) ?? diagonalFlankFireDirectionTo(sherman.pos, pos);
    return direction !== null && this.canWeaponAimDirection(sherman, direction) ? direction : null;
  }

  private hasTurretReconGunSelection(): boolean {
    const gunDie = this.phaseDice[this.selectedGunDieIdx];
    const gunPartner = this.selectedGunDoublesIdx >= 0
      ? this.phaseDice[this.selectedGunDoublesIdx]
      : null;
    const gunSelectionActive = this.selectedGunDieIdx >= 0
      && !!gunDie
      && !gunDie.used
      && (this.selectedGunDoublesIdx < 0 || (!!gunPartner && !gunPartner.used));
    const mgDie = this.phaseDice[this.selectedMGDieIdx];
    const mgSelectionActive = this.selectedMGDieIdx >= 0
      && !!mgDie
      && !mgDie.used;
    return gunSelectionActive || mgSelectionActive;
  }

  /** Natural player vision only; transient firing reveals must not unlock detailed combat UI. */
  private isUnitOutsideFog(unit: Unit): boolean {
    if (unit === this.mission?.sherman || !fogOfWarEnabled(GameSession.gameMode)) return true;
    return this.visibleHexKeys.has(HexMap.keyOf(unit.pos));
  }

  private redrawCampaignShadow() {
    if (!this.mapDeepShadowGraphics || !this.mission || !this.campaignRuntime) return;
    const g = this.mapDeepShadowGraphics;
    g.fillColor = CAMPAIGN_SHADOW_COLOR;
    for (const tile of this.mission.map.all()) {
      if (this.isCampaignShadowTile(tile)) {
        const c = this.project(tile.pos.q, tile.pos.r);
        this.traceHexPathOn(g, c.x, c.y, this.hexSize);
        g.fill();
      }
    }
  }

  private isCampaignShadowTile(tile: Tile): boolean {
    if (!this.mission || !this.campaignRuntime) return false;
    const rowParityOffset = this.mission.data.rowParityOffset === 1 ? 1 : 0;
    const offset = axialToOffset(tile.pos, rowParityOffset);
    const segmentIndex = campaignSegmentForOffset(this.campaignRuntime, offset);
    return segmentIndex !== null && segmentIndex !== this.activeCampaignSegmentIndex;
  }

  private isDeepShadowTile(tile: Tile): boolean {
    return !!tile.displayOnly || this.isCampaignShadowTile(tile);
  }

  private redrawDisplayOnlyShadow() {
    if (!this.mapDeepShadowGraphics || !this.mission) return;
    const g = this.mapDeepShadowGraphics;
    g.fillColor = CAMPAIGN_SHADOW_COLOR;
    for (const tile of this.mission.map.all()) {
      if (!tile.displayOnly) continue;
      if (this.isCampaignShadowTile(tile)) continue;
      const c = this.project(tile.pos.q, tile.pos.r);
      this.traceHexPathOn(g, c.x, c.y, this.hexSize);
      g.fill();
    }
  }

  private drawEffectiveBattlefieldBoundary() {
    if (!this.g || !this.mission) return;
    const g = this.g;
    const previousLineCap = g.lineCap;
    // Each exposed edge is a separate sub-path. ROUND caps overlap at shared
    // vertices, preventing hairline gaps after the 1280 -> 1920 root scale.
    g.lineCap = Graphics.LineCap.ROUND;
    g.strokeColor = EFFECTIVE_BATTLEFIELD_BOUNDARY_COLOR;
    g.lineWidth = 4;
    for (const tile of this.mission.map.all()) {
      if (!this.isEffectiveBattleTile(tile)) continue;
      const c = this.project(tile.pos.q, tile.pos.r);
      for (let ax = 0; ax < 6; ax++) {
        const n = this.mission.map.get(neighbor(tile.pos, ax as Direction));
        if (this.isEffectiveBattleTile(n)) continue;
        this.drawBattlefieldBoundaryEdge(c.x, c.y, this.hexSize, ax as Direction);
      }
    }
    g.lineWidth = 2;
    g.lineCap = previousLineCap;
  }

  private drawBattlefieldBoundaryEdge(cx: number, cy: number, size: number, axialDir: Direction) {
    const g = this.g!;
    const edge = HEDGE_DRAW_EDGE_BY_AXIAL[axialDir];
    const a1 = (-30 + 60 * edge) * Math.PI / 180;
    const a2 = (-30 + 60 * (edge + 1)) * Math.PI / 180;
    g.moveTo(cx + size * Math.cos(a1), cy + size * Math.sin(a1));
    g.lineTo(cx + size * Math.cos(a2), cy + size * Math.sin(a2));
    g.stroke();
  }

  private redrawUnitVisibilityMask() {
    if (!this.mission) return;
    if (this.unitVisibilityMaskGraphics) this.redrawVisibleHexMask(this.unitVisibilityMaskGraphics, true);
    if (this.trackVisibilityMaskGraphics) this.redrawVisibleHexMask(this.trackVisibilityMaskGraphics);
  }

  private playerTankEvacVisibilityExtension(): Axial | null {
    if (!this.mission) return null;
    const playerTank = this.mission.playerTank ?? this.mission.sherman;
    let pos: Axial | null = null;
    if (this.anim?.evacExit && this.anim.unit === playerTank) {
      pos = { q: this.anim.toQ, r: this.anim.toR };
    } else if (this.mission.playerTankEvacuated || this.mission.shermanEvacuated) {
      pos = playerTank.pos;
    }
    // Campaign exits may lead to a real tile in the next segment. Its normal
    // visibility rules remain authoritative; only true off-map exits need an
    // extra stencil hex so the departing tank is not clipped away.
    return pos && !this.mission.map.has(pos) ? pos : null;
  }

  private redrawVisibleHexMask(mask: Graphics, includePlayerEvacExit = false) {
    if (!this.mission) return;
    mask.clear();
    mask.fillColor = new Color(255, 255, 255, 0);
    for (const tile of this.mission.map.all()) {
      if (!this.isHexVisible(tile.pos)) continue;
      const c = this.project(tile.pos.q, tile.pos.r);
      this.traceHexPathOn(mask, c.x, c.y, this.hexSize);
      mask.fill();
    }
    const evacExit = includePlayerEvacExit ? this.playerTankEvacVisibilityExtension() : null;
    if (evacExit) {
      const c = this.project(evacExit.q, evacExit.r);
      this.traceHexPathOn(mask, c.x, c.y, this.hexSize);
      mask.fill();
    }
  }

  private redrawFogOverlay() {
    const fog = this.fogGraphics;
    const fogNode = this.fogNode;
    if (!fog || !fogNode || !this.mission || !this.mapNode) return;
    fog.clear();
    const fogEnabled = fogOfWarEnabled(GameSession.gameMode);
    fogNode.active = fogEnabled;
    if (fogEnabled) {
      for (const tile of this.mission.map.all()) {
        if (this.isDeepShadowTile(tile)) continue;
        const fogAlpha = this.fogOverlayAlpha(tile.pos);
        if (fogAlpha <= 0) continue;
        fog.fillColor = new Color(
          FOG_OVERLAY_COLOR.r,
          FOG_OVERLAY_COLOR.g,
          FOG_OVERLAY_COLOR.b,
          Math.round(fogAlpha),
        );
        const c = this.project(tile.pos.q, tile.pos.r);
        this.traceHexPathOn(fog, c.x, c.y, this.hexSize);
        fog.fill();
      }
      fogNode.setSiblingIndex(this.mapNode.children.length - 1);
    }
    this.redrawTurretAimOverlay();
  }

  private redrawTurretAimOverlay() {
    const overlay = this.turretAimOverlayGraphics;
    const overlayNode = this.turretAimOverlayNode;
    if (!overlay || !overlayNode || !this.mission) return;
    overlay.clear();
    const precisionGunSelection = this.selectedGunDieIdx >= 0
      && this.selectedGunHitThresholdModifier < 0;
    const turretCanRotate = this.playerTurretCanRotate();
    const showTurretAimMarkers = this.hasTurretReconGunSelection()
      && (turretCanRotate || precisionGunSelection)
      && !this.turretAimAnim
      && !this.turretTargetOverlaySuppressed;
    overlayNode.active = showTurretAimMarkers;
    if (!showTurretAimMarkers) return;
    if (showTurretAimMarkers) {
      const legalWeaponTargetKeys = this.playerWeaponTargetHexKeys();
      const unloadedGunRotation = this.selectedGunDieIdx >= 0
        && !isMainGunLoaded(this.mission.sherman, GameSession.gameMode === 'hardcore');
      const originKey = HexMap.keyOf(this.mission.sherman.pos);
      const reachableKeys = new Set<string>();
      const reachableTiles: Tile[] = [];
      if (turretCanRotate || precisionGunSelection) {
        for (const tile of this.mission.map.all()) {
          if (this.isDeepShadowTile(tile)) continue;
          const tileKey = HexMap.keyOf(tile.pos);
          if (tileKey === originKey) continue;
          if (!precisionGunSelection) {
            const direction = this.isHexVisible(tile.pos)
              ? this.visibleTurretAimDirection(tile.pos)
              : this.fogTurretAimDirection(tile.pos);
            if (direction === null) continue;
          }
          if (precisionGunSelection && !legalWeaponTargetKeys.has(tileKey)) continue;
          const c = this.project(tile.pos.q, tile.pos.r);
          if (precisionGunSelection) {
            this.drawPrecisionTargetReticle(overlay, c.x, c.y);
            continue;
          }
          reachableKeys.add(tileKey);
          reachableTiles.push(tile);
          this.drawTurretAimHex(overlay, c.x, c.y);
        }
      }
      if (turretCanRotate) {
        const origin = this.project(this.mission.sherman.pos.q, this.mission.sherman.pos.r);
        const turretFacing = this.currentTurretFacingFor(
          this.mission.sherman,
          (this.mission.sherman.facing ?? 0) as FireDirection,
        );
        const turretAngle = this.directionScreenAngle(
          this.mission.sherman.pos,
          origin,
          turretFacing,
        );
        this.drawTurretTraverseAngleRing(
          overlay,
          origin.x,
          origin.y,
          turretAngle,
          this.mission.sherman.stats.turretTraverseSpeed,
        );
      }
      // The origin is not clickable, but belongs to the displayed area's interior so
      // blue range hexes do not draw a separating boundary against the player's tank.
      const boundaryInteriorKeys = new Set(reachableKeys);
      boundaryInteriorKeys.add(originKey);
      for (const tile of reachableTiles) {
        const c = this.project(tile.pos.q, tile.pos.r);
        for (let axialDir = 0; axialDir < 6; axialDir++) {
          const neighborTile = this.mission.map.get(neighbor(tile.pos, axialDir as Direction));
          if (!neighborTile || boundaryInteriorKeys.has(HexMap.keyOf(neighborTile.pos))) continue;
          this.drawTurretAimBoundaryEdge(overlay, c.x, c.y, axialDir as Direction);
        }
      }
    }
  }

  private playerWeaponTargetHexKeys(): Set<string> {
    const keys = new Set<string>();
    if (!this.mission) return keys;
    const { map, sherman, enemies } = this.mission;
    const expandedTurretDirections = getGameModeConfig(GameSession.gameMode).expandedTurretDirections;
    if (this.selectedMGDieIdx >= 0) {
      const units = this.allUnits();
      for (const target of enemies) {
        if (target.destroyed || !this.isUnitVisible(target)) continue;
        const machineGun = this.tankMachineGunSelection(sherman, target);
        if (GameSession.gameMode === 'hardcore' && !machineGun) continue;
        if (GameSession.gameMode !== 'hardcore'
          && !this.canTurretReachDirection(sherman, this.turretTargetDirection(sherman, target))) continue;
        if (canMGAttack({
          attacker: sherman,
          target,
          map,
          theater: this.mission.data.theater,
          units,
          smokeHexes: this.mission.smokeHexes,
          weather: this.currentWeather(),
          expandedTurretDirections: getGameModeConfig(GameSession.gameMode).expandedTurretDirections,
          atGunCrewTargets: GameSession.gameMode === 'hardcore',
          ...this.tankMachineGunContext(sherman, target, machineGun),
        }).ok) keys.add(HexMap.keyOf(target.pos));
      }
      return keys;
    }
    if (this.selectedGunDieIdx < 0 || !isMainGunLoaded(sherman, GameSession.gameMode === 'hardcore')) return keys;
    const shellType = GameSession.gameMode === 'hardcore'
      ? resolvedLoadedShell(sherman) : null;
    for (const target of this.playerMainGunHexTargets()) {
      if (target.destroyed || !this.isUnitVisible(target)) continue;
      if (isFootUnit(target)
        && !isMainGunSuppressionAttack(sherman, target, GameSession.gameMode === 'hardcore', shellType)) continue;
      if (!this.canTurretReachDirection(sherman, this.turretTargetDirection(sherman, target))) continue;
      if (canAttack({
        attacker: sherman,
        target,
        map,
        theater: this.mission.data.theater,
        smokeHexes: this.mission.smokeHexes,
        weather: this.currentWeather(),
        hitThresholdModifier: this.campaignMainGunHitThresholdModifier()
          + ambushHitThresholdModifier(sherman, GameSession.gameMode),
        hitThresholdModifiers: this.playerMainGunHitThresholdModifierDetails(),
        expandedTurretDirections,
        mainGunSuppressesInfantry: GameSession.gameMode === 'hardcore',
        shellType: shellType ?? undefined,
        hardcoreHeavyArtilleryRules: GameSession.gameMode === 'hardcore',
        precisionFire: this.selectedGunHitThresholdModifier < 0,
      }).ok) keys.add(HexMap.keyOf(target.pos));
    }
    return keys;
  }

  private drawTurretAimHex(g: Graphics, cx: number, cy: number) {
    g.fillColor = TURRET_AIM_HEX_FILL;
    this.traceHexPathOn(g, cx, cy, this.hexSize * 0.96);
    g.fill();
  }

  private drawPrecisionTargetReticle(g: Graphics, cx: number, cy: number) {
    const radius = this.hexSize * 0.74;
    const tickOuter = radius * 1.06;
    const tickInner = radius * 0.70;
    g.strokeColor = PRECISION_TARGET_RETICLE_COLOR;
    g.fillColor = PRECISION_TARGET_RETICLE_COLOR;
    g.lineWidth = 5;
    g.circle(cx, cy, radius);
    g.stroke();
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      g.moveTo(cx + ux * tickOuter, cy + uy * tickOuter);
      g.lineTo(cx + ux * tickInner, cy + uy * tickInner);
      g.stroke();
    }
    g.circle(cx, cy, Math.max(3, this.hexSize * 0.055));
    g.fill();
  }

  private drawTurretTraverseAngleRing(
    g: Graphics,
    cx: number,
    cy: number,
    turretAngle: number,
    configuredSpeed: number,
  ) {
    const radius = this.hexSize * 0.90;
    const speed = Math.min(6, Math.max(0, Math.trunc(configuredSpeed)));
    g.lineWidth = 6;
    g.strokeColor = TURRET_TRAVERSE_BLOCKED_ARC_COLOR;
    g.circle(cx, cy, radius);
    g.stroke();
    if (speed <= 0) return;
    g.strokeColor = TURRET_TRAVERSE_REACHABLE_ARC_COLOR;
    if (speed >= 6) {
      g.circle(cx, cy, radius);
      g.stroke();
      return;
    }
    const halfSpan = speed * Math.PI / 6;
    this.strokeTurretTraverseArc(g, cx, cy, radius, turretAngle - halfSpan, turretAngle + halfSpan);
  }

  private strokeTurretTraverseArc(
    g: Graphics,
    cx: number,
    cy: number,
    radius: number,
    startAngle: number,
    endAngle: number,
  ) {
    const segments = Math.max(8, Math.ceil(Math.abs(endAngle - startAngle) / (Math.PI / 36)));
    g.moveTo(cx + radius * Math.cos(startAngle), cy + radius * Math.sin(startAngle));
    for (let i = 1; i <= segments; i++) {
      const angle = startAngle + (endAngle - startAngle) * i / segments;
      g.lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
    }
    g.stroke();
  }

  private drawTurretAimBoundaryEdge(g: Graphics, cx: number, cy: number, axialDir: Direction) {
    const edge = HEDGE_DRAW_EDGE_BY_AXIAL[axialDir];
    const a1 = (-30 + 60 * edge) * Math.PI / 180;
    const a2 = (-30 + 60 * (edge + 1)) * Math.PI / 180;
    g.strokeColor = TURRET_AIM_BOUNDARY_COLOR;
    g.lineWidth = 5;
    g.moveTo(cx + this.hexSize * Math.cos(a1), cy + this.hexSize * Math.sin(a1));
    g.lineTo(cx + this.hexSize * Math.cos(a2), cy + this.hexSize * Math.sin(a2));
    g.stroke();
  }

  private drawAttackableHighlights() {
    if (!this.g || !this.mission) return;
    const { map, sherman } = this.mission;
    const shellType = GameSession.gameMode === 'hardcore'
      ? resolvedLoadedShell(sherman) : null;
    for (const e of this.playerMainGunHexTargets()) {
      if (e.destroyed) continue;
      if (!this.isUnitVisible(e)) continue;
      // 主炮不瞄徒步类（步兵 / 军官）：徒步单位专属机枪（§3.1.2 / §3.6），避免大红圈误导
      if (isFootUnit(e) && !isMainGunSuppressionAttack(sherman, e, GameSession.gameMode === 'hardcore', shellType)) continue;
      const ctx = {
        attacker: sherman,
        target: e,
        map,
        units: this.allUnits(),
        theater: this.mission.data.theater,
        smokeHexes: this.mission.smokeHexes,
        weather: this.currentWeather(),
        hitThresholdModifier: this.campaignMainGunHitThresholdModifier()
          + ambushHitThresholdModifier(sherman, GameSession.gameMode),
        hitThresholdModifiers: this.playerMainGunHitThresholdModifierDetails(),
        expandedTurretDirections: getGameModeConfig(GameSession.gameMode).expandedTurretDirections,
        mainGunSuppressesInfantry: GameSession.gameMode === 'hardcore',
        shellType: shellType ?? undefined,
        hardcoreHeavyArtilleryRules: GameSession.gameMode === 'hardcore',
        precisionFire: this.selectedGunHitThresholdModifier < 0,
      };
      if (!this.canTurretReachDirection(sherman, this.turretTargetDirection(sherman, e))) continue;
      if (!canAttack(ctx).ok) continue;

      const c = this.project(e.pos.q, e.pos.r);
      if (shellType === 'he' && isFootUnit(e)) {
        const destroyNeed = 12 + infantryHighExplosiveCoverValue(ctx)
          - (sherman.stats.highExplosivePower ?? 0);
        const destroyProbability = probHit2d6(destroyNeed);
        this.spawnPreviewLabel(c.x, c.y - this.hexSize * 0.28, destroyNeed, destroyProbability);
        continue;
      }
      const need = hitThreshold(ctx);
      this.spawnPreviewLabel(c.x, c.y - this.hexSize * 0.28, need);
    }
  }

  /**
   * 机枪目标高亮：与 drawAttackableHighlights 并列。
   * 绿色格罩由战争迷雾覆盖层统一绘制；这里仅在合法目标上方标动态命中需求与 1d6 概率。
   */
  private drawMGTargetHighlights() {
    if (!this.g || !this.mission) return;
    const { map, sherman, enemies } = this.mission;
    const units = this.allUnits();
    for (const e of enemies) {
      if (e.destroyed) continue;
      if (!this.isUnitVisible(e)) continue;
      const machineGun = this.tankMachineGunSelection(sherman, e);
      const ctx = { attacker: sherman, target: e, map, theater: this.mission.data.theater, units, smokeHexes: this.mission.smokeHexes, weather: this.currentWeather(), expandedTurretDirections: getGameModeConfig(GameSession.gameMode).expandedTurretDirections, atGunCrewTargets: GameSession.gameMode === 'hardcore', ...this.tankMachineGunContext(sherman, e, machineGun) };
      if (GameSession.gameMode === 'hardcore' && !machineGun) continue;
      if (GameSession.gameMode !== 'hardcore'
        && !this.canTurretReachDirection(sherman, this.turretTargetDirection(sherman, e))) continue;
      if (!canMGAttack(ctx).ok) continue;

      const c = this.project(e.pos.q, e.pos.r);
      const maxRoll = maxMGHitRoll(ctx);
      const need = mgHitThreshold(ctx);
      const prob = maxRoll <= 7
        ? Math.max(0, Math.min(1, (maxRoll + 1 - need) / 6))
        : undefined;
      this.spawnPreviewLabel(c.x, c.y - this.hexSize * 0.28, need, prob);
    }
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
    if (GameSession.isPvp) return;
    const obj = this.mission.data.objective;
    if (obj.type !== 'destroy_kind_evac' || !obj.evacAt || obj.evacExitDir === undefined) return;

    const g = this.g;
    const evac = offsetToAxial(obj.evacAt, this.mission.data.rowParityOffset === 1 ? 1 : 0);
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
      if (!this.isUnitVisible(u)) continue;
      const c = this.project(u.pos.q, u.pos.r);
      g.strokeColor = OFFICER_TILE_STROKE;
      g.lineWidth = 3;
      this.drawHexOutline(c.x, c.y, this.hexSize - 2);
      drewAny = true;
    }
    if (drewAny) g.lineWidth = 2;
  }

  private setActiveActingUnit(unit: Unit | null) {
    this.activeActingUnit = unit && !unit.destroyed ? unit : null;
    this.syncActiveActingUnitFrame();
  }

  private clearActiveActingUnit(unit?: Unit | null) {
    if (unit && this.activeActingUnit !== unit) return;
    this.activeActingUnit = null;
    this.destroyActiveActingUnitFrame();
  }

  private activeActingUnitFrameColor(unit: Unit): Color {
    if (unit === this.mission?.sherman) return ACTIVE_UNIT_PLAYER_FRAME;
    if (unit.sideId === 'player') return ACTIVE_UNIT_ALLIED_FRAME;
    return ACTIVE_UNIT_ENEMY_FRAME;
  }

  private activeActingUnitIsFoot(unit: Unit): boolean {
    return isFootUnit(unit);
  }

  private drawActiveActingUnitFrame() {
    this.syncActiveActingUnitFrame();
  }

  private destroyActiveActingUnitFrame() {
    if (this.activeActingFrameNode?.isValid) {
      this.activeActingFrameNode.destroy();
    }
    this.activeActingFrameNode = null;
    this.activeActingFrameGraphics = null;
  }

  private ensureActiveActingUnitFrame(): Graphics | null {
    if (!this.mapNode) return null;
    if (this.activeActingFrameNode?.isValid && this.activeActingFrameGraphics) {
      return this.activeActingFrameGraphics;
    }
    const n = new Node('ActiveActingUnitFrame');
    n.layer = this.node.layer;
    n.addComponent(UITransform).setContentSize(this.hexSize * 2.4, this.hexSize * 2.4);
    const g = n.addComponent(Graphics);
    this.mapNode.addChild(n);
    this.activeActingFrameNode = n;
    this.activeActingFrameGraphics = g;
    return g;
  }

  private syncActiveActingUnitFrame() {
    if (!this.activeActingUnit || this.activeActingUnit.destroyed || !this.isUnitVisible(this.activeActingUnit)) {
      this.destroyActiveActingUnitFrame();
      return;
    }
    const g = this.ensureActiveActingUnitFrame();
    const n = this.activeActingFrameNode;
    if (!g || !n || !this.mapNode) return;
    const unit = this.activeActingUnit;
    const c = (this.anim && this.anim.unit === unit)
      ? this.interpolatedPos(unit)
      : this.project(unit.pos.q, unit.pos.r);
    n.setPosition(c.x, c.y, 0);
    n.setSiblingIndex(0);
    g.clear();
    const isFootUnit = this.activeActingUnitIsFoot(unit);
    const base = this.activeActingUnitFrameColor(unit);
    const size = this.hexSize - 1;
    g.strokeColor = new Color(base.r, base.g, base.b, 220);
    g.lineWidth = 4;
    if (isFootUnit) {
      // 六个角各自连成实线；缺口位于每条边的正中，而非六角顶点。
      this.drawHexCornerBracketsOn(g, 0, 0, size, 0.36);
    } else {
      this.drawHexOutlineOn(g, 0, 0, size);
    }
    // 步兵使用单层纯色角标，避免内侧暗线让分段框显得未对齐。
    if (isFootUnit) return;
    g.strokeColor = new Color(0, 0, 0, 120);
    g.lineWidth = 1.25;
    this.drawHexOutlineOn(g, 0, 0, size - 3);
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

    let n = this.previewLabels[this.previewLabelNext++];
    let l = n?.getComponent(Label) ?? null;
    if (!n || !l) {
      n = new Node('AttackPreview');
      n.layer = this.node.layer;
      const ut = n.addComponent(UITransform);
      ut.setContentSize(86, 24);
      ut.setAnchorPoint(0.5, 0.5);

      l = n.addComponent(Label);
      l.lineHeight = 20;
      l.horizontalAlign = HorizontalTextAlignment.CENTER;
      l.verticalAlign = VerticalTextAlignment.CENTER;
      l.enableOutline = true;
      l.outlineColor = PREVIEW_OUTLINE;
      l.outlineWidth = 2;
      this.previewLabels[this.previewLabelNext - 1] = n;
      this.mapNode.addChild(n);
    } else if (n.parent !== this.mapNode) {
      this.mapNode.addChild(n);
    }

    l.fontSize = 17;
    l.color = color;
    if (prob <= 0) {
      l.string = t('preview.impossible', { n: need });
      l.fontSize = 13;
    } else {
      l.string = `≥${need} ${Math.round(prob * 100)}%`;
    }

    // 加描边让字在任何底色上都清晰
    n.setPosition(x, y, 0);
    n.active = true;
  }

  private clearPreviewLabels() {
    this.previewLabelNext = 0;
    for (const n of this.previewLabels) n.active = false;
  }

  // ---------- 单位状态常驻文字 ----------

  /** Visual-only smoke level: real fire uses fireLevel; damaged non-player tanks show level-2 black smoke. */
  private damageSmokeLevel(u: Unit): number {
    return visualDamageSmokeLevel(u, this.mission?.sherman.id);
  }

  /** Newly destroyed tanks burn at level 1 until the next turn starts. */
  private fireEffectLevel(u: Unit): number {
    return visualFireEffectLevel(
      u,
      this.mission?.sherman.id,
      this.destroyWreckVisualIds.has(u.id),
    );
  }

  /** 给本回合刚毁的单位在格子下方挂「已毁」短文字；下回合起不再生成。 */
  private spawnStatusLabelIfAny(u: Unit) {
    if (!this.mapNode) return;
    if (!this.isUnitVisible(u)) return;
    if (!this.shouldShowDestroyWreckVisual(u)) return;
    if (!isFootUnit(u) && isDestroyedTopKind(u.kind)) return;
    const c = (this.anim && this.anim.unit === u)
      ? this.interpolatedPos(u)
      : this.project(u.pos.q, u.pos.r);
    const text = t('unit.status.destroyed');
    const color = STATUS_TEXT_DEAD;

    let n = this.statusLabels[this.statusLabelNext++];
    let l = n?.getComponent(Label) ?? null;
    if (!n || !l) {
      n = new Node('StatusLabel');
      n.layer = this.node.layer;
      const ut = n.addComponent(UITransform);
      ut.setContentSize(80, 24);
      ut.setAnchorPoint(0.5, 0.5);

      l = n.addComponent(Label);
      l.fontSize = 18;
      l.lineHeight = 20;
      l.horizontalAlign = HorizontalTextAlignment.CENTER;
      l.verticalAlign = VerticalTextAlignment.CENTER;
      l.enableOutline = true;
      l.outlineColor = STATUS_TEXT_OUT;
      l.outlineWidth = 2;
      this.statusLabels[this.statusLabelNext - 1] = n;
      this.mapNode.addChild(n);
    } else if (n.parent !== this.mapNode) {
      this.mapNode.addChild(n);
    }

    l.color = color;
    l.string = text;
    n.setPosition(c.x, c.y - this.hexSize * 0.65, 0);
    n.active = true;
  }

  private clearStatusLabels() {
    this.statusLabelNext = 0;
    for (const n of this.statusLabels) n.active = false;
  }

  private clearStatusBadges() {
    this.statusBadgeNext = 0;
    for (const n of this.statusBadgeNodes) n.active = false;
  }

  /** 收集仍需独立图标表达的坦克状态（固定顺序）。 */
  private collectTankStatusBadgeKinds(u: Unit): TankStatusBadgeKind[] {
    // 徒步类（步兵 / 军官）没有装甲 / 装填等坦克状态，跳过坦克 badge 列。
    if (isFootUnit(u) || u.destroyed) return [];
    const out: TankStatusBadgeKind[] = [];
    if (u.paralyzed) out.push('paralyzed');
    if (u.turretDamaged) out.push('turret');
    return out;
  }

  /** 在格心略下方绘制一排小方标（矢量），不遮挡俯视车体 */
  private spawnStatusBadgesIfAny(u: Unit) {
    if (!this.mapNode) return;
    if (!this.isUnitVisible(u)) return;
    const kinds = this.collectTankStatusBadgeKinds(u);
    if (kinds.length === 0) return;

    const c = (this.anim && this.anim.unit === u)
      ? this.interpolatedPos(u)
      : this.project(u.pos.q, u.pos.r);
    const rowY = c.y - this.hexSize * 0.56;
    const cell = TANK_BADGE_CELL;
    const gap = TANK_BADGE_GAP;
    const totalW = kinds.length * cell + (kinds.length - 1) * gap;

    let n = this.statusBadgeNodes[this.statusBadgeNext++];
    let ut = n?.getComponent(UITransform) ?? null;
    let g = n?.getComponent(Graphics) ?? null;
    if (!n || !ut || !g) {
      n = new Node('TankStatusBadges');
      n.layer = this.node.layer;
      ut = n.addComponent(UITransform);
      g = n.addComponent(Graphics);
      ut.setAnchorPoint(0.5, 0.5);
      this.statusBadgeNodes[this.statusBadgeNext - 1] = n;
      this.mapNode.addChild(n);
    } else if (n.parent !== this.mapNode) {
      this.mapNode.addChild(n);
    }
    ut.setContentSize(totalW + 4, cell + 6);
    n.setPosition(c.x, rowY, 0);

    g.clear();
    let x = -totalW / 2 + cell / 2;
    for (const kind of kinds) {
      this.drawTankStatusBadge(g, kind, x, 0, cell * 0.5);
      x += cell + gap;
    }

    n.active = true;
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
  private spawnUnitNameLabels(units: Unit[]) {
    const priority = (u: Unit): number => {
      const side = u === this.mission?.sherman ? 0 : u.sideId === 'player' ? 1 : 2;
      const unitType = isFootUnit(u) ? 1 : 0;
      return side * 2 + unitType;
    };
    const ordered = units
      .map((unit, index) => ({ unit, index }))
      .sort((a, b) => priority(a.unit) - priority(b.unit) || a.index - b.index);
    const rowsByTile = new Map<string, number>();

    for (const { unit } of ordered) {
      const tileKey = HexMap.keyOf(unit.pos);
      const row = rowsByTile.get(tileKey) ?? 0;
      if (this.spawnUnitNameLabel(unit, row)) rowsByTile.set(tileKey, row + 1);
    }
  }

  /** 生成单个名称；返回是否实际显示，以免隐藏单位占用同格名称行。 */
  private spawnUnitNameLabel(u: Unit, row: number): boolean {
    if (!this.mapNode) return false;
    if (isAttachedATGunCrew(u) || isAbandonedATGun(u)) return false;
    if (!this.isUnitVisible(u)) return false;
    if (u.destroyed && !this.shouldShowDestroyWreckVisual(u)) return false;
    if (u.destroyed && this.hasLiveUnitOnSameTile(u)) return false;
    const c = (this.anim && this.anim.unit === u)
      ? this.interpolatedPos(u)
      : this.project(u.pos.q, u.pos.r);

    let n = this.nameLabels[this.nameLabelNext++];
    let l = n?.getComponent(Label) ?? null;
    if (!n || !l) {
      n = new Node('UnitNameLabel');
      n.layer = this.node.layer;
      const ut = n.addComponent(UITransform);
      ut.setContentSize(96, 22);
      ut.setAnchorPoint(0.5, 0.5);

      l = n.addComponent(Label);
      l.fontSize = 16;
      l.lineHeight = 18;
      l.horizontalAlign = HorizontalTextAlignment.CENTER;
      l.verticalAlign = VerticalTextAlignment.CENTER;
      l.enableOutline = true;
      l.outlineColor = UNIT_NAME_OUTLINE;
      l.outlineWidth = 2;
      this.nameLabels[this.nameLabelNext - 1] = n;
      this.mapNode.addChild(n);
    } else if (n.parent !== this.mapNode) {
      this.mapNode.addChild(n);
    }
    l.color = u.destroyed
      ? UNIT_NAME_TEXT_DEAD
      : u === this.mission?.sherman
        ? UNIT_NAME_TEXT_PLAYER
        : (u.sideId === 'player' ? UNIT_NAME_TEXT_ALLIED : UNIT_NAME_TEXT_GERMAN);
    const isPvpAiUnit = GameSession.isPvp && u !== this.mission?.sherman && u !== this.pvpOpponentProtagonist();
    const isPvpOpponentHero = GameSession.isPvp && u === this.pvpOpponentProtagonist();
    l.string = `${t(`unit.name.${u.kind}`)}${isPvpOpponentHero ? ' 主角' : isPvpAiUnit ? ' AI' : ''}`;
    this.drawUnitRankMarker(n, l.string, unitLevelOf(u));
    // 叠放：车体 → 状态图标条(hex*0.56) → 已毁字(hex*0.65) → 名字（UNIT_NAME_OFFSET_HEX×hex）
    n.setPosition(c.x, c.y - this.hexSize * UNIT_NAME_OFFSET_HEX - row * UNIT_NAME_ROW_GAP, 0);
    n.active = true;
    return true;
  }

  /** 在单位名称左侧绘制高对比倒 V 军衔杠：老兵 1 道，王牌 3 道。 */
  private drawUnitRankMarker(
    nameNode: Node,
    displayName: string,
    level: 'recruit' | 'veteran' | 'elite',
  ) {
    let marker = nameNode.getChildByName('UnitRankMarker');
    if (!marker) {
      marker = new Node('UnitRankMarker');
      marker.layer = this.node.layer;
      marker.addComponent(UITransform).setContentSize(16, 16);
      marker.addComponent(Graphics);
      nameNode.addChild(marker);
    }
    const g = marker.getComponent(Graphics)!;
    g.clear();
    marker.active = level !== 'recruit';
    if (!marker.active) return;

    // 中文按全角、英文按半角估算名字宽度，使图标紧贴名称左侧。
    const estimatedTextWidth = Array.from(displayName).reduce(
      (sum, ch) => sum + (/^[\x00-\x7F]$/.test(ch) ? 8 : 16),
      0,
    );
    // Label 字形的视觉中心略低于节点几何中心；标志下移 2 px 与文字中线对齐。
    marker.setPosition(-Math.min(80, estimatedTextWidth) * 0.5 - 10, -2, 0);

    const drawChevron = (cy: number) => {
      const fillChevron = (centerX: number, centerY: number, halfWidth: number, color: Color) => {
        const innerHalfWidth = halfWidth * 0.6;
        g.fillColor = color;
        g.moveTo(centerX - halfWidth, centerY - 2);
        g.lineTo(centerX, centerY + 3);
        g.lineTo(centerX + halfWidth, centerY - 2);
        g.lineTo(centerX + innerHalfWidth, centerY - 2);
        g.lineTo(centerX, centerY + 1);
        g.lineTo(centerX - innerHalfWidth, centerY - 2);
        g.close();
        g.fill();
      };

      // 黑色底与金色倒 V 同尺寸，仅向下偏移 1 px，形成垂直投影。
      fillChevron(0, cy - 1, 5, UNIT_RANK_OUTLINE);
      fillChevron(0, cy, 5, UNIT_RANK_GOLD);
    };

    if (level === 'veteran') {
      drawChevron(2);
    } else {
      drawChevron(6);
      drawChevron(2);
      drawChevron(-2);
    }
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

  private hasSmokeAt(pos: Axial): boolean {
    return this.mission?.smokeHexes.has(HexMap.keyOf(pos)) ?? false;
  }

  private deploySmokeAt(pos: Axial, owner: 'friendly' | 'enemy', animateVision = false): void {
    if (!this.mission) return;
    const before = animateVision ? this.displayedFogVisionSnapshot() : null;
    const key = HexMap.keyOf(pos);
    this.mission.smokeHexes.add(key);
    this.mission.smokeHexOwners.set(key, owner);
    if (!this.smokeScreenAges.has(key)) this.smokeScreenAges.set(key, 0);
    if (before) this.startFogVisionTransition(before, false, SMOKE_VISION_LAYER_INTERVAL);
  }

  private clearSmokeAt(pos: Axial): boolean {
    if (!this.mission) return false;
    const key = HexMap.keyOf(pos);
    this.smokeScreenAges.delete(key);
    this.mission.smokeHexOwners.delete(key);
    return this.mission.smokeHexes.delete(key);
  }

  private clearSmokeByOwner(owner: 'friendly' | 'enemy', animateVision = false): Axial[] {
    if (!this.mission) return [];
    const before = animateVision ? this.displayedFogVisionSnapshot() : null;
    const cleared: Axial[] = [];
    for (const [key, side] of Array.from(this.mission.smokeHexOwners)) {
      if (side !== owner) continue;
      const pos = this.smokeHexPos(key);
      if (!pos) continue;
      if (this.clearSmokeAt(pos)) cleared.push(pos);
    }
    if (before && cleared.length > 0) {
      this.startFogVisionTransition(before, true, SMOKE_VISION_LAYER_INTERVAL);
    }
    return cleared;
  }

  private smokeHexPos(key: string): Axial | null {
    const [qRaw, rRaw] = key.split(',');
    const q = Number(qRaw);
    const r = Number(rRaw);
    if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
    return { q, r };
  }

  private consumeLegacyUnitSmoke(): void {
    if (!this.mission) return;
    for (const unit of [this.mission.sherman, ...this.mission.allies]) {
      if (unit.smoked) {
        this.deploySmokeAt(unit.pos, 'friendly');
        unit.smoked = false;
      }
    }
    for (const unit of this.mission.enemies) {
      if (unit.smoked) {
        this.deploySmokeAt(unit.pos, 'enemy', true);
        unit.smoked = false;
      }
    }
  }

  private clearNameLabels() {
    this.nameLabelNext = 0;
    for (const n of this.nameLabels) n.active = false;
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

  private advanceUnitEffects(dt: number) {
    this.unitEffectTime += dt;
    this.advanceDestroyedTurretVisuals(dt);
    this.syncUnitEffects(dt);
    this.drawUnitEffects();
    this.drawWeatherEffects();
  }

  private syncUnitEffects(dt: number) {
    if (!this.mission) {
      this.unitEffectVisuals.clear();
      this.smokeScreenAges.clear();
      this.unitEffectGraphics?.clear();
      this.smokeScreenEffectGraphics?.clear();
      return;
    }
    this.consumeLegacyUnitSmoke();

    const liveIds = new Set<string>();
    for (const unit of this.allUnits()) {
      liveIds.add(unit.id);
      const fireTarget = this.fireEffectLevel(unit) > 0 ? 1 : 0;
      const smokeTarget = 0;
      let v = this.unitEffectVisuals.get(unit.id);
      if (!v && (fireTarget > 0 || smokeTarget > 0)) {
        v = {
          unit,
          seed: this.hashStringToSeed(unit.id),
          fireAlpha: 0,
          smokeAlpha: 0,
          smokeAge: 0,
        };
        this.unitEffectVisuals.set(unit.id, v);
      }
      if (!v) continue;
      v.unit = unit;
      v.fireAlpha = this.approachEffectAlpha(v.fireAlpha, fireTarget, dt / (fireTarget ? 0.35 : 0.25));
      v.smokeAlpha = this.approachEffectAlpha(v.smokeAlpha, smokeTarget, dt / (smokeTarget ? 0.55 : 0.70));
    }

    for (const [id, v] of this.unitEffectVisuals) {
      if (!liveIds.has(id)) {
        this.unitEffectVisuals.delete(id);
        continue;
      }
      if (v.fireAlpha <= 0 && v.smokeAlpha <= 0
          && this.fireEffectLevel(v.unit) <= 0) {
        this.unitEffectVisuals.delete(id);
      }
    }

    for (const key of this.mission.smokeHexes) {
      this.smokeScreenAges.set(key, (this.smokeScreenAges.get(key) ?? 0) + dt);
    }
    for (const key of Array.from(this.smokeScreenAges.keys())) {
      if (!this.mission.smokeHexes.has(key)) this.smokeScreenAges.delete(key);
    }
  }

  private approachEffectAlpha(value: number, target: number, step: number): number {
    if (value < target) return Math.min(target, value + step);
    if (value > target) return Math.max(target, value - step);
    return value;
  }

  private drawUnitEffects() {
    const g = this.unitEffectGraphics;
    if (!g) return;
    g.clear();
    for (const v of this.unitEffectVisuals.values()) {
      if (!this.isUnitVisible(v.unit)) continue;
      const c = this.interpolatedPos(v.unit);
      if (v.fireAlpha > 0) this.drawFireEffect(g, c.x, c.y, v);
      if (v.smokeAlpha > 0) this.drawSmokeScreenEffect(g, c.x, c.y, v);
    }
    const smokeScreenGraphics = this.smokeScreenEffectGraphics;
    if (!smokeScreenGraphics) return;
    smokeScreenGraphics.clear();
    this.drawSmokeScreenEffects(smokeScreenGraphics);
    this.placeSmokeScreenEffectLayerAboveFog();
  }

  private drawSmokeScreenEffects(g: Graphics) {
    if (!this.mission) return;
    for (const key of this.mission.smokeHexes) {
      const pos = this.smokeHexPos(key);
      if (!pos) continue;
      const c = this.project(pos.q, pos.r);
      this.drawSmokeScreenEffect(g, c.x, c.y, {
        seed: this.hashStringToSeed(`smoke:${key}`),
        smokeAlpha: 1,
        smokeAge: this.smokeScreenAges.get(key) ?? 0,
      });
    }
  }

  private buildWeatherEffectLayer() {
    if (this.weatherEffectNode) return;
    const node = new Node('WeatherEffectLayer');
    node.layer = this.node.layer;
    node.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    node.setPosition(0, 0, 0);
    node.active = false;
    this.weatherEffectGraphics = node.addComponent(Graphics);
    this.node.addChild(node);
    this.weatherEffectNode = node;
  }

  private drawWeatherEffects() {
    const node = this.weatherEffectNode;
    const g = this.weatherEffectGraphics;
    if (!node || !g) return;
    const weather = this.mission && !GameSession.isPvp ? this.currentWeather() : 'clear';
    node.active = weather !== 'clear';
    g.clear();
    if (weather === 'light_snow' || weather === 'heavy_snow') {
      this.drawSnowWeather(g, weather === 'heavy_snow');
      return;
    }
    if (weather !== 'rain') return;

    // A restrained cool veil makes rain readable over bright terrain without obscuring the HUD above this layer.
    g.fillColor = new Color(30, 52, 63, 24);
    g.rect(-CANVAS_W * 0.5, -CANVAS_H * 0.5, CANVAS_W, CANVAS_H);
    g.fill();

    const sample = this.rainVisualSample;
    let drewRain = false;
    g.lineWidth = 2;
    g.strokeColor = new Color(210, 238, 248, 218);
    for (let i = 0; i < RAIN_VISUAL_SLOT_COUNT; i++) {
      sampleRainVisual(i, this.unitEffectTime, CANVAS_W, CANVAS_H, sample);
      if (sample.phase !== 'fall') continue;
      g.moveTo(
        sample.headX + sample.streakLength * sample.slant,
        sample.headY + sample.streakLength,
      );
      g.lineTo(sample.headX, sample.headY);
      drewRain = true;
    }
    if (drewRain) g.stroke();

    const splashBuckets = 3;
    for (let bucket = 0; bucket < splashBuckets; bucket++) {
      let drewSplash = false;
      g.lineWidth = 1.25;
      g.strokeColor = new Color(208, 238, 248, 72 + bucket * 50);
      for (let i = 0; i < RAIN_VISUAL_SLOT_COUNT; i++) {
        sampleRainVisual(i, this.unitEffectTime, CANVAS_W, CANVAS_H, sample);
        if (sample.phase !== 'splash') continue;
        const alphaBucket = Math.min(splashBuckets - 1, Math.floor(sample.alpha / 59));
        if (alphaBucket !== bucket) continue;

        g.circle(sample.impactX, sample.impactY, sample.splashRadius);
        for (let ray = 0; ray < sample.splashRayCount; ray++) {
          const angle = sample.splashRotation + ray * Math.PI * 2 / sample.splashRayCount;
          const ux = Math.cos(angle);
          const uy = Math.sin(angle);
          const inner = sample.splashRadius * 0.55;
          const outer = sample.splashRadius + sample.splashRayLength;
          g.moveTo(sample.impactX + ux * inner, sample.impactY + uy * inner);
          g.lineTo(sample.impactX + ux * outer, sample.impactY + uy * outer);
        }
        drewSplash = true;
      }
      if (drewSplash) g.stroke();
    }
  }

  private drawSnowWeather(g: Graphics, heavy: boolean) {
    // A pale veil unifies summer or winter terrain without washing out unit
    // silhouettes. Snow particles remain below the HUD on WeatherEffectLayer.
    g.fillColor = new Color(210, 224, 232, 20);
    g.rect(-CANVAS_W * 0.5, -CANVAS_H * 0.5, CANVAS_W, CANVAS_H);
    g.fill();

    const sample = this.snowVisualSample;
    const slotCount = heavy ? HEAVY_SNOW_VISUAL_SLOT_COUNT : LIGHT_SNOW_VISUAL_SLOT_COUNT;
    const visualTime = this.unitEffectTime * (heavy ? 1.5 : 1);
    const flakeScale = heavy ? 1 : 0.7;
    // Draw far flakes first and near flakes last so the three depth bands read
    // as a blizzard instead of a single flat field of identical white dots.
    for (let band = 0; band < 3; band++) {
      for (let i = 0; i < slotCount; i++) {
        sampleSnowVisual(i, visualTime, CANVAS_W, CANVAS_H, sample);
        const sampleBand = Math.min(2, Math.floor(sample.depth * 3));
        if (sampleBand !== band) continue;
        if (band === 2) {
          g.fillColor = new Color(232, 241, 246, Math.round(sample.alpha * 0.22));
          g.circle(sample.x, sample.y, sample.radius * flakeScale * 1.85);
          g.fill();
        }
        g.fillColor = new Color(246, 250, 252, sample.alpha);
        g.circle(sample.x, sample.y, sample.radius * flakeScale);
        g.fill();
      }
    }
  }

  /** 锁定特效层在全部单位贴图之上；名称、浮字和战争迷雾仍可继续排在其上。 */
  private placeUnitEffectLayerAboveUnits() {
    const effectNode = this.unitEffectNode;
    const mapNode = this.mapNode;
    if (!effectNode || !mapNode || effectNode.parent !== mapNode) return;
    const unitMaskNode = this.unitVisibilityMaskNode;
    if (unitMaskNode?.parent === mapNode) {
      effectNode.setSiblingIndex(unitMaskNode.getSiblingIndex() + 1);
      return;
    }
    const unitNodes: Node[] = [
      ...this.enemyTopSpritePool.map(slot => slot.node),
      ...this.infantryTopSpritePool.map(slot => slot.node),
      ...this.officerTopSpritePool.map(slot => slot.node),
    ];
    if (this.shermanSpriteNode) unitNodes.push(this.shermanSpriteNode);
    if (this.shermanTurretSpriteNode) unitNodes.push(this.shermanTurretSpriteNode);
    let highestUnitIndex = -1;
    for (const node of unitNodes) {
      if (node.parent === mapNode) highestUnitIndex = Math.max(highestUnitIndex, node.getSiblingIndex());
    }
    effectNode.setSiblingIndex(highestUnitIndex + 1);
  }

  /** Keep only smoke-screen markers above fog; ordinary unit effects stay below it. */
  private placeSmokeScreenEffectLayerAboveFog() {
    const smokeNode = this.smokeScreenEffectNode;
    const fogNode = this.fogNode;
    const mapNode = this.mapNode;
    if (!smokeNode || !fogNode || !mapNode
      || smokeNode.parent !== mapNode || fogNode.parent !== mapNode) return;
    smokeNode.setSiblingIndex(fogNode.getSiblingIndex() + 1);
  }

  private drawFireEffect(g: Graphics, cx: number, cy: number, v: UnitEffectVisual) {
    const u = v.unit;
    const level = Math.max(1, this.fireEffectLevel(u));
    const visualLevel = Math.min(6, level);
    const bodyFacingLerp: DirectionLerp | null = this.anim?.unit === u && this.anim.kind === 'turn'
      ? { from: this.anim.turnFrom!, to: this.anim.turnTo!, t: this.anim.t }
      : null;
    const origin = this.tankTurretPivotPosition(u, { x: cx, y: cy }, bodyFacingLerp);
    const count = Math.min(24, 6 + visualLevel * 3);
    const width = this.hexSize * Math.min(0.30, 0.10 + visualLevel * 0.035);
    const height = this.hexSize * Math.min(0.92, 0.54 + visualLevel * 0.065);
    const bodyOpacity = Math.min(224, 128 + visualLevel * 18);
    const highlightOpacity = Math.min(112, 58 + visualLevel * 9);

    for (let i = 0; i < count; i++) {
      const phase = (this.unitEffectTime * (0.26 + (i % 3) * 0.018)
        + i / count + (v.seed % 37) * 0.013) % 1;
      const curl = Math.sin(phase * Math.PI * 2 + i * 1.43);
      const x = origin.x + curl * width * (0.25 + phase * 0.75)
        + Math.sin(this.unitEffectTime * 0.43 + i) * 1.2;
      const y = origin.y + phase * height;
      const wobble = 0.92 + Math.sin(this.unitEffectTime * 1.08 + i * 0.77) * 0.10;
      const r = this.hexSize * (0.075 + phase * 0.085 + (i % 3) * 0.009) * wobble;
      const lifeAlpha = Math.sin(Math.PI * Math.min(1, phase * 1.08));
      const density = Math.pow(Math.max(0, lifeAlpha), 0.70);
      const shade = Math.max(20, 62 - visualLevel * 7) + (i % 3) * 7;

      g.fillColor = new Color(shade, shade + 2, shade + 3,
        Math.round(v.fireAlpha * density * bodyOpacity));
      g.circle(x, y, r);
      g.fill();
      g.fillColor = new Color(88, 91, 92,
        Math.round(v.fireAlpha * density * highlightOpacity));
      g.circle(x - r * 0.20, y + r * 0.24, r * 0.56);
      g.fill();
    }
  }

  /** 返回车体贴图上的炮塔转轴位置；分体坦克使用生成表里的裁切与 pivot 数据。 */
  private tankTurretPivotPosition(
    u: Unit,
    c: { x: number; y: number },
    bodyFacingLerp?: DirectionLerp | null,
  ): { x: number; y: number } {
    const body = this.topDownForwardVec(u, c, bodyFacingLerp);
    const offsetUnit = this.hexSize * Math.sqrt(3);
    if (isSplitTankKind(u.kind)) {
      const cfg = splitTankVisualConfigOf(u.kind);
      const geometry = splitTankGeometryConfigOf(u.kind);
      const scale = this.hexSize * 1.8 * cfg.hullFitScale
        / (Math.max(geometry.topTrim.w, geometry.topTrim.h) || 1);
      const baseX = c.x + cfg.hullOffsetForward * offsetUnit * body.ux
        + cfg.hullOffsetRight * offsetUnit * body.uy;
      const baseY = c.y + cfg.hullOffsetForward * offsetUnit * body.uy
        + cfg.hullOffsetRight * offsetUnit * (-body.ux);
      const localX = (geometry.pivot.bodyX - (geometry.topTrim.x + geometry.topTrim.w / 2)) * scale;
      const localY = ((geometry.topTrim.y + geometry.topTrim.h / 2) - geometry.pivot.bodyY) * scale;
      const bodyAngle = Math.atan2(body.uy, body.ux) + Math.PI;
      const cos = Math.cos(bodyAngle);
      const sin = Math.sin(bodyAngle);
      return {
        x: baseX + localX * cos - localY * sin,
        y: baseY + localX * sin + localY * cos,
      };
    }

    const cfg = tankVisualConfigOf(u.kind);
    return {
      x: c.x + cfg.offsetForward * offsetUnit * body.ux + cfg.offsetRight * offsetUnit * body.uy,
      y: c.y + cfg.offsetForward * offsetUnit * body.uy + cfg.offsetRight * offsetUnit * (-body.ux),
    };
  }

  /** 烟雾弹保持低矮、横向铺开，与着火产生的竖向深烟柱明确区分。 */
  private drawSmokeScreenEffect(g: Graphics, cx: number, cy: number, v: SmokeScreenVisual) {
    const alpha = v.smokeAlpha;
    const deploy = Math.min(1, v.smokeAge / 0.60);
    const seedPhase = (v.seed % 521) / 521 * Math.PI * 2;
    const count = 18;
    for (let i = 0; i < count; i++) {
      const cycle = (this.unitEffectTime * (0.20 + (i % 4) * 0.018) + i / count) % 1;
      const side = Math.floor(i / 3);
      const sideT = (i % 3 + 0.5) / 3
        + Math.sin(this.unitEffectTime * 0.36 + seedPhase + i * 1.17) * 0.065;
      const a0 = (-30 + side * 60) * Math.PI / 180;
      const a1 = (-30 + (side + 1) * 60) * Math.PI / 180;
      const ringScale = 0.76 + cycle * 0.08;
      const edgeX = Math.cos(a0) + (Math.cos(a1) - Math.cos(a0)) * sideT;
      const edgeY = Math.sin(a0) + (Math.sin(a1) - Math.sin(a0)) * sideT;
      const x = cx + edgeX * this.hexSize * ringScale
        + Math.sin(this.unitEffectTime * 0.62 + i * 1.31) * 1.8;
      const y = cy + edgeY * this.hexSize * ringScale
        + Math.cos(this.unitEffectTime * 0.48 + i * 0.91) * 1.5;
      const wobble = 0.92 + Math.sin(this.unitEffectTime * 1.25 + i * 0.83) * 0.10;
      const r = this.hexSize * (0.105 + (i % 4) * 0.014 + cycle * 0.035) * wobble;
      const lifeAlpha = 0.72 + Math.sin(cycle * Math.PI) * 0.28;

      // 白色主体明确表达烟雾弹；烟团只沿六角格内缘成环，中央车体区域保持清晰。
      const shade = 210 + (i % 3) * 8;
      g.fillColor = new Color(shade, shade + 2, shade + 5, Math.round(alpha * lifeAlpha * deploy * 166));
      g.circle(x, y, r);
      g.fill();
      g.fillColor = new Color(248, 250, 252, Math.round(alpha * lifeAlpha * deploy * 104));
      g.circle(x - r * 0.22, y + r * 0.25, r * 0.58);
      g.fill();
    }
  }

  /** 是否绘制本回合击毁残骸（灰圆+红叉）及「已毁」标签（与 `destroyWreckVisualIds` 同步）。 */
  private shouldShowDestroyWreckVisual(u: Unit): boolean {
    if (isFootUnit(u)) return false;
    return u.destroyed && this.destroyWreckVisualIds.has(u.id);
  }

  /** Returns whether another living unit shares this infantry unit's hex. */
  private infantrySharesHexWithOtherUnit(u: Unit): boolean {
    if (!this.mission) return false;
    const all: Unit[] = [this.mission.sherman, ...this.mission.allies, ...this.mission.enemies];
    for (const o of all) {
      if (o === u || o.destroyed) continue;
      if (o.pos.q === u.pos.q && o.pos.r === u.pos.r) return true;
    }
    return false;
  }

  /** Hardcore: an enemy tank sharing this squad's hex becomes its visual focus. */
  private enemyTankSharingInfantryHex(u: Unit): Unit | null {
    if (GameSession.gameMode !== 'hardcore' || !isFootUnit(u)) return null;
    return this.allUnits().find(o =>
      o !== u
      && !o.destroyed
      && isTankUnit(o)
      && isHostile(o, u)
      && o.pos.q === u.pos.q
      && o.pos.r === u.pos.r
    ) ?? null;
  }

  private clearInfantryBloodDecals(): void {
    for (const node of this.infantryBloodDecalNodes) {
      if (node.isValid) node.destroy();
    }
    this.infantryBloodDecalNodes.length = 0;
    this.infantryBloodDecalUnitIds.clear();
    this.pendingInfantryBloodDecals.clear();
  }

  private infantryBloodSpriteFrameFor(unitId: string, soldierIndex: number): SpriteFrame | null {
    const loaded = this.infantryBloodSpriteFrames.filter((sf): sf is SpriteFrame => sf !== null);
    if (loaded.length === 0) return null;
    let hash = soldierIndex * 97;
    for (let i = 0; i < unitId.length; i++) {
      hash = (hash * 31 + unitId.charCodeAt(i)) >>> 0;
    }
    return loaded[hash % loaded.length] ?? loaded[0];
  }

  private spawnInfantryBloodDecals(u: Unit): void {
    this.spawnInfantryBloodDecalsAt(u, false);
  }

  private spawnInfantryBloodDecalsAt(
    u: Unit,
    forceCoLocateOtherUnit: boolean,
    customOffsets?: Array<{ ox: number; oy: number }>,
  ): void {
    const layer = this.infantryBloodDecalLayerNode;
    if (!layer || this.infantryBloodDecalUnitIds.has(u.id)) return;
    if (!this.infantryBloodSpriteFrames.some(sf => sf !== null)) {
      // Resource loading is asynchronous. Keep the death request so a hit in
      // the first moments of a mission still receives decals once a frame loads.
      this.pendingInfantryBloodDecals.set(u.id, {
        unit: u,
        forceCoLocateOtherUnit,
        customOffsets,
      });
      return;
    }
    this.pendingInfantryBloodDecals.delete(u.id);
    this.infantryBloodDecalUnitIds.add(u.id);

    const c = this.project(u.pos.q, u.pos.r);
    const coLocateOtherUnit = forceCoLocateOtherUnit || this.infantrySharesHexWithOtherUnit(u);
    const offsets = customOffsets ?? infantrySquadOffsets(this.hexSize, coLocateOtherUnit);
    // The source decals are 100×100; render at 60% of the previous 50 px size.
    const decalSize = 30;
    for (let i = 0; i < offsets.length; i++) {
      const sf = this.infantryBloodSpriteFrameFor(u.id, i);
      if (!sf) continue;
      const off = offsets[i];
      const node = new Node('InfantryBloodDecal');
      node.layer = this.node.layer;
      const ut = node.addComponent(UITransform);
      ut.setContentSize(decalSize, decalSize);
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.spriteFrame = sf;
      ut.setContentSize(decalSize, decalSize);
      node.setPosition(c.x + off.ox, c.y + off.oy, 0);
      layer.addChild(node);
      this.infantryBloodDecalNodes.push(node);
    }
  }

  private flushPendingInfantryBloodDecals(): void {
    if (!this.infantryBloodSpriteFrames.some(sf => sf !== null)) return;
    const pending = [...this.pendingInfantryBloodDecals.values()];
    for (const request of pending) {
      this.spawnInfantryBloodDecalsAt(
        request.unit,
        request.forceCoLocateOtherUnit,
        request.customOffsets,
      );
    }
  }

  private registerDestroyWreckVisual(u: Unit): void {
    if (!u.destroyed) return;
    if (isFootUnit(u)) {
      this.spawnInfantryBloodDecals(u);
      return;
    }
    this.destroyWreckVisualIds.add(u.id);
    this.spawnDestroyedTurretVisual(u, 'impact', null);
  }

  private registerImpactDestroyWreckVisual(u: Unit, attacker: Unit | null): void {
    if (!u.destroyed || isFootUnit(u)) {
      this.registerDestroyWreckVisual(u);
      return;
    }
    this.destroyWreckVisualIds.add(u.id);
    this.spawnDestroyedTurretVisual(u, 'impact', attacker);
  }

  private registerAmmoExplosionWreckVisual(u: Unit): void {
    if (!u.destroyed || isFootUnit(u)) {
      this.registerDestroyWreckVisual(u);
      return;
    }
    this.destroyWreckVisualIds.add(u.id);
    this.spawnDestroyedTurretVisual(u, 'ammoExplosion', null);
  }

  private spawnDestroyedTurretVisual(
    u: Unit,
    cause: DestroyedTurretLaunchCause,
    attacker: Unit | null,
  ): void {
    if (this.destroyedTurretVisualIds.has(u.id) || !isSplitTankKind(u.kind)) return;
    const assets = this.splitTankSprites[u.kind];
    const layer = this.unitEffectNode;
    if (!assets?.turret || !layer) return;

    const cfg = splitTankVisualConfigOf(u.kind);
    const geometry = splitTankGeometryConfigOf(u.kind);
    const topTrim = geometry.topTrim;
    const turretTrim = geometry.turretTrim;
    const pivot = geometry.pivot;
    const center = this.project(u.pos.q, u.pos.r);
    const body = this.topDownForwardVec(u, center, null);
    const fallbackFacing = (u.facing ?? 0) as FireDirection;
    const turretFacing = this.currentTurretFacingFor(u, fallbackFacing);
    const fit = this.hexSize * 1.8 * cfg.hullFitScale;
    const bodyScale = fit / (Math.max(topTrim.w, topTrim.h) || 1);
    const turretScale = bodyScale * cfg.turretScale;
    const offsetUnit = this.hexSize * Math.sqrt(3);
    const hullF = cfg.hullOffsetForward * offsetUnit;
    const hullR = cfg.hullOffsetRight * offsetUnit;
    const turretF = cfg.turretOffsetForward * offsetUnit;
    const turretR = cfg.turretOffsetRight * offsetUnit;
    const baseX = center.x + hullF * body.ux + hullR * body.uy;
    const baseY = center.y + hullF * body.uy + hullR * (-body.ux);
    const pivotLocalX = (pivot.bodyX - (topTrim.x + topTrim.w / 2)) * bodyScale;
    const pivotLocalY = ((topTrim.y + topTrim.h / 2) - pivot.bodyY) * bodyScale;
    const bodyAngle = Math.atan2(body.uy, body.ux) + Math.PI;
    const cosBody = Math.cos(bodyAngle);
    const sinBody = Math.sin(bodyAngle);
    const startX = baseX + pivotLocalX * cosBody - pivotLocalY * sinBody;
    const startY = baseY + pivotLocalX * sinBody + pivotLocalY * cosBody;

    const node = new Node(`DestroyedTurret_${u.id}`);
    node.layer = this.node.layer;
    const transform = node.addComponent(UITransform);
    transform.setContentSize(turretTrim.w * turretScale, turretTrim.h * turretScale);
    transform.setAnchorPoint(
      (pivot.spriteX - turretTrim.x) / turretTrim.w + turretF / (turretTrim.w * turretScale),
      1 - ((pivot.spriteY - turretTrim.y) / turretTrim.h) - turretR / (turretTrim.h * turretScale),
    );
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.spriteFrame = assets.turret;
    sprite.color = new Color(255, 255, 255, 255);
    const opacity = node.addComponent(UIOpacity);
    node.setPosition(startX, startY, 0);
    node.angle = this.directionScreenAngle(u.pos, center, turretFacing) * 180 / Math.PI + 180;
    layer.addChild(node);
    node.setSiblingIndex(layer.children.length - 1);

    let directionAngle: number;
    if (cause === 'impact' && attacker && attacker !== u) {
      const from = this.project(attacker.pos.q, attacker.pos.r);
      directionAngle = Math.atan2(center.y - from.y, center.x - from.x);
      directionAngle += (Math.random() - 0.5) * 20 * Math.PI / 180;
    } else {
      directionAngle = Math.random() * Math.PI * 2;
    }

    const ammoExplosion = cause === 'ammoExplosion';
    this.destroyedTurretVisualIds.add(u.id);
    this.destroyedTurretVisuals.push({
      unitId: u.id,
      node,
      opacity,
      startX,
      startY,
      dirX: Math.cos(directionAngle),
      dirY: Math.sin(directionAngle),
      distance: ammoExplosion ? 25 + Math.random() * 10 : 160 + Math.random() * 50,
      duration: ammoExplosion ? 0.55 + Math.random() * 0.15 : 0.75 + Math.random() * 0.2,
      remainTime: 1.5,
      fadeDuration: 0.35,
      maxScale: 1.45 + Math.random() * 0.15,
      groundScale: 1,
      startAngle: node.angle,
      rotateAngle: (ammoExplosion ? 540 + Math.random() * 360 : 360 + Math.random() * 360)
        * (Math.random() < 0.5 ? -1 : 1),
      elapsed: 0,
    });
    this.placeUnitEffectLayerAboveUnits();
  }

  private advanceDestroyedTurretVisuals(dt: number): void {
    for (let i = this.destroyedTurretVisuals.length - 1; i >= 0; i--) {
      const visual = this.destroyedTurretVisuals[i];
      if (!visual.node.isValid) {
        this.destroyedTurretVisuals.splice(i, 1);
        continue;
      }
      visual.elapsed += dt;
      const flightT = Math.min(1, visual.elapsed / visual.duration);
      const height = 4 * flightT * (1 - flightT);
      const moveT = easeOutCubic(flightT);
      const baseScale = 1 + (visual.groundScale - 1) * flightT;
      const scale = baseScale + (visual.maxScale - baseScale) * height;
      visual.node.setPosition(
        visual.startX + visual.dirX * visual.distance * moveT,
        visual.startY + visual.dirY * visual.distance * moveT,
        0,
      );
      visual.node.angle = visual.startAngle + visual.rotateAngle * flightT;

      const landedFor = visual.elapsed - visual.duration;
      const landingPulse = landedFor >= 0 && landedFor < 0.14
        ? 1 + Math.sin(landedFor / 0.14 * Math.PI) * 0.07
        : 1;
      visual.node.setScale(scale * landingPulse, scale * landingPulse, 1);

      const fadeStart = visual.duration + visual.remainTime;
      if (visual.elapsed > fadeStart) {
        const fadeT = Math.min(1, (visual.elapsed - fadeStart) / visual.fadeDuration);
        visual.opacity.opacity = Math.round(255 * (1 - fadeT));
        if (fadeT >= 1) {
          visual.node.destroy();
          this.destroyedTurretVisuals.splice(i, 1);
        }
      }
    }
  }

  private clearDestroyedTurretVisuals(): void {
    for (const visual of this.destroyedTurretVisuals) {
      if (visual.node.isValid) visual.node.destroy();
    }
    this.destroyedTurretVisuals = [];
    this.destroyedTurretVisualIds.clear();
  }

  private atGunController(gun: Unit): Unit | null {
    if (!gun.atGunControllerUnitId) return null;
    return this.allUnits().find(u => u.id === gun.atGunControllerUnitId) ?? null;
  }

  /** Kill only the AT-gun operator group, leaving an intact neutral gun behind. */
  private killATGunCrew(gun: Unit): void {
    if (!isAntiTankGunUnit(gun)) return;
    // Blood must remain exactly where the three visible operators stood, not
    // at the generic infantry triangle used by ordinary squads.
    const crewOffsets = this.atGunCrewFormationOffsets(gun);
    const controller = this.atGunController(gun);
    if (controller && !controller.destroyed) {
      controller.pos = { ...gun.pos };
      controller.destroyed = true;
      controller.attachedToATGunId = undefined;
      this.spawnInfantryBloodDecalsAt(controller, true, crewOffsets);
    } else {
      const crew = this.atGunCrewProxy(gun);
      crew.destroyed = true;
      this.spawnInfantryBloodDecalsAt(crew, true, crewOffsets);
    }
    gun.atGunCrewAlive = false;
    gun.atGunControllerUnitId = undefined;
    gun.atGunCrewLevel = undefined;
    gun.faction = 'neutral';
    gun.visionRange = 0;
  }

  private rehomeCapturedUnit(unit: Unit): void {
    if (!this.mission) return;
    const to = unit.sideId === 'player' ? this.mission.allies : this.mission.enemies;
    for (const list of [this.mission.allies, this.mission.enemies]) {
      const idx = list.indexOf(unit);
      if (idx >= 0) list.splice(idx, 1);
    }
    if (!to.includes(unit)) to.push(unit);
  }

  /** Kept as the AT-gun-specific entry point for the established composite flow. */
  private rehomeCapturedATGun(gun: Unit): void {
    this.rehomeCapturedUnit(gun);
  }

  /** Hardcore: infantry entering an abandoned gun hex becomes its operator group. */
  private captureAbandonedATGunsAt(infantry: Unit): void {
    if (GameSession.gameMode !== 'hardcore' || !isFootUnit(infantry) || infantry.destroyed) return;
    const gun = this.allUnits().find(unit =>
      isAbandonedATGun(unit)
      && unit.pos.q === infantry.pos.q
      && unit.pos.r === infantry.pos.r
    );
    if (!gun) return;
    gun.faction = infantry.faction;
    gun.sideId = infantry.sideId;
    gun.controller = 'ai';
    gun.atGunCrewAlive = true;
    gun.atGunCrewKind = infantryKindForFaction(infantry.faction);
    gun.atGunCrewLevel = unitLevelOf(infantry);
    gun.atGunCrewTargetSize = infantry.stats.size;
    gun.atGunCrewGeneration = (gun.atGunCrewGeneration ?? 0) + 1;
    gun.atGunControllerUnitId = infantry.id;
    gun.visionRange = infantry.visionRange ?? infantry.stats.visionRange;
    infantry.attachedToATGunId = gun.id;
    infantry.pos = { ...gun.pos };
    infantry.facing = gun.facing;
    this.rehomeCapturedATGun(gun);
    this.battleLog(`[Hardcore] ${unitDisplayName(infantry.kind)} controls ${unitDisplayName(gun.kind)}`);
  }

  /** Infantry entering an abandoned tank becomes a full replacement crew. */
  private captureAbandonedTanksAt(infantry: Unit): void {
    if (!isFootUnit(infantry) || infantry.destroyed || isAttachedATGunCrew(infantry)) return;
    const tank = this.allUnits().find(unit =>
      isAbandonedTank(unit)
      && unit.pos.q === infantry.pos.q
      && unit.pos.r === infantry.pos.r
    );
    if (!tank) return;

    tank.faction = infantry.faction;
    tank.sideId = infantry.sideId;
    tank.controller = 'ai';
    restoreFullTankCrew(tank);
    tank.hatchOpen = false;
    tank.visionRange = tank.stats.visionRange;
    tank.gunnerVisionRange = tank.stats.gunnerVisionRange;
    tank.interiorVisionRange = tank.stats.interiorVisionRange;
    infantry.destroyed = true;
    infantry.pos = { ...tank.pos };
    this.rehomeCapturedUnit(tank);
    this.battleLog(`[Crew] ${unitDisplayName(infantry.kind)} crews ${unitDisplayName(tank.kind)}`);
  }

  private clearDestroyWreckVisuals(): void {
    this.destroyWreckVisualIds.clear();
    // A new turn removes wreck fires immediately rather than fading them out.
    for (const [id, visual] of this.unitEffectVisuals) {
      if (visual.unit.destroyed) this.unitEffectVisuals.delete(id);
    }
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
    if (!this.isHexVisible({ q: atQ, r: atR })) return;
    const pixel = this.project(atQ, atR);
    const startY = pixel.y + this.hexSize * 0.55;

    const n = new Node('Floater');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    const size = 20;
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

  private spawnUiFloaterAtNode(
    anchor: Node,
    text: string,
    color: Color,
    opts?: { size?: number; dur?: number; rise?: number; offsetY?: number },
  ) {
    const parentUT = this.node.getComponent(UITransform);
    const anchorUT = anchor.getComponent(UITransform);
    if (!parentUT || !anchorUT) return;

    const local = parentUT.convertToNodeSpaceAR(anchor.worldPosition);
    const size = opts?.size ?? 20;
    const startX = local.x;
    const startY = local.y + anchorUT.height / 2 + (opts?.offsetY ?? 18);

    const n = new Node('Floater');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(180, size + 6);
    ut.setAnchorPoint(0.5, 0.5);

    const l = n.addComponent(Label);
    l.fontSize = size;
    l.lineHeight = size + 4;
    l.color = new Color(color.r, color.g, color.b, 255);
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.overflow = Label.Overflow.SHRINK;
    l.string = text;

    this.node.addChild(n);
    n.setPosition(startX, startY, 0);
    n.setSiblingIndex(this.node.children.length - 1);

    this.floaters.push({
      node: n,
      label: l,
      baseR: color.r,
      baseG: color.g,
      baseB: color.b,
      baseX: startX,
      baseY: startY,
      t: 0,
      dur: opts?.dur ?? 1.0,
      rise: opts?.rise ?? 24,
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
    if (!this.isUnitVisible(attacker)) return;
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

  /** 主炮开火后的短促炮口白烟：先沿炮管喷出，再分裂膨胀并淡出。 */
  private spawnMuzzleSmoke(attacker: Unit | null, target: Unit | null) {
    if (!this.mapNode || !attacker || !target || attacker.destroyed) return;
    if (!this.isUnitVisible(attacker)) return;
    const pos = this.muzzleFlashPosition(attacker, target);
    if (!pos) return;

    const n = new Node('MuzzleSmoke');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(1, 1);
    ut.setAnchorPoint(0.5, 0.5);
    const g = n.addComponent(Graphics);
    this.mapNode.addChild(n);
    n.setPosition(pos.x, pos.y, 0);
    n.setSiblingIndex(this.mapNode.children.length - 1);

    const smoke: MuzzleSmoke = {
      node: n,
      g,
      x: pos.x,
      y: pos.y,
      ux: pos.ux,
      uy: pos.uy,
      size: Math.max(10, this.hexSize * 0.24),
      t: 0,
      dur: 1.2,
      seed: this.hashStringToSeed(`muzzle-smoke:${attacker.id}:${target.id}:${this.muzzleSmokeSerial++}`),
    };
    this.drawMuzzleSmoke(smoke, 0);
    this.muzzleSmokes.push(smoke);
  }

  private rememberAttackPosition(attacker: Unit | null): void {
    if (attacker) recordAttackPositionForMemory(this.attackPositionMemory, attacker);
  }

  private playAttackFireCue(
    attacker: Unit | null,
    target: Unit | null,
    mg: boolean,
    attackSound: string,
    report?: AttackReport,
    onPenetrationImpact?: () => void,
  ) {
    if (report) {
      if (this.firedAttackCueReports.has(report)) return;
      this.firedAttackCueReports.add(report);
    }
    if (!mg) this.rememberAttackPosition(attacker);
    if (attacker && target && isFootUnit(attacker) && attacker.kind !== 'officer' && isTankUnit(target)) {
      // Face the squad toward the tank before selecting one member as the
      // launcher operator. The other two soldiers turn only; they do not fire.
      this.setInfantryVisualFacing(attacker, target.pos);
      this.redraw();
      const rocketTraceStart = this.infantryRocketTraces.length;
      this.spawnInfantryRocketTrace(attacker, target, report);
      if (onPenetrationImpact && this.infantryRocketTraces.length > rocketTraceStart) {
        this.infantryRocketTraces[rocketTraceStart].onPenetrationImpact = onPenetrationImpact;
      }
      playInfantryAntiTankFire();
      return;
    }
    if (attacker && target) {
      this.setInfantryVisualFacing(attacker, target.pos);
      this.redraw();
    }
    if (attacker && target && isFootUnit(attacker) && attacker.kind !== 'officer'
      && (isFootUnit(target) || isControlledATGun(target))) {
      this.spawnInfantryBulletVolley(attacker, target);
      playInfantryAttack();
      return;
    }
    if (mg) {
      this.playMachineGunFireCue(attacker, target, report?.hit === true);
      return;
    }
    this.startMainGunRecoil(attacker, target);
    this.spawnMuzzleSmoke(attacker, target);
    this.spawnMuzzleFlash(attacker, target);
    this.spawnProjectileTrace(attacker, target, report, { onPenetrationImpact });
    playConfiguredAttackSound(attackSound);
  }

  private playMachineGunFireCue(attacker: Unit | null, target: Unit | null, hit: boolean) {
    this.rememberAttackPosition(attacker);
    if (attacker && target && isFootUnit(attacker) && attacker.kind !== 'officer' && isTankUnit(target)) {
      this.setInfantryVisualFacing(attacker, target.pos);
      this.redraw();
      this.spawnInfantryRocketTrace(attacker, target, { hit, penetrated: hit, roll: 0 });
      playInfantryAntiTankFire();
      return;
    }
    if (attacker && target && isFootUnit(attacker) && attacker.kind !== 'officer'
      && (isFootUnit(target) || isControlledATGun(target))) {
      this.spawnInfantryBulletVolley(attacker, target);
      playInfantryAttack();
      return;
    }
    this.spawnMachineGunBurst(attacker, target, hit);
    playMgFire();
  }

  private playHighExplosiveSuppressionCue(
    attacker: Unit,
    target: Unit,
    report?: HighExplosiveReport,
  ) {
    this.rememberAttackPosition(attacker);
    this.startMainGunRecoil(attacker, target);
    this.spawnMuzzleSmoke(attacker, target);
    this.spawnMuzzleFlash(attacker, target);
    // Old PvP records did not serialize the HE report. Treat only those legacy
    // cues as hits; live attacks always pass the report and therefore show no
    // target-side explosion when the shell misses.
    const hit = report?.hit ?? true;
    const seed = this.hashStringToSeed(
      `he-impact:${attacker.id}:${target.id}:${report?.roll ?? 0}:${report?.effectRoll ?? 0}`,
    );
    this.spawnProjectileTrace(
      attacker,
      target,
      { hit, penetrated: hit, roll: report?.roll ?? 0 },
      {
        skipPenetrationImpact: hit,
        onPenetrationImpact: hit
          ? (x, y) => this.spawnHighExplosiveBlast(x, y, seed)
          : undefined,
      },
    );
    playConfiguredAttackSound(attacker.stats.attackSound);
  }

  private startMainGunRecoil(attacker: Unit | null, target: Unit | null) {
    if (!attacker || !target || attacker.destroyed) return;
    const mode = mainGunRecoilMode(
      attacker.kind,
      isFootUnit(attacker),
      isSplitTankKind(attacker.kind) && this.enemySupportsSplitTurret(attacker),
      isEnemyTopKind(attacker.kind) || isTankUnit(attacker),
    );
    if (!mode) return;
    const shot = this.muzzleFlashPosition(attacker, target);
    if (!shot) return;
    this.mainGunRecoils.set(attacker.id, {
      elapsed: 0,
      ux: shot.ux,
      uy: shot.uy,
      mode,
    });
  }

  private mainGunRecoilOffsetFor(u: Unit, mode: MainGunRecoilMode): { x: number; y: number } {
    const recoil = this.mainGunRecoils.get(u.id);
    if (!recoil || recoil.mode !== mode || u.destroyed) return { x: 0, y: 0 };
    return mainGunRecoilOffset(recoil.elapsed, this.hexSize, recoil.ux, recoil.uy);
  }

  private advanceMainGunRecoils(dt: number) {
    const totalTime = MAIN_GUN_RECOIL_BACK_TIME + MAIN_GUN_RECOIL_RETURN_TIME;
    for (const [unitId, recoil] of this.mainGunRecoils) {
      recoil.elapsed += Math.max(0, dt);
      if (recoil.elapsed >= totalTime) this.mainGunRecoils.delete(unitId);
    }
    this.redraw();
  }

  private spawnMachineGunBurst(attacker: Unit | null, target: Unit | null, hit: boolean) {
    if (!this.mapNode || !attacker || !target || attacker.destroyed) return;
    if (!this.isUnitVisible(attacker)) return;
    const a = this.project(attacker.pos.q, attacker.pos.r);
    const b = this.project(target.pos.q, target.pos.r);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len <= 1) return;
    const ux = dx / len;
    const uy = dy / len;
    const start = machineGunBurstStartPoint(a, ux, uy, this.hexSize);
    const targetInset = Math.max(8, this.hexSize * 0.16);

    const n = new Node('MachineGunBurst');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(1, 1);
    ut.setAnchorPoint(0.5, 0.5);
    const g = n.addComponent(Graphics);
    this.mapNode.addChild(n);
    n.setPosition(0, 0, 0);
    this.placeProjectileTraceNode(n);

    const burst: MachineGunBurst = {
      node: n,
      g,
      startX: start.x,
      startY: start.y,
      targetX: b.x - ux * targetInset,
      targetY: b.y - uy * targetInset,
      ux,
      uy,
      t: 0,
      dur: 0.62,
      seed: this.hashStringToSeed(`mg:${attacker.id}:${target.id}:${hit ? 1 : 0}`),
      hit,
    };
    this.drawMachineGunBurst(burst, 0);
    this.machineGunBursts.push(burst);
  }

  /**
   * Infantry-on-infantry fire: one lane starts at each rendered squad member.
   * Giving every endpoint the same formation offset keeps all three trajectories
   * exactly parallel while still landing inside the target hex.
   */
  private spawnInfantryBulletVolley(attacker: Unit | null, target: Unit | null) {
    if (!this.mapNode || !attacker || !target || attacker.destroyed) return;
    if (!isFootUnit(attacker) || attacker.kind === 'officer'
      || (!isFootUnit(target) && !isControlledATGun(target))
      || !this.isUnitVisible(attacker)) return;
    const a = this.project(attacker.pos.q, attacker.pos.r);
    const b = this.project(target.pos.q, target.pos.r);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len <= 1) return;
    const ux = dx / len;
    const uy = dy / len;
    const offsets = infantrySquadOffsets(this.hexSize, this.infantrySharesHexWithOtherUnit(attacker));
    const muzzleForward = Math.max(5, this.hexSize * 0.10);
    const targetInset = Math.max(8, this.hexSize * 0.16);
    const lanes = offsets.map((offset) => ({
      startX: a.x + offset.ox + ux * muzzleForward,
      startY: a.y + offset.oy + uy * muzzleForward,
      targetX: b.x + offset.ox - ux * targetInset,
      targetY: b.y + offset.oy - uy * targetInset,
    }));

    const n = new Node('InfantryBulletVolley');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(1, 1);
    ut.setAnchorPoint(0.5, 0.5);
    const g = n.addComponent(Graphics);
    this.mapNode.addChild(n);
    n.setPosition(0, 0, 0);
    this.placeProjectileTraceNode(n);

    const volley: InfantryBulletVolley = {
      node: n,
      g,
      lanes,
      ux,
      uy,
      t: 0,
      dur: 0.48,
    };
    this.drawInfantryBulletVolley(volley, 0);
    this.infantryBulletVolleys.push(volley);
  }

  private spawnProjectileTrace(
    attacker: Unit | null,
    target: Unit | null,
    report?: ProjectileReport,
    options: Pick<ProjectileTrace, 'skipPenetrationImpact' | 'onPenetrationImpact'> = {},
  ) {
    if (!this.mapNode || !attacker || !target || attacker.destroyed || !report) return;
    if (!this.isUnitVisible(attacker)) return;
    const muzzle = this.muzzleFlashPosition(attacker, target);
    if (!muzzle) return;

    const mode: ProjectileTraceMode = !report.hit
      ? 'miss'
      : report.overpenetrated
        ? 'overpenetration'
      : report.penetrated
        ? 'penetration'
        : 'ricochet';
    const targetCenter = this.project(target.pos.q, target.pos.r);
    // The rules-facing direction is quantized to one of twelve turret headings,
    // but the visible shell must travel from the rendered muzzle toward the
    // actual target. Derive the tracer vector from those two screen points so
    // its motion, tail and miss continuation all share one precise heading.
    const flightDx = targetCenter.x - muzzle.x;
    const flightDy = targetCenter.y - muzzle.y;
    const flightLen = Math.hypot(flightDx, flightDy);
    const flight = flightLen > 1e-4
      ? { ux: flightDx / flightLen, uy: flightDy / flightLen }
      : { ux: muzzle.ux, uy: muzzle.uy };
    const impact = this.projectileImpactPoint(target, flight.ux, flight.uy);
    const exit = {
      x: targetCenter.x + (targetCenter.x - impact.x),
      y: targetCenter.y + (targetCenter.y - impact.y),
    };
    const end = mode === 'miss'
      ? this.projectileMapExitPoint(muzzle.x, muzzle.y, flight.ux, flight.uy)
      : impact;
    const bounce = this.projectileBounceVector(attacker, target, flight.ux, flight.uy, report);
    const dist = Math.hypot(end.x - muzzle.x, end.y - muzzle.y);

    const n = new Node('ProjectileTrace');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(1, 1);
    ut.setAnchorPoint(0.5, 0.5);
    const g = n.addComponent(Graphics);
    this.mapNode.addChild(n);
    n.setPosition(0, 0, 0);
    this.placeProjectileTraceNode(n);

    const trace: ProjectileTrace = {
      node: n,
      g,
      mode,
      phase: 'flight',
      startX: muzzle.x,
      startY: muzzle.y,
      impactX: impact.x,
      impactY: impact.y,
      exitX: exit.x,
      exitY: exit.y,
      endX: end.x,
      endY: end.y,
      ux: flight.ux,
      uy: flight.uy,
      bounceUx: bounce.ux,
      bounceUy: bounce.uy,
      t: 0,
      dur: Math.max(0.14, Math.min(0.34, dist / Math.max(1, this.hexSize * 17))),
      seed: this.projectileSeed(attacker, target, report),
      ...options,
    };
    this.drawProjectileTrace(trace, 0);
    this.projectileTraces.push(trace);
  }

  private spawnHighExplosiveBlast(x: number, y: number, seed: number) {
    if (!this.mapNode) return;
    const node = new Node('HighExplosiveBlast');
    node.layer = this.node.layer;
    node.addComponent(UITransform).setContentSize(1, 1);
    const g = node.addComponent(Graphics);
    this.mapNode.addChild(node);
    node.setPosition(0, 0, 0);
    this.placeProjectileTraceNode(node);
    const blast: HighExplosiveBlast = { node, g, x, y, t: 0, dur: 0.94, seed };
    this.drawHighExplosiveBlast(blast);
    this.highExplosiveBlasts.push(blast);
  }

  private advanceHighExplosiveBlasts(dt: number) {
    for (let i = this.highExplosiveBlasts.length - 1; i >= 0; i--) {
      const blast = this.highExplosiveBlasts[i];
      blast.t += Math.max(0, dt);
      if (blast.t >= blast.dur) {
        blast.node.destroy();
        this.highExplosiveBlasts.splice(i, 1);
        continue;
      }
      this.drawHighExplosiveBlast(blast);
    }
  }

  private drawHighExplosiveBlast(blast: HighExplosiveBlast) {
    const g = blast.g;
    this.placeProjectileTraceNode(blast.node);
    g.clear();
    const p = Math.min(1, blast.t / blast.dur);
    const burst = 1 - Math.pow(1 - Math.min(1, p / 0.28), 3);
    const fireFade = Math.pow(Math.max(0, 1 - p / 0.72), 1.4);
    const smokeFade = Math.sin(Math.min(1, p) * Math.PI) * Math.max(0, 1 - p * 0.35);
    const flashFade = Math.max(0, 1 - p / 0.16);
    const x = blast.x;
    const y = blast.y;
    const radius = this.hexSize * (0.13 + burst * 0.68);

    // Expanding dust and smoke lobes make HE read as an area blast rather than
    // the compact, directional shower used for an AP penetration.
    const smokeLobes = 8;
    for (let i = 0; i < smokeLobes; i++) {
      const angle = ((blast.seed + i * 47) % 360) * Math.PI / 180;
      const drift = radius * (0.25 + this.seededUnit(blast.seed, 30 + i) * 0.52);
      const lobeSize = radius * (0.25 + this.seededUnit(blast.seed, 50 + i) * 0.22);
      const rise = this.hexSize * p * (0.10 + this.seededUnit(blast.seed, 70 + i) * 0.22);
      const shade = 58 + Math.round(this.seededUnit(blast.seed, 90 + i) * 38);
      g.fillColor = new Color(shade + 24, shade + 14, shade, Math.round(145 * smokeFade));
      g.circle(x + Math.cos(angle) * drift, y + Math.sin(angle) * drift + rise, lobeSize);
      g.fill();
    }

    g.fillColor = new Color(255, 103, 20, Math.round(220 * fireFade));
    g.circle(x, y + radius * 0.08, radius * 0.72);
    g.fill();
    g.fillColor = new Color(255, 219, 65, Math.round(245 * fireFade));
    g.circle(x, y + radius * 0.14, radius * 0.43);
    g.fill();
    g.fillColor = new Color(255, 255, 232, Math.round(255 * flashFade));
    g.circle(x, y + radius * 0.12, radius * (0.18 + flashFade * 0.22));
    g.fill();

    const rays = 15;
    for (let i = 0; i < rays; i++) {
      const angle = ((blast.seed + i * 67) % 360) * Math.PI / 180;
      const random = 0.55 + this.seededUnit(blast.seed, 10 + i) * 0.70;
      const inner = radius * 0.38;
      const outer = radius * (1.05 + random * 0.65);
      g.strokeColor = i % 3 === 0
        ? new Color(255, 222, 94, Math.round(225 * fireFade))
        : new Color(82, 65, 45, Math.round(190 * smokeFade));
      g.lineWidth = Math.max(1.2, this.hexSize * 0.018);
      g.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
      g.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
      g.stroke();
    }

    // A pale, rapidly expanding pressure ring is the HE silhouette at a glance.
    const shockProgress = 1 - Math.pow(1 - Math.min(1, p / 0.52), 2);
    const shockFade = Math.max(0, 1 - p / 0.66);
    g.strokeColor = new Color(255, 239, 181, Math.round(205 * shockFade));
    g.lineWidth = Math.max(1.5, this.hexSize * 0.025 * (1 - p * 0.45));
    g.circle(x, y, this.hexSize * (0.18 + shockProgress * 1.02));
    g.stroke();
  }

  private clearHighExplosiveBlasts() {
    for (const blast of this.highExplosiveBlasts) blast.node.destroy();
    this.highExplosiveBlasts.length = 0;
  }

  private muzzleFlashPosition(attacker: Unit, target: Unit): { x: number; y: number; ux: number; uy: number } | null {
    const dir = fireDirectionTo(attacker.pos, target.pos) ?? approximateFireDirection(attacker.pos, target.pos);
    const c = this.project(attacker.pos.q, attacker.pos.r);
    // AT-gun combat rules retain the quantized 12-direction ray, but its
    // complete mount visually aims at the target hex. All firing effects must
    // use that same exact vector or the shell visibly leaves along the hidden
    // rules-facing direction instead of through the rotated barrel.
    const preciseTurretAim = isTankUnit(attacker) && attacker.stats.visionType === 'turreted';
    const aimAngle = isAntiTankGunUnit(attacker) || preciseTurretAim
      ? this.targetScreenAngle(attacker.pos, target.pos)
      : this.directionScreenAngle(attacker.pos, c, dir);
    const aim = { ux: Math.cos(aimAngle), uy: Math.sin(aimAngle) };

    if (!attacker.destroyed && isSplitTankKind(attacker.kind)) {
      const cfg = splitTankVisualConfigOf(attacker.kind);
      const geometry = splitTankGeometryConfigOf(attacker.kind);
      const precise = this.splitTankMuzzlePosition(attacker, c, cfg, geometry, aim);
      if (precise) return precise;
    }

    const cfg = tankVisualConfigOf(attacker.kind);
    const precise = this.topSpriteMuzzlePosition(attacker, c, cfg, aim);
    if (precise) return precise;

    const dist = this.hexSize * 0.72;
    return {
      x: c.x + aim.ux * dist,
      y: c.y + aim.uy * dist,
      ux: aim.ux,
      uy: aim.uy,
    };
  }

  private projectileImpactPoint(target: Unit, ux: number, uy: number): { x: number; y: number } {
    const c = this.project(target.pos.q, target.pos.r);
    const side = Math.max(10, this.hexSize * (isFootUnit(target) ? 0.2 : 0.36));
    return { x: c.x - ux * side, y: c.y - uy * side };
  }

  private projectileMapExitPoint(x: number, y: number, ux: number, uy: number): { x: number; y: number } {
    if (!this.mission) return { x: x + ux * this.hexSize * 14, y: y + uy * this.hexSize * 14 };
    const sampled = this.projectileFirstInvalidMapPoint(x, y, ux, uy);
    if (sampled) return sampled;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const tile of this.mission.map.all()) {
      const c = this.project(tile.pos.q, tile.pos.r);
      minX = Math.min(minX, c.x - this.hexSize);
      minY = Math.min(minY, c.y - this.hexSize);
      maxX = Math.max(maxX, c.x + this.hexSize);
      maxY = Math.max(maxY, c.y + this.hexSize);
    }
    if (!Number.isFinite(minX)) return { x: x + ux * this.hexSize * 14, y: y + uy * this.hexSize * 14 };
    const margin = this.hexSize * 2.2;
    minX -= margin; minY -= margin; maxX += margin; maxY += margin;
    const candidates: number[] = [];
    if (Math.abs(ux) > 1e-4) {
      candidates.push(((ux > 0 ? maxX : minX) - x) / ux);
    }
    if (Math.abs(uy) > 1e-4) {
      candidates.push(((uy > 0 ? maxY : minY) - y) / uy);
    }
    const dist = Math.max(
      this.hexSize * 6,
      ...candidates.filter(v => v > this.hexSize * 0.5 && Number.isFinite(v)),
    );
    return { x: x + ux * dist, y: y + uy * dist };
  }

  private projectileFirstInvalidMapPoint(x: number, y: number, ux: number, uy: number): { x: number; y: number } | null {
    if (!this.mission) return null;
    const step = Math.max(3, this.hexSize * 0.08);
    const maxDist = this.hexSize * Math.max(this.mission.data.cols, this.mission.data.rows, 8) * 3;
    let lastInside = { x, y };
    let hasInside = false;
    for (let d = 0; d <= maxDist; d += step) {
      const px = x + ux * d;
      const py = y + uy * d;
      const axial = this.pixelToNearestAxial(px, py);
      if (!this.mission.map.get(axial)) {
        if (!hasInside && d <= this.hexSize * 1.15) continue;
        return hasInside ? lastInside : { x: px, y: py };
      }
      hasInside = true;
      lastInside = { x: px, y: py };
    }
    return null;
  }

  private pixelToNearestAxial(x: number, y: number): Axial {
    const localX = x - this.offsetX;
    const localY = -(y - this.offsetY);
    const qf = (Math.sqrt(3) / 3 * localX - localY / 3) / this.hexSize;
    const rf = (2 / 3 * localY) / this.hexSize;
    const sf = -qf - rf;
    let q = Math.round(qf);
    let r = Math.round(rf);
    let s = Math.round(sf);
    const dq = Math.abs(q - qf);
    const dr = Math.abs(r - rf);
    const ds = Math.abs(s - sf);
    if (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds) r = -q - s;
    return { q, r };
  }

  private projectileBounceVector(
    attacker: Unit,
    target: Unit,
    ux: number,
    uy: number,
    report: ProjectileReport,
  ): { ux: number; uy: number } {
    const seed = this.projectileSeed(attacker, target, report);
    const sign = seed % 2 === 0 ? 1 : -1;
    const angle = Math.atan2(uy, ux) + sign * (0.62 + ((seed >>> 3) % 17) / 100);
    return { ux: Math.cos(angle), uy: Math.sin(angle) };
  }

  private projectileSeed(attacker: Unit, target: Unit, report: ProjectileReport): number {
    const src = `${attacker.id}:${target.id}:${report.roll}:${report.penDie ?? 0}:${report.damageDie ?? 0}`;
    return this.hashStringToSeed(src);
  }

  private topSpriteMuzzlePosition(
    u: Unit,
    c: { x: number; y: number },
    cfg: TankVisualConfig,
    aim: { ux: number; uy: number },
  ): { x: number; y: number; ux: number; uy: number } | null {
    if (cfg.muzzle.spriteX === 0 && cfg.muzzle.spriteY === 0) return null;
    const meta = this.enemyTopMeta[u.kind as TankVisualKind];
    if (!meta?.sf) return null;

    const w = meta.dw > 0 ? meta.dw : meta.sf.width;
    const h = meta.dh > 0 ? meta.dh : meta.sf.height;
    if (w <= 0 || h <= 0) return null;

    const fit = this.hexSize * 1.8 * cfg.fitScale;
    const maxDim = Math.max(w, h) || 1;
    const tw0 = (w / maxDim) * fit;
    const th0 = (h / maxDim) * fit;
    const k = Math.sqrt(Math.max(1e-6, cfg.aspectRatioMul));
    const scaleX = (tw0 * k) / w;
    const scaleY = (th0 / k) / h;

    const offsetUnit = this.hexSize * Math.sqrt(3);
    const f = cfg.offsetForward * offsetUnit;
    const r = cfg.offsetRight * offsetUnit;
    const right = { ux: aim.uy, uy: -aim.ux };
    const baseX = c.x + f * aim.ux + r * right.ux;
    const baseY = c.y + f * aim.uy + r * right.uy;

    const localX = (cfg.muzzle.spriteX - w / 2) * scaleX;
    const localY = (h / 2 - cfg.muzzle.spriteY) * scaleY;
    return {
      x: baseX + localX * (-aim.ux) + localY * right.ux,
      y: baseY + localX * (-aim.uy) + localY * right.uy,
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

  private advanceMuzzleSmokes(dt: number) {
    for (let i = this.muzzleSmokes.length - 1; i >= 0; i--) {
      const smoke = this.muzzleSmokes[i];
      smoke.t += dt;
      const p = Math.min(smoke.t / smoke.dur, 1);
      if (p >= 1) {
        smoke.node.destroy();
        this.muzzleSmokes.splice(i, 1);
        continue;
      }
      this.drawMuzzleSmoke(smoke, p);
    }
  }

  private drawMuzzleSmoke(smoke: MuzzleSmoke, p: number) {
    const g = smoke.g;
    g.clear();

    const ux = smoke.ux;
    const uy = smoke.uy;
    const rx = uy;
    const ry = -ux;
    const burst = 1 - Math.pow(1 - Math.min(1, p / 0.20), 3);
    const drift = 1 - Math.pow(1 - p, 2);
    const fade = p < 0.18 ? 1 : Math.pow(Math.max(0, 1 - (p - 0.18) / 0.82), 1.28);
    const baseAlpha = Math.round(176 * fade);

    // 开火后的最初一瞬保留一条高压烟柱，让白烟与短暂炮口焰自然衔接。
    if (p < 0.24) {
      const plumeAlpha = Math.round(116 * (1 - p / 0.24));
      const length = smoke.size * (0.72 + burst * 0.92);
      const width = smoke.size * (0.16 + burst * 0.18);
      g.fillColor = new Color(232, 231, 219, plumeAlpha);
      g.moveTo(-ux * smoke.size * 0.10 + rx * width, -uy * smoke.size * 0.10 + ry * width);
      g.lineTo(ux * length + rx * width * 0.42, uy * length + ry * width * 0.42);
      g.lineTo(ux * length - rx * width * 0.42, uy * length - ry * width * 0.42);
      g.lineTo(-ux * smoke.size * 0.10 - rx * width, -uy * smoke.size * 0.10 - ry * width);
      g.close();
      g.fill();
    }

    const puffCount = 6;
    for (let i = 0; i < puffCount; i++) {
      const forwardRand = this.seededUnit(smoke.seed, i * 5);
      const sideRand = this.seededUnit(smoke.seed, i * 5 + 1) - 0.5;
      const sizeRand = this.seededUnit(smoke.seed, i * 5 + 2);
      const riseRand = this.seededUnit(smoke.seed, i * 5 + 3);
      const shadeRand = this.seededUnit(smoke.seed, i * 5 + 4);
      const stagger = i / (puffCount - 1);
      const forward = smoke.size * (0.14 + stagger * 0.72 + forwardRand * 0.28) * (0.32 + drift * 1.12);
      const side = smoke.size * sideRand * (0.18 + drift * 0.72);
      const rise = smoke.size * (0.05 + riseRand * 0.18) * drift;
      const x = ux * forward + rx * side;
      const y = uy * forward + ry * side + rise;
      const radius = smoke.size * (0.17 + sizeRand * 0.10) * (0.70 + burst * 1.65 + p * 0.45);
      const shade = Math.round(178 + shadeRand * 22);

      g.fillColor = new Color(shade - 20, shade - 19, shade - 24, Math.round(baseAlpha * 0.34));
      g.circle(x + radius * 0.08, y - radius * 0.10, radius * 1.08);
      g.fill();
      g.fillColor = new Color(shade + 32, shade + 32, shade + 24, Math.round(baseAlpha * 0.68));
      g.circle(x, y, radius);
      g.fill();
      g.fillColor = new Color(248, 246, 232, Math.round(baseAlpha * 0.42));
      g.circle(x - radius * 0.24, y + radius * 0.26, radius * 0.55);
      g.fill();
    }
  }

  private clearMuzzleSmokes() {
    for (const smoke of this.muzzleSmokes) smoke.node.destroy();
    this.muzzleSmokes.length = 0;
  }

  private advanceProjectileTraces(dt: number) {
    for (let i = this.projectileTraces.length - 1; i >= 0; i--) {
      const tr = this.projectileTraces[i];
      tr.t += dt;
      const p = Math.min(tr.t / tr.dur, 1);
      if (p >= 1) {
        if (tr.phase === 'flight' && tr.mode === 'ricochet') {
          playTankHitRicochet();
          tr.phase = 'ricochet';
          tr.startX = tr.impactX;
          tr.startY = tr.impactY;
          const ricochetEnd = this.projectileFirstInvalidMapPoint(tr.impactX, tr.impactY, tr.bounceUx, tr.bounceUy)
            ?? { x: tr.impactX + tr.bounceUx * this.hexSize * 1.45, y: tr.impactY + tr.bounceUy * this.hexSize * 1.45 };
          tr.endX = ricochetEnd.x;
          tr.endY = ricochetEnd.y;
          tr.t = 0;
          const ricochetDist = Math.hypot(tr.endX - tr.startX, tr.endY - tr.startY);
          tr.dur = Math.max(0.08, Math.min(0.34, ricochetDist / Math.max(1, this.hexSize * 6)));
          this.drawProjectileTrace(tr, 0);
          continue;
        }
        if (tr.phase === 'flight' && tr.mode === 'penetration') {
          tr.onPenetrationImpact?.(tr.impactX, tr.impactY);
          if (tr.skipPenetrationImpact) {
            tr.node.destroy();
            this.projectileTraces.splice(i, 1);
            continue;
          }
          playTankHitPenetration();
          tr.phase = 'impact';
          tr.startX = tr.impactX;
          tr.startY = tr.impactY;
          tr.t = 0;
          tr.dur = 0.26;
          this.drawProjectileTrace(tr, 0);
          continue;
        }
        if (tr.phase === 'flight' && tr.mode === 'overpenetration') {
          tr.onPenetrationImpact?.(tr.impactX, tr.impactY);
          playTankHitPenetration();
          // The shell is now inside the target: briefly hide the tracer while
          // retaining a tight entry spark, then reveal it at the far hull edge.
          tr.phase = 'overpenetration-hidden';
          tr.t = 0;
          tr.dur = 0.06;
          this.drawProjectileTrace(tr, 0);
          continue;
        }
        if (tr.phase === 'overpenetration-hidden') {
          tr.phase = 'overpenetration';
          tr.startX = tr.exitX;
          tr.startY = tr.exitY;
          tr.endX = tr.exitX + tr.ux * this.hexSize * 1.35;
          tr.endY = tr.exitY + tr.uy * this.hexSize * 1.35;
          tr.t = 0;
          tr.dur = 0.20;
          this.drawProjectileTrace(tr, 0);
          continue;
        }
        tr.node.destroy();
        this.projectileTraces.splice(i, 1);
        continue;
      }
      this.drawProjectileTrace(tr, p);
    }
  }

  private drawProjectileTrace(tr: ProjectileTrace, p: number) {
    const g = tr.g;
    this.placeProjectileTraceNode(tr.node);
    g.clear();
    if (tr.phase === 'impact') {
      this.drawProjectilePenetration(g, tr, p);
      return;
    }
    if (tr.phase === 'overpenetration-hidden') {
      this.drawProjectileSpark(g, tr.impactX, tr.impactY, tr, p);
      return;
    }

    const x = tr.startX + (tr.endX - tr.startX) * p;
    const y = tr.startY + (tr.endY - tr.startY) * p;
    const ux = tr.phase === 'ricochet' ? tr.bounceUx : tr.ux;
    const uy = tr.phase === 'ricochet' ? tr.bounceUy : tr.uy;
    const baseTail = this.hexSize * (tr.phase === 'ricochet' ? 0.52 : 0.72);
    // The outgoing overpenetration tail may grow back only to the exit hole;
    // it must never extend across the target sprite and look like an overhead shot.
    const tail = tr.phase === 'overpenetration'
      ? Math.min(baseTail, Math.hypot(x - tr.startX, y - tr.startY))
      : baseTail;
    const alpha = tr.phase === 'ricochet'
      ? Math.round(235 * (1 - p))
      : tr.mode === 'miss'
        ? Math.round(240 * (1 - Math.max(0, p - 0.7) / 0.3))
        : 245;
    const rx = uy;
    const ry = -ux;

    g.lineWidth = Math.max(2, this.hexSize * 0.045);
    g.strokeColor = new Color(255, 202, 58, Math.max(0, alpha));
    g.moveTo(x - ux * tail, y - uy * tail);
    g.lineTo(x, y);
    g.stroke();

    g.lineWidth = Math.max(1, this.hexSize * 0.02);
    g.strokeColor = new Color(255, 248, 170, Math.max(0, Math.round(alpha * 0.95)));
    g.moveTo(x - ux * tail * 0.52, y - uy * tail * 0.52);
    g.lineTo(x + ux * this.hexSize * 0.08, y + uy * this.hexSize * 0.08);
    g.stroke();

    g.fillColor = new Color(255, 250, 190, Math.max(0, alpha));
    g.circle(x, y, Math.max(2, this.hexSize * 0.045));
    g.fill();

    if (tr.phase === 'ricochet') {
      this.drawProjectileSpark(g, tr.impactX, tr.impactY, tr, p);
      g.strokeColor = new Color(255, 226, 120, Math.max(0, Math.round(150 * (1 - p))));
      g.lineWidth = Math.max(1, this.hexSize * 0.018);
      g.moveTo(tr.impactX + rx * this.hexSize * 0.08, tr.impactY + ry * this.hexSize * 0.08);
      g.lineTo(tr.impactX - rx * this.hexSize * 0.08, tr.impactY - ry * this.hexSize * 0.08);
      g.stroke();
    }
    if (tr.phase === 'overpenetration') {
      this.drawProjectileSpark(g, tr.exitX, tr.exitY, tr, p * 0.72);
      const jetFade = Math.max(0, 1 - p);
      g.strokeColor = new Color(255, 116, 38, Math.round(225 * jetFade));
      g.lineWidth = Math.max(2, this.hexSize * 0.03);
      for (let i = -1; i <= 1; i++) {
        const spread = i * this.hexSize * 0.055 * p;
        g.moveTo(x - ux * this.hexSize * 0.16 + rx * spread, y - uy * this.hexSize * 0.16 + ry * spread);
        g.lineTo(x + ux * this.hexSize * 0.12 + rx * spread, y + uy * this.hexSize * 0.12 + ry * spread);
        g.stroke();
      }
    }
  }

  private drawProjectileSpark(g: Graphics, x: number, y: number, tr: ProjectileTrace, p: number) {
    const alpha = Math.max(0, Math.round(255 * (1 - Math.min(1, p * 2.5))));
    if (alpha <= 0) return;
    const rays = 7;
    const base = this.hexSize * 0.28 * (1 + p * 0.5);
    for (let i = 0; i < rays; i++) {
      const a = ((tr.seed + i * 53) % 360) * Math.PI / 180;
      const len = base * (0.35 + ((tr.seed >>> (i % 8)) & 7) / 10);
      g.strokeColor = i % 2 === 0
        ? new Color(255, 238, 150, alpha)
        : new Color(255, 126, 36, Math.round(alpha * 0.78));
      g.lineWidth = Math.max(1, this.hexSize * 0.014);
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
    g.fillColor = new Color(255, 248, 190, alpha);
    g.circle(x, y, Math.max(2, this.hexSize * 0.055));
    g.fill();
  }

  private drawProjectilePenetration(g: Graphics, tr: ProjectileTrace, p: number) {
    const alpha = Math.max(0, Math.round(255 * (1 - p)));
    const sparkLength = this.hexSize * (0.20 + p * 0.30);
    const x = tr.impactX;
    const y = tr.impactY;
    const ux = tr.ux;
    const uy = tr.uy;
    const rx = uy;
    const ry = -ux;

    // Compact metal sparks and an entry hole replace the old orange cone. The
    // cone looked like a second muzzle flash attached to the struck vehicle.
    const rays = 9;
    for (let i = 0; i < rays; i++) {
      const spread = (this.seededUnit(tr.seed, 140 + i) - 0.5) * Math.PI * 1.25;
      const forward = -0.25 - this.seededUnit(tr.seed, 160 + i) * 0.75;
      const sx = ux * forward + rx * Math.sin(spread);
      const sy = uy * forward + ry * Math.sin(spread);
      const mag = Math.max(0.01, Math.hypot(sx, sy));
      const len = sparkLength * (0.45 + this.seededUnit(tr.seed, 180 + i) * 0.75);
      g.strokeColor = i % 3 === 0
        ? new Color(255, 250, 210, alpha)
        : new Color(255, 158, 48, Math.round(alpha * 0.82));
      g.lineWidth = Math.max(1, this.hexSize * (i % 3 === 0 ? 0.018 : 0.012));
      g.moveTo(x, y);
      g.lineTo(x + sx / mag * len, y + sy / mag * len);
      g.stroke();
    }

    g.strokeColor = new Color(255, 212, 112, Math.round(alpha * 0.55));
    g.lineWidth = Math.max(1, this.hexSize * 0.014);
    g.circle(x, y, this.hexSize * (0.10 + p * 0.19));
    g.stroke();
    g.fillColor = new Color(48, 42, 35, Math.round(alpha * 0.90));
    g.circle(x, y, Math.max(2.5, this.hexSize * 0.052));
    g.fill();
    g.fillColor = new Color(255, 250, 218, alpha);
    g.circle(x - ux * this.hexSize * 0.012, y - uy * this.hexSize * 0.012, Math.max(1.5, this.hexSize * 0.022));
    g.fill();
  }

  private clearProjectileTraces() {
    for (const tr of this.projectileTraces) tr.node.destroy();
    this.projectileTraces.length = 0;
  }

  private advanceMachineGunBursts(dt: number) {
    for (let i = this.machineGunBursts.length - 1; i >= 0; i--) {
      const b = this.machineGunBursts[i];
      b.t += dt;
      const p = Math.min(b.t / b.dur, 1);
      if (p >= 1) {
        b.node.destroy();
        this.machineGunBursts.splice(i, 1);
        continue;
      }
      this.drawMachineGunBurst(b, p);
    }
  }

  private drawMachineGunBurst(b: MachineGunBurst, p: number) {
    const g = b.g;
    this.placeProjectileTraceNode(b.node);
    g.clear();

    const dist = Math.hypot(b.targetX - b.startX, b.targetY - b.startY);
    if (dist <= 1) return;
    const nx = -b.uy;
    const ny = b.ux;
    const shots = 15;
    const maxScatterAngle = 7 * Math.PI / 180;
    const maxPerpByAngle = Math.tan(maxScatterAngle) * dist;
    const maxPerp = Math.min(this.hexSize * 0.42, maxPerpByAngle);
    const endpoints = orderMachineGunBurstEndpointsByLateralOffset(
      Array.from({ length: shots }, (_, shotIndex) => {
        const r0 = this.seededUnit(b.seed, shotIndex * 4 + 0);
        const r1 = this.seededUnit(b.seed, shotIndex * 4 + 1);
        const r2 = this.seededUnit(b.seed, shotIndex * 4 + 2);
        const r3 = this.seededUnit(b.seed, shotIndex * 4 + 3);
        const endPerp = (r0 - 0.5) * 2 * maxPerp;
        const endForward = (r3 - 0.5) * this.hexSize * 0.18;
        return {
          x: b.targetX + b.ux * endForward + nx * endPerp,
          y: b.targetY + b.uy * endForward + ny * endPerp,
          lateralOffset: endPerp,
          shotIndex,
          r1,
          r2,
          r3,
        };
      }),
    );

    for (let sequenceIndex = 0; sequenceIndex < endpoints.length; sequenceIndex++) {
      const endpoint = endpoints[sequenceIndex];
      const shotStart = sequenceIndex * 0.035;
      const shotP = (p - shotStart) / 0.36;
      if (shotP < 0 || shotP > 1) continue;

      const { x: endX, y: endY, r1, r2, r3 } = endpoint;
      const shotDx = endX - b.startX;
      const shotDy = endY - b.startY;
      const shotLen = Math.hypot(shotDx, shotDy) || 1;
      const shotUx = shotDx / shotLen;
      const shotUy = shotDy / shotLen;
      const travel = Math.min(1, shotP * 2.25);
      const headX = b.startX + shotDx * travel;
      const headY = b.startY + shotDy * travel;
      const tail = this.hexSize * (0.54 + r1 * 0.36);
      const distanceFromMuzzle = shotLen * travel;
      const glowTail = clampMachineGunTracerTail(tail * 1.08, distanceFromMuzzle);
      const coreTail = clampMachineGunTracerTail(tail, distanceFromMuzzle);
      const fade = Math.max(0, Math.min(1, (1 - shotP) / 0.55));
      const alpha = Math.round(255 * Math.min(1, shotP * 7) * fade);
      if (alpha <= 0) continue;

      g.lineWidth = Math.max(2.2, this.hexSize * 0.038);
      g.strokeColor = new Color(255, 186, 44, Math.round(alpha * 0.72));
      g.moveTo(headX - shotUx * glowTail, headY - shotUy * glowTail);
      g.lineTo(headX + shotUx * this.hexSize * 0.04, headY + shotUy * this.hexSize * 0.04);
      g.stroke();

      g.lineWidth = Math.max(1.4, this.hexSize * 0.022);
      g.strokeColor = new Color(255, 244, 150, alpha);
      g.moveTo(headX - shotUx * coreTail, headY - shotUy * coreTail);
      g.lineTo(headX, headY);
      g.stroke();

      if (travel > 0.9) {
        const dustP = Math.min(1, (travel - 0.9) / 0.1);
        const dustAlpha = Math.round((b.hit ? 210 : 165) * (1 - dustP) * fade);
        if (dustAlpha > 0) {
          const impactJitter = (r2 - 0.5) * this.hexSize * 0.08;
          const dustX = endX + nx * impactJitter + shotUx * this.hexSize * 0.08 * dustP;
          const dustY = endY + ny * impactJitter + shotUy * this.hexSize * 0.08 * dustP;
          g.fillColor = new Color(164, 136, 88, dustAlpha);
          g.circle(dustX, dustY, this.hexSize * (0.075 + dustP * 0.07));
          g.fill();

          g.strokeColor = new Color(255, 224, 120, Math.round(dustAlpha * 0.86));
          g.lineWidth = Math.max(1.2, this.hexSize * 0.014);
          const sparkLen = this.hexSize * (0.10 + r3 * 0.08) * (1 - dustP);
          g.moveTo(dustX - nx * sparkLen, dustY - ny * sparkLen);
          g.lineTo(dustX + nx * sparkLen, dustY + ny * sparkLen);
          g.stroke();
        }
      }
    }
  }

  private clearMachineGunBursts() {
    for (const b of this.machineGunBursts) b.node.destroy();
    this.machineGunBursts.length = 0;
  }

  private advanceInfantryBulletVolleys(dt: number) {
    for (let i = this.infantryBulletVolleys.length - 1; i >= 0; i--) {
      const volley = this.infantryBulletVolleys[i];
      volley.t += dt;
      const p = Math.min(volley.t / volley.dur, 1);
      if (p >= 1) {
        volley.node.destroy();
        this.infantryBulletVolleys.splice(i, 1);
        continue;
      }
      this.drawInfantryBulletVolley(volley, p);
    }
  }

  private drawInfantryBulletVolley(volley: InfantryBulletVolley, p: number) {
    const g = volley.g;
    this.placeProjectileTraceNode(volley.node);
    g.clear();

    // Three short rounds per rifle make the supplied burst audio read clearly,
    // while every round stays on its soldier's parallel lane.
    for (let round = 0; round < 3; round++) {
      const roundP = (p - round * 0.13) / 0.74;
      if (roundP < 0 || roundP > 1) continue;
      const travel = Math.min(1, roundP * 1.55);
      const fade = Math.max(0, Math.min(1, (1 - roundP) / 0.32));
      const alpha = Math.round(255 * Math.min(1, roundP * 10) * fade);
      if (alpha <= 0) continue;

      for (const lane of volley.lanes) {
        const dx = lane.targetX - lane.startX;
        const dy = lane.targetY - lane.startY;
        const headX = lane.startX + dx * travel;
        const headY = lane.startY + dy * travel;
        const distanceFromMuzzle = Math.hypot(dx, dy) * travel;
        const tail = clampMachineGunTracerTail(this.hexSize * 0.44, distanceFromMuzzle);

        g.lineWidth = Math.max(2, this.hexSize * 0.032);
        g.strokeColor = new Color(255, 178, 38, Math.round(alpha * 0.68));
        g.moveTo(headX - volley.ux * tail * 1.15, headY - volley.uy * tail * 1.15);
        g.lineTo(headX + volley.ux * this.hexSize * 0.035, headY + volley.uy * this.hexSize * 0.035);
        g.stroke();

        g.lineWidth = Math.max(1.2, this.hexSize * 0.018);
        g.strokeColor = new Color(255, 246, 164, alpha);
        g.moveTo(headX - volley.ux * tail, headY - volley.uy * tail);
        g.lineTo(headX, headY);
        g.stroke();
      }
    }
  }

  private clearInfantryBulletVolleys() {
    for (const volley of this.infantryBulletVolleys) volley.node.destroy();
    this.infantryBulletVolleys.length = 0;
  }

  /** One member of the squad operates the launcher; the other sprites stay untouched. */
  private spawnInfantryRocketTrace(
    attacker: Unit,
    target: Unit,
    report?: Pick<AttackReport, 'hit' | 'penetrated' | 'roll'>,
  ) {
    if (!this.mapNode || attacker.destroyed || !this.isUnitVisible(attacker)) return;
    const a = this.project(attacker.pos.q, attacker.pos.r);
    const b = this.project(target.pos.q, target.pos.r);
    const offsets = infantrySquadOffsets(this.hexSize, this.infantrySharesHexWithOtherUnit(attacker));
    const seed = this.hashStringToSeed(`infantry-rocket:${attacker.id}:${target.id}:${report?.roll ?? 0}`);
    const shooterOffset = offsets[seed % offsets.length] ?? { ox: 0, oy: 0 };
    const soldierX = a.x + shooterOffset.ox;
    const soldierY = a.y + shooterOffset.oy;

    // Adjacent attacks aim along the hex-to-hex line. Same-hex hardcore
    // attacks aim from the chosen squad member toward the tank centre.
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if (Math.hypot(dx, dy) <= 1) {
      dx = b.x - soldierX;
      dy = b.y - soldierY;
    }
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const startX = soldierX + ux * this.hexSize * 0.16;
    const startY = soldierY + uy * this.hexSize * 0.16;
    const mode: ProjectileTraceMode = !report?.hit
      ? 'miss'
      : report.penetrated
        ? 'penetration'
        : 'ricochet';
    const targetInset = this.hexSize * 0.18;
    const impactX = b.x - ux * targetInset;
    const impactY = b.y - uy * targetInset;
    const missSide = (this.seededUnit(seed, 1) - 0.5) * this.hexSize * 0.42;
    const endX = mode === 'miss' ? b.x + ux * this.hexSize * 0.52 + nx * missSide : impactX;
    const endY = mode === 'miss' ? b.y + uy * this.hexSize * 0.52 + ny * missSide : impactY;
    const bounceSign = (seed & 1) === 0 ? 1 : -1;
    const bounceAngle = Math.atan2(uy, ux) + bounceSign * (0.68 + this.seededUnit(seed, 2) * 0.28);
    const flightDistance = Math.hypot(endX - startX, endY - startY);
    const flightDur = Math.max(0.25, Math.min(0.42, flightDistance / Math.max(1, this.hexSize * 9)));

    const n = new Node('InfantryRocketTrace');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(1, 1);
    ut.setAnchorPoint(0.5, 0.5);
    const g = n.addComponent(Graphics);
    this.mapNode.addChild(n);
    n.setPosition(0, 0, 0);
    this.placeProjectileTraceNode(n);

    const trace: InfantryRocketTrace = {
      node: n, g, mode, startX, startY, impactX, impactY, endX, endY, ux, uy,
      bounceUx: Math.cos(bounceAngle), bounceUy: Math.sin(bounceAngle),
      t: 0, flightDur, dur: flightDur + 0.58, seed, impactSoundPlayed: false,
    };
    this.drawInfantryRocketTrace(trace);
    this.infantryRocketTraces.push(trace);
  }

  private advanceInfantryRocketTraces(dt: number) {
    for (let i = this.infantryRocketTraces.length - 1; i >= 0; i--) {
      const trace = this.infantryRocketTraces[i];
      trace.t += Math.max(0, dt);
      if (!trace.impactSoundPlayed && trace.t >= trace.flightDur) {
        trace.impactSoundPlayed = true;
        if (trace.mode === 'penetration') {
          trace.onPenetrationImpact?.();
          playTankHitPenetration();
        }
        else if (trace.mode === 'ricochet') playTankHitRicochet();
      }
      if (trace.t >= trace.dur) {
        trace.node.destroy();
        this.infantryRocketTraces.splice(i, 1);
        continue;
      }
      this.drawInfantryRocketTrace(trace);
    }
  }

  private drawInfantryRocketTrace(trace: InfantryRocketTrace) {
    const g = trace.g;
    this.placeProjectileTraceNode(trace.node);
    g.clear();
    const launchAge = trace.t;
    const nx = -trace.uy;
    const ny = trace.ux;

    // A short launcher tube makes it unambiguous which single squad member
    // fired, without changing any infantry sprite or formation facing.
    if (launchAge < 0.20) {
      const fade = 1 - launchAge / 0.20;
      const tubeBackX = trace.startX - trace.ux * this.hexSize * 0.28;
      const tubeBackY = trace.startY - trace.uy * this.hexSize * 0.28;
      g.lineWidth = Math.max(3, this.hexSize * 0.050);
      g.strokeColor = new Color(38, 42, 29, Math.round(245 * fade));
      g.moveTo(tubeBackX, tubeBackY);
      g.lineTo(trace.startX, trace.startY);
      g.stroke();
      g.lineWidth = Math.max(1.2, this.hexSize * 0.018);
      g.strokeColor = new Color(151, 144, 98, Math.round(230 * fade));
      g.moveTo(tubeBackX, tubeBackY);
      g.lineTo(trace.startX, trace.startY);
      g.stroke();

      const flash = Math.max(0, 1 - launchAge / 0.11);
      if (flash > 0) {
        g.fillColor = new Color(255, 247, 196, Math.round(255 * flash));
        g.circle(trace.startX + trace.ux * this.hexSize * 0.035, trace.startY + trace.uy * this.hexSize * 0.035, this.hexSize * (0.055 + flash * 0.045));
        g.fill();
        for (let i = 0; i < 5; i++) {
          const back = this.hexSize * (0.14 + i * 0.065);
          const spread = (this.seededUnit(trace.seed, 20 + i) - 0.5) * this.hexSize * 0.22 * (i / 4);
          const x = tubeBackX - trace.ux * back + nx * spread;
          const y = tubeBackY - trace.uy * back + ny * spread;
          g.fillColor = new Color(157, 143, 112, Math.round((150 - i * 16) * flash));
          g.circle(x, y, this.hexSize * (0.055 + i * 0.018));
          g.fill();
        }
      }
    }

    if (trace.t < trace.flightDur) {
      const launchDelay = 0.055;
      const travel = Math.max(0, Math.min(1, (trace.t - launchDelay) / Math.max(0.01, trace.flightDur - launchDelay)));
      if (travel <= 0) return;
      const headX = trace.startX + (trace.endX - trace.startX) * travel;
      const headY = trace.startY + (trace.endY - trace.startY) * travel;
      const travelled = Math.hypot(headX - trace.startX, headY - trace.startY);
      const smokeCount = 9;
      for (let i = 0; i < smokeCount; i++) {
        const alongP = (i + 0.35) / smokeCount;
        if (alongP > travel) continue;
        const ageBehindHead = travel - alongP;
        const alpha = Math.round(170 * Math.max(0, 1 - ageBehindHead * 1.65) * Math.min(1, alongP * 8));
        const jitter = (this.seededUnit(trace.seed, 40 + i) - 0.5) * this.hexSize * 0.075;
        const x = trace.startX + (trace.endX - trace.startX) * alongP + nx * jitter;
        const y = trace.startY + (trace.endY - trace.startY) * alongP + ny * jitter;
        g.fillColor = new Color(210, 207, 190, alpha);
        g.circle(x, y, this.hexSize * (0.045 + this.seededUnit(trace.seed, 60 + i) * 0.035));
        g.fill();
      }
      const body = Math.min(this.hexSize * 0.14, travelled);
      g.lineWidth = Math.max(3, this.hexSize * 0.040);
      g.strokeColor = new Color(44, 42, 31, 250);
      g.moveTo(headX - trace.ux * body, headY - trace.uy * body);
      g.lineTo(headX, headY);
      g.stroke();
      g.fillColor = new Color(255, 246, 188, 255);
      g.circle(headX, headY, Math.max(2, this.hexSize * 0.035));
      g.fill();
      return;
    }

    const impactAge = trace.t - trace.flightDur;
    const impactX = trace.mode === 'miss' ? trace.endX : trace.impactX;
    const impactY = trace.mode === 'miss' ? trace.endY : trace.impactY;
    if (trace.mode === 'miss') {
      const fade = Math.max(0, 1 - impactAge / 0.48);
      g.fillColor = new Color(121, 101, 72, Math.round(155 * fade));
      for (let i = 0; i < 5; i++) {
        const angle = this.seededUnit(trace.seed, 80 + i) * Math.PI * 2;
        const radius = this.hexSize * impactAge * (0.16 + i * 0.055);
        g.circle(impactX + Math.cos(angle) * radius, impactY + Math.sin(angle) * radius, this.hexSize * (0.065 + impactAge * 0.09));
        g.fill();
      }
      return;
    }

    const flashFade = Math.max(0, 1 - impactAge / 0.24);
    const coreRadius = this.hexSize * (0.075 + Math.min(impactAge, 0.18) * 0.28);
    if (flashFade > 0) {
      g.fillColor = new Color(255, 247, 198, Math.round(255 * flashFade));
      g.circle(impactX, impactY, coreRadius);
      g.fill();
      const rayCount = trace.mode === 'ricochet' ? 11 : 8;
      for (let i = 0; i < rayCount; i++) {
        const base = trace.mode === 'ricochet'
          ? Math.atan2(trace.bounceUy, trace.bounceUx) + (this.seededUnit(trace.seed, 100 + i) - 0.5) * 1.05
          : this.seededUnit(trace.seed, 100 + i) * Math.PI * 2;
        const length = this.hexSize * (0.12 + this.seededUnit(trace.seed, 120 + i) * 0.22) * flashFade;
        g.strokeColor = new Color(255, i % 2 ? 156 : 231, 64, Math.round(235 * flashFade));
        g.lineWidth = Math.max(1, this.hexSize * 0.015);
        g.moveTo(impactX, impactY);
        g.lineTo(impactX + Math.cos(base) * length, impactY + Math.sin(base) * length);
        g.stroke();
      }
    }

    if (trace.mode === 'ricochet' && impactAge < 0.28) {
      const travel = impactAge / 0.28;
      const x = impactX + trace.bounceUx * this.hexSize * 0.52 * travel;
      const y = impactY + trace.bounceUy * this.hexSize * 0.52 * travel;
      g.strokeColor = new Color(255, 174, 46, Math.round(230 * (1 - travel)));
      g.lineWidth = Math.max(2, this.hexSize * 0.025);
      g.moveTo(x - trace.bounceUx * this.hexSize * 0.14, y - trace.bounceUy * this.hexSize * 0.14);
      g.lineTo(x, y);
      g.stroke();
      return;
    }

    if (trace.mode === 'penetration') {
      const smokeFade = Math.max(0, 1 - impactAge / 0.58);
      if (smokeFade > 0) {
        g.fillColor = new Color(35, 31, 27, Math.round(145 * smokeFade));
        g.circle(impactX - trace.ux * this.hexSize * 0.03, impactY - trace.uy * this.hexSize * 0.03 + impactAge * this.hexSize * 0.12, this.hexSize * (0.08 + impactAge * 0.12));
        g.fill();
        g.fillColor = new Color(255, 112, 28, Math.round(210 * Math.max(0, 1 - impactAge / 0.30)));
        g.circle(impactX, impactY, this.hexSize * 0.055);
        g.fill();
      }
    }
  }

  private clearInfantryRocketTraces() {
    for (const trace of this.infantryRocketTraces) trace.node.destroy();
    this.infantryRocketTraces.length = 0;
  }

  private playTurnEndSniperShot(attacker: Unit, target: Unit, onImpact: () => void) {
    this.rememberAttackPosition(attacker);
    this.setInfantryVisualFacing(attacker, target.pos);
    this.redraw();
    this.spawnSniperBulletTrace(attacker, target, onImpact);
    playSniperFire();
  }

  /** One actual member of the triggering infantry squad fires one guaranteed-hit round. */
  private spawnSniperBulletTrace(attacker: Unit, target: Unit, onImpact: () => void) {
    if (!this.mapNode || attacker.destroyed || !isFootUnit(attacker)) return;
    const a = this.project(attacker.pos.q, attacker.pos.r);
    const b = this.project(target.pos.q, target.pos.r);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len <= 1) return;
    const ux = dx / len;
    const uy = dy / len;
    const squadOffsets = infantrySquadOffsets(this.hexSize, this.infantrySharesHexWithOtherUnit(attacker));
    const shooterIndex = this.hashStringToSeed(`sniper:${attacker.id}`) % squadOffsets.length;
    const shooterOffset = attacker.kind === 'officer'
      ? { ox: 0, oy: 0 }
      : squadOffsets[shooterIndex];
    const muzzleForward = Math.max(5, this.hexSize * 0.10);
    const targetInset = Math.max(5, this.hexSize * 0.08);

    const n = new Node('SniperBulletTrace');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(1, 1);
    ut.setAnchorPoint(0.5, 0.5);
    const g = n.addComponent(Graphics);
    this.mapNode.addChild(n);
    n.setPosition(0, 0, 0);
    this.placeProjectileTraceNode(n);

    const trace: SniperBulletTrace = {
      node: n,
      g,
      startX: a.x + shooterOffset.ox + ux * muzzleForward,
      startY: a.y + shooterOffset.oy + uy * muzzleForward,
      targetX: b.x - ux * targetInset,
      targetY: b.y - uy * targetInset,
      ux,
      uy,
      t: 0,
      dur: 0.56,
      impacted: false,
      onImpact,
    };
    this.drawSniperBulletTrace(trace, 0);
    this.sniperBulletTraces.push(trace);
  }

  private advanceSniperBulletTraces(dt: number) {
    for (let i = this.sniperBulletTraces.length - 1; i >= 0; i--) {
      const trace = this.sniperBulletTraces[i];
      trace.t += dt;
      const p = Math.min(trace.t / trace.dur, 1);
      if (!trace.impacted && p >= 0.68) {
        trace.impacted = true;
        trace.onImpact();
      }
      if (p >= 1) {
        trace.node.destroy();
        this.sniperBulletTraces.splice(i, 1);
        continue;
      }
      this.drawSniperBulletTrace(trace, p);
    }
  }

  private drawSniperBulletTrace(trace: SniperBulletTrace, p: number) {
    const g = trace.g;
    this.placeProjectileTraceNode(trace.node);
    g.clear();
    const flightEnd = 0.68;

    if (p < flightEnd) {
      const travel = p / flightEnd;
      const headX = trace.startX + (trace.targetX - trace.startX) * travel;
      const headY = trace.startY + (trace.targetY - trace.startY) * travel;
      const distanceFromMuzzle = Math.hypot(trace.targetX - trace.startX, trace.targetY - trace.startY) * travel;
      const tail = clampMachineGunTracerTail(this.hexSize * 0.72, distanceFromMuzzle);
      const alpha = Math.round(255 * Math.min(1, travel * 10));

      g.lineWidth = Math.max(2.6, this.hexSize * 0.042);
      g.strokeColor = new Color(255, 154, 28, Math.round(alpha * 0.72));
      g.moveTo(headX - trace.ux * tail * 1.18, headY - trace.uy * tail * 1.18);
      g.lineTo(headX + trace.ux * this.hexSize * 0.05, headY + trace.uy * this.hexSize * 0.05);
      g.stroke();
      g.lineWidth = Math.max(1.4, this.hexSize * 0.021);
      g.strokeColor = new Color(255, 250, 188, alpha);
      g.moveTo(headX - trace.ux * tail, headY - trace.uy * tail);
      g.lineTo(headX, headY);
      g.stroke();

      if (p < 0.12) {
        const flash = 1 - p / 0.12;
        g.fillColor = new Color(255, 230, 112, Math.round(230 * flash));
        g.circle(trace.startX, trace.startY, this.hexSize * (0.06 + flash * 0.05));
        g.fill();
      }
      return;
    }

    const impactP = (p - flightEnd) / (1 - flightEnd);
    const alpha = Math.round(255 * (1 - impactP));
    const nx = -trace.uy;
    const ny = trace.ux;
    g.fillColor = new Color(255, 238, 146, alpha);
    g.circle(trace.targetX, trace.targetY, this.hexSize * (0.055 + impactP * 0.09));
    g.fill();
    for (let i = 0; i < 6; i++) {
      const along = (i % 2 === 0 ? 1 : -1) * this.hexSize * (0.10 + impactP * 0.10);
      const side = (i - 2.5) * this.hexSize * 0.025;
      g.strokeColor = new Color(255, i % 2 === 0 ? 226 : 150, 66, alpha);
      g.lineWidth = Math.max(1, this.hexSize * 0.015);
      g.moveTo(trace.targetX, trace.targetY);
      g.lineTo(trace.targetX + trace.ux * along + nx * side, trace.targetY + trace.uy * along + ny * side);
      g.stroke();
    }
  }

  private clearSniperBulletTraces() {
    for (const trace of this.sniperBulletTraces) trace.node.destroy();
    this.sniperBulletTraces.length = 0;
  }

  private seededUnit(seed: number, index: number): number {
    let x = (seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d) >>> 0;
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b) >>> 0;
    x ^= x >>> 16;
    return (x >>> 0) / 0xffffffff;
  }

  private placeProjectileTraceNode(node: Node) {
    const mapNode = this.mapNode;
    if (!mapNode || node.parent !== mapNode) return;
    if (this.fogNode?.parent === mapNode) {
      node.setSiblingIndex(Math.max(0, this.fogNode.getSiblingIndex()));
      return;
    }
    node.setSiblingIndex(mapNode.children.length - 1);
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
      this.setInfantryVisualFacing(u, { q: this.anim.toQ, r: this.anim.toR });
      const k = easeOutCubic(this.anim.t);
      const a = this.project(this.anim.fromQ, this.anim.fromR);
      const b = this.project(this.anim.toQ, this.anim.toR);
      this.drawUnit(u, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
    } else {
      this.drawUnit(u);
    }
  }

  /**
   * Plays a Stuka across the target row. `attackerIsPlayer` makes the same
   * presentation usable by future player/PvP air-strike events.
   */
  private playStukaFlyover(target: Unit, attackerIsPlayer: boolean, onDone: () => void) {
    if (!this.mission || !this.mapNode || this.stukaFlyover) {
      onDone();
      return;
    }
    const targetPoint = this.project(target.pos.q, target.pos.r);
    const mapPos = this.mapNode.position;
    const screenLeft = -CANVAS_W / 2;
    const screenRight = CANVAS_W / 2;
    // Keep the whole 150%-sized aircraft outside the canvas at both ends.
    const offscreenPad = this.hexSize * 1.2;
    const fromX = attackerIsPlayer
      ? screenLeft - offscreenPad
      : screenRight + offscreenPad;
    const toX = attackerIsPlayer
      ? screenRight + offscreenPad
      : screenLeft - offscreenPad;
    this.stukaFlyover = {
      target: { ...target.pos }, fromX, toX, y: targetPoint.y + mapPos.y,
      t: 0, dur: 4, cannonT: -1,
      cannonSeed: this.hashStringToSeed(`stuka:${target.id}:${this.turn}`),
      onDone,
    };
    if (this.stukaSpriteNode) {
      this.stukaSpriteNode.active = true;
    }
    playStukaFlyover();
  }

  private advanceStukaFlyover(dt: number) {
    const pass = this.stukaFlyover;
    if (!pass) return;
    pass.t += dt;
    const p = Math.min(1, pass.t / pass.dur);
    const x = pass.fromX + (pass.toX - pass.fromX) * p;
    const targetX = this.project(pass.target.q, pass.target.r).x
      + (this.mapNode?.position.x ?? 0);
    const direction = pass.toX < pass.fromX ? -1 : 1;
    // Start roughly three hexes before the target, so the plane is still
    // approaching while its cannon tracers converge on the tank.
    const attackLead = this.hexSize * Math.sqrt(3) * 3;
    const attackStartX = targetX - direction * attackLead;
    if (pass.cannonT < 0 && (direction < 0 ? x <= attackStartX : x >= attackStartX)) {
      pass.cannonT = 0;
    }
    if (pass.cannonT >= 0) {
      pass.cannonT += dt;
      // The Ju 87 G attacks with its BK 3.7 cannon pods.  The visuals are
      // deliberately a compact burst: combat resolution stays unchanged.
      this.drawStukaCannonBurst(pass);
    }
    const plane = this.stukaSpriteNode;
    if (plane) {
      const sprite = plane.getComponent(Sprite);
      const transform = plane.getComponent(UITransform);
      if (sprite?.spriteFrame && transform) {
        // 150% of the original 1.35-hex presentation size.
        transform.setContentSize(this.hexSize * 2.025, this.hexSize * 2.025);
      }
      plane.setPosition(x, pass.y, 0);
      // The source art's nose/propeller points right (+X); its tail is on the
      // left. Align that authored forward vector with the horizontal velocity.
      plane.angle = pass.toX < pass.fromX ? 180 : 0;
      plane.setScale(1, 1, 1);
    }
    if (p < 1) return;
    if (plane) plane.active = false;
    if (this.stukaBlastNode) this.stukaBlastNode.active = false;
    this.stukaFlyover = null;
    pass.onDone();
  }

  /**
   * Draw a short BK 3.7 cannon sweep directly over the tank.  It is kept on a
   * screen-space overlay so it stays readable above the unit sprite while the
   * map/camera moves.  Eight visible tracers stand in for the full fire rate.
   */
  private drawStukaCannonBurst(pass: StukaFlyover) {
    const node = this.stukaBlastNode;
    const g = this.stukaBlastGraphics;
    if (!node || !g || !this.mapNode) return;

    g.clear();
    node.active = true;
    const target = this.project(pass.target.q, pass.target.r);
    const mapPos = this.mapNode.position;
    const targetX = target.x + mapPos.x;
    const targetY = target.y + mapPos.y;
    const cannonStartT = pass.t - pass.cannonT;
    const direction = pass.toX < pass.fromX ? -1 : 1;
    const shots = 8;
    const shotGap = 0.075;
    const flightDur = 0.12;

    for (let i = 0; i < shots; i++) {
      const shotStart = i * shotGap;
      const age = pass.cannonT - shotStart;
      if (age < 0 || age > 0.78) continue;
      const lateral = (this.seededUnit(pass.cannonSeed, i * 5) - 0.5) * this.hexSize * 0.52;
      const forward = (this.seededUnit(pass.cannonSeed, i * 5 + 1) - 0.5) * this.hexSize * 0.30;
      const impactX = targetX + lateral;
      const impactY = targetY + forward;
      const launchP = Math.max(0, Math.min(1, (cannonStartT + shotStart) / pass.dur));
      const launchX = pass.fromX + (pass.toX - pass.fromX) * launchP;
      const launchY = pass.y + (i % 2 === 0 ? -1 : 1) * this.hexSize * 0.13;

      if (age <= flightDur) {
        const travel = age / flightDur;
        const headX = launchX + (impactX - launchX) * travel;
        const headY = launchY + (impactY - launchY) * travel;
        const dx = impactX - launchX;
        const dy = impactY - launchY;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const tail = Math.min(this.hexSize * 0.7, len * 0.30);
        g.lineWidth = Math.max(2, this.hexSize * 0.035);
        g.strokeColor = new Color(255, 166, 36, 218);
        g.moveTo(headX - ux * tail, headY - uy * tail);
        g.lineTo(headX, headY);
        g.stroke();
        g.lineWidth = Math.max(1, this.hexSize * 0.016);
        g.strokeColor = new Color(255, 247, 176, 250);
        g.moveTo(headX - ux * tail * 0.62, headY - uy * tail * 0.62);
        g.lineTo(headX + ux * this.hexSize * 0.04, headY + uy * this.hexSize * 0.04);
        g.stroke();
        continue;
      }

      const impactAge = age - flightDur;
      const sparkFade = Math.max(0, 1 - impactAge / 0.24);
      const scorchFade = Math.max(0, 1 - impactAge / 0.66);
      const impactSize = this.hexSize * (0.12 + Math.min(impactAge, 0.16) * 0.42);
      if (scorchFade > 0) {
        g.fillColor = new Color(24, 20, 17, Math.round(75 * scorchFade));
        g.ellipse(impactX, impactY, impactSize * 1.45, impactSize * 0.70);
        g.fill();
      }
      if (sparkFade <= 0) continue;

      g.fillColor = new Color(255, 204, 62, Math.round(225 * sparkFade));
      g.circle(impactX, impactY, impactSize);
      g.fill();
      g.fillColor = new Color(255, 249, 204, Math.round(255 * sparkFade));
      g.circle(impactX, impactY, Math.max(1.5, impactSize * 0.42));
      g.fill();
      for (let ray = 0; ray < 6; ray++) {
        const angle = (ray * Math.PI * 2 / 6) + this.seededUnit(pass.cannonSeed, i * 11 + ray + 2) * 0.5;
        const length = impactSize * (1.8 + this.seededUnit(pass.cannonSeed, i * 13 + ray) * 1.5) * sparkFade;
        g.strokeColor = ray % 2 === 0
          ? new Color(255, 238, 142, Math.round(220 * sparkFade))
          : new Color(255, 104, 28, Math.round(185 * sparkFade));
        g.lineWidth = Math.max(1, this.hexSize * 0.012);
        g.moveTo(impactX, impactY);
        g.lineTo(impactX + Math.cos(angle) * length, impactY + Math.sin(angle) * length);
        g.stroke();
      }

      // A few shells visibly glance away, selling the tank's armour without
      // suggesting every round penetrates.
      if (i % 3 === 1) {
        const ricochetLife = Math.max(0, 1 - impactAge / 0.32);
        const bounceAngle = direction > 0 ? -0.55 : Math.PI + 0.55;
        const bounceLen = this.hexSize * 0.60 * ricochetLife;
        g.strokeColor = new Color(255, 218, 104, Math.round(210 * ricochetLife));
        g.lineWidth = Math.max(1, this.hexSize * 0.018);
        g.moveTo(impactX, impactY);
        g.lineTo(impactX + Math.cos(bounceAngle) * bounceLen, impactY + Math.sin(bounceAngle) * bounceLen);
        g.stroke();
      }
    }

    // A restrained pulse is enough to make the tank feel under sustained fire.
    if (pass.cannonT < 0.72) {
      const pulse = 0.5 + 0.5 * Math.sin(pass.cannonT * Math.PI * 22);
      g.strokeColor = new Color(255, 244, 202, Math.round(42 * pulse));
      g.lineWidth = Math.max(1, this.hexSize * 0.018);
      g.ellipse(targetX, targetY, this.hexSize * 0.40, this.hexSize * 0.25);
      g.stroke();
    }
  }

  private drawStukaBlast(target: Axial, progress: number) {
    const node = this.stukaBlastNode;
    const g = this.stukaBlastGraphics;
    if (!node || !g) return;
    const c = this.project(target.q, target.r);
    const mapPos = this.mapNode?.position ?? Vec3.ZERO;
    const cx = c.x + mapPos.x;
    const cy = c.y + mapPos.y;
    g.clear();
    node.active = true;
    const p = Math.max(0, Math.min(1, progress));
    const expand = 1 - Math.pow(1 - p, 3);
    const flash = Math.max(0, 1 - p / 0.32);
    const fire = Math.max(0, 1 - Math.max(0, p - 0.08) / 0.72);
    const smokeIn = Math.min(1, Math.max(0, (p - 0.10) / 0.28));
    const smokeOut = Math.max(0, 1 - Math.max(0, p - 0.58) / 0.42);
    const smoke = smokeIn * smokeOut;
    const alpha = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
    // Overall blast presentation remains at 180% of its base animated radius.
    const r = this.hexSize * (0.20 + expand * 0.48) * 1.8;

    // Ground dust and heavy brown-black smoke build behind the fireball.
    for (let i = 0; i < 20; i++) {
      const a = i * Math.PI * 2 / 20 + Math.sin(i * 7.31) * 0.10;
      const radial = r * (0.36 + smokeIn * 0.34 + (i % 4) * 0.035);
      const blobR = r * (0.105 + (i % 5) * 0.014 + smokeIn * 0.045);
      const x = cx + Math.cos(a) * radial;
      const y = cy + Math.sin(a) * radial;
      const shade = 38 + (i % 4) * 13;
      g.fillColor = new Color(
        shade + 22,
        Math.max(22, shade - 4),
        Math.max(14, shade - 16),
        alpha(205 * smoke),
      );
      g.circle(x, y, blobR);
      g.fill();
      g.fillColor = new Color(24, 22, 20, alpha(105 * smoke));
      g.circle(x + blobR * 0.18, y + blobR * 0.16, blobR * 0.68);
      g.fill();
    }

    // Fast incandescent jets and darker debris make the impact directional
    // and irregular instead of reading as a geometric sun icon.
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI * 2 / 24 + Math.sin(i * 4.73) * 0.075;
      const inner = r * (0.08 + (i % 3) * 0.018);
      const outer = r * (0.56 + (i % 5) * 0.09) * (0.72 + flash * 0.28);
      g.strokeColor = i % 3 === 0
        ? new Color(255, 248, 185, alpha(255 * fire))
        : new Color(255, 143 + (i % 4) * 18, 18, alpha(235 * fire));
      g.lineWidth = Math.max(2, r * (i % 4 === 0 ? 0.052 : 0.026));
      g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      g.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      g.stroke();
    }
    for (let i = 0; i < 11; i++) {
      const a = i * Math.PI * 2 / 11 + 0.19;
      const inner = r * 0.48;
      const outer = r * (0.76 + (i % 3) * 0.10);
      g.strokeColor = new Color(48, 32, 22, alpha(175 * smoke));
      g.lineWidth = Math.max(2, r * 0.025);
      g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      g.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      g.stroke();
    }

    // Overlapping lobes form an uneven orange-red fireball.
    for (let i = 0; i < 15; i++) {
      const a = i * Math.PI * 2 / 15 + Math.sin(i * 2.17) * 0.12;
      const radial = r * (0.20 + (i % 4) * 0.025);
      const blobR = r * (0.17 + (i % 3) * 0.025);
      const hot = i % 3 === 0;
      g.fillColor = hot
        ? new Color(255, 190, 35, alpha(238 * fire))
        : new Color(224, 66 + (i % 4) * 13, 15, alpha(220 * fire));
      g.circle(cx + Math.cos(a) * radial, cy + Math.sin(a) * radial, blobR);
      g.fill();
    }

    // White-hot center peaks immediately, then reveals the orange core.
    g.fillColor = new Color(255, 116, 16, alpha(235 * fire));
    g.circle(cx, cy, r * 0.31);
    g.fill();
    g.fillColor = new Color(255, 224, 82, alpha(250 * Math.max(fire, flash)));
    g.circle(cx, cy, r * (0.19 + flash * 0.07));
    g.fill();
    g.fillColor = new Color(255, 255, 238, alpha(255 * flash));
    g.circle(cx, cy, r * (0.10 + flash * 0.08));
    g.fill();
  }

  update(dt: number) {
    if (this.campaignUpgradeChoiceRoot || this.campaignUpgradeDetailRoot) return;
    this.advanceFogVisionTransition(dt);
    this.advanceEngineVibration(dt);
    this.advanceTankEngineExhaust(dt);
    this.advanceTurnTransition(dt);
    this.advanceStukaFlyover(dt);
    // 浮字和移动动画独立推进：读档/胜负已决时也要让残留浮字自然淡出
    if (this.floaters.length > 0) this.advanceFloaters(dt);
    if (this.muzzleFlashes.length > 0) this.advanceMuzzleFlashes(dt);
    if (this.muzzleSmokes.length > 0) this.advanceMuzzleSmokes(dt);
    if (this.projectileTraces.length > 0) this.advanceProjectileTraces(dt);
    if (this.highExplosiveBlasts.length > 0) this.advanceHighExplosiveBlasts(dt);
    if (this.machineGunBursts.length > 0) this.advanceMachineGunBursts(dt);
    if (this.infantryBulletVolleys.length > 0) this.advanceInfantryBulletVolleys(dt);
    if (this.infantryRocketTraces.length > 0) this.advanceInfantryRocketTraces(dt);
    if (this.sniperBulletTraces.length > 0) this.advanceSniperBulletTraces(dt);
    if (this.mainGunRecoils.size > 0) this.advanceMainGunRecoils(dt);
    this.advanceUnitEffects(dt);
    if (GameSession.isPvp) this.advancePvpTurnTimer();
    if (this.campaignPanAnim) {
      this.advanceCampaignPanAnim(dt);
      return;
    }

    // 攻击掷骰动画：最高优先级推进（在 anim 之前，避免被 return 提前打断）
    if (this.diceShow) {
      this.advanceDiceShow(dt);
      if (this.activeActingUnit) this.redraw();
    }

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
      if (!a.suppressTurretSound) stopTurretTraverseSound();
      a.unit.turretVisualTarget = a.toVisualTarget ? { ...a.toVisualTarget } : undefined;
      if (!a.preserveRuleFacing && a.unit === this.mission?.sherman) {
        this.shermanTurretFacing = a.to;
        a.unit.turretFacing = a.to;
      } else if (!a.preserveRuleFacing
        && (this.enemySupportsSplitTurret(a.unit) || isAntiTankGunUnit(a.unit))) {
        this.enemyTurretFacing.set(a.unit.id, a.to);
        a.unit.turretFacing = a.to;
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

    if (this.enemyDiceResultHold && this.mission && this.enemyDiceTrayRoot) {
      const hold = this.enemyDiceResultHold;
      hold.t += dt;
      if (hold.t < hold.dur) {
        this.refreshEnemyDiceTray();
        this.redraw();
        return;
      }
      this.enemyDiceHighlightIdx = -1;
      this.enemyDiceResultHold = null;
      this.refreshEnemyDiceTray();
      this.redraw();
      const finished = this.enemyOrder[this.enemyIndex];
      if (finished) endAmbushTurn(finished, this.hasSmokeAt(finished.pos));
      this.enemyIndex++;
      this.beginCurrentEnemyTurn();
      return;
    }

    if (!this.anim || !this.mission) return;
    this.beginTankTrackAnimation(this.anim);
    const maneuverSound = (this.anim.kind === 'move' || this.anim.kind === 'turn')
      ? this.anim.unit.stats.moveSound
      : '';
    if (this.anim.t === 0 && maneuverSound) {
      startManeuverSound(maneuverSound);
    }
    if (this.anim.t === 0 && this.anim.kind === 'move' && isFootUnit(this.anim.unit)) {
      playInfantryMove();
    }
    this.anim.t += dt / this.anim.dur;
    this.advanceTankTrackAnimation(this.anim);
    if (this.anim.t < 1) {
      this.redraw();
      return;
    }
    // 动画结束：移动写回格心；转向写回 facing
    const anim = this.anim;
    const finishedUnit = anim.unit;
    this.finishTankTrackAnimation(anim);
    if (anim.kind === 'move') {
      // turretVisualTarget stores an absolute hex only so the renderer can derive
      // an exact visual angle. Move it together with the unit to preserve that
      // world-space heading after movement finishes.
      if (finishedUnit.turretVisualTarget) {
        finishedUnit.turretVisualTarget = {
          q: finishedUnit.turretVisualTarget.q + (anim.toQ - anim.fromQ),
          r: finishedUnit.turretVisualTarget.r + (anim.toR - anim.fromR),
        };
      }
      finishedUnit.pos = { q: anim.toQ, r: anim.toR };
      reconcileDiagonalGunnerSideAfterMove(this.mission!.map, finishedUnit, this.mission!.smokeHexes);
      this.crushEnemyATGunsAt(finishedUnit);
      this.captureAbandonedATGunsAt(finishedUnit);
      this.captureAbandonedTanksAt(finishedUnit);
      if (isAntiTankGunUnit(finishedUnit)) {
        const controller = this.atGunController(finishedUnit);
        if (controller) controller.pos = { ...finishedUnit.pos };
      }
      if (anim.evacExit && this.mission) {
        this.mission.playerTankEvacuated = true;
        this.mission.shermanEvacuated = true;
        this.outcome = this.computeOutcome();
        this.updateOutcomeOverlay();
        this.battleLogI18n('battleLog.unitEvacuated', {
          unitKind: finishedUnit.kind,
          outcome: this.outcome,
        });
      } else if (anim.truckExitDefeat && this.mission && finishedUnit.kind === 'truck') {
        this.mission.truckEscapeDefeat = true;
        this.outcome = this.computeOutcome();
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
    if (anim.kind === 'turn' && finishedUnit === this.mission?.sherman && finishedUnit.facing !== null) {
      const oldTurretFacing = (finishedUnit.turretFacing ?? anim.turnFrom!) as FireDirection;
      const nextTurretFacing = turretFacingAfterHullTurn(oldTurretFacing, anim.turnFrom!, finishedUnit.facing);
      finishedUnit.previousTurretFacing = oldTurretFacing;
      finishedUnit.diagonalGunnerSidePreference = undefined;
      finishedUnit.turretVisualTarget = undefined;
      this.shermanTurretFacing = nextTurretFacing;
      finishedUnit.turretFacing = nextTurretFacing;
    } else if (anim.kind === 'turn' && finishedUnit.stats.visionType === 'turreted' && finishedUnit.facing !== null) {
      const oldTurretFacing = (finishedUnit.turretFacing ?? anim.turnFrom!) as FireDirection;
      const nextTurretFacing = turretFacingAfterHullTurn(oldTurretFacing, anim.turnFrom!, finishedUnit.facing);
      finishedUnit.previousTurretFacing = oldTurretFacing;
      finishedUnit.diagonalGunnerSidePreference = undefined;
      finishedUnit.turretVisualTarget = undefined;
      this.enemyTurretFacing.set(finishedUnit.id, nextTurretFacing);
      finishedUnit.turretFacing = nextTurretFacing;
    }
    const finishManeuverSound = (nextAnim: MoveAnim | null = null) => {
      if (!maneuverSound) return;
      const continuesAsOneNonPlayerMove = finishedUnit !== this.mission!.sherman
        && nextAnim?.unit === finishedUnit
        && (nextAnim.kind === 'move' || nextAnim.kind === 'turn')
        && nextAnim.unit.stats.moveSound === maneuverSound;
      if (!continuesAsOneNonPlayerMove) stopManeuverSound();
    };
    this.anim = null;
    if (this.animQueue.length > 0) {
      this.anim = this.animQueue.shift()!;
      finishManeuverSound(this.anim);
      this.redraw();
      return;
    }
    if (this.drainPvpPendingRemoteSnapshot()) {
      finishManeuverSound(this.anim);
      return;
    }
    if (this.pendingAfterAnimChain) {
      const cb = this.pendingAfterAnimChain;
      this.pendingAfterAnimChain = null;
      cb();
      finishManeuverSound(this.anim);
      return;
    }
    this.redraw();
    if (GameSession.isPvp) {
      finishManeuverSound();
      this.refreshPhaseUI();
      this.updateHUD();
      return;
    }
    if (this.outcome !== 'ongoing') {
      finishManeuverSound();
      this.refreshPhaseUI();
      this.updateHUD();
      return;
    }
    // 若处于敌方阶段，紧接着调度下一颗骰（骰子托盘固定在 UI 上，无需每步重建）
    if (this.phase === 'ally' || this.phase === 'enemy') {
      this.enemyDiceHighlightIdx = -1;
      this.refreshEnemyDiceTray();
      this.runNextEnemyStep();
      finishManeuverSound(this.anim);
      return;
    }
    finishManeuverSound();
    // 玩家移动 / 转向 / 杂项阶段驾驶类动作结束后
    if (this.phase === 'player'
        && (this.playerStep === 'movement' || this.playerStep === 'misc')) {
      this.updateHUD();
      this.completePhaseDiceAction();
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
    const cands: Array<{ dir: number; color: Color }> = [
      { dir: sherman.facing,                    color: DRIVE_FWD_COLOR },
      { dir: rotateDirection(sherman.facing, 3), color: DRIVE_BWD_COLOR },
    ];

    for (const c of cands) {
      const pos = neighbor(sherman.pos, c.dir as 0 | 1 | 2 | 3 | 4 | 5);
      const tile = map.get(pos);
      const dirSign = c.dir === sherman.facing ? 1 : -1;
      const isEvacExit = !GameSession.isPvp && isPlayerTankEvacDrive(this.mission, sherman.pos, sherman.facing as Direction, dirSign as 1 | -1, pos, {
        canExitTo: (target) => this.isCampaignNextSegmentEntry(target),
      });
      const blocked = !isEvacExit && (!tile
        || !this.canMoveToBattleTile(pos)
        || !map.canTankCrossEdge(sherman.pos, pos, { faction: sherman.faction }) // 桥梁边向校验：水域+桥梁需 dir 落在 br 端，详见 GDD §3.2
        || this.findMoveBlocker(sherman, pos) !== null);
      const p = this.project(pos.q, pos.r);
      this.g.strokeColor = blocked ? DRIVE_BLOCKED : c.color;
      this.g.lineWidth = 3;
      this.drawHexOutline(p.x, p.y, this.hexSize - 3);
    }
    this.g.lineWidth = 2;
  }

  /** 六边形路径（moveTo 首顶点 + close） */
  private traceHexPath(cx: number, cy: number, size: number) {
    this.traceHexPathOn(this.g!, cx, cy, size);
  }

  private traceHexPathOn(g: Graphics, cx: number, cy: number, size: number) {
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
    const sf = this.terrainSpriteFrameFor(terrain);
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

  private usesWinterTerrainVisuals(): boolean {
    const data = this.mission?.data;
    return data?.season === 'winter' && (data.theater ?? 'europe') === 'europe';
  }

  private terrainSpriteFrameFor(terrain: TerrainType): SpriteFrame | null {
    if (this.usesWinterTerrainVisuals()) {
      return this.winterTerrainSpriteFrames[terrain] ?? this.terrainSpriteFrames[terrain];
    }
    return this.terrainSpriteFrames[terrain];
  }

  private terrainColorFor(terrain: TerrainType): Color {
    return this.usesWinterTerrainVisuals()
      ? (WINTER_TERRAIN_COLORS[terrain] ?? TERRAIN_COLORS[terrain])
      : TERRAIN_COLORS[terrain];
  }

  private activeTreeSpriteFrames(): Array<SpriteFrame | null> {
    if (!this.usesWinterTerrainVisuals()) return this.treeSpriteFrames;
    return this.winterTreeSpriteFrames.some(Boolean) ? this.winterTreeSpriteFrames : this.treeSpriteFrames;
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
    const previousLineCap = g.lineCap;
    g.lineCap = Graphics.LineCap.ROUND;
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
    g.lineCap = previousLineCap;
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
    for (let i = 0; i < FOREST_CANOPY_LAYOUT.length; i++) {
      const p = FOREST_CANOPY_LAYOUT[i];
      const x = cx + (p.ox + (rng.next() - 0.5) * 0.05) * s;
      const y = cy + (p.oy + (rng.next() - 0.5) * 0.05) * s;
      const scale = p.scale * (0.92 + rng.next() * 0.18);
      if (!this.drawTreeSprite(x, y, s, seedRaw + i * 101, scale)) {
        this.drawOneTreeClump(x, y, s * scale * 0.34);
      }
    }
  }

  /** 单丛树冠：左下浅影 + 几层相叠的圆 */
  private drawOneTreeClump(x: number, y: number, r: number) {
    const g = this.g!;
    const winter = this.usesWinterTerrainVisuals();
    const sh = r * 0.42;
    g.lineWidth = 0;
    g.fillColor = FOREST_SHADE;
    g.circle(x - sh, y - sh, r * 0.92);
    g.fill();
    g.fillColor = winter ? new Color(66, 47, 34, 255) : FOREST_TREE_DARK;
    g.circle(x - r * 0.1, y + r * 0.06, r);
    g.fill();
    g.fillColor = winter ? new Color(102, 75, 52, 255) : FOREST_TREE_MID;
    g.circle(x + r * 0.2, y - r * 0.04, r * 0.8);
    g.fill();
    g.fillColor = winter ? new Color(145, 112, 78, 255) : FOREST_TREE_LIGHT;
    g.circle(x, y, r * 0.52);
    g.fill();
    if (winter) {
      g.fillColor = new Color(235, 242, 244, 225);
      for (const fleck of [
        { ox: -0.24, oy: 0.28, scale: 0.09 },
        { ox: 0.08, oy: 0.31, scale: 0.07 },
        { ox: 0.28, oy: 0.12, scale: 0.08 },
      ]) {
        g.circle(x + r * fleck.ox, y + r * fleck.oy, r * fleck.scale);
        g.fill();
      }
    }
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
      g.fillColor = this.usesWinterTerrainVisuals() ? WINTER_BUILDING_ROOF : BUILDING_ROOF_PALETTE[b.colorIdx];
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
      g.fillColor = this.usesWinterTerrainVisuals() ? WINTER_BUILDING_SHADE : BUILDING_SHADE_PALETTE[b.colorIdx];
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
      g.strokeColor = this.usesWinterTerrainVisuals() ? WINTER_BUILDING_RIDGE : BUILDING_RIDGE_PALETTE[b.colorIdx];
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
    const winter = this.usesWinterTerrainVisuals();
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
    g.fillColor = winter ? WINTER_BUILDING_SHADE : BRIDGE_PLANK_FILL;
    g.moveTo(p0.x + nx * bridgeHalfW, p0.y + ny * bridgeHalfW);
    g.lineTo(p1.x + nx * bridgeHalfW, p1.y + ny * bridgeHalfW);
    g.lineTo(p1.x - nx * bridgeHalfW, p1.y - ny * bridgeHalfW);
    g.lineTo(p0.x - nx * bridgeHalfW, p0.y - ny * bridgeHalfW);
    g.close();
    g.fill();
    g.stroke();

    g.fillColor = winter ? WINTER_ROAD_PATH_FILL : ROAD_PATH_FILL;
    g.strokeColor = winter ? WINTER_ROAD_PATH_OUTLINE : ROAD_PATH_OUTLINE;
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
    g.fillColor = this.usesWinterTerrainVisuals() ? WINTER_WATER_BANK_INNER : WATER_BANK_INNER;
    for (let e = 0; e < 6; e++) {
      if (edgeType[e] !== 'land') continue;
      const poly = stripPolygon(e, totalDepth);
      g.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x, poly[i].y);
      g.close();
      g.fill();
    }
    g.fillColor = this.usesWinterTerrainVisuals() ? WINTER_WATER_BANK_OUTER : WATER_BANK_OUTER;
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
    const winter = this.usesWinterTerrainVisuals();
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

    g.fillColor = winter ? WINTER_ROAD_PATH_FILL : ROAD_PATH_FILL;
    g.strokeColor = winter ? WINTER_ROAD_PATH_OUTLINE : ROAD_PATH_OUTLINE;

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
        const col = winter
          ? (v < 0.40 ? WINTER_ROAD_GRIT_LIGHT : v < 0.85 ? WINTER_ROAD_GRIT_MID : WINTER_ROAD_GRIT_DARK)
          : (v < 0.40 ? ROAD_GRIT_LIGHT : v < 0.85 ? ROAD_GRIT_MID : ROAD_GRIT_DARK);
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
        const col = winter
          ? (v < 0.40 ? WINTER_ROAD_GRIT_LIGHT : v < 0.85 ? WINTER_ROAD_GRIT_MID : WINTER_ROAD_GRIT_DARK)
          : (v < 0.40 ? ROAD_GRIT_LIGHT : v < 0.85 ? ROAD_GRIT_MID : ROAD_GRIT_DARK);
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
    this.drawHexOutlineOn(this.g!, cx, cy, size);
  }

  private drawHexOutlineOn(g: Graphics, cx: number, cy: number, size: number) {
    for (let i = 0; i < 6; i++) {
      const angle = (-30 + 60 * i) * Math.PI / 180;
      const x = cx + size * Math.cos(angle);
      const y = cy + size * Math.sin(angle);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.close();
    g.stroke();
  }

  private drawSegmentedHexOutlineOn(g: Graphics, cx: number, cy: number, size: number, fromT: number, toT: number) {
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 6; i++) {
      const angle = (-30 + 60 * i) * Math.PI / 180;
      points.push({
        x: cx + size * Math.cos(angle),
        y: cy + size * Math.sin(angle),
      });
    }
    for (let i = 0; i < 6; i++) {
      const a = points[i];
      const b = points[(i + 1) % 6];
      const x0 = a.x + (b.x - a.x) * fromT;
      const y0 = a.y + (b.y - a.y) * fromT;
      const x1 = a.x + (b.x - a.x) * toT;
      const y1 = a.y + (b.y - a.y) * toT;
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
    }
    g.stroke();
  }

  /** Draw six connected corner brackets, leaving a gap at the midpoint of every hex edge. */
  private drawHexCornerBracketsOn(g: Graphics, cx: number, cy: number, size: number, cornerLength: number) {
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 6; i++) {
      const angle = (-30 + 60 * i) * Math.PI / 180;
      points.push({
        x: cx + size * Math.cos(angle),
        y: cy + size * Math.sin(angle),
      });
    }
    for (let i = 0; i < 6; i++) {
      const prev = points[(i + 5) % 6];
      const corner = points[i];
      const next = points[(i + 1) % 6];
      g.moveTo(
        corner.x + (prev.x - corner.x) * cornerLength,
        corner.y + (prev.y - corner.y) * cornerLength,
      );
      g.lineTo(corner.x, corner.y);
      g.lineTo(
        corner.x + (next.x - corner.x) * cornerLength,
        corner.y + (next.y - corner.y) * cornerLength,
      );
    }
    g.stroke();
  }

  private drawSegmentedHexOutline(cx: number, cy: number, size: number, fromT: number, toT: number) {
    const g = this.g!;
    this.drawSegmentedHexOutlineOn(g, cx, cy, size, fromT, toT);
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
    const frames = this.activeTreeSpriteFrames().filter((sf): sf is SpriteFrame => !!sf);
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
    const winter = this.usesWinterTerrainVisuals();
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
      g.fillColor = winter
        ? (roll < 0.32 ? new Color(61, 43, 31, 255) : roll < 0.68 ? new Color(91, 65, 45, 255) : new Color(126, 94, 64, 255))
        : (roll < 0.32 ? HEDGE_BUSH_DEEP : roll < 0.68 ? HEDGE_BUSH_DARK : HEDGE_BUSH_MID);
      g.circle(x + Math.cos(a) * d, y + Math.sin(a) * d, rr);
      g.fill();
    }
    g.fillColor = winter ? new Color(160, 125, 86, 245) : HEDGE_BUSH_LIGHT;
    g.circle(x - r * 0.16, y + r * 0.18, r * (0.18 + local.next() * 0.10));
    g.fill();
    if (winter && local.next() > 0.55) {
      g.fillColor = new Color(235, 242, 244, 220);
      g.circle(x - r * 0.20, y + r * 0.24, r * 0.07);
      g.fill();
      g.circle(x + r * 0.12, y + r * 0.28, r * 0.06);
      g.fill();
    }
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

  /** Match a hull-carried turret to the hull's actual rendered angle on this frame. */
  private hullTurnRenderedAngularProgress(
    pos: Axial,
    hullFrom: Direction,
    hullTo: Direction,
    tRaw: number,
  ): number {
    const start = this.facingToScreenUnitVec(pos, hullFrom);
    const end = this.facingToScreenUnitVec(pos, hullTo);
    const current = this.facingBlendScreenVec(pos, hullFrom, hullTo, tRaw);
    const signedAngle = (a: { ux: number; uy: number }, b: { ux: number; uy: number }) =>
      Math.atan2(a.ux * b.uy - a.uy * b.ux, a.ux * b.ux + a.uy * b.uy);
    const total = signedAngle(start, end);
    if (Math.abs(total) < 1e-6) return Math.min(1, Math.max(0, tRaw));
    return Math.min(1, Math.max(0, signedAngle(start, current) / total));
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
    this.applyTankConcealmentOpacity(sp, u);
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
    const { ux, uy } = this.topDownForwardVec(u, c, facingLerp);

    // 局部偏移 → 世界偏移：right = forward 顺时针 90°（屏幕 y 向上）= (uy, -ux)
    // dx = forward·ux + right·uy；dy = forward·uy + right·(-ux)
    // 单位采用「一格距离」= 相邻六角中心间距 = hexSize × √3，让 offset = 1.0 直观对应"挪一格"。
    const offsetUnit = this.hexSize * Math.sqrt(3);
    const f = cfg.offsetForward * offsetUnit;
    const r = cfg.offsetRight * offsetUnit;
    const ox = f * ux + r * uy;
    const oy = f * uy + r * (-ux);
    const recoil = this.mainGunRecoilOffsetFor(u, 'whole');
    const angle = (Math.atan2(uy, ux) * 180) / Math.PI + 180;
    ut.setAnchorPoint(0.5, 0.5);
    node.setPosition(c.x + ox + recoil.x, c.y + oy + recoil.y, 0);
    node.angle = angle;
    this.registerEngineVibrationVisual(node, u, c.x + ox + recoil.x, c.y + oy + recoil.y, angle, angle - 180);
  }

  private registerEngineVibrationVisual(
    node: Node,
    u: Unit,
    baseX: number,
    baseY: number,
    baseAngle: number,
    bodyAngleDeg: number,
  ) {
    if (!TANK_ENGINE_VIBRATION_DEFAULT_ENABLED
        || u.destroyed
        || !unitKindHasEngineVibration(u.kind)) return;
    const visual: EngineVibrationVisual = {
      node,
      baseX,
      baseY,
      baseAngle,
      bodyAngleDeg,
      phaseOffset: tankEngineVibrationPhaseOffset(u.id),
    };
    this.engineVibrationVisuals.push(visual);
    this.applyEngineVibrationVisual(visual);
  }

  private applyEngineVibrationVisual(visual: EngineVibrationVisual) {
    if (!visual.node.isValid || !visual.node.active) return;
    // The debug preview uses 1.15 px at hexR=185; scale the same motion to the battle map.
    const amplitudePx = Math.max(0.35, this.hexSize * (1.15 / 185));
    const sample = tankEngineVibrationSample(
      this.engineVibrationTime,
      visual.bodyAngleDeg,
      true,
      amplitudePx,
      TANK_ENGINE_VIBRATION_FREQUENCY_HZ,
      visual.phaseOffset,
    );
    visual.node.setPosition(visual.baseX + sample.x, visual.baseY + sample.y, 0);
    visual.node.angle = visual.baseAngle + sample.angleDeg;
  }

  private advanceEngineVibration(dt: number) {
    this.engineVibrationTime += Math.max(0, dt);
    for (const visual of this.engineVibrationVisuals) this.applyEngineVibrationVisual(visual);
  }

  private clearTankEngineExhaust() {
    for (const particle of this.tankExhaustParticles) particle.active = false;
    this.tankExhaustEmitterStates.clear();
    this.tankExhaustLiveEmitterIds.clear();
    this.tankExhaustFreeIndices.length = 0;
    for (let i = TANK_EXHAUST_MAX_PARTICLES - 1; i >= 0; i--) {
      this.tankExhaustFreeIndices.push(i);
    }
    for (const bucket of this.tankExhaustDrawBuckets) bucket.length = 0;
    this.tankExhaustSerial = 0;
    this.tankExhaustGraphics?.clear();
  }

  private advanceTankEngineExhaust(dt: number) {
    const step = Math.max(0, dt);
    for (let index = 0; index < this.tankExhaustParticles.length; index++) {
      const particle = this.tankExhaustParticles[index]!;
      if (!particle.active) continue;
      advanceTankExhaustParticle(particle, step);
      if (!particle.active) this.tankExhaustFreeIndices.push(index);
    }

    const liveEmitterIds = this.tankExhaustLiveEmitterIds;
    liveEmitterIds.clear();
    if (this.mission) {
      // Avoid a large burst after a debugger pause or a slow loading frame.
      const emissionStep = Math.min(step, 0.12);
      for (const unit of this.allUnits()) {
        const config = tankVisualConfigOf(unit.kind);
        let enabledPortCount = 0;
        for (const port of config.exhaustPorts) {
          if (port.forward !== 0) enabledPortCount++;
        }
        if (unit.destroyed
          || isAbandonedTank(unit)
          || !unitKindHasEngineVibration(unit.kind)
          || enabledPortCount === 0
          || !this.isUnitVisible(unit)) continue;

        liveEmitterIds.add(unit.id);
        const moving = this.anim?.unit === unit && this.anim.kind === 'move';
        let state = this.tankExhaustEmitterStates.get(unit.id);
        if (!state) {
          state = {
            idleAccumulator: tankEngineVibrationPhaseOffset(unit.id) / TANK_EXHAUST_IDLE_RATE,
            distanceRemainder: 0,
            movingSpacing: this.hexSize * Math.sqrt(3) / Math.max(1, TANK_EXHAUST_MOVING_RATE * this.moveDuration),
            wasMoving: false,
            previousOrigins: [],
            currentOrigins: [],
            sampleFractions: [],
            spawnPoint: { x: 0, y: 0 },
          };
          this.tankExhaustEmitterStates.set(unit.id, state);
        }

        const center = this.interpolatedPos(unit);
        const facingLerp: DirectionLerp | null = this.anim?.unit === unit && this.anim.kind === 'turn'
          ? { from: this.anim.turnFrom!, to: this.anim.turnTo!, t: this.anim.t }
          : null;
        const forward = this.topDownForwardVec(unit, center, facingLerp);
        let originIndex = 0;
        for (const port of config.exhaustPorts) {
          if (port.forward === 0) continue;
          let origin = state.currentOrigins[originIndex];
          if (!origin) {
            origin = { x: 0, y: 0 };
            state.currentOrigins[originIndex] = origin;
          }
          tankExhaustPortWorldPosition(
            center.x,
            center.y,
            forward.ux,
            forward.uy,
            port,
            this.hexSize * Math.sqrt(3),
            origin,
          );
          originIndex++;
        }
        state.currentOrigins.length = originIndex;

        const canInterpolate = state.previousOrigins.length === state.currentOrigins.length
          && state.currentOrigins.length > 0;
        const segmentLength = canInterpolate
          ? Math.hypot(
            state.currentOrigins[0]!.x - state.previousOrigins[0]!.x,
            state.currentOrigins[0]!.y - state.previousOrigins[0]!.y,
          )
          : 0;

        if (moving) {
          const duration = Math.max(0.01, this.anim!.dur);
          state.movingSpacing = this.hexSize * Math.sqrt(3)
            / Math.max(1, TANK_EXHAUST_MOVING_RATE * duration);
        }

        if ((moving || state.wasMoving) && canInterpolate) {
          state.distanceRemainder = sampleTankExhaustTrailFractions(
            segmentLength,
            state.movingSpacing,
            state.distanceRemainder,
            state.sampleFractions,
          );
          for (const fraction of state.sampleFractions) {
            this.spawnTankExhaustCycle(
              state.currentOrigins,
              state.previousOrigins,
              fraction,
              forward.ux,
              forward.uy,
              true,
              state.spawnPoint,
            );
          }
          state.idleAccumulator = 0;
        } else if (!moving) {
          const interval = 1 / TANK_EXHAUST_IDLE_RATE;
          state.idleAccumulator += emissionStep;
          while (state.idleAccumulator >= interval) {
            state.idleAccumulator -= interval;
            this.spawnTankExhaustCycle(
              state.currentOrigins,
              null,
              1,
              forward.ux,
              forward.uy,
              false,
              state.spawnPoint,
            );
          }
        }
        state.wasMoving = moving;
        const previous = state.previousOrigins;
        state.previousOrigins = state.currentOrigins;
        state.currentOrigins = previous;
      }
    }

    for (const unitId of this.tankExhaustEmitterStates.keys()) {
      if (!liveEmitterIds.has(unitId)) this.tankExhaustEmitterStates.delete(unitId);
    }
    this.drawTankEngineExhaust();
  }

  private spawnTankExhaustCycle(
    currentOrigins: readonly TankExhaustPoint[],
    previousOrigins: readonly TankExhaustPoint[] | null,
    fraction: number,
    forwardX: number,
    forwardY: number,
    moving: boolean,
    spawnPoint: TankExhaustPoint,
  ) {
    if (this.tankExhaustFreeIndices.length < currentOrigins.length) return;
    for (let portIndex = 0; portIndex < currentOrigins.length; portIndex++) {
      const particleIndex = this.tankExhaustFreeIndices.pop();
      if (particleIndex === undefined) return;
      const current = currentOrigins[portIndex]!;
      const previous = previousOrigins?.[portIndex];
      if (previous) {
        spawnPoint.x = previous.x + (current.x - previous.x) * fraction;
        spawnPoint.y = previous.y + (current.y - previous.y) * fraction;
      } else {
        spawnPoint.x = current.x;
        spawnPoint.y = current.y;
      }
      resetTankExhaustParticle(
        this.tankExhaustParticles[particleIndex]!,
        spawnPoint,
        forwardX,
        forwardY,
        this.hexSize,
        moving,
        this.tankExhaustSerial++,
      );
    }
  }

  private drawTankEngineExhaust() {
    const g = this.tankExhaustGraphics;
    if (!g) return;
    g.clear();
    for (const bucket of this.tankExhaustDrawBuckets) bucket.length = 0;
    for (let particleIndex = 0; particleIndex < this.tankExhaustParticles.length; particleIndex++) {
      const particle = this.tankExhaustParticles[particleIndex]!;
      if (!particle.active) continue;
      const alpha = tankExhaustParticleAlpha(particle);
      if (alpha <= 0) continue;
      const radius = tankExhaustParticleRadius(particle);
      const progress = Math.max(0, Math.min(1, particle.age / particle.lifetime));
      const shade = Math.min(142, Math.round(particle.shade + progress * 54));
      const shadeBucket = Math.max(0, Math.min(3, Math.floor((shade - 69) / 19)));
      const alphaBucket = Math.max(0, Math.min(3, Math.floor((alpha - 1) / 32)));
      const bucketIndex = shadeBucket * 4 + alphaBucket;
      this.tankExhaustRadiusCache[particleIndex] = radius;
      this.tankExhaustDrawBuckets[bucketIndex]!.push(particleIndex);
    }

    for (let bucketIndex = 0; bucketIndex < this.tankExhaustDrawBuckets.length; bucketIndex++) {
      const bucket = this.tankExhaustDrawBuckets[bucketIndex]!;
      if (bucket.length === 0) continue;
      g.fillColor = this.tankExhaustBodyColors[bucketIndex]!;
      for (const particleIndex of bucket) {
        const particle = this.tankExhaustParticles[particleIndex]!;
        g.circle(particle.x, particle.y, this.tankExhaustRadiusCache[particleIndex]!);
      }
      g.fill();
    }
    for (let bucketIndex = 0; bucketIndex < this.tankExhaustDrawBuckets.length; bucketIndex++) {
      const bucket = this.tankExhaustDrawBuckets[bucketIndex]!;
      if (bucket.length === 0) continue;
      g.fillColor = this.tankExhaustHighlightColors[bucketIndex]!;
      for (const particleIndex of bucket) {
        const particle = this.tankExhaustParticles[particleIndex]!;
        const radius = this.tankExhaustRadiusCache[particleIndex]!;
        g.circle(
          particle.x - radius * 0.20,
          particle.y + radius * 0.22,
          radius * 0.56,
        );
      }
      g.fill();
    }
  }

  private clearTankTracks() {
    this.tankTracks.length = 0;
    this.activeTankTrackAnim = null;
    this.activeTankTrack = null;
    this.tankTrackGraphics?.clear();
  }

  private tankBodyDisplaySizePx(unit: Unit): { length: number; width: number } {
    const splitBasis = this.splitHullDisplayBasis(unit.kind);
    if (splitBasis) {
      return {
        length: renderedTankBodyLength(
          this.hexSize,
          splitBasis.trimW,
          splitBasis.trimH,
          splitBasis.fitScale,
        ),
        width: renderedTankBodyWidth(
          this.hexSize,
          splitBasis.trimW,
          splitBasis.trimH,
          splitBasis.fitScale,
        ),
      };
    }

    if (isEnemyTopKind(unit.kind)) {
      const meta = this.enemyTopMeta[unit.kind];
      if (meta?.sf) {
        const w = meta.dw > 0 ? meta.dw : meta.sf.width;
        const h = meta.dh > 0 ? meta.dh : meta.sf.height;
        const cfg = tankVisualConfigOf(unit.kind);
        return {
          length: renderedTankBodyLength(this.hexSize, w, h, cfg.fitScale, cfg.aspectRatioMul),
          width: renderedTankBodyWidth(this.hexSize, w, h, cfg.fitScale, cfg.aspectRatioMul),
        };
      }
    }

    // Vector/future tank fallback; track spacing still scales with the board.
    return { length: this.hexSize * 1.05, width: this.hexSize * 0.62 };
  }

  private addTankTrack(unit: Unit, anim: MoveAnim): TankTrackMove | null {
    const edgeKey = tankTrackEdgeKey(
      anim.fromQ,
      anim.fromR,
      anim.toQ,
      anim.toR,
    );
    // One ground position owns one visible mark. A new traversal removes every
    // older record on that undirected edge, including marks from other tanks.
    this.tankTracks = this.tankTracks.filter(track => tankTrackEdgeKey(
      track.fromQ,
      track.fromR,
      track.toQ,
      track.toR,
    ) !== edgeKey);
    const body = this.tankBodyDisplaySizePx(unit);
    const track: TankTrackMove = {
      unitId: unit.id,
      fromQ: anim.fromQ,
      fromR: anim.fromR,
      toQ: anim.toQ,
      toR: anim.toR,
      halfGap: tankTrackHalfGap(body.width),
      halfBodyLength: body.length * 0.5,
      lineWidth: tankTrackLineWidth(body.width),
      extendFrom: true,
      extendTo: true,
      progress: 0,
      fadeSteps: 0,
    };
    this.tankTracks.push(track);
    this.recalculateTankTrackExtensions();
    this.redrawTankTracks();
    return track;
  }

  private beginTankTrackAnimation(anim: MoveAnim) {
    if (this.activeTankTrackAnim === anim) return;
    this.activeTankTrackAnim = anim;
    this.activeTankTrack = anim.kind === 'move' && isTankUnit(anim.unit)
      ? this.addTankTrack(anim.unit, anim)
      : null;
  }

  private advanceTankTrackAnimation(anim: MoveAnim) {
    this.beginTankTrackAnimation(anim);
    if (!this.activeTankTrack) return;
    this.activeTankTrack.progress = easeOutCubic(Math.max(0, Math.min(1, anim.t)));
    this.redrawTankTracks();
  }

  private finishTankTrackAnimation(anim: MoveAnim) {
    this.advanceTankTrackAnimation(anim);
    this.activeTankTrackAnim = null;
    this.activeTankTrack = null;
  }

  /** Rebuild endpoint trimming after replacement so deleted marks cannot leave stale cuts. */
  private recalculateTankTrackExtensions() {
    for (const track of this.tankTracks) {
      track.extendFrom = !this.tankTrackHasStraightConnection(track, true);
      track.extendTo = !this.tankTrackHasStraightConnection(track, false);
    }
  }

  private tankTrackHasStraightConnection(track: TankTrackMove, atFrom: boolean): boolean {
    const q = atFrom ? track.fromQ : track.toQ;
    const r = atFrom ? track.fromR : track.toR;
    const ownOtherQ = atFrom ? track.toQ : track.fromQ;
    const ownOtherR = atFrom ? track.toR : track.fromR;
    return this.tankTracks.some(candidate => {
      if (candidate === track || candidate.unitId !== track.unitId) return false;
      if (candidate.fromQ === q && candidate.fromR === r) {
        return tankTrackEdgesContinueStraight(q, r, ownOtherQ, ownOtherR, candidate.toQ, candidate.toR);
      }
      if (candidate.toQ === q && candidate.toR === r) {
        return tankTrackEdgesContinueStraight(q, r, ownOtherQ, ownOtherR, candidate.fromQ, candidate.fromR);
      }
      return false;
    });
  }

  private redrawTankTracks() {
    const g = this.tankTrackGraphics;
    const map = this.mission?.map;
    if (!g || !map) return;

    g.clear();
    const lineWidths = [...new Set(this.tankTracks.map(track => track.lineWidth))]
      .sort((a, b) => a - b);
    const fadeSteps = [...new Set(this.tankTracks.map(track => track.fadeSteps))]
      .sort((a, b) => a - b);

    for (const style of TANK_TRACK_STYLE_ORDER) {
      const baseColor = TANK_TRACK_COLORS[style];
      for (const fadeStep of fadeSteps) {
        g.strokeColor = new Color(
          baseColor.r,
          baseColor.g,
          baseColor.b,
          tankTrackAlphaAfterTurns(baseColor.a, fadeStep),
        );
        for (const lineWidth of lineWidths) {
          g.lineWidth = lineWidth;
          let hasPath = false;

          for (const track of this.tankTracks) {
            if (track.lineWidth !== lineWidth || track.fadeSteps !== fadeStep) continue;
          const fromCenter = this.project(track.fromQ, track.fromR);
          const toCenter = this.project(track.toQ, track.toR);
          const swept = tankTrackProgressSegment(
            fromCenter.x,
            fromCenter.y,
            toCenter.x,
            toCenter.y,
            track.halfBodyLength,
            track.progress,
            track.extendFrom,
            track.extendTo,
          );
          const moveDx = toCenter.x - fromCenter.x;
          const moveDy = toCenter.y - fromCenter.y;
          const moveLength = Math.hypot(moveDx, moveDy) || 1;
          const moveUx = moveDx / moveLength;
          const moveUy = moveDy / moveLength;
          const reachedDistance = (swept.toX - fromCenter.x) * moveUx
            + (swept.toY - fromCenter.y) * moveUy;
          const boundaryDistance = moveLength * 0.5;
          const reachedBoundary = reachedDistance >= boundaryDistance;
          // Terrain changes at the real shared hex edge. Before the animated
          // leading edge reaches it, only the source terrain portion exists.
          const boundaryX = (fromCenter.x + toCenter.x) * 0.5;
          const boundaryY = (fromCenter.y + toCenter.y) * 0.5;
          const fromTile = map.get({ q: track.fromQ, r: track.fromR });
          const toTile = map.get({ q: track.toQ, r: track.toR });

          if (tankTrackStyleForTerrain(fromTile?.terrain, tileHasBridge(fromTile)) === style) {
            this.appendTankTrackPair(
              g,
              swept.fromX,
              swept.fromY,
              reachedBoundary ? boundaryX : swept.toX,
              reachedBoundary ? boundaryY : swept.toY,
              track.halfGap,
            );
            hasPath = true;
          }
          if (reachedBoundary
            && tankTrackStyleForTerrain(toTile?.terrain, tileHasBridge(toTile)) === style) {
            this.appendTankTrackPair(
              g,
              boundaryX,
              boundaryY,
              swept.toX,
              swept.toY,
              track.halfGap,
            );
            hasPath = true;
          }
          }

          if (hasPath) g.stroke();
        }
      }
    }
  }

  private fadeTankTracksAtTurnEnd(turns = 1) {
    const completedTurns = Math.max(0, Math.floor(turns));
    if (completedTurns === 0 || this.tankTracks.length === 0) return;
    for (const track of this.tankTracks) track.fadeSteps += completedTurns;
    this.redrawTankTracks();
  }

  private appendTankTrackPair(
    g: Graphics,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    halfGap: number,
  ) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.hypot(dx, dy);
    if (length < 0.001) return;

    const offsetX = -dy / length * halfGap;
    const offsetY = dx / length * halfGap;
    g.moveTo(fromX + offsetX, fromY + offsetY);
    g.lineTo(toX + offsetX, toY + offsetY);
    g.moveTo(fromX - offsetX, fromY - offsetY);
    g.lineTo(toX - offsetX, toY - offsetY);
  }

  private splitHullDisplayBasis(kind: UnitKind): { trimW: number; trimH: number; fitScale: number; offsetForward: number; offsetRight: number } | null {
    switch (kind) {
      case 'sherman':
        return {
          trimW: splitTankGeometryConfigOf('sherman').topTrim.w,
          trimH: splitTankGeometryConfigOf('sherman').topTrim.h,
          fitScale: splitTankVisualConfigOf('sherman').hullFitScale,
          offsetForward: splitTankVisualConfigOf('sherman').hullOffsetForward,
          offsetRight: splitTankVisualConfigOf('sherman').hullOffsetRight,
        };
      case 'sherman76': {
        const geometry = splitTankGeometryConfigOf('sherman76');
        const visual = splitTankVisualConfigOf('sherman76');
        return {
          trimW: geometry.topTrim.w,
          trimH: geometry.topTrim.h,
          fitScale: visual.hullFitScale,
          offsetForward: visual.hullOffsetForward,
          offsetRight: visual.hullOffsetRight,
        };
      }
      case 'sherman_jumbo': {
        const geometry = splitTankGeometryConfigOf('sherman_jumbo');
        const visual = splitTankVisualConfigOf('sherman_jumbo');
        return {
          trimW: geometry.topTrim.w,
          trimH: geometry.topTrim.h,
          fitScale: visual.hullFitScale,
          offsetForward: visual.hullOffsetForward,
          offsetRight: visual.hullOffsetRight,
        };
      }
      case 'm26_pershing': {
        const geometry = splitTankGeometryConfigOf('m26_pershing');
        const visual = splitTankVisualConfigOf('m26_pershing');
        return {
          trimW: geometry.topTrim.w,
          trimH: geometry.topTrim.h,
          fitScale: visual.hullFitScale,
          offsetForward: visual.hullOffsetForward,
          offsetRight: visual.hullOffsetRight,
        };
      }
      case 't34': {
        const geometry = splitTankGeometryConfigOf('t34');
        const visual = splitTankVisualConfigOf('t34');
        return {
          trimW: geometry.topTrim.w,
          trimH: geometry.topTrim.h,
          fitScale: visual.hullFitScale,
          offsetForward: visual.hullOffsetForward,
          offsetRight: visual.hullOffsetRight,
        };
      }
      case 'tiger':
        return {
          trimW: BattleScene.TIGER_TOP_TRIM_W,
          trimH: BattleScene.TIGER_TOP_TRIM_H,
          fitScale: TIGER_SPLIT_VISUAL_CONFIG.hullFitScale,
          offsetForward: TIGER_SPLIT_VISUAL_CONFIG.hullOffsetForward,
          offsetRight: TIGER_SPLIT_VISUAL_CONFIG.hullOffsetRight,
        };
      case 'tigerking': {
        const geometry = splitTankGeometryConfigOf('tigerking');
        const visual = splitTankVisualConfigOf('tigerking');
        return {
          trimW: geometry.topTrim.w,
          trimH: geometry.topTrim.h,
          fitScale: visual.hullFitScale,
          offsetForward: visual.hullOffsetForward,
          offsetRight: visual.hullOffsetRight,
        };
      }
      case 'maus': {
        const geometry = splitTankGeometryConfigOf('maus');
        const visual = splitTankVisualConfigOf('maus');
        return {
          trimW: geometry.topTrim.w,
          trimH: geometry.topTrim.h,
          fitScale: visual.hullFitScale,
          offsetForward: visual.hullOffsetForward,
          offsetRight: visual.hullOffsetRight,
        };
      }
      case 'panther': {
        const geometry = splitTankGeometryConfigOf('panther');
        const visual = splitTankVisualConfigOf('panther');
        return {
          trimW: geometry.topTrim.w,
          trimH: geometry.topTrim.h,
          fitScale: visual.hullFitScale,
          offsetForward: visual.hullOffsetForward,
          offsetRight: visual.hullOffsetRight,
        };
      }
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
      case 'type95': {
        const geometry = splitTankGeometryConfigOf('type95');
        const visual = splitTankVisualConfigOf('type95');
        return {
          trimW: geometry.topTrim.w,
          trimH: geometry.topTrim.h,
          fitScale: visual.hullFitScale,
          offsetForward: visual.hullOffsetForward,
          offsetRight: visual.hullOffsetRight,
        };
      }
      case 'type97': {
        const geometry = splitTankGeometryConfigOf('type97');
        const visual = splitTankVisualConfigOf('type97');
        return {
          trimW: geometry.topTrim.w,
          trimH: geometry.topTrim.h,
          fitScale: visual.hullFitScale,
          offsetForward: visual.hullOffsetForward,
          offsetRight: visual.hullOffsetRight,
        };
      }
      case 'type4': {
        const geometry = splitTankGeometryConfigOf('type4');
        const visual = splitTankVisualConfigOf('type4');
        return {
          trimW: geometry.topTrim.w,
          trimH: geometry.topTrim.h,
          fitScale: visual.hullFitScale,
          offsetForward: visual.hullOffsetForward,
          offsetRight: visual.hullOffsetRight,
        };
      }
      default:
        return null;
    }
  }

  private destroyedTankDisplaySize(kind: UnitKind, displayW: number, displayH: number, radius: number): { w: number; h: number } {
    const w = Math.max(1, displayW);
    const h = Math.max(1, displayH);
    const cfg = tankVisualConfigOf(kind);
    const split = this.splitHullDisplayBasis(kind);
    if (split && split.trimH > 0) {
      const hullFit = radius * 1.8 * split.fitScale;
      const hullScale = hullFit / (Math.max(split.trimW, split.trimH) || 1);
      // 残骸必须和存活车身使用完全一致的显示宽高；不应由残骸 PNG
      // 的画布比例再次推导，否则旋转后会显得比车身更大。
      return { w: split.trimW * hullScale * cfg.destroyedFitScale, h: split.trimH * hullScale * cfg.destroyedFitScale };
      return { w: split.trimW * hullScale * cfg.destroyedFitScale, h: split.trimH * hullScale * cfg.destroyedFitScale };
    }

    const fit = radius * 1.8 * cfg.fitScale;
    const scale = fit / (Math.max(w, h) || 1);
    const k = Math.sqrt(Math.max(1e-6, cfg.aspectRatioMul));
    return { w: w * scale * k * cfg.destroyedFitScale, h: h * scale / k * cfg.destroyedFitScale };
  }

  private destroyedTankOffset(kind: UnitKind, offsetUnit: number): { forward: number; right: number } {
    const cfg = tankVisualConfigOf(kind);
    const split = this.splitHullDisplayBasis(kind);
    return {
      forward: ((split ? split.offsetForward : cfg.offsetForward) + cfg.destroyedOffsetForward) * offsetUnit,
      right: ((split ? split.offsetRight : cfg.offsetRight) + cfg.destroyedOffsetRight) * offsetUnit,
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
    sp.color = new Color(255, 255, 255, 255);
    const ut = node.getComponent(UITransform)!;
    ut.setContentSize(size.w, size.h);
    ut.setAnchorPoint(0.5, 0.5);
    node.setScale(1, 1, 1);
    node.setPosition(c.x + f * body.ux + r * body.uy, c.y + f * body.uy + r * (-body.ux), 0);
    node.angle = (Math.atan2(body.uy, body.ux) * 180) / Math.PI + 180;
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
    this.applyTankConcealmentOpacity(sp, u);
    ut.setContentSize(geometry.topTrim.w * scale, geometry.topTrim.h * scale);
    ut.setAnchorPoint(0.5, 0.5);
    node.setScale(1, 1, 1);
    const baseX = c.x + f * body.ux + r * body.uy;
    const baseY = c.y + f * body.uy + r * (-body.ux);
    const bodyAngleDeg = (Math.atan2(body.uy, body.ux) * 180) / Math.PI;
    const angle = bodyAngleDeg + 180;
    node.setPosition(baseX, baseY, 0);
    node.angle = angle;
    node.active = true;
    this.registerEngineVibrationVisual(node, u, baseX, baseY, angle, bodyAngleDeg);
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
    const recoil = this.mainGunRecoilOffsetFor(u, 'turret');

    const pivotLocalX = (pivot.bodyX - (topTrim.x + topTrim.w / 2)) * scale;
    const pivotLocalY = ((topTrim.y + topTrim.h / 2) - pivot.bodyY) * scale;
    const bodyAngle = Math.atan2(body.uy, body.ux) + Math.PI;
    const cos = Math.cos(bodyAngle);
    const sin = Math.sin(bodyAngle);

    sp.spriteFrame = assets.turret;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.applyTankConcealmentOpacity(sp, u);
    ut.setContentSize(turretTrim.w * turretScale, turretTrim.h * turretScale);
    const anchorX = (pivot.spriteX - turretTrim.x) / turretTrim.w;
    const anchorY = 1 - ((pivot.spriteY - turretTrim.y) / turretTrim.h);
    ut.setAnchorPoint(
      anchorX + turretF / (turretTrim.w * turretScale),
      anchorY - turretR / (turretTrim.h * turretScale),
    );
    node.setScale(1, 1, 1);
    const spriteX = baseX + pivotLocalX * cos - pivotLocalY * sin + recoil.x;
    const spriteY = baseY + pivotLocalX * sin + pivotLocalY * cos + recoil.y;
    const angle = (Math.atan2(turret.uy, turret.ux) * 180) / Math.PI + 180;
    node.setPosition(spriteX, spriteY, 0);
    node.angle = angle;
    node.active = true;
    this.registerEngineVibrationVisual(
      node,
      u,
      spriteX,
      spriteY,
      angle,
      (Math.atan2(body.uy, body.ux) * 180) / Math.PI,
    );
  }

  private applySplitTankCommanderHatchSprite(
    slot: { node: Node; sprite: Sprite },
    u: Unit,
    kind: SplitTankKind,
    c: { x: number; y: number },
    bodyFacingLerp?: DirectionLerp | null,
    turretFacingLerp?: DirectionLerp | null,
  ) {
    const visualState = commanderHatchVisualState(u);
    const sf = visualState === 'empty'
      ? this.emptyCommanderHatchSpriteFrame
      : this.commanderHatchSpriteFrames[u.stats.commanderSpritePath ?? ''];
    if (!sf || visualState === 'hidden') {
      slot.node.active = false;
      return;
    }

    const cfg = splitTankVisualConfigOf(kind);
    const geometry = splitTankGeometryConfigOf(kind);
    if (cfg.commanderHatchScale <= 0) {
      slot.node.active = false;
      return;
    }

    const topTrim = geometry.topTrim;
    const pivot = geometry.pivot;
    const fit = this.hexSize * 1.8 * cfg.hullFitScale;
    const bodyScale = fit / (Math.max(topTrim.w, topTrim.h) || 1);
    const turretScale = bodyScale * cfg.turretScale;
    const body = this.topDownForwardVec(u, c, bodyFacingLerp);
    const turret = this.topDownForwardVec(u, c, turretFacingLerp);
    const offsetUnit = this.hexSize * Math.sqrt(3);
    const f = cfg.hullOffsetForward * offsetUnit;
    const r = cfg.hullOffsetRight * offsetUnit;
    const baseX = c.x + f * body.ux + r * body.uy;
    const baseY = c.y + f * body.uy + r * (-body.ux);
    const pivotLocalX = (pivot.bodyX - (topTrim.x + topTrim.w / 2)) * bodyScale;
    const pivotLocalY = ((topTrim.y + topTrim.h / 2) - pivot.bodyY) * bodyScale;
    const bodyAngle = Math.atan2(body.uy, body.ux) + Math.PI;
    const bodyCos = Math.cos(bodyAngle);
    const bodySin = Math.sin(bodyAngle);
    const recoil = this.mainGunRecoilOffsetFor(u, 'turret');
    const pivotX = baseX + pivotLocalX * bodyCos - pivotLocalY * bodySin + recoil.x;
    const pivotY = baseY + pivotLocalX * bodySin + pivotLocalY * bodyCos + recoil.y;

    const hatchLocalX = (cfg.commanderHatchSpriteX - pivot.spriteX) * turretScale;
    const hatchLocalY = (pivot.spriteY - cfg.commanderHatchSpriteY) * turretScale;
    const turretAngle = Math.atan2(turret.uy, turret.ux) + Math.PI;
    const turretCos = Math.cos(turretAngle);
    const turretSin = Math.sin(turretAngle);
    const node = slot.node;
    const sp = slot.sprite;
    sp.spriteFrame = sf;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.applyTankConcealmentOpacity(sp, u);
    const size = visualState === 'empty'
      ? this.emptyCommanderHatchDisplaySize(kind)
      : cfg.commanderHatchScale * turretScale;
    const ut = node.getComponent(UITransform)!;
    ut.setContentSize(size, size);
    ut.setAnchorPoint(0.5, 0.5);
    node.setScale(1, 1, 1);
    const spriteX = pivotX + hatchLocalX * turretCos - hatchLocalY * turretSin;
    const spriteY = pivotY + hatchLocalX * turretSin + hatchLocalY * turretCos;
    const angle = (turretAngle * 180) / Math.PI - 90;
    node.setPosition(spriteX, spriteY, 0);
    node.angle = angle;
    node.active = true;
    this.registerEngineVibrationVisual(
      node,
      u,
      spriteX,
      spriteY,
      angle,
      (Math.atan2(body.uy, body.ux) * 180) / Math.PI,
    );
  }

  /**
   * Fixed-gun vehicles use one complete top sprite, so their commander overlay
   * follows the body transform instead of a separately rotating turret.
   */
  private applyFixedTankCommanderHatchSprite(
    slot: { node: Node; sprite: Sprite },
    u: Unit,
    c: { x: number; y: number },
    displayW: number,
    displayH: number,
    facingLerp?: DirectionLerp | null,
  ) {
    const visualState = commanderHatchVisualState(u);
    const sf = visualState === 'empty'
      ? this.emptyCommanderHatchSpriteFrame
      : this.commanderHatchSpriteFrames[u.stats.commanderSpritePath ?? ''];
    const cfg = tankVisualConfigOf(u.kind);
    if (!sf || visualState === 'hidden' || cfg.commanderHatchScale <= 0) {
      slot.node.active = false;
      return;
    }

    const w = Math.max(1, displayW);
    const h = Math.max(1, displayH);
    const fit = this.hexSize * 1.8 * cfg.fitScale;
    const sourceScale = fit / Math.max(w, h);
    const aspectScale = Math.sqrt(Math.max(1e-6, cfg.aspectRatioMul));
    const scaleX = sourceScale * aspectScale;
    const scaleY = sourceScale / aspectScale;
    const body = this.topDownForwardVec(u, c, facingLerp);
    const offsetUnit = this.hexSize * Math.sqrt(3);
    const forwardOffset = cfg.offsetForward * offsetUnit;
    const rightOffset = cfg.offsetRight * offsetUnit;
    const recoil = this.mainGunRecoilOffsetFor(u, 'whole');
    const baseX = c.x + forwardOffset * body.ux + rightOffset * body.uy + recoil.x;
    const baseY = c.y + forwardOffset * body.uy - rightOffset * body.ux + recoil.y;
    const localX = (cfg.commanderHatchSpriteX - w / 2) * scaleX;
    const localY = (h / 2 - cfg.commanderHatchSpriteY) * scaleY;
    const bodyAngle = Math.atan2(body.uy, body.ux) + Math.PI;
    const cos = Math.cos(bodyAngle);
    const sin = Math.sin(bodyAngle);
    const spriteX = baseX + localX * cos - localY * sin;
    const spriteY = baseY + localX * sin + localY * cos;
    const occupiedSize = cfg.commanderHatchScale * Math.sqrt(scaleX * scaleY);
    const shermanCommanderScale = splitTankVisualConfigOf('sherman').commanderHatchScale || 1;
    const size = visualState === 'empty'
      ? occupiedSize * (EMPTY_COMMANDER_HATCH_SPRITE_SIZE
        * SHERMAN_EMPTY_COMMANDER_HATCH_SCALE / shermanCommanderScale)
      : occupiedSize;

    const node = slot.node;
    const sp = slot.sprite;
    sp.spriteFrame = sf;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.applyTankConcealmentOpacity(sp, u);
    const ut = node.getComponent(UITransform)!;
    ut.setContentSize(size, size);
    ut.setAnchorPoint(0.5, 0.5);
    node.setScale(1, 1, 1);
    const angle = bodyAngle * 180 / Math.PI - 90;
    node.setPosition(spriteX, spriteY, 0);
    node.angle = angle;
    node.active = true;
    this.registerEngineVibrationVisual(
      node,
      u,
      spriteX,
      spriteY,
      angle,
      Math.atan2(body.uy, body.ux) * 180 / Math.PI,
    );
  }

  private applyTankConcealmentOpacity(sp: Sprite, u: Unit) {
    sp.color = new Color(255, 255, 255, u.hidden ? TANK_CONCEALED_ALPHA : 255);
  }

  private tankVisualColor(color: Color, u: Unit): Color {
    if (!u.hidden) return color;
    return new Color(color.r, color.g, color.b, Math.round(color.a * TANK_CONCEALED_ALPHA / 255));
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
      const a = facingLerp.fromVisualTarget
        ? this.targetScreenAngle(u.pos, facingLerp.fromVisualTarget)
        : this.directionScreenAngle(u.pos, c, facingLerp.from);
      const b = facingLerp.toVisualTarget
        ? this.targetScreenAngle(u.pos, facingLerp.toVisualTarget)
        : this.directionScreenAngle(u.pos, c, facingLerp.to);
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
    _c: { x: number; y: number },
    dir: FireDirection,
  ): number {
    const origin = this.project(pos.q, pos.r);
    const aimed = axialAdd(pos, fireDirectionVector(dir));
    const np = this.project(aimed.q, aimed.r);
    return Math.atan2(np.y - origin.y, np.x - origin.x);
  }

  private targetScreenAngle(pos: Axial, target: Axial): number {
    const origin = this.project(pos.q, pos.r);
    const aimed = this.project(target.q, target.r);
    return Math.atan2(aimed.y - origin.y, aimed.x - origin.x);
  }

  private updateShermanTopSprite(
    u: Unit,
    c: { x: number; y: number },
    facingLerp?: DirectionLerp | null,
  ) {
    const splitReady =
      this.enemySupportsSplitTurret(u) &&
      this.shermanTurretSpriteNode &&
      this.shermanTurretTopSprite;

    if (splitReady) {
      this.applySplitTankHullSprite(
        { node: this.shermanSpriteNode!, sprite: this.shermanTopSprite! },
        u,
        'sherman',
        c,
        facingLerp,
      );
      this.applySplitTankTurretSprite(
        { node: this.shermanTurretSpriteNode!, sprite: this.shermanTurretTopSprite! },
        u,
        'sherman',
        c,
        facingLerp,
        this.currentShermanTurretLerp(u) ?? facingLerp,
      );
      this.updateShermanCommanderHatchSprite(u);
    } else {
      if (this.shermanCommanderHatchSpriteNode) this.shermanCommanderHatchSpriteNode.active = false;
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
    if (!u.destroyed && this.mapNode) {
      this.shermanSpriteNode!.setSiblingIndex(this.mapNode.children.length - 1);
      if (splitReady) {
        this.shermanTurretSpriteNode!.setSiblingIndex(this.mapNode.children.length - 1);
      }
    }
  }

  /**
   * The commander is a child of the rotating turret node.  These coordinates
   * are in the untrimmed Sherman turret source: the hatch is the small circle
   * just forward of the turret pivot (the position marked in the reference).
   */
  private updateShermanCommanderHatchSprite(u: Unit) {
    const node = this.shermanCommanderHatchSpriteNode;
    const sp = this.shermanCommanderHatchSprite;
    const visualState = commanderHatchVisualState(u);
    const sf = visualState === 'empty'
      ? this.emptyCommanderHatchSpriteFrame
      : this.shermanCommanderHatchSpriteFrame;
    if (!node || !sp || !sf || visualState === 'hidden') {
      if (node) node.active = false;
      return;
    }

    const geometry = splitTankGeometryConfigOf('sherman');
    const cfg = splitTankVisualConfigOf('sherman');
    const fit = this.hexSize * 1.8 * cfg.hullFitScale;
    const bodyScale = fit / Math.max(geometry.topTrim.w, geometry.topTrim.h);
    const turretScale = bodyScale * cfg.turretScale;
    const hatchSpriteX = cfg.commanderHatchSpriteX;
    const hatchSpriteY = cfg.commanderHatchSpriteY;
    const size = visualState === 'empty'
      ? this.emptyCommanderHatchDisplaySize('sherman')
      : cfg.commanderHatchScale * turretScale;

    sp.spriteFrame = sf;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.applyTankConcealmentOpacity(sp, u);
    const ut = node.getComponent(UITransform)!;
    ut.setContentSize(size, size);
    ut.setAnchorPoint(0.5, 0.5);
    node.setPosition(
      (hatchSpriteX - geometry.pivot.spriteX) * turretScale,
      (geometry.pivot.spriteY - hatchSpriteY) * turretScale,
      0,
    );
    // The commander art faces down in its source frame, while the canonical
    // Sherman turret art faces left, so compensate by -90° inside the turret.
    node.angle = -90;
    node.active = true;
  }

  /**
   * Preserve Sherman's approved empty-hatch size, then scale every other tank
   * by its complete commander-overlay transform (hull fit, turret, trim and
   * commander-specific scale), rather than by commanderHatchScale alone.
   */
  private emptyCommanderHatchDisplaySize(kind: SplitTankKind): number {
    const shermanVisual = splitTankVisualConfigOf('sherman');
    const shermanGeometry = splitTankGeometryConfigOf('sherman');
    const shermanFit = this.hexSize * 1.8 * shermanVisual.hullFitScale;
    const shermanBodyScale = shermanFit
      / (Math.max(shermanGeometry.topTrim.w, shermanGeometry.topTrim.h) || 1);
    const shermanTurretScale = shermanBodyScale * shermanVisual.turretScale;
    const relativeEmptyScale = emptyCommanderHatchScaleOf(
      kind,
      SHERMAN_EMPTY_COMMANDER_HATCH_SCALE,
    );
    return EMPTY_COMMANDER_HATCH_SPRITE_SIZE
      * relativeEmptyScale
      * shermanTurretScale;
  }

  private currentShermanTurretLerp(u: Unit): DirectionLerp | null {
    if (this.turretAimAnim && this.turretAimAnim.unit === u) {
      return {
        from: this.turretAimAnim.from,
        to: this.turretAimAnim.to,
        t: easeInOutCubic(Math.min(1, Math.max(0, this.turretAimAnim.t))),
        angular: true,
        fromVisualTarget: this.turretAimAnim.fromVisualTarget,
        toVisualTarget: this.turretAimAnim.toVisualTarget,
      };
    }

    if (u === this.mission?.sherman && this.anim?.unit === u && u.facing !== null) {
      if (this.anim.kind === 'move') {
        const facing = this.shermanTurretFacing ?? u.turretFacing ?? u.facing;
        return {
          from: facing as FireDirection,
          to: facing as FireDirection,
          t: 1,
          angular: true,
          toVisualTarget: u.turretVisualTarget,
        };
      }
      const from = (this.shermanTurretFacing ?? u.turretFacing ?? (this.anim.kind === 'turn' ? this.anim.turnFrom : u.facing)) as FireDirection;
      const to = (this.anim.kind === 'turn'
        ? turretFacingAfterHullTurn(from, this.anim.turnFrom!, this.anim.turnTo!)
        : u.facing) as FireDirection;
      if (from === to) return null;
      if (this.anim.kind === 'turn') {
        return {
          from,
          to,
          t: this.hullTurnRenderedAngularProgress(
            u.pos, this.anim.turnFrom!, this.anim.turnTo!, this.anim.t,
          ),
          angular: true,
        };
      }
      return {
        from,
        to,
        t: easeInOutCubic(Math.min(1, Math.max(0, this.anim.t))),
        angular: true,
      };
    }

    const facing = this.shermanTurretFacing ?? u.turretFacing;
    if (facing == null) return null;
    return {
      from: facing,
      to: facing,
      t: 1,
      angular: true,
      toVisualTarget: u.turretVisualTarget,
    };
  }

  private currentEnemyTurretLerp(u: Unit): DirectionLerp | null {
    if (this.turretAimAnim && this.turretAimAnim.unit === u) {
      return {
        from: this.turretAimAnim.from,
        to: this.turretAimAnim.to,
        t: easeInOutCubic(Math.min(1, Math.max(0, this.turretAimAnim.t))),
        angular: true,
        fromVisualTarget: this.turretAimAnim.fromVisualTarget,
        toVisualTarget: this.turretAimAnim.toVisualTarget,
      };
    }

    if (this.anim?.unit === u && u.facing !== null) {
      if (this.anim.kind === 'move') {
        const facing = (this.enemyTurretFacing.get(u.id) ?? u.turretFacing ?? u.facing) as FireDirection;
        return {
          from: facing,
          to: facing,
          t: 1,
          angular: true,
          toVisualTarget: u.turretVisualTarget,
        };
      }
      const stored = this.enemyTurretFacing.get(u.id);
      const from = (stored ?? (this.anim.kind === 'turn' ? this.anim.turnFrom : u.facing)) as FireDirection;
      const to = (this.anim.kind === 'turn'
        ? turretFacingAfterHullTurn(from, this.anim.turnFrom!, this.anim.turnTo!)
        : u.facing) as FireDirection;
      if (from === to) return null;
      if (this.anim.kind === 'turn') {
        return {
          from,
          to,
          t: this.hullTurnRenderedAngularProgress(
            u.pos, this.anim.turnFrom!, this.anim.turnTo!, this.anim.t,
          ),
          angular: true,
        };
      }
      return {
        from,
        to,
        t: easeInOutCubic(Math.min(1, Math.max(0, this.anim.t))),
        angular: true,
      };
    }

    const facing = this.enemyTurretFacing.get(u.id) ?? u.turretFacing;
    if (facing === undefined) return null;
    return { from: facing, to: facing, t: 1, angular: true, toVisualTarget: u.turretVisualTarget };
  }

  private enemySupportsSplitTurret(u: Unit): boolean {
    if (!isSplitTankKind(u.kind)) return false;
    const assets = this.splitTankSprites[u.kind];
    return !!assets?.hull && !!assets.turret;
  }

  private currentTurretFacingFor(unit: Unit, fallback: FireDirection): FireDirection {
    if (unit === this.mission?.sherman) {
      return (this.shermanTurretFacing ?? unit.turretFacing ?? unit.facing ?? fallback) as FireDirection;
    }
    return (this.enemyTurretFacing.get(unit.id) ?? unit.turretFacing ?? unit.facing ?? fallback) as FireDirection;
  }

  private turretTargetDirection(unit: Unit, target: Unit): FireDirection {
    const flankDirection = this.mission
      ? diagonalGunnerRuleDirectionForVisibleHex(
        this.mission.map, unit, target.pos, this.currentWeather(), this.mission.smokeHexes,
      )
      : null;
    return flankDirection ?? fireDirectionTo(unit.pos, target.pos) ?? approximateFireDirection(unit.pos, target.pos);
  }

  private canTurretReachDirection(unit: Unit, target: FireDirection): boolean {
    if (unit.stats.visionType !== 'turreted') return true;
    const from = this.currentTurretFacingFor(unit, target);
    return limitTurretTraverse(from, target, unit.stats.turretTraverseSpeed).reached;
  }

  private playerTurretCanRotate(): boolean {
    const sherman = this.mission?.sherman;
    return !!sherman
      && sherman.stats.visionType === 'turreted'
      && sherman.turretDamaged !== true;
  }

  /** Fixed-gun tanks can aim both their main gun and MG only along the hull's forward ray. */
  private canWeaponAimDirection(unit: Unit, target: FireDirection): boolean {
    if (isTankUnit(unit) && unit.stats.visionType === 'fixed') {
      return unit.facing !== null && target === unit.facing;
    }
    return this.canTurretReachDirection(unit, target);
  }

  private tankMachineGunSelection(unit: Unit, target: Unit): TankMachineGunSelection | null {
    if (GameSession.gameMode !== 'hardcore' || !isTankUnit(unit)) return null;
    const direction = this.turretTargetDirection(unit, target);
    const currentTurretFacing = this.currentTurretFacingFor(unit, direction);
    return selectTankMachineGun(
      { ...unit, turretFacing: currentTurretFacing },
      direction,
      this.canTurretReachDirection(unit, direction),
    );
  }

  private tankMachineGunContext(unit: Unit, target: Unit, selection?: TankMachineGunSelection) {
    if (GameSession.gameMode !== 'hardcore' || !isTankUnit(unit)) return {};
    const resolved = selection ?? this.tankMachineGunSelection(unit, target) ?? undefined;
    return {
      hardcoreTankMachineGuns: true,
      tankMachineGun: resolved?.weapon,
      tankMachineGunWillTraverse: resolved?.rotateTurret,
    };
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
    if (isAttachedATGunCrew(u)) return;
    const g = this.g!;
    const c = overrideX !== undefined && overrideY !== undefined
      ? { x: overrideX, y: overrideY }
      : this.project(u.pos.q, u.pos.r);
    // A hardcore AT gun has no separate turret: its 12-direction gun facing
    // rotates the whole sprite and its visible operator group together.
    if (isAntiTankGunUnit(u)) facingLerp = this.currentEnemyTurretLerp(u) ?? facingLerp;
    // 徒步类（步兵 / 军官）单独走一条更"像小人"的绘制路径，与坦克的大圆 + 朝向线拉开辨识度。
    if (isFootUnit(u)) {
      this.drawInfantry(u, c.x, c.y);
      this.drawSuppressionMarks(u, c.x, c.y);
      return;
    }
    if (u.kind === 'sherman' && u === this.mission?.sherman && this.shermanSpriteNode) {
      if (u.destroyed || !this.shermanTopSpriteFrame) {
        this.shermanSpriteNode.active = false;
        if (this.shermanTurretSpriteNode) this.shermanTurretSpriteNode.active = false;
        if (this.shermanCommanderHatchSpriteNode) this.shermanCommanderHatchSpriteNode.active = false;
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
      if (isSplitTankKind(u.kind)
          && this.enemySupportsSplitTurret(u)
          && this.enemyTopPoolNext + 1 < this.enemyTopSpritePool.length) {
        const hullSlot = this.enemyTopSpritePool[this.enemyTopPoolNext++];
        this.applySplitTankHullSprite(hullSlot, u, u.kind, c, facingLerp);
        const turretSlot = this.enemyTopSpritePool[this.enemyTopPoolNext++];
        const turretFacingLerp = u === this.mission?.playerTank
          ? (this.currentShermanTurretLerp(u) ?? facingLerp)
          : (this.currentEnemyTurretLerp(u) ?? facingLerp);
        this.applySplitTankTurretSprite(turretSlot, u, u.kind, c, facingLerp, turretFacingLerp);
        const hatchVisualState = commanderHatchVisualState(u);
        const hatchSpriteFrame = hatchVisualState === 'empty'
          ? this.emptyCommanderHatchSpriteFrame
          : this.commanderHatchSpriteFrames[u.stats.commanderSpritePath ?? ''];
        if (hatchVisualState !== 'hidden'
            && hatchSpriteFrame
            && this.commanderHatchPoolNext < this.commanderHatchSpritePool.length) {
          const commanderSlot = this.commanderHatchSpritePool[this.commanderHatchPoolNext++];
          this.applySplitTankCommanderHatchSprite(
            commanderSlot,
            u,
            u.kind,
            c,
            facingLerp,
            turretFacingLerp,
          );
        }
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
        const hatchVisualState = commanderHatchVisualState(u);
        const hatchSpriteFrame = hatchVisualState === 'empty'
          ? this.emptyCommanderHatchSpriteFrame
          : this.commanderHatchSpriteFrames[u.stats.commanderSpritePath ?? ''];
        if (hatchVisualState !== 'hidden'
            && hatchSpriteFrame
            && tankVisualConfigOf(u.kind).commanderHatchScale > 0
            && this.commanderHatchPoolNext < this.commanderHatchSpritePool.length) {
          const commanderSlot = this.commanderHatchSpritePool[this.commanderHatchPoolNext++];
          this.applyFixedTankCommanderHatchSprite(
            commanderSlot,
            u,
            c,
            meta.dw,
            meta.dh,
            facingLerp,
          );
        }
        return;
      }
    }

    // Units without a loaded top sprite (for example Type 95) use vector fallback rendering.
    const fallbackRecoil = this.mainGunRecoilOffsetFor(u, 'whole');
    c.x += fallbackRecoil.x;
    c.y += fallbackRecoil.y;

    // 起火和受损统一由炮塔黑烟表达；矢量回退车体保持原阵营配色。
    g.fillColor = this.tankVisualColor(FACTION_COLORS[u.faction], u);
    g.strokeColor = this.tankVisualColor(UNIT_BORDER, u);
    g.lineWidth = 2;
    g.circle(c.x, c.y, r);
    g.fill();
    g.stroke();

    // PNG 车辆通过炮管/炮塔表达朝向；fallback 矢量车体不再额外画长朝向线，避免出现多余细边线。
  }

  private atGunCrewProxy(gun: Unit): Unit {
    const kind = gun.atGunCrewKind ?? infantryKindForFaction(gun.faction);
    return {
      id: `${gun.id}:crew:${gun.atGunCrewGeneration ?? 0}`,
      kind,
      faction: gun.faction,
      sideId: gun.sideId,
      controller: 'ai',
      pos: gun.pos,
      facing: gun.facing,
      stats: getUnitStats(kind, this.mission?.data.theater ?? 'europe'),
      unitLevel: gun.atGunCrewLevel,
      suppressed: gun.suppressed,
    };
  }

  /** Exact attached infantry profile; the proxy remains only for legacy/runtime fallback guns. */
  private atGunCrewActor(gun: Unit): Unit {
    const controller = this.atGunController(gun);
    return controller
      ? { ...controller, pos: { ...gun.pos }, facing: gun.facing }
      : this.atGunCrewProxy(gun);
  }

  private atGunCrewFormationOffsets(
    gun: Unit,
    facingLerp?: DirectionLerp | null,
  ): Array<{ ox: number; oy: number }> {
    const origin = this.project(gun.pos.q, gun.pos.r);
    const { ux, uy } = this.topDownForwardVec(gun, origin, facingLerp);
    const rx = -uy;
    const ry = ux;
    // The supplied reference places the crew on the PNG's right-hand side as
    // a triangle: upper-right, far-right centre, and lower-right. The authored
    // sprite axis is opposite the logical facing vector used by combat rules.
    const crewSide = -1;
    const forwardShift = this.hexSize * 0.25;
    return [
      { forward: this.hexSize * 0.47, side: -this.hexSize * 0.43 },
      { forward: this.hexSize * 0.82, side: 0 },
      { forward: this.hexSize * 0.47, side: this.hexSize * 0.43 },
    ].map(({ forward, side }) => ({
      ox: ux * (forward * crewSide + forwardShift) + rx * side,
      oy: uy * (forward * crewSide + forwardShift) + ry * side,
    }));
  }

  private drawATGunCrewMaybeAnim(gun: Unit): void {
    if (!isControlledATGun(gun)) return;
    const c = this.anim?.unit === gun
      ? this.interpolatedPos(gun)
      : this.project(gun.pos.q, gun.pos.r);
    const facingLerp: DirectionLerp | null = this.currentEnemyTurretLerp(gun)
      ?? (this.anim?.unit === gun && this.anim.kind === 'turn'
      ? {
          from: this.anim.turnFrom!,
          to: this.anim.turnTo!,
          t: this.anim.t,
        }
      : null);
    const offsets = this.atGunCrewFormationOffsets(gun, facingLerp);
    const forward = this.topDownForwardVec(gun, c, facingLerp);
    const visualAngle = Math.atan2(forward.uy, forward.ux) * 180 / Math.PI + 90;
    const crew = this.atGunCrewActor(gun);
    this.drawInfantry(crew, c.x, c.y, offsets, visualAngle);
    this.drawSuppressionMarks(crew, c.x, c.y, offsets);
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
  private infantryVisualsFor(u: Unit): {
    frames: Array<SpriteFrame | null>;
    dims: Array<{ dw: number; dh: number }>;
    scales: readonly number[];
  } {
    const kind = infantryVisualKindOf(u.kind);
    const config = infantryVisualConfigOf(kind);
    return {
      frames: this.infantrySpriteFramesByKind[kind],
      dims: this.infantrySpriteDimsByKind[kind],
      scales: config.soldiers.map(soldier => soldier.scale),
    };
  }

  private setInfantryVisualFacing(unit: Unit, target: Axial) {
    if (!isFootUnit(unit)) return;
    const direction = infantryVisualDirection(unit.pos, target);
    if (direction !== null) {
      this.infantryVisualAngleOverride.delete(unit.id);
      this.infantryVisualFacing.set(unit.id, direction);
    }
  }

  private drawSuppressionMarks(
    unit: Unit,
    cx: number,
    cy: number,
    formationOffsets?: Array<{ ox: number; oy: number }>,
  ) {
    if (!unit.suppressed || unit.destroyed || unit.kind === 'officer') return;
    const offsets = formationOffsets
      ?? infantrySquadOffsets(this.hexSize, this.infantrySharesHexWithOtherUnit(unit));
    const markScale = Math.max(0.85, this.hexSize / 64);
    for (let i = 0; i < BattleScene.INFANTRY_SPRITES_PER_UNIT; i++) {
      if (this.suppressionMarkPoolNext >= this.suppressionMarkPool.length) return;
      const slot = this.suppressionMarkPool[this.suppressionMarkPoolNext++];
      const off = offsets[i];
      this.drawSuppressionExclamation(slot.graphics);
      slot.node.setPosition(
        cx + off.ox + this.hexSize * 0.14,
        cy + off.oy + this.hexSize * 0.20,
        0,
      );
      slot.node.setScale(markScale, markScale, 1);
      slot.node.angle = 0;
      slot.node.active = true;
    }
  }

  /** Draw an unmistakable exclamation mark without relying on font glyph rendering. */
  private drawSuppressionExclamation(g: Graphics) {
    g.clear();
    const outline = new Color(38, 30, 8, 255);
    const yellow = new Color(255, 220, 42, 255);

    // Thick dark silhouette keeps the mark readable over snow, smoke, and unit art.
    g.fillColor = outline;
    g.roundRect(-3.6, -1.5, 7.2, 14.5, 3.2);
    g.fill();
    g.circle(0, -6.4, 4.1);
    g.fill();

    // Separate yellow stem and dot preserve the familiar exclamation shape at small size.
    g.fillColor = yellow;
    g.roundRect(-1.7, 0.2, 3.4, 11.0, 1.6);
    g.fill();
    g.circle(0, -6.4, 2.25);
    g.fill();
  }

  private infantryVisualAngle(unit: Unit): number {
    const inherited = this.infantryVisualAngleOverride.get(unit.id);
    if (inherited !== undefined) return inherited;
    const direction = this.infantryVisualFacing.get(unit.id) ?? unit.facing;
    return direction === null ? 0 : infantrySpriteAngle(direction);
  }

  private drawInfantry(
    u: Unit,
    cx: number,
    cy: number,
    customOffsets?: Array<{ ox: number; oy: number }>,
    customVisualAngle?: number,
  ) {
    const g = this.g!;
    const visualAngle = customVisualAngle ?? this.infantryVisualAngle(u);

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
        slot.node.angle = visualAngle;
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
    const infantryVisuals = this.infantryVisualsFor(u);
    const allLoaded = infantryVisuals.frames.every((sf) => sf !== null);

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
    const coLocateOtherUnit = this.infantrySharesHexWithOtherUnit(u);
    const coLocatedEnemyTank = this.enemyTankSharingInfantryHex(u);

    // 等边三角形布局（顶点朝上）：3 个士兵中心位于半径 ringR 的小圆周上，间隔 120°
    //   位置 0（Infantry01，主图）：顶（cy + ringR）
    //   位置 1（Infantry02）：右下（cx + ringR·sin60°, cy - ringR·cos60°）
    //   位置 2（Infantry03）：左下（cx - ringR·sin60°, cy - ringR·cos60°）
    // 默认 ringR = teamRadius·0.546 ≈ hexSize·0.273（紧凑成队）；
    // 同格有车辆时 ringR = hexSize·0.58，三人散到格内切圆（≈ hexSize·0.866）附近，避开车辆体型。
    const offsets = customOffsets ?? infantrySquadOffsets(this.hexSize, coLocateOtherUnit);
    /** 单兵 sprite 显示尺寸（按图最长边等比缩放到该值） */
    const spriteFit = this.hexSize * 0.58;

    for (let i = 0; i < BattleScene.INFANTRY_SPRITES_PER_UNIT; i++) {
      if (this.infantryTopPoolNext >= this.infantryTopSpritePool.length) break;
      const sf = infantryVisuals.frames[i];
      if (!sf) continue;
      const slot = this.infantryTopSpritePool[this.infantryTopPoolNext++];
      const dim = infantryVisuals.dims[i];
      const w = dim.dw > 0 ? dim.dw : sf.width;
      const h = dim.dh > 0 ? dim.dh : sf.height;
      const maxDim = Math.max(w, h) || 1;
      const fitI = spriteFit * infantryVisuals.scales[i];
      const tw = (w / maxDim) * fitI;
      const th = (h / maxDim) * fitI;
      slot.sprite.spriteFrame = sf;
      const ut = slot.node.getComponent(UITransform)!;
      ut.setContentSize(tw, th);
      const off = offsets[i];
      slot.node.setPosition(cx + off.ox, cy + off.oy, 0);
      // In a shared enemy-tank hex, each dispersed soldier independently faces
      // inward toward the tank at the hex center.
      slot.node.angle = coLocatedEnemyTank
        ? Math.atan2(-off.oy, -off.ox) * 180 / Math.PI + 90
        : visualAngle;
      slot.node.setScale(1, 1, 1);
      slot.node.active = true;
    }
  }

  // ---------- HUD ----------

  private createHudRoot() {
    const root = new Node('BattleHUD');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    root.setPosition(0, 0, 0);
    this.node.addChild(root);
    this.hudRoot = root;
  }

  private hudParent(): Node {
    return this.hudRoot ?? this.node;
  }

  /**
   * Position persistent HUD against the actual visible edges. The map keeps its
   * own 1280x720 coordinate system, while this screen-space layer expands into
   * surplus width/height exposed by ResolutionAdapter.
   */
  private layoutBattleHud() {
    const { width, height } = visibleSizeInRootSpace(UI_ROOT_SCALE);
    const margin = 20;
    const left = -width * 0.5 + margin;
    const right = width * 0.5 - margin;
    const top = height * 0.5 - margin;
    const bottom = -height * 0.5 + margin;
    const operationY = bottom + BOTTOM_CONTROL_SAFE_INSET;

    const hudTransform = this.hudRoot?.getComponent(UITransform);
    hudTransform?.setContentSize(width, height);

    this.missionTitleLabel?.node.setPosition(left, top, 0);
    this.weatherHudLabel?.node.setPosition(left + 550, top, 0);
    this.pvpHudLabel?.node.setPosition(left, top - HUD_MISSION_TITLE_H - 2, 0);
    this.pvpTurnTimerRoot?.setPosition(0, top - PVP_TURN_TIMER_H * 0.5, 0);

    const turnInfoY = top - HUD_SHIFT_FOR_MISSION - (GameSession.isPvp ? 28 : 0);
    this.hudLabel?.node.setPosition(left, turnInfoY, 0);
    const objectiveStartY = turnInfoY - 48;
    for (let i = 0; i < this.objectiveHudLabels.length; i++) {
      this.objectiveHudLabels[i]!.node.setPosition(left, objectiveStartY - i * 26, 0);
    }

    const settingsX = right - BATTLE_SETTINGS_R;
    const topButtonY = top - BATTLE_SETTINGS_R;
    this.settingsButton?.setPosition(settingsX, topButtonY, 0);
    this.turnEndListButton?.setPosition(
      settingsX - BATTLE_SETTINGS_R * 2 - 12,
      topButtonY,
      0,
    );

    if (this.statusPanel) {
      const statusSize = this.statusPanel.getComponent(UITransform)?.contentSize;
      if (statusSize) {
        const panelTop = topButtonY - BATTLE_SETTINGS_R - 10;
        this.statusPanel.setPosition(right - statusSize.width * 0.5, panelTop - statusSize.height * 0.5, 0);
      }
    }

    this.chooseBar?.setPosition(0, operationY, 0);
    this.diceTrayRoot?.setPosition(0, operationY, 0);
    this.endTurnBtn?.setPosition(right - ADVANCE_BTN_W * 0.5, operationY, 0);
    this.campaignDebugSkipBtn?.setPosition(right - 90, operationY + 74, 0);
    if (this.enemyDiceTrayRoot) this.placeEnemyDiceTrayRoot(this.enemyDiceTrayRoot);

    if (this.combatLogPanel) this.combatLogPanel.setPosition(left, bottom, 0);
    if (this.combatLogDimmer) {
      this.combatLogDimmer.setPosition(0, 0, 0);
    }
  }

  /** 一次性创建 HUD：左上关卡 id+名、回合/阶段条、多行目标 + 右下角"结束回合"按钮。无需任何美术资源。 */
  private buildHUD() {
    const hud = this.hudParent();
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
    hud.addChild(mNode);
    this.missionTitleLabel = mLab;

    const weatherNode = new Node('WeatherHudLabel');
    weatherNode.layer = this.node.layer;
    const weatherUT = weatherNode.addComponent(UITransform);
    weatherUT.setContentSize(320, 24);
    weatherUT.setAnchorPoint(0, 1);
    const weatherLab = weatherNode.addComponent(Label);
    weatherLab.fontSize = 18;
    weatherLab.lineHeight = 22;
    weatherLab.color = new Color(166, 218, 235, 255);
    weatherLab.horizontalAlign = HorizontalTextAlignment.LEFT;
    weatherLab.verticalAlign = VerticalTextAlignment.TOP;
    weatherLab.overflow = Label.Overflow.SHRINK;
    weatherLab.string = '';
    weatherNode.setPosition(-74, 344, 0);
    weatherNode.active = false;
    hud.addChild(weatherNode);
    this.weatherHudLabel = weatherLab;

    const pvpNode = new Node('PvpHudLabel');
    pvpNode.layer = this.node.layer;
    const pvpUT = pvpNode.addComponent(UITransform);
    pvpUT.setContentSize(760, 28);
    pvpUT.setAnchorPoint(0, 1);
    const pvpLab = pvpNode.addComponent(Label);
    pvpLab.fontSize = 19;
    pvpLab.lineHeight = 24;
    pvpLab.color = new Color(245, 205, 92, 255);
    pvpLab.horizontalAlign = HorizontalTextAlignment.LEFT;
    pvpLab.verticalAlign = VerticalTextAlignment.TOP;
    pvpLab.overflow = Label.Overflow.SHRINK;
    pvpLab.string = '';
    pvpNode.setPosition(-624, 344 - HUD_MISSION_TITLE_H - 2, 0);
    pvpNode.active = false;
    hud.addChild(pvpNode);
    this.pvpHudLabel = pvpLab;

    const timerNode = new Node('PvpTurnTimer');
    timerNode.layer = this.node.layer;
    const timerUT = timerNode.addComponent(UITransform);
    timerUT.setContentSize(PVP_TURN_TIMER_W, PVP_TURN_TIMER_H);
    timerUT.setAnchorPoint(0.5, 0.5);
    timerNode.setPosition(0, 344, 0);
    const timerBg = timerNode.addComponent(Graphics);
    const timerFillNode = new Node('Fill');
    timerFillNode.layer = this.node.layer;
    timerFillNode.addComponent(UITransform).setContentSize(PVP_TURN_TIMER_W, PVP_TURN_TIMER_H);
    timerFillNode.setPosition(0, 0, 0);
    const timerFill = timerFillNode.addComponent(Graphics);
    timerNode.addChild(timerFillNode);
    const timerLabelNode = new Node('Label');
    timerLabelNode.layer = this.node.layer;
    timerLabelNode.addComponent(UITransform).setContentSize(PVP_TURN_TIMER_W, PVP_TURN_TIMER_H);
    const timerLabel = timerLabelNode.addComponent(Label);
    timerLabel.fontSize = 17;
    timerLabel.lineHeight = 20;
    timerLabel.color = HUD_TEXT_COLOR;
    timerLabel.horizontalAlign = HorizontalTextAlignment.CENTER;
    timerLabel.verticalAlign = VerticalTextAlignment.CENTER;
    timerLabel.overflow = Label.Overflow.SHRINK;
    timerLabel.string = '';
    timerNode.addChild(timerLabelNode);
    timerNode.active = false;
    hud.addChild(timerNode);
    this.pvpTurnTimerRoot = timerNode;
    this.pvpTurnTimerBg = timerBg;
    this.pvpTurnTimerFill = timerFill;
    this.pvpTurnTimerLabel = timerLabel;

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
    labelNode.setPosition(-624, 344 - HUD_SHIFT_FOR_MISSION - (GameSession.isPvp ? 28 : 0), 0);
    hud.addChild(labelNode);
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
      hud.addChild(on);
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

    bindButtonPressScale(btn);
    btn.on(Node.EventType.TOUCH_END, this.onAdvanceClicked, this);
    // 初始处于阶段选择态；首次 HUD 刷新前也不能短暂闪出“下一阶段”。
    btn.active = false;
    hud.addChild(btn);
    this.endTurnBtn = btn;
    this.buildCampaignDebugSkipButton();

    // ---- 右侧谢尔曼状态面板：须先于 ⚙ 创建，否则面板会盖在设置按钮上 ----
    this.buildStatusPanel();

    // ---- 右上角：事件表（先 addChild）→ 设置（后 addChild，保证 ⚙ 叠在上层可点） ----
    this.turnEndListButton = this.makeBattleCircleButton(
      hud, BATTLE_TURNEND_LIST_CX, BATTLE_SETTINGS_CY, BATTLE_SETTINGS_R, '☰',
      () => this.openTurnEndEventsReference(),
    ).node;
    this.settingsButton = this.makeBattleCircleButton(
      hud, BATTLE_SETTINGS_CX, BATTLE_SETTINGS_CY, BATTLE_SETTINGS_R, '⚙',
      () => this.openBattleSettings(),
    ).node;
  }

  private buildCampaignDebugSkipButton() {
    const btn = this.makeBattleRectButton(
      this.hudParent(),
      CANVAS_W * 0.5 - 100,
      BOTTOM_PHASE_ROW_Y + 74,
      180,
      38,
      BATTLE_BTN_ACCENT,
      () => this.debugSkipCampaignSegment(),
    );
    const lab = this.makeBattleModalLabel(btn.node, '跳到下一关', 0, 0, 180, 38, 18, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(lab, () => {
      playUiClick();
      this.debugSkipCampaignSegment();
    });
    this.campaignDebugSkipBtn = btn.node;
    this.campaignDebugSkipBtn.active = false;
  }

  private refreshCampaignDebugSkipButton() {
    if (!this.campaignDebugSkipBtn) return;
    this.campaignDebugSkipBtn.active = !!this.campaignRuntime
      && this.outcome === 'ongoing'
      && !this.campaignTransitionActive
      && this.activeCampaignSegmentIndex < this.campaignRuntime.segments.length - 1;
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
    this.hudParent().addChild(root);
    this.combatLogRoot = root;

    const { node: dim } = createAdaptiveFullscreenMask(
      root,
      'CombatLogDimmer',
      new Color(0, 0, 0, 140),
      UI_ROOT_SCALE,
    );
    dim.setPosition(0, 0, 0);
    dim.addComponent(BlockInputEvents);
    dim.active = false;
    dim.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      this.setCombatLogExpanded(false);
      e.propagationStopped = true;
    }, this);
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
    const lab = labN.addComponent(RichText);
    // 与标题「战斗记录」同档字号，避免正文过细；行高略大于字号保证正常长宽比
    lab.fontSize = BattleScene.COMBAT_LOG_BODY_FONT0;
    lab.lineHeight = BattleScene.COMBAT_LOG_BODY_LINE0;
    lab.fontColor = new Color(230, 235, 242, 255);
    lab.horizontalAlign = HorizontalTextAlignment.LEFT;
    lab.maxWidth = sW - 4;
    lab.string = '';
    lab.node.active = false;
    this.combatLogLabel = lab;

    const plainN = new Node('PlainLabel');
    plainN.layer = this.node.layer;
    const plainUT = plainN.addComponent(UITransform);
    plainUT.setAnchorPoint(0, 1);
    plainUT.setContentSize(sW - 4, 80);
    plainN.setPosition(-(sW - 4) * 0.5, 0, 0);
    contentN.addChild(plainN);
    const plain = plainN.addComponent(Label);
    plain.fontSize = BattleScene.COMBAT_LOG_BODY_FONT0;
    plain.lineHeight = BattleScene.COMBAT_LOG_BODY_LINE0;
    plain.color = new Color(230, 235, 242, 255);
    plain.horizontalAlign = HorizontalTextAlignment.LEFT;
    plain.verticalAlign = VerticalTextAlignment.TOP;
    plain.overflow = Label.Overflow.RESIZE_HEIGHT;
    plain.string = '';
    this.combatLogPlainLabel = plain;
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

    root.setSiblingIndex(Math.max(0, this.hudParent().children.length - 1));
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
    const plain = this.combatLogPlainLabel;
    if (lab) {
      const lut = lab.node.getComponent(UITransform);
      if (lut) {
        lut.setAnchorPoint(0, 1);
        lut.setContentSize(width, Math.max(1, lut.contentSize.height));
        lab.node.setPosition(-width * 0.5, 0, 0);
        lab.maxWidth = width;
      }
    }
    if (plain) {
      const put = plain.node.getComponent(UITransform);
      if (put) {
        put.setAnchorPoint(0, 1);
        put.setContentSize(width, Math.max(1, put.contentSize.height));
        plain.node.setPosition(-width * 0.5, 0, 0);
      }
    }
  }

  private applyCombatLogTypography() {
    const lab = this.combatLogLabel;
    const plain = this.combatLogPlainLabel;
    const fontSize = this.combatLogExpanded
      ? BattleScene.COMBAT_LOG_BODY_FONT1
      : BattleScene.COMBAT_LOG_BODY_FONT0;
    const lineHeight = this.combatLogExpanded
      ? BattleScene.COMBAT_LOG_BODY_LINE1
      : BattleScene.COMBAT_LOG_BODY_LINE0;
    if (lab) {
      lab.fontSize = fontSize;
      lab.lineHeight = lineHeight;
    }
    if (plain) {
      plain.fontSize = fontSize;
      plain.lineHeight = lineHeight;
    }
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
    if ((entry.key === 'battleLog.combatMg' || entry.key === 'battleLog.combatMgAI') && params) {
      return t(entry.key, {
        actor: params.actor,
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

  private combatLogEntryTone(entry: CombatLogEntry, text: string): CombatLogTone {
    if (typeof entry !== 'string') {
      const params = entry.params;
      if (entry.key === 'battleLog.misc.fireSuppress') return 'good';
      if (entry.key === 'battleLog.usCasualtyDefeat') return 'bad';
      if (entry.key === 'battleLog.combatMg') {
        return String(params?.resultKey ?? '').endsWith('.hit') ? 'good' : 'bad';
      }
      if (entry.key.startsWith('battleLog.combat.')) {
        if (params?.actorKey === 'actor.player') return 'good';
        if (params?.actorNameKey) return 'bad';
      }
    }
    if (/^\[AI\]|\[Combat\].*Enemy|\[战斗\].*敌方/.test(text)) return 'bad';
    if (/^\[玩家\]|\[Player\]|\[Combat\].*Player|\[战斗\].*玩家/.test(text)) return 'good';
    return 'neutral';
  }

  private combatLogPhraseColor(phrase: string, tone: CombatLogTone): string {
    if (COMBAT_LOG_ALWAYS_GOOD.includes(phrase)) return COMBAT_LOG_COLOR.good;
    if (COMBAT_LOG_ALWAYS_BAD.includes(phrase)) return COMBAT_LOG_COLOR.bad;
    if (COMBAT_LOG_FIRE_WORDS.includes(phrase)) return tone === 'good' ? COMBAT_LOG_COLOR.good : COMBAT_LOG_COLOR.fire;
    if (COMBAT_LOG_DAMAGE_WORDS.includes(phrase)) return tone === 'good' ? COMBAT_LOG_COLOR.good : COMBAT_LOG_COLOR.damage;
    if (COMBAT_LOG_MOBILITY_WORDS.includes(phrase)) return tone === 'good' ? COMBAT_LOG_COLOR.good : COMBAT_LOG_COLOR.mobility;
    if (COMBAT_LOG_CONTEXTUAL_BAD.includes(phrase)) return tone === 'bad' ? COMBAT_LOG_COLOR.good : COMBAT_LOG_COLOR.bad;
    if (COMBAT_LOG_CONTEXTUAL_GOOD.includes(phrase)) return tone === 'bad' ? COMBAT_LOG_COLOR.bad : COMBAT_LOG_COLOR.good;
    return COMBAT_LOG_COLOR.neutral;
  }

  private escapeCombatLogRichText(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private colorCombatLogPhrase(phrase: string, tone: CombatLogTone): string {
    const color = this.combatLogPhraseColor(phrase, tone);
    return `<color=${color}>${this.escapeCombatLogRichText(phrase)}</color>`;
  }

  private isAsciiWordChar(ch: string | undefined): boolean {
    return !!ch && /[A-Za-z0-9_]/.test(ch);
  }

  private combatLogPhraseAt(text: string, phrase: string, index: number): boolean {
    if (!text.startsWith(phrase, index)) return false;
    if (!/^[A-Za-z0-9_ ]+$/.test(phrase)) return true;
    return !this.isAsciiWordChar(text[index - 1]) && !this.isAsciiWordChar(text[index + phrase.length]);
  }

  private combatLogRichLine(entry: CombatLogEntry): string {
    const text = this.combatLogText(entry);
    const tone = this.combatLogEntryTone(entry, text);
    let out = '';
    for (let i = 0; i < text.length;) {
      const phrase = COMBAT_LOG_HIGHLIGHT_WORDS.find(w => this.combatLogPhraseAt(text, w, i));
      if (phrase) {
        out += this.colorCombatLogPhrase(phrase, tone);
        i += phrase.length;
      } else {
        out += this.escapeCombatLogRichText(text[i]);
        i += 1;
      }
    }
    return out;
  }

  private activeCombatLogTextNode(): Node | null {
    return this.combatLogExpanded
      ? this.combatLogLabel?.node ?? null
      : this.combatLogPlainLabel?.node ?? null;
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
    if (!this.combatLogLabel || !this.combatLogPlainLabel) return;
    this.applyCombatLogTypography();
    this.setCombatLogLabelFrame(this.getCombatLogBodyWidth());
    this.combatLogLabel.node.active = this.combatLogExpanded;
    this.combatLogPlainLabel.node.active = !this.combatLogExpanded;
    if (this.combatLogExpanded) {
      this.combatLogPlainLabel.string = '';
      this.combatLogLabel.string = this.combatLogLines.map(e => this.combatLogRichLine(e)).join('<br/>');
      (this.combatLogLabel as any).updateRenderData?.(true);
    } else {
      this.combatLogLabel.string = '';
      this.combatLogPlainLabel.string = this.combatLogLines.map(e => this.combatLogText(e)).join('\n');
      this.combatLogPlainLabel.updateRenderData(true);
    }
    const ut = this.combatLogContent?.getComponent(UITransform);
    if (ut && this.combatLogScroll) {
      const wBody = this.getCombatLogBodyWidth();
      this.setCombatLogLabelFrame(wBody);
      const activeNode = this.activeCombatLogTextNode();
      const hText = activeNode?.getComponent(UITransform)?.contentSize.height ?? 40;
      const h = Math.max(40, hText + BattleScene.COMBAT_LOG_BOTTOM_PAD);
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
    const plain = this.combatLogPlainLabel;
    if (!sv?.isValid || !viewN || !contentN || !lab || !plain) return;
    const vh = viewN.getComponent(UITransform)!.contentSize.height;
    const cut = contentN.getComponent(UITransform)!;
    this.applyCombatLogTypography();
    this.setCombatLogLabelFrame(this.getCombatLogBodyWidth());
    if (this.combatLogExpanded) (lab as any).updateRenderData?.(true);
    else plain.updateRenderData(true);
    const activeNode = this.activeCombatLogTextNode();
    const hText = activeNode?.getComponent(UITransform)?.contentSize.height ?? 40;
    const h = Math.max(40, hText + BattleScene.COMBAT_LOG_BOTTOM_PAD);
    cut.setContentSize(this.getCombatLogBodyWidth(), h);
    const eps = 2;
    if (h > vh + eps) sv.scrollToBottom(0);
    else sv.scrollToTop(0);
  }

  private applyCombatLogChrome(_expanded: boolean) {
    const p = this.combatLogPanel;
    const bg = this.combatLogPanelBg;
    const lab = this.combatLogLabel;
    const plain = this.combatLogPlainLabel;
    const tl = this.combatLogTitleLab;
    if (!p || !bg || !lab || !plain || !tl) return;
    // 放大后仍与折叠时相同的半透明深色底 + 浅色字（仅尺寸与字号在变）
    bg.fillColor = new Color(22, 24, 32, 245);
    bg.strokeColor = new Color(90, 96, 118, 255);
    lab.fontColor = new Color(228, 233, 240, 255);
    plain.color = new Color(228, 233, 240, 255);
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
    this.refreshCombatLogText();
    if (this.combatLogLabel) {
      this.applyCombatLogTypography();
      this.setCombatLogLabelFrame(sW - 4);
      if (this.combatLogExpanded) (this.combatLogLabel as any).updateRenderData?.(true);
      else this.combatLogPlainLabel?.updateRenderData(true);
      const activeNode = this.activeCombatLogTextNode();
      const hText = activeNode?.getComponent(UITransform)?.contentSize.height ?? 40;
      const lh = Math.max(40, hText + BattleScene.COMBAT_LOG_BOTTOM_PAD);
      cut.setContentSize(sW - 4, lh);
    }
    this.scheduleOnce(() => {
      this.syncCombatLogScrollAfterLayout();
    }, 0);
    this.layoutBattleHud();
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
    drawFieldPanel(bg, W, H, opaqueButtonFill(bgColor), BTN_BORDER, STATUS_TITLE_COLOR, false);

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

    bindButtonPressScale(btn);
    btn.on(Node.EventType.TOUCH_END, () => {
      playUiClick();
      onClick();
    }, this);
    this.node.addChild(btn);
    return btn;
  }

  // ---------- 谢尔曼状态面板 ----------

  /** HUD is constructed before the asynchronous mission load completes. */
  private playerTankStatusTitle(): string {
    const playerTank = this.mission?.playerTank ?? this.mission?.sherman;
    const unitName = playerTank
      ? t(`unit.name.${playerTank.kind}`)
      : t('actor.player');
    return t('status.panelTitle', { unit: unitName });
  }

  /**
   * 右侧常驻信息面板（自上而下）：
   *   ┌──────────────────┐
   *   │   谢尔曼状态       │
   *   │  装填    已装填    │
   *   │  炮塔    完好      │
   *   │  机动    正常      │
   *   │  着火程度  2 / -   │
   *   │  ─────────────     │
   *   │       乘员          │
   *   │  ☆  ◉  ◇  ◯  ◌   │  ← 图标从左至右：车长、炮手、装填手、驾驶员、副驾驶
   *   └──────────────────┘
   *
   * 乘员等级显示在图标右下角；阵亡时图标灰化并覆盖红色斜杠；
   * 车长开舱时其图标变绿。refresh 时只改节点状态，不重建节点。
   */
  private buildStatusPanel() {
    const W = 240;
    const GAP_BELOW_GEAR = 10;
    const panelTopY = BATTLE_SETTINGS_CY - BATTLE_SETTINGS_R - GAP_BELOW_GEAR;
    const showCampaignUpgrades = GameSession.gameMode === 'hardcore' && GameSession.isCampaign;
    // 战役强化槽需要保留完整的描边与按压缩放空间；360 高度使槽底距面板底边约 21px。
    const H = showCampaignUpgrades ? 360 : GameSession.gameMode === 'hardcore' ? 236 : 214;
    const y = panelTopY - H / 2;
    // 整体靠右，贴近屏缘（与 ⚙ 错层由子节点顺序保证可点）
    const x = CANVAS_W * 0.5 - W * 0.5 - 10;

    const BODY_GAP = 22;
    const innerTop = H / 2 - 8;
    const shermanTitleY = innerTop - 14;
    const bodyFirstY = shermanTitleY - 24;
    const bodyRowY = Array.from({ length: GameSession.gameMode === 'hardcore' ? 5 : 4 }, (_, j) => bodyFirstY - j * BODY_GAP);
    const sepY = bodyRowY[bodyRowY.length - 1] - 20;
    const crewTitleY = sepY - 18;
    const crewFirstY = crewTitleY - 26;

    const panel = new Node('ShermanStatus');
    panel.layer = this.node.layer;
    panel.addComponent(UITransform).setContentSize(W, H);
    panel.addComponent(BlockInputEvents);
    panel.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; }, this);
    panel.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => { e.propagationStopped = true; }, this);
    panel.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; }, this);
    panel.on(Node.EventType.TOUCH_CANCEL, (e: EventTouch) => { e.propagationStopped = true; }, this);
    panel.setPosition(x, y, 0);
    const bg = panel.addComponent(Graphics);
    drawFieldPanel(bg, W, H, STATUS_PANEL_BG, STATUS_PANEL_BORDER, STATUS_TITLE_COLOR);
    bg.strokeColor = new Color(145, 138, 100, 190);
    bg.lineWidth = 1;
    bg.moveTo(-W / 2 + 16, sepY);
    bg.lineTo( W / 2 - 16, sepY);
    bg.stroke();
    this.hudParent().addChild(panel);
    this.statusPanel = panel;

    this.statusBodyLeftLabels = [];

    // 1) 乘员区（在「谢尔曼状态」之下）
    this.statusCrewTitleLabel = this.makeCenteredLabel(panel, t('status.row.crewTitle'),
      0, crewTitleY, W - 20, 22, 18, STATUS_TITLE_COLOR);

    this.statusCrewIcons = [];
    this.statusCrewDeadMarkers = [];
    this.statusCrewRankNodes = [];
    this.statusCrewRankIcons = [];
    for (let i = 0; i < STATUS_CREW_SLOT_COUNT; i++) {
      const iconNode = new Node(`CrewIcon${i + 1}`);
      iconNode.layer = this.node.layer;
      iconNode.addComponent(UITransform).setContentSize(STATUS_CREW_ICON_SIZE, STATUS_CREW_ICON_SIZE);
      iconNode.setPosition(STATUS_CREW_START_X + i * (STATUS_CREW_ICON_SIZE + STATUS_CREW_ICON_GAP), crewFirstY, 0);
      const icon = iconNode.addComponent(Sprite);
      icon.sizeMode = Sprite.SizeMode.CUSTOM;
      panel.addChild(iconNode);
      this.assignCrewStatusIcon(icon, iconNode, i + 1);
      this.statusCrewIcons.push(icon);

      const deadMarker = this.addStatusCrewDeadMarker(iconNode, i + 1, STATUS_CREW_ICON_SIZE);
      deadMarker.active = false;
      this.statusCrewDeadMarkers.push(deadMarker);

      const rankNode = new Node(`CrewRank${i + 1}`);
      rankNode.layer = this.node.layer;
      rankNode.addComponent(UITransform).setContentSize(17, 17);
      rankNode.setPosition(STATUS_CREW_ICON_SIZE * 0.32, -STATUS_CREW_ICON_SIZE * 0.32, 0);
      const rankBg = rankNode.addComponent(Graphics);
      rankBg.fillColor = new Color(48, 55, 38, 245);
      rankBg.roundRect(-8.5, -8.5, 17, 17, 2);
      rankBg.fill();
      const rankSpriteNode = new Node('Icon');
      rankSpriteNode.layer = this.node.layer;
      rankSpriteNode.addComponent(UITransform).setContentSize(15, 15);
      const rankSprite = rankSpriteNode.addComponent(Sprite);
      rankSprite.sizeMode = Sprite.SizeMode.CUSTOM;
      rankNode.addChild(rankSpriteNode);
      iconNode.addChild(rankNode);
      rankNode.active = false;
      this.statusCrewRankNodes.push(rankNode);
      this.statusCrewRankIcons.push(rankSprite);
      deadMarker.setSiblingIndex(iconNode.children.length - 1);
    }
    this.loadCrewStatusRankFrames();

    // 2) 谢尔曼状态：装填 → 炮塔 → 机动 → 着火程度（仅层数 / 未着火「-」）
    this.statusPanelTitleLabel = this.makeCenteredLabel(panel, this.playerTankStatusTitle(),
      0, shermanTitleY, W - 20, 28, 22, STATUS_TITLE_COLOR);
    const bodyRows: Array<[string, 'loaded' | 'turret' | 'mobility' | 'radio' | 'fire']> = [
      [t('status.row.loaded'),    'loaded'],
      [t('status.row.turret'),    'turret'],
      [t('status.row.mobility'),  'mobility'],
    ];
    if (GameSession.gameMode === 'hardcore') bodyRows.push([t('status.row.radio'), 'radio']);
    bodyRows.push([t('status.row.fireLevel'), 'fire']);
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
        case 'radio':    this.statusRadio = val; break;
      }
    }

    if (showCampaignUpgrades) {
      const upgradeSepY = crewFirstY - STATUS_CREW_ICON_SIZE / 2 - 20;
      bg.strokeColor = new Color(145, 138, 100, 190);
      bg.lineWidth = 1;
      bg.moveTo(-W / 2 + 16, upgradeSepY);
      bg.lineTo(W / 2 - 16, upgradeSepY);
      bg.stroke();

      const upgradeRoot = new Node('CampaignUpgradeStatus');
      upgradeRoot.layer = this.node.layer;
      upgradeRoot.addComponent(UITransform).setContentSize(W - 20, 98);
      upgradeRoot.setPosition(0, upgradeSepY - 52, 0);
      panel.addChild(upgradeRoot);
      this.campaignUpgradeStatusRoot = upgradeRoot;
      this.campaignUpgradeStatusTitleLabel = this.makeCenteredLabel(panel, t('campaignUpgrade.acquiredTitle'),
        0, upgradeSepY - 28, W - 28, 24, 18, STATUS_TITLE_COLOR);
      this.refreshCampaignUpgradeStatusSlots();
    } else {
      this.campaignUpgradeStatusRoot = null;
      this.campaignUpgradeStatusTitleLabel = null;
      this.campaignUpgradeStatusSlots = [];
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
    if (this.statusPanelTitleLabel) {
      this.statusPanelTitleLabel.string = this.playerTankStatusTitle();
    }

    // 装填
    if (this.statusLoaded) {
      if (s.destroyed) {
        this.statusLoaded.string = '—';
        this.statusLoaded.color = STATUS_VALUE_DOWN;
      } else if (s.loaded) {
        this.statusLoaded.string = GameSession.gameMode === 'hardcore'
          ? t((s.loadedShell ?? 'ap') === 'he' ? 'status.val.he'
            : s.loadedShell === 'hvap' ? 'status.val.hvap' : 'status.val.ap')
          : t('status.val.loaded');
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

    if (this.statusRadio) {
      if (s.destroyed) {
        this.statusRadio.string = '—';
        this.statusRadio.color = STATUS_VALUE_DOWN;
      } else if (s.radioDamaged) {
        this.statusRadio.string = t('status.val.damaged');
        this.statusRadio.color = STATUS_VALUE_DEAD;
      } else {
        this.statusRadio.string = t('status.val.intact');
        this.statusRadio.color = STATUS_VALUE_OK;
      }
    }

    // 乘员：纯图标状态。车长开舱为绿色，阵亡为灰色并带红色斜杠，等级在右下角。
    const crew = s.crew;
    const crewFlags: boolean[] = crew
      ? [crew.commander, crew.gunner, crew.loader, crew.driver, crew.coDriver]
      : [true, true, true, true, true];
    const crewSlots = ['commander', 'gunner', 'loader', 'driver', 'coDriver'] as const;
    const configuredCrewSlots = new Set<number>(s.stats.crewMembers);
    let visibleCrewIndex = 0;

    for (let i = 0; i < this.statusCrewIcons.length; i++) {
      const slot = i + 1;
      const iconNode = this.statusCrewIcons[i].node;
      const slotExists = configuredCrewSlots.has(slot);
      iconNode.active = slotExists;
      if (!slotExists) {
        if (this.statusCrewDeadMarkers[i]) this.statusCrewDeadMarkers[i].active = false;
        if (this.statusCrewRankNodes[i]) this.statusCrewRankNodes[i].active = false;
        continue;
      }
      iconNode.setPosition(
        STATUS_CREW_START_X + visibleCrewIndex * (STATUS_CREW_ICON_SIZE + STATUS_CREW_ICON_GAP),
        iconNode.position.y,
        iconNode.position.z,
      );
      visibleCrewIndex++;

      const dead = s.destroyed || !crewFlags[i];
      const hatchOpen = i === 0 && !dead && s.hatchOpen === true;
      this.statusCrewIcons[i].color = dead
        ? CREW_STATUS_DEAD_COLOR
        : hatchOpen ? CREW_STATUS_HATCH_OPEN_COLOR : CREW_STATUS_NORMAL_COLOR;
      if (this.statusCrewDeadMarkers[i]) this.statusCrewDeadMarkers[i].active = dead;

      const level = crewLevelFor(s, crewSlots[i]!);
      const rankNode = this.statusCrewRankNodes[i];
      const rankIcon = this.statusCrewRankIcons[i];
      if (!rankNode || !rankIcon) continue;
      rankNode.active = level === 'veteran' || level === 'elite';
      rankIcon.spriteFrame = level === 'veteran' || level === 'elite'
        ? this.crewStatusRankFrames[level]
        : null;
      rankIcon.color = dead ? new Color(145, 145, 145, 230) : Color.WHITE;
    }
    this.refreshChooseHatchButton();
  }

  /** 绘制结束回合按钮的背景。urgent=true 时换提醒色。 */
  private drawEndTurnBg(urgent: boolean, disabled = false) {
    if (!this.endTurnBg) return;
    const g = this.endTurnBg;
    g.clear();
    const fill = disabled ? BTN_BG_DISABLED : urgent ? BTN_BG_URGENT : BTN_BG_NORMAL;
    drawFieldPanel(g, ADVANCE_BTN_W, ADVANCE_BTN_H, opaqueButtonFill(fill), BTN_BORDER, STATUS_TITLE_COLOR, false);
  }

  private updateHUD() {
    if (this.missionTitleLabel && this.mission) {
      if (GameSession.isPvp) {
        const session = GameSession.pvpSession;
        const local = session ? pvpFactionOf(session.localPlayer.factionId).name : '我方';
        const opponent = session ? pvpFactionOf(session.opponentPlayer.factionId).name : '敌方';
        this.missionTitleLabel.string = `PVP 对战 · ${local} vs ${opponent}`;
      } else {
        const d = this.mission.data;
        const meta = findLevelByMissionId(d.id);
        const nameStr = meta ? t(meta.titleKey) : d.name;
        this.missionTitleLabel.string = t('hud.missionLine', { id: missionDisplayId(d.id), name: nameStr });
      }
    }
    this.refreshPvpHud();
    this.refreshWeatherHud();

    if (this.hudLabel) {
      if (this.phase === 'fireCheck') {
        this.hudLabel.string = t('hud.fireCheckPhase', { n: this.turn });
      } else if (this.phase === 'ally') {
        this.hudLabel.string = t('hud.allyTurn', { n: this.turn });
      } else if (this.phase === 'enemy') {
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
        const loaded = sherman?.loaded
          ? GameSession.gameMode === 'hardcore'
            ? t((sherman.loadedShell ?? 'ap') === 'he' ? 'status.val.he'
              : sherman.loadedShell === 'hvap' ? 'status.val.hvap' : 'status.val.ap')
            : t('hud.loaded')
          : t('hud.unloaded');
        // 选中主炮 → "点敌人开火"；选中机枪 → "点步兵扫射"；两者互斥
        let sel = '';
        if (this.selectedGunDieIdx >= 0) {
          sel = ` | ${t(this.selectedGunHitThresholdModifier < 0
            ? 'hud.precisionAttackSelectHint'
            : 'hud.attackSelectHint')}`;
        }
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
    if (this.endTurnBtn) this.endTurnBtn.active = adv.visible;
    this.drawEndTurnBg(adv.urgent, adv.disabled);
    if (this.endTurnLabel) this.endTurnLabel.string = adv.label;

    this.refreshObjectiveHud();
  }

  private currentWeather(): WeatherType {
    return normalizeWeather(this.mission?.data.weather);
  }

  private refreshWeatherHud() {
    const label = this.weatherHudLabel;
    if (!label) return;
    const weather = this.currentWeather();
    const active = !!this.mission && weather !== 'clear' && !GameSession.isPvp;
    label.node.active = active;
    if (!active) {
      label.string = '';
    } else if (weather === 'light_snow') {
      label.string = getLang() === 'zh' ? '小雪' : 'Light Snow';
    } else if (weather === 'heavy_snow') {
      label.string = getLang() === 'zh' ? '大雪' : 'Heavy Snow';
    } else {
      label.string = getLang() === 'zh' ? '雨天  命中-1 / 视野-1' : 'Rain  Hit -1 / Vision -1';
    }
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
      case 'destroyAllRemaining':
        return pfx + t('objective.destroyAllRemaining', { remaining: tpl.remaining });
      case 'destroyAllUnitsRemaining':
        return pfx + t('objective.destroyAllUnitsRemaining', { remaining: tpl.remaining });
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

  private refreshPvpHud() {
    if (!this.pvpHudLabel) return;
    const session = GameSession.pvpSession;
    if (!session?.active) {
      this.pvpHudLabel.node.active = false;
      return;
    }
    const localFaction = pvpFactionOf(session.localPlayer.factionId).shortName;
    const opponentFaction = pvpFactionOf(session.opponentPlayer.factionId).shortName;
    const current = !this.pvpBattleStarted
      ? '等待双方进入战场'
      : this.phase === 'player'
      ? `${session.localPlayer.name}主角行动`
      : `${session.opponentPlayer.name}/AI 行动`;
    this.pvpHudLabel.string = [
      `${localFaction}(${pvpParityLabel(session.localPlayer.parity)})`,
      `${opponentFaction}(${pvpParityLabel(session.opponentPlayer.parity)})`,
      `开局骰 ${session.openingDie}`,
      `先手 ${session.firstPlayerName}`,
      `当前 ${current}`,
    ].join('  ·  ');
    this.pvpHudLabel.node.active = true;
  }

  /** 刷新左上角任务目标多行（胜负已分仍显示最终状态）。 */
  private refreshObjectiveHud() {
    for (let i = 0; i < this.objectiveHudLabels.length; i++) {
      const lab = this.objectiveHudLabels[i];
      lab.node.active = false;
    }
    if (!this.mission) return;
    if (GameSession.isPvp) {
      const lab = this.objectiveHudLabels[0];
      if (lab) {
        lab.string = '目标：击毁对方主角坦克';
        lab.color = OBJ_HUD_ACTIVE;
        lab.node.active = true;
      }
      return;
    }

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
   *   - 杂项子阶段内 →「结束回合」强调色（结束杂项并进入着火检定）
   *   - 移动 / 攻击子阶段 →「下一阶段」（提前结束本子阶段）
   *   - 尚未选择移动 / 攻击阶段 → 隐藏按钮
   *   - 着火/友方/敌方阶段 → 显示对应的进行中状态
   */
  private isPvpWaitingForRemoteAction(): boolean {
    return GameSession.isPvp && this.phase !== 'player' && this.outcome === 'ongoing';
  }

  private computeAdvanceButton(): { label: string; urgent: boolean; visible: boolean; disabled?: boolean } {
    if (this.isPvpWaitingForRemoteAction()) return { label: t('btn.waitingOpponent'), urgent: false, visible: true, disabled: true };
    if (this.phase === 'fireCheck') return { label: t('btn.fireCheckRunning'), urgent: false, visible: true, disabled: true };
    if (this.phase === 'ally') return { label: t('btn.allyTurnRunning'), urgent: false, visible: true };
    if (this.phase === 'enemy') return { label: t('btn.enemyTurnRunning'), urgent: false, visible: true };
    if (this.playerStep === 'misc') return { label: t('btn.endTurn'), urgent: true, visible: true };
    if (this.playerStep === 'movement' || this.playerStep === 'attack') {
      return { label: t('btn.nextPhase'), urgent: false, visible: true };
    }
    return { label: t('btn.nextPhase'), urgent: false, visible: false };
  }

  private pvpOpponentProtagonist(): Unit | null {
    if (!this.mission) return null;
    return this.mission.enemies.find(u => this.isPvpProtagonistUnit(u))
      ?? this.mission.enemies.find(u => isTankUnit(u))
      ?? this.mission.enemies[0]
      ?? null;
  }

  private isPvpProtagonistUnit(unit: Unit): boolean {
    return GameSession.isPvp && unit.id.endsWith('_protagonist');
  }

  private protagonistForAttackTarget(target: Unit): Unit {
    if (this.mission && this.isPvpProtagonistUnit(target)) return target;
    return this.mission?.sherman ?? target;
  }

  private computeOutcome(): MissionOutcome {
    if (!this.mission) return 'ongoing';
    if (!GameSession.isPvp) {
      const outcome = checkOutcome(this.mission);
      if (outcome === 'victory'
        && this.campaignRuntime?.campaign.autoEvacAfterDestroyAll
        && this.mission.data.objective.type === 'destroy_all_enemies'
        && !(this.mission.playerTankEvacuated || this.mission.shermanEvacuated)) {
        if (!this.campaignAutoEvacActive) {
          this.campaignAutoEvacActive = true;
          this.beginCampaignAutoEvac();
        }
        return 'ongoing';
      }
      return outcome;
    }
    if (this.mission.sherman.destroyed) return 'defeat';
    const opponent = this.pvpOpponentProtagonist();
    if (opponent?.destroyed) return 'victory';
    return 'ongoing';
  }

  private campaignAutoEvacPath(target: Axial): Axial[] | null {
    if (!this.mission) return null;
    const { map, sherman } = this.mission;
    const start = { ...sherman.pos };
    const startKey = HexMap.keyOf(start);
    const targetKey = HexMap.keyOf(target);
    const queue: Axial[] = [start];
    const previous = new Map<string, Axial | null>([[startKey, null]]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (HexMap.keyOf(current) === targetKey) break;
      for (let dir = 0; dir < 6; dir++) {
        const next = neighbor(current, dir as Direction);
        const key = HexMap.keyOf(next);
        if (previous.has(key)) continue;
        if (!this.canMoveToBattleTile(next)) continue;
        if (!map.canTankCrossEdge(current, next, { faction: sherman.faction })) continue;
        previous.set(key, current);
        queue.push(next);
      }
    }
    if (!previous.has(targetKey)) return null;
    const reversed: Axial[] = [];
    for (let cursor: Axial | null = target; cursor; cursor = previous.get(HexMap.keyOf(cursor)) ?? null) {
      reversed.push(cursor);
    }
    return reversed.reverse();
  }

  private queueCampaignAutoEvacTurn(
    queue: MoveAnim[],
    unit: Unit,
    pos: Axial,
    from: Direction,
    to: Direction,
  ): Direction {
    let facing = from;
    while (facing !== to) {
      const clockwise = (to - facing + 6) % 6;
      const next = rotateDirection(facing, clockwise <= 3 ? 1 : -1);
      queue.push({
        unit, kind: 'turn', fromQ: pos.q, fromR: pos.r, toQ: pos.q, toR: pos.r,
        t: 0, dur: Math.max(0.05, this.moveDuration), turnFrom: facing, turnTo: next,
      });
      facing = next;
    }
    return facing;
  }

  private beginCampaignAutoEvac() {
    if (!this.mission || !this.campaignRuntime || !this.campaignAutoEvacActive) return;
    const packageMission = GameSession.selectedCampaignPackages?.[this.activeCampaignSegmentIndex]?.mission;
    const segment = this.campaignRuntime.segments[this.activeCampaignSegmentIndex];
    if (!segment) return;
    const localParity = packageMission?.rowParityOffset === 1 ? 1 : 0;
    const target = axialAdd(
      offsetToAxial({ col: 7, row: 2 }, localParity),
      { q: segment.axialQOffset, r: segment.axialROffset },
    );
    const path = this.campaignAutoEvacPath(target);
    if (!path) {
      console.error('[Campaign] unable to find automatic evacuation route to (7,2)');
      this.campaignAutoEvacActive = false;
      return;
    }

    const sherman = this.mission.sherman;
    sherman.paralyzed = false;
    this.closeDiePopover();
    this.clearGunSelection();
    this.phaseDice = [];
    this.battleLog('[Campaign] 目标完成，已自动修复行走机构并开始撤离');

    const queue: MoveAnim[] = [];
    let facing = sherman.facing ?? 0;
    for (let index = 1; index < path.length; index++) {
      const from = path[index - 1]!;
      const to = path[index]!;
      const direction = directionTo(from, to)!;
      facing = this.queueCampaignAutoEvacTurn(queue, sherman, from, facing, direction);
      queue.push({
        unit: sherman, kind: 'move', fromQ: from.q, fromR: from.r, toQ: to.q, toR: to.r,
        t: 0, dur: Math.max(0.05, this.moveDuration),
      });
    }
    facing = this.queueCampaignAutoEvacTurn(queue, sherman, target, facing, 0);
    void facing;
    const exit = neighbor(target, 0);
    queue.push({
      unit: sherman, kind: 'move', fromQ: target.q, fromR: target.r, toQ: exit.q, toR: exit.r,
      t: 0, dur: Math.max(0.05, this.moveDuration), evacExit: true,
    });
    this.animQueue = queue;
    this.anim = this.animQueue.shift() ?? null;
    this.refreshStatusPanel();
    this.refreshPhaseUI();
    this.redraw();
  }

  /** 胜负覆盖层：懒创建，仅在 outcome 非 ongoing 时显示，并联动"再来一局"按钮的可见性 */
  private updateOutcomeOverlay() {
    if (this.outcome === 'ongoing') {
      if (this.outcomeLabel) this.outcomeLabel.node.active = false;
      if (this.restartBtn) this.restartBtn.active = false;
      if (this.backToMenuBtn) this.backToMenuBtn.active = false;
      return;
    }
    if (this.canAdvanceCampaignSegment()) {
      this.advanceCampaignSegment();
      return;
    }
    if (GameSession.isPvp && !this.pvpOutcomeSent) {
      this.pvpOutcomeSent = true;
      const pvp = GameSession.pvpSession;
      if (pvp?.active && this.pvpCurrentParity === pvp.localPlayer.parity) {
        PvpService.sendBattleEvent({
          kind: 'pvp_turn_end',
          turn: this.pvpLastSnapshotTurn,
          playerParity: pvp.localPlayer.parity,
          outcome: this.outcome,
          units: this.collectPvpBattleUnitsForSubmit(),
        });
      } else {
        PvpService.sendBattleEvent({
          kind: 'outcome',
          outcome: this.outcome,
          turn: this.turn,
        });
      }
    }
    // 胜利时回写菜单进度，下次主菜单会显示 ★ 并解锁下一关。
    // markCompleted 内部幂等，重复调用无副作用。
    const completedLevel = !this.campaignRuntime && this.missionSource.type === 'resource'
      ? findLevelByMissionId(this.missionId)
      : undefined;
    if (!GameSession.isPvp && this.outcome === 'victory') {
      if (this.campaignRuntime) {
        MenuProgress.markCompleted(GameSession.selectedLevelId, CAMPAIGN_CHAPTER_ID);
      } else if (completedLevel) {
        MenuProgress.markCompleted(completedLevel.id, completedLevel.chapterId);
      }
    }
    if (!this.outcomeLabel) {
      const n = new Node('OutcomeLabel');
      n.layer = this.node.layer;
      const ut = n.addComponent(UITransform);
      ut.setContentSize(760, 170);
      ut.setAnchorPoint(0.5, 0.5);
      n.setPosition(0, 16, 0);
      const l = n.addComponent(Label);
      l.fontSize = 62;
      l.lineHeight = 70;
      l.horizontalAlign = HorizontalTextAlignment.CENTER;
      l.verticalAlign = VerticalTextAlignment.CENTER;
      l.enableWrapText = true;
      this.node.addChild(n);
      this.outcomeLabel = l;
    }
    this.outcomeLabel.node.active = true;
    if (GameSession.isPvp && this.outcome === 'victory') {
      this.outcomeLabel.string = '胜利\n敌方主角坦克被击毁';
      this.outcomeLabel.color = new Color(255, 230, 80, 255);
    } else if (GameSession.isPvp) {
      this.outcomeLabel.string = '失败\n你的主角坦克被击毁';
      this.outcomeLabel.color = new Color(255, 80, 80, 255);
    } else if (this.outcome === 'victory') {
      this.outcomeLabel.string = t('outcome.win');
      this.outcomeLabel.color = new Color(255, 230, 80, 255);
    } else {
      this.outcomeLabel.string = t('outcome.lose');
      this.outcomeLabel.color = new Color(255, 80, 80, 255);
    }

    // 战役失败时可从自动保存的小关检查点重新开始；其他模式保留原“再来一局”。
    const retryCampaignSegment = !!this.campaignRuntime && this.outcome === 'defeat';
    if (!this.restartBtn) {
      this.restartBtn = this.makeSimpleButton(
        'RestartBtn', retryCampaignSegment ? t('btn.retryCampaignSegment') : t('btn.restart'),
        -80, -90,
        BTN_BG_NORMAL,
        () => this.campaignRuntime && this.outcome === 'defeat'
          ? this.restartCampaignSegment()
          : this.restartMission(),
      );
      this.restartBtnLabel = this.restartBtn.getChildByName('Label')?.getComponent(Label) ?? null;
    }
    if (this.restartBtnLabel) {
      this.restartBtnLabel.string = retryCampaignSegment ? t('btn.retryCampaignSegment') : t('btn.restart');
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
    stopBattleSfx();
    if (this.pvpBattleUnlisten) this.pvpBattleUnlisten();
    this.pvpBattleUnlisten = null;
    PvpService.sendBattleEvent({ kind: 'leave_battle', turn: this.turn, phase: this.phase });
    GameSession.clearPvpBattle();
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
    if (GameSession.isPvp) {
      this.returnToPvpSelection();
      return;
    }
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
    this.enemyDiceTypes = [];
    this.enemyDiceUsed = [];
    this.enemyDiceResolvedActions = [];
    this.clearAIMoveState();
    this.clearActiveActingUnit();
    this.destroyEnemyDiceTray();
    this.playerDiceRollAnim = null;
    this.playerDiceSortAnim = null;
    this.pendingAutoEndStep = null;
    this.phaseDice = [];
    this.clearGunSelection();
    this.movementDone = false;
    this.attackDone = false;
    this.miscDone = false;
    this.playerStep = 'choose';
    this.closeDiePopover();
    this.clearFloaters();
    this.clearMuzzleFlashes();
    this.clearMuzzleSmokes();
    this.clearProjectileTraces();
    this.clearInfantryRocketTraces();
    // 隐藏胜负覆盖层与按钮（loadAndDraw 内部 updateOutcomeOverlay 也会再做一次保险）
    if (this.outcomeLabel) this.outcomeLabel.node.active = false;
    if (this.restartBtn) this.restartBtn.active = false;
    this.loadAndDraw(data);
    this.battleLog('[BattleScene] === 重开当前任务 ===');
  }

  /** Restore the campaign-only checkpoint instead of reloading the campaign's first segment. */
  private restartCampaignSegment() {
    if (!this.campaignRuntime || !this.mission) return;
    const checkpoint = readCampaignCheckpoint(this.campaignRuntime.campaign.id);
    if (!checkpoint
      || checkpoint.campaignId !== this.campaignRuntime.campaign.id
      || checkpoint.segmentIndex !== this.activeCampaignSegmentIndex) {
      console.warn('[Campaign] 当前小关没有可用检查点，改为重开当前任务');
      this.restartMission();
      return;
    }
    const result = applySave(this.mission, this.missionId, checkpoint.save);
    if (!result.ok) {
      console.warn('[Campaign] 小关检查点无效，改为重开当前任务:', result.reason);
      this.restartMission();
      return;
    }
    resetCampaignUpgradeSegmentCharges(this.mission.sherman, this.campaignUpgradeIds);
    this.retainedCampaignAttackDiePip = null;
    this.restoreAppliedSave(result, true);
    this.battleLog(`[Campaign] === 从第 ${this.activeCampaignSegmentIndex + 1} 小关检查点重新挑战 ===`);
  }

  /** PVP 结算后的“再来一局”应重新选择匹配方式，而不是重置当前对局。 */
  private returnToPvpSelection() {
    this.battleLog('[BattleScene] PVP 对局结束，返回 PVP 对战选择');
    stopBattleSfx();
    if (this.pvpBattleUnlisten) this.pvpBattleUnlisten();
    this.pvpBattleUnlisten = null;
    PvpService.sendBattleEvent({ kind: 'leave_battle', turn: this.turn, phase: this.phase });
    GameSession.returnToPvpSelection();
    director.loadScene(this.mainMenuSceneName, (err) => {
      if (err) console.error('[BattleScene] 加载主菜单场景失败:', this.mainMenuSceneName, err);
    });
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
    this.hudParent().addChild(bar);
    this.chooseBar = bar;

    const makeBtn = (name: string, text: string, x: number, color: Color,
                     onClick: () => void): { root: Node; label: Label } => {
      const W = BTN_W, H = BTN_H;
      const b = new Node(name);
      b.layer = this.node.layer;
      b.addComponent(UITransform).setContentSize(W, H);
      b.setPosition(x, 0, 0);
      const bg = b.addComponent(Graphics);
      bg.fillColor = opaqueButtonFill(color);
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
      bindButtonPressScale(b, b, () => !this.disabledPhaseButtons.has(b));
      b.on(Node.EventType.TOUCH_END, () => {
        if (this.disabledPhaseButtons.has(b)) return;
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
      this.setPhaseBtnEnabled(this.chooseHatchBtn, !this.hatchChangedThisTurn, PHASE_BTN_HATCH);
    }
  }

  /** 底部骰子托盘：槽位按 phaseDice.length 动态补足。 */
  private buildDiceTray() {
    const tray = new Node('DiceTray');
    tray.layer = this.node.layer;
    tray.addComponent(UITransform).setContentSize(640, 120);
    tray.setPosition(0, BOTTOM_PHASE_ROW_Y, 0);
    this.hudParent().addChild(tray);
    this.diceTrayRoot = tray;

    // 初始为空；进入阶段后由 refreshDiceTray 按实际颗数补槽并居中。
    tray.active = false;
  }

  private ensureDiceVisualCount(count: number) {
    if (!this.diceTrayRoot) return;
    const SLOT = BattleScene.DICE_TRAY_SLOT;
    for (let i = this.diceVisuals.length; i < count; i++) {
      const slot = new Node(`Die${i}`);
      slot.layer = this.node.layer;
      slot.addComponent(UITransform).setContentSize(SLOT, SLOT);
      slot.setPosition(0, 0, 0);
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
      bindButtonPressScale(slot);
      slot.on(Node.EventType.TOUCH_END, () => this.onClickDie(idx), this);
      this.diceTrayRoot.addChild(slot);

      this.diceVisuals.push({ root: slot, bg, pips, faceLabel: face, hintLabel: hint });
    }
  }

  /** 根据 playerStep / 胜负 / 敌方阶段等状态切换底部 UI 的可见性与文字。 */
  private refreshPhaseUI() {
    const pvpReady = !GameSession.isPvp || this.pvpBattleStarted;
    const inBattle = pvpReady && this.phase === 'player' && this.outcome === 'ongoing';
    this.refreshCampaignDebugSkipButton();
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
    this.refreshDiceTray();
    // 点击骰子后弹出的菜单，状态变化时（比如骰子被消耗）一并关闭
    if (!inBattle || this.playerStep === 'choose') this.closeDiePopover();

    // A+B 均已完成且尚未进杂项：空闲时同步进入，busy 时持续等到当前结算结束。
    if (pendingMiscAuto) {
      if (!this.isBusy()) {
        this.enterPhaseIfChoose('misc');
        return;
      }
      // 对子主炮会在结算面板仍处于 busy 时一次消耗最后两颗骰子。
      // 此时单帧重试很容易早于面板关闭，导致移动/攻击均完成后卡在 choose。
      this.autoEnterPhaseWhenReady('misc');
    }
  }

  private setPhaseBtnEnabled(btn: Node, enabled: boolean, baseColor: Color) {
    if (enabled) this.disabledPhaseButtons.delete(btn);
    else this.disabledPhaseButtons.add(btn);
    const g = btn.getComponent(Graphics);
    if (!g) return;
    const ut = btn.getComponent(UITransform);
    if (!ut) return;
    g.clear();
    g.fillColor = opaqueButtonFill(enabled ? baseColor : PHASE_BTN_DISABLED);
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
    this.ensureDiceVisualCount(n);
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
    const { height } = visibleSizeInRootSpace(UI_ROOT_SCALE);
    tray.setPosition(0, -height * 0.5 + 20 + BOTTOM_CONTROL_SAFE_INSET, 0);
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
      fill: slot.used ? DIE_FACE_USED_FILL : this.playerDieFillColor(),
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
        case 'gun':    return {
          text: this.campaignReadyRackCanReloadShootingDice() ? t('die.hint.gunOrLoad') : t('die.hint.gun'),
          color: DIE_HINT_RED,
        };
        case 'mg':     return { text: t('die.hint.mg'),     color: DIE_HINT_GREY };
        default:       return { text: t('die.hint.none'),   color: DIE_HINT_GREY };
      }
    }
    if (this.playerStep === 'misc') {
      const m = classifyMiscDie(pip);
      switch (m) {
        case 'fire_suppress':         return { text: t('die.hint.fireSuppress'),      color: DIE_HINT_GREEN };
        case 'repair':                return {
          text: this.miscDieCanDeploySmoke(pip) ? t('die.hint.smokeOrRepair') : t('die.hint.repair'),
          color: DIE_HINT_GREEN,
        };
        case 'smoke_or_repair':       return { text: t('die.hint.smokeOrRepair'),     color: DIE_HINT_GREEN };
        case 'driver_turn_or_drive':  return { text: t('die.hint.driverTurnOrDrive'), color: DIE_HINT_GREEN };
        case 'gunner_gun_or_reload':  return { text: t('die.hint.gunOrLoad'),         color: DIE_HINT_RED   };
        case 'codriver_mg':           return {
          text: this.miscDieCanDeploySmoke(pip) ? t('die.hint.smokeOrMG') : t('die.hint.codriverMG'),
          color: DIE_HINT_GREY,
        };
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
    if (this.hatchChangedThisTurn) return 'floater.hatchLocked';
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
    const openingHatch = !s.hatchOpen;
    const visibilityBefore = openingHatch ? this.displayedFogVisionSnapshot() : null;
    s.hatchOpen = !s.hatchOpen;
    playCommanderHatch(s.hatchOpen);
    if (visibilityBefore) {
      this.startFogVisionTransition(visibilityBefore, true, HATCH_VISION_LAYER_INTERVAL);
    } else {
      this.fogVisionTransition = null;
    }
    this.hatchChangedThisTurn = true;
    this.battleLogI18n('battleLog.hatch', {
      stateKey: s.hatchOpen ? 'status.val.hatchOpen' : 'status.val.hatchClosed',
    });
    this.sendPvpActionResult('hatch_toggle', {
      type: 'hatch_toggle',
      unitId: s.id,
      q: s.pos.q,
      r: s.pos.r,
      open: s.hatchOpen,
    });
    this.refreshStatusPanel();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
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
    const modeConfig = getGameModeConfig(GameSession.gameMode);
    const count = actionDicePool({
      subPhase,
      terrain,
      hatchOpen: hatchOpenRaw,
      crew,
      commanderBonusWithoutOpenHatch: modeConfig.commanderBonusWithoutOpenHatch,
      hardcore: GameSession.gameMode === 'hardcore',
      mobility: sherman.stats.mobility,
      externalBonus: this.campaignUpgradesEnabled()
        ? campaignUpgradeDiceBonus(this.campaignUpgradeIds, terrain, subPhase)
        : 0,
    });
    const rolledPips = rollActionDice(this.rng, count);
    const retainedAttackPip = subPhase === 'attack'
      && this.campaignUpgradeActive('ammo_handling_optimization')
      && campaignUpgradeDefinition('ammo_handling_optimization').carryLowestUnusedAttackDie
      ? this.retainedCampaignAttackDiePip
      : null;
    const pips = retainedAttackPip == null ? rolledPips : [...rolledPips, retainedAttackPip];
    if (subPhase === 'attack') this.retainedCampaignAttackDiePip = null;
    this.pendingAutoEndStep = null;
    this.phaseDice = pips.map((_, i) => ({ pip: ((i * 2) % 6) + 1, used: false }));
    this.clearGunSelection();
    this.playerStep = which;
    this.closeDiePopover();

    const phaseKey = which === 'movement' ? 'battleLog.phase.movement'
      : which === 'attack' ? 'battleLog.phase.attack' : 'battleLog.phase.misc';
    const hatchForLog = hatchOpenRaw && !!crew.commander;
    this.playerDiceRollAnim = {
      t: 0,
      dur: DICE_ROLL_DUR,
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
   * 若结束的是杂项阶段 → 进入着火检定，再依次进入友方（若有）与敌方阶段。
   * 若结束的是移动或攻击：另一翼未完成则下一帧自动进入该翼；两翼均完成则由 refreshPhaseUI 自动进杂项。
   */
  private endCurrentSubPhase() {
    const was = this.playerStep;
    const wasMisc = was === 'misc';
    if (was === 'attack'
      && this.campaignUpgradeActive('ammo_handling_optimization')
      && campaignUpgradeDefinition('ammo_handling_optimization').carryLowestUnusedAttackDie) {
      const unused = this.phaseDice.filter(slot => !slot.used).map(slot => slot.pip);
      this.retainedCampaignAttackDiePip = unused.length > 0 ? Math.min(...unused) : null;
    }
    if (was === 'movement') this.movementDone = true;
    else if (was === 'attack') this.attackDone = true;
    else if (was === 'misc') this.miscDone = true;
    this.playerDiceRollAnim = null;
    this.playerDiceSortAnim = null;
    this.pendingAutoEndStep = null;
    this.phaseDice = [];
    this.clearGunSelection();
    this.closeDiePopover();
    if (wasMisc && this.phase === 'player' && this.outcome === 'ongoing'
        && this.movementDone && this.attackDone) {
      this.playerStep = 'choose';
      // Fade immediately when the player commits "End Turn", before fire checks
      // and AI movement make the visual change difficult to notice.
      this.fadeTankTracksAtTurnEnd();
      if (GameSession.isPvp) {
        this.submitPvpTurnEnd();
        return;
      }
      this.beginFireCheckPhase();
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
          this.autoEnterPhaseWhenReady(next);
        }
      }
    }
  }

  private autoEnterPhaseWhenReady(which: 'movement' | 'attack' | 'misc') {
    if (this.pendingAutoEnterPhase === which) return;
    this.pendingAutoEnterPhase = which;
    const retry = () => {
      if (this.pendingAutoEnterPhase !== which) return;
      if (this.phase !== 'player' || this.outcome !== 'ongoing') {
        this.pendingAutoEnterPhase = null;
        return;
      }
      const noLongerNeeded = this.playerStep !== 'choose'
        || (which === 'movement' && this.movementDone)
        || (which === 'attack' && this.attackDone)
        || (which === 'misc' && (this.miscDone || !this.movementDone || !this.attackDone));
      if (noLongerNeeded) {
        this.pendingAutoEnterPhase = null;
        return;
      }
      if (this.isBusy()) {
        this.scheduleOnce(retry, 0);
        return;
      }
      this.pendingAutoEnterPhase = null;
      this.enterPhaseIfChoose(which);
    };
    this.scheduleOnce(retry, 0);
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

  /**
   * 统一消耗玩家阶段骰，并在本次消耗后检查是否还存在“未使用骰子”。
   * 这里只记录待结束状态；异步动作必须等动画/结算完成后调用 completePhaseDiceAction()。
   */
  private usePhaseDice(indices: number[]) {
    if (this.playerStep !== 'movement'
      && this.playerStep !== 'attack'
      && this.playerStep !== 'misc') return;
    for (const index of indices) {
      const die = this.phaseDice[index];
      if (die) die.used = true;
    }
    const selectedWeaponDieConsumed = indices.includes(this.selectedGunDieIdx)
      || indices.includes(this.selectedGunDoublesIdx)
      || indices.includes(this.selectedMGDieIdx);
    if (selectedWeaponDieConsumed) {
      this.clearGunSelection();
      // 部分骰子行动异步刷新完整地图；先直接重绘覆盖层，确保范围提示立即消失。
      this.redrawFogOverlay();
    }
    if (this.phaseDice.length > 0 && !this.phaseDice.some(die => !die.used)) {
      this.pendingAutoEndStep = this.playerStep;
    }
  }

  /** 当前骰子动作已经完整结束；若该动作耗尽了未使用骰子，则立即推进阶段。 */
  private completePhaseDiceAction() {
    const pendingStep = this.pendingAutoEndStep;
    if (!pendingStep) return;
    if (this.phase !== 'player' || this.outcome !== 'ongoing') {
      this.pendingAutoEndStep = null;
      return;
    }
    // 防止旧的异步回调结束当前已经切换过的阶段。
    if (this.playerStep !== pendingStep) {
      this.pendingAutoEndStep = null;
      return;
    }
    // 完成时再次以“是否还有未使用骰子”为准，避免只依赖先前记录。
    if (this.phaseDice.length === 0 || this.phaseDice.some(die => !die.used)) {
      this.pendingAutoEndStep = null;
      return;
    }
    this.pendingAutoEndStep = null;
    this.autoEndPhaseIfDone();
  }

  // ---------- 骰子点击菜单 ----------

  private crewActionUnavailable(slot: 'commander' | 'loader' | 'gunner' | 'driver' | 'coDriver'): string | null {
    if (!this.mission) return t('attack.reason.unknown');
    const crew = this.mission.sherman.crew;
    if (!crew || crew[slot]) return null;
    const roleKey = {
      commander: 'crew.role.1',
      loader: 'crew.role.3',
      gunner: 'crew.role.2',
      driver: 'crew.role.4',
      coDriver: 'crew.role.5',
    }[slot];
    return t('floater.roleUnavailable', { role: t(roleKey) });
  }

  private turnActionUnavailable(crewSlot?: 'driver' | 'coDriver'): string | null {
    if (!this.mission) return t('attack.reason.unknown');
    const crewReason = crewSlot ? this.crewActionUnavailable(crewSlot) : null;
    if (crewReason) return crewReason;
    return this.mission.sherman.paralyzed ? t('floater.paralyzedBlocked') : null;
  }

  private driveActionUnavailable(dirSign: 1 | -1, crewSlot?: 'driver'): string | null {
    if (!this.mission) return t('attack.reason.unknown');
    const crewReason = crewSlot ? this.crewActionUnavailable(crewSlot) : null;
    if (crewReason) return crewReason;
    const { map, sherman } = this.mission;
    if (sherman.paralyzed) return t('floater.paralyzedBlocked');
    if (sherman.facing === null) return t('floater.noFacing');
    const driveDir = dirSign === 1 ? sherman.facing : rotateDirection(sherman.facing, 3);
    const to = neighbor(sherman.pos, driveDir as Direction);
    if (!GameSession.isPvp && isPlayerTankEvacDrive(this.mission, sherman.pos, sherman.facing as Direction, dirSign, to, {
      canExitTo: (target) => this.isCampaignNextSegmentEntry(target),
    })) return null;
    const canCrossBreakwater = this.playerStep === 'misc' && dirSign === 1;
    if (!map.get(to) || !this.canMoveToBattleTile(to) || !map.canTankCrossEdge(sherman.pos, to, {
      ignoreBreakwater: canCrossBreakwater,
      faction: sherman.faction,
    })) {
      return t('floater.blockedTerrain');
    }
    const blocker = this.findMoveBlocker(sherman, to);
    return blocker ? t('floater.enemyBlock') : null;
  }

  private reloadActionUnavailable(crewSlot?: 'loader', shellType?: ShellType): string | null {
    if (!this.mission) return t('attack.reason.unknown');
    const crewReason = crewSlot ? this.crewActionUnavailable(crewSlot) : null;
    if (crewReason) return crewReason;
    const sherman = this.mission.sherman;
    if (GameSession.gameMode !== 'hardcore') return sherman.loaded ? t('floater.alreadyLoaded') : null;
    const current = resolvedLoadedShell(sherman);
    if (shellType && current === shellType) return t('floater.alreadyLoaded');
    if (shellType === 'hvap' && (!this.campaignUpgradeActive('hvap') || (sherman.hvapAmmoRemaining ?? 0) <= 0)) {
      return t('floater.noHvapAmmo');
    }
    return null;
  }

  private gunActionUnavailable(crewSlot?: 'gunner'): string | null {
    if (!this.mission) return t('attack.reason.unknown');
    const s = this.mission.sherman;
    // 炮塔受损时主炮/旋转入口直接置灰；点击灰色按钮只提示受损原因，
    // 不再进入目标选择态或显示炮塔转向范围。
    if (s.turretDamaged) return t('dmg.effect.turret');
    const crewReason = crewSlot ? this.crewActionUnavailable(crewSlot) : null;
    if (crewReason) return crewReason;
    // 硬核模式下主炮骰始终可用于旋转炮塔；该用途不需要装填，也不受舱盖状态影响。
    // 实际开炮仍会在 tryAttack 中要求 loaded。
    const canUseUnloadedForTurretRecon = GameSession.gameMode === 'hardcore'
      && this.playerTurretCanRotate();
    if (!s.loaded && !canUseUnloadedForTurretRecon) return t('hud.unloaded');
    if (!fogOfWarEnabled(GameSession.gameMode)) {
      const hasTarget = this.mission.enemies.some(e => !e.destroyed && canAttack({
        attacker: s,
        target: e,
        map: this.mission!.map,
        smokeHexes: this.mission!.smokeHexes,
        expandedTurretDirections: getGameModeConfig(GameSession.gameMode).expandedTurretDirections,
        mainGunSuppressesInfantry: GameSession.gameMode === 'hardcore',
      }).ok);
      return hasTarget ? null : t('floater.noGunTarget');
    }
    return null;
  }

  private precisionGunActionUnavailable(): string | null {
    if (!this.mission) return t('attack.reason.unknown');
    const crewReason = this.crewActionUnavailable('gunner');
    if (crewReason) return crewReason;
    // Unlike ordinary hardcore main-gun selection, precision fire can never be
    // used as an unloaded rotation-only action.
    if (!isMainGunLoaded(this.mission.sherman, GameSession.gameMode === 'hardcore')) return t('hud.unloaded');
    return this.gunActionUnavailable();
  }

  private mgActionUnavailable(): string | null {
    if (!this.mission) return t('attack.reason.unknown');
    // Turret damage does not disable an independent hull MG. The weapon remains
    // selectable, but no blue traverse overlay is shown because the turret cannot rotate.
    if (this.mission.sherman.turretDamaged) return null;
    // 硬核模式可将机枪骰用于瞄准迷雾内地格；即使当前没有合法步兵目标也不禁用。
    if (GameSession.gameMode === 'hardcore') return null;
    const { map, sherman } = this.mission;
    const units = this.allUnits();
    const hasTarget = this.mission.enemies.some(e => !e.destroyed && canMGAttack({
      attacker: sherman,
      target: e,
      map,
      theater: this.mission!.data.theater,
      units,
      smokeHexes: this.mission!.smokeHexes,
      expandedTurretDirections: getGameModeConfig(GameSession.gameMode).expandedTurretDirections,
      atGunCrewTargets: GameSession.gameMode === 'hardcore',
    }).ok);
    return hasTarget ? null : t('floater.noInfantry');
  }

  private smokeActionUnavailable(): string | null {
    if (!this.mission) return t('attack.reason.unknown');
    const { map, sherman } = this.mission;
    if (tileForbidsSmokeOrConcealment(map.get(sherman.pos))) return t('floater.beachNoSmoke');
    return this.hasSmokeAt(sherman.pos) ? t('floater.alreadySmoked') : null;
  }

  private showDieActionUnavailable(reason: string, anchor?: Node) {
    if (!this.mission) return;
    if (anchor) {
      this.spawnUiFloaterAtNode(anchor, reason,
        new Color(255, 200, 120, 255), { size: 22, dur: 1.0, rise: 24 });
      return;
    }
    const s = this.mission.sherman;
    this.closeDiePopover();
    this.spawnFloater(s.pos.q, s.pos.r, reason,
      new Color(255, 200, 120, 255), { size: 22, dur: 1.0, rise: 24 });
  }

  private onClickDie(idx: number) {
    playUiClick();
    if (this.isBusy()) return;
    if (this.phase !== 'player') return;
    if (this.outcome !== 'ongoing') return;
    if (this.playerStep !== 'movement'
      && this.playerStep !== 'attack'
      && this.playerStep !== 'misc') return;
    const slot = this.phaseDice[idx];
    const selectedWeaponDieIdx = this.selectedGunDieIdx >= 0
      ? this.selectedGunDieIdx
      : this.selectedMGDieIdx;
    if (slot && selectedWeaponDieIdx >= 0 && selectedWeaponDieIdx !== idx) {
      this.clearGunSelection();
      this.refreshPhaseUI();
      this.updateHUD();
      this.redraw();
    }
    if (this.diePopover && this.diePopoverDieIdx === idx) {
      this.closeDiePopover();
      return;
    }
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
      if (a === 'drive' && !hasDoubles && !this.campaignMovementDiceCanReverseDirection()
        && !this.driveActionUnavailable(+1)) {
        this.closeDiePopover();
        this.tryDriveSherman(idx, +1);
        return;
      }
      if (a === 'reverse' && !hasDoubles && !this.campaignMovementDiceCanReverseDirection()
        && !this.driveActionUnavailable(-1)) {
        this.closeDiePopover();
        this.tryDriveSherman(idx, -1);
        return;
      }
    } else if (this.playerStep === 'attack') {
      const a = classifyAttackDie(slot.pip);
      if (GameSession.gameMode !== 'hardcore' && a === 'reload' && !hasDoubles && !this.reloadActionUnavailable()) {
        this.closeDiePopover();
        this.tryReload(idx);
        return;
      }
    } else if (this.playerStep === 'misc') {
      // 杂项阶段 1 点 = 灭火，无分支 → 直接执行。
      // 但若有同点搭档（= 可走"隐蔽"对子动作），则改走 popover 让玩家选择。
      const m = classifyMiscDie(slot.pip);
      if (m === 'fire_suppress' && !hasDoubles && (this.mission?.sherman.fireLevel ?? 0) > 0) {
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
    this.diePopoverDieIdx = -1;
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
    type Item = {
      text: string;
      color: Color;
      onClick: () => void;
      unavailableReason: string | null;
      compactTurn: boolean;
      badge?: string;
    };
    const items: Item[] = [];
    const nonDoublesEffects = new Set<string>();
    const addItem = (text: string, color: Color, onClick: () => void,
      unavailableReason: string | null = null, compactTurn = false,
      effectId?: string, doubles = false, badge?: string) => {
      // A matching-dice action must not repeat an effect already offered by this
      // die alone. Keep the cheaper single-die action and omit the duplicate pair.
      if (doubles && effectId && nonDoublesEffects.has(effectId)) return;
      if (!doubles && effectId) nonDoublesEffects.add(effectId);
      items.push({
        text,
        color: unavailableReason ? DIE_ACTION_UNAVAILABLE : color,
        onClick,
        unavailableReason,
        compactTurn,
        badge,
      });
    };
    const addReloadItems = (
      color: Color,
      onReload: (shellType?: ShellType) => void,
      crewSlot?: 'loader',
      classicKey = 'action.reload',
      doubles = false,
    ) => {
      if (GameSession.gameMode === 'hardcore') {
        addItem(t('action.reloadAP'), color, () => onReload('ap'), this.reloadActionUnavailable(crewSlot, 'ap'), true,
          'reload-ap', doubles);
        addItem(t('action.reloadHE'), color, () => onReload('he'), this.reloadActionUnavailable(crewSlot, 'he'), true,
          'reload-he', doubles);
        if (this.campaignUpgradeActive('hvap')) {
          const remaining = this.mission?.sherman.hvapAmmoRemaining ?? 0;
          addItem(t('action.reloadHVAP'), color, () => onReload('hvap'),
            this.reloadActionUnavailable(crewSlot, 'hvap'), true, 'reload-hvap', doubles, String(remaining));
        }
      } else {
        addItem(t(classicKey), color, () => onReload(), this.reloadActionUnavailable(crewSlot), false,
          'reload', doubles);
      }
    };

    const hasDoublesPartner = this.findDoublesPartner(idx) >= 0;
    const unloadedTurretRotation = GameSession.gameMode === 'hardcore'
      && !!this.mission
      && !isMainGunLoaded(this.mission.sherman, GameSession.gameMode === 'hardcore');
    const fireActionKey = unloadedTurretRotation
      ? 'action.rotateTurret'
      : GameSession.gameMode === 'hardcore' ? 'action.fireHardcore' : 'action.fire';
    const mainGunEffectId = unloadedTurretRotation ? 'turret-rotation' : 'main-gun';

    if (this.playerStep === 'movement') {
      const a = classifyMoveDie(slot.pip);
      const transmissionAllowsBothDirections = (a === 'drive' || a === 'reverse')
        && this.campaignMovementDiceCanReverseDirection();
      if (a === 'turn') {
        addItem(t('action.turnCCW'), PHASE_BTN_MOVE,
          () => this.tryTurnSherman(idx, -1), this.turnActionUnavailable(), true);
        addItem(t('action.turnCW'), PHASE_BTN_MOVE,
          () => this.tryTurnSherman(idx, +1), this.turnActionUnavailable(), true);
      } else if (a === 'drive') {
        addItem(t('action.advance'), PHASE_BTN_MOVE,
          () => this.tryDriveSherman(idx, +1), this.driveActionUnavailable(+1));
        if (transmissionAllowsBothDirections) {
          addItem(t('action.reverse'), PHASE_BTN_MOVE,
            () => this.tryDriveSherman(idx, -1), this.driveActionUnavailable(-1));
        }
      } else if (a === 'reverse') {
        if (transmissionAllowsBothDirections) {
          addItem(t('action.advance'), PHASE_BTN_MOVE,
            () => this.tryDriveSherman(idx, +1), this.driveActionUnavailable(+1));
        }
        addItem(t('action.reverse'), PHASE_BTN_MOVE,
          () => this.tryDriveSherman(idx, -1), this.driveActionUnavailable(-1));
      }
      // §3.6 A 列对子：驾驶员前进 / 副驾驶 ↻ 60° / 副驾驶 ↺ 60°
      if (hasDoublesPartner) {
        if (a !== 'drive' && !transmissionAllowsBothDirections) {
          addItem(t('action.doublesDriverAdvance'), DIE_ACTION_DOUBLES,
            () => this.tryDoublesDriverAdvance(idx), this.driveActionUnavailable(+1, 'driver'));
        }
        if (a !== 'turn') {
          addItem(t('action.doublesCoDriverTurnCCW'), DIE_ACTION_DOUBLES,
            () => this.tryDoublesCoDriverTurn(idx, -1), this.turnActionUnavailable('coDriver'), true);
          addItem(t('action.doublesCoDriverTurnCW'), DIE_ACTION_DOUBLES,
            () => this.tryDoublesCoDriverTurn(idx, +1), this.turnActionUnavailable('coDriver'), true);
        }
      }
    } else if (this.playerStep === 'attack') {
      const a = classifyAttackDie(slot.pip);
      if (a === 'reload') {
        addReloadItems(PHASE_BTN_ATTACK, shell => this.tryReload(idx, shell));
      } else if (a === 'gun') {
        addItem(t(fireActionKey), PHASE_BTN_ATTACK,
          () => this.selectGunDie(idx), this.gunActionUnavailable(), false, mainGunEffectId);
        if (this.campaignReadyRackCanReloadShootingDice()) {
          addReloadItems(PHASE_BTN_ATTACK, shell => this.tryReload(idx, shell));
        }
      } else if (a === 'mg') {
        addItem(t('action.fireMG'), PHASE_BTN_ATTACK,
          () => this.selectMGDie(idx), this.mgActionUnavailable(), false,
          unloadedTurretRotation ? 'turret-rotation' : undefined);
      }
      // §3.6 B 列对子：装填手装填（+同点骰）/ 炮手主炮射击（+同点骰）
      if (hasDoublesPartner) {
        if (a !== 'reload') {
          addReloadItems(DIE_ACTION_DOUBLES, shell => this.tryDoublesLoaderReload(idx, shell), 'loader',
            'action.doublesLoaderReload', true);
        }
        if (a !== 'gun') {
          addItem(t(unloadedTurretRotation
            ? 'action.doublesGunnerRotate'
            : 'action.doublesGunnerFire'), DIE_ACTION_DOUBLES,
            () => this.selectGunDieDoubles(idx), this.gunActionUnavailable('gunner'), false,
            mainGunEffectId, true);
        }
        if (a === 'gun' && getGameModeConfig(GameSession.gameMode).precisionFire) {
          addItem(t('action.precisionFire'), DIE_ACTION_DOUBLES,
            () => this.selectPrecisionGunDie(idx), this.precisionGunActionUnavailable());
        }
      }
    } else if (this.playerStep === 'misc') {
      const m = classifyMiscDie(slot.pip);
      const sherman = this.mission ? this.mission.sherman : null;
      switch (m) {
        case 'gunner_gun_or_reload':
          // 6 点 C 列：炮手主炮射击 / 装填手装填 → 二选一
          addReloadItems(PHASE_BTN_ATTACK, shell => this.tryReload(idx, shell), 'loader');
          addItem(t(fireActionKey), PHASE_BTN_ATTACK,
            () => this.selectGunDie(idx), this.gunActionUnavailable('gunner'));
          break;
        case 'codriver_mg':
          // 4 点 C 列：机枪射击步兵；不要求副驾驶存活。烟幕发射器可追加烟雾弹。
          addItem(t('action.fireMGCoDriver'), PHASE_BTN_ATTACK,
            () => this.selectMGDie(idx), this.mgActionUnavailable());
          if (this.miscDieCanDeploySmoke(slot.pip)) {
            addItem(t('action.smoke'), PHASE_BTN_MISC, () => this.trySmoke(idx), this.smokeActionUnavailable());
          }
          break;
        case 'driver_turn_or_drive':
          // 5 点 C 列：驾驶员转向 / 前进
          addItem(t('action.turnCCW'), PHASE_BTN_MOVE,
            () => this.tryTurnSherman(idx, -1), this.turnActionUnavailable('driver'), true);
          addItem(t('action.turnCW'), PHASE_BTN_MOVE,
            () => this.tryTurnSherman(idx, +1), this.turnActionUnavailable('driver'), true);
          addItem(t('action.advance'), PHASE_BTN_MOVE,
            () => this.tryDriveSherman(idx, +1), this.driveActionUnavailable(+1, 'driver'));
          break;
        case 'repair':
          // 2 点 C 列：修复任一受损的已配置部件；烟幕发射器可追加烟雾弹。
          if (sherman) {
            if (this.miscDieCanDeploySmoke(slot.pip)) {
              addItem(t('action.smoke'), PHASE_BTN_MISC, () => this.trySmoke(idx), this.smokeActionUnavailable());
            }
            const repairable = repairableComponentsFor(GameSession.gameMode)
              .filter((component) => component.isDamaged(sherman));
            for (const component of repairable) {
              addItem(t(component.actionKey), PHASE_BTN_MISC,
                () => this.tryRepair(idx, component.id));
            }
            if (repairable.length === 0) {
              addItem(t('action.repair'), PHASE_BTN_MISC, () => {}, t('floater.noRepair'));
            }
            if (this.campaignUpgradeActive('automatic_extinguisher')) {
              addItem(t('action.fireSuppress'), PHASE_BTN_MISC, () => this.tryFireSuppress(idx),
                (sherman.fireLevel ?? 0) > 0 ? null : t('floater.noFire'));
            }
          }
          break;
        case 'smoke_or_repair':
          // 3 点 C 列：烟雾 / 修复（所有已配置的受损部件）；烟雾弹初始可用。
          addItem(t('action.smoke'), PHASE_BTN_MISC, () => this.trySmoke(idx), this.smokeActionUnavailable());
          const smokeRepairable = sherman ? repairableComponentsFor(GameSession.gameMode)
            .filter((component) => component.isDamaged(sherman)) : [];
          for (const component of smokeRepairable) {
            addItem(t(component.actionKey), PHASE_BTN_MISC, () => this.tryRepair(idx, component.id));
          }
          if (sherman && smokeRepairable.length === 0) {
            addItem(t('action.repair'), PHASE_BTN_MISC, () => {}, t('floater.noRepair'));
          }
          if (sherman && this.campaignUpgradeActive('automatic_extinguisher')) {
            addItem(t('action.fireSuppress'), PHASE_BTN_MISC, () => this.tryFireSuppress(idx),
              (sherman.fireLevel ?? 0) > 0 ? null : t('floater.noFire'));
          }
          break;
        case 'fire_suppress':
          // 1 点 C 列：灭火（着火程度 -1）—— 正常走 onClickDie 直接执行；
          // 若 popover 被触发（比如玩家通过其他途径），这里兜底给一个按钮
          addItem(t('action.fireSuppress'), PHASE_BTN_MISC, () => this.tryFireSuppress(idx),
            (sherman?.fireLevel ?? 0) > 0 ? null : t('floater.noFire'));
          break;
        default:
          break;
      }
      // §3.6 对子 C 列：只要存在同点搭档，就追加"隐蔽（+同点骰）"
      if (hasDoublesPartner) {
        const concealReason = !sherman ? t('attack.reason.unknown')
          : sherman.paralyzed ? t('floater.paralyzedNoConceal')
            : tileForbidsSmokeOrConcealment(this.mission?.map.get(sherman.pos)) ? t('floater.beachNoConceal')
              : sherman.hidden ? t('floater.alreadyConcealed') : null;
        addItem(t('action.concealPair'), DIE_ACTION_DOUBLES,
          () => this.tryConcealment(idx), concealReason);
        if (getGameModeConfig(GameSession.gameMode).miscCloseHatchWithDoubles) {
          const closeHatchReason = !sherman ? t('attack.reason.unknown')
            : sherman.crew && !sherman.crew.commander ? t('floater.hatchCommanderDead')
              : !sherman.hatchOpen ? t('floater.hatchAlreadyClosed') : null;
          addItem(t('action.closeHatchPair'), DIE_ACTION_DOUBLES,
            () => this.tryCloseHatchWithDoubles(idx), closeHatchReason);
        }
      }
    }

    if (items.length === 0) return;

    const ITEM_W = 180, ITEM_H = 40, GAP = 6;
    // 两个转向按钮加上中间隔后总宽正好等于普通按钮，左右边缘对齐。
    const TURN_ITEM_W = (ITEM_W - GAP) / 2;
    const rows: Item[][] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const next = items[i + 1];
      if (item.compactTurn && next?.compactTurn) {
        rows.push([item, next]);
        i++;
      } else {
        rows.push([item]);
      }
    }
    const panelH = rows.length * ITEM_H + (rows.length - 1) * GAP;

    const panel = new Node('DiePopover');
    panel.layer = this.node.layer;
    panel.addComponent(UITransform).setContentSize(ITEM_W, panelH);
    const slotWorldPos = vis.root.worldPosition;
    const parentUT = this.node.getComponent(UITransform);
    const local = parentUT ? parentUT.convertToNodeSpaceAR(slotWorldPos) : new Vec3(0, 0, 0);
    // 紧贴骰子上沿，仅保留少量触控间距。
    panel.setPosition(
      local.x,
      local.y + BattleScene.DICE_TRAY_SLOT / 2 + 8 + panelH / 2,
      0,
    );
    this.node.addChild(panel);

    let itemIndex = 0;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
        const it = row[columnIndex];
        const itemW = row.length === 2 ? TURN_ITEM_W : ITEM_W;
        const btn = new Node(`DieAction${itemIndex++}`);
        btn.layer = this.node.layer;
        btn.addComponent(UITransform).setContentSize(itemW, ITEM_H);
        const x = row.length === 2
          ? (columnIndex === 0 ? -1 : 1) * (TURN_ITEM_W + GAP) / 2
          : 0;
        btn.setPosition(x, panelH / 2 - ITEM_H / 2 - rowIndex * (ITEM_H + GAP), 0);
        const bg = btn.addComponent(Graphics);
        bg.fillColor = opaqueButtonFill(it.color);
        bg.strokeColor = BTN_BORDER;
        bg.lineWidth = 2;
        bg.rect(-itemW / 2, -ITEM_H / 2, itemW, ITEM_H);
        bg.fill();
        bg.stroke();
        const tn = new Node('Label');
        tn.layer = this.node.layer;
        tn.addComponent(UITransform).setContentSize(itemW, ITEM_H);
        const lab = tn.addComponent(Label);
        lab.fontSize = 20;
        lab.lineHeight = 24;
        lab.color = HUD_TEXT_COLOR;
        lab.horizontalAlign = HorizontalTextAlignment.CENTER;
        lab.verticalAlign = VerticalTextAlignment.CENTER;
        lab.overflow = Label.Overflow.SHRINK;
        lab.string = this.fitTextForLabel(lab, it.text, itemW);
        btn.addChild(tn);
        if (it.badge !== undefined) {
          const badge = new Node('AmmoBadge');
          badge.layer = this.node.layer;
          badge.addComponent(UITransform).setContentSize(24, 24);
          badge.setPosition(itemW / 2 - 9, ITEM_H / 2 - 8, 0);
          const badgeBg = badge.addComponent(Graphics);
          badgeBg.fillColor = new Color(126, 38, 31, 255);
          badgeBg.strokeColor = new Color(244, 224, 170, 255);
          badgeBg.lineWidth = 2;
          badgeBg.circle(0, 0, 11);
          badgeBg.fill();
          badgeBg.stroke();
          const badgeText = new Node('Label');
          badgeText.layer = this.node.layer;
          badgeText.addComponent(UITransform).setContentSize(22, 22);
          const badgeLabel = badgeText.addComponent(Label);
          badgeLabel.fontSize = 15;
          badgeLabel.lineHeight = 18;
          badgeLabel.color = HUD_TEXT_COLOR;
          badgeLabel.horizontalAlign = HorizontalTextAlignment.CENTER;
          badgeLabel.verticalAlign = VerticalTextAlignment.CENTER;
          badgeLabel.string = it.badge;
          badge.addChild(badgeText);
          btn.addChild(badge);
        }
        // 不满足条件的选项保持置灰且不可执行；点击时在按钮上方提示具体原因。
        if (!it.unavailableReason) {
          bindButtonPressScale(btn);
          btn.on(Node.EventType.TOUCH_END, () => {
            playUiClick();
            it.onClick();
          }, this);
        } else {
          bindButtonPressScale(btn);
          // 灰色项不可执行，但仍需吞掉触摸，避免点按穿透到下方的地图格。
          const swallowTouch = (event: EventTouch) => { event.propagationStopped = true; };
          btn.on(Node.EventType.TOUCH_START, swallowTouch, this);
          btn.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
            event.propagationStopped = true;
            playUiClick();
            this.showDieActionUnavailable(it.unavailableReason!, btn);
          }, this);
        }
        panel.addChild(btn);
      }
    }
    this.diePopover = panel;
    this.diePopoverDieIdx = idx;
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
      const action = classifyMoveDie(slot.pip);
      if (action !== 'turn') return;
    } else if (this.playerStep === 'misc') {
      if (classifyMiscDie(slot.pip) !== 'driver_turn_or_drive') return;
    } else {
      return;
    }
    if (this.playerStep === 'misc' && !this.checkCrewAlive('driver')) { this.closeDiePopover(); return; }

    const sherman = this.mission.sherman;
    // §3.5 瘫痪：不可转向 / 前进 / 后退；骰子保留不消耗。
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
    markAmbushAction(sherman);
    // §3.5 隐蔽：任何移动动作（转向 / 前进 / 后退）都会脱离隐蔽
    this.breakConcealment(sherman);
    this.usePhaseDice([dieIdx]);
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
      if (act !== 'drive' && act !== 'reverse') return;
      const nativeDirection = act === 'drive' ? +1 : -1;
      if (dirSign !== nativeDirection && !this.campaignMovementDiceCanReverseDirection()) return;
    } else if (this.playerStep === 'misc') {
      // 杂项阶段 driver_turn_or_drive (die=3) 只允许前进 1 格
      if (classifyMiscDie(slot.pip) !== 'driver_turn_or_drive') return;
      if (dirSign !== +1) return;
    } else {
      return;
    }
    if (this.playerStep === 'misc' && !this.checkCrewAlive('driver')) { this.closeDiePopover(); return; }

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
    if (!GameSession.isPvp && isPlayerTankEvacDrive(this.mission, sherman.pos, sherman.facing as Direction, dirSign, to, {
      canExitTo: (target) => this.isCampaignNextSegmentEntry(target),
    })) {
      markAmbushAction(sherman);
      this.usePhaseDice([dieIdx]);
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
    if (!tile || !this.canMoveToBattleTile(to) || !map.canTankCrossEdge(sherman.pos, to, {
      ignoreBreakwater: canCrossBreakwater,
      faction: sherman.faction,
    })) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.blockedTerrain'),
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    const blocker = this.findMoveBlocker(sherman, to);
    if (blocker) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.enemyBlock'),
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }

    this.usePhaseDice([dieIdx]);
    this.closeDiePopover();
    markAmbushAction(sherman);
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

  // ---------- 攻击阶段动作 ----------

  /**
   * 装填主炮：消耗一颗装填骰；若已装填则拒绝（浪费骰）。
   *
   * 攻击阶段：骰面 = 'reload' (die=1/2) 时合法。
   * 杂项阶段：骰面 = 'gunner_gun_or_reload' (die=1) 时合法（由 popover 路由）。
   */
  private tryReload(dieIdx: number, shellType?: ShellType) {
    if (!this.mission) return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used) return;
    if (this.playerStep === 'attack') {
      const action = classifyAttackDie(slot.pip);
      if (action !== 'reload' && !(action === 'gun' && this.campaignReadyRackCanReloadShootingDice())) return;
    } else if (this.playerStep === 'misc') {
      if (classifyMiscDie(slot.pip) !== 'gunner_gun_or_reload') return;
    } else {
      return;
    }
    if (this.playerStep === 'misc' && !this.checkCrewAlive('loader')) { this.closeDiePopover(); return; }
    const sherman = this.mission.sherman;
    const hardcore = GameSession.gameMode === 'hardcore';
    const requestedShell = hardcore ? (shellType ?? 'ap') : undefined;
    const currentShell = resolvedLoadedShell(sherman);
    if ((!hardcore && sherman.loaded) || (hardcore && currentShell === requestedShell)) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('hud.loaded'),
        new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    if (requestedShell === 'hvap'
      && (!this.campaignUpgradeActive('hvap') || (sherman.hvapAmmoRemaining ?? 0) <= 0)) {
      this.closeDiePopover();
      return;
    }
    if (requestedShell) {
      if (!loadCampaignShell(sherman, requestedShell)) return;
    } else {
      sherman.loaded = true;
      sherman.loadedShell = null;
    }
    this.usePhaseDice([dieIdx]);
    playCannonReload();
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.battleLogI18n('battleLog.attack.reload');
    this.completePhaseDiceAction();
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
    if (this.playerStep === 'misc' && !this.checkCrewAlive('gunner')) { this.closeDiePopover(); return; }
    // 再次点同一颗 → 取消选择
    if (this.selectedGunDieIdx === dieIdx) {
      this.clearGunSelection();
    } else {
      this.selectedGunDieIdx = dieIdx;
      // 普通单骰主炮选择：不连带对子 partner
      this.selectedGunDoublesIdx = -1;
      this.selectedGunHitThresholdModifier = 0;
      // 主炮与机枪选中互斥
      this.selectedMGDieIdx = -1;
      this.turretTargetOverlaySuppressed = false;
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
    this.selectedGunHitThresholdModifier = 0;
    this.selectedMGDieIdx = -1;
    this.turretTargetOverlaySuppressed = false;
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

  /** Hardcore precision fire consumes two matching gun dice and applies -2 to hit threshold. */
  private selectPrecisionGunDie(dieIdx: number) {
    if (!this.mission || !getGameModeConfig(GameSession.gameMode).precisionFire) return;
    if (this.playerStep !== 'attack') return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used || classifyAttackDie(slot.pip) !== 'gun') return;
    if (!isMainGunLoaded(this.mission.sherman, GameSession.gameMode === 'hardcore')) {
      const s = this.mission.sherman;
      this.clearGunSelection();
      this.closeDiePopover();
      this.spawnFloater(s.pos.q, s.pos.r, t('hud.unloaded'),
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.refreshPhaseUI();
      this.updateHUD();
      this.redraw();
      return;
    }
    const partnerIdx = this.findDoublesPartner(dieIdx);
    const partner = partnerIdx >= 0 ? this.phaseDice[partnerIdx] : null;
    if (!partner || partner.used || classifyAttackDie(partner.pip) !== 'gun') {
      const s = this.mission.sherman;
      this.spawnFloater(s.pos.q, s.pos.r, t('floater.needPair'),
        new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    if (!this.checkCrewAlive('gunner')) return;
    this.selectedGunDieIdx = dieIdx;
    this.selectedGunDoublesIdx = partnerIdx;
    this.selectedGunHitThresholdModifier = -2;
    this.selectedMGDieIdx = -1;
    this.turretTargetOverlaySuppressed = false;
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.battleLogI18n('battleLog.attack.precisionReady', { pip: slot.pip });
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
    this.selectedGunHitThresholdModifier = 0;
    this.selectedMGDieIdx = -1;
    this.turretTargetOverlaySuppressed = false;
  }

  private hideTurretTargetOverlayForCommittedAction() {
    this.turretTargetOverlaySuppressed = true;
    this.redrawTurretAimOverlay();
  }

  /**
   * 选中一颗机枪骰进入"选步兵 / 迷雾空地转炮塔"态；之后点合法步兵格触发扫射，
   * 或在硬核迷雾中点空地，消耗此骰并仅旋转炮塔获得新视野。
   *
   * 合法骰面：
   *   - 攻击阶段：pip ∈ {3, 4}（classifyAttackDie == 'mg'）
   *   - 杂项阶段：pip == 4（classifyMiscDie == 'codriver_mg'，副驾驶机枪）
   *
   * 乘员约束：攻击阶段与杂项阶段的机枪骰均不因副驾驶阵亡而禁用；
   * 硬核模式下副驾驶阵亡只会令航向机枪不可用，仍可使用同轴机枪。
   */
  private selectMGDie(dieIdx: number) {
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used) return;
    if (this.playerStep === 'attack') {
      if (classifyAttackDie(slot.pip) !== 'mg') return;
    } else if (this.playerStep === 'misc') {
      if (classifyMiscDie(slot.pip) !== 'codriver_mg') return;
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
        loader: 'crew.role.3',
        gunner: 'crew.role.2',
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
  private tryRepair(dieIdx: number, target: RepairableComponentId) {
    if (!this.mission) return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used || this.playerStep !== 'misc') return;
    const m = classifyMiscDie(slot.pip);
    if (m !== 'repair' && m !== 'smoke_or_repair') return;

    const sherman = this.mission.sherman;
    const component = repairableComponentById(target);
    if (!component.playerAvailable(GameSession.gameMode) || !component.isDamaged(sherman)) return;
    component.repair(sherman);
    this.spawnFloater(sherman.pos.q, sherman.pos.r, t(component.floaterKey),
      new Color(180, 240, 160, 255), { size: 22, dur: 0.9, rise: 24 });
    this.battleLogI18n(component.battleLogKey);
    this.usePhaseDice([dieIdx]);
    this.closeDiePopover();
    this.sendPvpActionResult('repair', {
      type: 'repair',
      unitId: sherman.id,
      repairTarget: target,
      q: sherman.pos.q,
      r: sherman.pos.r,
    });
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.refreshStatusPanel();
    this.completePhaseDiceAction();
  }

  /** 灭火：消耗对应骰并令 fireLevel -1；无火时只提示且不消耗骰子。 */
  private tryFireSuppress(dieIdx: number) {
    if (!this.mission) return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used || this.playerStep !== 'misc') return;
    const miscAction = classifyMiscDie(slot.pip);
    const extinguisherRepairDie = this.campaignUpgradeActive('automatic_extinguisher')
      && (miscAction === 'repair' || miscAction === 'smoke_or_repair');
    if (miscAction !== 'fire_suppress' && !extinguisherRepairDie) return;

    const sherman = this.mission.sherman;
    const lvl = sherman.fireLevel ?? 0;
    if (lvl <= 0) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.noFire'),
        new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    sherman.fireLevel = lvl - 1;
    this.usePhaseDice([dieIdx]);
    this.closeDiePopover();
    this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.fireReduced'),
      new Color(180, 240, 160, 255), { size: 22, dur: 0.9, rise: 24 });
    this.battleLogI18n('battleLog.misc.fireSuppress', { from: lvl, to: sherman.fireLevel ?? 0 });
    this.sendPvpActionResult('fire_suppress', {
      type: 'fire_suppress',
      unitId: sherman.id,
      from: lvl,
      to: sherman.fireLevel ?? 0,
      q: sherman.pos.q,
      r: sherman.pos.r,
    });
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.refreshStatusPanel();
    this.completePhaseDiceAction();
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
  private tryMGAttack(
    target: Unit,
    turretAlreadyAimed = false,
    selectedMachineGun?: TankMachineGunSelection,
  ) {
    if (!this.mission) return;
    if (this.playerStep !== 'attack' && this.playerStep !== 'misc') return;
    if (this.selectedMGDieIdx < 0) return;
    const { map, sherman } = this.mission;
    const units = this.allUnits();
    const slot = this.phaseDice[this.selectedMGDieIdx];
    if (!slot || slot.used) return;

    const machineGun = selectedMachineGun ?? this.tankMachineGunSelection(sherman, target) ?? undefined;

    const check = canMGAttack({ attacker: sherman, target, map, theater: this.mission.data.theater, units, smokeHexes: this.mission.smokeHexes, expandedTurretDirections: getGameModeConfig(GameSession.gameMode).expandedTurretDirections, atGunCrewTargets: GameSession.gameMode === 'hardcore', ...this.tankMachineGunContext(sherman, target, machineGun) });
    if (!check.ok) {
      this.battleLogI18n('battleLog.combat.cannotAttack', {
        reasonKey: check.reason ?? 'attack.reason.unknown',
      });
      const msg = t(check.reason ?? 'attack.reason.unknown');
      this.spawnFloater(sherman.pos.q, sherman.pos.r, msg,
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      return;
    }
    if (GameSession.gameMode !== 'hardcore' && !turretAlreadyAimed
      && !this.canTurretReachDirection(sherman, this.turretTargetDirection(sherman, target))) {
      this.showGunAimWarning('attack.reason.turretTraverseSpeed');
      return;
    }
    if (!turretAlreadyAimed) this.hideTurretTargetOverlayForCommittedAction();

    if (!turretAlreadyAimed) {
      if (GameSession.gameMode === 'hardcore') {
        if (machineGun?.rotateTurret) {
          this.startShermanMachineGunAim(target, machineGun, () => this.tryMGAttack(target, true, machineGun));
        } else {
          this.tryMGAttack(target, true, machineGun);
        }
      } else {
        this.startShermanTurretAim(target, () => this.tryMGAttack(target, true));
      }
      this.updateHUD();
      this.redraw();
      return;
    }

    const ctx = { attacker: sherman, target, map, theater: this.mission.data.theater, units, smokeHexes: this.mission.smokeHexes, weather: this.currentWeather(), atGunCrewTargets: GameSession.gameMode === 'hardcore', ...this.tankMachineGunContext(sherman, target, machineGun) };
    markAmbushAction(sherman);
    markAmbushTargeted(target);
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
          hitBreakdown: mgHitBreakdown(ctx),
          hitModifiers: mgHitThresholdModifierDetails(ctx),
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
      this.playMachineGunFireCue(sherman, target, false);
      this.usePhaseDice([this.selectedMGDieIdx]);
      this.selectedMGDieIdx = -1;
      this.spawnFloater(target.pos.q, target.pos.r, t('dice.panel.outcomeMiss'),
        new Color(220, 220, 220, 255), { size: 32, dur: 0.9, rise: 44 });
      this.sendPvpActionResult('machine_gun', {
        type: 'machine_gun',
        attackerId: sherman.id,
        targetId: target.id,
        report,
        hit: false,
      });
      this.refreshPhaseUI();
      this.updateHUD();
      this.redraw();
      this.refreshStatusPanel();
      this.completePhaseDiceAction();
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
      hitBreakdown: report.hitBreakdown,
      hitModifiers: report.hitModifiers,
      statusChange: report.hit ? 'destroyed' : 'none',
    };

    const capturedDieIdx = this.selectedMGDieIdx;
    let attackApplied = false;
    const applyAndSyncMGAttack = (completeAction: boolean) => {
      if (!this.mission) return;
      if (!attackApplied) {
        attackApplied = true;
        this.applyMachineGunAttackResult(target, report);
        if (target.destroyed) this.registerImpactDestroyWreckVisual(target, sherman);
        this.usePhaseDice([capturedDieIdx]);
        this.selectedMGDieIdx = -1;
        // Reveal the target state together with the settled dice; confirmation
        // only closes the report and advances the phase.
        if (report.hit) {
          this.spawnFloater(target.pos.q, target.pos.r, t('floater.mgHit'),
            new Color(255, 120, 120, 255), { size: 32, dur: 1.0, rise: 48 });
        } else {
          this.spawnFloater(target.pos.q, target.pos.r, t('dice.panel.outcomeMiss'),
            new Color(220, 220, 220, 255), { size: 32, dur: 0.9, rise: 44 });
        }
        this.outcome = this.computeOutcome();
        if (this.outcome !== 'ongoing') this.updateOutcomeOverlay();
        this.sendPvpActionResult('machine_gun', {
          type: 'machine_gun',
          attackerId: sherman.id,
          targetId: target.id,
          report,
          hit: report.hit,
        });
        this.refreshPhaseUI();
        this.updateHUD();
        this.redraw();
        this.refreshStatusPanel();
      }
      if (completeAction) this.completePhaseDiceAction();
    };
    this.startDiceShow(
      panelReport,
      t('actor.player'),
      unitDisplayName(target.kind),
      () => {
        applyAndSyncMGAttack(true);
      },
      // Player MG attacks use the same explicit settlement step as main-gun
      // attacks. Confirm may be pressed immediately to skip the remaining roll.
      {
        mg: true,
        attacker: sherman,
        target,
        requireManualClose: true,
        onHold: () => applyAndSyncMGAttack(false),
      },
    );
    // 立即刷一次 HUD，让 "点步兵扫射" 提示消失，避免玩家以为还能再点
    this.updateHUD();
    this.redraw();
  }

  /**
   * 烟雾（杂项 3 点初始可用；烟幕发射器强化后也可由 2、4 点使用）：
   * 消耗该骰；在谢尔曼当前格放置烟雾 —— 下一次攻击该格内单位的命中检定 +1。
   * 烟雾在下一次"阶段①（玩家回合开始时）"自动消散。
   */
  private trySmoke(dieIdx: number) {
    if (!this.mission) return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used || this.playerStep !== 'misc') return;
    if (!this.miscDieCanDeploySmoke(slot.pip)) return;
    const s = this.mission.sherman;
    if (tileForbidsSmokeOrConcealment(this.mission.map.get(s.pos))) {
      this.closeDiePopover();
      this.spawnFloater(s.pos.q, s.pos.r, t('floater.beachNoSmoke'),
        new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      return;
    }
    if (this.hasSmokeAt(s.pos)) {
      this.showDieActionUnavailable(t('floater.alreadySmoked'));
      return;
    }
    this.deploySmokeAt(s.pos, 'friendly', true);
    this.usePhaseDice([dieIdx]);
    this.closeDiePopover();
    this.spawnFloater(s.pos.q, s.pos.r, t('floater.smokeDeployed'),
      new Color(200, 200, 220, 255), { size: 22, dur: 0.9, rise: 24 });
    this.battleLogI18n('battleLog.misc.smoke');
    this.sendPvpActionResult('smoke', {
      type: 'smoke',
      unitId: s.id,
      q: s.pos.q,
      r: s.pos.r,
    });
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.refreshStatusPanel();
    this.completePhaseDiceAction();
  }

  /**
   * 隐蔽（§3.6 对子 C 列 concealment）：
   * 坦克未瘫痪时需要一对同点骰；消耗两颗，置 sherman.hidden=true（被攻击命中阈值 +2）。
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
    if (s.paralyzed) {
      this.showDieActionUnavailable(t('floater.paralyzedNoConceal'));
      return;
    }
    if (tileForbidsSmokeOrConcealment(this.mission.map.get(s.pos))) {
      this.closeDiePopover();
      this.spawnFloater(s.pos.q, s.pos.r, t('floater.beachNoConceal'),
        new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      return;
    }
    if (s.hidden) {
      this.showDieActionUnavailable(t('floater.alreadyConcealed'));
      return;
    }
    if (partnerIdx < 0) {
      this.spawnFloater(s.pos.q, s.pos.r, t('floater.needPair'),
        new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    this.usePhaseDice([dieIdx, partnerIdx]);
    s.hidden = true;
    this.closeDiePopover();
    this.spawnFloater(s.pos.q, s.pos.r, t('floater.concealed'),
      new Color(160, 220, 180, 255), { size: 22, dur: 0.9, rise: 24 });
    this.battleLogI18n('battleLog.misc.conceal', { dieIdx, partnerIdx, pip: slot.pip });
    this.sendPvpActionResult('conceal', {
      type: 'conceal',
      unitId: s.id,
      q: s.pos.q,
      r: s.pos.r,
    });
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.refreshStatusPanel();
    this.completePhaseDiceAction();
  }

  /** Hardcore misc pair action: consume two matching dice to close an open commander hatch. */
  private tryCloseHatchWithDoubles(dieIdx: number) {
    if (!this.mission || this.playerStep !== 'misc') return;
    if (!getGameModeConfig(GameSession.gameMode).miscCloseHatchWithDoubles) return;
    const s = this.mission.sherman;
    if (!this.checkCrewAlive('commander')) {
      this.closeDiePopover();
      return;
    }
    if (!s.hatchOpen) {
      this.showDieActionUnavailable(t('floater.hatchAlreadyClosed'));
      return;
    }
    if (!this.consumeDoubles(dieIdx)) return;
    s.hatchOpen = false;
    playCommanderHatch(false);
    this.fogVisionTransition = null;
    this.closeDiePopover();
    this.battleLogI18n('battleLog.hatch', { stateKey: 'status.val.hatchClosed' });
    this.spawnFloater(s.pos.q, s.pos.r, t('floater.hatchClosedByDice'),
      new Color(200, 220, 240, 255), { size: 22, dur: 0.9, rise: 24 });
    this.sendPvpActionResult('hatch_close', {
      type: 'hatch_close',
      unitId: s.id,
      q: s.pos.q,
      r: s.pos.r,
    });
    this.refreshStatusPanel();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.completePhaseDiceAction();
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
    this.usePhaseDice([dieIdx, partnerIdx]);
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
    if (!GameSession.isPvp && isPlayerTankEvacDrive(this.mission, sherman.pos, sherman.facing as Direction, 1, to, {
      canExitTo: (target) => this.isCampaignNextSegmentEntry(target),
    })) {
      if (!this.consumeDoubles(dieIdx)) return;
      markAmbushAction(sherman);
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
    if (!tile || !this.canMoveToBattleTile(to) || !map.canTankCrossEdge(sherman.pos, to, { faction: sherman.faction })) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.blockedTerrain'),
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    const blocker = this.findMoveBlocker(sherman, to);
    if (blocker) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.enemyBlock'),
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }

    // 几何校验通过 → 消耗对子并开始前进动画
    if (!this.consumeDoubles(dieIdx)) return;
    markAmbushAction(sherman);
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
    markAmbushAction(sherman);
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
  private tryDoublesLoaderReload(dieIdx: number, shellType?: ShellType) {
    if (!this.mission) return;
    if (this.playerStep !== 'attack') return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used) return;
    if (!this.checkCrewAlive('loader')) { this.closeDiePopover(); return; }

    const sherman = this.mission.sherman;
    const hardcore = GameSession.gameMode === 'hardcore';
    const requestedShell = hardcore ? (shellType ?? 'ap') : undefined;
    const currentShell = resolvedLoadedShell(sherman);
    if ((!hardcore && sherman.loaded) || (hardcore && currentShell === requestedShell)) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('hud.loaded'),
        new Color(255, 200, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      this.closeDiePopover();
      return;
    }
    if (requestedShell === 'hvap'
      && (!this.campaignUpgradeActive('hvap') || (sherman.hvapAmmoRemaining ?? 0) <= 0)) {
      this.closeDiePopover();
      return;
    }
    if (!this.consumeDoubles(dieIdx)) return;
    if (requestedShell) {
      if (!loadCampaignShell(sherman, requestedShell)) return;
    } else {
      sherman.loaded = true;
      sherman.loadedShell = null;
    }
    playCannonReload();
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.refreshStatusPanel();
    this.battleLogI18n('battleLog.attack.doublesReload');
    this.completePhaseDiceAction();
  }

  // ---------- 智能"下一阶段" ----------

  /**
   * 右下角按钮点击：
   *   - 移动 / 攻击 / 杂项子阶段内 → endCurrentSubPhase（杂项结束会进着火检定）
   *   - 选择阶段且 A+B 已完成、杂项未开始 → 手动进入杂项（与自动进杂项二选一即可）
   */
  private onAdvanceClicked() {
    if (this.isPvpWaitingForRemoteAction()) return;
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
    const sideTargets = this.allUnits().filter(unit => isHostile(actor, unit));
    // Abandoned tanks are capturable battlefield objects, not combatants.
    // Neither side's AI should spend attacks destroying them.
    return sideTargets.filter(u => u !== actor && !isAbandonedTank(u));
  }

  private playerMainGunTargets(): Unit[] {
    if (!this.mission) return [];
    const abandonedTanks = this.allUnits().filter(isAbandonedTank);
    return Array.from(new Set([...this.mission.enemies, ...abandonedTanks]));
  }

  /** One click/preview target per hex; non-infantry takes precedence over infantry. */
  private playerMainGunHexTargets(): Unit[] {
    return selectMainGunTargetsByHex(this.playerMainGunTargets());
  }

  private aiFriendliesFor(actor: Unit): Unit[] {
    if (!this.mission) return [];
    return this.allUnits().filter(u => u !== actor && isSameSide(actor, u));
  }

  private aiMissionTargetsFor(actor: Unit): Unit[] {
    if (!this.mission) return [];
    if (actor.sideId === 'enemy') return [this.mission.sherman];
    const candidates = this.mission.enemies.filter(u => !isAbandonedATGun(u) && !isAttachedATGunCrew(u));
    const objective = this.mission.data.objective;
    if (objective.type === 'destroy_all_enemies' || objective.destroyAllEnemiesBeforeEvac) {
      return candidates;
    }
    if (objective.type === 'destroy_truck') {
      return candidates.filter(u => u.kind === 'truck');
    }
    const kinds = objective.kinds?.length
      ? objective.kinds
      : (objective.kind ? [objective.kind] : []);
    return candidates.filter(u => kinds.includes(u.kind));
  }

  private currentAITarget(actor: Unit): Unit | null {
    if (!this.mission) return null;
    return currentTargetFor(actor, this.aiTargetsFor(actor), this.aiMissionTargetsFor(actor), this.rng);
  }

  /** 转向优先追踪共享视野内敌人，其次上回合敌方最后攻击格，最后才是对方出生格。 */
  private currentAITurnTargetPosition(actor: Unit): Axial {
    if (!this.mission) return { ...actor.pos };
    const { map, smokeHexes, data } = this.mission;
    const weather = this.currentWeather();
    const radioVisionSharing = getGameModeConfig(GameSession.gameMode).radioVisionSharing;
    const visibleHexes = radioVisionSharing
      ? computeRadioSharedVisibleHexes(map, actor, this.aiFriendliesFor(actor), weather, smokeHexes)
      : computeUnitVisibleHexes(map, actor, weather, smokeHexes);
    return visibleAITurnTargetPositionFor(
      actor,
      this.aiTargetsFor(actor),
      this.aiMissionTargetsFor(actor),
      target => visibleHexes.has(HexMap.keyOf(target.pos)),
      this.rng,
      data.rowParityOffset === 1 ? 1 : 0,
      previousEnemyAttackPosition(this.attackPositionMemory, actor),
    );
  }

  private selectAIShootTarget(actor: Unit, randomizeTies: boolean, adjacentOnly = false): Unit | null {
    if (!this.mission) return null;
    const { map } = this.mission;
    const missionTargets = this.aiMissionTargetsFor(actor);
    let bestPriority = Infinity;
    let bestWeaponPriority = Infinity;
    let bestDist = Infinity;
    const tied: Unit[] = [];
    const hardcoreInfantry = this.isHardcoreInfantryActor(actor);
    for (const target of this.aiTargetsFor(actor)) {
      if (isAbandonedATGun(target) || isAttachedATGunCrew(target)) continue;
      if (isAbandonedTank(target)) continue;
      if (isSameSide(target, actor)) continue;
      const d = hexDistance(actor.pos, target.pos);
      const automaticWeapon = GameSession.gameMode === 'hardcore' && isTankUnit(actor)
        ? nonPlayerTankWeaponForTarget(target, d)
        : 'ap';
      const tankSuppression = automaticWeapon === 'he'
        && isMainGunSuppressionAttack(actor, target, true, 'he');
      if (GameSession.gameMode === 'hardcore' && isTankUnit(actor)) {
        if (automaticWeapon === 'mg') continue;
      } else if (!hardcoreInfantry && !tankSuppression && (isFootUnit(target) || target.kind === 'truck')) {
        continue;
      }
      if (!hardcoreInfantry
        && !getGameModeConfig(GameSession.gameMode).radioVisionSharing
        && d > currentVisionRange(actor, this.currentWeather())) continue;
      if (!hardcoreInfantry
        && !isUnitInVision(
          map,
          actor,
          target,
          this.aiFriendliesFor(actor),
          getGameModeConfig(GameSession.gameMode).radioVisionSharing,
          this.currentWeather(),
          this.mission.smokeHexes,
        )) continue;
      const sameHexInfantryTankAttack = GameSession.gameMode === 'hardcore'
        && isFootUnit(actor)
        && isTankUnit(target)
        && d === 0;
      if (adjacentOnly && d !== 1 && !sameHexInfantryTankAttack) continue;
      if (!canAttack({
        attacker: actor,
        target,
        map,
        smokeHexes: this.mission.smokeHexes,
        expandedTurretDirections: getGameModeConfig(GameSession.gameMode).expandedTurretDirections,
        sameHexInfantryTankAttack,
        mainGunSuppressesInfantry: tankSuppression,
        shellType: automaticWeapon === 'he' ? 'he' : 'ap',
      }).ok) continue;
      // A tank prefers AP targets; HE targets are considered when no legal AP target exists.
      const weaponPriority = isTankUnit(actor) && automaticWeapon === 'he' ? 1 : 0;
      const priority = aiTargetPriorityForActor(actor, target, missionTargets);
      if (weaponPriority < bestWeaponPriority
        || (weaponPriority === bestWeaponPriority
          && (priority < bestPriority || (priority === bestPriority && d < bestDist)))) {
        bestWeaponPriority = weaponPriority;
        bestPriority = priority;
        bestDist = d;
        tied.length = 0;
        tied.push(target);
      } else if (weaponPriority === bestWeaponPriority && priority === bestPriority && d === bestDist) {
        tied.push(target);
      }
    }
    if (tied.length === 0) return null;
    if (tied.length === 1 || !randomizeTies) return tied[0];
    return tied[this.rng.intRange(0, tied.length - 1)];
  }

  /** Select an infantry target by the same legality rules as the player MG. */
  private selectAIMGTarget(actor: Unit, randomizeTies: boolean): Unit | null {
    if (!this.mission || !isTankUnit(actor)) return null;
    const { map } = this.mission;
    const units = this.allUnits();
    const missionTargets = this.aiMissionTargetsFor(actor);
    let bestPriority = Infinity;
    let bestDist = Infinity;
    const tied: Unit[] = [];
    for (const target of this.aiTargetsFor(actor)) {
      if (isAbandonedATGun(target) || isAttachedATGunCrew(target)) continue;
      if (isAbandonedTank(target)) continue;
      if (isSameSide(target, actor)) continue;
      if (!getGameModeConfig(GameSession.gameMode).radioVisionSharing && hexDistance(actor.pos, target.pos) > currentVisionRange(actor, this.currentWeather())) continue;
      if (!isUnitInVision(map, actor, target, this.aiFriendliesFor(actor), getGameModeConfig(GameSession.gameMode).radioVisionSharing, this.currentWeather(), this.mission.smokeHexes)) continue;
      const machineGun = this.tankMachineGunSelection(actor, target);
      if (GameSession.gameMode === 'hardcore' && !machineGun) continue;
      if (!canMGAttack({ attacker: actor, target, map, theater: this.mission.data.theater, units, smokeHexes: this.mission.smokeHexes, weather: this.currentWeather(), expandedTurretDirections: getGameModeConfig(GameSession.gameMode).expandedTurretDirections, atGunCrewTargets: GameSession.gameMode === 'hardcore', ...this.tankMachineGunContext(actor, target, machineGun) }).ok) continue;
      const priority = aiTargetPriorityForActor(actor, target, missionTargets);
      const d = hexDistance(actor.pos, target.pos);
      if (priority < bestPriority || (priority === bestPriority && d < bestDist)) {
        bestPriority = priority;
        bestDist = d;
        tied.length = 0;
        tied.push(target);
      } else if (priority === bestPriority && d === bestDist) {
        tied.push(target);
      }
    }
    if (tied.length === 0) return null;
    if (tied.length === 1 || !randomizeTies) return tied[0];
    return tied[this.rng.intRange(0, tied.length - 1)];
  }

  private canAIExecuteShoot(actor: Unit): boolean {
    if (isTankUnit(actor) && this.selectAIMGTarget(actor, false)) return true;
    const mainGunTarget = this.selectAIShootTarget(actor, false);
    if (mainGunTarget && this.canAIMainGunResolveSelectedTarget(actor, mainGunTarget)) return true;
    return getGameModeConfig(GameSession.gameMode).aiMainGunFallbackToMG
      && !!this.selectAIMGTarget(actor, false);
  }

  private canAIMainGunResolveSelectedTarget(actor: Unit, target: Unit): boolean {
    if (!this.mission) return false;
    if (this.isHardcoreInfantryActor(actor)) return true;
    const radioVisionSharing = getGameModeConfig(GameSession.gameMode).radioVisionSharing;
    return isUnitInVision(
      this.mission.map,
      actor,
      target,
      this.aiFriendliesFor(actor),
      radioVisionSharing,
      this.currentWeather(),
      this.mission.smokeHexes,
    );
  }

  private beginAllyPhase() {
    if (!this.mission) return;
    const aiCandidates = this.mission.allies.filter(unit =>
      isAIActorUnit(unit, GameSession.gameMode === 'hardcore'));
    if (aiCandidates.length === 0) {
      this.beginEnemyPhase();
      return;
    }
    this.beginAllyPhaseAfterTransition();
  }

  /** 玩家行动结束后的独立着火检定阶段；完成后才进入友方/敌方行动。 */
  private beginFireCheckPhase() {
    if (!this.mission) return;
    this.phase = 'fireCheck';
    this.playerStep = 'choose';
    this.phaseDice = [];
    this.clearGunSelection();
    this.closeDiePopover();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.startFireCheckFlow(() => this.continueAfterPlayerFireCheck());
  }

  private continueAfterPlayerFireCheck() {
    if (!this.mission) return;
    endAmbushTurn(this.mission.sherman, this.hasSmokeAt(this.mission.sherman.pos));
    this.outcome = this.computeOutcome();
    this.updateOutcomeOverlay();
    if (this.outcome !== 'ongoing') {
      this.refreshPhaseUI();
      this.updateHUD();
      this.redraw();
      return;
    }
    this.beginAllyPhase();
  }

  private beginAllyPhaseAfterTransition() {
    if (!this.mission) return;
    const hardcoreInfantry = GameSession.gameMode === 'hardcore';
    const aiCandidates = this.mission.allies.filter(unit => isAIActorUnit(unit, hardcoreInfantry));
    this.phase = 'ally';
    this.aiSide = 'ally';
    this.outcome = this.computeOutcome();
    this.updateOutcomeOverlay();
    if (this.outcome !== 'ongoing') {
      this.refreshPhaseUI();
      this.updateHUD();
      this.redraw();
      return;
    }
    this.enemyOrder = selectAIOrder(
      aiCandidates,
      this.mission.enemies,
      aiCandidates.length > 0 ? this.aiMissionTargetsFor(aiCandidates[0]) : [],
      this.rng,
      hardcoreInfantry,
    );
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceTypes = [];
    this.enemyDiceUsed = [];
    this.enemyDiceResolvedActions = [];
    this.clearAIMoveState();
    this.clearActiveActingUnit();
    this.destroyEnemyDiceTray();
    this.closeDiePopover();
    if (this.enemyOrder.length === 0) {
      this.beginEnemyPhase();
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
    const hardcoreInfantry = GameSession.gameMode === 'hardcore';
    const aiCandidates = this.mission.enemies.filter(unit => isAIActorUnit(unit, hardcoreInfantry));
    this.enemyOrder = selectAIOrder(
      aiCandidates,
      [this.mission.sherman, ...this.mission.allies],
      [this.mission.sherman],
      this.rng,
      hardcoreInfantry,
    );
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceTypes = [];
    this.enemyDiceUsed = [];
    this.enemyDiceResolvedActions = [];
    this.clearAIMoveState();
    this.clearActiveActingUnit();
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
    this.enemyDiceTypes = [];
    this.enemyDiceUsed = [];
    this.enemyDiceResolvedActions = [];
    this.clearAIMoveState();
    this.clearActiveActingUnit();
    this.destroyEnemyDiceTray();
    this.playerStep = 'choose';
    this.movementDone = false;
    this.attackDone = false;
    this.miscDone = false;
    this.hatchChangedThisTurn = false;
    this.playerDiceRollAnim = null;
    this.playerDiceSortAnim = null;
    this.pendingAutoEndStep = null;
    this.phaseDice = [];
    this.clearGunSelection();
    if (this.mission) {
      beginAmbushTurn(this.mission.sherman, GameSession.gameMode);
      this.consumeLegacyUnitSmoke();
      for (const pos of this.clearSmokeByOwner('friendly', true)) {
        this.spawnFloater(pos.q, pos.r, t('floater.smokeCleared'),
          new Color(200, 200, 220, 255), { size: 20, dur: 0.8, rise: 22 });
        this.battleLog(`[Phase 1] smoke cleared at (${pos.q},${pos.r})`);
      }
      this.outcome = this.computeOutcome();
      this.updateOutcomeOverlay();
    }
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
    this.ensurePvpLocalTurnTimer();
    this.battleLogI18n('battleLog.playerTurnStart', { turn: this.turn });
  }

  private beginEnemyPhase() {
    if (!this.mission) return;
    if (GameSession.isPvp) {
      this.submitPvpTurnEnd();
      return;
    }
    // Keep the mission's enemy identity after the last unit is destroyed. Some
    // objectives continue into an evacuation turn, so a live-unit-only lookup
    // must not fall back from Japanese to German during the transition banner.
    const faction = this.mission.enemies.find(unit => !unit.destroyed)?.faction
      ?? this.mission.enemies[0]?.faction
      ?? (this.mission.data.theater === 'pacific' ? 'japanese' : 'german');
    this.showTurnTransition(faction, 'enemy', () => this.beginEnemyPhaseAfterTransition());
  }

  private beginEnemyPhaseAfterTransition() {
    if (!this.mission) return;
    this.phase = 'enemy';
    this.aiSide = 'german';
    // §2.1 阶段④：移除德军烟雾（烟雾只保留一回合）
    this.consumeLegacyUnitSmoke();
    for (const pos of this.clearSmokeByOwner('enemy', true)) {
      this.spawnFloater(pos.q, pos.r, t('floater.smokeCleared'),
        new Color(200, 200, 220, 255), { size: 20, dur: 0.8, rise: 22 });
      this.battleLog(`[Phase④] smoke cleared at (${pos.q},${pos.r})`);
    }
    this.continueEnemyPhase();
  }

  /** 敌方转场之后：胜负判定 → 建敌方顺序 → 首辆敌坦回合 */
  private continueEnemyPhase() {
    if (!this.mission) return;
    this.outcome = this.computeOutcome();
    this.updateOutcomeOverlay();
    if (this.outcome !== 'ongoing') {
      this.closeDiePopover();
      this.refreshPhaseUI();
      this.updateHUD();
      this.redraw();
      return;
    }
    // 硬核模式步兵使用无骰攻击/移动 AI；军官仍不行动。卡车只由回合结束事件移动。
    const hardcoreInfantry = GameSession.gameMode === 'hardcore';
    const aiCandidates = this.mission.enemies.filter(unit => isAIActorUnit(unit, hardcoreInfantry));
    this.enemyOrder = selectAIOrder(
      aiCandidates,
      [this.mission.sherman, ...this.mission.allies],
      [this.mission.sherman],
      this.rng,
      hardcoreInfantry,
    );
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceTypes = [];
    this.enemyDiceUsed = [];
    this.enemyDiceResolvedActions = [];
    this.clearAIMoveState();
    this.clearActiveActingUnit();
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
  private startFireCheckFlow(onComplete: () => void) {
    if (!this.mission) return;
    const s = this.mission.sherman;
    const nSnap = s.fireLevel ?? 0;
    if (nSnap <= 0 || s.destroyed || isAbandonedTank(s)) {
      onComplete();
      return;
    }
    this.battleLog(`[Phase⑤] 着火检定 ×${nSnap}（面板）`);
    this.spawnFloater(s.pos.q, s.pos.r, t('floater.fireCheck'),
      new Color(255, 180, 80, 255), { size: 22, dur: 1.0, rise: 28 });
    const prep = this.prepareFireCheckSteps(nSnap);
    if (prep.steps.length === 0 || prep.allDice.length === 0) {
      onComplete();
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
      confirmButton: refs.confirmButton,
      introKey,
      introParams,
      bodyText,
      ruleModalRoot: null,
      onComplete,
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
    if (prep.allDice.length > 0) playDiceRoll();
  }

  /**
   * 预掷本批次全部着火检定骰，用于 UI 展示；只取最低点按当前模式 / 战场的着火检定表结算一次。
   * 阵亡检定二次骰复用 Combat.resolveCrewCheck，保持已死乘员重掷等细节一致。
   */
  private prepareFireCheckSteps(nSnap: number): {
    steps: FireCheckPreparedStep[];
    pendingFire: number;
    allDice: number[];
  } {
    const steps: FireCheckPreparedStep[] = [];
    const allDice: number[] = [];
    const profile = fireCheckProfileFor(GameSession.gameMode, this.mission!.data.theater);

    for (let i = 0; i < nSnap; i++) {
      allDice.push(this.rng.d6());
    }

    if (allDice.length === 0) {
      return { steps, pendingFire: 0, allDice };
    }

    const { die, effect } = resolveFireCheckLowest(profile, allDice);
    this.battleLog(`[Phase⑤] ${profile} dice=${allDice.join('+')} min=${die} → ${effect}`);

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

  private fireCheckOutcomePhrase(effect: FireCheckEffect): string {
    switch (effect) {
      case 'destroyed': return t('dmg.outcome.destroyed');
      case 'fire': return t('dmg.effect.fire');
      case 'turret': return t('dmg.outcome.turret');
      case 'paralyzed': return t('dmg.outcome.paralyzed');
      case 'crewCheck': return t('dmg.outcome.crewCheck');
      case 'none': return t('dmg.outcome.none');
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
    effect: FireCheckEffect,
    onFire: () => void,
    preCrew?: { crewDie: number; crewSlot: number | null },
  ) {
    const pos = s.pos;
    const color = new Color(255, 180, 80, 255);
    switch (effect) {
      case 'destroyed':
        s.destroyed = true;
        this.registerAmmoExplosionWreckVisual(s);
        this.spawnFloater(pos.q, pos.r, t('dmg.outcome.destroyed'),
          new Color(255, 100, 100, 255), { size: 26, dur: 1.2, rise: 32 });
        break;
      case 'fire':
        onFire();
        this.spawnFloater(pos.q, pos.r, t('dmg.effect.fire'), color,
          { size: 22, dur: 0.9, rise: 24 });
        break;
      case 'turret':
        if (s !== this.mission?.playerTank) s.damaged = true;
        s.turretDamaged = true;
        this.spawnFloater(pos.q, pos.r, t('dmg.outcome.turret'), color,
          { size: 22, dur: 0.9, rise: 24 });
        break;
      case 'paralyzed':
        if (s !== this.mission?.playerTank) s.damaged = true;
        s.paralyzed = true;
        this.spawnFloater(pos.q, pos.r, t('dmg.outcome.paralyzed'), color,
          { size: 22, dur: 0.9, rise: 24 });
        break;
      case 'crewCheck': {
        // §3.4 Step 3 d6=2：再掷一次决定哪位乘员阵亡（与受击穿同机制）
        if (s !== this.mission?.playerTank) s.damaged = true;
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
              break;
            case 2: s.crew.gunner = false;    break;
            case 3: s.crew.loader = false;    break;
            case 4: s.crew.driver = false;    break;
            case 5: s.crew.coDriver = false;  break;
          }
          this.spawnFloater(pos.q, pos.r, t('crew.death.kia', { role: t('crew.role.' + slot) }),
            new Color(255, 120, 120, 255), { size: 22, dur: 1.0, rise: 26 });
          this.battleLog(`[Phase⑤] 阵亡检定 d6=${crewDie} → slot=${slot}`);
          neutralizeUncrewedTank(s);
        } else {
          this.spawnFloater(pos.q, pos.r, t('crew.death.falseAlarm'),
            new Color(200, 200, 200, 255), { size: 20, dur: 0.9, rise: 24 });
          this.battleLog(`[Phase⑤] 阵亡检定 d6=${crewDie} → 虚惊`);
        }
        break;
      }
      case 'none':
        this.spawnFloater(pos.q, pos.r, t('dmg.outcome.none'),
          new Color(190, 200, 210, 255), { size: 18, dur: 0.9, rise: 24 });
        break;
    }
  }

  // ---------- 战斗内设置 / 退出确认模态 ----------

  private closeBattleModal() {
    if (this.battleModalRoot && this.battleModalRoot.isValid) this.battleModalRoot.destroy();
    this.battleModalRoot = null;
    this.battleSettingsRefs = null;
  }

  private closeAllBattleModals() {
    this.closeBattleModal();
    this.closeTileInspectModal();
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
    const units = all.filter(u => !u.destroyed && !isAttachedATGunCrew(u) && u.pos.q === pos.q && u.pos.r === pos.r);
    return units.sort((a, b) => {
      const af = isFootUnit(a) ? 1 : 0;
      const bf = isFootUnit(b) ? 1 : 0;
      return af - bf;
    });
  }

  private collectUnitInspectStatusLines(u: Unit): string[] {
    const parts: string[] = [];
    const tankLike = !isFootUnit(u);
    if (u === this.mission?.sherman) {
      if ((u.fireLevel ?? 0) > 0) {
        parts.push(t('tileInspect.status.shermanFire', { n: u.fireLevel ?? 0 }));
      }
      if (u.turretDamaged) parts.push(t('tileInspect.status.turretDamaged'));
      if (u.paralyzed) parts.push(t('tileInspect.status.paralyzed'));
      if (GameSession.gameMode === 'hardcore') {
        const radio = repairableComponentById('radio');
        parts.push(t(radio.isDamaged(u) ? radio.statusDamagedKey : radio.statusIntactKey!));
      }
      if (u.hidden) parts.push(t('tileInspect.status.hidden'));
      if (this.hasSmokeAt(u.pos) || u.smoked) parts.push(t('tileInspect.status.smoked'));
      parts.push(u.loaded ? t('tileInspect.status.loaded') : t('tileInspect.status.unloaded'));
      if (u.hatchOpen) parts.push(t('tileInspect.status.hatchOpen'));
    } else if (tankLike) {
      if (u.damaged) parts.push(t('tileInspect.status.enemyDamaged'));
      if ((u.fireLevel ?? 0) > 0) parts.push(t('tileInspect.status.shermanFire', { n: u.fireLevel ?? 0 }));
      if (u.turretDamaged) parts.push(t('tileInspect.status.turretDamaged'));
      if (u.paralyzed) parts.push(t('tileInspect.status.paralyzed'));
      if (u.radioDamaged) parts.push(t('tileInspect.status.radioDamaged'));
      if (u.hidden) parts.push(t('tileInspect.status.hidden'));
      if (this.hasSmokeAt(u.pos) || u.smoked) parts.push(t('tileInspect.status.smoked'));
    } else {
      if (u.hidden) parts.push(t('tileInspect.status.hidden'));
      if (this.hasSmokeAt(u.pos) || u.smoked) parts.push(t('tileInspect.status.smoked'));
    }
    return parts;
  }

  /** 格子文字（不含最上行地形名——见左上角；不含单位——见下方面板） */
  private buildTileInspectTerrainText(tile: Tile): string {
    const blocks: string[] = [];
    if (tile.hasBuilding) {
      blocks.push(t('tileInspect.building'));
    }
    if (this.hasSmokeAt(tile.pos)) {
      blocks.push(t('tileInspect.status.smoked'));
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
    const hardcoreDicePool = GameSession.gameMode === 'hardcore';
    const pool = hardcoreDicePool ? PLAYER_HARDCORE_DICE_POOL : PLAYER_DICE_POOL;
    const b = pool.baseByPhaseTerrain;
    const eff = effectiveDiceTerrain(tile);
    const mv = b.movement[eff];
    const at = b.attack[eff];
    const ms = b.misc[eff];
    const commanderBonusWithoutHatch = getGameModeConfig(GameSession.gameMode).commanderBonusWithoutOpenHatch;
    if (hardcoreDicePool) {
      if (mv !== 0) blocks.push(t('tileInspect.modifier.mobility', { n: mv > 0 ? `+${mv}` : mv }));
      if (at !== 0) blocks.push(t('tileInspect.modifier.firepower', { n: at > 0 ? `+${at}` : at }));
      if (ms !== 0) blocks.push(t('tileInspect.modifier.misc', { n: ms > 0 ? `+${ms}` : ms }));
    } else {
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
    }

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

  private assignCrewStatusIcon(sprite: Sprite, node: Node, slot: number): void {
    const index = slot - 1;
    const cached = this.crewStatusIconFrames[index];
    if (cached) {
      sprite.spriteFrame = cached;
      return;
    }
    const path = CREW_STATUS_ICON_PATHS[index];
    if (!path) return;
    resources.load(path, SpriteFrame, (err, sf) => {
      if (err || !sf) {
        console.warn(`[BattleScene] crew status icon load failed (slot ${slot}):`, err);
        return;
      }
      this.crewStatusIconFrames[index] = sf;
      if (node.isValid) sprite.spriteFrame = sf;
    });
  }

  private loadCrewStatusRankFrames(): void {
    (['veteran', 'elite'] as const).forEach((level) => {
      if (this.crewStatusRankFrames[level]) return;
      resources.load(CREW_RANK_ICON_PATHS[level], SpriteFrame, (err, sf) => {
        if (err || !sf) {
          console.warn(`[BattleScene] crew rank icon load failed (${level}):`, err);
          return;
        }
        this.crewStatusRankFrames[level] = sf;
        this.refreshStatusPanel();
      });
    });
  }

  /** One diagonal is deliberately used here to match the compact status-panel treatment. */
  private addStatusCrewDeadMarker(iconNode: Node, slot: number, iconSize: number): Node {
    const markerNode = new Node(`CrewDeadMarker${slot}`);
    markerNode.layer = this.node.layer;
    markerNode.addComponent(UITransform).setContentSize(iconSize, iconSize);
    const marker = markerNode.addComponent(Graphics);
    const half = iconSize * 0.48;

    marker.strokeColor = new Color(55, 8, 8, 245);
    marker.lineWidth = 5;
    marker.moveTo(-half, half);
    marker.lineTo(half, -half);
    marker.stroke();

    marker.strokeColor = new Color(245, 48, 48, 255);
    marker.lineWidth = 2.5;
    marker.moveTo(-half, half);
    marker.lineTo(half, -half);
    marker.stroke();
    iconNode.addChild(markerNode);
    return markerNode;
  }

  private tileInspectCrewSlotAlive(u: Unit, slot: number): boolean {
    const crew = u.crew;
    if (!crew) return true;
    switch (slot) {
      case 1: return crew.commander;
      case 2: return crew.gunner;
      case 3: return crew.loader;
      case 4: return crew.driver;
      case 5: return crew.coDriver;
      default: return true;
    }
  }

  /** Keep the KIA marker readable even on dense crew pictograms such as the gunner sight. */
  private addTileInspectCrewDeadMarker(iconNode: Node, slot: number, iconSize: number): void {
    const markerNode = new Node(`TileInspectCrewDeadMarker${slot}`);
    markerNode.layer = this.node.layer;
    markerNode.addComponent(UITransform).setContentSize(iconSize, iconSize);
    markerNode.setPosition(0, 0, 0);
    const marker = markerNode.addComponent(Graphics);
    const half = iconSize * 0.38;

    // A dark under-stroke separates the red X from the white lines in the icon.
    marker.strokeColor = new Color(55, 8, 8, 245);
    marker.lineWidth = 6;
    marker.moveTo(-half, half);
    marker.lineTo(half, -half);
    marker.moveTo(-half, -half);
    marker.lineTo(half, half);
    marker.stroke();

    marker.strokeColor = new Color(245, 54, 54, 255);
    marker.lineWidth = 3;
    marker.moveTo(-half, half);
    marker.lineTo(half, -half);
    marker.moveTo(-half, -half);
    marker.lineTo(half, half);
    marker.stroke();
    iconNode.addChild(markerNode);
  }

  private addTileInspectCrewRow(
    parent: Node, u: Unit, leftX: number, topY: number,
  ): number {
    const slots = u.stats.crewMembers;
    if (slots.length === 0) return 0;

    const iconSize = 24;
    const iconGap = 8;
    const rowH = 26;
    const startX = leftX;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const iconNode = new Node(`TileInspectCrewIcon${slot}`);
      iconNode.layer = this.node.layer;
      iconNode.addComponent(UITransform).setContentSize(iconSize, iconSize);
      iconNode.setPosition(startX + iconSize * 0.5 + i * (iconSize + iconGap), topY - rowH * 0.5, 0);
      const icon = iconNode.addComponent(Sprite);
      icon.sizeMode = Sprite.SizeMode.CUSTOM;
      parent.addChild(iconNode);
      this.assignCrewStatusIcon(icon, iconNode, slot);

      if (!this.tileInspectCrewSlotAlive(u, slot)) {
        icon.color = new Color(130, 130, 130, 210);
        this.addTileInspectCrewDeadMarker(iconNode, slot, iconSize);
      }
    }
    return rowH;
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
    if (!this.isHexVisible(tile.pos)) {
      const { h } = this.makeTileScrollText(content, x0, y, textW, t('tileInspect.unitUnknown'), 16);
      mark(y, h);
      return { totalH: -low + 16, lowest: low };
    }
    const units = this.unitsOnTileAxial(tile.pos);
    if (units.length === 0) {
      const { h } = this.makeTileScrollText(content, x0, y, textW, t('tileInspect.noUnit'), 16);
      mark(y, h);
      return { totalH: -low + 16, lowest: low };
    }
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const showEffectiveRange = getGameModeConfig(GameSession.gameMode).effectiveRangePenetration;
      const showGunMantletArmor = getGameModeConfig(GameSession.gameMode).gunMantletArmor && isTankUnit(u);
      const unitTopY = y;
      this.addTileInspectUnitPreview(content, u, imageCX, unitTopY, 34);
      const title = t('tileInspect.currentUnit', { name: t(`unit.name.${u.kind}`) });
      const { h } = this.makeTileScrollText(content, x0, y, textW, title, 17);
      y = y - h - 8;

      const crewRowH = this.addTileInspectCrewRow(content, u, x0, y);
      if (crewRowH > 0) y = y - crewRowH - 8;

      if (isFootUnit(u)) {
        if (showEffectiveRange) {
          const { h: rangeH } = this.makeTileScrollText(
            content, x0, y, textW, t('tileInspect.effectiveRange', { n: u.stats.effectiveRange }), 15,
          );
          y = y - rangeH - gapL;
        }
      } else {
        const st = u.stats;
        const cols = 5 + (showGunMantletArmor ? 1 : 0) + (showEffectiveRange ? 1 : 0);
        const gap = 4;
        const colW = (textW - (cols - 1) * gap) / cols;
        const heads = [t('tileInspect.colFront'), t('tileInspect.colFrontSide'), t('tileInspect.colRearSide'),
          t('tileInspect.colRear'), t('tileInspect.colPen')];
        const values = [st.armorFront, st.armorFrontSide, st.armorRearSide, st.armorRear, st.penetration];
        if (showGunMantletArmor) {
          heads.push(t('tileInspect.colGunMantlet'));
          values.push(st.gunMantletArmor ?? 0);
        }
        if (showEffectiveRange) {
          heads.push(t('tileInspect.colEffectiveRange'));
          values.push(st.effectiveRange);
        }
        const th = this.makeTileScrollSmallCaptions(content, x0, y, colW, heads, 12, gap).h;
        y = y - th - 6;
        const { h: vh } = this.makeTileScrollValueRow(content, x0, y, colW, values, 17, gap);
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
    const hasTerrainSprite = !!this.terrainSpriteFrameFor(tile.terrain);
    if (!hasTerrainSprite) {
      this.drawHexFill(cx, cy, hexR, tile.terrain === 'airstrip' ? TERRAIN_COLORS.clear : this.terrainColorFor(tile.terrain));
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
    const frames = this.activeTreeSpriteFrames().filter((sf): sf is SpriteFrame => !!sf);
    if (frames.length === 0) return;
    const seedRaw =
      ((tile.pos.q | 0) * 92811 + (tile.pos.r | 0) * 6899 + 0x4f2a91) >>> 0;
    const rng = new RNG(seedRaw === 0 ? 1 : seedRaw);
    for (let i = 0; i < FOREST_CANOPY_LAYOUT.length; i++) {
      const p = FOREST_CANOPY_LAYOUT[i];
      const x = cx + (p.ox + (rng.next() - 0.5) * 0.05) * size;
      const y = cy + (p.oy + (rng.next() - 0.5) * 0.05) * size;
      const scale = p.scale * (0.92 + rng.next() * 0.18);
      this.addTileInspectTreeSprite(parent, x, y, size, seedRaw + i * 101, scale);
    }
  }

  private addTileInspectTreeSprite(parent: Node, cx: number, cy: number, hexSize: number, seed: number, scale: number) {
    const frames = this.activeTreeSpriteFrames().filter((sf): sf is SpriteFrame => !!sf);
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
    const frames = this.activeTreeSpriteFrames().filter((sf): sf is SpriteFrame => !!sf);
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
    const sf = this.terrainSpriteFrameFor(tile.terrain);
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

    const baseTerrainName = this.usesWinterTerrainVisuals() && ['road', 'field', 'mud', 'forest', 'water'].includes(tile.terrain)
      ? t(`terrain.${tile.terrain}_snow`)
      : t(`terrain.${tile.terrain}`);
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
      const visualAngle = this.infantryVisualAngle(u);
      if (u.kind === 'officer' && this.officerSpriteFrame) {
        this.addTileInspectSprite(
          parent,
          this.officerSpriteFrame,
          this.officerSpriteDim.dw,
          this.officerSpriteDim.dh,
          hexR * 1.06,
          0,
          0,
          visualAngle,
        );
        this.g = oldG;
        return;
      }
      const infantryVisuals = this.infantryVisualsFor(u);
      const allLoaded = infantryVisuals.frames.every((sf) => !!sf);
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
        const sf = infantryVisuals.frames[i];
        if (!sf) continue;
        const dim = infantryVisuals.dims[i];
        const fit = spriteFit * infantryVisuals.scales[i];
        this.addTileInspectSprite(
          parent,
          sf,
          dim.dw,
          dim.dh,
          fit,
          offsets[i].ox,
          offsets[i].oy,
          visualAngle,
        );
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
    if (isEnemyTopKind(u.kind)) {
      if (isSplitTankKind(u.kind)) {
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
      if (u.kind === 'sherman' && this.shermanTopSpriteFrame) {
        this.addTileInspectTopDownTankSprite(parent, u, this.shermanTopSpriteFrame, this.shermanSpriteDisplayW, this.shermanSpriteDisplayH, hexR);
        this.g = oldG;
        return;
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

    const { node: backdrop } = createAdaptiveFullscreenMask(
      root,
      'Backdrop',
      MODAL_BACKDROP,
      UI_ROOT_SCALE,
    );
    backdrop.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      this.closeTileInspectModal();
      e.propagationStopped = true;
    }, this);

    const panel = new Node('Panel');
    panel.layer = this.node.layer;
    panel.addComponent(UITransform).setContentSize(panelW, panelH);
    const pgg = panel.addComponent(Graphics);
    pgg.fillColor = TILE_INSPECT_PANEL_BG;
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

    const { node: backdrop } = createAdaptiveFullscreenMask(
      root,
      'Backdrop',
      MODAL_BACKDROP,
      UI_ROOT_SCALE,
    );
    backdrop.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      this.closeBattleModal();
      e.propagationStopped = true;
    }, this);

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
    this.closeBattleModal();
    const mid = this.currentTurnEndMissionId();
    const theater = this.mission?.data.theater;
    const rows = this.turnEndEventProvider.rows(mid);
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

    const exitRowY = contentY - 216;
    const exitB = this.makeBattleRectButton(panel, 0, exitRowY, 200, 44, BTN_EXIT_WARN,
      () => this.exitLevel(),
    );
    const exitSetLab = this.makeBattleModalLabel(exitB.node, t('battle.settings.exit'), 0, 0, 200, 44, 20, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(exitSetLab, () => this.exitLevel());
  }

  private exitLevel() {
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
      drawFieldPanel(
        g,
        w,
        h,
        opaqueButtonFill(c),
        opts?.border ? BATTLE_MODAL_LEVEL_BORDER : BATTLE_MODAL_DIVIDER,
        STATUS_TITLE_COLOR,
        false,
      );
    };
    redraw(color);
    bindButtonPressScale(n);
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
    bindButtonPressScale(n);
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
    if (this.statusPanelTitleLabel) {
      this.statusPanelTitleLabel.string = this.playerTankStatusTitle();
    }
    if (this.campaignUpgradeStatusTitleLabel) {
      this.campaignUpgradeStatusTitleLabel.string = t('campaignUpgrade.acquiredTitle');
    }
    const bodyKeys = [
      'status.row.loaded',
      'status.row.turret',
      'status.row.mobility',
      ...(GameSession.gameMode === 'hardcore' ? ['status.row.radio'] as const : []),
      'status.row.fireLevel',
    ];
    for (let i = 0; i < this.statusBodyLeftLabels.length && i < bodyKeys.length; i++) {
      this.statusBodyLeftLabels[i].string = t(bodyKeys[i]);
    }
    if (this.statusCrewTitleLabel) this.statusCrewTitleLabel.string = t('status.row.crewTitle');
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
      0, 0, 560, 72, 20,
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
    const button = label.node.parent;
    if (button) bindButtonPressScale(label.node, button);
    label.node.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
      onClick();
      ev.propagationStopped = true;
    }, this);
  }

  /** @returns 是否已成功写入 localStorage */
  private writeCurrentSave(opts: { silent?: boolean } = {}): boolean {
    if (!this.mission) return false;
    if (this.isBusy()) {
      if (!opts.silent) this.flashBattleSettingsHint(t('battle.save.busy'));
      return false;
    }
    if (this.outcome !== 'ongoing') {
      if (!opts.silent) this.flashBattleSettingsHint(t('battle.save.notOngoing'));
      return false;
    }
    if (this.phase !== 'player') {
      if (!opts.silent) this.flashBattleSettingsHint(t('battle.save.playerOnly'));
      return false;
    }
    const data = captureSave({
      gameMode: GameSession.gameMode,
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
      hatchChangedThisTurn: this.hatchChangedThisTurn,
      phaseDice: this.phaseDice.map(s => ({ pip: s.pip, used: s.used })),
      attackPositionMemory: this.attackPositionMemory,
      missionSource: this.missionSource,
    });
    try {
      writeActiveSaveRaw(JSON.stringify(data));
      this.battleLog(`[Save] 已存档：回合 ${data.turn}`);
      if (!opts.silent) this.flashBattleSettingsHint(t('battle.save.ok'));
      return true;
    } catch (e) {
      console.error('[Save] 写入失败:', e);
      if (!opts.silent) this.flashBattleSettingsHint(t('battle.save.fail'));
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
    this.restoreAppliedSave(result, skipHint);
  }

  /** Apply the runtime state common to normal saves and campaign checkpoints. */
  private restoreAppliedSave(result: ReturnType<typeof applySave>, skipHint?: boolean) {
    // 写回场景状态；中断任何敌方阶段调度 / 骰子态 / 动画
    this.pendingAutoEndStep = null;
    this.turn = result.turn!;
    this.phase = result.phase!;
    this.infantryVisualFacing.clear();
    this.infantryVisualAngleOverride.clear();
    this.resetTurretFacingState();
    this.movementDone = (result.movesLeft ?? 2) === 0;
    this.attackDone   = (result.attacksLeft ?? 1) === 0;
    this.miscDone = result.miscDone ?? false;
    this.hatchChangedThisTurn = result.hatchChangedThisTurn ?? false;
    this.attackPositionMemory = cloneAttackPositionMemory(result.attackPositionMemory);
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
    this.enemyDiceTypes = [];
    this.enemyDiceUsed = [];
    this.enemyDiceResolvedActions = [];
    this.clearAIMoveState();
    this.clearActiveActingUnit();
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
    this.clearMuzzleSmokes();
    this.clearProjectileTraces();
    this.clearInfantryRocketTraces();
    this.transientFogRevealKeys.clear();
    this.clearDestroyedTurretVisuals();
    this.clearDestroyWreckVisuals();
    // 胜负状态也要随读档重新判定
    this.outcome = this.computeOutcome();
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
        this.clearAIMoveState(e);
        this.clearActiveActingUnit(e);
        this.enemyIndex++;
        continue;
      }
      break;
    }
    if (this.enemyIndex >= this.enemyOrder.length) {
      this.clearAIMoveState();
      this.clearActiveActingUnit();
      this.destroyEnemyDiceTray();
      if (this.aiSide === 'ally') {
        this.beginEnemyPhase();
      } else {
        this.maybeBeginTurnEndEventOrEndEnemyPhase();
      }
      return;
    }

    const enemy = this.enemyOrder[this.enemyIndex];
    this.enemyDidActThisTurn = false;
    this.enemyInfantryActionIndex = 0;
    this.clearAIMoveState();
    beginAmbushTurn(enemy, GameSession.gameMode);
    this.setActiveActingUnit(enemy);
    if (this.isHardcoreInfantryActor(enemy) && consumeInfantryTurnSuppression(enemy)) {
      this.enemyDidActThisTurn = true;
      // Suppression forfeits the unit's entire turn, including every rank-granted
      // action (veteran/elite infantry normally receive a second action).
      this.enemyInfantryActionIndex = infantryTurnActions(enemy).length;
      this.enemyDice = [];
      this.enemyDiceTypes = [];
      this.enemyDiceUsed = [];
      this.enemyDiceResolvedActions = [];
      this.enemyDiceExecOrder = [];
      this.destroyEnemyDiceTray();
      this.spawnFloater(enemy.pos.q, enemy.pos.r, t('floater.suppressionSkip'),
        new Color(255, 204, 72, 255), { size: 27, dur: 1.0, rise: 34 });
      this.battleLogI18n('battleLog.combat.suppressionSkip', {
        target: unitDisplayName(enemy.kind),
      });
      endAmbushTurn(enemy, this.hasSmokeAt(enemy.pos));
      this.redraw();
      this.scheduleOnce(() => {
        this.clearActiveActingUnit(enemy);
        this.enemyIndex++;
        this.beginCurrentEnemyTurn();
      }, 0.78);
      return;
    }
    this.updateNonPlayerTankCommanderHatch(enemy);
    const tile = this.mission.map.get(enemy.pos);
    const terrain = effectiveDiceTerrain(tile);
    this.enemyAICol = aiColumnFor(enemy, terrain);
    this.enemyFirepowerModifier = this.usesHardcoreTankDice(enemy)
      ? PLAYER_HARDCORE_DICE_POOL.baseByPhaseTerrain.attack[terrain]
      : 0;
    if (this.isHardcoreInfantryActor(enemy)) {
      this.enemyDice = [];
      this.enemyDiceTypes = [];
      this.enemyDiceUsed = [];
      this.enemyDiceResolvedActions = [];
      this.enemyDiceExecOrder = [];
      this.destroyEnemyDiceTray();
      this.runHardcoreInfantryTurn(enemy);
      return;
    }
    if (GameSession.gameMode === 'hardcore' && isControlledATGun(enemy)) {
      if (enemy.suppressed) {
        enemy.suppressed = false;
        const controller = this.atGunController(enemy);
        if (controller) controller.suppressed = false;
        this.enemyDidActThisTurn = true;
        this.destroyEnemyDiceTray();
        this.spawnFloater(enemy.pos.q, enemy.pos.r, t('floater.suppressionSkip'),
          new Color(255, 204, 72, 255), { size: 27, dur: 1.0, rise: 34 });
        this.battleLogI18n('battleLog.combat.suppressionSkip', {
          target: unitDisplayName(enemy.kind),
        });
        endAmbushTurn(enemy, this.hasSmokeAt(enemy.pos));
        this.scheduleOnce(() => {
          this.clearActiveActingUnit(enemy);
          this.enemyIndex++;
          this.beginCurrentEnemyTurn();
        }, 0.78);
        return;
      }
      this.enemyDice = [];
      this.enemyDiceTypes = [];
      this.enemyDiceUsed = [];
      this.enemyDiceResolvedActions = [];
      this.enemyDiceExecOrder = [];
      this.destroyEnemyDiceTray();
      this.runHardcoreATGunTurn(enemy);
      return;
    }
    if (GameSession.gameMode === 'hardcore' && isHeavyArtilleryUnit(enemy)) {
      this.enemyDice = [];
      this.enemyDiceTypes = [];
      this.enemyDiceUsed = [];
      this.enemyDiceResolvedActions = [];
      this.enemyDiceExecOrder = [];
      this.destroyEnemyDiceTray();
      this.runHardcoreHeavyArtilleryTurn(enemy);
      return;
    }
    if (this.usesHardcoreTankDice(enemy)) {
      const dice = rollHardcoreTankAIDice(this.rng, enemy, terrain);
      this.enemyDice = dice.map(d => d.pip);
      this.enemyDiceTypes = dice.map(d => d.type);
    } else {
      const count = AI_DICE_COUNT[this.enemyAICol];
      this.enemyDice = rollAIDice(this.rng, count);
      this.enemyDiceTypes = this.enemyDice.map(() => null);
    }
    this.enemyDiceUsed = this.enemyDice.map(() => false);
    this.enemyDiceResolvedActions = this.enemyDice.map(() => undefined);
    this.enemyDiceExecOrder = this.computeEnemyDiceExecOrder();

    this.battleLog(
      `[AI] ${unitDisplayName(enemy.kind)}@(${enemy.pos.q},${enemy.pos.r}) ${this.describeEnemyDicePool(terrain)} -> [${this.describeEnemyDiceRolls()}] order=${this.enemyDiceExecOrder.map(i => this.describeEnemyDie(i)).join(',')}`
    );

    this.buildEnemyDiceTray(enemy, { playSort: true });
    if (!this.enemyDiceSortAnim) this.runNextEnemyStep();
  }

  /** 硬核步兵按等级执行 1~2 次确定性行动，不掷 AI 行动骰。 */
  private runHardcoreInfantryTurn(infantry: Unit) {
    const actions = infantryTurnActions(infantry);
    while (this.enemyInfantryActionIndex < actions.length) {
      const rule = actions[this.enemyInfantryActionIndex++];
      const attackTarget = rule === 'attack_or_move' ? this.selectAIShootTarget(infantry, true) : null;
      if (attackTarget && this.canAIMainGunResolveSelectedTarget(infantry, attackTarget)) {
        this.enemyDidActThisTurn = true;
        this.battleLog(`[AI] ${unitDisplayName(infantry.kind)} 等级行动 ${this.enemyInfantryActionIndex}/${actions.length}：执行攻击`);
        if (this.executeEnemyAction(infantry, 'shoot') === 'animating') return;
        continue;
      }
      const destination = this.findInfantryAIMove(infantry);
      if (destination) {
        this.enemyDidActThisTurn = true;
        this.battleLog(`[AI] ${unitDisplayName(infantry.kind)} 等级行动 ${this.enemyInfantryActionIndex}/${actions.length}：执行移动`);
        if (this.executeEnemyAction(infantry, 'infantry_move') === 'animating') return;
      }
    }
    endAmbushTurn(infantry, this.hasSmokeAt(infantry.pos));
    this.clearActiveActingUnit(infantry);
    this.enemyIndex++;
    this.beginCurrentEnemyTurn();
  }

  /** Hardcore AT guns take one deterministic attack-or-move action and never roll action dice. */
  private runHardcoreATGunTurn(gun: Unit) {
    const selected = this.selectHardcoreATGunTarget(gun);
    if (!selected) {
      this.finishHardcoreATGunTurn(gun);
      return;
    }

    const current = this.currentTurretFacingFor(gun, gun.facing ?? selected.direction);
    if (current !== selected.direction) {
      const traverse = limitTurretTraverse(
        current,
        selected.direction,
        gun.stats.turretTraverseSpeed,
      );
      this.enemyDidActThisTurn = true;
      markAmbushAction(gun);
      this.breakConcealment(gun);
      this.battleLog(
        `[Hardcore AT] ${unitDisplayName(gun.kind)} 整体转向 ${current} -> ${traverse.direction}`
        + (traverse.reached && selected.attackable ? '，完成瞄准后攻击' : '，本回合停止'),
      );
      this.startHardcoreATGunAim(
        gun,
        traverse.direction,
        traverse.reached && selected.attackable ? selected.target.pos : undefined,
        () => {
          if (traverse.reached && selected.attackable && this.outcome === 'ongoing') {
            this.resolveHardcoreATGunAttack(gun, selected);
          } else {
            this.finishHardcoreATGunTurn(gun);
          }
        },
      );
      return;
    }

    if (selected.attackable) {
      this.enemyDidActThisTurn = true;
      this.startHardcoreATGunAim(gun, current, selected.target.pos, () => {
        this.resolveHardcoreATGunAttack(gun, selected);
      });
      return;
    }

    // Moving is a fallback only when the gun already faces a target whose ray
    // is blocked by physical terrain. Smoke never enables this movement.
    if (selected.terrainBlocked && this.tryHardcoreATGunForwardMove(gun, selected.direction)) {
      this.enemyDidActThisTurn = true;
      return;
    }
    this.finishHardcoreATGunTurn(gun);
  }

  /** Hardcore heavy artillery fires once at a legal target on its fixed four-hex forward ray. */
  private runHardcoreHeavyArtilleryTurn(artillery: Unit) {
    if (artillery.suppressed) {
      artillery.suppressed = false;
      this.enemyDidActThisTurn = true;
      this.spawnFloater(artillery.pos.q, artillery.pos.r, t('floater.suppressionSkip'),
        new Color(255, 204, 72, 255), { size: 28, dur: 1.1, rise: 38 });
      this.finishHardcoreHeavyArtilleryTurn(artillery);
      return;
    }
    const target = this.selectHardcoreHeavyArtilleryTarget(artillery);
    if (!target) {
      this.finishHardcoreHeavyArtilleryTurn(artillery);
      return;
    }
    this.enemyDidActThisTurn = true;
    this.battleLog(
      `[Hardcore Heavy Artillery] ${unitDisplayName(artillery.kind)} 攻击 ${unitDisplayName(target.kind)}`,
    );
    if (!this.tryEnemyAttack(artillery, { selectedTarget: target })) {
      this.finishHardcoreHeavyArtilleryTurn(artillery);
    }
  }

  private selectHardcoreHeavyArtilleryTarget(artillery: Unit): Unit | null {
    if (!this.mission || !isHeavyArtilleryUnit(artillery) || artillery.facing === null) return null;
    const { map, smokeHexes } = this.mission;
    const visible = computeUnitVisibleHexes(map, artillery, this.currentWeather(), smokeHexes);
    const missionTargets = this.aiMissionTargetsFor(artillery);
    const candidates: Array<{ target: Unit; priority: number; distance: number }> = [];

    for (const target of this.aiTargetsFor(artillery)) {
      if (target.destroyed
        || isSameSide(target, artillery)
        || isAbandonedATGun(target)
        || isAbandonedTank(target)
        || isAttachedATGunCrew(target)
        || isFootUnit(target)
        || target.kind === 'truck') continue;
      const distance = hexDistance(artillery.pos, target.pos);
      if (distance < 1 || distance > HEAVY_ARTILLERY_VISION_RANGE) continue;
      if (fireDirectionTo(artillery.pos, target.pos) !== artillery.facing) continue;
      if (!visible.has(HexMap.keyOf(target.pos))) continue;
      if (!canAttack({
        attacker: artillery,
        target,
        map,
        smokeHexes,
        expandedTurretDirections: getGameModeConfig(GameSession.gameMode).expandedTurretDirections,
      }).ok) continue;
      candidates.push({
        target,
        priority: aiTargetPriorityForActor(artillery, target, missionTargets),
        distance,
      });
    }
    candidates.sort((a, b) => a.priority - b.priority || a.distance - b.distance);
    return candidates[0]?.target ?? null;
  }

  private finishHardcoreHeavyArtilleryTurn(artillery: Unit) {
    endAmbushTurn(artillery, this.hasSmokeAt(artillery.pos));
    this.clearActiveActingUnit(artillery);
    this.enemyIndex++;
    this.beginCurrentEnemyTurn();
  }

  private finishHardcoreATGunTurn(gun: Unit) {
    endAmbushTurn(gun, this.hasSmokeAt(gun.pos));
    this.clearActiveActingUnit(gun);
    this.enemyIndex++;
    this.beginCurrentEnemyTurn();
  }

  private selectHardcoreATGunTarget(gun: Unit): HardcoreATGunTarget | null {
    if (!this.mission || !isControlledATGun(gun)) return null;
    const { map, smokeHexes } = this.mission;
    const current = this.currentTurretFacingFor(gun, gun.facing ?? 0);
    const expandedTurretDirections = getGameModeConfig(GameSession.gameMode).expandedTurretDirections;
    const radioVisionSharing = getGameModeConfig(GameSession.gameMode).radioVisionSharing;
    const crew = this.atGunCrewActor(gun);
    const candidates: HardcoreATGunTarget[] = [];

    for (const target of this.aiTargetsFor(gun)) {
      if (target.destroyed || isAbandonedATGun(target) || isAbandonedTank(target)
        || isAttachedATGunCrew(target) || isSameSide(target, gun)) continue;
      if (!isUnitInVision(
        map,
        gun,
        target,
        this.aiFriendliesFor(gun),
        radioVisionSharing,
        this.currentWeather(),
        smokeHexes,
      )) continue;

      const infantryAttack = isFootUnit(target);
      const exactDirection = fireDirectionTo(gun.pos, target.pos);
      const flankDirection = exactDirection === null
        ? diagonalFlankFireDirectionTo(gun.pos, target.pos)
        : null;
      const direction = exactDirection
        ?? flankDirection
        ?? approximateFireDirection(gun.pos, target.pos);
      let attacker: Unit;
      let attackable = false;
      let terrainBlocked = false;
      let smokeBlocked = false;

      if (infantryAttack) {
        attacker = crew;
        attackable = canAttack({
          attacker,
          target,
          map,
          smokeHexes,
          expandedTurretDirections,
        }).ok;
      } else {
        // Fixed AT-gun fire adopts turreted 12-ray geometry while retaining
        // the gun's own penetration, range and crew-level modifiers.
        if (exactDirection === null && flankDirection === null) continue;
        attacker = {
          ...gun,
          // Validate the shot in its aimed state. The turn executor still
          // applies traverse speed and fires only when this direction is
          // reached during the current action.
          turretFacing: direction,
          stats: { ...gun.stats, visionType: 'turreted' },
        };
        const baseCtx = {
          attacker,
          target,
          map,
          expandedTurretDirections,
        };
        const actual = canAttack({ ...baseCtx, smokeHexes });
        const withoutSmoke = canAttack(baseCtx);
        attackable = actual.ok;
        if (flankDirection !== null) {
          // A blocked diagonal flank is reported as non-straight after the
          // path helper rejects it, so inspect that path directly to retain
          // the terrain-vs-smoke movement rule.
          const targetDistance = hexDistance(gun.pos, target.pos);
          const actualFlank = diagonalGunnerClickPreference(
            map, attacker, flankDirection, target.pos, smokeHexes, targetDistance,
          );
          const clearFlank = diagonalGunnerClickPreference(
            map, attacker, flankDirection, target.pos, undefined, targetDistance,
          );
          terrainBlocked = !actual.ok && actualFlank === null && clearFlank === null;
          smokeBlocked = !actual.ok && actualFlank === null && clearFlank !== null;
        } else {
          terrainBlocked = !actual.ok
            && actual.reason === 'attack.reason.blocked'
            && !withoutSmoke.ok
            && withoutSmoke.reason === 'attack.reason.blocked';
          smokeBlocked = !actual.ok
            && actual.reason === 'attack.reason.blocked'
            && withoutSmoke.ok;
        }
      }

      // Smoke-obscured targets do not count as legal choices and, unlike a
      // building/forest obstruction, can never trigger the forward move.
      if ((!attackable && !terrainBlocked) || smokeBlocked) continue;
      candidates.push({
        target,
        attacker,
        direction,
        turnDistance: turretTurnDistance(current, direction),
        distance: hexDistance(gun.pos, target.pos),
        infantryAttack,
        attackable,
        terrainBlocked,
        smokeBlocked,
      });
    }

    candidates.sort((a, b) =>
      Number(a.infantryAttack) - Number(b.infantryAttack)
      || a.turnDistance - b.turnDistance
      || a.distance - b.distance,
    );
    return candidates[0] ?? null;
  }

  private startHardcoreATGunAim(
    gun: Unit,
    to: FireDirection,
    visualTarget: Axial | undefined,
    onDone: () => void,
  ) {
    const from = this.currentTurretFacingFor(gun, gun.facing ?? to);
    if (from === to) {
      this.enemyTurretFacing.set(gun.id, to);
      gun.turretFacing = to;
      gun.turretVisualTarget = visualTarget ? { ...visualTarget } : undefined;
      this.redraw();
      onDone();
      return;
    }
    gun.previousTurretFacing = from;
    this.beginTurretAimAnim({
      unit: gun,
      from,
      to,
      t: 0,
      dur: Math.max(0.01, turretTraverseAnimationDuration(from, to, gun.stats.turretTraverseSpeed)),
      suppressTurretSound: true,
      fromVisualTarget: gun.turretVisualTarget ? { ...gun.turretVisualTarget } : undefined,
      toVisualTarget: visualTarget ? { ...visualTarget } : undefined,
      onDone: () => {
        // AT-gun rendering applies this 12-direction state to the complete
        // mount and crew rather than to a separate turret layer.
        gun.turretFacing = to;
        this.enemyTurretFacing.set(gun.id, to);
        onDone();
      },
    });
    this.redraw();
  }

  private tryHardcoreATGunForwardMove(gun: Unit, facing: FireDirection): boolean {
    if (!this.mission) return false;
    const axialDirections: Direction[] = facing < 6
      ? [facing as Direction]
      : [((facing - 6) % 6) as Direction, ((facing - 5) % 6) as Direction];
    const to = axialDirections
      .map(direction => neighbor(gun.pos, direction))
      .find(pos => {
        const tile = this.mission!.map.get(pos);
        return !!tile
          && tile.terrain !== 'rocky'
          && this.canMoveToBattleTile(pos)
          && this.mission!.map.canUnitEnter(pos, gun.faction)
          && this.findMoveBlocker(gun, pos) === null;
      });
    if (!to) return false;

    markAmbushAction(gun);
    this.breakConcealment(gun);
    this.anim = {
      unit: gun,
      kind: 'move',
      fromQ: gun.pos.q,
      fromR: gun.pos.r,
      toQ: to.q,
      toR: to.r,
      t: 0,
      dur: Math.max(0.05, this.moveDuration),
    };
    this.battleLog(`[Hardcore AT] ${unitDisplayName(gun.kind)} 向前移动 1 格 → (${to.q},${to.r})`);
    this.redraw();
    return true;
  }

  private resolveHardcoreATGunAttack(gun: Unit, selected: HardcoreATGunTarget) {
    if (!this.mission || gun.destroyed || selected.target.destroyed) {
      this.finishHardcoreATGunTurn(gun);
      return;
    }
    const target = selected.target;
    const attacker = selected.infantryAttack ? this.atGunCrewActor(gun) : selected.attacker;
    const attackCtx = {
      attacker,
      target,
      map: this.mission.map,
      protagonist: this.protagonistForAttackTarget(target),
      theater: this.mission.data.theater,
      units: this.allUnits(),
      smokeHexes: this.mission.smokeHexes,
      weather: this.currentWeather(),
      hitThresholdModifier: ambushHitThresholdModifier(gun, GameSession.gameMode),
      hitThresholdModifiers: ambushHitThresholdModifierDetails(gun, GameSession.gameMode),
      effectiveRangePenetration: getGameModeConfig(GameSession.gameMode).effectiveRangePenetration,
      overpenetration: getGameModeConfig(GameSession.gameMode).overpenetration,
      expandedTurretDirections: getGameModeConfig(GameSession.gameMode).expandedTurretDirections,
      directionalDamageCheck: getGameModeConfig(GameSession.gameMode).directionalDamageCheck,
      gunMantletArmor: getGameModeConfig(GameSession.gameMode).gunMantletArmor,
      unitDamageTargetClass: getGameModeConfig(GameSession.gameMode).unitDamageTargetClass,
    };
    markAmbushAction(gun);
    markAmbushTargeted(target);
    const report = rollAttack(attackCtx, this.rng);
    const actorLabel = gun.sideId === 'enemy'
      ? t('actor.enemyPrefix', { name: unitDisplayName(gun.kind) })
      : t('actor.allyPrefix', { name: unitDisplayName(gun.kind) });
    const targetLabel = target === this.mission.sherman
      ? unitDisplayName(target.kind)
      : target.sideId === 'enemy'
        ? t('actor.enemyPrefix', { name: unitDisplayName(target.kind) })
        : t('actor.allyPrefix', { name: unitDisplayName(target.kind) });
    const attackSound = selected.infantryAttack ? attacker.stats.attackSound : gun.stats.attackSound;

    this.battleLog(
      `[Hardcore AT] ${unitDisplayName(gun.kind)} 攻击 ${unitDisplayName(target.kind)}`
      + (selected.infantryAttack ? '（操炮步兵步枪）' : '（反坦克炮）'),
    );
    let attackApplied = false;
    const applyAndPresentAttack = () => {
      if (attackApplied) return;
      attackApplied = true;
      this.applyMainGunAttackResult(target, report);
      if (target.destroyed) this.registerImpactDestroyWreckVisual(target, gun);
      this.presentAttackResult(actorLabel, report, attacker, target);
      this.updateHUD();
      this.redraw();
      this.refreshStatusPanel();
    };
    this.startDiceShow(report, actorLabel, targetLabel, () => {
      applyAndPresentAttack();
      if (this.outcome !== 'ongoing') this.clearActiveActingUnit(gun);
      if (this.outcome === 'ongoing' && (this.phase === 'ally' || this.phase === 'enemy')) {
        this.runNextEnemyStep();
      }
    }, {
      mg: selected.infantryAttack,
      attackSound,
      attacker,
      target,
      onHold: applyAndPresentAttack,
    });
  }

  /** Applies the hardcore-only AI commander hatch rule before this tank acts. */
  private updateNonPlayerTankCommanderHatch(unit: Unit) {
    if (!this.mission) return;
    if (GameSession.gameMode !== 'hardcore' || unit === this.mission.sherman || !isTankUnit(unit)) return;
    // 车长在开舱状态下阵亡后保留 hatchOpen，持续显示无车长的空舱盖图片。
    // 这不是一次关舱动作，因此也不播放关舱音效。
    if (unit.crew?.commander === false) return;
    const nextOpen = shouldNonPlayerTankOpenCommanderHatch(
      unit,
      this.allUnits(),
      this.mission.sherman,
      GameSession.gameMode,
    );
    if (unit.hatchOpen === nextOpen) return;
    const visibilityBefore = nextOpen ? this.displayedFogVisionSnapshot() : null;
    unit.hatchOpen = nextOpen;
    // 音效不受迷雾可见性影响：未发现的坦克切换舱盖也能被听见。
    playCommanderHatch(nextOpen);
    if (visibilityBefore) {
      this.startFogVisionTransition(visibilityBefore, true, HATCH_VISION_LAYER_INTERVAL);
    } else {
      this.fogVisionTransition = null;
    }
    this.redraw();
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
      this.clearAIMoveState(enemy);
      this.clearActiveActingUnit(enemy);
      this.enemyIndex++;
      this.beginCurrentEnemyTurn();
      return;
    }

    // 步兵动画/攻击结算结束后回到这里，继续其等级赋予的第二次行动。
    if (this.isHardcoreInfantryActor(enemy)) {
      this.runHardcoreInfantryTurn(enemy);
      return;
    }

    while (true) {
      // 按「点数升序（同点原序）」依次消耗骰子，而非数组下标顺序
      const dieIdx = this.enemyDiceExecOrder.find(i => !this.enemyDiceUsed[i]);
      if (dieIdx === undefined) {
        this.enemyDiceHighlightIdx = -1;
        this.clearAIMoveState(enemy);
        this.clearActiveActingUnit(enemy);
        this.refreshEnemyDiceTray();
        if (!this.enemyDidActThisTurn) {
          this.enemyDiceResultHold = { t: 0, dur: 1.0 };
          return;
        }
        endAmbushTurn(enemy, this.hasSmokeAt(enemy.pos));
        this.enemyIndex++;
        this.beginCurrentEnemyTurn();
        return;
      }

      const pip = this.enemyDice[dieIdx];
      const entry = this.enemyDieActionEntry(dieIdx);
      const chosen = this.chooseActionForEntry(enemy, entry, { commitMoveState: true });
      const entryLabel = describeEntry(entry);
      const invalidAttackDie = this.enemyDiceTypes[dieIdx] === 'attack'
        && hardcoreAttackDieIsInvalid(pip, this.enemyFirepowerModifier);
      this.battleLog(
        `[AI] ${unitDisplayName(enemy.kind)} #${dieIdx + 1} d6=${pip} → ${entryLabel}` +
        (chosen ? ` ⇒ ${chosen}` : invalidAttackDie ? ' ⇒ 无效' : ' ⇒ 无可行动作（空转）')
      );

      this.enemyDiceHighlightIdx = dieIdx;
      // 消耗这颗骰子（无论是否真正执行成功，都算"本骰已用")
      this.refreshEnemyDiceTray();

      if (!chosen) {
        this.enemyDiceResolvedActions[dieIdx] = null;
        this.enemyDiceUsed[dieIdx] = true;
        this.enemyDiceHighlightIdx = -1;
        this.refreshEnemyDiceTray();
        continue;
      }

      // 执行选中的动作；返回表明本次是否"挂起"（有动画在播）
      this.enemyDiceResolvedActions[dieIdx] = chosen;
      this.enemyDiceUsed[dieIdx] = true;
      this.enemyDidActThisTurn = true;
      this.refreshEnemyDiceTray();
      const result = this.executeEnemyAction(enemy, chosen);
      if (this.outcome !== 'ongoing') {
        this.clearAIMoveState(enemy);
        this.clearActiveActingUnit(enemy);
        return;
      } // 可能谢尔曼被击毁
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
  private chooseActionForEntry(
    enemy: Unit,
    entry: AIActionEntry,
    opts: { commitMoveState?: boolean } = {},
  ): EnemyAction | null {
    if (!this.mission) return null;
    const { map } = this.mission;
    const target = this.currentAITarget(enemy);
    if (!target) return null;
    const occupied = this.buildOccupiedSet(enemy);
    if (opts.commitMoveState) this.pendingAIMoveState = null;

    // shoot 的真正可行性必须由 canAttack 决定。固定主炮坦克在当前朝向
    // 没有合法目标时，把这次攻击动作转换为一次车体转向。
    const canPerform = (a: EnemyAction): boolean => {
      if (a === 'shoot_adjacent') {
        return !!this.selectAIShootTarget(enemy, false, true);
      }
      if (a === 'infantry_move') {
        return !!this.findInfantryAIMove(enemy);
      }
      if (!canExecuteAction(enemy, a, target, map, occupied, this.mission?.smokeHexes)) return false;
      const moveDestination = this.aiMoveDestinationForAction(enemy, a);
      if (moveDestination && !this.canMoveToBattleTile(moveDestination)) return false;
      if (!this.isAIReverseMoveFilterEnabled()) return true;
      const moveTarget = a === 'turn' ? this.currentAITurnTargetPosition(enemy) : target.pos;
      const moveState = this.aiMoveStateForAction(enemy, a, moveTarget, occupied, { useRng: !!opts.commitMoveState });
      if (!this.isAIMoveStateAllowed(moveState, enemy)) return false;
      if (opts.commitMoveState) this.pendingAIMoveState = { unit: enemy, action: a, state: moveState };
      return true;
    };

    const tryOne = (a: EnemyAction, crew?: CrewSlot): EnemyAction | null => {
      if (!this.enemyCrewRequirementMet(enemy, crew)) return null;
      if (a === 'shoot') {
        if (this.canAIExecuteShoot(enemy)) return 'shoot';
        if (isTankUnit(enemy) && enemy.stats.visionType === 'fixed' && canPerform('turn')) return 'turn';
        return null;
      }
      return canPerform(a) ? a : null;
    };

    if (entry.primary !== 'none') {
      const chosen = tryOne(entry.primary, entry.primaryCrew);
      if (chosen) return chosen;
    }
    if (entry.fallback && entry.fallback !== 'none') {
      const chosen = tryOne(entry.fallback, entry.fallbackCrew);
      if (chosen) return chosen;
    }
    if (entry.fallback2 && entry.fallback2 !== 'none') {
      const chosen = tryOne(entry.fallback2, entry.fallback2Crew);
      if (chosen) return chosen;
    }
    return null;
  }

  private enemyCrewRequirementMet(enemy: Unit, crew?: CrewSlot): boolean {
    if (!crew) return true;
    return enemy.crew?.[crew] !== false;
  }

  /**
   * 真正执行一次 EnemyAction。返回 'done' = 同步完成，继续下一颗；
   * 返回 'animating' = 已启动动画（移动 / 掷骰 show），调用方必须 return。
   */
  private executeEnemyAction(enemy: Unit, action: EnemyAction): 'done' | 'animating' {
    if (!this.mission) return 'done';
    const { map } = this.mission;
    const plannedMoveState = this.pendingAIMoveState
      && this.pendingAIMoveState.unit === enemy
      && this.pendingAIMoveState.action === action
      ? this.pendingAIMoveState.state
      : undefined;
    this.pendingAIMoveState = null;

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
        const target = this.currentAITurnTargetPosition(enemy);
        if (enemy.facing === null) enemy.facing = 0;
        const occupied = this.buildOccupiedSet(enemy);
        const decision = plannedMoveState === 'turn_cw'
          ? 'cw'
          : plannedMoveState === 'turn_ccw'
            ? 'ccw'
            : plannedMoveState === null
              ? 'stay'
              : decideEnemyTurn(enemy, target, map, occupied, this.rng);
        if (decision === 'stay') {
          this.battleLog(`[AI] ${unitDisplayName(enemy.kind)} 转向 → 保持 facing=${enemy.facing}`);
          this.redraw();
          return 'done';
        }
        const step = decision === 'cw' ? 1 : 5;
        const from = enemy.facing;
        const to = rotateDirection(from, step);
        markAmbushAction(enemy);
        // §3.5 隐蔽：坦克任何移动动作（转向 / 前进 / 后退）都会脱离隐蔽，与谢尔曼一致
        this.breakConcealment(enemy);
        if (this.isAIReverseMoveFilterEnabled()) {
          this.aiMoveState = { unit: enemy, state: decision === 'cw' ? 'turn_cw' : 'turn_ccw' };
        }
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
        // Recheck occupancy at execution time so a move selected earlier cannot
        // enter a hex that is now held by a friendly controlled AT gun.
        if (!this.canMoveToBattleTile(to) || this.findMoveBlocker(enemy, to) !== null) return 'done';
        markAmbushAction(enemy);
        // §3.5 隐蔽：坦克前进 / 后退也会脱离隐蔽
        this.breakConcealment(enemy);
        if (this.isAIReverseMoveFilterEnabled()) {
          this.aiMoveState = {
            unit: enemy,
            state: action === 'reverse' ? 'reverse' : 'advance',
          };
        }
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
        const to = this.findInfantryAIMove(enemy);
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
        if (!commanderHasSkill(enemy, 'use_smoke_grenade')
          || tileForbidsSmokeOrConcealment(map.get(enemy.pos))
          || this.hasSmokeAt(enemy.pos)) return 'done';
        this.deploySmokeAt(enemy.pos, enemy.sideId === 'player' ? 'friendly' : 'enemy', true);
        this.battleLog(`[AI] ${unitDisplayName(enemy.kind)} 施放烟雾`);
        this.spawnFloater(enemy.pos.q, enemy.pos.r, t('floater.smoke'),
          new Color(200, 200, 220, 255), { size: 24 });
        this.redraw();
        return 'done';
      }

      case 'repair': {
        let repaired = false;
        const component = firstDamagedRepairableComponent(enemy);
        if (component) {
          component.repair(enemy);
          repaired = true;
        } else if (enemy.damaged) {
          enemy.damaged = false;
          repaired = true;
        }
        const oldFire = enemy.fireLevel ?? 0;
        if (oldFire > 0) {
          enemy.fireLevel = Math.max(0, oldFire - 1);
          repaired = true;
        }
        if (repaired) {
          this.battleLog(`[AI] ${unitDisplayName(enemy.kind)} 修复成功`);
          this.spawnFloater(enemy.pos.q, enemy.pos.r, t('floater.repairAndFire'),
            new Color(160, 220, 160, 255), { size: 24 });
          this.redraw();
        }
        return 'done';
      }

      case 'conceal': {
        if (enemy.paralyzed || tileForbidsSmokeOrConcealment(map.get(enemy.pos))) return 'done';
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

  private findInfantryAIMove(enemy: Unit): Axial | null {
    if (!this.mission || !isFootUnit(enemy) || enemy.kind === 'officer') return null;
    const target = this.nearestInfantryAITarget(enemy);
    if (!target) return null;
    const currentDist = hexDistance(enemy.pos, target.pos);
    const currentTile = this.mission.map.get(enemy.pos);
    if (!currentTile) return null;
    const currentPriority = this.infantryMoveHexPriority(enemy, enemy.pos, currentTile);
    const preserveCurrentPriority = currentDist <= 2;
    const occupied = this.buildOccupiedSet(enemy);
    let best: Axial | null = null;
    let bestPriority = Infinity;
    let bestDist = currentDist;
    const candidates: Axial[] = [];

    for (const n of neighbors(enemy.pos)) {
      const tile = this.mission.map.get(n);
      if (!tile) continue;
      if (!this.canMoveToBattleTile(n)) continue;
      if (!this.mission.map.canUnitEnter(n, enemy.faction)) continue;
      const d = hexDistance(n, target.pos);
      if (d >= currentDist) continue;
      const priority = this.infantryAIMovePriority(enemy, n, tile);
      if (priority === null) continue;
      // Lower values are higher priority. Infantry only refuses to leave its
      // current priority tier when an enemy is already within two hexes.
      if (preserveCurrentPriority && priority > currentPriority) continue;
      if (occupied.has(`${n.q},${n.r}`) && !this.canInfantryEnterPriorityOccupiedHex(enemy, n)) continue;
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

  private isHardcoreInfantryActor(unit: Unit): boolean {
    return GameSession.gameMode === 'hardcore'
      && isFootUnit(unit)
      && unit.kind !== 'officer';
  }

  private nearestInfantryAITarget(enemy: Unit): Unit | null {
    const candidates = this.aiTargetsFor(enemy).filter(unit =>
      !unit.destroyed
      && !isAbandonedATGun(unit)
      && !isAbandonedTank(unit)
      && !isAttachedATGunCrew(unit),
    );
    if (candidates.length === 0) return null;
    let bestDistance = Infinity;
    const tied: Unit[] = [];
    for (const candidate of candidates) {
      const distance = hexDistance(enemy.pos, candidate.pos);
      if (distance < bestDistance) {
        bestDistance = distance;
        tied.length = 0;
        tied.push(candidate);
      } else if (distance === bestDistance) {
        tied.push(candidate);
      }
    }
    return tied.length === 1 ? tied[0] : tied[this.rng.intRange(0, tied.length - 1)];
  }

  /**
   * Lower numbers win: neutral AT gun > friendly tank > rocky/building/forest
   * (same tier) > trees > other safe traversable terrain. Ordinary terrain next
   * to unsuppressed hostile infantry is excluded entirely; priority terrain remains legal.
   */
  private infantryAIMovePriority(enemy: Unit, pos: Axial, tile: Tile): number | null {
    const priority = this.infantryMoveHexPriority(enemy, pos, tile);
    if (priority < 4) return priority;

    const adjacentToUnsuppressedHostileInfantry = neighbors(pos).some(adjacent =>
      this.allUnits().some(unit =>
        !unit.destroyed
        && !unit.suppressed
        && !isAttachedATGunCrew(unit)
        && unit.kind !== 'officer'
        && isFootUnit(unit)
        && isHostile(unit, enemy)
        && unit.pos.q === adjacent.q
        && unit.pos.r === adjacent.r,
      ),
    );
    return adjacentToUnsuppressedHostileInfantry ? null : priority;
  }

  /** Raw priority for both the current hex and destinations; lower is better. */
  private infantryMoveHexPriority(enemy: Unit, pos: Axial, tile: Tile): number {
    const occupants = this.allUnits().filter(u =>
      u !== enemy && !u.destroyed && u.pos.q === pos.q && u.pos.r === pos.r,
    );
    if (occupants.some(u => isAntiTankGunUnit(u) && u.faction === 'neutral')) return 0;
    const sameSide = (unit: Unit) => unit.faction !== 'neutral' && isSameSide(unit, enemy);
    if (occupants.some(u => isTankUnit(u) && sameSide(u))) return 1;
    if (tile.terrain === 'rocky' || tile.hasBuilding || tile.terrain === 'forest') return 2;
    if (tile.terrain === 'trees') return 3;
    return 4;
  }

  private canInfantryEnterPriorityOccupiedHex(enemy: Unit, pos: Axial): boolean {
    const occupants = this.allUnits().filter(unit =>
      unit !== enemy && !unit.destroyed && unit.pos.q === pos.q && unit.pos.r === pos.r,
    );
    return occupants.every(unit =>
      !this.isBlockingMoveOccupant(enemy, unit)
      || (isAntiTankGunUnit(unit) && unit.faction === 'neutral')
      || (isTankUnit(unit)
        && unit.faction !== 'neutral'
        && isSameSide(unit, enemy)),
    );
  }

  private clearAIMoveState(unit?: Unit | null) {
    if (!unit || this.aiMoveState?.unit === unit) this.aiMoveState = null;
    if (!unit || this.pendingAIMoveState?.unit === unit) this.pendingAIMoveState = null;
  }

  private isAIReverseMoveFilterEnabled(): boolean {
    return getGameModeConfig(GameSession.gameMode).aiReverseMoveFilter;
  }

  private isOppositeAIMoveState(a: AIMoveState, b: AIMoveState): boolean {
    return (a === 'turn_cw' && b === 'turn_ccw')
      || (a === 'turn_ccw' && b === 'turn_cw')
      || (a === 'advance' && b === 'reverse')
      || (a === 'reverse' && b === 'advance');
  }

  private aiMoveStateForAction(
    enemy: Unit,
    action: EnemyAction,
    target: Axial,
    occupied: Set<string>,
    opts: { useRng?: boolean } = {},
  ): AIMoveState | null {
    if (!this.mission) return null;
    switch (action) {
      case 'turn': {
        const decision = decideEnemyTurn(enemy, target, this.mission.map, occupied, opts.useRng ? this.rng : undefined);
        if (decision === 'stay') return null;
        return decision === 'cw' ? 'turn_cw' : 'turn_ccw';
      }
      case 'advance':
      case 'advance_to_building':
        return 'advance';
      case 'reverse':
        return 'reverse';
      default:
        return null;
    }
  }

  private aiMoveDestinationForAction(enemy: Unit, action: EnemyAction): Axial | null {
    if (enemy.facing === null) return null;
    switch (action) {
      case 'advance':
      case 'advance_to_building':
        return neighbor(enemy.pos, enemy.facing);
      case 'reverse':
        return neighbor(enemy.pos, rotateDirection(enemy.facing, 3));
      default:
        return null;
    }
  }

  private isAIMoveStateAllowed(state: AIMoveState | null, enemy: Unit): boolean {
    if (!state) return true;
    const last = this.aiMoveState;
    return !last || last.unit !== enemy || !this.isOppositeAIMoveState(last.state, state);
  }

  /** 构造"其他单位占格"集合，供 canExecuteAction / decideEnemyTurn 使用 */
  private buildOccupiedSet(self: Unit): Set<string> {
    const occ = new Set<string>();
    if (!this.mission) return occ;
    for (const u of this.allUnits()) {
      if (u === self || u.destroyed) continue;
      if (!this.isBlockingMoveOccupant(self, u)) continue;
      occ.add(`${u.pos.q},${u.pos.r}`);
    }
    return occ;
  }

  private findMoveBlocker(mover: Unit, pos: Axial): Unit | null {
    return this.allUnits().find(u =>
      u !== mover
      && !u.destroyed
      && u.pos.q === pos.q
      && u.pos.r === pos.r
      && this.isBlockingMoveOccupant(mover, u)
    ) ?? null;
  }

  private isBlockingMoveOccupant(mover: Unit, occupant: Unit): boolean {
    if (isAttachedATGunCrew(occupant)) return false;
    // Any infantry may enter an abandoned tank's hex to become its new crew.
    if (isFootUnit(mover) && isAbandonedTank(occupant)) return false;
    if (GameSession.gameMode === 'hardcore') {
      // AT guns cannot move into a hex occupied by any non-tank unit.
      if (isAntiTankGunUnit(mover) && !isTankUnit(occupant)) return true;
      // Infantry may enter an abandoned gun's hex to take control.
      if (isFootUnit(mover) && isAbandonedATGun(occupant)) return false;
      // A tank can overrun an enemy or neutral AT gun, but never a friendly controlled one.
      if (isTankUnit(mover) && isAntiTankGunUnit(occupant)) {
        return isControlledATGun(occupant) && this.areUnitsOnSameSide(mover, occupant);
      }
      // Enemy infantry no longer blocks a tank from entering its hex.
      if (isTankUnit(mover) && isFootUnit(occupant)) return false;
    }
    // Tanks and other vehicle-like units may enter same-faction foot-unit hexes.
    if (!isFootUnit(mover) && isFootUnit(occupant) && isSameSide(mover, occupant)) return false;
    return true;
  }

  private areUnitsOnSameSide(a: Unit, b: Unit): boolean {
    return a.faction !== 'neutral'
      && b.faction !== 'neutral'
      && isSameSide(a, b);
  }

  /** Restore a controlled AT-gun crew as an ordinary infantry unit in the gun's hex. */
  private releaseATGunCrew(gun: Unit): Unit | null {
    // Main-gun damage is applied before crew release, so a destroyed gun can
    // still have a living attached crew that must be restored as infantry.
    if (!this.mission || !isAntiTankGunUnit(gun) || gun.atGunCrewAlive !== true) return null;
    const crewFaction = gun.faction;
    let infantry = this.atGunController(gun);
    if (infantry) {
      infantry.pos = { ...gun.pos };
      infantry.attachedToATGunId = undefined;
      infantry.destroyed = false;
    } else {
      infantry = this.atGunCrewProxy(gun);
      infantry.id = `${gun.id}:released:${gun.atGunCrewGeneration ?? 0}`;
      const side = gun.sideId === 'player' ? this.mission.allies : this.mission.enemies;
      side.push(infantry);
    }
    this.inheritReleasedATGunCrewFacing(gun, infantry);
    gun.atGunCrewAlive = false;
    gun.atGunControllerUnitId = undefined;
    gun.atGunCrewLevel = undefined;
    gun.faction = 'neutral';
    gun.visionRange = 0;
    return infantry;
  }

  private inheritReleasedATGunCrewFacing(gun: Unit, infantry: Unit): void {
    const ruleFacing = this.currentTurretFacingFor(gun, gun.facing ?? 0);
    const facingVector = fireDirectionVector(ruleFacing);
    infantry.facing = infantryVisualDirection({ q: 0, r: 0 }, facingVector)
      ?? gun.facing
      ?? 0;

    // A gun may visually point between its quantized 12 rules directions.
    // Capture its rendered vector before clearing the composite-unit state.
    const center = this.project(gun.pos.q, gun.pos.r);
    const forward = this.topDownForwardVec(gun, center, this.currentEnemyTurretLerp(gun));
    this.infantryVisualAngleOverride.set(
      infantry.id,
      Math.atan2(forward.uy, forward.ux) * 180 / Math.PI + 90,
    );
    this.infantryVisualFacing.delete(infantry.id);
  }

  /** Hardcore: a tank entering an enemy/neutral AT-gun hex destroys only the gun. */
  private crushEnemyATGunsAt(mover: Unit): void {
    if (GameSession.gameMode !== 'hardcore' || !isTankUnit(mover)) return;
    for (const unit of this.allUnits()) {
      if (unit === mover
        || unit.destroyed
        || !isAntiTankGunUnit(unit)
        || (isControlledATGun(unit) && this.areUnitsOnSameSide(mover, unit))
        || unit.pos.q !== mover.pos.q
        || unit.pos.r !== mover.pos.r) continue;
      if (isControlledATGun(unit)) this.releaseATGunCrew(unit);
      unit.destroyed = true;
      this.registerDestroyWreckVisual(unit);
      this.spawnFloater(unit.pos.q, unit.pos.r, t('floater.crushed'),
        new Color(255, 180, 80, 255), { size: 28, dur: 1.0, rise: 34 });
      this.battleLog(`[Hardcore] ${unitDisplayName(mover.kind)} crushed ${unitDisplayName(unit.kind)}`);
    }
  }

  private endEnemyPhase() {
    if (GameSession.isPvp) {
      this.enterPvpWaitingForOpponent();
      return;
    }
    advanceAttackPositionMemory(this.attackPositionMemory);
    this.turn += 1;
    this.clearDestroyWreckVisuals();
    // 清理敌方调度中间态
    this.enemyOrder = [];
    this.enemyIndex = 0;
    this.enemyDice = [];
    this.enemyDiceTypes = [];
    this.enemyDiceUsed = [];
    this.enemyDiceResolvedActions = [];
    this.clearAIMoveState();
    this.clearActiveActingUnit();
    this.destroyEnemyDiceTray();
    // 敌方阶段也可能击毁谢尔曼；重入玩家回合时复查胜负
    if (this.mission) {
      this.outcome = this.computeOutcome();
      this.updateOutcomeOverlay();
    }
    if (this.outcome !== 'ongoing') {
      this.beginPlayerPhaseForNewTurn();
      this.writeCurrentSave({ silent: true });
      return;
    }
    const faction = this.mission?.sherman.faction ?? 'usa';
    this.showTurnTransition(faction, 'player', () => {
      this.beginPlayerPhaseForNewTurn();
      this.writeCurrentSave({ silent: true });
    });
  }

  // ---------- 交互 ----------

  /**
   * 地图点击：玩家回合下，优先处理「攻击/杂项 + 已选骰 + 点敌人」开火；
   * 其余情况打开格子介绍（地形、骰子规则、单位状态）。
   */
  private onTouchMap(event: EventTouch) {
    if (!this.mission || !this.mapNode) return;
    if (this.mapPanEnabled && this.mapPanMoved) {
      this.mapPanMoved = false;
      event.propagationStopped = true;
      return;
    }
    if (this.isBusy()) return;
    if (this.outcome !== 'ongoing') return;

    const target = this.pickTileAtScreenUi(event);
    if (!target) return;

    if (this.phase !== 'player') {
      if (GameSession.isPvp) this.openTileInspectModal(target);
      return;
    }

    this.closeDiePopover();

    const targetVisible = this.isHexVisible(target.pos);

    const visibleUnitsOnTile = targetVisible ? this.allUnits().filter(
      unit => !unit.destroyed
        && this.isUnitVisible(unit)
        && unit.pos.q === target.pos.q
        && unit.pos.r === target.pos.r,
    ) : [];
    const enemiesOnTile = targetVisible ? this.playerMainGunTargets().filter(
      e => !e.destroyed && e.pos.q === target.pos.q && e.pos.r === target.pos.r,
    ) : [];
    const mainGunTarget = selectMainGunTargetsByHex(enemiesOnTile)[0];
    const attackOrMisc = this.playerStep === 'attack' || this.playerStep === 'misc';
    const gunSel = this.selectedGunDieIdx >= 0;
    const mgSel = this.selectedMGDieIdx >= 0;
    const legalMainGunTarget = gunSel && mainGunTarget
      && this.playerWeaponTargetHexKeys().has(HexMap.keyOf(target.pos))
      ? mainGunTarget : undefined;
    const legalMGTarget = mgSel ? enemiesOnTile.find(e => canMGAttack({
      attacker: this.mission!.sherman,
      target: e,
      map: this.mission!.map,
      theater: this.mission!.data.theater,
      units: this.allUnits(),
      smokeHexes: this.mission!.smokeHexes,
      weather: this.currentWeather(),
      expandedTurretDirections: getGameModeConfig(GameSession.gameMode).expandedTurretDirections,
      atGunCrewTargets: GameSession.gameMode === 'hardcore',
      ...this.tankMachineGunContext(this.mission!.sherman, e),
    }).ok) : undefined;

    if (attackOrMisc
      && this.playerTurretCanRotate()
      && this.hasTurretReconGunSelection()) {
      const precisionGunSelection = gunSel && this.selectedGunHitThresholdModifier < 0;
      // Precision fire uses the common range overlay and traverse ring, but it
      // may only commit against an actual visible main-gun target. It must not
      // consume its paired dice as a rotation-only reconnaissance action.
      if (precisionGunSelection) {
        if (!targetVisible || !legalMainGunTarget) {
          this.openTileInspectModal(target);
          return;
        }
      } else {
        const direction = fireDirectionTo(this.mission.sherman.pos, target.pos)
          ?? diagonalFlankFireDirectionTo(this.mission.sherman.pos, target.pos);
        if (direction === null) {
          this.showGunAimWarning('attack.reason.cannotTurnDirection');
          return;
        }
        if (!this.canWeaponAimDirection(this.mission.sherman, direction)) {
          this.openTileInspectModal(target);
          return;
        }
        if (!targetVisible) {
          const aimDirection = this.fogTurretAimDirection(target.pos);
          if (aimDirection === null) {
            this.showGunAimWarning(
              this.canTurretReachDirection(this.mission.sherman, direction)
                ? 'attack.reason.turretAimRange'
                : 'attack.reason.turretTraverseSpeed',
            );
            return;
          }
          this.tryAimShermanTurretAtFogTile(aimDirection, target.pos, mgSel);
          return;
        }
        const unloadedGunRotation = gunSel
          && !isMainGunLoaded(this.mission.sherman, GameSession.gameMode === 'hardcore');
        const machineGunRotationOnly = mgSel && enemiesOnTile.length > 0 && !legalMGTarget;
        const mainGunRotationOnly = gunSel && visibleUnitsOnTile.length > 0 && !legalMainGunTarget;
        if (visibleUnitsOnTile.length === 0 || unloadedGunRotation || machineGunRotationOnly || mainGunRotationOnly) {
          if (!this.canTurretReachDirection(this.mission.sherman, direction)) {
            this.showGunAimWarning('attack.reason.turretTraverseSpeed');
            return;
          }
          this.tryAimShermanTurretAtFogTile(direction, target.pos, mgSel);
          return;
        }
      }
    }

    if (attackOrMisc && enemiesOnTile.length > 0) {
      // 叠格场景：机枪挑 canMGAttack 认可的步兵目标；主炮只打坦克类（含 truck）。按选中的武器骰挑同格中合适的目标
      if (mgSel && legalMGTarget) {
        this.tryMGAttack(legalMGTarget);
        return;
      }
      if (gunSel && legalMainGunTarget) {
        this.tryAttack(legalMainGunTarget);
        return;
      }
    }
    this.openTileInspectModal(target);
  }

  /**
   * 玩家主炮 / 机枪：可对可见合法目标开火，或在硬核迷雾中消耗所选行动骰旋转炮塔获得新视野。
   * 只有实际开炮要求并清空 loaded；单纯旋转炮塔不消耗炮弹。
   */
  private showGunAimWarning(key:
    | 'attack.reason.cannotTurnDirection'
    | 'attack.reason.turretAimRange'
    | 'attack.reason.turretTraverseSpeed'
    | 'attack.reason.turretDamaged') {
    if (!this.mission) return;
    const s = this.mission.sherman;
    this.spawnFloater(s.pos.q, s.pos.r, t(key),
      new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
  }

  private tryAimShermanTurretAtFogTile(direction: FireDirection, targetPos: Axial, useMG = false) {
    const dieIdx = useMG ? this.selectedMGDieIdx : this.selectedGunDieIdx;
    if (!this.mission || dieIdx < 0) return;
    const slot = this.phaseDice[dieIdx];
    if (!slot || slot.used) return;
    const doublesPartnerIdx = useMG ? -1 : this.selectedGunDoublesIdx;
    const clickedSidePreference = diagonalGunnerClickPreference(
      this.mission.map,
      this.mission.sherman,
      direction,
      targetPos,
      this.mission.smokeHexes,
    );
    this.hideTurretTargetOverlayForCommittedAction();
    this.startShermanTurretAimDirection(direction, () => {
      this.usePhaseDice(doublesPartnerIdx >= 0 ? [dieIdx, doublesPartnerIdx] : [dieIdx]);
      this.clearGunSelection();
      this.refreshPhaseUI();
      this.updateHUD();
      this.redraw();
      this.completePhaseDiceAction();
    }, undefined, false, clickedSidePreference ?? undefined);
    this.updateHUD();
    this.redraw();
  }

  private startShermanMachineGunAim(
    target: Unit,
    selection: TankMachineGunSelection,
    onDone: () => void,
  ) {
    if (!this.mission || this.mission.sherman.turretDamaged || !selection.rotateTurret) {
      onDone();
      return;
    }
    if (selection.weapon !== 'hull') {
      this.startShermanTurretAim(target, onDone);
      return;
    }
    // The hull MG remains available even when the turret cannot finish turning
    // to the forward target. Apply the normal per-action traverse, then fire.
    const sherman = this.mission.sherman;
    const requestedDirection = this.turretTargetDirection(sherman, target);
    const from = this.currentTurretFacingFor(sherman, requestedDirection);
    const traverse = limitTurretTraverse(from, requestedDirection, sherman.stats.turretTraverseSpeed);
    this.startShermanTurretAimDirection(traverse.direction, onDone);
  }

  private startShermanTurretAim(target: Unit, onDone: () => void) {
    if (!this.mission) {
      onDone();
      return;
    }
    const sherman = this.mission.sherman;
    const flankDirection = diagonalGunnerRuleDirectionForVisibleHex(
      this.mission.map, sherman, target.pos, this.currentWeather(), this.mission.smokeHexes,
    );
    const to = flankDirection ?? fireDirectionTo(sherman.pos, target.pos) ?? approximateFireDirection(sherman.pos, target.pos);
    const currentRuleFacing = (sherman.turretFacing ?? sherman.facing ?? to) as FireDirection;
    const preserveRuleFacing = flankDirection !== null && currentRuleFacing === flankDirection;
    const attackedSidePreference = flankDirection !== null
      ? diagonalGunnerClickPreference(
        this.mission.map,
        sherman,
        flankDirection,
        target.pos,
        this.mission.smokeHexes,
      )
      : null;
    this.startShermanTurretAimDirection(
      to,
      onDone,
      target.pos,
      preserveRuleFacing,
      attackedSidePreference ?? undefined,
    );
  }

  private startShermanTurretAimDirection(
    to: FireDirection,
    onDone: () => void,
    visualTarget?: Axial,
    preserveRuleFacing = false,
    diagonalSidePreference?: FireDirection,
  ) {
    if (!this.mission) {
      onDone();
      return;
    }
    const sherman = this.mission.sherman;
    const from = (this.shermanTurretFacing ?? sherman.turretFacing ?? sherman.facing ?? to) as FireDirection;
    const sameVisualTarget = visualTarget && sherman.turretVisualTarget
      && axialEquals(visualTarget, sherman.turretVisualTarget);
    // A halfway-ray attack can keep the same rules-facing direction while
    // switching to the other flank. Preserve the facing, but remember the
    // explicitly attacked side so closed-hatch gunner vision follows it.
    if (diagonalSidePreference !== undefined) {
      sherman.diagonalGunnerSidePreference = diagonalSidePreference;
    } else if (!preserveRuleFacing) {
      sherman.diagonalGunnerSidePreference = undefined;
    }
    if (from === to && ((!visualTarget && !sherman.turretVisualTarget) || sameVisualTarget)) {
      this.shermanTurretFacing = to;
      if (!preserveRuleFacing) sherman.turretFacing = to;
      sherman.turretVisualTarget = visualTarget ? { ...visualTarget } : undefined;
      this.redraw();
      onDone();
      return;
    }
    if (!preserveRuleFacing && from !== to) {
      sherman.previousTurretFacing = from;
    }
    if (!this.enemySupportsSplitTurret(sherman)) {
      if (!preserveRuleFacing) {
        this.shermanTurretFacing = to;
        sherman.turretFacing = to;
      }
      sherman.turretVisualTarget = visualTarget ? { ...visualTarget } : undefined;
      this.redraw();
      onDone();
      return;
    }
    this.beginTurretAimAnim({
      unit: sherman,
      from,
      to,
      t: 0,
      dur: Math.max(0.01, turretTraverseAnimationDuration(
        from, to, sherman.stats.turretTraverseSpeed,
      )),
      onDone,
      fromVisualTarget: sherman.turretVisualTarget ? { ...sherman.turretVisualTarget } : undefined,
      toVisualTarget: visualTarget ? { ...visualTarget } : undefined,
      preserveRuleFacing,
    });
    this.redraw();
  }

  private beginTurretAimAnim(anim: TurretAimAnim) {
    this.turretAimAnim = anim;
    if (!anim.suppressTurretSound && anim.from !== anim.to) startTurretTraverseSound();
  }

  private startEnemyMachineGunAim(
    actor: Unit,
    target: Unit,
    selection: TankMachineGunSelection,
    onDone: () => void,
  ) {
    if (actor.turretDamaged || !selection.rotateTurret) {
      onDone();
      return;
    }
    if (selection.weapon !== 'hull') {
      this.startEnemyTurretAim(actor, target, onDone);
      return;
    }
    const requestedDirection = this.turretTargetDirection(actor, target);
    const from = this.currentTurretFacingFor(actor, requestedDirection);
    const traverse = limitTurretTraverse(from, requestedDirection, actor.stats.turretTraverseSpeed);
    const originalSpeed = actor.stats.turretTraverseSpeed;
    // startEnemyTurretAim applies the same limit. Supplying the already-limited
    // direction through a temporary target would be brittle, so animate it directly.
    const to = traverse.direction;
    if (from === to) {
      onDone();
      return;
    }
    actor.previousTurretFacing = from;
    this.beginTurretAimAnim({
      unit: actor,
      from,
      to,
      t: 0,
      dur: Math.max(0.01, turretTraverseAnimationDuration(from, to, originalSpeed)),
      onDone,
      fromVisualTarget: actor.turretVisualTarget ? { ...actor.turretVisualTarget } : undefined,
      toVisualTarget: undefined,
    });
    this.redraw();
  }

  private startEnemyTurretAim(enemy: Unit, target: Unit, onDone: () => void) {
    if (enemy.stats.visionType !== 'turreted') {
      onDone();
      return;
    }
    const flankDirection = this.mission
      ? diagonalGunnerRuleDirectionForVisibleHex(
        this.mission.map, enemy, target.pos, this.currentWeather(), this.mission.smokeHexes,
      )
      : null;
    const requestedDirection = flankDirection ?? fireDirectionTo(enemy.pos, target.pos) ?? approximateFireDirection(enemy.pos, target.pos);
    const from = this.currentTurretFacingFor(enemy, requestedDirection);
    const traverse = limitTurretTraverse(from, requestedDirection, enemy.stats.turretTraverseSpeed);
    const to = traverse.direction;
    // Keep the quantized `to` direction for traverse/rules state, while the
    // rendered turret points at the exact attacked hex once it can reach it.
    const visualTarget = traverse.reached ? target.pos : undefined;
    const preserveRuleFacing = traverse.reached && flankDirection !== null && from === flankDirection;
    const sameVisualTarget = visualTarget && enemy.turretVisualTarget
      && axialEquals(visualTarget, enemy.turretVisualTarget);
    if (from === to && ((!visualTarget && !enemy.turretVisualTarget) || sameVisualTarget)) {
      this.enemyTurretFacing.set(enemy.id, to);
      if (!preserveRuleFacing) enemy.turretFacing = to;
      enemy.turretVisualTarget = visualTarget ? { ...visualTarget } : undefined;
      this.redraw();
      onDone();
      return;
    }
    if (!preserveRuleFacing && from !== to) enemy.previousTurretFacing = from;
    if (!preserveRuleFacing) enemy.diagonalGunnerSidePreference = undefined;
    if (!this.enemySupportsSplitTurret(enemy)) {
      if (!preserveRuleFacing) {
        this.enemyTurretFacing.set(enemy.id, to);
        enemy.turretFacing = to;
      }
      enemy.turretVisualTarget = visualTarget ? { ...visualTarget } : undefined;
      this.redraw();
      onDone();
      return;
    }
    this.beginTurretAimAnim({
      unit: enemy,
      from,
      to,
      t: 0,
      dur: Math.max(0.01, turretTraverseAnimationDuration(
        from, to, enemy.stats.turretTraverseSpeed,
      )),
      onDone,
      fromVisualTarget: enemy.turretVisualTarget ? { ...enemy.turretVisualTarget } : undefined,
      toVisualTarget: visualTarget ? { ...visualTarget } : undefined,
      preserveRuleFacing,
    });
    this.redraw();
  }

  private cancelPrecisionAimHold() {
    const callback = this.precisionAimHoldCallback;
    if (!callback) return;
    this.unschedule(callback);
    this.precisionAimHoldCallback = null;
  }

  /** Hold an aligned turret for 0.5s, then play the precision-shot firing cue. */
  private beginPrecisionAimHold(
    attacker: Unit,
    target: Unit,
    attackSound: string,
    report: AttackReport,
    onReady: (fireEffectPlayed: boolean) => void,
  ) {
    this.cancelPrecisionAimHold();
    const callback = () => {
      if (this.precisionAimHoldCallback !== callback) return;
      this.precisionAimHoldCallback = null;
      if (this.isUnitVisible(attacker)) {
        this.playAttackFireCue(attacker, target, false, attackSound, report);
        onReady(true);
      } else {
        // startDiceShow handles fog reveal plus firing cues for hidden attackers.
        onReady(false);
      }
    };
    this.precisionAimHoldCallback = callback;
    this.scheduleOnce(callback, PRECISION_AIM_HOLD_DURATION);
  }

  private applyMainGunAttackResult(target: Unit, report: AttackReport): void {
    // Dice presentation may have already applied the destroyed visual, so do
    // not use isControlledATGun here (it deliberately rejects destroyed guns).
    const hadATGunCrew = GameSession.gameMode === 'hardcore'
      && isAntiTankGunUnit(target)
      && target.atGunCrewAlive === true;
    applyAttack(target, report);
    if (hadATGunCrew && target.destroyed) {
      // AP destroys the gun body; the operator group survives without HE suppression.
      this.releaseATGunCrew(target);
    }
  }

  private rollHighExplosiveCollateralResults(
    attacker: Unit,
    target: Unit,
  ): HighExplosiveCollateralResult[] {
    if (!this.mission) return [];
    return this.allUnits()
      .filter(unit => unit !== target
        && !unit.destroyed
        // An attached crew is normally folded into its gun, except when that
        // gun is the HE target: the new rule gives the crew one extra,
        // independent infantry blast check beside the gun-body check.
        && (!isAttachedATGunCrew(unit)
          || (isAntiTankGunUnit(target) && unit.attachedToATGunId === target.id))
        && unit.kind !== 'officer'
        && isFootUnit(unit)
        && isSameSide(unit, target)
        && unit.pos.q === target.pos.q
        && unit.pos.r === target.pos.r)
      .map(infantry => ({
        target: infantry,
        report: rollHighExplosiveAttack({
          attacker,
          target: infantry,
          map: this.mission!.map,
          theater: this.mission!.data.theater,
          units: this.allUnits(),
          mainGunSuppressesInfantry: true,
          shellType: 'he',
        }, this.rng),
      }));
  }

  private applyHighExplosiveAttackResult(
    target: Unit,
    report: HighExplosiveReport,
    collateralResults: HighExplosiveCollateralResult[] = [],
  ): void {
    const hadATGunCrew = isAntiTankGunUnit(target) && target.atGunCrewAlive === true;
    applyHighExplosiveAttack(target, report);
    const gunDestroyed = hadATGunCrew && target.destroyed;
    if (hadATGunCrew && target.destroyed) {
      this.releaseATGunCrew(target);
    }

    // Every ordinary infantry unit in the targeted hex resolves its own HE
    // blast check, independently of whether the primary target was hit.
    for (const collateral of collateralResults) {
      const attachedCrewResult = hadATGunCrew
        && collateral.target.attachedToATGunId === target.id;
      if (attachedCrewResult && !gunDestroyed && collateral.report.outcome === 'destroyed') {
        this.killATGunCrew(target);
        continue;
      }
      applyHighExplosiveAttack(collateral.target, collateral.report);
      if (attachedCrewResult && !gunDestroyed && collateral.report.outcome === 'suppressed') {
        target.suppressed = true;
      }
    }
  }

  private applyMachineGunAttackResult(target: Unit, report: Pick<AttackReport, 'hit'>): void {
    const hadATGunCrew = GameSession.gameMode === 'hardcore'
      && isAntiTankGunUnit(target)
      && target.atGunCrewAlive === true;
    if (hadATGunCrew && report.hit) {
      // MG fire kills only the operators. Undo any generic early-destroy
      // presentation state and leave the physical gun intact and neutral.
      target.destroyed = false;
      this.destroyWreckVisualIds.delete(target.id);
      this.killATGunCrew(target);
      return;
    }
    applyMGAttack(target, report);
  }

  private tryAttack(target: Unit) {
    if (!this.mission) return;
    if (this.playerStep !== 'attack' && this.playerStep !== 'misc') return;
    if (this.selectedGunDieIdx < 0) return;
    const { map, sherman } = this.mission;
    const gunDieIdx = this.selectedGunDieIdx;
    const slot = this.phaseDice[gunDieIdx];
    if (!slot || slot.used) return;
    // 主炮禁瞄徒步类（步兵 / 军官）：引导玩家改用机枪骰；不消耗骰，避免误操作损失行动资源
    const loadedShell = GameSession.gameMode === 'hardcore'
      ? resolvedLoadedShell(sherman)
      : null;
    const suppressionAttack = isMainGunSuppressionAttack(
      sherman, target, GameSession.gameMode === 'hardcore', loadedShell,
    );
    if (isFootUnit(target) && !suppressionAttack) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('attack.reason.gunVsInfantry'),
        new Color(255, 200, 120, 255), { size: 22, dur: 1.0, rise: 26 });
      return;
    }
    if (!isMainGunLoaded(sherman, GameSession.gameMode === 'hardcore')) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('hud.unloaded'),
        new Color(255, 120, 120, 255), { size: 22, dur: 0.9, rise: 24 });
      return;
    }
    if (!this.canTurretReachDirection(sherman, this.turretTargetDirection(sherman, target))) {
      this.showGunAimWarning('attack.reason.turretTraverseSpeed');
      return;
    }
    const expandedTurretDirections = getGameModeConfig(GameSession.gameMode).expandedTurretDirections;
    const check = canAttack({
      attacker: sherman,
      target,
      map,
      smokeHexes: this.mission.smokeHexes,
      expandedTurretDirections,
      mainGunSuppressesInfantry: suppressionAttack,
      shellType: loadedShell ?? undefined,
      precisionFire: this.selectedGunHitThresholdModifier < 0,
    });
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
    this.hideTurretTargetOverlayForCommittedAction();

    // 先掷骰拿到确定结果，再让面板按这个结果播 2d6→1d6 两段动画；
    // 真正 applyAttack / 消耗骰子 / 推进胜负判定全部放到 onDone 里执行；
    // 玩家正常看完动画或提前确认关闭面板时，都会通过同一回调完成结算。
    if (loadedShell === 'he') {
      const ambushModifier = ambushHitThresholdModifier(sherman, GameSession.gameMode);
      const report = rollHighExplosiveAttack({
        attacker: sherman,
        target,
        map,
        protagonist: this.protagonistForAttackTarget(target),
        theater: this.mission.data.theater,
        units: this.allUnits(),
        smokeHexes: this.mission.smokeHexes,
        weather: this.currentWeather(),
        hitThresholdModifier: this.campaignMainGunHitThresholdModifier() + ambushModifier,
        hitThresholdModifiers: this.playerMainGunHitThresholdModifierDetails(),
        expandedTurretDirections,
        gunMantletArmor: getGameModeConfig(GameSession.gameMode).gunMantletArmor,
        mainGunSuppressesInfantry: true,
        shellType: 'he',
        hardcoreHeavyArtilleryRules: true,
        precisionFire: this.selectedGunHitThresholdModifier < 0,
      }, this.rng);
      const collateralResults = this.rollHighExplosiveCollateralResults(sherman, target);
      const doublesPartnerIdx = this.selectedGunDoublesIdx;
      const panelReport = this.highExplosivePanelReport(report);
      let attackApplied = false;
      const applyAndSyncHEAttack = (completeAction: boolean) => {
        if (!this.mission) return;
        if (!attackApplied) {
          attackApplied = true;
          this.applyHighExplosiveAttackResult(target, report, collateralResults);
          if (target.destroyed) this.registerImpactDestroyWreckVisual(target, sherman);
          this.usePhaseDice(doublesPartnerIdx >= 0 ? [gunDieIdx, doublesPartnerIdx] : [gunDieIdx]);
          sherman.loaded = false;
          sherman.loadedShell = null;
          this.clearGunSelection();
          this.outcome = this.computeOutcome();
          if (this.outcome !== 'ongoing') this.updateOutcomeOverlay();
          const resultKey = !report.hit ? 'dice.panel.outcomeMiss'
            : report.outcome === 'destroyed' ? 'dmg.outcome.destroyed'
              : report.outcome === 'paralyzed' ? 'dmg.outcome.paralyzed'
                : report.outcome === 'fire' ? 'dmg.outcome.fire'
                : report.outcome === 'fire_suppressed' ? 'dice.panel.heFireSuppressed'
                  : report.outcome === 'suppressed' ? 'floater.suppressed' : 'dmg.outcome.none';
          const effectNeed = report.paralyzeThreshold !== undefined
            ? `${report.fireThreshold ?? '-'}/${report.paralyzeThreshold}`
            : report.fireThreshold !== undefined
              ? `${report.destroyThreshold ?? '-'}/${report.fireThreshold}`
            : report.effectThreshold ?? '-';
          this.battleLogI18n('battleLog.combat.heResult', {
            actor: t('actor.player'),
            hitRoll: report.automaticHit ? t('dice.rule.heAutomaticHit') : report.roll,
            hitNeed: report.automaticHit ? '-' : report.threshold,
            effectRoll: report.effectRoll ?? '-',
            effectNeed,
            result: t(resultKey),
          });
          this.sendPvpActionResult('main_gun_he', {
            type: 'main_gun_he',
            attackerId: sherman.id,
            targetId: target.id,
            heReport: report,
            collateralResults: collateralResults.map(collateral => ({
              targetId: collateral.target.id,
              report: collateral.report,
            })),
          });
          this.spawnFloater(target.pos.q, target.pos.r, t(resultKey),
            report.outcome === 'none' || !report.hit ? new Color(210, 210, 210, 255) : new Color(255, 204, 72, 255),
            { size: 32, dur: 1.1, rise: 42 });
          this.refreshPhaseUI();
          this.updateHUD();
          this.redraw();
          this.refreshStatusPanel();
        }
        if (completeAction) this.completePhaseDiceAction();
      };
      this.startShermanTurretAim(target, () => {
        if (!this.mission || target.destroyed) return;
        markAmbushAction(sherman);
        markAmbushTargeted(target);
        this.startDiceShow(panelReport, t('actor.player'), unitDisplayName(target.kind), () => {
          applyAndSyncHEAttack(true);
        }, {
          attacker: sherman,
          target,
          highExplosiveReport: report,
          highExplosiveCollateral: collateralResults,
          onHold: () => applyAndSyncHEAttack(false),
        });
      });
      this.updateHUD();
      this.redraw();
      return;
    }

    const ambushModifier = ambushHitThresholdModifier(sherman, GameSession.gameMode);
    if (ambushModifier < 0) {
      this.spawnFloater(sherman.pos.q, sherman.pos.r, t('floater.ambush'),
        new Color(255, 220, 120, 255), { size: 32, dur: 1.0, rise: 44 });
    }
    const precisionFire = this.selectedGunHitThresholdModifier < 0;
    const report = rollAttack({
      attacker: sherman,
      target,
      map,
      protagonist: this.protagonistForAttackTarget(target),
      theater: this.mission.data.theater,
      units: this.allUnits(),
      smokeHexes: this.mission.smokeHexes,
      weather: this.currentWeather(),
      hitThresholdModifier: this.campaignMainGunHitThresholdModifier() + ambushModifier,
      hitThresholdModifiers: this.playerMainGunHitThresholdModifierDetails(),
      effectiveRangePenetration: getGameModeConfig(GameSession.gameMode).effectiveRangePenetration,
      overpenetration: getGameModeConfig(GameSession.gameMode).overpenetration,
      expandedTurretDirections,
      directionalDamageCheck: getGameModeConfig(GameSession.gameMode).directionalDamageCheck,
      gunMantletArmor: getGameModeConfig(GameSession.gameMode).gunMantletArmor,
      unitDamageTargetClass: getGameModeConfig(GameSession.gameMode).unitDamageTargetClass,
      shellType: loadedShell ?? undefined,
      hardcoreHeavyArtilleryRules: GameSession.gameMode === 'hardcore',
      precisionFire,
    }, this.rng);
    // 瞄准与开火动画期间保留主炮骰的选中态；进入结果展示后再统一消耗。
    // §3.6 B 列对子（炮手主炮射击）：开火前记住 partner idx，结算时一并消耗；
    // 若这是最后的未使用骰子，也要等 DiceShow 的 onDone 才推进阶段。
    const doublesPartnerIdx = this.selectedGunDoublesIdx;
    let attackApplied = false;
    const applyAndSyncAttack = (completeAction: boolean) => {
      if (!this.mission) return;
      if (!attackApplied) {
        attackApplied = true;
        this.applyMainGunAttackResult(target, report);
        if (target.destroyed) this.registerImpactDestroyWreckVisual(target, sherman);
        this.usePhaseDice(doublesPartnerIdx >= 0 ? [gunDieIdx, doublesPartnerIdx] : [gunDieIdx]);
        sherman.loaded = false;
        sherman.loadedShell = null;
        this.clearGunSelection();
        this.presentAttackResult(t('actor.player'), report, sherman, target);
        this.sendPvpActionResult('main_gun', {
          type: 'main_gun',
          attackerId: sherman.id,
          targetId: target.id,
          report,
          attackSound: sherman.stats.attackSound,
        });
        this.refreshPhaseUI();
        this.updateHUD();
      }
      if (completeAction) this.completePhaseDiceAction();
    };
    const showDice = (fireEffectPlayed = false) => {
      this.startDiceShow(report, t('actor.player'), unitDisplayName(target.kind), () => {
        applyAndSyncAttack(true);
      }, {
        attackSound: sherman.stats.attackSound,
        attacker: sherman,
        target,
        fireEffectPlayed,
        onHold: () => applyAndSyncAttack(false),
      });
    };
    this.startShermanTurretAim(target, () => {
      // 旋转期间目标头顶仍展示这次已锁定的伏击命中需求。
      // 到炮塔完成瞄准、即将开火时才消耗伏击资格，使其只影响下次预览。
      markAmbushAction(sherman);
      markAmbushTargeted(target);
      if (precisionFire) {
        this.beginPrecisionAimHold(sherman, target, sherman.stats.attackSound, report, showDice);
      } else {
        showDice();
      }
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
  private tryEnemyAttack(
    enemy: Unit,
    opts: { adjacentOnly?: boolean; selectedTarget?: Unit } = {},
  ): boolean {
    if (!this.mission) return false;
    if (enemy.destroyed) return false;
    if (this.outcome !== 'ongoing') return false; // 谢尔曼已死，无需再补刀
    const { map } = this.mission;
    // Non-player tanks use their MG against adjacent infantry before considering
    // a main-gun shot. MG range is one, so this also satisfies shoot_adjacent.
    if (isTankUnit(enemy) && this.selectAIMGTarget(enemy, false)) {
      return this.tryAIMGAttack(enemy);
    }
    const target = opts.selectedTarget
      ?? this.selectAIShootTarget(enemy, true, !!opts.adjacentOnly);
    if (!target) {
      if (!opts.adjacentOnly && getGameModeConfig(GameSession.gameMode).aiMainGunFallbackToMG) {
        return this.tryAIMGAttack(enemy);
      }
      return false;
    }

    // 炮塔只能向本车或友军无线电已经发现的合法目标旋转；目标在视野外时
    // 不允许用其真实位置进行“侦察式”炮塔转向。
    const targetVisible = opts.selectedTarget !== undefined
      || this.isHardcoreInfantryActor(enemy)
      || isUnitInVision(
        map,
        enemy,
        target,
        this.aiFriendliesFor(enemy),
        getGameModeConfig(GameSession.gameMode).radioVisionSharing,
        this.currentWeather(),
        this.mission.smokeHexes,
      );
    if (!targetVisible) {
      if (!opts.adjacentOnly && getGameModeConfig(GameSession.gameMode).aiMainGunFallbackToMG) {
        return this.tryAIMGAttack(enemy);
      }
      return false;
    }

    if (!this.isHardcoreInfantryActor(enemy) && enemy.stats.visionType === 'turreted') {
      const requestedDirection = this.turretTargetDirection(enemy, target);
      const from = this.currentTurretFacingFor(enemy, requestedDirection);
      const traverse = limitTurretTraverse(from, requestedDirection, enemy.stats.turretTraverseSpeed);
      if (!traverse.reached) {
        this.battleLog(
          `[AI] ${unitDisplayName(enemy.kind)} 炮塔转向受限：${from} -> ${traverse.direction}，目标方向 ${requestedDirection}`,
        );
        this.startEnemyTurretAim(enemy, target, () => {
          if (this.outcome === 'ongoing' && (this.phase === 'ally' || this.phase === 'enemy')) this.runNextEnemyStep();
        });
        return true;
      }
    }

    const splitTurretReady = this.enemySupportsSplitTurret(enemy);
    if (splitTurretReady) {
      if (!this.enemyTurretFacing.has(enemy.id) && enemy.facing !== null) {
        this.enemyTurretFacing.set(enemy.id, (enemy.turretFacing ?? enemy.facing) as FireDirection);
      }
    }

    const automaticWeapon = GameSession.gameMode === 'hardcore' && isTankUnit(enemy)
      ? nonPlayerTankWeaponForTarget(target, hexDistance(enemy.pos, target.pos))
      : 'ap';
    if (automaticWeapon === 'mg') return this.tryAIMGAttack(enemy, target);

    if (automaticWeapon === 'he') {
      const heContext = {
        attacker: enemy,
        target,
        map,
        protagonist: this.protagonistForAttackTarget(target),
        theater: this.mission.data.theater,
        units: this.allUnits(),
        smokeHexes: this.mission.smokeHexes,
        weather: this.currentWeather(),
        hitThresholdModifier: ambushHitThresholdModifier(enemy, GameSession.gameMode),
        hitThresholdModifiers: ambushHitThresholdModifierDetails(enemy, GameSession.gameMode),
        expandedTurretDirections: getGameModeConfig(GameSession.gameMode).expandedTurretDirections,
        gunMantletArmor: getGameModeConfig(GameSession.gameMode).gunMantletArmor,
        mainGunSuppressesInfantry: true,
        shellType: 'he' as const,
        hardcoreHeavyArtilleryRules: true,
      };
      const report = rollHighExplosiveAttack(heContext, this.rng);
      const collateralResults = this.rollHighExplosiveCollateralResults(enemy, target);
      const panelReport = this.highExplosivePanelReport(report);
      markAmbushAction(enemy);
      markAmbushTargeted(target);
      const enemyActor = enemy.sideId === 'enemy'
        ? t('actor.enemyPrefix', { name: unitDisplayName(enemy.kind) })
        : t('actor.allyPrefix', { name: unitDisplayName(enemy.kind) });
      const targetLabel = target === this.mission.sherman
        ? unitDisplayName(target.kind)
        : target.sideId === 'enemy'
          ? t('actor.enemyPrefix', { name: unitDisplayName(target.kind) })
          : t('actor.allyPrefix', { name: unitDisplayName(target.kind) });
      let attackApplied = false;
      const applyAndPresentHEAttack = () => {
        if (attackApplied) return;
        attackApplied = true;
        this.applyHighExplosiveAttackResult(target, report, collateralResults);
        if (target.destroyed) this.registerImpactDestroyWreckVisual(target, enemy);
        this.outcome = this.computeOutcome();
        if (this.outcome !== 'ongoing') {
          this.updateOutcomeOverlay();
          this.clearActiveActingUnit(enemy);
        }
        const resultKey = !report.hit ? 'dice.panel.outcomeMiss'
          : report.outcome === 'destroyed' ? 'dmg.outcome.destroyed'
            : report.outcome === 'paralyzed' ? 'dmg.outcome.paralyzed'
              : report.outcome === 'fire' ? 'dmg.outcome.fire'
              : report.outcome === 'fire_suppressed' ? 'dice.panel.heFireSuppressed'
                : report.outcome === 'suppressed' ? 'floater.suppressed' : 'dmg.outcome.none';
        const effectNeed = report.paralyzeThreshold !== undefined
          ? `${report.fireThreshold ?? '-'}/${report.paralyzeThreshold}`
          : report.fireThreshold !== undefined
            ? `${report.destroyThreshold ?? '-'}/${report.fireThreshold}`
          : report.effectThreshold ?? '-';
        this.battleLogI18n('battleLog.combat.heResult', {
          actor: unitDisplayName(enemy.kind),
          hitRoll: report.automaticHit ? t('dice.rule.heAutomaticHit') : report.roll,
          hitNeed: report.automaticHit ? '-' : report.threshold,
          effectRoll: report.effectRoll ?? '-',
          effectNeed,
          result: t(resultKey),
        });
        this.spawnFloater(target.pos.q, target.pos.r, t(resultKey),
          report.outcome === 'none' || !report.hit ? new Color(210, 210, 210, 255) : new Color(255, 204, 72, 255),
          { size: 32, dur: 1.1, rise: 42 });
        this.updateHUD();
        this.redraw();
        this.refreshStatusPanel();
      };
      const fire = () => {
        this.startDiceShow(panelReport, enemyActor, targetLabel, () => {
          applyAndPresentHEAttack();
          if (this.outcome === 'ongoing' && (this.phase === 'ally' || this.phase === 'enemy')) {
            this.enemyDiceHighlightIdx = -1;
            this.refreshEnemyDiceTray();
            this.runNextEnemyStep();
          }
        }, {
          attacker: enemy,
          target,
          highExplosiveReport: report,
          highExplosiveCollateral: collateralResults,
          onHold: applyAndPresentHEAttack,
        });
      };
      if (splitTurretReady) this.startEnemyTurretAim(enemy, target, fire);
      else fire();
      return true;
    }

    // 保留本车 AI 行动骰托盘；掷骰面板打开时会挂到 DiceShow 遮罩之上（见 liftEnemyDiceTrayIntoDiceShowIfNeeded）

    const attackCtx = {
      attacker: enemy,
      target,
      map,
      protagonist: this.protagonistForAttackTarget(target),
      theater: this.mission.data.theater,
      units: this.allUnits(),
      smokeHexes: this.mission.smokeHexes,
      weather: this.currentWeather(),
      hitThresholdModifier: ambushHitThresholdModifier(enemy, GameSession.gameMode),
      hitThresholdModifiers: ambushHitThresholdModifierDetails(enemy, GameSession.gameMode),
      effectiveRangePenetration: getGameModeConfig(GameSession.gameMode).effectiveRangePenetration,
      overpenetration: getGameModeConfig(GameSession.gameMode).overpenetration,
      sameHexInfantryTankAttack: GameSession.gameMode === 'hardcore',
      expandedTurretDirections: getGameModeConfig(GameSession.gameMode).expandedTurretDirections,
      directionalDamageCheck: getGameModeConfig(GameSession.gameMode).directionalDamageCheck,
      gunMantletArmor: getGameModeConfig(GameSession.gameMode).gunMantletArmor,
      unitDamageTargetClass: getGameModeConfig(GameSession.gameMode).unitDamageTargetClass,
    };
    const precisionPartnerIdx = !opts.adjacentOnly
      && isSplitTankKind(enemy.kind)
      && getGameModeConfig(GameSession.gameMode).precisionFire
      && probHit2d6(hitThreshold(attackCtx)) < 0.5
      ? this.findUnusedMatchingEnemyDie(this.enemyDiceHighlightIdx)
      : -1;
    const precisionFire = precisionPartnerIdx >= 0;
    if (precisionFire) {
      this.enemyDiceResolvedActions[precisionPartnerIdx] = 'shoot';
      this.enemyDiceUsed[precisionPartnerIdx] = true;
      this.refreshEnemyDiceTray();
    }
    const ambushModifier = attackCtx.hitThresholdModifier;
    markAmbushAction(enemy);
    markAmbushTargeted(target);
    if (ambushModifier < 0) {
      this.spawnFloater(enemy.pos.q, enemy.pos.r, t('floater.ambush'),
        new Color(255, 220, 120, 255), { size: 32, dur: 1.0, rise: 44 });
    }
    const report = rollAttack({
      ...attackCtx,
      hitThresholdModifier: attackCtx.hitThresholdModifier + (precisionFire ? -2 : 0),
      hitThresholdModifiers: [
        ...attackCtx.hitThresholdModifiers,
        ...(precisionFire ? [{ labelKey: 'dice.rule.precisionFire', value: -2 }] : []),
      ],
      hardcoreHeavyArtilleryRules: GameSession.gameMode === 'hardcore',
      precisionFire,
    }, this.rng);
    const infantryVsInfantry = isFootUnit(enemy) && isFootUnit(target);
    const infantryVsATGunCrew = isFootUnit(enemy) && isControlledATGun(target);
    const enemyActor = enemy.sideId === 'enemy'
      ? t('actor.enemyPrefix', { name: unitDisplayName(enemy.kind) })
      : t('actor.allyPrefix', { name: unitDisplayName(enemy.kind) });
    const targetLabel = target === this.mission.sherman
      ? unitDisplayName(target.kind)
      : target.sideId === 'enemy'
        ? t('actor.enemyPrefix', { name: unitDisplayName(target.kind) })
        : t('actor.allyPrefix', { name: unitDisplayName(target.kind) });
    if (precisionFire) {
      this.battleLogI18n('battleLog.attack.precisionAI', {
        actor: enemyActor,
        pip: this.enemyDice[this.enemyDiceHighlightIdx],
        need: report.threshold,
      });
    }
    let attackApplied = false;
    const applyAndPresentAttack = () => {
      if (attackApplied || !this.mission) return;
      attackApplied = true;
      if (infantryVsATGunCrew) this.applyMachineGunAttackResult(target, report);
      else this.applyMainGunAttackResult(target, report);
      if (target.destroyed) this.registerImpactDestroyWreckVisual(target, enemy);
      this.presentAttackResult(enemyActor, report, enemy, target);
      if (this.outcome !== 'ongoing') this.clearActiveActingUnit(enemy);
      this.updateHUD();
      this.redraw();
      this.refreshStatusPanel();
    };
    const showDice = (fireEffectPlayed = false) => this.startDiceShow(report, enemyActor, targetLabel, () => {
      applyAndPresentAttack();
      // 本骰打完：回到当前敌坦的下一颗骰（DiceShow 里已经消耗掉的那颗之外）
      if (this.outcome === 'ongoing' && (this.phase === 'ally' || this.phase === 'enemy')) {
        // 重新浮出托盘（可能还剩骰子），再继续调度
        if (this.enemyDiceUsed.some(u => !u)) {
          const current = this.enemyOrder[this.enemyIndex];
          if (current && !current.destroyed) this.buildEnemyDiceTray(current, { playSort: false });
        }
        this.runNextEnemyStep();
      }
    }, {
      mg: infantryVsInfantry || infantryVsATGunCrew,
      attackSound: enemy.stats.attackSound,
      attacker: enemy,
      target,
      fireEffectPlayed,
      onHold: applyAndPresentAttack,
    });
    const afterTurretAim = () => {
      if (precisionFire) {
        this.beginPrecisionAimHold(enemy, target, enemy.stats.attackSound, report, showDice);
      } else {
        showDice();
      }
    };
    if (splitTurretReady) {
      // Fog hides the turret animation, but the attack still uses the same timing path.
      this.startEnemyTurretAim(enemy, target, afterTurretAim);
    } else {
      afterTurretAim();
    }
    return true;
  }

  // ---------- 攻击掷骰动画面板 ----------

  /**
   * 启动攻击掷骰动画。调用方应已经 rollAttack 完拿到 report（保证结果不会在动画中变化），
   * 但 *不要* 自己 applyAttack —— onHold 在最终结果揭示时写入伤害并刷新目标，
   * onDone 只负责兜底结算与推进调度。玩家可随时确认并跳过剩余动画。
   *
   * 期间所有玩家与敌方新指令被屏蔽（见 isBusy()）；关闭骰子弹窗。
   * 敌方主炮开火时：敌方 AI 骰子托盘挂到 DiceShow 内、遮罩之上，与命中/穿甲结果同屏可见。
   */
  private startDiceShow(
    report: AttackReport,
    attackerLabel: string,
    targetLabel: string,
    onDone: () => void,
    opts: {
      mg?: boolean;
      keepTurnEndPanel?: boolean;
      attackSound?: string;
      attacker?: Unit | null;
      target?: Unit | null;
      fireEffectPlayed?: boolean;
      onHold?: () => void;
      requireManualClose?: boolean;
      highExplosiveReport?: HighExplosiveReport;
      highExplosiveCollateral?: HighExplosiveCollateralResult[];
    } = {},
  ) {
    // 已有一个面板在播（理论上不该走到这里，守一下）：先强结束旧的，避免叠加
    if (this.diceShow) this.finalizeDiceShow(/*skip=*/true);
    if (!opts.keepTurnEndPanel) this.destroyTurnEndEventUI();
    this.destroyFireCheckEventUI();
    this.closeDiePopover();

    const mg = !!opts.mg;
    const attackerVisible = !opts.attacker || this.isUnitOutsideFog(opts.attacker);
    const targetVisible = !opts.target || this.isUnitOutsideFog(opts.target);
    if (!attackerVisible || !targetVisible) {
      const revealKey = opts.attacker && !attackerVisible
        ? HexMap.keyOf(opts.attacker.pos)
        : null;
      if (revealKey) {
        this.transientFogRevealKeys.add(revealKey);
        this.redraw();
      }
      if (!opts.fireEffectPlayed) {
        if (opts.highExplosiveReport && opts.attacker && opts.target) {
          this.playHighExplosiveSuppressionCue(opts.attacker, opts.target, opts.highExplosiveReport);
        } else {
          this.playAttackFireCue(
            opts.attacker,
            opts.target ?? null,
            mg,
            opts.attackSound ?? '',
            report,
            mg ? undefined : () => {
              this.applyAttackDestroyedVisualAtImpact(report, opts.attacker ?? null, opts.target ?? null);
            },
          );
        }
      }
      this.scheduleOnce(() => {
        if (revealKey) {
          this.transientFogRevealKeys.delete(revealKey);
          this.redraw();
        }
        onDone();
      }, FOG_ATTACK_REVEAL_DURATION);
      return;
    }
    const panel = this.buildDiceShowPanel(
      report,
      attackerLabel,
      targetLabel,
      mg,
      opts.highExplosiveReport,
      opts.highExplosiveCollateral,
    );
    this.liftEnemyDiceTrayIntoDiceShowIfNeeded(panel.root);
    this.diceShow = {
      stage: 'hit-roll',
      t: 0,
      report,
      highExplosiveReport: opts.highExplosiveReport ?? null,
      highExplosiveCollateral: opts.highExplosiveCollateral ?? [],
      attackerLabel,
      targetLabel,
      mg,
      attackSound: opts.attackSound ?? '',
      fireEffectPlayed: opts.fireEffectPlayed === true,
      attacker: opts.attacker ?? null,
      target: opts.target ?? null,
      targetCommanderExposed: opts.target?.hatchOpen === true && opts.target.crew?.commander !== false,
      onDone,
      onHold: opts.onHold ?? null,
      requireManualClose: !!opts.requireManualClose,
      finalized: false,
      holdNotified: false,
      earlyDestroyedVisualApplied: false,
      panelRoot: panel.root,
      hitDieLabels: panel.hitDieLabels,
      hitSumLabel: panel.hitSumLabel,
      hitNeedLabel: panel.hitNeedLabel,
      hitVerdictLabel: panel.hitVerdictLabel,
      hitSpecialLabel: panel.hitSpecialLabel,
      penDieLabels: panel.penDieLabels,
      penNeedLabel: panel.penNeedLabel,
      penVerdictLabel: panel.penVerdictLabel,
      highExplosiveCollateralRows: panel.highExplosiveCollateralRows,
      dmgDieLabel: panel.dmgDieLabel,
      dmgTitleLabel: panel.dmgTitleLabel,
      dmgEffectLabel: panel.dmgEffectLabel,
      crewDieLabel: panel.crewDieLabel,
      crewTitleLabel: panel.crewTitleLabel,
      crewEffectLabel: panel.crewEffectLabel,
      outcomeLabel: panel.outcomeLabel,
      confirmButton: panel.confirmButton,
      ruleModalRoot: null,
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
    highExplosiveReport?: HighExplosiveReport,
    highExplosiveCollateral: HighExplosiveCollateralResult[] = [],
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
    highExplosiveCollateralRows: Array<{
      dieLabels: Label[];
      needLabel: Label;
      verdictLabel: Label;
    }>;
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
    const heHasEffectRow = !!highExplosiveReport?.effectDice?.length;
    const automaticHit = report.automaticHit === true;
    const shootingPortDirectDestroy = report.shootingPortHit === true;
    const hasHECollateral = highExplosiveCollateral.length > 0;
    const compactPanel = !hasHECollateral
      && (mg
        || shootingPortDirectDestroy
        || (!!highExplosiveReport && (automaticHit || !heHasEffectRow)));
    // Keep the lowest die row visually separate from the confirmation button.
    // These heights provide at least 36 px of clear space in every DiceShow
    // layout (44 px for the compact MG layout and 48 px with a crew row).
    const basePanelH = compactPanel ? 280 : needsCrewRow ? 520 : 420;
    // A collateral infantry result needs its own caption and die row. Reserve
    // enough vertical space so neither touches the primary tank dice.
    const PANEL_H = Math.min(680, basePanelH + highExplosiveCollateral.length * 116);

    // 半透明全屏遮罩 + 面板：都是 Graphics，不需要 Sprite 资源
    const root = new Node('DiceShow');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(1280, 720);
    root.setPosition(0, 0, 0);
    this.node.addChild(root);

    // 背景遮罩（占满 Canvas）
    const { node: backdrop } = createAdaptiveFullscreenMask(
      root,
      'Backdrop',
      DICE_BACKDROP,
      UI_ROOT_SCALE,
    );
    // 消耗点击事件，让遮罩背后的地图 / 骰子托盘都不会被触发
    backdrop.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; }, this);

    // 面板本体
    const panel = new Node('Panel');
    panel.layer = this.node.layer;
    panel.addComponent(UITransform).setContentSize(PANEL_W, PANEL_H);
    panel.setPosition(0, 36, 0);
    const pg = panel.addComponent(Graphics);
    drawDicePopupPanel(pg, PANEL_W, PANEL_H, DICE_PANEL_BG, DICE_PANEL_BORDER);
    root.addChild(panel);

    // 同类型信息统一字号：攻击标题 / 判定条件 / 判定结果。
    const TITLE_FONT_SIZE = 26;
    const CHECK_FONT_SIZE = 18;
    const VERDICT_FONT_SIZE = 28;

    // 标题
    const title = this.makeCenteredLabel(panel, `${attackerLabel} → ${targetLabel}`,
      0, PANEL_H / 2 - 34, PANEL_W - 40, 34, TITLE_FONT_SIZE, HUD_TEXT_COLOR);

    // 命中需求：机枪使用专用语言键，主炮走原来的命中阈值行
    const hitNeedText = mg
      ? t('dice.panel.mgHitNeed', { n: report.threshold })
      : report.shootingPortHit !== undefined
        ? t('dice.panel.shootingPortHitNeed', { n: report.threshold })
        : t('dice.panel.hitNeed', { n: report.threshold });

    // 三/四行使用固定列：骰子列 / 数值或需求列 / 结果列，避免各行文字左右漂移。
    const ATTACK_RESULT_DIE_SCALE = 0.75;
    const DIE_SIZE = 68 * ATTACK_RESULT_DIE_SCALE, DIE_GAP = 24, ROW_GAP = 74;
    const hitDiceY = PANEL_H / 2 - 118;
    const penDiceY = automaticHit ? hitDiceY : hitDiceY - ROW_GAP;
    const dmgDiceY = penDiceY - ROW_GAP;
    const crewDiceY = dmgDiceY - ROW_GAP;
    const DIE_COL_1 = -126;
    const DIE_COL_2 = DIE_COL_1 + DIE_SIZE + DIE_GAP;
    const MID_COL_X = 52;
    const RESULT_COL_X = 190;
    const MID_COL_W = 96;
    const RESULT_COL_W = 180;

    const hitDiceCount = Math.max(1, Math.min(2, report.hitDiceCount ?? 2));

    // 命中骰：主炮 2d6；机枪 1d6（正面 -1 已计入命中所需）。
    const d1 = this.makeDieSquare(panel, DIE_COL_1, hitDiceY, DIE_SIZE);
    const d2 = this.makeDieSquare(panel, DIE_COL_2, hitDiceY, DIE_SIZE);
    if (hitDiceCount === 1) {
      d1.node.parent!.setPosition(DIE_COL_1 + (DIE_SIZE + DIE_GAP) / 2, hitDiceY, 0);
      d2.node.parent!.active = false;
    }

    // "= N"
    const hitSum = this.makeCenteredLabel(panel, '',
      MID_COL_X, hitDiceY, MID_COL_W, 40, 30, DICE_INFO_TEXT);
    const hitNeed = this.makeCenteredLabel(panel, hitNeedText,
      MID_COL_X, hitDiceY, MID_COL_W, 28, CHECK_FONT_SIZE, DICE_INFO_TEXT);

    // 命中判定文字
    const hitVerdictY = hasHitDoublesCommanderKill ? hitDiceY + 15 : hitDiceY;
    const hitVerdict = this.makeCenteredLabel(panel, '',
      RESULT_COL_X, hitVerdictY, RESULT_COL_W, 34, VERDICT_FONT_SIZE, DICE_OK_TEXT);
    const hitSpecial = hasHitDoublesCommanderKill
      ? this.makeCenteredLabel(panel, '',
        RESULT_COL_X, hitDiceY - 18, RESULT_COL_W, 30, 24, new Color(255, 90, 90, 255))
      : null;
    if (hitSpecial) hitSpecial.node.active = false;
    if (!automaticHit) {
      this.makeDiceRuleButton(panel, -238, hitDiceY, () => this.openDiceRuleModal('hit'));
    } else {
      d1.node.parent!.active = false;
      d2.node.parent!.active = false;
      hitSum.node.active = false;
      hitNeed.node.active = false;
      hitVerdict.node.active = false;
    }

    // 2d6 穿甲 / 伤害 / 阵亡检定三行只在主炮模式需要；机枪扫射只有命中这一段。
    const penDice: Label[] = [];
    let penNeed: Label | null = null;
    let penVerdict: Label | null = null;
    const highExplosiveCollateralRows: Array<{
      dieLabels: Label[];
      needLabel: Label;
      verdictLabel: Label;
    }> = [];
    let dmgDie: Label | null = null;
    let dmgTitle: Label | null = null;
    let dmgEffect: Label | null = null;
    let crewDie: Label | null = null;
    let crewTitle: Label | null = null;
    let crewEffect: Label | null = null;
    if (!mg && !shootingPortDirectDestroy && (!highExplosiveReport || heHasEffectRow)) {
      // 2d6 穿甲骰 + 需求 + 判定
      const penDiceCount = Math.max(1, report.penDice?.length ?? 1);
      const penStartX = penDiceCount >= 2 ? DIE_COL_1 : DIE_COL_1 + (DIE_SIZE + DIE_GAP) / 2;
      for (let i = 0; i < penDiceCount; i++) {
        penDice.push(this.makeDieSquare(panel, penStartX + i * (DIE_SIZE + DIE_GAP), penDiceY, DIE_SIZE));
      }
      // AP 的击穿阈值与命中阈值、伤害检定标题一样，在面板创建时就完成排版。
      // 之前这里先创建空 Label、骰子落定时才写入文字，首次生成字形会偶发晚一帧。
      const initialPenNeedText = !highExplosiveReport && report.penThreshold !== undefined
        ? report.penThreshold <= 0
          ? t('dice.panel.penMustPen')
          : t('dice.panel.penetrateNeed', { n: report.penThreshold })
        : '';
      penNeed = this.makeCenteredLabel(panel, initialPenNeedText,
        MID_COL_X, penDiceY, MID_COL_W, 40, CHECK_FONT_SIZE, DICE_INFO_TEXT);
      penVerdict = this.makeCenteredLabel(panel, '',
        RESULT_COL_X, penDiceY, RESULT_COL_W, 40, VERDICT_FONT_SIZE, DICE_OK_TEXT);
      if (highExplosiveReport) {
        this.makeDiceRuleButton(panel, -238, penDiceY, () => this.openDiceRuleModal('he'));
      } else {
        this.makeDiceRuleButton(panel, -238, penDiceY, () => this.openDiceRuleModal('pen'));
      }

      // 1d6 伤害骰 + "伤害检定" + 效果文字
      if (needsDamageRow) {
        dmgDie = this.makeDieSquare(panel, DIE_COL_1, dmgDiceY, DIE_SIZE);
        dmgTitle = this.makeCenteredLabel(panel, t('dice.panel.dmgTitle'),
          MID_COL_X, dmgDiceY, MID_COL_W, 28, 18, DICE_INFO_TEXT);
        dmgEffect = this.makeCenteredLabel(panel, '',
          RESULT_COL_X, dmgDiceY, RESULT_COL_W, 58, 24, DICE_OUTCOME_HIT);
        dmgEffect.lineHeight = 28;
        this.makeDiceRuleButton(panel, -238, dmgDiceY, () => this.openDiceRuleModal('damage'));
      }

      // 可选：1d6 阵亡检定骰（仅谢尔曼被击穿 + 伤害表 d6=2 时才会出现）
      if (needsCrewRow) {
        crewDie = this.makeDieSquare(panel, DIE_COL_1, crewDiceY, DIE_SIZE);
        const resolvedCrewTitle = report.stagedCrewCheck?.slot !== null
          && report.stagedCrewCheck?.slot !== undefined
          ? t('crew.death.kia', { role: crewRoleName(report.stagedCrewCheck.slot) })
          : t('dice.panel.crewTitle');
        crewTitle = this.makeCenteredLabel(panel, resolvedCrewTitle,
          MID_COL_X, crewDiceY, MID_COL_W, 28, 18, DICE_INFO_TEXT);
        crewEffect = this.makeCenteredLabel(panel, '',
          RESULT_COL_X, crewDiceY, RESULT_COL_W, 40, 28, DICE_OUTCOME_CREW);
        this.makeDiceRuleButton(panel, -238, crewDiceY, () => this.openDiceRuleModal('crew'));
      }

      // 主炮三段检定同屏滚动；未命中 / 未击穿时，伤害行在揭示时显示"无效"。
    }

    if (!mg && highExplosiveReport) {
      const collateralAnchorY = heHasEffectRow ? penDiceY : hitDiceY;
      for (let i = 0; i < highExplosiveCollateral.length; i++) {
        const collateral = highExplosiveCollateral[i];
        const rowY = collateralAnchorY - 126 - i * 110;
        this.makeCenteredLabel(
          panel,
          `${attackerLabel} → ${unitDisplayName(collateral.target.kind)}`,
          0,
          rowY + 54,
          PANEL_W - 40,
          34,
          TITLE_FONT_SIZE,
          HUD_TEXT_COLOR,
        );
        const dieLabels = [
          this.makeDieSquare(panel, DIE_COL_1, rowY, 60 * ATTACK_RESULT_DIE_SCALE),
          this.makeDieSquare(panel, DIE_COL_2, rowY, 60 * ATTACK_RESULT_DIE_SCALE),
        ];
        const needLabel = this.makeCenteredLabel(
          panel,
          '',
          MID_COL_X,
          rowY,
          MID_COL_W,
          40,
          CHECK_FONT_SIZE,
          DICE_INFO_TEXT,
        );
        const verdictLabel = this.makeCenteredLabel(
          panel,
          '',
          RESULT_COL_X,
          rowY,
          RESULT_COL_W,
          40,
          VERDICT_FONT_SIZE,
          DICE_OK_TEXT,
        );
        this.makeDiceRuleButton(panel, -238, rowY,
          () => this.openDiceRuleModal('he', collateral.report));
        highExplosiveCollateralRows.push({ dieLabels, needLabel, verdictLabel });
      }
    }

    // 底部大字结果
    const outcome = this.makeCenteredLabel(panel, '',
      0, -PANEL_H / 2 + 86, PANEL_W - 40, 48, 36, DICE_OUTCOME_MISS);
    outcome.node.active = false;
    const confirmY = -PANEL_H / 2 + (needsCrewRow ? 76 : 62);
    const confirmButton = this.makeDiceShowConfirmButton(panel, 0, confirmY);

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
      highExplosiveCollateralRows,
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

  private makeDiceRuleButton(parent: Node, x: number, y: number, onClick: () => void): Node {
    const size = 34;
    const btn = new Node('DiceRuleHelp');
    btn.layer = this.node.layer;
    btn.addComponent(UITransform).setContentSize(size, size);
    btn.setPosition(x, y, 0);
    const g = btn.addComponent(Graphics);
    g.lineWidth = 2;
    g.strokeColor = new Color(48, 255, 72, 255);
    g.circle(0, 0, size * 0.42);
    g.stroke();
    const lab = this.makeBattleModalLabel(btn, '?', 0, 0, size, size, 24, new Color(48, 255, 72, 255));
    bindButtonPressScale(btn);
    btn.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
      playUiClick();
      onClick();
      ev.propagationStopped = true;
    }, this);
    this.mirrorBattleModalButtonLabel(lab, () => {
      playUiClick();
      onClick();
    });
    parent.addChild(btn);
    return btn;
  }

  private closeDiceRuleModal() {
    const show = this.diceShow;
    const root = show?.ruleModalRoot;
    if (root?.isValid) root.destroy();
    if (show) show.ruleModalRoot = null;
  }

  private openDiceRuleModal(kind: DiceRuleKind, highExplosiveOverride?: HighExplosiveReport) {
    const show = this.diceShow;
    if (!show) return;
    this.closeDiceRuleModal();

    const spec = this.diceRuleModalSpec(show, kind, highExplosiveOverride);
    const root = new Node('DiceRuleModal');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(1280, 720);
    const host = show.panelRoot.parent ?? show.panelRoot;
    host.addChild(root);
    root.setSiblingIndex(host.children.length - 1);

    const { node: backdrop } = createAdaptiveFullscreenMask(
      root,
      'Backdrop',
      new Color(0, 0, 0, 70),
      UI_ROOT_SCALE,
    );
    backdrop.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
      this.closeDiceRuleModal();
      ev.propagationStopped = true;
    }, this);

    const panel = new Node('Panel');
    panel.layer = this.node.layer;
    panel.addComponent(UITransform).setContentSize(spec.w, spec.h);
    panel.setPosition(0, 30, 0);
    const pg = panel.addComponent(Graphics);
    drawDicePopupPanel(pg, spec.w, spec.h, MODAL_PANEL_BG, MODAL_PANEL_BORDER);
    panel.on(Node.EventType.TOUCH_END, (ev: EventTouch) => { ev.propagationStopped = true; }, this);
    root.addChild(panel);

    const titleLab = this.makeBattleModalLabel(panel, spec.title, 0, spec.h / 2 - 34, spec.w - 86, 34, 24, HUD_TEXT_COLOR);
    titleLab.enableOutline = true;
    titleLab.outlineColor = BATTLE_MODAL_TEXT_OUTLINE;
    titleLab.outlineWidth = 2;
    const close = this.makeBattleRectButton(panel, spec.w / 2 - 28, spec.h / 2 - 24, 34, 34, MODAL_CLOSE_BG,
      () => this.closeDiceRuleModal());
    const closeLab = this.makeBattleModalLabel(close.node, 'X', 0, 0, 34, 34, 22, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(closeLab, () => this.closeDiceRuleModal());

    let y = spec.h / 2 - 82;
    if (kind === 'damage') {
      y = this.populateDiceRuleDamage(panel, show, y, spec.w);
    } else if (kind === 'pen') {
      y = this.populateDiceRulePen(panel, show, y, spec.w);
    } else {
      const labelX = -spec.w * 0.22;
      const valueX = spec.w * 0.28;
      const labelW = spec.w * 0.46;
      const valueW = spec.w * 0.26;
      for (const row of spec.rows) {
        this.makeBattleModalLabel(panel, row[0], labelX, y, labelW, 28, 21, HUD_TEXT_COLOR);
        this.makeBattleModalLabel(panel, row[1], valueX, y, valueW, 28, 21, HUD_TEXT_COLOR);
        y -= 38;
      }
      const totals = spec.totals ?? (spec.total ? [spec.total] : []);
      if (totals.length > 0) {
        this.drawDiceRuleDivider(panel, spec.w, y + 16);
        y -= 22;
        for (const total of totals) {
          this.makeBattleModalLabel(panel, total[0], labelX, y, labelW, 30, 22, HUD_TEXT_COLOR);
          this.makeBattleModalLabel(panel, total[1], valueX, y, valueW, 30, 22, HUD_TEXT_COLOR);
          y -= 38;
        }
      }
      if (spec.note) {
        y -= 14;
        this.makeBattleModalLabel(panel, spec.note, 0, y, spec.w - 34, 26, 16, HUD_TEXT_COLOR);
      }
    }

    show.ruleModalRoot = root;
  }

  private diceRuleModalSpec(
    show: DiceShow,
    kind: DiceRuleKind,
    highExplosiveOverride?: HighExplosiveReport,
  ): {
    title: string;
    w: number;
    h: number;
    rows: Array<[string, string]>;
    total?: [string, string];
    totals?: Array<[string, string]>;
    note?: string;
  } {
    const r = show.report;
    if (kind === 'he') {
      const he = highExplosiveOverride ?? show.highExplosiveReport;
      if (!he) {
        return { title: t('dice.rule.heTitle'), w: 460, h: 250, rows: [] };
      }
      if (he.effectDice === undefined
        && he.destroyThreshold === undefined
        && he.armor === undefined) {
        return {
          title: t('dice.rule.heTitle'),
          w: 460,
          h: 250,
          rows: [
            [t('dice.rule.heHitEffect'), t('dice.rule.heAutomaticDestroy')],
          ],
        };
      }
      const powerModifier = String(-he.highExplosivePower);
      if (he.armor !== undefined && he.paralyzeThreshold !== undefined) {
        return {
          title: t('dice.rule.heTitle'),
          w: 460,
          h: 390,
          rows: [
            [t('dice.rule.armorLine', { face: this.armorFaceText(he.armorFace) }), String(he.armor)],
            [t('dice.rule.hePower'), powerModifier],
            [t('dice.rule.heFireModifier'), '+4'],
          ],
          totals: [
            [t('dice.rule.heFireNeed'), String(he.fireThreshold ?? '-')],
            [t('dice.rule.heParalyzeNeed'), String(he.paralyzeThreshold)],
          ],
        };
      }
      if (he.armor !== undefined && he.fireThreshold !== undefined) {
        return {
          title: t('dice.rule.heTitle'),
          w: 460,
          h: 390,
          rows: [
            [t('dice.rule.armorLine', { face: this.armorFaceText(he.armorFace) }), String(he.armor)],
            [t('dice.rule.hePower'), powerModifier],
            [t('dice.rule.heDestroyModifier'), '+2'],
            [t('dice.rule.heFireModifier'), '-2'],
          ],
          totals: [
            [t('dice.rule.heDestroyNeed'), String(he.destroyThreshold ?? '-')],
            [t('dice.rule.heFireNeed'), String(he.fireThreshold)],
          ],
        };
      }
      if (he.armor !== undefined) {
        return {
          title: t('dice.rule.heTitle'),
          w: 460,
          h: 300,
          rows: [
            [t('dice.rule.armorLine', { face: this.armorFaceText(he.armorFace) }), String(he.armor)],
            [t('dice.rule.hePower'), powerModifier],
          ],
          total: [t('dice.rule.heParalyzeNeed'), String(he.effectThreshold ?? '-')],
        };
      }
      const rows: Array<[string, string]> = [[t('dice.rule.heBaseDestroy'), '12']];
      const totals: Array<[string, string]> = [
        [t('dice.rule.heDestroyNeed'), String(he.destroyThreshold ?? he.effectThreshold ?? '-')],
      ];
      if (he.suppressThreshold !== undefined) {
        rows.push([t('dice.rule.heBaseSuppress'), '6']);
        totals.push([t('dice.rule.heSuppressNeed'), String(he.suppressThreshold)]);
      }
      const coverValue = he.infantryCoverValue ?? 0;
      if (coverValue !== 0) {
        const coverLabel = he.infantryCoverSource === 'building'
          ? t('dice.rule.building')
          : he.infantryCoverSource === 'forest'
            ? t('terrain.forest')
            : he.infantryCoverSource === 'trees'
              ? t('dice.rule.trees')
              : he.infantryCoverSource === 'friendly_tank'
                ? t('dice.rule.heTankCover')
                : t('dice.rule.heCover');
        rows.push([coverLabel, String(coverValue)]);
      }
      rows.push([t('dice.rule.hePower'), powerModifier]);
      return {
        title: t('dice.rule.heTitle'),
        w: 460,
        h: 216 + rows.length * 38 + Math.max(0, totals.length - 1) * 22,
        rows,
        totals,
      };
    }
    if (kind === 'hit') {
      const showOpenHatchCommanderHint = show.targetCommanderExposed;
      const rows: Array<[string, string]> = [];
      if (show.attacker && show.target && this.mission) {
        const base = r.hitBreakdown ?? hitBreakdown({
          attacker: show.attacker,
          target: show.target,
          map: this.mission.map,
          theater: this.mission.data.theater,
          units: this.allUnits(),
          smokeHexes: this.mission.smokeHexes,
          weather: this.currentWeather(),
        });
        const add = (name: string, value: number | undefined) => {
          if (value !== undefined && value !== 0) rows.push([name, String(value)]);
        };
        add(t('dice.rule.distance'), base.distance);
        add(t(r.shootingPortHit !== undefined
          ? 'dice.rule.shootingPortValue'
          : 'dice.rule.targetSize'), base.size);
        add(t('dice.rule.hedges'), base.hedges);
        add(t('dice.rule.building'), base.building);
        add(t('dice.rule.smoke'), base.smoke);
        add(t('dice.rule.concealed'), base.concealed);
        add(t('dice.rule.trees'), base.trees);
        add(t('dice.rule.rearArc'), base.rearArc);
        add(t('dice.rule.frontArc'), base.frontArc);
        add(getLang() === 'zh' ? '雨天' : 'Rain', base.weather);
        add(getLang() === 'zh' ? '单位等级' : 'Unit rank', base.unitLevel);
        const namedModifiers = r.hitModifiers ?? [];
        for (const modifier of namedModifiers) add(t(modifier.labelKey), modifier.value);
        const namedTotal = namedModifiers.reduce((sum, modifier) => sum + modifier.value, 0);
        const unexplainedModifier = r.threshold - (base.threshold - (base.actionModifier ?? 0)) - namedTotal;
        add(t('dice.rule.attackModifier'), unexplainedModifier);
      }
      if (rows.length === 0) rows.push([t('dice.rule.hitNeedTitle'), String(r.threshold)]);
      return {
        title: t('dice.rule.hitNeedTitle'),
        w: 410,
        h: 150 + rows.length * 38 + (showOpenHatchCommanderHint ? 58 : 0),
        rows,
        total: [t('dice.rule.total'), String(r.threshold)],
        note: showOpenHatchCommanderHint ? t('dice.rule.hitDoublesCommanderKiaHint') : undefined,
      };
    }
    if (kind === 'pen') {
      const armor = r.armor ?? 0;
      const pen = r.penetration ?? 0;
      const need = r.penThreshold ?? armor - pen;
      return {
        title: t('dice.rule.penNeedTitle'),
        w: 460,
        h: (getGameModeConfig(GameSession.gameMode).effectiveRangePenetration ? 420 : 250)
          + ((r.gunMantletArmor ?? 0) > 0 ? 36 : 0),
        rows: [],
        total: [t('dice.rule.penNeed'), String(need)],
      };
    }
    if (kind === 'crew') {
      const cc = r.stagedCrewCheck ?? r.crewCheck;
      const result = cc ? crewDeathLabel(cc).text : t('dice.rule.none');
      return {
        title: t('dice.panel.crewTitle'),
        w: 410,
        h: 220,
        rows: [
          [t('dice.rule.die'), cc ? String(cc.die) : '-'],
          [t('dice.rule.result'), result],
        ],
      };
    }
    return { title: t('dice.panel.dmgTitle'), w: 460, h: 430, rows: [] };
  }

  private populateDiceRulePen(panel: Node, show: DiceShow, startY: number, panelW: number): number {
    const report = show.report;
    const armor = report.armor ?? 0;
    const gunMantletArmor = Math.max(0, report.gunMantletArmor ?? 0);
    const baseArmor = armor - gunMantletArmor;
    const actualPen = report.penetration ?? show.attacker?.stats.penetration ?? 0;
    const need = report.penThreshold ?? armor - actualPen;
    const labelX = -panelW * 0.24;
    const valueX = panelW * 0.28;
    const labelW = panelW * 0.46;
    const valueW = panelW * 0.26;
    let y = startY;
    const addRow = (label: string, value: string | number, fontSize = 21) => {
      this.makeBattleModalLabel(panel, label, labelX, y, labelW, 28, fontSize, HUD_TEXT_COLOR);
      this.makeBattleModalLabel(panel, String(value), valueX, y, valueW, 28, fontSize, HUD_TEXT_COLOR);
      y -= 36;
    };

    const showEffectivePen = getGameModeConfig(GameSession.gameMode).effectiveRangePenetration
      && !!show.attacker
      && !!show.target;
    if (showEffectivePen && show.attacker && show.target) {
      const breakdown = report.penetrationBreakdown
        ?? effectivePenetrationBreakdown(show.attacker, show.target, true);
      const penetrationBonus = breakdown.penetrationBonus ?? 0;
      addRow(
        t(penetrationBonus !== 0 ? 'dice.rule.hvapPen' : 'dice.rule.basePen'),
        breakdown.basePenetration + penetrationBonus,
      );
      addRow(t('dice.rule.effectiveRange'), breakdown.effectiveRange + (breakdown.effectiveRangeBonus ?? 0));
      addRow(t('dice.rule.distance'), breakdown.distance);
      addRow(t('dice.rule.rangePenalty'), -breakdown.rangePenalty);
      this.drawDiceRuleDivider(panel, panelW, y + 16);
      y -= 10;
      addRow(t('dice.rule.actualPen'), actualPen);
      y -= 20;
    }

    addRow(t('dice.rule.armorLine', { face: this.armorFaceText(report.armorFace) }), baseArmor);
    if (gunMantletArmor > 0) {
      addRow(t('dice.rule.gunMantletArmor'), gunMantletArmor);
    }
    addRow(t('dice.rule.actualPen'), actualPen);
    this.drawDiceRuleDivider(panel, panelW, y + 16);
    y -= 18;
    addRow(t('dice.rule.penNeed'), need, 22);
    return y;
  }

  private populateDiceRuleDamage(panel: Node, show: DiceShow, startY: number, panelW: number): number {
    const report = show.report;
    const targetClass = this.damageTargetClassForRule(show);
    const damageType = report.damageCheckType ?? 'front';
    let y = startY;
    const labelX = -panelW * 0.26;
    const valueX = panelW * 0.18;
    const dieX = -panelW * 0.32;
    const textX = panelW * 0.16;
    const textW = panelW * 0.58;
    this.makeBattleModalLabel(panel, t('dice.rule.targetType'), labelX, y, panelW * 0.32, 28, 20, HUD_TEXT_COLOR);
    this.makeBattleModalLabel(panel, targetClass ? this.damageTargetClassText(targetClass) : t('dice.rule.currentTarget'), valueX, y, textW, 28, 20, HUD_TEXT_COLOR);
    y -= 30;
    this.makeBattleModalLabel(panel, t('dice.rule.hitDirection'), labelX, y, panelW * 0.32, 28, 20, HUD_TEXT_COLOR);
    this.makeBattleModalLabel(panel, this.damageCheckTypeText(damageType), valueX, y, textW, 28, 20, HUD_TEXT_COLOR);
    y -= 46;

    for (let die = 1; die <= 6; die++) {
      const dieLabel = this.makeDieSquare(panel, dieX, y, 38);
      this.setDieLabelFace(dieLabel, die);
      const text = targetClass
        ? this.damageTableEntryText(targetClass, damageType, die)
        : (die === report.stagedDamageDie ? damageEffectSummaryLabel(report).text : '-');
      this.makeBattleModalLabel(panel, text, textX, y, textW, 32, 18, HUD_TEXT_COLOR);
      y -= 45;
    }
    return y;
  }

  private drawDiceRuleDivider(parent: Node, panelW: number, y: number) {
    const n = new Node('Divider');
    n.layer = this.node.layer;
    parent.addChild(n);
    const g = n.addComponent(Graphics);
    g.strokeColor = new Color(226, 214, 166, 235);
    g.lineWidth = 2;
    g.moveTo(-panelW * 0.34, y);
    g.lineTo(panelW * 0.34, y);
    g.stroke();
  }

  private armorFaceText(face: AttackReport['armorFace']): string {
    switch (face) {
      case 'front': return t('dice.rule.faceFront');
      case 'frontSide': return t('dice.rule.faceFrontSide');
      case 'rearSide': return t('dice.rule.faceRearSide');
      case 'rear': return t('dice.rule.faceRear');
      default: return t('dice.rule.faceTarget');
    }
  }

  private damageCheckTypeText(type: NonNullable<AttackReport['damageCheckType']>): string {
    switch (type) {
      case 'front': return t('dice.rule.faceFront');
      case 'right': return t('dice.rule.faceRight');
      case 'left': return t('dice.rule.faceLeft');
      case 'rear': return t('dice.rule.faceRear');
    }
  }

  private damageTargetClassForRule(show: DiceShow): DamageTargetClass | null {
    if (show.report.protagonistTarget) return 'protagonist';
    const configured = show.target?.stats.damageTargetClass;
    if (configured && configured in DAMAGE_TABLE) return configured as DamageTargetClass;
    if (show.target && show.target.sideId === 'player') return 'us_tank';
    if (show.target && isTankUnit(show.target)) return 'german_tank';
    return null;
  }

  private damageTargetClassText(targetClass: DamageTargetClass): string {
    switch (targetClass) {
      case 'protagonist': return unitDisplayName(this.mission.playerTank.kind);
      case 'german_tank': return t('dice.rule.germanTank');
      case 'us_tank': return t('dice.rule.usTank');
      case 'destroyed': return t('dice.rule.destroyedTarget');
    }
  }

  private damageTableEntryText(targetClass: DamageTargetClass, type: NonNullable<AttackReport['damageCheckType']>, die: number): string {
    const entry = DAMAGE_TABLE[targetClass]?.[type]?.[die];
    const groups = entry?.groups ?? [];
    if (groups.length <= 0) return '-';
    return groups
      .map(group => group.map(effect => this.damageTableEffectText(effect)).join(' + '))
      .filter(text => text.length > 0)
      .join(t('dice.rule.prioritySep'));
  }

  private damageTableEffectText(effect: DamageTableEffect): string {
    if (effect.kind === 'crew') {
      const roles = (effect.crew ?? []).map(role => crewRoleName({
        commander: 1,
        loader: 3,
        gunner: 2,
        driver: 4,
        coDriver: 5,
      }[role] ?? 1)).join('|');
      return t('dice.rule.crewEffect', { roles });
    }
    if (effect.kind === 'fire') return t('dmg.outcome.fire');
    return damageEffectLabel(effect.kind as DamageEffect).text;
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
    for (let i = 0; i < show.highExplosiveCollateralRows.length; i++) {
      const row = show.highExplosiveCollateralRows[i];
      row.dieLabels.forEach((label, dieIndex) => {
        this.setDieLabelFace(label, ((frame * (17 + i * 6 + dieIndex * 4)) % 6) + 1);
      });
      row.needLabel.string = '';
      row.verdictLabel.string = '';
    }
    if (show.penVerdictLabel) show.penVerdictLabel.string = '';
    if (show.dmgEffectLabel) show.dmgEffectLabel.string = '';
    if (show.crewEffectLabel) show.crewEffectLabel.string = '';
  }

  /** Adapt HE hit/effect dice to the shared AP result-modal animation contract. */
  private highExplosivePanelReport(report: HighExplosiveReport): AttackReport {
    const effectDice = report.effectDice?.slice();
    const damageEffect: DamageEffect | undefined = report.outcome === 'destroyed'
      ? 'destroyed'
      : report.outcome === 'paralyzed'
        ? 'paralyzed'
        : report.outcome === 'fire_suppressed' ? 'fire' : undefined;
    return {
      dice: report.dice,
      roll: report.roll,
      threshold: report.threshold,
      hit: report.hit,
      automaticHit: report.automaticHit,
      shootingPortHit: report.shootingPortHit,
      hitBreakdown: report.hitBreakdown,
      hitModifiers: report.hitModifiers,
      armorFace: report.armorFace,
      armor: report.armor,
      penetration: report.highExplosivePower,
      penDice: effectDice,
      penDie: report.effectRoll,
      penThreshold: report.effectThreshold,
      penetrated: report.hit && report.outcome !== 'none',
      damageEffect,
      commanderKilledByHitDoubles: report.commanderKilledByHitDoubles,
      commanderShieldBlocked: report.commanderShieldBlocked,
      statusChange: report.outcome === 'destroyed' ? 'destroyed'
        : report.outcome === 'none' ? 'none' : 'damaged',
    };
  }

  private highExplosiveOutcomeLabel(report: HighExplosiveReport): { text: string; color: Color } {
    if (!report.hit) return { text: t('dice.panel.outcomeMiss'), color: DICE_OUTCOME_MISS };
    switch (report.outcome) {
      case 'destroyed': return { text: t('dmg.outcome.destroyed'), color: DICE_OUTCOME_HIT };
      case 'paralyzed': return { text: t('dmg.outcome.paralyzed'), color: DICE_OUTCOME_HIT };
      case 'suppressed': return { text: t('dice.panel.heSuppressed'), color: DICE_OUTCOME_HIT };
      case 'fire_suppressed': return { text: t('dice.panel.heFireSuppressed'), color: DICE_OUTCOME_HIT };
      case 'fire': return { text: t('dmg.outcome.fire'), color: DICE_OUTCOME_HIT };
      case 'none': return { text: t('dmg.outcome.none'), color: DICE_OUTCOME_RIC };
    }
  }

  private revealMainGunDiceRows(show: DiceShow) {
    if (show.highExplosiveReport) {
      const he = show.highExplosiveReport;
      if (he.effectDice?.length) {
        show.penDieLabels.forEach((label, i) => this.setDieLabelFace(label, he.effectDice![i] ?? '?'));
        if (show.penNeedLabel) {
          show.penNeedLabel.fontSize = 18;
          show.penNeedLabel.lineHeight = 22;
          show.penNeedLabel.color = DICE_INFO_TEXT;
          show.penNeedLabel.string = he.paralyzeThreshold !== undefined
            ? he.outcome === 'fire' || he.outcome === 'destroyed'
              ? t('dice.panel.heFireNeed', { n: he.fireThreshold ?? '-' })
              : t('dice.panel.heParalyzeNeed', { n: he.paralyzeThreshold })
            : !he.hit
              ? t('dice.panel.heParalyzeCheck')
              : he.fireThreshold !== undefined
              ? he.outcome === 'destroyed'
                ? t('dice.panel.heDestroyNeed', {
                    n: he.destroyedByRepeatFire ? he.fireThreshold ?? '-' : he.destroyThreshold ?? '-',
                  })
                : t('dice.panel.heFireNeed', { n: he.fireThreshold })
              : he.suppressThreshold !== undefined
                ? he.outcome === 'destroyed'
                  ? t('dice.panel.heDestroyNeed', { n: he.destroyThreshold ?? '-' })
                  : t('dice.panel.heSuppressNeed', { n: he.suppressThreshold })
                : he.destroyThreshold !== undefined
                  ? t('dice.panel.heDestroyNeed', { n: he.destroyThreshold })
                  : he.armor !== undefined
                    ? t('dice.panel.heParalyzeNeed', { n: he.effectThreshold ?? '-' })
                    : t('dice.panel.heNeed', { n: he.effectThreshold ?? '-' });
        }
        if (show.penVerdictLabel) {
          if (!he.hit) {
            show.penVerdictLabel.string = t('dice.panel.invalid');
            show.penVerdictLabel.color = DICE_FAIL_TEXT;
          } else {
            const out = this.highExplosiveOutcomeLabel(he);
            show.penVerdictLabel.string = out.text;
            show.penVerdictLabel.color = out.color;
          }
        }
      } else {
        for (const label of show.penDieLabels) label.node.parent!.active = false;
        if (show.penNeedLabel) show.penNeedLabel.node.active = false;
        if (show.penVerdictLabel) show.penVerdictLabel.node.active = false;
      }
      for (let i = 0; i < show.highExplosiveCollateralRows.length; i++) {
        const row = show.highExplosiveCollateralRows[i];
        const collateral = show.highExplosiveCollateral[i];
        if (!collateral) continue;
        row.dieLabels.forEach((label, dieIndex) => {
          this.setDieLabelFace(label, collateral.report.effectDice?.[dieIndex] ?? '?');
        });
        row.needLabel.string = collateral.report.outcome === 'destroyed'
          ? t('dice.panel.heDestroyNeed', { n: collateral.report.destroyThreshold ?? '-' })
          : t('dice.panel.heSuppressNeed', { n: collateral.report.suppressThreshold ?? '-' });
        const out = this.highExplosiveOutcomeLabel(collateral.report);
        row.verdictLabel.string = out.text;
        row.verdictLabel.color = out.color;
      }
      return;
    }
    if (show.report.hit) {
      if (show.report.penDice?.length) {
        show.penDieLabels.forEach((label, i) => this.setDieLabelFace(label, show.report.penDice![i] ?? '?'));
      } else if (show.report.penDie !== undefined) {
        show.penDieLabels.forEach(label => this.setDieLabelFace(label, show.report.penDie ?? '?'));
      }
      if (show.penNeedLabel && show.report.penThreshold !== undefined) {
        const thr = show.report.penThreshold;
        show.penNeedLabel.fontSize = 18;
        show.penNeedLabel.lineHeight = 22;
        show.penNeedLabel.color = DICE_INFO_TEXT;
        show.penNeedLabel.string = thr <= 0
          ? t('dice.panel.penMustPen')
          : t('dice.panel.penetrateNeed', { n: thr });
      }
      if (show.penVerdictLabel) {
        if (show.report.penetrated) {
          show.penVerdictLabel.string = show.report.overpenetrated
            ? t('dice.panel.overpenetrated')
            : show.report.stagedDamageDie === undefined && show.report.damageEffect === 'destroyed'
            ? t('dmg.outcome.destroyed')
            : t('dice.panel.penYes');
          show.penVerdictLabel.color = show.report.overpenetrated
            ? new Color(255, 190, 72, 255)
            : DICE_OK_TEXT;
        } else {
          show.penVerdictLabel.string = t('dice.panel.penNo');
          show.penVerdictLabel.color = DICE_FAIL_TEXT;
        }
      }
    } else {
      if (show.penNeedLabel) {
        show.penNeedLabel.fontSize = 18;
        show.penNeedLabel.lineHeight = 22;
        show.penNeedLabel.string = t('dice.panel.penCheck');
        show.penNeedLabel.color = DICE_INFO_TEXT;
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
      const lab = damageEffectSummaryLabel(show.report);
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
    if (show.highExplosiveReport) {
      const out = this.highExplosiveOutcomeLabel(show.highExplosiveReport);
      show.outcomeLabel.string = out.text;
      show.outcomeLabel.color = out.color;
      return;
    }
    if (!show.report.hit) {
      show.outcomeLabel.string = t('dice.panel.outcomeMiss');
      show.outcomeLabel.color = DICE_OUTCOME_MISS;
    } else if (!show.report.penetrated) {
      show.outcomeLabel.string = t('dice.panel.outcomeRic');
      show.outcomeLabel.color = DICE_OUTCOME_RIC;
    } else if (show.report.overpenetrated
      && !show.report.damageEffect
      && !(show.report.damageEffects?.length)) {
      const out = overpenetrationOutcomeLabel();
      show.outcomeLabel.string = out.text;
      show.outcomeLabel.color = out.color;
    } else if (show.report.damageEffect === 'crewCheck') {
      const out = resolvedCrewDeathLabel(show.report)
        ?? (show.report.crewCheck
          ? crewOutcomeLabel(show.report.crewCheck)
          : damageOutcomeLabel(show.report.damageEffect));
      show.outcomeLabel.string = out.text;
      show.outcomeLabel.color = out.color;
    } else {
      const out = damageOutcomeLabel(show.report.damageEffect);
      show.outcomeLabel.string = out.text;
      show.outcomeLabel.color = out.color;
    }
  }

  private enterDiceShowHold(show: DiceShow) {
    this.applyDiceShowDestroyedVisual(show);
    show.stage = 'hold';
    show.t = 0;
    show.outcomeLabel.node.active = false;
    if (!show.holdNotified) {
      show.holdNotified = true;
      show.onHold?.();
    }
  }

  private applyDiceShowDestroyedVisual(show: DiceShow) {
    if (show.earlyDestroyedVisualApplied) return;
    if (show.highExplosiveReport) return;
    const target = show.target;
    // A hardcore MG hit abandons an AT gun; it must never preview the gun's
    // destroyed sprite. Crew death and blood are applied by the real result.
    if (show.mg
        && GameSession.gameMode === 'hardcore'
        && target !== undefined
        && isAntiTankGunUnit(target)
        && target.atGunCrewAlive === true) return;
    if (!target || !this.applyAttackDestroyedVisualAtImpact(show.report, show.attacker, target, show.mg)) return;
    show.earlyDestroyedVisualApplied = true;
  }

  private applyAttackDestroyedVisualAtImpact(
    report: AttackReport,
    attacker: Unit | null,
    target: Unit | null,
    mg = false,
  ): boolean {
    const destroysTarget = mg
      ? report.hit || report.statusChange === 'destroyed'
      : report.hit && (report.statusChange === 'destroyed' || report.damageEffect === 'destroyed');
    if (!target || !destroysTarget) return false;

    if (!target.destroyed) target.destroyed = true;
    this.registerImpactDestroyWreckVisual(target, attacker);
    this.updateHUD();
    this.redraw();
    this.refreshStatusPanel();
    return true;
  }

  // ---------- 敌方 AI 骰子迷你托盘 ----------

  /** 按点数升序排骰下标，同点保留原数组顺序（稳定排序） */
  private usesHardcoreTankDice(unit: Unit): boolean {
    return !!this.mission
      && unit !== this.mission.sherman
      && !!unit.stats.actionTable
      && getGameModeConfig(GameSession.gameMode).aiHardcoreTankDice;
  }

  private enemyDieActionEntry(dieIdx: number): AIActionEntry {
    const pip = this.enemyDice[dieIdx];
    const type = this.enemyDiceTypes[dieIdx];
    const enemy = this.enemyOrder[this.enemyIndex];
    return type && enemy
      ? actionForHardcoreTankDie(enemy, type, pip, this.enemyFirepowerModifier)
      : actionFor(DEFAULT_AI_TABLE, this.enemyAICol, pip);
  }

  private enemyDieTypeSortValue(dieIdx: number): number {
    const type = this.enemyDiceTypes[dieIdx];
    if (type === 'attack') return 0;
    if (type === 'move') return 1;
    if (type === 'misc') return 2;
    return 3;
  }

  private enemyDieFillColor(dieIdx: number): Color {
    const type = this.enemyDiceTypes[dieIdx];
    if (type === 'attack') return AI_ATTACK_DIE_FILL;
    if (type === 'move') return AI_MOVE_DIE_FILL;
    if (type === 'misc') return AI_MISC_DIE_FILL;
    return DICE_DIE_FILL;
  }

  private playerDieFillColor(): Color {
    if (this.playerStep === 'attack') return AI_ATTACK_DIE_FILL;
    if (this.playerStep === 'movement') return AI_MOVE_DIE_FILL;
    if (this.playerStep === 'misc') return AI_MISC_DIE_FILL;
    return DIE_FACE_FILL;
  }

  private describeEnemyDie(dieIdx: number): string {
    const type = this.enemyDiceTypes[dieIdx];
    return type ? `${type}:${this.enemyDice[dieIdx]}` : `${this.enemyDice[dieIdx]}`;
  }

  private describeEnemyDiceRolls(): string {
    return this.enemyDice.map((_, i) => this.describeEnemyDie(i)).join(',');
  }

  private describeEnemyDicePool(terrain: TerrainType): string {
    const hasTypedDice = this.enemyDiceTypes.some(t => !!t);
    if (!hasTypedDice) return `${aiColumnDisplayName(this.enemyAICol)} ${this.enemyDice.length}d`;
    const key = hardcoreTankDiceTerrain(terrain);
    const subject = this.enemyOrder[this.enemyIndex];
    const count = subject
      ? hardcoreTankAIDiceCount(subject, terrain)
      : {
        attack: this.enemyDiceTypes.filter(type => type === 'attack').length,
        move: this.enemyDiceTypes.filter(type => type === 'move').length,
        misc: this.enemyDiceTypes.filter(type => type === 'misc').length,
      };
    return `${t(`dice.aiTerrain.${key}`)} A${count.attack}/M${count.move}/X${count.misc}`;
  }

  private enemyHardcoreTankTerrainLabel(): string {
    const subject = this.enemyDiceTraySubject;
    const tileTerrain = subject && this.mission
      ? hardcoreTankDiceTerrain(effectiveDiceTerrain(this.mission.map.get(subject.pos)))
      : 'field';
    return t(`dice.aiTerrain.${tileTerrain}`);
  }

  private computeEnemyDiceExecOrder(): number[] {
    const n = this.enemyDice.length;
    const idx = Array.from({ length: n }, (_, i) => i);
    idx.sort((a, b) => {
      const va = this.enemyDice[a];
      const vb = this.enemyDice[b];
      if (va !== vb) return va - vb;
      const ta = this.enemyDieTypeSortValue(a);
      const tb = this.enemyDieTypeSortValue(b);
      if (ta !== tb) return ta - tb;
      return a - b;
    });
    return idx;
  }

  private findUnusedMatchingEnemyDie(dieIdx: number): number {
    if (dieIdx < 0 || dieIdx >= this.enemyDice.length) return -1;
    const pip = this.enemyDice[dieIdx];
    for (let i = 0; i < this.enemyDice.length; i++) {
      if (i === dieIdx || this.enemyDiceUsed[i]) continue;
      if (this.enemyDice[i] === pip) return i;
    }
    return -1;
  }

  /** 托盘下方短标签：当前规则下该骰将执行的具体动作（无可行则空转） */
  private enemyDieActionSubtitle(enemy: Unit, dieIdx: number): string {
    if (this.enemyDiceTypes[dieIdx] === 'attack'
        && hardcoreAttackDieIsInvalid(this.enemyDice[dieIdx], this.enemyFirepowerModifier)) {
      return t('dice.panel.invalid');
    }
    const resolved = this.enemyDiceResolvedActions[dieIdx];
    if (resolved !== undefined) {
      if (!resolved || resolved === 'none') return t('dice.aiEnemy.waste');
      return t(`dice.aiEnemy.${resolved}`);
    }
    const entry = this.enemyDieActionEntry(dieIdx);
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
    this.hudParent().addChild(root);
    root.setSiblingIndex(this.hudParent().children.length - 1);
    this.enemyDiceTraySubject = enemy;

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
    hl.string = unitDisplayName(enemy.kind);
    hl.enableOutline = true;
    hl.outlineColor = new Color(0, 0, 0, 220);
    hl.outlineWidth = 2;
    root.addChild(header);

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
        fill: this.enemyDieFillColor(i),
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
      this.enemyDiceSortAnim = { t: 0, dur: DICE_ROLL_DUR, fromSlot, toSlot };
      this.applyEnemyDiceSortLayout(0);
      playDiceRoll();
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
        fill: this.enemyDieFillColor(i),
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

  /** 关闭 DiceShow 前将托盘移回 HUD，避免随 panelRoot.destroy 一起被销毁 */
  private lowerEnemyDiceTrayFromDiceShowIfNeeded() {
    const tray = this.enemyDiceTrayRoot;
    if (!tray || !tray.isValid) return;
    if (tray.parent?.name !== 'DiceShow') return;
    tray.removeFromParent();
    this.hudParent().addChild(tray);
    this.placeEnemyDiceTrayRoot(tray);
    tray.setSiblingIndex(this.hudParent().children.length - 1);
  }

  /** 销毁敌方骰子托盘（切敌方单位 / 结束敌方阶段等） */
  private destroyEnemyDiceTray() {
    this.lowerEnemyDiceTrayFromDiceShowIfNeeded();
    this.enemyDiceSortAnim = null;
    this.enemyDiceResultHold = null;
    this.enemyDidActThisTurn = false;
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
   *   hit-roll（滚动 DICE_ROLL_DUR）
   *     → hit-show (揭示 2d6 真值 + 命中/未命中，停 DICE_HIT_SHOW_DUR)
   *   若未命中：hit-show → hold（骰子不再动，底部大字 MISS，停 DICE_HOLD_DUR）→ done
   *   若命中：hit-show → pen-roll（滚动 DICE_ROLL_DUR）
   *     → pen-show (揭示 1d6 + 击穿/跳弹，DICE_PEN_SHOW_DUR)
   *   若跳弹：pen-show → hold（底部出 跳弹）→ done
   *   若击穿且有伤害骰：pen-show → dmg-roll（滚动 DICE_ROLL_DUR）→ dmg-show（揭示 1d6 + 伤害效果）
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
        show.hitSumLabel.string = '';
        if (!show.mg) this.spinMainGunDiceRows(show, frame);
        if (show.t >= DICE_ROLL_DUR) {
          show.stage = 'hit-show';
          show.t = 0;
          this.setDieLabelFace(show.hitDieLabels[0], show.report.dice[0]);
          if (show.hitDieLabels[1]) this.setDieLabelFace(show.hitDieLabels[1], show.report.dice[1]);
          show.hitSumLabel.string = '';
          if (show.report.shootingPortHit !== undefined) {
            show.hitVerdictLabel.string = show.report.shootingPortHit
              ? t('dice.panel.shootingPortDestroyed')
              : t('dice.panel.shootingPortMissContinue');
            show.hitVerdictLabel.color = show.report.shootingPortHit ? DICE_OK_TEXT : DICE_INFO_TEXT;
          } else if (show.report.hit) {
            if (show.highExplosiveReport && !show.highExplosiveReport.effectDice?.length) {
              const out = this.highExplosiveOutcomeLabel(show.highExplosiveReport);
              show.hitVerdictLabel.string = out.text;
              show.hitVerdictLabel.color = out.color;
            } else {
              show.hitVerdictLabel.string = t('dice.panel.hitYes');
              show.hitVerdictLabel.color = DICE_OK_TEXT;
            }
          } else {
            show.hitVerdictLabel.string = t('dice.panel.hitNo');
            show.hitVerdictLabel.color = DICE_FAIL_TEXT;
          }
          if (show.hitSpecialLabel && show.report.hit && show.report.commanderKilledByHitDoubles) {
            show.hitSpecialLabel.node.active = true;
            show.hitSpecialLabel.string = t('dice.panel.hitDoublesCommanderKia').replace(/^.*[:：]\s*/, '');
          }
          if (!show.mg) {
            this.revealMainGunDiceRows(show);
            this.setMainGunDiceOutcome(show);
            this.enterDiceShowHold(show);
          }
          // 射击音效与「骰子落定」同步：主炮 / 机枪在命中与未命中时均播放（onDone 过晚且机枪曾仅命中播）
          if (!show.fireEffectPlayed) {
            if (show.highExplosiveReport && show.attacker && show.target) {
              this.playHighExplosiveSuppressionCue(show.attacker, show.target, show.highExplosiveReport);
            } else {
              this.playAttackFireCue(show.attacker, show.target, show.mg, show.attackSound, show.report);
            }
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
              show.penNeedLabel.fontSize = 18;
              show.penNeedLabel.lineHeight = 22;
              show.penNeedLabel.color = DICE_INFO_TEXT;
              show.penNeedLabel.string = thr <= 0
                ? t('dice.panel.penMustPen')
                : t('dice.panel.penNeed', { n: thr });
            }
            if (show.penVerdictLabel) show.penVerdictLabel.string = '';
            playDiceRoll();
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
        if (show.t >= DICE_ROLL_DUR) {
          show.stage = 'pen-show';
          show.t = 0;
          if (show.report.penDice?.length) {
            show.penDieLabels.forEach((label, i) => this.setDieLabelFace(label, show.report.penDice![i] ?? '?'));
          } else if (show.report.penDie !== undefined) {
            show.penDieLabels.forEach((label) => this.setDieLabelFace(label, show.report.penDie ?? '?'));
          }
          if (show.penVerdictLabel) {
            if (show.report.penetrated) {
              show.penVerdictLabel.string = show.report.overpenetrated
                ? t('dice.panel.overpenetrated')
                : show.report.stagedDamageDie === undefined && show.report.damageEffect === 'destroyed'
                ? t('dmg.outcome.destroyed')
                : t('dice.panel.penYes');
              show.penVerdictLabel.color = show.report.overpenetrated
                ? new Color(255, 190, 72, 255)
                : DICE_OK_TEXT;
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
            const out = show.report.overpenetrated && !show.report.damageEffect
              ? overpenetrationOutcomeLabel()
              : damageOutcomeLabel(show.report.damageEffect);
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
            playDiceRoll();
          }
        }
        break;
      }
      case 'dmg-roll': {
        const frame = Math.floor(show.t / DICE_CYCLE_INTERVAL);
        const p = ((frame * 11) % 6) + 1;
        this.setDieLabelFace(show.dmgDieLabel, p);
        if (show.t >= DICE_ROLL_DUR) {
          show.stage = 'dmg-show';
          show.t = 0;
          if (show.dmgDieLabel && show.report.damageDie !== undefined) {
            this.setDieLabelFace(show.dmgDieLabel, show.report.damageDie);
          }
          if (show.dmgEffectLabel) {
            const lab = damageEffectSummaryLabel(show.report);
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
            playDiceRoll();
          } else {
            const out = show.report.overpenetrated
              && !show.report.damageEffect
              && !(show.report.damageEffects?.length)
              ? overpenetrationOutcomeLabel()
              : show.report.damageEffect === 'crewCheck'
              ? resolvedCrewDeathLabel(show.report) ?? damageOutcomeLabel(show.report.damageEffect)
              : damageOutcomeLabel(show.report.damageEffect);
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
        if (show.t >= DICE_ROLL_DUR) {
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
            const out = resolvedCrewDeathLabel(show.report)
              ?? (show.report.crewCheck
                ? crewOutcomeLabel(show.report.crewCheck)
                : damageOutcomeLabel(show.report.damageEffect));
            show.outcomeLabel.string = out.text;
            show.outcomeLabel.color = out.color;
          }
          this.enterDiceShowHold(show);
        }
        break;
      }
      case 'hold': {
        if (show.t >= DICE_HOLD_DUR) {
          if (show.mg && !show.requireManualClose) {
            show.stage = 'done';
            this.finalizeDiceShow(false);
          }
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
    this.closeDiceRuleModal();
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
    return this.turnTransition !== null || this.campaignTransitionActive || this.campaignPanAnim !== null
      || this.campaignUpgradeChoiceRoot !== null || this.campaignUpgradeDetailRoot !== null
      || this.anim !== null || this.diceShow !== null || this.playerDiceRollAnim !== null
      || this.playerDiceSortAnim !== null
      || this.turretAimAnim !== null
      || this.precisionAimHoldCallback !== null
      || this.enemyDiceSortAnim !== null
      || this.enemyDiceResultHold !== null
      || this.turnEndEventUI !== null || this.fireCheckEventUI !== null || this.usCasualtyEventUI !== null
      || this.tileInspectModalRoot !== null;
  }

  private destroyFireCheckEventUI() {
    const ui = this.fireCheckEventUI;
    if (!ui) return;
    this.closeFireCheckRuleModal();
    this.fireCheckEventUI = null;
    if (ui.root.isValid) ui.root.destroy();
  }

  private closeFireCheckRuleModal() {
    const ui = this.fireCheckEventUI;
    const root = ui?.ruleModalRoot;
    if (root?.isValid) root.destroy();
    if (ui) ui.ruleModalRoot = null;
  }

  private openFireCheckRuleModal() {
    const ui = this.fireCheckEventUI;
    if (!ui || !this.mission) return;
    this.closeFireCheckRuleModal();

    const w = 460;
    const h = 430;
    const root = new Node('FireCheckRuleModal');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    const host = ui.root.parent ?? ui.root;
    host.addChild(root);
    root.setSiblingIndex(host.children.length - 1);

    const { node: backdrop } = createAdaptiveFullscreenMask(
      root,
      'Backdrop',
      new Color(0, 0, 0, 70),
      UI_ROOT_SCALE,
    );
    backdrop.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
      this.closeFireCheckRuleModal();
      ev.propagationStopped = true;
    }, this);

    const panel = new Node('Panel');
    panel.layer = this.node.layer;
    panel.addComponent(UITransform).setContentSize(w, h);
    panel.setPosition(0, 30, 0);
    const pg = panel.addComponent(Graphics);
    drawDicePopupPanel(pg, w, h, MODAL_PANEL_BG, MODAL_PANEL_BORDER);
    panel.on(Node.EventType.TOUCH_END, (ev: EventTouch) => { ev.propagationStopped = true; }, this);
    root.addChild(panel);

    const titleLab = this.makeBattleModalLabel(panel, t('fireCheck.ruleTitle'), 0, h / 2 - 34, w - 86, 34, 24, HUD_TEXT_COLOR);
    titleLab.enableOutline = true;
    titleLab.outlineColor = BATTLE_MODAL_TEXT_OUTLINE;
    titleLab.outlineWidth = 2;
    const close = this.makeBattleRectButton(panel, w / 2 - 28, h / 2 - 24, 34, 34, MODAL_CLOSE_BG,
      () => this.closeFireCheckRuleModal());
    const closeLab = this.makeBattleModalLabel(close.node, 'X', 0, 0, 34, 34, 22, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(closeLab, () => this.closeFireCheckRuleModal());

    const dieX = -w * 0.32;
    const textX = w * 0.14;
    const textW = w * 0.62;
    const profile = fireCheckProfileFor(GameSession.gameMode, this.mission.data.theater);
    let y = h / 2 - 92;
    for (let die = 1; die <= 6; die++) {
      const dieLabel = this.makeDieSquare(panel, dieX, y, 38);
      this.setDieLabelFace(dieLabel, die);
      const effect = resolveFireCheckEffect(profile, die);
      const text = this.fireCheckOutcomePhrase(effect);
      if (effect === 'crewCheck') {
        this.makeDiceRuleButton(panel, textX - textW * 0.5 - 18, y, () => this.openFireCheckCrewRuleModal());
      }
      this.makeBattleModalLabel(panel, text, textX, y, textW, 32, 19, HUD_TEXT_COLOR);
      y -= 46;
    }

    ui.ruleModalRoot = root;
  }

  private openFireCheckCrewRuleModal() {
    const ui = this.fireCheckEventUI;
    if (!ui) return;
    this.closeFireCheckRuleModal();

    const w = 460;
    const h = 430;
    const root = new Node('FireCheckCrewRuleModal');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(CANVAS_W, CANVAS_H);
    const host = ui.root.parent ?? ui.root;
    host.addChild(root);
    root.setSiblingIndex(host.children.length - 1);

    const { node: backdrop } = createAdaptiveFullscreenMask(
      root,
      'Backdrop',
      new Color(0, 0, 0, 70),
      UI_ROOT_SCALE,
    );
    backdrop.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
      this.closeFireCheckRuleModal();
      ev.propagationStopped = true;
    }, this);

    const panel = new Node('Panel');
    panel.layer = this.node.layer;
    panel.addComponent(UITransform).setContentSize(w, h);
    panel.setPosition(0, 30, 0);
    const pg = panel.addComponent(Graphics);
    drawDicePopupPanel(pg, w, h, MODAL_PANEL_BG, MODAL_PANEL_BORDER);
    panel.on(Node.EventType.TOUCH_END, (ev: EventTouch) => { ev.propagationStopped = true; }, this);
    root.addChild(panel);

    const titleLab = this.makeBattleModalLabel(panel, t('fireCheck.crewRuleTitle'), 0, h / 2 - 34, w - 86, 34, 24, HUD_TEXT_COLOR);
    titleLab.enableOutline = true;
    titleLab.outlineColor = BATTLE_MODAL_TEXT_OUTLINE;
    titleLab.outlineWidth = 2;
    const close = this.makeBattleRectButton(panel, w / 2 - 28, h / 2 - 24, 34, 34, MODAL_CLOSE_BG,
      () => this.closeFireCheckRuleModal());
    const closeLab = this.makeBattleModalLabel(close.node, 'X', 0, 0, 34, 34, 22, HUD_TEXT_COLOR);
    this.mirrorBattleModalButtonLabel(closeLab, () => this.closeFireCheckRuleModal());

    const dieX = -w * 0.32;
    const textX = w * 0.14;
    const textW = w * 0.62;
    const rows = [
      t('crew.role.1'),
      t('crew.role.2'),
      t('crew.role.3'),
      t('crew.role.4'),
      t('crew.role.5'),
      t('fireCheck.crewOpenHatchCommander'),
    ];
    let y = h / 2 - 92;
    for (let die = 1; die <= 6; die++) {
      const dieLabel = this.makeDieSquare(panel, dieX, y, 38);
      this.setDieLabelFace(dieLabel, die);
      this.makeBattleModalLabel(panel, rows[die - 1], textX, y, textW, 32, 19, HUD_TEXT_COLOR);
      y -= 46;
    }

    ui.ruleModalRoot = root;
  }

  private buildFireCheckEventPanel(allDice: number[]): {
    root: Node;
    dieLabels: Label[];
    sumLabel: Label;
    bodyLabel: Label;
    confirmButton: Node;
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

    const { node: mask } = createAdaptiveFullscreenMask(
      root,
      'Mask',
      DICE_BACKDROP,
      UI_ROOT_SCALE,
    );
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
    this.makeDiceRuleButton(panel, -pw * 0.5 + 42, ph * 0.5 - 32, () => this.openFireCheckRuleModal());

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
    // The click handler only accepts input in hold, so visibility must follow the same state.
    confirmB.node.active = false;

    return { root, dieLabels, sumLabel: sumL, bodyLabel: bodyL, confirmButton: confirmB.node };
  }

  private advanceFireCheckEventUI(dt: number) {
    const ui = this.fireCheckEventUI;
    if (!ui || ui.stage !== 'roll') return;
    ui.t += dt;
    if (ui.t < DICE_ROLL_DUR) {
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
    ui.confirmButton.active = true;
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
    ui.onComplete();
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
    confirmButton: Node;
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

    const { node: mask } = createAdaptiveFullscreenMask(
      root,
      'Mask',
      DICE_BACKDROP,
      UI_ROOT_SCALE,
    );
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
    confirmB.node.active = false;

    return { root, dieLabels, providerLabel: providerL, resultLabel: resultL, confirmButton: confirmB.node };
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
      if (ui.t < DICE_ROLL_DUR) {
        const tick = Math.floor(ui.t / 0.08) % 6;
        for (const lab of ui.dieLabels) this.setUsCasualtyDieFace(lab, (tick % 6) + 1, false);
        return;
      }
      ui.stage = 'hold';
      ui.t = 0;
      ui.resultLabel.string = t('usCasualty.result', { hits: ui.hits });
      ui.confirmButton.active = true;
    }
    if (ui.stage === 'hold') {
      const hotOn = Math.floor(ui.t / 0.22) % 2 === 0;
      for (let i = 0; i < ui.dieLabels.length; i++) {
        const value = ui.dice[i] ?? '?';
        this.setUsCasualtyDieFace(ui.dieLabels[i], value, value === 6 && hotOn);
      }
    }
  }

  private applyUsCasualtyEventUI(ui: NonNullable<BattleScene['usCasualtyEventUI']>) {
    if (!this.mission || ui.applied) return;
    ui.applied = true;
    this.mission.usCasualties = (this.mission.usCasualties ?? 0) + ui.hits;
    this.battleLogI18n('battleLog.usCasualtyCheck', {
      dice: ui.dice.length > 0 ? ui.dice.join('+') : '-',
      hits: ui.hits,
      cur: this.mission.usCasualties ?? 0,
      limit: ui.limit,
    });
    this.refreshObjectiveHud();
    this.outcome = this.computeOutcome();
    if (this.outcome !== 'ongoing') {
      this.battleLogI18n('battleLog.usCasualtyDefeat', {
        cur: this.mission.usCasualties ?? 0,
        limit: ui.limit,
      });
    }
  }

  private onUsCasualtyConfirmClick() {
    const ui = this.usCasualtyEventUI;
    if (!ui || ui.stage !== 'hold') return;
    this.applyUsCasualtyEventUI(ui);
    this.destroyUsCasualtyEventUI();
    if (this.outcome !== 'ongoing') {
      this.refreshObjectiveHud();
      this.updateOutcomeOverlay();
      return;
    }
    this.endEnemyPhase();
  }

  private destroyTurnEndEventUI() {
    const ui = this.turnEndEventUI;
    if (!ui) return;
    this.turnEndEventUI = null;
    if (ui.sniperRevealKey) {
      this.transientFogRevealKeys.delete(ui.sniperRevealKey);
      this.redraw();
    }
    if (ui.root.isValid) ui.root.destroy();
  }

  /** 敌方阶段全部结束后：先结算回合结束事件，再结算太平洋战场的美军伤亡。 */
  private maybeBeginTurnEndEventOrEndEnemyPhase() {
    if (GameSession.isPvp) {
      this.enterPvpWaitingForOpponent();
      return;
    }
    if (!this.mission) {
      this.endEnemyPhase();
      return;
    }
    this.clearActiveActingUnit();
    this.redraw();
    /** 胜负态在 BattleScene.this.outcome；mission 对象无 outcome 字段，勿用 this.mission.outcome */
    if (this.outcome !== 'ongoing') {
      this.endEnemyPhase();
      return;
    }
    const mid = this.currentTurnEndMissionId();
    if (this.turnEndEventProvider.has(mid)) {
      this.startTurnEndEventFlow(mid);
      return;
    }
    this.continueAfterTurnEndEvent();
  }

  private continueAfterTurnEndEvent() {
    if (this.mission) {
      this.outcome = this.computeOutcome();
      this.updateOutcomeOverlay();
    }
    if (this.outcome !== 'ongoing' || !this.beginPacificUsCasualtyCheckOrContinue()) {
      this.endEnemyPhase();
    }
  }

  private beginPacificUsCasualtyCheckOrContinue(): boolean {
    if (!this.mission) return false;
    this.clearActiveActingUnit();
    this.redraw();
    const limit = this.mission.data.usCasualtyLimit ?? 0;
    if (this.mission.data.theater !== 'pacific' || limit <= 0) return false;

    const dice: number[] = [];
    const providerByKind = new Map<UnitKind, { unitCount: number; diceCount: number }>();
    for (const enemy of this.mission.enemies) {
      if (enemy.destroyed || enemy.faction !== 'japanese' || isAbandonedATGun(enemy) || isAttachedATGunCrew(enemy)) continue;
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
      confirmButton: refs.confirmButton,
      hits,
      limit,
      applied: false,
    };
    if (dice.length > 0) playDiceRoll();
    return true;
  }

  /** Execute a non-player tank machine-gun attack. */
  private tryAIMGAttack(
    actor: Unit,
    aimedTarget?: Unit,
    selectedMachineGun?: TankMachineGunSelection,
  ): boolean {
    if (!this.mission || actor.destroyed || this.outcome !== 'ongoing') return false;
    const target = aimedTarget ?? this.selectAIMGTarget(actor, true);
    if (!target) return false;
    const machineGun = selectedMachineGun ?? this.tankMachineGunSelection(actor, target) ?? undefined;
    if (GameSession.gameMode === 'hardcore' && !machineGun) return false;

    if (!aimedTarget && actor.stats.visionType === 'turreted') {
      if (GameSession.gameMode === 'hardcore') {
        if (machineGun?.rotateTurret) {
          this.startEnemyMachineGunAim(actor, target, machineGun, () => {
            this.tryAIMGAttack(actor, target, machineGun);
          });
        } else {
          this.tryAIMGAttack(actor, target, machineGun);
        }
        return true;
      }
      const requestedDirection = this.turretTargetDirection(actor, target);
      const from = this.currentTurretFacingFor(actor, requestedDirection);
      const traverse = limitTurretTraverse(from, requestedDirection, actor.stats.turretTraverseSpeed);
      this.startEnemyTurretAim(actor, target, () => {
        if (traverse.reached) {
          this.tryAIMGAttack(actor, target);
        } else if (this.outcome === 'ongoing' && (this.phase === 'ally' || this.phase === 'enemy')) {
          this.runNextEnemyStep();
        }
      });
      return true;
    }

    const { map } = this.mission;
    markAmbushAction(actor);
    markAmbushTargeted(target);
    const ctx = {
      attacker: actor,
      target,
      map,
      theater: this.mission.data.theater,
      units: this.allUnits(),
      smokeHexes: this.mission.smokeHexes,
      weather: this.currentWeather(),
      atGunCrewTargets: GameSession.gameMode === 'hardcore',
      ...this.tankMachineGunContext(actor, target, machineGun),
    };
    const maxRoll = maxMGHitRoll(ctx);
    const threshold = mgHitThreshold(ctx);
    const impossible = maxRoll < threshold;
    const report = impossible
      ? {
          dice: [0, 0] as [number, number],
          hitDiceCount: 1,
          hitBonus: 0,
          roll: maxRoll,
          threshold,
          hit: false,
          hitBreakdown: mgHitBreakdown(ctx),
          hitModifiers: mgHitThresholdModifierDetails(ctx),
        }
      : rollMGAttack(ctx, this.rng);
    const actorLabel = actor.sideId === 'enemy'
      ? t('actor.enemyPrefix', { name: unitDisplayName(actor.kind) })
      : t('actor.allyPrefix', { name: unitDisplayName(actor.kind) });
    const targetLabel = target === this.mission.sherman
      ? unitDisplayName(target.kind)
      : target.sideId === 'enemy'
        ? t('actor.enemyPrefix', { name: unitDisplayName(target.kind) })
        : t('actor.allyPrefix', { name: unitDisplayName(target.kind) });
    this.battleLogI18n('battleLog.combatMgAI', {
      actor: actorLabel,
      diceExpr: impossible ? `max ${maxRoll}` : this.mgDiceExpr(report),
      need: report.threshold,
      resultKey: report.hit ? 'battleLog.combatMg.hit' : 'battleLog.combatMg.miss',
    });

    let attackApplied = false;
    const applyAndPresentAttack = () => {
      if (!this.mission) return;
      if (attackApplied) return;
      attackApplied = true;
      this.applyMachineGunAttackResult(target, report);
      if (target.destroyed) this.registerImpactDestroyWreckVisual(target, actor);
      if (this.isUnitVisible(target)) {
        this.spawnFloater(
          target.pos.q,
          target.pos.r,
          report.hit ? t('floater.mgHit') : t('dice.panel.outcomeMiss'),
          report.hit ? new Color(255, 120, 120, 255) : new Color(220, 220, 220, 255),
          { size: 32, dur: report.hit ? 1.0 : 0.9, rise: report.hit ? 48 : 44 },
        );
      }
      this.outcome = this.computeOutcome();
      if (this.outcome !== 'ongoing') {
        this.updateOutcomeOverlay();
        this.clearActiveActingUnit(actor);
      }
      this.updateHUD();
      this.redraw();
      this.refreshStatusPanel();
    };
    const finish = () => {
      applyAndPresentAttack();
      if (this.outcome === 'ongoing' && (this.phase === 'ally' || this.phase === 'enemy')) {
        if (this.enemyDiceUsed.some(used => !used)) {
          const current = this.enemyOrder[this.enemyIndex];
          if (current && !current.destroyed) this.buildEnemyDiceTray(current, { playSort: false });
        }
        this.runNextEnemyStep();
      }
    };

    if (impossible) {
      const revealKey = HexMap.keyOf(actor.pos);
      const hiddenActor = !this.isUnitVisible(actor);
      if (hiddenActor) this.transientFogRevealKeys.add(revealKey);
      this.redraw();
      this.playMachineGunFireCue(actor, target, false);
      this.scheduleOnce(() => {
        if (hiddenActor) this.transientFogRevealKeys.delete(revealKey);
        finish();
      }, hiddenActor ? FOG_ATTACK_REVEAL_DURATION : 0);
      return true;
    }

    const panelReport: AttackReport = {
      dice: report.dice,
      hitDiceCount: report.hitDiceCount,
      hitBonus: report.hitBonus,
      roll: report.roll,
      threshold: report.threshold,
      hit: report.hit,
      hitBreakdown: report.hitBreakdown,
      hitModifiers: report.hitModifiers,
      statusChange: report.hit ? 'destroyed' : 'none',
    };
    this.startDiceShow(panelReport, actorLabel, targetLabel, finish, {
      mg: true,
      attacker: actor,
      target,
      onHold: applyAndPresentAttack,
    });
    return true;
  }

  private startTurnEndEventFlow(missionId: string) {
    if (GameSession.isPvp) return;
    if (!this.mission) return;
    this.clearActiveActingUnit();
    this.redraw();
    const diceCount = this.turnEndEventProvider.diceCount(missionId);
    const primaryDice: number[] = [];
    for (let i = 0; i < diceCount; i++) primaryDice.push(this.rng.d6());
    const sum = primaryDice.reduce((a, b) => a + b, 0);
    const row = this.turnEndEventProvider.rowForSum(missionId, sum);
    if (!row) {
      console.warn(`[TurnEnd] no row for mission=${missionId} sum=${sum}`);
      this.continueAfterTurnEndEvent();
      return;
    }
    const ctx = {
      mission: this.mission,
      rng: this.rng,
      nextEnemyId: () => {
        this.turnEndUnitSeq += 1;
        return `turnend_${this.turnEndUnitSeq}`;
      },
      effectiveRangePenetration: getGameModeConfig(GameSession.gameMode).effectiveRangePenetration,
      sameHexInfantryTankAttack: GameSession.gameMode === 'hardcore',
      directionalDamageCheck: getGameModeConfig(GameSession.gameMode).directionalDamageCheck,
      gunMantletArmor: getGameModeConfig(GameSession.gameMode).gunMantletArmor,
      unitDamageTargetClass: getGameModeConfig(GameSession.gameMode).unitDamageTargetClass,
      weather: this.currentWeather(),
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
      confirmButton: refs.confirmButton,
      bodyKey: prepared.bodyKey,
      bodyParams: prepared.bodyParams,
      effectName,
      effectType: row.effectType,
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
      sniperAttackerId: prepared.sniperAttackerId,
      sniperWillKill: prepared.sniperWillKill,
    };
    // Start after the event panel has been created; both sequences run in
    // parallel while the root-level UI remains above the battle presentation.
    if (row.effectType === 'stuka') {
      this.playStukaFlyover(this.mission.sherman, false, () => {});
    }
    playDiceRoll();
  }

  private buildTurnEndEventPanel(primaryDice: number[], hasExtraDice: boolean): {
    root: Node;
    dieLabels: Label[];
    sumLabel: Label;
    bodyLabel: Label;
    confirmButton: Node;
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

    const { node: mask } = createAdaptiveFullscreenMask(
      root,
      'Mask',
      DICE_BACKDROP,
      UI_ROOT_SCALE,
    );
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
    confirmB.node.active = false;

    return {
      root,
      dieLabels,
      sumLabel: sumL,
      bodyLabel: bodyL,
      confirmButton: confirmB.node,
      extraSection,
      extraCaptionLabel,
      extraDieLabels,
    };
  }

  /**
   * 回合结束「相邻步兵集火」：完整回合结束说明停顿后再逐发串联主炮同款 DiceShow，每段结束补浮字（与 tryEnemyAttack 一致），
   * 每发结果揭示时立即 applyAttack；全部播完再显示回合结束正文与确认，确认只继续流程。
   */
  private beginAdjacentInfantryDiceChain(idx: number) {
    const ui = this.turnEndEventUI;
    if (!ui || !this.mission) return;
    const volleys = ui.adjacentInfantryVolleys;
    if (!volleys || volleys.length === 0) return;

    ui.stage = 'hold';

    if (idx >= volleys.length) {
      ui.root.active = true;
      ui.bodyLabel.string = this.turnEndBodyText(ui.bodyKey, ui.bodyParams);
      ui.confirmButton.active = true;
      return;
    }

    if (idx === 0) {
      ui.root.active = false;
    }

    const v = volleys[idx];
    const actor = t('actor.enemyPrefix', { name: unitDisplayName(v.attackerKind) });
    const sh = this.mission.sherman;
    const attacker = this.mission.enemies.find(unit => unit.id === v.attackerId) ?? null;
    let volleyApplied = false;
    const applyAndPresentVolley = () => {
      if (volleyApplied || !this.turnEndEventUI) return;
      volleyApplied = true;
      this.applyMainGunAttackResult(sh, v.report);
      // The prepared event's apply callback contains the same reports. Once
      // presentation applies them one-by-one, confirmation must not replay them.
      this.turnEndEventUI.effectApplied = true;
      if (sh.destroyed) this.registerImpactDestroyWreckVisual(sh, attacker);
      this.presentAttackResult(actor, v.report, attacker ?? sh, sh);
      this.updateHUD();
      this.redraw();
      this.refreshStatusPanel();
    };

    this.startDiceShow(
      v.report,
      actor,
      unitDisplayName(sh.kind),
      () => {
        applyAndPresentVolley();
        this.beginAdjacentInfantryDiceChain(idx + 1);
      },
      {
        mg: false,
        keepTurnEndPanel: true,
        attackSound: getUnitStats(v.attackerKind, this.mission.data.theater ?? 'europe').attackSound,
        attacker,
        target: sh,
        onHold: applyAndPresentVolley,
      },
    );
  }

  /** 进入当前 extraPhases[extraIdx] 的掷骰动画前：重置问号与可见骰数 */
  private turnEndBodyText(bodyKey: string, bodyParams: Record<string, string | number>): string {
    const params: Record<string, string | number> = { ...bodyParams };
    const resultKey = params.resultKey;
    if (typeof resultKey === 'string') {
      if (resultKey === 'crew.death.kia' && typeof params.roleKey === 'string') {
        params.result = t(resultKey, { role: t(params.roleKey) });
      } else {
        params.result = t(resultKey);
      }
    }
    return t(bodyKey, params);
  }

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
    if (n > 0) playDiceRoll();
  }

  private advanceTurnEndEventUI(dt: number) {
    const ui = this.turnEndEventUI;
    if (!ui || ui.stage === 'hold') return;
    const PAUSE_AFTER_PRIMARY = 0.2;
    const SNIPER_PRESENTATION_DUR = 0.72;
    const PAUSE_BEFORE_ADJACENT_DICE = 1.0;
    const PAUSE_AFTER_EXTRA = 0.35;

    if (ui.stage === 'roll_primary') {
      ui.t += dt;
      if (ui.t < DICE_ROLL_DUR) {
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
      if (ui.effectType === 'sniper' && ui.sniperWillKill && ui.sniperAttackerId && this.mission) {
        const attacker = this.mission.enemies.find(unit => unit.id === ui.sniperAttackerId);
        if (attacker && !attacker.destroyed) {
          if (!this.isUnitVisible(attacker)) {
            ui.sniperRevealKey = HexMap.keyOf(attacker.pos);
            this.transientFogRevealKeys.add(ui.sniperRevealKey);
          }
          ui.root.active = false;
          ui.stage = 'pause_for_sniper';
          ui.t = 0;
          this.playTurnEndSniperShot(attacker, this.mission.sherman, () => {
            if (this.turnEndEventUI !== ui || ui.effectApplied) return;
            try {
              ui.apply();
              ui.effectApplied = true;
            } catch (e) {
              console.error('[TurnEnd] sniper impact apply failed', e);
            }
            // The commander portrait/hatch visual changes on the impact frame,
            // while the event panel remains available for acknowledgement.
            this.refreshStatusPanel();
            this.updateHUD();
            this.redraw();
          });
          return;
        }
      }
      const hasAdjacentDice = (ui.adjacentInfantryVolleys?.length ?? 0) > 0;
      if (!ui.extraPhases.length && !hasAdjacentDice) {
        ui.bodyLabel.string = this.turnEndBodyText(ui.bodyKey, ui.bodyParams);
        ui.stage = 'hold';
        ui.confirmButton.active = true;
        return;
      }
      // 相邻步兵集火：先完整展示回合结束表判定结果（正文），停顿后再逐发展示骰子动画
      if (hasAdjacentDice) {
        ui.bodyLabel.string = this.turnEndBodyText(ui.bodyKey, ui.bodyParams);
        ui.stage = 'pause_before_adjacent_dice';
        ui.t = 0;
        return;
      }
      ui.stage = 'wait_after_primary';
      ui.t = 0;
      return;
    }

    if (ui.stage === 'pause_for_sniper') {
      ui.t += dt;
      if (ui.t < SNIPER_PRESENTATION_DUR) return;
      if (ui.sniperRevealKey) {
        this.transientFogRevealKeys.delete(ui.sniperRevealKey);
        ui.sniperRevealKey = undefined;
        this.redraw();
      }
      ui.root.active = true;
      ui.bodyLabel.string = this.turnEndBodyText(ui.bodyKey, ui.bodyParams);
      ui.stage = 'hold';
      ui.confirmButton.active = true;
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
        ui.bodyLabel.string = this.turnEndBodyText(ui.bodyKey, ui.bodyParams);
        ui.stage = 'hold';
        ui.confirmButton.active = true;
        return;
      }
      const n = phase.dice.length;
      if (ui.t < DICE_ROLL_DUR) {
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
      ui.bodyLabel.string = this.turnEndBodyText(ui.bodyKey, ui.bodyParams);
      if (ui.extraCaptionLabel) ui.extraCaptionLabel.string = '';
      ui.stage = 'hold';
      ui.confirmButton.active = true;
    }
  }

  private onTurnEndConfirmClick() {
    const ui = this.turnEndEventUI;
    if (!ui || ui.stage !== 'hold') return;
    const sum = ui.primaryDice.reduce((a, b) => a + b, 0);
    const applyFn = ui.effectApplied ? () => {} : ui.apply;
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
      if (truckSegments.some(seg => seg.type === 'move' && !this.canMoveToBattleTile(seg.to))) {
        this.destroyTurnEndEventUI();
        this.refreshStatusPanel();
        this.redraw();
        this.continueAfterTurnEndEvent();
        return;
      }
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
        this.continueAfterTurnEndEvent();
      };
      this.enqueueGermanTruckMoveAnims(truck, truckSegments, {
        markLastMoveTruckExitDefeat: defeatAfterExitMove,
      });
      return;
    }

    if (tankReinforceMove && this.mission) {
      if (!this.canMoveToBattleTile(tankReinforceMove.to)) {
        this.destroyTurnEndEventUI();
        this.refreshStatusPanel();
        this.redraw();
        this.continueAfterTurnEndEvent();
        return;
      }
      this.destroyTurnEndEventUI();
      try {
        applyFn();
      } catch (e) {
        console.error('[TurnEnd] apply failed', e);
      }
      this.registerNewlyDestroyedSince(destroyedSnap);
      const unit = [...this.mission.allies, ...this.mission.enemies]
        .find(candidate => candidate.id === tankReinforceMove.unitId);
      if (unit) {
        this.pendingAfterAnimChain = () => {
          this.refreshStatusPanel();
          this.redraw();
          this.continueAfterTurnEndEvent();
        };
        this.enqueueTankReinforceMoveAnim(unit, tankReinforceMove);
        return;
      }
      this.refreshStatusPanel();
      this.redraw();
      this.continueAfterTurnEndEvent();
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
    this.continueAfterTurnEndEvent();
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
      : _attacker.sideId === 'enemy'
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
    if (isFootUnit(_attacker) && isFootUnit(target)) {
      this.battleLogI18n('battleLog.combatMgAI', {
        actor,
        diceExpr: `${report.dice[0]}+${report.dice[1]}=${report.roll}`,
        need: report.threshold,
        resultKey: report.hit ? 'battleLog.combatMg.hit' : 'battleLog.combatMg.miss',
      });
      text = report.hit ? t('floater.mgHit') : t('dice.panel.outcomeMiss');
      color = report.hit ? new Color(255, 120, 120, 255) : new Color(230, 230, 230, 255);
      size = 32;
    } else if (report.smallArms) {
      this.battleLogI18n('battleLog.combatMgAI', {
        actor,
        diceExpr: `${report.dice[0]}+${report.dice[1]}=${report.roll}`,
        need: report.threshold,
        resultKey: report.hit ? 'battleLog.combatMg.hit' : 'battleLog.combatMg.miss',
      });
      text = report.hit ? t('floater.mgHit') : t('dice.panel.outcomeMiss');
      color = report.hit ? new Color(255, 120, 120, 255) : new Color(230, 230, 230, 255);
      size = 32;
    } else if (!report.hit) {
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
        if (report.overpenetrated && report.overpenetrationSuppressedEffects?.length) {
          this.battleLogI18n('battleLog.combat.overpenetration', {
            ...damageParams,
            suppressedEffects: report.overpenetrationSuppressedEffects
              .map(item => t(this.damageEffectLogKey(item)))
              .join(' + '),
          });
        }
        if (report.overpenetrated && !effect && !(report.damageEffects?.length)) {
          const out = overpenetrationOutcomeLabel();
          text = out.text;
          color = out.color;
          size = 44;
        } else if (effect === 'crewCheck') {
          this.battleLogI18n('battleLog.combat.damage', damageParams);
          const cc = report.crewCheck;
          const out = resolvedCrewDeathLabel(report)
            ?? (cc ? crewOutcomeLabel(cc) : damageOutcomeLabel(effect));
          text = out.text;
          color = out.color;
          size = cc?.slot === null ? 36 : 44;
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

    this.outcome = this.computeOutcome();
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
      case 'radio': return 'dmg.outcome.radio';
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
    const { width: backgroundW, height: backgroundH } = visibleSizeInRootSpace(UI_ROOT_SCALE);
    const n = new Node('BattleMenuStyleBG');
    n.layer = this.node.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(backgroundW, backgroundH);
    n.setPosition(0, 0, 0);
    const g = n.addComponent(Graphics);
    const STEPS = 24;
    for (let i = 0; i < STEPS; i++) {
      const tRatio = i / (STEPS - 1);
      const c = tRatio < 0.5
        ? lerpColorMainMenuStyle(MAIN_MENU_STYLE_BG_TOP, MAIN_MENU_STYLE_BG_MID, tRatio * 2)
        : lerpColorMainMenuStyle(MAIN_MENU_STYLE_BG_MID, MAIN_MENU_STYLE_BG_BOTTOM, (tRatio - 0.5) * 2);
      const y = backgroundH / 2 - (i + 1) * (backgroundH / STEPS);
      g.fillColor = c;
      g.rect(-backgroundW / 2, y, backgroundW, backgroundH / STEPS + 1);
      g.fill();
    }
    g.strokeColor = MAIN_MENU_STYLE_DIVIDER;
    g.lineWidth = 1;
    g.moveTo(-backgroundW / 2 + 60, backgroundH / 2 - 80);
    g.lineTo(backgroundW / 2 - 60, backgroundH / 2 - 80);
    g.stroke();
    g.moveTo(-backgroundW / 2 + 60, -backgroundH / 2 + 60);
    g.lineTo(backgroundW / 2 - 60, -backgroundH / 2 + 60);
    g.stroke();
    this.node.addChild(n);
    this.battleBackgroundNode = n;
  }

  private rebuildBackgroundForResolution() {
    if (this.battleBackgroundNode?.isValid) this.battleBackgroundNode.destroy();
    this.battleBackgroundNode = null;
    this.buildMainMenuStyleBattleBackground();
    this.battleBackgroundNode?.setSiblingIndex(0);
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
