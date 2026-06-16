# 关卡编辑器方案草案

## 目标

做一个游戏内关卡编辑器，覆盖现有 `MissionData` 能表达的关卡配置：

- 地图尺寸、格子启用/禁用、地形、建筑、树篱、防波堤、公路方向、桥、出生/增援编号。
- 双方初始配置，包括谢尔曼、友军、敌军、朝向、随机出生、初始状态。
- 任务目标，包括击毁、击毁后撤离、卡车目标、撤离格/撤离方向等。
- 回合结束事件表，包括骰点区间、骰子数量和事件类型。
- 关卡使用的行动表、AI 表、事件表、战区和太平洋伤亡上限等扩展字段。

编辑器有两个用途：

1. 玩家本地 DIY 关卡，存放在本机，不上传服务器。
2. 开发者快速配置官方新关卡，并能导出为当前工程使用的 JSON/CSV 数据。

## 总体原则

- 编辑器草稿格式应当以当前 `MissionData` 为源头，不另造一套不兼容的关卡模型。
- 玩家自定义关卡和官方关卡共用同一套校验、预览、加载逻辑。
- 官方关卡仍可继续使用 `assets/resources/missions/*.json`、`data/turn_end_events.csv`、生成器和 `LevelDB.ts`。
- 玩家关卡不依赖编译期资源和生成器，应当可以从 localStorage 或本地文件导入后直接运行。
- 编辑器先保证数据正确和可玩，再做高级易用性功能，例如批量刷地形、模板库、撤销重做等。

## 现有数据边界

### MissionData

当前关卡 JSON 由 `MissionLoader.loadMission()` 加载，主要字段包括：

- `id`, `name`, `description`
- `theater`: `europe` 或 `pacific`
- `cols`, `rows`, `tiles`
- `sherman`, `allies`, `enemies`
- `enemyStartByDice`, `enemyDiceEidMax`, `shermanStartByDice`
- `objective`
- `usCasualtyLimit`
- `actionTableId`, `aiTableId`, `eventTableId`
- `truckPath`

`tiles[row][col]` 当前使用紧凑字段：

- `t`: 地形简写，例如 `r`, `f`, `m`, `F`, `w`, `c`, `T`, `B`, `H`, `dw`, `a`
- `bd`: 建筑叠加
- `h`: 树篱 6 位边标记
- `bw`: 太平洋防波堤 6 位边标记
- `rd`: 公路视觉方向 6 位边标记
- `rid`, `rf`: 红色增援/步兵随机出生编号和朝向
- `eid`, `ef`: 黑色敌军/坦克随机出生编号和朝向
- `br`: 桥梁两端方向，仅水域格允许

### 回合结束事件

官方关卡现在走：

`data/turn_end_events.csv` -> `tools/buildTurnEndEventDB.js` -> `assets/scripts/core/TurnEndEventDB.ts`

运行时 `BattleScene` 直接从 `TurnEndEventDB.ts` 查询：

- `hasTurnEndEvents(missionId)`
- `turnEndEventsForMission(missionId)`
- `turnEndRowForSum(missionId, sum)`

这对官方关卡很好，但玩家本地关卡不能写入编译期 DB。因此需要把查询层抽成“事件表提供者”：

- 官方关卡：默认查生成 DB。
- 自定义关卡：优先查关卡包内嵌的事件表。
- 开发者导出官方关卡：可把内嵌事件表导出成 CSV 行。

## 建议数据结构

### 自定义关卡包

玩家本地保存的关卡建议使用一个包装格式，而不是裸 `MissionData`：

```ts
interface CustomMissionPackage {
  schemaVersion: 1;
  editorVersion: string;
  savedAt: number;
  source: 'player' | 'developer';
  mission: MissionData;
  turnEndEvents: TurnEndEventRow[];
  editor?: {
    thumbnail?: string;
    notes?: string;
    tags?: string[];
  };
}
```

这样做的好处：

- `mission` 仍然能原样交给 `loadMission()`。
- `turnEndEvents` 能支持玩家关卡，不需要改生成器。
- `editor` 放编辑器自己的元信息，不污染现有战斗逻辑。
- 后续 schema 升级可以做迁移。

### 官方导出格式

开发者导出时提供两种出口：

- `Export Mission JSON`: 生成 `assets/resources/missions/<id>.json` 的内容。
- `Export Turn-End CSV Rows`: 生成可追加到 `data/turn_end_events.csv` 的行。

后续可以再加一键写入工程文件，但 MVP 阶段建议先用“复制 JSON/CSV 文本”或“下载文件”降低风险。

## 编辑器入口

