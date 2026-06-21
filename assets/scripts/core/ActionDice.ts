/**
 * 行动阶段骰子逻辑 —— 纯 TypeScript，不依赖 Cocos。
 *
 * GDD §3.6.1：掷骰数 = **当前子阶段（移动 / 攻击 / 杂项）× 谢尔曼当前格地形** 的基础值，
 * 再叠加该阶段适用的乘员存活 / 舱盖修正，最后经配置的上下限钳制。
 * 玩家进入某一子阶段时重摇该数量的骰，再按骰面拖入对应行动槽。
 *
 * 本文件只负责薄薄一层业务胶水：
 *   1) `actionDicePool()`：按 GDD 公式计算本阶段应掷多少颗骰；
 *   2) `classifyMoveDie()` / `classifyAttackDie()`：把单颗骰点数映射到当前阶段动作；
 *   3) `rollActionDice()`：用给定 RNG 掷 N 颗 d6。
 *
 * **所有数值与映射均来自 `data/player_action_table.csv` + `data/player_dice_pool.csv`，
 *   由 `tools/buildPlayerActionDB.js` 生成 `PlayerActionDB.ts`。** 本文件不再写任何
 *   骰面→动作的硬编码，也不再写 3 / 5 / +1 这类魔法常量。
 *
 * 不触及 Unit / Map，这样以后写单元测试可以直接跑。
 */

import { RNG } from './Dice';
import {
  ActionDiceSubPhase,
  PLAYER_ACTION_BY_PIP,
  PLAYER_DICE_POOL,
  AttackDieAction as AttackDieActionDB,
  MiscDieAction as MiscDieActionDB,
  MoveDieAction as MoveDieActionDB,
} from './PlayerActionDB';
import { ShermanCrew, TerrainType } from './types';

// ---------- 动作分类 ----------

/**
 * 移动阶段骰面含义（见 `data/player_action_table.csv` move 列）。
 *
 * MVP 实际消费的取值：
 *   - 'none'    → 本骰弃掉
 *   - 'turn'    → 转向 1 次（60°，顺时针 / 逆时针由玩家选）
 *   - 'drive'   → 前进 1 格（前格合法且地形可入）
 *   - 'reverse' → 后退 1 格（后格合法且地形可入）
 *
 * `'driver_drive_codriver_turn'`（对子：驾驶员前进 / 副驾驶转向，二选一）
 *   不由 `classifyMoveDie` 单颗骰映射返回，而是由 BattleScene 在同点搭档检测
 *   （`findDoublesPartner`）时动态追加到 popover 菜单。
 *
 * `'start'`（启动检定）为未来扩展值，MVP 遇到按 `'none'` 处理。
 */
export type MoveDieAction = MoveDieActionDB;

/**
 * 攻击阶段骰面含义（见 `data/player_action_table.csv` attack 列）。
 *
 * MVP 实际消费的取值：
 *   - 'none'   → 本骰弃掉
 *   - 'reload' → 装填 1 次
 *   - 'mg'     → 机枪射击（相邻步兵）
 *   - 'gun'    → 主炮射击（必须已装填）
 *
 * `'gunner_gun_or_reload'` 代表"炮手主炮射击 / 装填手装填（二选一）"：
 *   - 在杂项阶段 1 点时由 `classifyMiscDie` 返回（单骰消费）；
 *   - 在攻击阶段对子时由 BattleScene 动态追加"装填手装填（+同点骰）"
 *     和"炮手主炮射击（+同点骰）"两项，消耗 2 颗骰。
 */
export type AttackDieAction = AttackDieActionDB;

