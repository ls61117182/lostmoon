# 铁路覆盖层

2026-11-05，按已确认的概念图制作并接入第一版铁路美术。

## 当前规则

铁路叠加在田野、道路、泥地上，基底地形保持不变。现有单位的通行、移动消耗、移动/攻击/杂项骰数、视线、掩护、隐蔽等均继续使用原地形规则；铁路与道路重叠时继续使用道路规则。铁路本身不提供额外掩护、道路移动加成或轨道方向通行限制。

铁路是后续火车行驶所需的地图标记。当前没有新增火车单位、列车移动、调度、道岔切换或战斗规则；这些等待后续需求。现有六向端口记录铁路的可见连接，不预先定义列车在复杂道岔中的合法转向。

## 配置与编辑

地图编辑器选中田野、道路或泥地后，点击格子标题右侧“铁路”，切换六个连接方向。启用方向时同步相邻可用格子的反向连接；移除铁路时同步清除相邻对应端口。改为不支持铁路的地形时移除铁路。“清空附加”也会清除铁路。

铁路通过的格边禁止配置树篱：检查本格和相邻格的反向铁路端口，不能从另一侧补回阻断铁路的树篱。新增铁路时立即清除该边两侧的树篱。保存或导出地图时扫描整张地图，自动删除冲突树篱，保留其他边的树篱；此清理覆盖自定义关卡保存、临时关卡保存和现有关卡文件保存，也适用于导入的旧地图。

带建筑的铁路格使用同时避让道路、铁路碎石道床和平交木板的布局。空间不足时可以减少建筑数量并调整尺寸，但至少保留 3 栋；屋顶之间保持间距。草堆和水井也使用相同净空。战场、格子详情及贴图不可用时的矢量后备绘制复用同一套铁路避让布局；缓存键包含铁路连接方向。

关卡 JSON 在原格子上增加 `rl`，六位 `0/1`，顺序与道路 `rd` 一致：E、SE、SW、W、NW、NE。全零等同没有铁路；非法位串或不支持的基底会被任务加载器拒绝。运行时字段为 `Tile.railway`。不新增独立的 `TerrainType`，因此无需更改现有地形规则表。

```json
{ "t": "f", "rl": "100100" }
```

```json
{ "t": "r", "rd": "010010", "rl": "100100" }
```

第一个例子为田野上的东西向铁路，第二个为公路与东西向铁路的平交。道路方向与铁路方向分别保存；自定义关卡保存和战斗存档恢复沿用原关卡包，保留铁路配置。

示例关卡包：`source_art/terrain/railway-v1-20261105/railway-demo-mission.json`，可导入地图编辑器。

## 美术资源

- 正式资源：`assets/resources/textures/terrain/railway/`。
- 26 张 256×256 RGBA PNG：13 类旋转唯一连接，各包含普通版和平交版；配套 Cocos SpriteFrame `.meta` 和清单。
- 63 种非空六向连接通过道路一致的旋转映射覆盖，包括单端尽头、直轨、两类弯轨、道岔和多轨交叉。轨距固定为源图 22px。
- 深褐木枕、暗钢轨及窄银灰亮边，灰褐碎石道床。平交木板位于钢轨下面，钢轨连续可见。
- 方形贴图使用中心锚点、关闭裁边，运行时按 `2R × 2R` 缩放后旋转，保持六向轨距一致；端口沿格边中点法线贯通，并留少量出血覆盖采样接缝。
- 战场使用单独的缓存精灵池，位于地面道路之上、履带痕/血迹/建筑/单位之下；格子详情和地图编辑器也显示铁路。不改动地面 GPU 合成算法。
- 当前共用一套铁路材质，没有另外制作积雪、损毁或沙漠版本。

源图、完整提示词、正式素材预览、小尺寸预览和可离线打开的 `configurator.html` 位于 `source_art/terrain/railway-v1-20261105/`。预览由项目地面合成器与正式导出 PNG 合成，不是正在运行的 Cocos 截图。

## 重新生成与验证

```powershell
npm run railway:prepare
npm run typecheck
node --test tests/Railway.test.js tests/BattleSceneRoadLayering.test.js tests/BattleSceneTileInspectGround.test.js tests/BattleSceneTileInspectRotation.test.js tests/TerrainGroundRaster.test.js tests/TerrainGroundGpu.test.js
node --test tests/RailwayObstacles.test.js tests/RuralBuildings.test.js tests/levelEditorExistingMission.test.js tests/levelEditorTankCamouflage.test.js
node tools/previewRailwayBuildings.cjs
```

重建脚本使用已保存的 imagegen 材质母图，不重新请求图像生成服务。重新生成正式贴图后刷新 Cocos 预览以导入新资源。

铁路障碍检查包含全部 63 种非空连接的普通/平交 PNG 净空，以及 3 组坐标 × 63 种铁路连接 × 5 种道路布局共 945 组建筑摆放检查；每组均至少 3 栋且避让铁路、道路。`railway-building-clearance-preview.png` 为使用正式素材合成的修正前后对照，不是现场 Cocos 截图。
