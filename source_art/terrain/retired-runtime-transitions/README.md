# 已停用的预制衔接资源

此目录保留原始运行时图片、Cocos UUID、旧匹配器与旧渲染器，供对照和恢复。`*.ts.txt` 是归档代码，不参与项目类型检查或打包。

游戏改用 `assets/scripts/view/TerrainGroundGpuBaker.ts` 与 `assets/resources/effects/terrain-bake.effect`。此目录里的文件不会自动加载。

`tests/TerrainTransitionRuntime.test.js` 和 `tests/TerrainTransitionRenderer.test.js` 继续验证归档内容的完整性；新运行时行为由 `tests/TerrainGroundGpu.test.js` 验证。
