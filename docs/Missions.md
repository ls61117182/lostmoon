# 任务手册

本文档收录说明书中各个正式任务的目标、初始设置与配套地图。数据文件位于
`assets/resources/missions/mission_XX.json`。

---

## 任务 1：村庄

> 说明书 P26。对应数据：`assets/resources/missions/mission_01.json`。

### 目标

- 摧毁 **2 辆 IV 号坦克**；
- 随后将谢尔曼开到 **撤离格**（`evacAt`：`col=5, row=6`），沿撤离六向 **`evacExitDir = 0`（正东）** 驶出地图：可 **朝东前进**（邻格无地形即胜利），或 **朝西后退**（后退的位移方向仍为东，与 `evacExitDir` 一致）。

### 初始设置

- **谢尔曼**：放置在地图 **左下公路格**（黑色箭头示意），朝向依关卡数据。
  - 当前 `mission_01.json` 固定为 `col=1, row=6, facing=5 (NE)`；具体以 JSON 为准。
- **2 辆 IV 号坦克**：在带 **`eid`** 的格子中按规则书随机选位；当前 JSON 为
  固定布置（见下文物图），以 `mission_01.json` 为准。
- **援军**：红色数字格用字段 **`rid`** 标注；当前图中数量与位置以 JSON 为准。
- **步兵 / 机枪测试**：规则书任务 1 不含步兵。机枪掷骰动画在后续任务或
  测试场景中验证；本任务保持"只打坦克"的纯净对局。

### 胜负条件（代码实现）

- 使用 `objective.type = "destroy_kind_evac"`、`kind = "panzer4"`，并配置
  `evacAt`（offset 撤离六角格）与 `evacExitDir`（驶出地图的六向，0=E … 5=NE）。
- 先击毁全部 IV 号；再于撤离格上，沿 `evacExitDir` 执行 **前进** 或等效的
  **后退**（位移方向与 `evacExitDir` 一致），且 **目标六角不在地图内**（`HexMap.has` 为假）时，记 `shermanEvacuated` 并判胜。
- 失败条件：谢尔曼被摧毁（`checkOutcome` 优先判负）。

### 回合结束事件（说明书任务 1 · 掷 **2d6**）

以下为本关规则书页「回合结束事件」的完整表述，供策划与程序对照；**实现以关卡事件表 / 代码为准**（当前 JSON 可能仍为通用 `eventTableId`，迁移时以此表为验收基准）。

| 2d6 | 事件 | 规则要点 |
|-----|------|----------|
| **2–3** | **狙击手射击** | 若**车长打开舱盖**，且谢尔曼处于**任意距离**上德军步兵的**视线（LOS）**内，则**车长阵亡**。 |
| **4** | **车长额外行动** | 若**车长未阵亡**，玩家从下列三项中**择一执行**：**装填**、**修复**、**灭火**。 |
| **5–6** | **德军步兵** | 掷 **1d6**：在与点数对应的**红色数字格**上放置 1 个德军步兵；该格**不得**已有谢尔曼或步兵。**不重掷**。 |
| **7–8** | **所有相邻德军步兵攻击** | 与谢尔曼**相邻**的全体德军步兵各攻击一次。命中：按规则书「1. 能否命中」**距离 1**；伤害：按「2. 造成伤害」**穿甲 1**（装甲值依表）。 |
| **9** | **机械故障** | 谢尔曼进入**瘫痪**；若已瘫痪则**不变**（或按说明书「已有则不重复」处理）。 |
| **10** | **斯图卡** | ① 若**车长打开舱盖**：先掷 **2d6**，合计 **≥6** 则斯图卡被击落，本事件其余步骤跳过或按书处理。② 若未击落（或舱盖关闭）：再掷 **2d6** 判定是否命中谢尔曼，合计 **≥8** 为命中。③ 命中后的伤害掷骰：按「2. 造成伤害」使用 **装甲 4 / 穿甲 1**。 |
| **11+** | **III 号坦克** | 掷 **1d6**：在与点数对应的**黑色数字格**上放置 1 辆 III 号；该格**不得**已有坦克；车体**朝向数字所在的那条地图边**。**不重掷**。 |

> **与 GDD §3.8 通用表的区别**：通用 GDD 表为全战役占位；**任务 1** 以本表为准（例如 **4 = 车长额外行动**、**5–6 = 步兵**、**9 = 机械故障**、**11+ = III 号于黑格** 等与 §3.8 行内容不同）。后续若 `mission_01.json` 增加专属事件表，应与本表逐行对齐。

### 地图配置说明（与 `mission_01.json` 一致：当前 **7 列 × 7 行**）

坐标系：`tiles[row][col]`，**odd-r** 偏移；`null` 表示该格不存在（不渲染、单位不可进入）。

#### 基底地形字段 `t`（必填，五选一）

程序里**不再有单独的「建筑地形」**；建筑叠在基底上，见下文 **`bd`**。
`MissionLoader` 将简写映射为 `TerrainType`：

