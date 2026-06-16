/**
 * 核心数据类型定义 —— 纯 TypeScript，不依赖 Cocos。
 *
 * 命名约定：
 *  - Axial 坐标 (q, r)：内部计算用，方便邻接 / 距离 / 旋转
 *  - Offset 坐标 (col, row)：JSON / 编辑器友好，便于策划阅读
 *  - Direction 0..5：六边形 6 个邻边方向，pointy-top 顺时针从正东开始
 *      0=E, 1=SE, 2=SW, 3=W, 4=NW, 5=NE
 */

// ---------- 坐标 ----------
export interface Axial {
  q: number;
  r: number;
}

export interface Offset {
  col: number;
  row: number;
}

export type Direction = 0 | 1 | 2 | 3 | 4 | 5;

// ---------- 地形 ----------
export type TerrainType =
  | 'road'
  | 'field'
  | 'mud'
  | 'forest'
  | 'water'
  | 'deep_water'
  | 'clear'
  | 'trees'
  | 'beach'
  | 'rocky'
  | 'airstrip';

export interface Tile {
  pos: Axial;
  terrain: TerrainType;
  /** 建筑叠加：非独立地形；坦克可入；视线仅路径中间格阻挡；目标仍 +1 掩护 */
  hasBuilding?: boolean;
  /** 沿 6 条边是否有树篱（按 Direction 索引） */
  hedges?: [boolean, boolean, boolean, boolean, boolean, boolean];
  /** Pacific breakwater edge flags; same axial 0..5 index as hedges. */
  breakwaters?: [boolean, boolean, boolean, boolean, boolean, boolean];
  /**
   * 公路视觉：第 i 位为 true 表示本格与「第 i 向邻格」之间那条格边中点 → 本格心绘有一段道路。
   * 仅对 `terrain==='road'` 或叠桥水域有效；纯视觉字段，不影响移动 / 视线 / 骰子规则。
   * 当且仅当此数组只有 1 位为 true 时，BattleScene 在格心额外绘制圆形道路终点（说明书"道路尽头"图案）。
   * 索引与 `hedges`、`HEX_DIRECTIONS`、`enemyStartFacing` 完全同序（轴向 0..5）。
   */
  roads?: [boolean, boolean, boolean, boolean, boolean, boolean];
  /** 援军生成位编号（如说明书的红色数字 1..6） */
  reinforceId?: number;
  /** Reinforcement/support spawn facing for `reinforceId` (`rf` in mission JSON). */
  reinforceFacing?: Direction;
  /** 德军初始位编号（黑色数字 1..6；掷骰出生时全图同编号至多一格） */
  enemyStartId?: number;
  /** 与 `enemyStartId` 同格：该出生点坦克初始朝向（与盘面数字贴近的边一致，0=E…5=NE） */
  enemyStartFacing?: Direction;
  /**
   * 桥梁两端方向（仅水域格 `terrain==='water'` 上有效；GDD §3.2「桥梁」叠加项）：
   * 桥梁本身不是独立地形，叠加在水域格上 → 该格对坦克 / 卡车变为可入；移动 / 攻击 / 杂项的基础骰数与公路相同（见 `effectiveDiceTerrain`），移动力消耗与公路相同（见 `terrainMoveCost`）。
   * 两端方向 `[a, b]` 决定哪两条格边「贯通」：车辆只能从这两个方向之一驶入 / 驶出本格，其余 4 条边仍视为水面。
   * 关卡 JSON 字段：`TileDef.br = [a, b]`；MissionLoader 强校验「水域基底 + 两个 0..5 不重复方向」。
   */
  bridgeEnds?: [Direction, Direction];
}

/** 是否在水域格上叠加了桥梁（GDD §3.2 桥梁规则的统一判定）。 */
export function tileHasBridge(tile: Tile | undefined | null): boolean {
  return !!tile && tile.terrain === 'water' && !!tile.bridgeEnds;
}

/** Pacific beach hexes do not allow smoke, concealment, or hull-down cover. */
export function tileForbidsSmokeOrConcealment(tile: Tile | undefined | null): boolean {
  return tile?.terrain === 'beach';
}

/**
 * 计算掷骰 / 移动力使用的「等效地形」：
 * - 水域 + 桥梁 → 视为公路（GDD §3.2「骰子规则与公路相同」）；
 * - 其余情况返回基底地形本身。
 *
 * 任何「按地形读骰子基数 / 移动力」的代码（`actionDicePool` / `terrainMoveCost` / tileInspect 面板）必须经过本函数，
 * 才能让"水域+桥梁"既不可入水又不会读到水域那一行 0 颗骰子的死锁配置。
 */
