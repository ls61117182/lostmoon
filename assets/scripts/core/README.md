# core/ —— 核心规则层（纯 TypeScript）

> 这一层**不引用 cc.\***，所以可以用 `ts-node` 或 Jest 单独跑测试，将来换引擎也不用改。

## 文件清单

| 文件 | 职责 |
|------|------|
| `types.ts` | 公共类型：坐标、地形、单位、任务数据结构 |
| `HexGrid.ts` | 六角格工具：坐标系、邻接、距离、视线、地图容器 |
| `UnitDB.ts` | 所有单位的基础属性表（数值来源说明书 P5）|
| `Dice.ts` | 可种子化的随机数生成器（mulberry32），便于回放/测试 |
| `MissionLoader.ts` | 把 JSON 任务数据转成内存对象 |
| `SelfTest.ts` | 自检脚本，跑一遍核心 API，方便确认逻辑 |

## 坐标系约定

- **Axial 坐标 `(q, r)`**：内部计算用，方便邻接 / 距离 / 旋转
- **Offset 坐标 `(col, row)`**：JSON / 编辑器友好（odd-r 偏移）
- **Direction 0..5**：pointy-top（尖顶）方向，顺时针自正东开始
  - `0=E, 1=SE, 2=SW, 3=W, 4=NW, 5=NE`

## 快速使用

### 1. 加载任务

```ts
import missionJson from '../resources/missions/mission_01.json';
import { loadMission } from './core/MissionLoader';
import { MissionData } from './core/types';

const { map, sherman, enemies, data } = loadMission(missionJson as MissionData);
console.log(`任务：${data.name}，共 ${enemies.length} 个敌人`);
```

### 2. 算距离 / 视线

```ts
import { hexDistance } from './core/HexGrid';

const dist = hexDistance(sherman.pos, enemies[0].pos);
const canSee = map.hasLineOfSight(sherman.pos, enemies[0].pos);
const hedges = map.countHedgesAlong(sherman.pos, enemies[0].pos);
```

### 3. 摇骰

```ts
import { RNG } from './core/Dice';

const rng = new RNG();              // 真随机
const replayRng = new RNG(12345);   // 固定种子，结果可复现
const rolls = rng.dice(5);          // [3, 6, 1, 4, 2]
```

### 4. 自检

把 `SelfTest.ts` 引到任意 Cocos 启动场景的脚本里：

```ts
import { runSelfTest } from './core/SelfTest';
import missionJson from '../resources/missions/mission_01.json';

start() {
  runSelfTest(missionJson as any);
}
```

应该看到类似输出：

```
=== Sherman Self-Test ===
地图共 63 格，分布: { field: 32, road: 12, forest: 9, building: 8, water: 0, mud: 2 }
谢尔曼位于 col=2 row=8, 朝向 4
乘员: { commander: true, loader: true, gunner: true, driver: true, coDriver: true }
panzer4 @ col=0 row=2 | 距离 6 | 视线 阻挡 | 穿过树篱 0
panzer4 @ col=6 row=5 | 距离 5 | 视线 通畅 | 穿过树篱 0
  → 命中 IV 号需要 2d6 > 9
摇 5 颗骰（种子 20260420）: [...]
正前方格: { col: 2, row: 7 } 地形 = road
坦克可入: true
=== Self-Test Done ===
```

## 任务 JSON 格式（mission_01.json 即模板）

| 字段 | 说明 |
|------|------|
| `cols`, `rows` | 地图尺寸（offset 坐标） |
| `tiles[row][col]` | 地形矩阵，每格一个对象 |
| `tiles[][].t` | 地形简写：`r`=公路, `f`=田地, `m`=泥地, `F`=林地, `b`=建筑, `w`=水域 |
| `tiles[][].h` | 6 位字符串，沿 6 方向是否有树篱（顺时针自东）|
| `tiles[][].rid` | 援军生成位编号（说明书的红色数字）|
| `tiles[][].eid` | 德军起始位编号（黑色数字）|
| `sherman` | 谢尔曼初始放置 |
| `enemies[]` | 德军单位列表 |
| `objective` | 胜负条件 |

## 当前实现（2026-10-10 核对）

上方文件表和示例为早期核心 API 简介，不是完整功能目录。原“还没做”清单已经过时：

- 战斗：`Combat.ts` 已有命中、穿甲、方向伤害、AP / HE / HVAP、机枪与目标分类。
- 玩家行动：`PlayerActionDB.ts` + `ActionDice.ts` 已有数据驱动的动作和骰池。
- AI：`EnemyAIDB.ts` + `EnemyAI.ts` 已有行动表、硬核骰、等级 / 火力与目标选择。
- 回合事件：`TurnEndEventDB.ts` + `TurnEndEventRuntime.ts` + `TurnEndEventApply.ts` 已实现。
- 回合 / 表现：`view/BattleScene.ts` 已承接阶段流程、地图和单位绘制、输入、动画及存读档，当前没有独立 `TurnManager.ts`。
- 扩展系统：迷雾 / 无线电、等级 / 实际车组、战役 / 强化 / 检查点、随机生成、自定义任务、天气 / 城市、PVP 服务均有对应模块。

完整清单、文档差异与未完成项见 [功能与策划文档核对](../../../docs/FeatureDocumentationAudit.md)。

## 单元测试（可选）

> ⚠️ **重要**：测试文件**绝对不能**放在 `assets/` 目录下。Cocos Creator 会把 `assets/` 里所有 `.ts` 当游戏脚本编译并执行；而测试文件用了 Jest 的 `describe`/`test` 全局函数，运行时不存在 → 会抛 `ReferenceError: describe is not defined`，整个项目无法启动。
>
> 把所有测试放在工程根目录的 `tests/` 文件夹（已在本项目里），它在 `assets/` 之外，Cocos 不会扫描。

如果你想跑真正的单元测试：

```bash
npm i -D typescript ts-node jest @types/jest ts-jest
npx ts-jest config:init
npx jest
```

测试文件位置：`tests/HexGrid.test.ts`（参考已有的示例）。