| 字符 | 含义 |
| ---- | ---- |
| `r` | 公路（谢尔曼掷骰数见 GDD **§3.6.1**，依子阶段与乘员状态查 `player_dice_pool.csv`；敌坦 AI 仍见 `enemy_ai_dice.csv`） |
| `f` | 田地 |
| `m` | 泥地 / 碎石 |
| `F` | 林地（坦克不可入；**中间格**阻挡视线） |
| `w` | 水域（任何单位不可入；**不阻挡视线**） |

#### 建筑叠加字段 `bd`（可选）

- 在任意合法基底格上增加 **`"bd": 1`**，表示该格**有建筑**。运行时六角格**仍只按基底 `t` 上色**，格心再叠加**房屋矢量图案**（不改变整格地形底色）。
- **规则语义**（与 GDD §3.2、程序一致）：
  - **移动**：坦克**可以进入**带建筑的格子（移动消耗仍按基底 `t`：公路/田地/泥地等）。
  - **视线**：从建筑**以外**的格子发出的射线，若路径**中间**经过带建筑格则**被遮挡**；射线**起点或终点**在建筑格时，该格**不**截断视线（建筑格内的单位可作为**起点**向外攻击其它单位）。
  - **射击**：**目标**格有建筑时，命中所需 **+1**（掩护）。
- **任务表述上的称呼**（便于策划文案，非额外枚举）：**田地或泥地**上叠建筑 → **农场**；**公路**上叠建筑 → **村庄**。
- **示例**（节选）：

```json
{ "t": "f", "bd": 1, "h": "001000" }
```

```json
{ "t": "r", "bd": 1, "rid": 3 }
```

#### 旧数据兼容：`t: "b"`（不推荐新关使用）

- 历史关卡若仍写 **`"t": "b"`**，加载器会视为 **`"t": "f"` + 建筑**（即田地上的农场建筑）。
- 新做地图请一律改为 **`t` + `bd: 1`**，以免歧义。

#### 其它常用字段

| 字段 | 说明 |
| ---- | ---- |
| `h` | 树篱：6 位 `0/1`，**第 i 位（0 基）**与 `HEX_DIRECTIONS[i]` 及 `ef` **同一轴向**编号：0=E, 顺时针 1=SE … 5=NE；`1` 表示本格与**第 i 向邻格**之间那段格边外缘有树篱。解析见 `hedgeFlagsFromMapJson`；`BattleScene` 渲染经 `HEDGE_DRAW_EDGE_BY_AXIAL`。本仓库内 `mission_*.json` 的 `h` 已用 `HexGrid.migrateHedgeHFromLegacyDraw` 与旧版**误用边号**的绘制对齐后再存盘，**勿**对现有关卡再手跑该函数（会二次置换）。 |
| `ef` | 与 `eid` 同格时黑字坦克的**初始朝向**，**与 `h` 的轴向索引用法相同**；与逻辑层「第 i 向邻接/格边」一致。 |
| `rid` | 援军生成位编号（红色数字）**1..6**，全图不重复；**开局掷骰放置步兵**（`enemyStartByDice` 且无 `at`）时走 **`rid` 链**，与坦克用的 **`eid` 链**分开。 |
| `eid` | 敌方坦克起始候选编号（黑色数字）**1..6**；**开局掷骰放置坦克等**（非步兵）时走 **`eid` 链**。 |

---

#### 当前任务 1 示意（字母 = 基底 `t`；`[B]` = 同格带 `"bd":1` 建筑；`🔴/⚫` = rid / eid）

```
         col0   col1   col2   col3   col4   col5   col6
row0:   (空行，7 格均为 null)
row1:    ·      f🔴1   F      f      f      f      ·
row2:    ·      ‖f‖   f      f      f      f      F
row3:   f[B]    f      f     f[B]    r⚫2   r      r
row4:    f      ‖f‖   m      r🔴4   f      f      f⚫3
row5:    f      r    r[B]🔴3 m      F      f      ·
row6:    ·     r↗S    f      f      f      f      ·
```

- `‖` 表示该格 `h` 含 `111111` 一类围合；具体边以 JSON 的 `h` 为准。
- 谢尔曼起始：`row=6, col=1`，表中 `r↗S` 表示该格为公路 `r` 且为当前部署位（朝向见 JSON `facing`，↗ 对应 NE）。

---

## 任务 2：猎杀虎式

> 对应数据：`assets/resources/missions/mission_02.json`。

### 目标

- 摧毁 **1 辆虎式坦克**（`kind: "tiger"`）；
- 随后将谢尔曼开到 **撤离格** `evacAt: col=7, row=2`（本图**东侧**带黑字 ③ 的公路格，与 `eid:3` 同格），沿 **`evacExitDir = 0`（正东）** 驶出地图。

### 初始设置