export function effectiveDiceTerrain(tile: Tile | undefined | null): TerrainType {
  if (!tile) return 'field';
  if (tileHasBridge(tile)) return 'road';
  return tile.terrain;
}

// ---------- 单位 ----------
export type Faction = 'allied' | 'german' | 'japanese';

export type Theater = 'europe' | 'pacific';

export type UnitKind =
  | 'sherman'
  | 'tiger'
  | 'panzer4'
  | 'panzer3'
  | 'truck'
  | 'infantry'
  | 'type95'
  | 'type97'
  | 'at_gun'
  | 'japanese_infantry'
  | 'heavy_artillery'
  /**
   * 高级军官（任务 8 起）：与步兵同属「徒步类」单位（size=0、不可朝向、机枪打、不参与坦克 AI），
   * 但在关卡目标上是与 `infantry` **互不替代**的独立 `kind`——避免与回合结束 5–6 spawn 的普通步兵
   * 混淆。视觉上由 `BattleScene` 在所在格绘制红色边框 + 单位身周红色光环，与说明书原图一致。
   */
  | 'officer';

/**
 * 「徒步类」单位（步兵 / 军官）共享判定：
 * - 大多数地方原本写 `kind === 'infantry'`（机枪目标 / 相邻齐射 / 渲染分支 / AI 排除等），
 *   引入 `officer` 后这些判定都应改用本 helper，否则官官就会被坦克类逻辑误处理；
 * - **唯一例外**：`infantry_spawn` 事件 spawn 出来的单位 kind 始终为 `'infantry'`（不会复活军官），
 *   `Objective.allEnemiesOfKindDestroyed(mission, 'officer')` 等按 kind 精确判定的位置不应换成本 helper。
 */
export function isFootKind(kind: UnitKind): boolean {
  return kind === 'infantry' || kind === 'officer';
}

export function isFootUnit(u: { kind: UnitKind }): boolean {
  return isFootKind(u.kind);
}

export interface UnitStats {
  faction: Faction;          // 阵营
  size: number;            // 体型
  armorFront: number;      // 前装甲
  armorFrontSide: number;  // 前侧装甲
  armorRearSide: number;   // 后侧装甲
  armorRear: number;       // 后装甲
  penetration: number;     // 穿甲值
  usCasualtyDice: number;
  moveSound: string;        // resources 下无扩展名音效路径；空字符串不播放
  attackSound: string;      // resources 下无扩展名音效路径；空字符串不播放
  infantryTankCoordination: number; // 给同格步兵提供的步坦协同命中修正；0 表示不提供
}

export interface Unit {
  id: string;
  kind: UnitKind;
  faction: Faction;
  pos: Axial;
  /** 步兵无朝向时为 null */
  facing: Direction | null;
  stats: UnitStats;
  // 状态
  damaged?: boolean;        // 德军坦克 MVP：首次受伤 / 起火中；谢尔曼不用此位（着火见 fireLevel）
  destroyed?: boolean;      // 摧毁。被摧毁后单位不再行动，且不阻塞移动（视作残骸）
  fireLevel?: number;       // 着火程度（仅谢尔曼）
  turretDamaged?: boolean;  // 炮塔受损
  paralyzed?: boolean;      // 痛痪
  hidden?: boolean;         // 隐蔽
  smoked?: boolean;         // 有烟雾掩护
  loaded?: boolean;         // 主炮已装填
  hatchOpen?: boolean;      // 车长打开舱盖
  crew?: ShermanCrew;       // 仅谢尔曼
}

// ---------- 谢尔曼乘员 ----------
/** 1=车长, 2=装填手, 3=炮手, 4=驾驶员, 5=副驾驶 */
export type CrewSlot = 1 | 2 | 3 | 4 | 5;

export interface ShermanCrew {
  commander: boolean;   // 1
  loader: boolean;      // 2
  gunner: boolean;      // 3
  driver: boolean;      // 4
  coDriver: boolean;    // 5
}

// ---------- 任务 ----------
export type ObjectiveType =
  | 'destroy_all_enemies'   // 摧毁所有德军单位
  | 'destroy_kind'          // 摧毁某种单位
  | 'destroy_kind_evac'     // 先歼指定种类（`kind` 或 `kinds`）再撤离；若二者皆省略则仅撤离（驶出地图即胜）
  | 'exit_from_edge'        // 从某方向移出地图
  | 'destroy_truck';        // 摧毁卡车（任务 5 特殊）

