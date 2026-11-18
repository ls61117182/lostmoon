# 太平洋岩石高地边缘第二版 · 2026-11-18

用户实机反馈指出高地与开阔地交界呈现不自然的深色环。检查发现礁岩壁整体压暗后，还叠加普通坡面暗层、宽坡脚暗带及全周投影，并有规则重复竖纹。第二版将岩壁材质与地面阴影分开计算。

- 岩壁宽度缩至上一版70%，维持跨共享边居中；减小转角圆弧，保留更长的岩壁直面。
- 直接用现有灰米色礁岩本色，向阳面提亮、背光面适度变暗，去掉整周发黑和规则竖纹。
- 岩面用世界坐标下不规则石面与裂隙表现断面，块面法线随相机重新受光；跨格、跨纹理块与重绘不重启花纹。
- 坡脚保留窄暖色接触阴影，外侧投影主要出现在背光面。碎石缩小并集中于坡脚不均匀散落，避免整圈珠链。

修改仅作用于太平洋礁岩美术。高度1、六向高差边界不可通行、同高连片内部无坡面、格心和单位站位均保留原有规则。欧洲草坡和岩坡与修改前输出逐像素一致。

`before/user-game.png` 是用户提供的真实游戏截图；`before/ElevationContour.ts.bak`、`before/icon.png`、`before/map.png` 保存修改前实现及离线输出。`before-after.png` 为生产合成器前后对照，包括缩小显示和模拟迷雾；`after-map.png` 为更新后地图合成。后两者是离线预览，不是实机截图。

复现：

```powershell
node tools/renderPacificHighlandPreview.cjs
node tools/renderPacificHighlandEdgeReview.cjs
npm run typecheck
node --test tests/PacificHighlandEdgeLighting.test.js tests/PacificHighlandReplacement.test.js tests/PacificHighlandElevation.test.js tests/Elevation.test.js tests/ElevationContour.test.js tests/ElevationRenderer.test.js tests/ElevationVision.test.js tests/ElevationCombat.test.js tests/RockyInfantryCover.test.js tests/RockyHighlandVariants.test.js tests/BattleSceneRockyShadow.test.js tests/BridgeMovement.test.js tests/TerrainCategory.test.js tests/levelEditorNormandy.test.js tests/BattleSceneTileInspectGround.test.js tests/BattleSceneTileInspectRotation.test.js tests/BattleSceneTileInspectSizing.test.js tests/BattleSceneImpassableTileInspect.test.js tests/BattleAnimationPerformance.test.js
```

类型检查及81项回归检查通过。已目视检查正常大小、缩小、连片、模拟迷雾、相机90°和图例；Cocos窗口抓取连续超时，未获取修改后的实机截图。