- **谢尔曼**：`col=0, row=3` 公路格，**朝向 0（正东）**（以 `mission_02.json` 为准）。
- **敌方**：**1 辆虎式** + **2 辆三号**（`tiger` ×1、`panzer3` ×2）。`enemyStartByDice: true`：每辆**坦克**开局各掷 **1d6**，在 **eid 1~6 黑格**中链式择空位；**步兵**若省略 `at` 则用 **`rid` 1~6 红格**链（见下方「混合部署」）。与谢尔曼格不重叠。

### 回合结束事件（本关 · 掷 **2d6**）

| 2d6 | 事件 | 实现 |
|-----|------|------|
| **2–5** | 德军步兵 | `infantry_spawn` → 红格 `rid` |
| **6** | 地雷 | `road_mine`：谢尔曼在**公路**且**未瘫痪**时自动受击，穿甲 0 vs 装甲 4，再伤害 1d6 |
| **7–8** | 相邻步兵齐射 | `adjacent_infantry_fire` |
| **9** | 车长额外行动 | `commander_extra`（装填/修复/灭火 等，与任务 1 同逻辑） |
| **10** | 斯图卡 | `stuka` |
| **11+** | IV 号坦克 | `panzer4_spawn` → 黑格 `eid`（与任务 1 的 III 号流程相同，车型为 IV 号） |

数据行见 `data/turn_end_events.csv`（`mission_02`），`node tools/buildTurnEndEventDB.js` 生成 `TurnEndEventDB.ts`。

---

## 任务 3：清除步兵

> 对应数据：`assets/resources/missions/mission_03.json`。地图可独立编辑；**6 名步兵的 `at` 须与全图 6 个 `bd:1` 格一致**（谢尔曼所在格不要放步兵）。

### 目标

- 歼灭**全部德军步兵**（`kind: "infantry"`）后，将谢尔曼开至 **撤离格** `evacAt: col=7, row=2`（与黑字 ③ 同格），沿 **`evacExitDir = 0`（正东）** 驶出地图。
- 场上 **IV 号**为威胁单位，**不必**击毁即可达成目标（胜负仅统计步兵 + 撤离）。

### 初始设置

- **谢尔曼**：`col=0, row=3`（以 JSON 为准，黑箭头起始格），**朝向 0**。
- **步兵 ×6**：各占一格 `bd:1` 建筑，与 `tiles` 中 6 处 `bd:1` 一一对应；当前配置为 `(4,2) (5,2) (3,3) (4,3) (5,3) (4,4)`（**offset**：`col,row`）。改图后请同步改 `enemies` 里 6 条步兵的 `at`。
- **IV 号 ×2**：`enemyStartByDice: true` 中仅对无 `at` 的条目掷骰；**坦克**在 **eid 1~6** 黑格链式占位，朝向同格 `ef`。
- 混合部署：`MissionLoader` 在 `enemyStartByDice: true` 时，有 `at` 的单位用 JSON 固定坐标；无 `at` 的单位再掷 **1d6**——**`kind: infantry`** 走 **`rid` 红格链**，**坦克 / 卡车等**走 **`eid` 黑格链**（规则与任务 1 坦克掷骰相同，仅格子来源不同）。

### 回合结束事件（本关 · 掷 **2d6**）

| 2d6 | 事件 | 实现 |
|-----|------|------|
| **2–4** | 狙击手 | `sniper`：舱盖开启且与任意步兵有视线时车长阵亡 |
| **5** | 地雷 | `road_mine`：谢尔曼在**公路**且**未瘫痪**时受击，AP0 vs 装甲 4，再伤害 1d6 |
| **6–8** | 相邻步兵齐射 | `adjacent_infantry_fire` |
| **9** | 车长额外行动 | `commander_extra` |
| **10** | 斯图卡 | `stuka`（舱盖开时先 2d6≥6 判击落，再 2d6 轰炸等，与任务 1 同逻辑） |
| **11+** | 三号坦克增援 | `panzer3_spawn` → 黑格 `eid` |

数据行见 `data/turn_end_events.csv`（`mission_03`），`node tools/buildTurnEndEventDB.js` 生成 `TurnEndEventDB.ts`。

---

## 任务 4：只是路过：湖泊

> 对应数据：`assets/resources/missions/mission_04.json`。底图在任务 1 基础上加入湖泊 `w`、红格 **rid2 / rid6** 为**农场**并各放 1 名起始步兵。

### 目标

- **仅撤离**：`destroy_kind_evac` 且**不写 `kind`**，击毁敌军非必要；将谢尔曼开至 `evacAt` 后沿 `evacExitDir` 驶出地图即胜（与红箭头同几何）。

### 初始设置

- **谢尔曼**：`col=0, row=3`，`facing=0`（以 `mission_04.json` 为准）。
- **虎式 + IV 号**：各 1，`enemyStartByDice` 在黑格 **eid** 链式掷骰，朝向 `ef`。
- **步兵 ×2**：当前配置为 JSON **固定 `at`**：`(3,1)`、`(4,5)`，分别与全图 **`rid:2`**、**`rid:6`** 红格一致；若改为省略 `at`，则会从 **`rid` 1~6** 链式掷骰占位（不再使用 eid）。

### 回合结束事件（本关 · 掷 **2d6**）

