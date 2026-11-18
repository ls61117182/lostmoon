# 太平洋连续礁岩高地 · 2026-11-17

已把原有逐格独立岩块改为高度 +1 的连续礁岩台地。六向高差边界均为不可通行岩壁；同高连片内部无坡面。岩面采用用户先前确认的灰米色风化礁岩质感，保持 90° 垂直俯视、浅台面、自然受光岩壁、裂隙和稀疏碎石。光线与现有高地系统一致，屏幕左上方来光；格心与单位不偏移。

`reef-top-generated.png` 是内置 imagegen 生成的台面原稿，`prompt.txt` 为完整提示词。`design-review.png` 对比旧图、新单格与连片效果；`runtime-compositor-map.png` 为地图合成；`small-scale.png` 与 `camera90-lighting.png` 检查小尺寸及另一相机方向。预览使用生产地面和轮廓合成器，属于离线预览，并非 Cocos 实机截图。`review-map.json` 可导入关卡编辑器检查。

运行 `node tools/prepareElevationMaterial.cjs` 将原稿缩小编码进 `assets/resources/textures/terrain/elevation/continuous-material.json`（版本6），再运行 `node tools/renderPacificHighlandPreview.cjs` 生成预览。运行时台面只按世界坐标采样一次，不再叠加旧六种独立岩块或它们的投影；旧图保留在原目录供历史对照。

旧关卡和存档无须迁移：`tileHeight` 对无显式高度的 `H` / `rocky` 返回1，显式高度优先；`isCliffEdge` 对岩石高地的所有高差边界返回不可通行。同高时仍遵循现有高地规则，不产生坡面。原有岩石地形的单位进入限制、掩护与视野属性继续生效，高度同时参与现有仰射修正。编辑器和格子详情使用同一连续渲染输出。

菜单及编辑器图例使用生产合成器导出的 `assets/resources/textures/terrain/pacific_highland_elevation.png`。编辑器地面与高度覆盖层放在 `EditorGroundBelowMarkers` 内，工事、单位标记、坐标、随机编号及选择轮廓继续在上层显示。

全量替换已完成：移除 BattleScene 的旧六图加载、选图缓存、岩块精灵池及独立投影层，同时停止加载无使用者的 `redesign_v3/rocks`。加载进度数量改为按实际资源列表计算。历史选图 TypeScript 工具及元数据移至 `source_art/terrain/rocky-highland-variants-20261016/`，对应历史构建脚本和测试已更新路径，运行时不再引用。检查确认12个现有关卡共44个H格全部自动使用新版本；随机地图、导入导出与旧存档重载无需迁移数据。

2026-11-18 边缘第二版已去掉宽黑环及重复竖纹，缩窄岩壁，改为浅色石灰岩断面与不规则裂隙，坡脚仅保留窄接触阴影，明显投影集中于背光侧；碎石改为在坡脚不均匀散落。用户实机反馈图、修改前代码与图例、前后对照保存在 `source_art/terrain/pacific-highland-edge-v2-20261118/`。

最终验证：TypeScript 类型检查通过，81 项相关检查通过，包含边缘受光和阴影宽度、欧洲输出像素一致、全量替换、旧关卡与旧存档、高地、视野、战斗、桥梁、格子详情、编辑器诺曼底工具与动画缓存回归。已目视检查设计总览、105×88 小尺寸、图例、模拟迷雾和相机90°的离线输出；尝试抓取 Cocos 窗口连续超时，尚未验证实机画面。

验证命令：

```powershell
npm run typecheck
node --test tests/PacificHighlandReplacement.test.js tests/PacificHighlandElevation.test.js tests/Elevation.test.js tests/ElevationContour.test.js tests/ElevationRenderer.test.js tests/ElevationVision.test.js tests/ElevationCombat.test.js tests/RockyInfantryCover.test.js tests/RockyHighlandVariants.test.js tests/BattleSceneRockyShadow.test.js tests/BridgeMovement.test.js tests/TerrainCategory.test.js tests/levelEditorNormandy.test.js tests/BattleSceneTileInspectGround.test.js tests/BattleSceneTileInspectRotation.test.js tests/BattleSceneTileInspectSizing.test.js tests/BattleSceneImpassableTileInspect.test.js tests/BattleAnimationPerformance.test.js
```
