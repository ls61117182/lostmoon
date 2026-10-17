# 欧洲夏季重型钢桥

按坦克对战游戏的美术要求，将本轮桥梁改为重型铆接钢桥：钢板桥面、连续纵向边梁、横向加劲结构及铆钉，严格垂直俯视，无木纹与木板结构。原有桥梁世界尺寸、格子通行规则与道路衔接不变。

使用内置 image_gen；完整提示词见 `prompt.json`，生成原图为 `bridge-source.png`。项目直接采样的 RGBA 桥面为 `bridge-deck-768x192.png`；备用/详情面板精灵图为 888×1024，沿用原资源 UUID。主地图使用独立桥面纹理，含桥区块及其接缝影响范围使用 2×烘焙，远处普通地面仍为 1×。

当前启用的资源包：`../europe-summer-v6-20261015/detailed-steel-bridge/`。此前 classic、detailed、detailed-bridge 三套资源包均保留；本次除了桥面数据、桥梁 PNG 和相应导入尺寸之外，其他 V6 资源逐字节不变。

项目根目录运行：

```powershell
node tools/switchEuropeanTerrainArt.cjs detailed-steel-bridge
node tools/switchEuropeanTerrainArt.cjs detailed
node tools/switchEuropeanTerrainArt.cjs classic
```

依次为钢桥新版、V6 原桥、V5 旧地形。也可双击本目录的“使用钢桥.cmd”和“恢复原桥.cmd”。切换后重新加载游戏/Cocos 预览。

构建与预览：

```powershell
node tools/buildEuropeanBridgeV7.cjs --steel
node tools/previewEuropeanBridgeV7.cjs --steel
```

`comparison.png` 为原木桥和新钢桥对照，`three-axes.png` 为三个轴向，`bridge-in-map.png` 为新版局部。这些是项目地面合成器预览，不是实机截图。

验证通过：EuropeanBridgeV7、EuropeanTerrainVersions、EuropeanWinterArt、TerrainGroundRaster、TerrainGroundGpu 五项定向测试；项目 TypeScript 类型检查；实际 WebGL 1 编译和 WebGL 2 钢桥图采样、水面遮罩及四类战场接缝检查，最大接缝误差 0。GPU 验证记录为 `gpu-validation.json`。已执行钢桥→V6原桥→钢桥回切并核对活动资源校验值。