建议在主菜单增加一个独立章节或按钮：

- `DIY` / `关卡编辑器`
- `我的关卡`
- `新建`
- `从现有关卡复制`
- `导入`
- `导出`

进入编辑器后不进入正常战斗流程，单独使用一个 `MissionEditorScene`。原因是编辑器需要大量面板、撤销、验证和草稿保存，和 `BattleScene` 的战斗状态混在一起会很难维护。

## 编辑器界面结构

### 主画布

中心区域显示六角地图，复用或抽取 `BattleScene` 的绘制能力：

- 显示地形、建筑、树篱、防波堤、公路、桥。
- 显示 rid/eid 编号、朝向箭头、撤离箭头、truckPath。
- 显示单位棋子和朝向。
- 支持点击格子、拖拽视图、缩放。

### 左侧工具栏

按编辑模式切换：

- 地形
- 边
- 标记
- 单位
- 目标
- 事件
- 验证

### 右侧属性面板

根据当前选择显示可编辑字段：

- 选中格子：地形、建筑、树篱/防波堤边、公路方向、桥端、rid/rf、eid/ef。
- 选中单位：kind、faction、at、facing、随机出生规则、初始状态。
- 选中目标：目标类型、目标单位、撤离格、撤离方向。
- 选中事件行：sum 区间、diceCount、effectType、备注。

### 顶部/底部状态区

- 关卡名、战区、地图尺寸。
- 保存状态。
- 验证错误数量。
- `试玩`、`保存`、`另存为`、`导入`、`导出`。

## 编辑功能范围

### 地图编辑

MVP 必须支持：

- 设置 `cols` / `rows`，默认仍从 8x6 起步。
- 启用或清空某格，对应 `TileDef | null`。
- 设置基础地形。
- 添加/移除建筑。
- 设置 6 个方向的树篱 `h`。
- 设置 6 个方向的防波堤 `bw`。
- 设置 6 个方向的公路视觉 `rd`。
- 设置桥梁 `br`，并限制只能用于水域格。
- 设置 `rid/rf` 和 `eid/ef`。

后续增强：

- 矩形/刷子/油漆桶。
- 地形模板。
- 自动补齐相邻边显示，例如一格画树篱时可提示邻格对应边。
- 自动检测和高亮不连通道路/桥梁。

### 单位编辑

MVP 必须支持：

- 添加/删除/移动谢尔曼、友军、敌军。
- 设置 `kind`, `faction`, `at`, `facing`。
- 支持敌军固定坐标或随机出生。
- 支持 `startEids` / `startRids` 限定随机出生池。
- 支持谢尔曼 `crew`, `fireLevel`, `turretDamaged`, `hatchOpen`, `loaded`, `paralyzed`。
- 支持 `shermanStartByDice` 和 `enemyStartByDice`。

需要特别处理：

- 太平洋允许日军步兵和日军炮/坦克在开局同格的规则，应由现有 `MissionLoader` 校验逻辑给出最终判定。
- 步兵类单位没有普通坦克朝向行为，但 JSON 仍可能有 facing 用于部分显示/出生。
- `faction` 缺省时可从 `UnitDB` 推断，但编辑器 UI 应显示最终阵营。

### 任务目标编辑

MVP 支持当前 `ObjectiveType`：

- `destroy_all_enemies`
- `destroy_kind`
- `destroy_kind_evac`
- `destroy_truck`

`exit_from_edge` 当前运行时尚未实际实现，编辑器可显示为“保留/暂不可用”，避免玩家创建无法胜利的关卡。

`destroy_kind_evac` 需要编辑：

- `kind` 或 `kinds`
- `evacAt`
- `evacExitDir`

### 回合结束事件编辑

MVP 支持当前 `TurnEndEffectType`：

- `none`
- `sniper`
- `commander_extra`
- `infantry_spawn`
- `adjacent_infantry_fire`
- `mechanical_failure`
- `stuka`
- `panzer3_spawn`
- `panzer4_spawn`
- `tiger_spawn`
- `sherman_spawn`
- `german_truck_move`
- `road_mine`
- `clear_mine`
- `type95_spawn`
- `type97_spawn`
- `heavy_mortar`

事件表编辑规则：

- 每行包含 `sumMin`, `sumMax`, `diceCount`, `effectType`, `notes`。
- 同一关卡内区间不能重叠。
- `sumMin <= sumMax`。
- `diceCount` 默认 2。
- 应提示骰子总和范围，例如 2d6 合法范围 2..12。
- 如果某些事件依赖地图标记，需要联动校验：
  - `infantry_spawn` 需要 `rid`。
  - `panzer*_spawn`, `tiger_spawn` 需要 `eid`。
  - `type95_spawn`, `type97_spawn` 当前使用 `rid`。
  - `german_truck_move` 需要 `truckPath`。
  - `road_mine` 依赖公路/桥触发，不强制要求地图里一定有公路，但应给提示。
  - `clear_mine` 依赖太平洋 clear 格。
  - `heavy_mortar` 依赖非相邻日军步兵作为观察者。