export interface MissionObjective {
  type: ObjectiveType;
  /** destroy_kind / destroy_kind_evac 用 */
  kind?: UnitKind;
  /**
   * destroy_kind_evac 专用：须将所列 **每一种** kind 的敌方单位全部击毁后，才允许撤离结算。
   * 与 `kind` 二选一——若 `kinds` 非空则优先用 `kinds`，忽略单独的 `kind`（典型：任务 9「歼灭全部德军坦克」= 虎式 + IV 号，步兵不计入）。
   */
  kinds?: UnitKind[];
  /** exit_from_edge 用：箭头方向（Direction） */
  exitDirection?: Direction;
  /** destroy_kind_evac：撤离六角格（offset）；谢尔曼在此格且目标格无地形时，沿 evacExitDir 前进或反向后退离场 */
  evacAt?: Offset;
  /** destroy_kind_evac：驶出地图的六向（0=E … 5=NE），须与「前进」或「后退」的位移方向一致 */
  evacExitDir?: Direction;
}

export interface UnitPlacement {
  kind: UnitKind;
  faction?: Faction;
  /** Offset 坐标；若关卡 `enemyStartByDice` 则可省略（步兵→rid 链，坦克等→eid 链）；谢尔曼在 `shermanStartByDice` 时亦可省略 */
  at?: Offset;
  /** 与 `at` 同：谢尔曼在 `shermanStartByDice` 时由格上 `ef` 写入 */
  facing?: Direction;
  /** 已废弃：掷骰出生见关卡 `enemyStartByDice` 与格上 `rid`（步兵）/ `eid`（坦克等） */
  startId?: number;
  /** enemyStartByDice 下非步兵单位可选：只从这些 eid 黑格中随机开局。 */
  startEids?: number[];
  /** enemyStartByDice 下可选：从这些 rid 援军/蓝编号格中随机开局。 */
  startRids?: number[];
  /** 任务 6 等：单位以**初始瘫痪**入场（放置「瘫痪」标记）；与回合结束 `mechanical_failure` 同义，由 `MissionLoader` 写入 `unit.paralyzed = true`。 */
  paralyzed?: boolean;
  /** 谢尔曼专用：乘员存活；键缺省视为 `true`（存活），显式 `false` 表示该槽位开局阵亡 */
  crew?: Partial<ShermanCrew>;
  /** 谢尔曼专用：着火程度；缺省 0 */
  fireLevel?: number;
  /** 谢尔曼专用：炮塔受损 */
  turretDamaged?: boolean;
  /** 谢尔曼专用：舱盖开启 */
  hatchOpen?: boolean;
  /** 谢尔曼专用：主炮是否已装填；缺省 false（未装填） */
  loaded?: boolean;
}

export interface MissionData {
  id: string;
  name: string;
  description: string;
  theater?: Theater;
  /** 地图列数 / 行数（offset） */
  cols: number;
  rows: number;
  /** 地形矩阵：tiles[row][col] */
  tiles: TileDef[][];
  /** 谢尔曼初始放置 */
  sherman: UnitPlacement;
  /** 玩家阵营 AI 队友；玩家不可直接控制 */
  allies?: UnitPlacement[];
  /** 德军初始放置 */
  enemies: UnitPlacement[];
  /**
   * 为 true 时：无 `at` 的单位开局掷 1d6，按编号 1..6 链式占位——步兵用格子 `rid`，坦克等非步兵用 `eid`
   * （见 GDD / MissionLoader）；此时 `enemies[].at` / `facing` 可省略。
   */
  enemyStartByDice?: boolean;
  /**
   * 仅影响**开局** `enemyStartByDice` 的坦克链式占位：掷 1d6 后只在 **eid 1..此值** 上轮换尝试（默认 6）。
   * 任务 12 填 **4** 时虎式与两辆 III 号仅占 1～4 号黑格；**eid 5、6** 仍可存在于地图上供 `panzer3_spawn` 等回合结束事件使用。
   */
  enemyDiceEidMax?: number;
  /**
   * 任务 11 等：谢尔曼开局亦掷 1d6，在 **eid 1..6 黑格**链式择空位（与德军坦克共用同一套 eid 表、不重掷）。
   * 为 true 时须同时 `enemyStartByDice: true`，且地图上须有互不重复的 eid 1..6；`sherman` 可省略 **`at` 与 `facing`**（由掷骰写入格上 `ef`）。
   */
  shermanStartByDice?: boolean;
  /** 胜负条件 */
  objective: MissionObjective;
  /** Pacific: US casualty defeat threshold. Omit or set <=0 to disable. */
  usCasualtyLimit?: number;
  /** 使用的行动表 / AI 表 / 事件表 ID（默认 'standard'） */
  actionTableId?: string;
  aiTableId?: string;
  eventTableId?: string;
  /**
   * 任务 5 等：德军卡车沿 `t: "r"` 公路推进的格序（offset col,row），须两两相邻且均为公路。
   * 首格为卡车初始格，与 `enemies` 中 `kind: "truck"` 的 `at` 一致；回合结束 6–9 行效果 `german_truck_move` 会沿此表推进。
   * **末格**可加 `exitDir`：卡车在末格继续推进时，沿该方向再走一格驶离地图（替代原本读取 `truck.facing`）；
   * 仅最后一格的 `exitDir` 会被使用，中间格上写了也会被忽略。
   */
  truckPath?: TruckPathEntry[];
}