| 2d6 | 事件 | 实现 |
|-----|------|------|
| **2–3** | 狙击手 | `sniper` |
| **4** | 机械故障 | `mechanical_failure` → 瘫痪（未瘫时） |
| **5–6** | 德军步兵 | `infantry_spawn`：1d6 对应红格 `rid`（格空则放置） |
| **7–9** | 相邻步兵齐射 | `adjacent_infantry_fire` |
| **10** | 车长额外行动 | `commander_extra` |
| **11+** | 斯图卡 | `stuka` |

数据行见 `data/turn_end_events.csv`（`mission_04`），`node tools/buildTurnEndEventDB.js` 生成 `TurnEndEventDB.ts`。

---

## 任务 5：摧毁卡车

> 对应数据：`assets/resources/missions/mission_05.json`。8×6 odd-r。地图引入水域 `w` 与一条贯穿底部的公路（卡车撤退线）。

### 目标

- **击毁德军卡车**（`kind: "truck"`）；
- 随后将谢尔曼开至 **撤离格** `evacAt: col=6, row=0`，沿 **`evacExitDir = 5`（NE）** 驶出地图（撤离几何与红箭一致）。
- `objective.type = "destroy_kind_evac"`、`kind = "truck"`：与任务 1 / 任务 6 同一族判定，先满足"全部 truck 已毁"，再走 `isShermanEvacDrive`（前进或反向后退使谢尔曼离场）即胜。

### 失败条件

- 谢尔曼被摧毁（`checkOutcome` 优先判负）；
- **卡车驶出地图**：当 `mission.truckEscapeDefeat = true` 时立即判负（见下文 `german_truck_move` 路径末端越界）。

### 初始设置

- **谢尔曼**：`col=1, row=1`，`facing=0`（正东），起始格为带黑箭头标记的 **田地**（`t: "f"`，以 `mission_05.json` 为准）。
- **卡车**：固定 `at: col=7, row=2`，与 `truckPath` **首格**一致；`MissionLoader` 在加载完成时把卡车朝向修为指向 `truckPath[1]` 的方向（见 `loadMission` 末尾对 `kind: "truck"` 的特别处理）。
- **2 辆 IV 号 + 3 名步兵**：`enemyStartByDice: true` 且无 `at`；按混合部署规则——**坦克** 走 **eid 1~6** 黑格链（共 6 处：`(4,0)=5`、`(5,0)=6`、`(6,1)=1`、`(1,4)=4`、`(6,4)=2`、`(3,5)=3`），朝向同格 **`ef`**；**步兵** 走 **rid 1~6** 红格链（共 6 处：`(3,0)=6`、`(6,3)=1`、`(4,2)=3`、`(2,4)=5`、`(3,4)=2`、`(5,4)=4`），朝向同格 **`ef ?? 0`**（本关红格均未配 `ef` → 默认正东，步兵无须依朝向射击）。各自掷 1d6 链式占位（点数对应格被占用 / 不存在则 +1 顺延循环 1..6）。

### 卡车撤退路径 `truckPath`

每个条目类型为 [`TruckPathEntry`](../assets/scripts/core/types.ts)，即 `Offset` (`{col, row}`) 加可选 `exitDir`：

| 字段 | 说明 |
|---|---|
| `col`, `row` | offset 坐标，须为公路格（`t === "r"`） |
| `exitDir`（可选，**仅末格生效**） | 驶出方向（0=E, 1=SE, 2=SW, 3=W, 4=NW, 5=NE）。卡车在末格继续推进时，沿该方向再走 1 格——此格必越界 → 触发 `mission.truckEscapeDefeat = true` 判负，是关卡的兜底逃脱口。**未配置时**：默认沿 `truck.facing` 推算下一格，行为与旧关卡兼容。 |

当前 `mission_05.json` 的 7 格路径：

| 序号 | offset | 备注 |
|---|---|---|
| 1 | `(col=7, row=2)` | 卡车初始格 / `enemies[0].at` |
| 2 | `(col=6, row=3)` | |
| 3 | `(col=6, row=4)` | |
| 4 | `(col=5, row=5)` | 进入底部贯穿公路 |
| 5 | `(col=4, row=5)` | |
| 6 | `(col=3, row=5)` | |
| 7 | `(col=2, row=5)` | 路径末端（按需在此条目追加 `"exitDir": <0..5>` 锁定驶离方向） |

`MissionLoader.validateTruckPath` 强校验：

- 每格须 `t === "r"`（公路），相邻格 `hexDistance === 1`；
- `exitDir` 仅允许出现在**末格**；中间格写了直接抛错（避免误以为可以中途换出口）；
- `exitDir` 须为 0..5 整数，否则抛错（落地越界这一步也落到 `germanTruckDefeatAfterExitMove` 分支判负）。

### 回合结束事件（本关 · 掷 **2d6**）