### 行动表和 AI 表

MVP 不建议让玩家编辑行动表和 AI 表本身，只允许选择：

- `actionTableId`
- `aiTableId`
- `eventTableId`

原因：

- 这些表现在由 CSV 生成 DB，属于全局规则。
- 玩家本地关卡如果还要编辑 AI 表，会牵涉运行时 DB 注入、UI 文案、平衡风险，范围会膨胀。

后续增强可以做“高级规则编辑器”，但不放第一阶段。

## 校验系统

编辑器需要一套可复用校验函数，例如 `MissionValidator.validate(package)`。校验结果分三档：

- Error: 不能保存或不能试玩。
- Warning: 可以保存/试玩，但可能不可胜利或体验异常。
- Info: 提示优化建议。

### 必须校验

- `id` 非空，玩家关卡 id 使用 `custom_` 前缀或 UUID，避免和官方关卡冲突。
- `tiles` 尺寸必须匹配 `cols` / `rows`。
- 非空格子的 `t` 合法。
- `h`, `bw`, `rd` 必须是 6 位 0/1。
- `br` 只允许水域格，且两端方向不同。
- `rd` 只允许公路、机场或水域桥。
- `rid/eid` 必须为 1..6。
- 全图 `rid` 不重复，全图 `eid` 不重复。
- `rf/ef/facing/evacExitDir/exitDir` 必须为 0..5。
- 固定坐标单位必须在有效格上。
- 未启用随机出生时，敌军必须有 `at`。
- 启用 `enemyStartByDice` 时，无 `at` 敌军需要对应 `rid` 或 `eid`。
- `shermanStartByDice` 必须与 `enemyStartByDice` 配合，并且谢尔曼不能再填固定 `at`。
- 目标引用的 `kind/kinds` 至少在敌军中存在。
- `destroy_kind_evac` 必须有 `evacAt` 和 `evacExitDir`。
- `truckPath` 必须相邻，且每格是公路或桥。
- 回合结束事件区间不重叠，且落在骰子总和合法范围内。

### 建议校验

- 没有回合结束事件时提示“本关没有回合结束事件”。
- 没有敌军时提示。
- 没有胜利目标或目标无法满足时提示。
- 撤离格不是可进入格时提示。
- `rid/eid` 数量少于随机单位数量时提示。
- 太平洋关卡没有设置 `usCasualtyLimit` 时提示。
- 官方导出时提示需要同步 `LevelDB.ts` 和 `data/lang.csv` 标题。

## 运行时接入

### 自定义关卡列表

新增 `CustomMissionStore`：

- 使用 localStorage 存索引和关卡包。
- 支持保存、删除、重命名、复制。
- 支持导入/导出 JSON。
- 大关卡或缩略图较大时，后续可切 IndexedDB。

建议 key：

- `lone_sherman_custom_mission_index_v1`
- `lone_sherman_custom_mission_<id>_v1`

### GameSession

现在 `GameSession` 主要保存 `selectedMissionPath`。需要扩展为两种来源：

```ts
type MissionSource =
  | { type: 'resource'; missionPath: string }
  | { type: 'custom'; packageId: string };
```

进入战斗时：

- resource: 仍然 `resources.load(missionPath, JsonAsset)`。
- custom: 从 `CustomMissionStore` 读 `CustomMissionPackage`，把 `package.mission` 传给 `loadAndDraw()`。

### BattleScene

需要改造的点：

- 加载 mission 时支持 resource/custom 两种来源。
- 当前 `turnEndEventsForMission(missionId)` 等调用改为从当前 mission 的事件提供者读取。
- 战斗存档需要记录 mission source。
- 自定义关卡胜利不写官方 `MenuProgress` 通关进度。
- 标题显示优先使用 `MissionData.name`，官方关卡仍可通过 `LevelDB.titleKey` 本地化。

### 事件表提供者

建议新增 `TurnEndEventRuntime.ts`：

```ts
interface TurnEndEventProvider {
  has(missionId: string): boolean;
  rows(missionId: string): TurnEndEventRow[];
  rowForSum(missionId: string, sum: number): TurnEndEventRow | null;
  diceCount(missionId: string): number;
}
```

BattleScene 持有当前 provider：