/**
 * `truckPath` 的格条目：可写为 `Offset` 形式 `{ col, row }`；
 * **仅最后一格**可附加 `exitDir`（六向 0=E…5=NE），用于强制卡车从该格沿此方向驶出地图。
 */
export interface TruckPathEntry extends Offset {
  /** 仅末格生效：卡车从该格沿此方向再走 1 格驶出地图（必越界 → 触发 `truckEscapeDefeat` 判负）。 */
  exitDir?: Direction;
}

export interface TileDef {
  /**
   * 基底地形简写：r=公路 f=田地 m=泥地 F=林地 w=水域。
   * 旧版 `b` 表示「整格为建筑」已废弃，见 MissionLoader 会转为 f+建筑。
   */
  t: 'r' | 'f' | 'm' | 'F' | 'w' | 'b' | 'c' | 'T' | 'B' | 'H' | 'dw' | 'a';
  /**
   * 建筑叠加在基底上：`1` 表示有建筑（坦克可进入；命中+1；视线仅路径「中间格」阻挡）。
   * 田/泥+建筑在任务表述上为「农场」，公路+建筑为「村庄」。
   */
  bd?: 1;
  /**
   * 树篱：6 位，仅 `0`/`1`；**第 i 位**与 `HexGrid.HEX_DIRECTIONS[i]` 同义（0=E, 顺时针 1=SE … 5=NE）：
   * 为 `1` 表示本格与**第 i 向邻格**之间那条格边外缘有树篱，与 `HexGrid.hedgeFlagsFromMapJson` 一致。
   */
  h?: string;
  /** Pacific breakwater edge flags: 6 chars, same axial index as h. */
  bw?: string;
  /**
   * 公路绘制方向：6 位 `0/1`，与 `h` 共享轴向索引（0=E, 顺时针 1=SE … 5=NE）。
   * `1` 表示本格内沿"第 i 向邻边中点 → 格心"绘制一段道路条带。仅 `t==='r'` 或水域+桥梁允许配置（其它基底 MissionLoader 抛错）。
   * 当数组中只有 1 位为 `1` 时，BattleScene 会在格心额外绘制圆形"道路尽头"图案；`0` 个或 ≥2 个不画圆。
   * 纯视觉字段，不影响移动 / 视线 / 骰子；缺省时本格不绘制道路条带（视觉退化为整格平涂的公路色）。
   */
  rd?: string;
  /** 援军编号 1..6（红格；掷骰放置步兵时用，全图不重复） */
  rid?: number;
  /** `rid` support spawn facing; same 0..5 direction index as `ef`. */
  rf?: number;
  /** 敌方坦克起始编号 1..6（黑格；掷骰放置坦克等非步兵时用，全图不重复） */
  eid?: number;
  /**
   * 与 `eid` 同格：该格上掷骰/增援出生的坦克的**初始 facing**，与 `h` **共用轴向索引**：
   * i∈0..5 与 `h[i]`、`HEX_DIRECTIONS[i]` 一致（0=E, …, 5=NE）。树篱**绘制**在 `BattleScene` 中经 `HEDGE_DRAW_EDGE_BY_AXIAL` 再映到 `drawHedgeEdge` 的几何边号。
   */
  ef?: number;
  /**
   * 桥梁两端方向 `[a, b]`（GDD §3.2 桥梁；运行时归一为 `Tile.bridgeEnds`）：
   * - **仅水域格** (`t === "w"`) 允许配置；其他基底基为非法，MissionLoader 抛错；
   * - `a`、`b` 须为 0..5 整数（0=E, 1=SE, 2=SW, 3=W, 4=NW, 5=NE）且**互不相同**；
   * - 配置后该水域格视为可通行，骰子基数与移动力按公路计算；车辆仅能从 `a` / `b` 两端方向驶入 / 驶出本格。
   */
  br?: [number, number];
}

/** 有建筑时：田/泥+建筑=农场，公路+建筑=村庄（与 GDD §3.2 一致） */
export function buildingSceneKind(t: Tile): 'farm' | 'village' | null {
  if (!t.hasBuilding) return null;
  return t.terrain === 'road' ? 'village' : 'farm';
}
