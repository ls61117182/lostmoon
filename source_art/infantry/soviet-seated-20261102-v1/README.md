# 苏军步兵素材接入

游戏单位为现有的 `soviet_infantry`，三名士兵依次为步枪兵、波波沙冲锋枪兵、DP 轻机枪兵。

- 站姿源图：`../soviet-20261102-v2/SovietInfantry01/02/03.png`。
- 坐姿源图：本目录的 `SovietInfantry01/02/03_seated.png`。
- 游戏资源：`assets/resources/textures/units/SovietInfantry01/02/03[ _seated ].png`（文件名无空格）。
- 站姿配置：`data/infantry_visuals.csv`；三个位置均使用 0.6 缩放。
- 坐姿配置：`assets/scripts/view/TankRiderVisual.ts`；沿用其他阵营的髋部锚点、车身座位及内收距离。
- 坐姿全画布保留，髋部位于横向 50%、从上向下 61%；站姿使用可见轮廓裁边信息参与战场等比适配。
- 坐姿 RGB 增益分别为 `(220,217,211)`、`(231,228,211)`、`(223,221,215)`，按原站姿与坐姿在 24px 下的透明度加权颜色校准。

六张 PNG 的原始透明通道均保留。坐姿由内置 imagegen 生成，逐张提示词见 `generation-prompts.json`。

重新导入资源与配置：

```powershell
node tools/prepareTankRiderAssets.cjs
node tools/buildInfantryVisualDB.js
```

查看全阵营坐姿及 T-34 乘车比例：

```powershell
node tools/previewTankRiders.cjs
```

打开 `http://127.0.0.1:8766`。本次对照截图保存在 `all-factions-preview.png`。
