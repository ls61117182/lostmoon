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
  | 'road'      // 公路：移动 +1 骰
  | 'field'     // 田地
  | 'mud'       // 泥地：移动 -1 骰
  | 'forest'    // 林地：坦克不可入，阻挡视线
  | 'water';    // 水域：任何单位不可入，不阻挡视线

export interface Tile {
  pos: Axial;
  terrain: TerrainType;
  /** 建筑叠加：非独立地形；坦克可入；视线仅路径中间格阻挡；目标仍 +1 掩护 */
  hasBuilding?: boolean;
  /** 沿 6 条边是否有树篱（按 Direction 索引） */
  hedges?: [boolean, boolean, boolean, boolean, boolean, boolean];
  /** 援军生成位编号（如说明书的红色数字 1..6） */
  reinforceId?: number;
  /** 德军初始位编号（黑色数字 1..6；掷骰出生时全图同编号至多一格） */
  enemyStartId?: number;
  /** 与 `enemyStartId` 同格：该出生点坦克初始朝向（与盘面数字贴近的边一致，0=E…5=NE） */
  enemyStartFacing?: Direction;
}

// ---------- 单位 ----------
export type Faction = 'allied' | 'german';

export type UnitKind =
  | 'sherman'
  | 'tiger'
  | 'panzer4'
  | 'panzer3'
  | 'truck'
  | 'infantry';

export interface UnitStats {
  size: number;            // 体型
  armorFront: number;      // 前装甲
  armorFrontSide: number;  // 前侧装甲
  armorRearSide: number;   // 后侧装甲
  armorRear: number;       // 后装甲
  penetration: number;     // 穿甲值
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
  | 'destroy_kind_evac'     // 先歼指定种类再撤离；若省略 kind 则仅撤离（驶出地图即胜）
  | 'exit_from_edge'        // 从某方向移出地图
  | 'destroy_truck';        // 摧毁卡车（任务 5 特殊）

export interface MissionObjective {
  type: ObjectiveType;
  /** destroy_kind / destroy_kind_evac 用 */
  kind?: UnitKind;
  /** exit_from_edge 用：箭头方向（Direction） */
  exitDirection?: Direction;
  /** destroy_kind_evac：撤离六角格（offset）；谢尔曼在此格且目标格无地形时，沿 evacExitDir 前进或反向后退离场 */
  evacAt?: Offset;
  /** destroy_kind_evac：驶出地图的六向（0=E … 5=NE），须与「前进」或「后退」的位移方向一致 */
  evacExitDir?: Direction;
}

export interface UnitPlacement {
  kind: UnitKind;
  faction: Faction;
  /** Offset 坐标；若关卡 `enemyStartByDice` 为 true 则可省略，由掷骰规则写入（步兵→rid 链，坦克等→eid 链） */
  at?: Offset;
  facing?: Direction;
  /** 已废弃：掷骰出生见关卡 `enemyStartByDice` 与格上 `rid`（步兵）/ `eid`（坦克等） */
  startId?: number;
  /** 任务 6 等：单位以**初始瘫痪**入场（放置「瘫痪」标记）；与回合结束 `mechanical_failure` 同义，由 `MissionLoader` 写入 `unit.paralyzed = true`。 */
  paralyzed?: boolean;
}

export interface MissionData {
  id: string;
  name: string;
  description: string;
  /** 地图列数 / 行数（offset） */
  cols: number;
  rows: number;
  /** 地形矩阵：tiles[row][col] */
  tiles: TileDef[][];
  /** 谢尔曼初始放置 */
  sherman: UnitPlacement;
  /** 德军初始放置 */
  enemies: UnitPlacement[];
  /**
   * 为 true 时：无 `at` 的单位开局掷 1d6，按编号 1..6 链式占位——步兵用格子 `rid`，坦克等非步兵用 `eid`
   * （见 GDD / MissionLoader）；此时 `enemies[].at` / `facing` 可省略。
   */
  enemyStartByDice?: boolean;
  /** 胜负条件 */
  objective: MissionObjective;
  /** 使用的行动表 / AI 表 / 事件表 ID（默认 'standard'） */
  actionTableId?: string;
  aiTableId?: string;
  eventTableId?: string;
  /**
   * 任务 5 等：德军卡车沿 `t: "r"` 公路推进的格序（offset col,row），须两两相邻且均为公路。
   * 首格为卡车初始格，与 `enemies` 中 `kind: "truck"` 的 `at` 一致；回合结束 6–9 行效果 `german_truck_move` 会沿此表推进。
   */
  truckPath?: Offset[];
}

export interface TileDef {
  /**
   * 基底地形简写：r=公路 f=田地 m=泥地 F=林地 w=水域。
   * 旧版 `b` 表示「整格为建筑」已废弃，见 MissionLoader 会转为 f+建筑。
   */
  t: 'r' | 'f' | 'm' | 'F' | 'w' | 'b';
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
  /** 援军编号 1..6（红格；掷骰放置步兵时用，全图不重复） */
  rid?: number;
  /** 敌方坦克起始编号 1..6（黑格；掷骰放置坦克等非步兵时用，全图不重复） */
  eid?: number;
  /**
   * 与 `eid` 同格：该格上掷骰/增援出生的坦克的**初始 facing**，与 `h` **共用轴向索引**：
   * i∈0..5 与 `h[i]`、`HEX_DIRECTIONS[i]` 一致（0=E, …, 5=NE）。树篱**绘制**在 `BattleScene` 中经 `HEDGE_DRAW_EDGE_BY_AXIAL` 再映到 `drawHedgeEdge` 的几何边号。
   */
  ef?: number;
}

/** 有建筑时：田/泥+建筑=农场，公路+建筑=村庄（与 GDD §3.2 一致） */
export function buildingSceneKind(t: Tile): 'farm' | 'village' | null {
  if (!t.hasBuilding) return null;
  return t.terrain === 'road' ? 'village' : 'farm';
}