| 2d6 | 事件 | 实现 |
|-----|------|------|
| **2–5** | **相邻步兵齐射** | `adjacent_infantry_fire`：与谢尔曼**相邻**的全体德军步兵各一击（穿甲值 1） |
| **6–9** | **德军卡车沿路推进** | `german_truck_move`：卡车沿 `truckPath` 至少前进 **1 格**；落点若仍有任何坦克（含谢尔曼 / 敌坦 / 别的卡车）则**再多走 1 格**，直至落到无坦克的格；走出 `truckPath` 后改沿 `truck.facing` 步进（每段动画含转向 + 平移）。**任意一步越界 → 整段动画末段挂 `truckExitDefeat`，结束后置 `mission.truckEscapeDefeat = true` 判负。** |
| **10** | **车长额外行动** | `commander_extra`：车长存活时按程序优先级执行 **灭火 → 修复瘫痪 → 修复炮塔 → 装填** 四选一 |
| **11–12** | **IV 号坦克** | `panzer4_spawn`：1d6 对应黑格 `eid`（不重掷；落格已有坦克则不放置）；朝向同格 `ef` |

数据行见 `data/turn_end_events.csv`（`mission_05`），`node tools/buildTurnEndEventDB.js` 生成 `TurnEndEventDB.ts`。

> **`german_truck_move` 实现要点**（详见 `assets/scripts/core/TurnEndEventApply.ts`）：
>
> - **每步选格的优先级**：当前格仍在 `truckPath` 中段 → 走下一条目；否则若当前格 = 末格 **且配置了 `exitDir`** → 沿 `exitDir` 走一格驶出（必越界 → 判负）；都不满足时 → 沿 `truck.facing` 走一格（旧关卡兼容路径）。
> - **预模拟段**：`prepareTurnEndEvent` 在 UI 确认前按上述规则滚动模拟，产出 `germanTruckMoveSegments`（`turn` / `move` 片段）；
> - **动画串联**：`BattleScene.enqueueGermanTruckMoveAnims` 把片段塞入 `animQueue`，按 `moveDuration` 顺序播放；
> - **末段越界 = 判负**：`germanTruckDefeatAfterExitMove=true` 时，最后一段 `move` 帧置 `truckExitDefeat`，动画完成后 `BattleScene` 写 `mission.truckEscapeDefeat = true`，下一次 `checkOutcome` 直接 `defeat`；
> - **apply 时机**：仅当卡车落点仍在地图内时，apply 才把 `truck.pos` / `truck.facing` 推进到落点（避免末段越界与抵达最后一格混淆）。

---

## 任务 6：以一敌三

> 对应数据：`assets/resources/missions/mission_06.json`。8×6 odd-r。

### 目标

- 摧毁 **3 辆 III 号坦克**（`kind: "panzer3"`，包含开局 3 辆与回合结束 12 行 `panzer3_spawn` 增援的同种）；
- 随后将谢尔曼开至 **撤离格** `evacAt: col=7, row=2`（带红箭头的右侧公路格），沿 **`evacExitDir = 0`（正东）** 驶出地图。

### 初始设置

- **谢尔曼**：放置在 **黑色箭头公路格**，朝向箭头方向；当前 JSON 为 `col=4, row=0, facing=1`。
  - **任务开始时即处于「瘫痪」**：`sherman.paralyzed = true`。`MissionLoader.makeUnit` 读取 `UnitPlacement.paralyzed` 后写入 `unit.paralyzed = true`，与回合结束 `mechanical_failure` 同语义；可通过事件 10 `commander_extra → 修复` 解除。
- **3 辆 III 号**：`enemyStartByDice: true`；每辆**坦克**开局各掷 **1d6**，在 **eid 1~6 黑格**中链式择空位（**不重掷**），朝向同格 **`ef`**。当前 JSON 6 处 eid：`(7,2)=1`、`(5,5)=2`、`(1,5)=3`、`(0,3)=4`、`(2,0)=5`、`(6,0)=6`。
- **步兵**：开局**不放置**；仅由回合结束 4–5 行 `infantry_spawn` 在红格 **rid**（1~6）按 1d6 链式产生。

### 回合结束事件（本关 · 掷 **2d6**）

| 2d6 | 事件 | 实现 |
|-----|------|------|
| **2–3** | **狙击手** | `sniper`：舱盖开启且车长与任意步兵有视线时车长阵亡 |
| **4–5** | **德军步兵** | `infantry_spawn`：1d6 对应红格 `rid`（不重掷；若占用则不放置） |
| **6** | **地雷** | `road_mine`：谢尔曼在**公路**且**未瘫痪**时受击，AP0 vs 装甲 4，再伤害 1d6 |
| **7–9** | **相邻步兵齐射** | `adjacent_infantry_fire`：与谢尔曼**相邻**的全体德军步兵各一击（穿甲值 1） |
| **10** | **车长额外行动** | `commander_extra`：装填 / 修复（瘫痪 / 炮塔）/ 灭火 三选一（按程序优先级） |
| **11** | **斯图卡** | `stuka`：舱盖开 → 先 2d6≥6 击落判定；未击落再 2d6≥8 命中；命中按装甲 4 / 穿甲 1 解伤害 |
| **12** | **III 号坦克** | `panzer3_spawn`：1d6 对应黑格 `eid`（不重掷；若已有坦克则不放置）；朝向同格 `ef` |