- 官方关卡 provider 包装现有 `TurnEndEventDB.ts`。
- 自定义关卡 provider 从 `CustomMissionPackage.turnEndEvents` 构建。

## 开发者工作流

### 新建官方关卡

1. 在编辑器里“从模板/现有关卡复制”。
2. 修改地图、单位、目标、事件。
3. 点击验证。
4. 点击试玩。
5. 导出 mission JSON。
6. 导出 turn-end CSV 行。
7. 手动或后续一键写入：
   - `assets/resources/missions/<id>.json`
   - `data/turn_end_events.csv`
   - `data/lang.csv`
   - `assets/scripts/core/LevelDB.ts`
8. 运行生成器和校验。

### 玩家 DIY 关卡

1. 主菜单进入“我的关卡”。
2. 新建或导入。
3. 编辑并保存到本机。
4. 点击试玩。
5. 可以导出 JSON 文件给别人。

## 分阶段落地

### 阶段 1：基础数据层和自定义关卡加载

目标：先能运行自定义关卡，不做完整编辑器。

- 新增 `CustomMissionPackage` 类型。
- 新增 `CustomMissionStore`。
- 新增事件表 provider。
- 扩展 `GameSession` mission source。
- `BattleScene` 支持 custom mission。
- 主菜单增加“我的关卡”列表，可导入一个关卡包并试玩。

验收：

- 导入一个包含 mission 和 turnEndEvents 的 JSON 包。
- 能进入战斗。
- 回合结束事件按包内配置运行。
- 自定义关卡胜利不影响官方章节进度。

### 阶段 2：只读预览和验证

目标：让关卡配置错误在编辑前就能看出来。

- 新增 `MissionValidator`。
- 新增 `MissionEditorScene` 框架。
- 加载/显示关卡地图。
- 显示单位、目标、rid/eid、事件表。
- 显示错误/警告面板。

验收：

- 能打开官方 mission 和玩家关卡包。
- 能看到和 BattleScene 基本一致的地图/单位。
- 常见错误能被指出。

### 阶段 3：地图和单位编辑 MVP

目标：完成最核心的 DIY 能力。

- 地形/建筑/边/桥/rid/eid 编辑。
- 单位添加、移动、删除、朝向和状态编辑。
- 保存到 localStorage。
- 试玩。
- 导入/导出。

验收：

- 玩家能从空白地图做出一个可试玩关卡。
- 能从现有关卡复制后改地形和单位。

### 阶段 4：目标和事件编辑

目标：覆盖“当前关卡配置里有的都能配”。

- 目标编辑面板。
- truckPath 编辑。
- 回合结束事件表编辑。
- 事件依赖联动校验。
- 开发者导出 JSON/CSV。

验收：

- 能完整复刻 `mission_01` 或 `mission_pacific_01`。
- 导出的 mission JSON 能被 `MissionLoader` 加载。
- 导出的事件表能驱动回合结束事件。

### 阶段 5：效率功能

目标：提高你后续配新关的速度。

- 从官方关卡一键复制为草稿。
- 批量刷地形、边、道路。
- 模板库：欧洲村庄、太平洋海滩、随机出生点组、标准事件表。
- 撤销/重做。
- 缩略图。
- 一键导出工程补丁。

## 主要风险

- `BattleScene` 当前承担绘制、战斗、HUD、事件流很多职责，编辑器如果直接复用它会变重。建议抽取“地图渲染/单位渲染”能力，而不是把编辑器塞进 BattleScene。
- 回合结束事件现在是生成 DB，玩家关卡必须先解耦事件查询，否则 DIY 关卡无法完整运行。
- 官方关卡标题走 `LevelDB.titleKey` 和 `data/lang.csv`，玩家关卡应直接用 `MissionData.name`，否则本地关卡没法本地化。
- 存档需要记录 mission source，否则继续游戏可能找不到自定义关卡。
- 自定义关卡 schema 需要版本号，后续 `MissionData` 增字段时才可迁移。

## 建议 MVP 范围

第一轮落地建议做到：

- 自定义关卡包可导入/保存/试玩。
- 编辑器能编辑地图、单位、目标、事件。
- 能导出玩家包。
- 能导出官方 mission JSON 和 turn-end CSV 行。
- 行动表/AI 表只允许选择现有 ID，不允许编辑全局规则表。

暂不做：

- 上传/下载服务器。
- 在线分享。
- 玩家编辑 AI 表、行动表、单位属性表。
- 一键写入工程并自动改 `LevelDB.ts` / `lang.csv`。
- 复杂图形编辑器快捷键体系。

这些可以在核心链路稳定后再加。
