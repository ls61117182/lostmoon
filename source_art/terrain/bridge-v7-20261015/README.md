# 欧洲夏季木桥 V7

使用内置 image_gen 重绘完整木桥。原图：`bridge-source.png`；完整提示词：`prompt.json`；直接采样的桥面：`bridge-deck-768x192.png`。桥面使用规整横向铺板、细接缝、低矮纵向边梁和少量螺栓，灰褐色更浅，减少旧版粗糙斑点与程序叠加的深色条纹。

主地图原先将通用木纹和程序线条烘焙成桥面，单独放大桥梁 PNG 不会改变该路径。因此本版将完整桥面 RGBA 数据随 `europeanSummer.bridgeArtwork` 保存，单独上传为 768×192 纹理，不进入 384px 材质图集。着色器按原有桥梁局部坐标采样；含桥的夏季区块及其接缝影响范围使用 2×烘焙，其余区块仍为 1×。桥梁世界尺寸、通行规则、冬季与其他战场保持原样。

格子详情和备用渲染用的桥梁 PNG 从 222×256 提高到 888×1024（横纵尺寸各 4 倍），沿用资源 UUID 和原有画布比例。路径：`assets/resources/textures/terrain/european_roads/european_bridge_surface_summer_v1.png`。

旧版 V5、V6 两个资源包保持原样，新包保存到 `../europe-summer-v6-20261015/detailed-bridge/`。项目根目录运行：

```powershell
node tools/switchEuropeanTerrainArt.cjs detailed-bridge
node tools/switchEuropeanTerrainArt.cjs detailed
node tools/switchEuropeanTerrainArt.cjs classic
```

依次为新版桥梁、V6 原桥、V5 旧地形。切换后重新加载游戏或 Cocos 预览。切回旧包会自动恢复旧桥贴图及其材质、1×烘焙路径，无须还原代码。`../europe-summer-v6-20261015/使用新版.cmd` 已指向本版；`使用V6原桥.cmd` 可以单独撤销本次桥梁改动。

修改前的渲染代码和着色器保存在 `backup/`；TS 源码备份使用 `.ts.bak` 后缀，避免进入项目编译。

`comparison.png`、`three-axes.png` 为项目地面合成器生成的前后对照及三轴向预览，不是 Cocos 实机截图。`bridge-in-map.png` 为新版局部。重建：`node tools/buildEuropeanBridgeV7.cjs`；预览：`node tools/previewEuropeanBridgeV7.cjs`。

验证：`tests/EuropeanBridgeV7.test.js` 检查贴图尺寸、UUID、三个轴向、静态水面遮罩、冬季隔离和普通地面像素不变；`tests/TerrainGroundGpu.test.js` 验证近桥区块 2×、远处区块 1×、世界尺寸和纹理释放；`node tools/validateTerrainGpu.cjs` 实际检查 WebGL 1 编译、WebGL 2 新桥图采样及四类战场接缝。