/**
 * 杂项阶段骰面含义（见 `data/player_action_table.csv` misc 列）。
 *
 * MVP 实际消费：
 *   - 'gunner_gun_or_reload' (1)：炮手主炮射击 / 装填手装填，二选一弹窗
 *   - 'codriver_mg'          (2)：副驾驶机枪射击相邻步兵（MVP 步兵未实装，占位跳过）
 *   - 'driver_turn_or_drive' (3)：驾驶员 转向 / 前进，弹窗 3 选项
 *   - 'repair'               (4)：修复炮塔或机动（两者都有则弹窗二选一）
 *   - 'smoke_or_repair'      (5)：烟雾 / 修复，二选一（烟雾系统 MVP 未实装，仅弹占位浮字）
 *   - 'fire_suppress'        (6)：着火程度 -1
 *   - 'concealment'   (doubles)：隐蔽 —— 由 BattleScene 在检测到任意同点搭档时
 *                                  动态追加"进入隐蔽（+同点骰）"菜单项，消耗 2 颗骰
 *
 * 所有具体"是否可执行"的判定都在 `BattleScene` 里按当前单位状态再做一次；
 * 本枚举只负责"骰面 → 动作类别"的映射。
 */
export type MiscDieAction = MiscDieActionDB;

export function classifyMoveDie(pt: number): MoveDieAction {
  const row = PLAYER_ACTION_BY_PIP[pt as 1 | 2 | 3 | 4 | 5 | 6];
  return row ? row.move : 'none';
}

export function classifyAttackDie(pt: number): AttackDieAction {
  const row = PLAYER_ACTION_BY_PIP[pt as 1 | 2 | 3 | 4 | 5 | 6];
  return row ? row.attack : 'none';
}

export function classifyMiscDie(pt: number): MiscDieAction {
  const row = PLAYER_ACTION_BY_PIP[pt as 1 | 2 | 3 | 4 | 5 | 6];
  return row ? row.misc : 'none';
}

// ---------- 行动骰池 ----------

export type { ActionDiceSubPhase };

export interface ActionDicePoolOpts {
  /** 当前进入的子阶段（与底部按钮一致） */
  subPhase: ActionDiceSubPhase;
  /** 谢尔曼当前所在格的地形 */
  terrain: TerrainType;
  /** 车长舱盖是否打开（杂项始终依赖；移动 / 攻击可由模式规则放宽） */
  hatchOpen: boolean;
  /** 移动 / 攻击阶段是否允许车长存活但关舱时仍获得车长加骰 */
  commanderBonusWithoutOpenHatch?: boolean;
  /** 五名乘员存活标记；缺省按全 false 处理 */
  crew: ShermanCrew;
}

/**
 * 本阶段应掷骰数。`data/player_dice_pool.csv` → `PLAYER_DICE_POOL`：
 *   子阶段 × 地形基础、各阶段修正系数、cap_min / cap_max 均来自配置。
 */
export function actionDicePool(opts: ActionDicePoolOpts): number {
  const cfg = PLAYER_DICE_POOL;
  const row = cfg.baseByPhaseTerrain[opts.subPhase];
  let n = typeof row[opts.terrain] === 'number' ? row[opts.terrain] : 0;

  /** 舱盖加骰仅在车长存活时成立（车长阵亡后 `hatchOpen` 可能未及时清位） */
  const hatchOpenForDice = !!opts.hatchOpen && !!opts.crew.commander;
  const commanderBonusForMoveAttack = !!opts.crew.commander
    && (!!opts.hatchOpen || !!opts.commanderBonusWithoutOpenHatch);

  if (opts.subPhase === 'movement') {
    if (opts.crew.driver) n += cfg.moveMods.driver;
    if (opts.crew.coDriver) n += cfg.moveMods.codriver;
    if (commanderBonusForMoveAttack) n += cfg.moveMods.hatch;
  } else if (opts.subPhase === 'attack') {
    if (opts.crew.gunner) n += cfg.attackMods.gunner;
    if (opts.crew.loader) n += cfg.attackMods.loader;
    if (commanderBonusForMoveAttack) n += cfg.attackMods.hatch;
  } else {
    if (hatchOpenForDice) n += cfg.miscMods.hatch;
  }

  return Math.max(cfg.capMin, Math.min(cfg.capMax, n));
}

/** 用给定 RNG 掷 count 颗 d6，返回长度为 count 的点数数组。 */
export function rollActionDice(rng: RNG, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(rng.d6());
  return out;
}