数据行见 `data/turn_end_events.csv`（`mission_06`），`node tools/buildTurnEndEventDB.js` 生成 `TurnEndEventDB.ts`。所有 7 类事件 (`sniper` / `infantry_spawn` / `road_mine` / `adjacent_infantry_fire` / `commander_extra` / `stuka` / `panzer3_spawn`) 均沿用任务 1~4 既有实现，无需新增逻辑。

> **「不要重掷」**：与任务 1 / 任务 4 的 `infantry_spawn` 与任务 1 的 `panzer3_spawn` 一致——掷出的点对应格被占用 / 无该 rid（eid）时**直接跳过**本次放置，不再补掷。`MissionLoader` 在开局对 3 辆 III 号坦克掷骰占位时仍走链式 1..6 寻空（与说明书「不要重掷」中**仅**针对回合结束放置不冲突；详见 `resolveEnemyDicePlacements`）。

---

## 任务 7：只是路过：桥梁

> 对应数据：`assets/resources/missions/mission_07.json`。8×6 odd-r。本关首次启用 GDD §3.2 [桥梁](GameDesignDocument.md#32-地形系统) 叠加规则（水域格 + `br=[a,b]`）。

### 目标

- **撤离即胜**：将谢尔曼开至 **撤离格** `evacAt: col=7, row=2`（地图右侧带红色箭头的格），沿 **`evacExitDir = 0`（正东）** 驶出地图。
- **无歼敌前置**：`objective.type = "destroy_kind_evac"` 但**不带 `kind`** —— `Objective.isObjectiveMet` 中 `if (obj.kind && ...)` 短路，直接以 `mission.shermanEvacuated` 为准；同样 `isShermanEvacDrive` 也跳过歼敌前置，谢尔曼任何时刻只要驶到撤离格 + 沿 `evacExitDir` 即可结算胜利。
- **失败条件**：仅「谢尔曼被摧毁」一条；无卡车，无 `truckEscapeDefeat`。

### 初始设置

- **谢尔曼**：放置在地图 **左侧黑色箭头格**，朝向箭头方向；当前 JSON 为 `col=0, row=3, facing=0`（朝东）。
- **2 辆敌坦**（`enemyStartByDice: true`）：1 辆 **虎式** + 1 辆 **III 号**，开局各掷 **1d6**，在 **eid 1~6 黑格**中链式择空位（**不重掷**），朝向同格 **`ef`**。当前 JSON 6 处 eid：`(6,0)=1`、`(7,2)=2`、`(6,4)=3`、`(6,5)=4`、`(2,1)=5`、`(5,1)=6`。
  - 注意：**eid 2 即撤离格**，掷骰若落到 2，敌坦会出现在撤离格上，谢尔曼必须先击毁该坦克才能撤离。
- **步兵**：开局**不放置**；本关回合结束事件中**也没有步兵生成或步兵齐射**，故全程不会出现步兵单位。

### 桥梁与公路

桥梁是 GDD §3.2 的非独立地形：叠加在水域格上 → 该格变为**可通行**（坦克 / 卡车），骰子规则 / 移动力**与公路相同**；但**只能从**配置的两端方向**进入或离开**桥梁。

| 字段 | 值 | 含义 |
|---|---|---|
| 桥梁格坐标 | `col=3, row=3`（基底 `t="w"`） | 横跨河中段；公路在上下两侧（`col=3, row=2` 与 `col=3, row=4`）对接 |
| `br` | `[4, 2]` | 4 = NW，2 = SW；这两条边上的邻格分别是 `col=3, row=2`（NW）与 `col=3, row=4`（SW） |
| 进入约束 | 仅 NW / SW | 从 `col=3, row=2`（NW 邻格）或 `col=3, row=4`（SW 邻格）跨入；其他 4 条边等同水面阻挡 |
| 离开约束 | 仅 NW / SW | 反之亦然 |

`MissionLoader.parseBridgeEnds` 在加载关卡时强校验「水域基底 + 两个 0..5 不重复方向」；`HexMap.canTankCrossEdge` 在每次移动判定时同时检查出向和入向。

> **说明书原文 vs 实现**：「坦克只能沿着公路的方向移动进入或离开桥梁，但在桥梁上可以转向任意方向」——「沿公路方向进出」即上述 `br=[4,2]` 的边向校验；「桥梁上可转向任意方向」即标准的 60° 转向骰逻辑（转向不消耗 `canTankCrossEdge`，仅 advance / reverse 才校验跨边方向）。「桥梁不会阻挡视线，也不会提供掩护，应被视为公路格」对应 GDD §3.2 + 实现：水域不阻挡视线（既存规则），桥梁也不带 `hasBuilding` / 树篱，故无 +1 掩护；骰池由 `effectiveDiceTerrain` 折算成 `road`。

### 回合结束事件（本关 · 掷 **2d6**）

| 2d6 | 事件 | 实现 |
|-----|------|------|
| **2–5** | **公路地雷** | `road_mine`：若谢尔曼**在公路格或桥梁格**（`effectiveDiceTerrain(tile) === 'road'`，GDD §3.2「按公路触发」一并视桥梁为公路）**且未瘫痪** → 自动命中一次 **装甲 4 / 穿甲 0**，按「2. 造成伤害」掷穿甲 1d6（≥4 穿）+ 伤害 1d6 |
| **6** | **机械故障** | `mechanical_failure`：谢尔曼瘫痪（若已瘫痪则不变） |
| **7–8** | **本回合无事件** | `none`：新加的显式无事件类型，仅在事件面板里展示「无事件」并消耗掷骰，不触发任何效果 |
| **9** | **车长额外行动** | `commander_extra`：若车长存活 → 装填 / 修复（瘫痪 / 炮塔）/ 灭火 三选一（按程序优先级，与既有实现一致） |
| **10** | **斯图卡** | `stuka`：舱盖开 → 先 2d6≥6 击落判定；未击落再 2d6≥8 命中；命中按 **装甲 4 / 穿甲 1** 解伤害 |
| **11+** | **III 号坦克** | `panzer3_spawn`：1d6 对应黑格 `eid`（不重掷；若已有坦克则不放置）；朝向同格 `ef` |

数据行见 `data/turn_end_events.csv` 的 `mission_07,...`，`node tools/buildTurnEndEventDB.js` 生成 `TurnEndEventDB.ts`。

> **新增 `none` 效果类型**：在第 7 关之前所有关卡都把 2~12 全部覆盖到具体事件，本关首次出现「7–8 本回合无事件」的显式行——为此扩展 `TurnEndEffectType` 增加 `'none'`，`TurnEndEventApply` 中加 `case 'none'` 走 `turnEnd.none.body` 仅显示文案、不改任何状态；前端事件列表面板（`battle.turnEndList.effect.none`）也添加了对应中英文。

---

## 任务 8：刺杀

> 对应数据：`assets/resources/missions/mission_08.json`。7×7 odd-r。本关首次启用新单位 **`'officer'`（军官）**——与步兵互不替代的独立 `UnitKind`，避免与回合结束 5–6 `infantry_spawn` 中产生的普通步兵混淆胜利条件。

### 目标

- **击毙军官 + 撤离**：摧毁红色边框建筑里的**高级军官**（`kind: 'officer'`，本关唯一一只），随后将谢尔曼开至 **撤离格** `evacAt: col=6, row=6`（地图右下角带红色箭头的格），沿 **`evacExitDir = 0`（正东）** 驶出地图。
- **普通步兵不计入胜利条件**：`destroy_kind_evac` 的 `kind` 字段固定为 `'officer'`，回合结束 5–6 spawn 的步兵 `kind: 'infantry'` 与之不同，**不会被算入「需击毁」清单**——玩家击毙建筑里那只军官即可拉开撤离窗口，无论地图上还有多少普通步兵。
- **失败条件**：仅「谢尔曼被摧毁」一条；没有卡车，也无 `truckEscapeDefeat`。

### 初始设置

- **谢尔曼**：放置在 **左侧黑色箭头格**，朝向箭头方向；当前 JSON 为 `col=0, row=3, facing=0`（朝东）。
- **3 辆敌坦**（`enemyStartByDice: true`）：1 **虎式** + 1 **IV 号** + 1 **III 号**，开局各掷 **1d6**，在 **eid 1~6 黑格**中链式择空位（**不重掷**），朝向同格 **`ef`**。当前 JSON 6 处 eid：`(2,5)=1 ef=4` / `(4,5)=2 ef=5` / `(1,0)=3 ef=1` / `(2,2)=4 ef=0` / `(1,1)=5 ef=2` / `(4,0)=6 ef=2`。
- **军官**：1 个 `kind: 'officer'` 单位**直接固定**放置在红色边框建筑 **`(col=6, row=0)`**（`bd=1`）；`enemyStartByDice` 模式下带 `at` 的单位走固定坐标通道，不会被掷骰挪走。
- **rid 红格**（步兵 spawn）：6 处分布在地图右半区与中下区——`(6,2)=1` / `(5,2)=2` / `(5,5)=3` / `(3,6)=4` / `(5,1)=5` / `(6,4)=6`。

### 新单位 `'officer'`

为支持说明书原图「红色边框建筑里的德军步兵 = 高级军官」这种「一只精英敌即可解锁撤离」的关卡设计，本关引入了与 `'infantry'` 并列的独立单位类型 `'officer'`（**与 boss 标记不同**——通过 `kind` 区分，最大化复用既有 `destroy_kind_evac` 通道）：

| 维度 | `'infantry'`（步兵） | `'officer'`（军官） |
|---|---|---|
| 数据来源 | `data/units.csv` 第 7 行（`size=0`，无装甲，`penetration=1`） | `data/units.csv` 第 8 行（与 `'infantry'` 数值完全一致） |
| 出生方式 | 关卡 JSON 直接 `at` / `enemyStartByDice` 走 `rid` 链 / 回合结束 `infantry_spawn` 事件 | 关卡 JSON 直接 `at`（`enemyStartByDice` 走 `rid` 链亦可，但本关用固定坐标） |
| 攻击 / 移动规则 | `isFootKind` / `isFootUnit` 通用判定：仅可被机枪打、不参与坦克 AI、不阻塞坦克叠格 | 同左 |
| 视觉 | 普通步兵小人 | 同步兵小人 + **红色光环**（`OFFICER_HALO_STROKE`）+ 所在格红色 hex 边框（`drawOfficerTileHighlights`） |
| 关卡目标关联 | `destroy_kind_evac kind='infantry'`：所有步兵 destroyed 才算前置达成 | `destroy_kind_evac kind='officer'`：所有军官 destroyed 才算前置达成 —— 与 spawn 出来的步兵互不影响 |

> **`isFootKind / isFootUnit`**：在 `types.ts` 中导出，供 `BattleScene` / `Combat` / `TurnEndEventApply` / `MissionLoader` 等共用，统一处理「徒步类」单位（步兵 / 军官）的所有特判位置（机枪目标、相邻齐射、视线检查、AI 排除、叠格阻塞、tile inspect 装甲面板隐藏等）。**唯一例外**：`infantry_spawn` 事件 spawn 出来的单位 `kind` 始终为 `'infantry'`（不会复活军官），`Objective.allEnemiesOfKindDestroyed(mission, 'officer')` 等按 `kind` 精确判定的位置不应换成 helper。

### 回合结束事件（本关 · 掷 **2d6**）

| 2d6 | 事件 | 实现 |
|-----|------|------|
| **2–4** | **公路地雷** | `road_mine`：若谢尔曼**在公路格或桥梁格**（`effectiveDiceTerrain(tile) === 'road'`，与任务 7 一致）**且未瘫痪** → 自动命中一次 **装甲 4 / 穿甲 0**，按「2. 造成伤害」掷穿甲 1d6（≥4 穿）+ 伤害 1d6 |
| **5–6** | **德军步兵** | `infantry_spawn`：1d6 对应红格 `rid`（不重掷；若该格已被谢尔曼或步兵占用则跳过本次放置）。spawn 出来的单位 `kind: 'infantry'`，**不会被算作军官**——胜利判定只看 `'officer'` 这一类 |
| **7–9** | **相邻步兵齐射** | `adjacent_infantry_fire`：与谢尔曼**相邻**的全体「徒步类」（`isFootUnit` 判定，含步兵与军官）各一击（**穿甲值 1**）；若军官当前与谢尔曼相邻也参与齐射 |
| **10** | **车长额外行动** | `commander_extra`：若车长存活 → 装填 / 修复（瘫痪 / 炮塔）/ 灭火 三选一（按程序优先级） |
| **11+** | **斯图卡** | `stuka`：舱盖开 → 先 2d6≥6 击落判定；未击落再 2d6≥8 命中；命中按 **装甲 4 / 穿甲 1** 解伤害 |

数据行见 `data/turn_end_events.csv` 的 `mission_08,...`，`node tools/buildTurnEndEventDB.js` 生成 `TurnEndEventDB.ts`。所有 5 类事件 (`road_mine` / `infantry_spawn` / `adjacent_infantry_fire` / `commander_extra` / `stuka`) 均沿用任务 1~7 既有实现，本关无需新增 `TurnEndEffectType`。

> **关键细节 1：军官不在 5–6 spawn**——`infantry_spawn` 事件创建的单位 `kind` 始终为 `'infantry'`（`TurnEndEventApply` 中的 spawn 路径硬编码），即使军官已死也只能再 spawn 出普通步兵，不会"复活"军官。
>
> **关键细节 2：军官死亡后立刻可撤离**——`destroy_kind_evac kind='officer'` 仅看本关唯一一只军官是否 destroyed。地图上仍有普通步兵 / 仍在不断 spawn 也不影响 `isShermanEvacDrive` 与 `isObjectiveMet`。

---

## 后续任务

- **任务 5**：见上文（`destroy_kind_evac` + `kind=truck`，配套 `truckPath` + `german_truck_move` 回合结束推进；卡车驶出地图判负）。
- **任务 6**：见上文。
- **任务 7**：见上文（首次启用桥梁，`destroy_kind_evac` 无 `kind` → 纯撤离胜利；新增 `none` 事件类型）。
- **任务 8**：见上文（首次启用新单位 `'officer'`（军官）`UnitKind`；与步兵互不替代，胜利判定走标准 `destroy_kind_evac kind='officer'` 通道；红色边框建筑由 UI 自动渲染）。
- **任务 9 ~ 12**：地图与说明待补充。
- 主菜单的解锁顺序见 `assets/scripts/core/LevelDB.ts` 中的 `LEVELS` 常量。
