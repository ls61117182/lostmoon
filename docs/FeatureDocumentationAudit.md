# 已实现功能与策划文档核对

核对日期：2026-10-10。范围：当前工作区的游戏脚本、服务端、配置 / 关卡资源、现有策划文档和针对性测试。包含当前未提交的功能代码；此次只整理文档，没有修改游戏逻辑或美术，也没有做 Cocos 实机、移动端或双客户端联机验收。

“已实现”表示发现运行时逻辑及入口 / 调用链，不等于所有场景都通过验收。“已有文档”包括专项设计稿，不能将“总策划没有写”误判为完全没有文档。下表的覆盖状态描述本次补充前的情况，末列说明此次处理。

## 可玩内容与系统清单

| 功能 | 当前实现与边界 | 原文档覆盖 | 本次整理 / 实现依据 |
|---|---|---|---|
| 单关内容 | 欧洲 12 关、Pacific 12 关，有初始部署、目标、事件和关卡进度；开发版另有测试关 | 总策划与任务手册已有 | [LevelDB.ts](../assets/scripts/core/LevelDB.ts)、[任务手册](Missions.md) |
| 经典 / 硬核模式 | 单关可切换；硬核启用迷雾、无线电、精确射击、十二向炮塔、方向伤害与过穿等 | 总策划已有，入口限制分散 | 补充战役固定硬核、体验版固定硬核；[GameMode.ts](../assets/scripts/core/GameMode.ts) |
| 玩家行动 | 移动 / 攻击先后任选，杂项最后；地形、人员、火力、等级 / 强化修正骰池，单骰与对子菜单 | 规则已有，UI 仍写拖骰 / 3D 物理骰 | 修正 §5.2；[ActionDice.ts](../assets/scripts/core/ActionDice.ts)、[BattleScene.ts](../assets/scripts/view/BattleScene.ts) |
| 基础战斗 | 命中、穿甲、方向伤害、炮盾、有效射程衰减、乘员伤亡与目标概率 / 修正详情 | 总策划已有 | 保留现行正文；[Combat.ts](../assets/scripts/core/Combat.ts) |
| HE 分目标结算 | 步兵 / 炮组压制或击毁，坦克瘫痪 / 起火，碉堡起火 / 击毁，卡车命中摧毁；同格步兵独立判定 | 总策划已有多轮修订 | 修正状态表仍残留的“重炮 HE 压制”；HE UI 测试另列待核验 |
| HVAP 有限弹药 | 战役强化解锁，每阶段总额 2 发，穿甲及有效射程各 +2，换弹退还未发射炮弹 | 只零散提到 AP/HVAP，未说明完整规则 | 补 §2.2.1、§3.4；[CampaignUpgrade.ts](../assets/scripts/core/CampaignUpgrade.ts)、[Combat.ts](../assets/scripts/core/Combat.ts) |
| 炮射烟雾 | 默认总额 7 发，装填 / 换弹 / 余量、合法格选取、弹着放烟，无伤害检定 | 文末已有 4 条，未进入核心弹种与状态表 | 移入 §3.4，补有限弹药与存档；烟雾测试夹具失败另记 |
| 锁定射击 | 主炮命中敌坦后下一次对同目标阈值 -2，实际转向 / 移动 / 行动结束清除，可见目标黄色瞄准圈；存档保留 | 总策划遗漏 | 新增 §3.4；[LockedFire.ts](../assets/scripts/core/LockedFire.ts)、[LockedFire.test.js](../tests/LockedFire.test.js) |
| 机枪与炮塔 | 航向 / 同轴机枪及齐射、炮塔速度、固定炮射界、蓝色合法格、精确射击红瞄准与角度圆环 | 总策划已有，§5.2 红框说明冲突 | 修正 §5.2，保留详细战斗规则 |
| 视野与烟雾 | 地形遮挡、开 / 关舱、炮手视野、无线电共享与损坏、烟雾限制、迷雾单位裁剪 | 总策划已有，GPU 方案另有文档 | [FogOfWar.ts](../assets/scripts/core/FogOfWar.ts)、[迷雾渲染](fog-overlay.md) |
| 伏击与 AI | 坦克伏击；等级影响目标与动作，攻击位置记忆；硬核非玩家混合骰与技能门槛 | 总策划已有 | [Ambush.ts](../assets/scripts/core/Ambush.ts)、[EnemyAI.ts](../assets/scripts/core/EnemyAI.ts) |
| 单位与乘员等级 | 新兵 / 老兵 / 王牌，等级图标、分类骰 / 命中修正，玩家按实际人员保存等级 | 总策划已有 | 保留；[UnitLevel.ts](../assets/scripts/core/UnitLevel.ts) |
| 实际车组与职责兼任 | 车型为 3–6 人；可兼任炮手 / 装填手，第二装填人员参与伤亡与弃车 | 仅专项文档，总策划仍泛化五人 | 补 §3.1 与专项链接；[单位属性与车组](HistoricalUnitProfiles.md)、[types.ts](../assets/scripts/core/types.ts) |
| 火力影响行动骰 | 玩家加入固定 2 骰及火力差修正；AI 高于有效火力的攻击骰失效，火力溢出还可追加攻击骰；专用火炮有射击前火力门槛 | 专项文档已有，AI 溢出规则遗漏 | 总策划补入口，专项文档补溢出说明；[EnemyAI.ts](../assets/scripts/core/EnemyAI.ts)、[AIFirepowerOverflow.test.js](../tests/AIFirepowerOverflow.test.js) |
| 步兵与反坦克炮 | 步兵自主行动、坦步同格、距离 0 反坦克攻击、碾压火炮释放炮组、接管 / 弃炮、炮组真实对象 | 总策划已有 | [复合单位测试](../tests/HardcoreATGunComposite.test.js)、[同格规则测试](../tests/HardcoreSameHexRules.test.js) |
| 弃车与恢复 | 实际全车组阵亡后车辆中立化；步兵可接管废弃坦克并恢复车组 | 总策划只有零散废弃目标排除 | 在核对文档集中列出；[AbandonedTankRules.test.js](../tests/AbandonedTankRules.test.js)、`BattleScene.captureAbandonedTanksAt` |
| 状态修复与 AI 烟雾 | 玩家可修炮塔 / 机动 / 硬核无线电；非玩家修复与放烟已执行 | 总策划仍将 AI repair / smoke 标未完成 | 修正 §3.5.5；[RepairableComponents.ts](../assets/scripts/core/RepairableComponents.ts) |
| 回合事件 | 分关卡 2d6 事件、增援、地雷、狙击、机械故障、空袭、卡车移动与 Pacific 特例 | 总策划及任务手册已有 | 保留；[TurnEndEventRuntime.ts](../assets/scripts/core/TurnEndEventRuntime.ts)、[TurnEndEventApply.ts](../assets/scripts/core/TurnEndEventApply.ts) |
| 连续战役 | 4 个固定 Pacific + 3 个随机入口，每次 3 阶段、地图拼接与摄像机过渡；阶段起点重试 | 专项及菜单文档已有，总策划仍是旧串关设想 | 重写 §2.2；[CampaignDB.ts](../assets/scripts/core/CampaignDB.ts)、[CampaignRuntime.ts](../assets/scripts/core/CampaignRuntime.ts) |
| 战役阶段状态 | 带入车型、乘员、等级 / 技能、朝向、舱盖、炮膛和烟雾余量；火势 / 炮塔受损 / 瘫痪清除，HVAP 补足阶段额 | 总策划写伤势全部延续、通用任选补员 | 修正 §2.2；[campaignRuntime.test.js](../tests/campaignRuntime.test.js) 明确断言伤势不带入 |
| 战役强化 | 19 项池，三选一、每阶段一次、累计 3 项、详情卡、阶段保护次数、保留攻击骰 | 总策划列 10 项，提到预备弹架但没入表 | 补齐新增 9 项，宽履带补海滩；[campaign_upgrades.csv](../data/campaign_upgrades.csv) |
| 随机关卡 | 欧洲夏 / 冬与 Pacific，种子化地图、道路 / 河桥 / 连通性、威胁预算、四类目标与事件表；编辑器可指定登陆战 | 总策划大部分已有，冬季入口说明不足 | 加总索引；[RandomMissionGenerator.ts](../assets/scripts/core/RandomMissionGenerator.ts) |
| 城市建筑破坏 | 城市地面 / 道路 / 两类建筑 / 废墟，HE 结构伤害、掩护及遮挡变化、11 + 4 种建筑外观 | 任务手册已有，总策划遗漏；手册仍写 8 种 | 新增 §3.2.1，修正手册外观数；[UrbanTerrain.ts](../assets/scripts/core/UrbanTerrain.ts) |
| 天气与冬季 | 晴 / 雨 / 小雪 / 大雪；雨命中阈值 +1、视野 -1，雪仅视觉；欧洲冬季皮肤 | 总策划只有天气泛称与冬季随机池 | 新增 §3.2.1；[Weather.ts](../assets/scripts/core/Weather.ts)、[WinterTerrain.test.js](../tests/WinterTerrain.test.js) |
| 主菜单与任务预览 | 关卡 / 战役 / 联机 / 编辑器 / 设置 / 测试，关卡与战役预览、继续 / 新游戏、随机隐藏预览 | 菜单专项已有，总策划缺系统入口清单 | 总策划链接专项；[主菜单说明](MenuNavigation.md)、[MenuOperations.ts](../assets/scripts/view/MenuOperations.ts) |
| 账号与本地进度 | 在线注册 / 登录服务、离线进入，账号对应存档、关卡进度、语言 / 音量偏好 | 总策划遗漏，菜单 / 服务端代码已有 | 此表补清单；[AuthService.ts](../assets/scripts/core/AuthService.ts)、[SaveSlot.ts](../assets/scripts/core/SaveSlot.ts)、[server.js](../server/server.js)；未确认云存档 |
| 关卡编辑器 | 地图 / 单位 / 等级 / 目标 / 天气 / 季节 / 简单事件编辑，官方与自定义导入、随机生成、10 槽本地保存 / 删除、复制 JSON | 仍以草案和分期计划为主 | 补已实现清单及限制；[编辑器方案](LevelEditorPlan.md) |
| 联机原型 | 三阵营、匹配 / 房间 / 开局骰 / 快照 / 60 秒回合超时；支援 AI 简化，编制与企划不同 | PVP 文档是目标规格，缺落地状态 | 补实现矩阵，明确地图、重连、投降、状态同步不足；[PVP 策划](PvpDesignDocument.md) |
| 存档与继续 | v11 状态快照、旧版本迁移、账号 / 构建档位隔离；关卡与战役双存档、阶段检查点与安全自动保存 | 总策划仍写 ActionLog 重演，菜单专项已有 | 重写 §6.2.5；[SaveLoad.ts](../assets/scripts/core/SaveLoad.ts)、[CampaignRunStore.ts](../assets/scripts/core/CampaignRunStore.ts) |
| 战报历史 | 结果历史滚动、只读骰子 / 规则详情回看、暂停后续 AI、恢复边界；可选择玩家结果弹窗 | 总策划只写“过程”和回放设想 | 补 §6.2.5；[BattleSceneCombatLogHistory.test.js](../tests/BattleSceneCombatLogHistory.test.js)，有 1 条失败 |
| 单位与战场表现 | 车体 / 炮塔分层、开舱车长、主炮后坐、机枪序列、AP / HE / 过穿、步兵反坦克、履带、尾气与振动、血迹 / 残骸、雨雪、阴影、连续地形 / GPU 迷雾 | 部分总策划已有，部分分散专项或仅代码 | 集中索引：[TankTopSpriteArtSpec.md](TankTopSpriteArtSpec.md)、[gpu-terrain.md](gpu-terrain.md)、[步兵反坦克表现](infantry-anti-tank-vfx-design.md)、[过穿表现](overpenetration-vfx-design.md)；视觉未实机验收 |
| 分辨率与体验版 | 主体等比例完整显示、容器 resize 适配；demo 隐藏开发入口、单人固定硬核 / 谢尔曼、存档隔离；当前构建档为 development | 专项已有，总策划缺边界 | [菜单适配](MenuNavigation.md#分辨率适配)、[体验版构建](demo-build.md)、[BuildProfile.ts](../assets/scripts/core/BuildProfile.ts) |
| 数据与文案工具链 | 单位、玩家 / AI 骰表、伤害 / 事件、视觉、强化、双语文案 CSV 生成运行时 DB | 总策划已有 | 保留；[工具说明](../tools/README.md)、`tools/updateAllConfigTables.js` |

## 明确不能计为已完成的内容

| 内容 | 核对结果 / 后续工作 |
|---|---|
| 编辑器“从边缘撤离” | 选项已暴露，`Objective.isObjectiveMet` 的 `exit_from_edge` 仍直接返回 `false`。这是界面 / 运行时缺口，需另行修复或隐藏；本次未改代码。 |
| 完整 PVP 硬核同步 | 支援仍简化 AI、每方两队步兵；地图复用任务 1；状态清洗缺新增字段。需要对齐编制、完整规则及服务端快照并联网验收。 |
| PVP 断线重连、投降、专用地图 | 断线直接删除对局；未找到独立投降流程或专用地图池。排位 / 观战 / 房间密码等仍为后续设计。 |
| 全局统一 UI 主题模块 | 总策划引用的 `UIStyleGuide.md`、`MilitaryUITheme.ts` 不存在，已去除强制复用缺失模块的陈旧说明。 |
| 3D 物理骰、拖骰行动槽、自动匹配 | 当前是自动摇骰与点击菜单，不计为实现。 |
| 编辑器完整校验 / 事件参数 / 撤销重做 / 直接试玩 | 保存具备基本数据与槽位处理，未发现满足草案全部要求的统一校验或这些完整入口；事件只可编辑前 4 行的少量字段。 |
| 完整录像回放与云存档 | 战报结果回看、状态快照、本地继续已有；不能推断为完整对局重演或账号云同步。 |
| 意大利战役 | `ItalianCampaign.md` 是规则 / 任务参考，未发现对应的正式章节注册与任务资源入口，不能按已可玩章节统计。 |
| 移动端发行 / 商业化 | Cocos 工程与适配已有，不代表 iOS / Android 发包、商店上线、DLC / 购买流程已完成。 |

## 本次针对性验证

抽查 24 个现有测试文件，Node 汇总 68 项：64 通过、4 失败。范围涵盖锁定射击、弹药、战役、强化、车组、城市、天气、编辑器、存档、战报和构建档位。不是全量测试，也没有 Cocos 场景运行验证。

失败记录（在文档修改前复现，此次未修改任何游戏代码或测试）：

| 测试 | 实际失败 | 对功能状态的影响 |
|---|---|---|
| `CampaignCheckpointRestore.test.js` | 测试夹具给 `captureSave` 的 mission 缺 `map`，访问 `mission.map.all()` 报错 | 不能据此断言运行时检查点损坏；此路径验收未完成，需补夹具后验证。 |
| `CannonSmokeShell.test.js` | 抽取场景方法的测试环境未注入新增的 `finishLockedFireAttack` | 已发现烟雾运行时入口，但该测试未验证完成，需补依赖再跑。 |
| `MainGunSuppression.test.js` | HE 同格附带行的旧面板间距正则与当前代码不匹配 | 属于布局 / 断言差异，不能直接推断 HE 规则错误，需查看现行布局与实机效果。 |
| `BattleSceneCombatLogHistory.test.js` | “AI 不自动打开结果面板”的调用数断言期望 5，当前 7 | 需逐个核对调用来源和实际触发，不将整套战报标为通过。 |

通过的关键证据包括 `LockedFire.test.js` 的 7 项、`MenuCampaignFlow.test.js` 的 6 项、`HistoricalUnitProfiles.test.js` 的 8 项、`UrbanTerrain.test.js` 的 8 项，以及战役 / 强化 / 天气 / 编辑器 / 构建档位相关文件。初始检查点测试失败单独记录，不能被菜单恢复测试通过替代。

## 文档维护顺序

1. 策划查当前可玩内容先看本表，再按链接阅读总策划或专项规则。
2. 新增行为同步到对应正文，并更新此表；历史变更只保留当时记录，不能覆盖现行规则。
3. 下一轮优先处理 `exit_from_edge` 缺口与 4 项失败验收，再统一 PVP 规则和编辑器剩余能力；这些是后续开发工作，不是此次文档整理已完成的功能。
