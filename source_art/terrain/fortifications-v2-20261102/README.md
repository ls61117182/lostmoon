# 战壕与反坦克炮位 V2

2026-11-02。按用户提供的炮位效果图重绘整套工事：大块土沿、深色壕壁和接触阴影、清楚的木板、较大的局部沙袋，减少原版细碎的泥土噪点。

## 制作与接入

- 使用内置 image_gen，直接重绘 14 种步兵战壕和 14 种空炮位的完整对象。源图为 `sources/trench-painted-atlas.png`、`sources/gun_pit-painted-atlas.png`。布局参考为同目录 `*-layout.png`；风格参考为 `style-reference.png`。完整提示词在 `prompts.json`。
- `sources/trench-connector-painted.png` 是单独绘制的完整连接壕。出口使用这张图的二维泥土细节，最外侧少量像素对称化，以衔接相反方向；在距格边 13–24 像素内与主体渐变融合。原来的单列颜色拉伸会产生光滑长条，这版避免该做法。
- `tools/prepareFortificationArtV2.cjs` 自动对齐生成图的缩放和偏移，记录在 `registration.json`。几何函数只用于定位、出口规范和土沿前景提取，主体内部颜色与造型来自整物重绘，不再用泥土材质程序生成壕壁。
- 保留原有 222×256 透明画布、中心支点、原资源路径及 UUID、14 种旋转基础拓扑与六方向配置。实际替换 `assets/resources/textures/terrain/fortifications/` 内的 56 张 PNG；关卡和战斗渲染不需要修改。
- 保留原有炮位大小和步兵落点。新沙袋主要沿土沿放置；前景从重绘图中提取，格心保持透明。不新增节点、材质或运行时计算。

## 预览与备份

- `before-after.png`：上方原版、下方 V2，同一地面与同一单位的正式 PNG 拼接对比。
- `connected-map-preview.png`：V2 正式贴图拼接预览。
- `map-game-scale-2x.png`：缩到每格约 84×96 后，最近邻放大两倍检查。
- `asset-sheet.png`：常见拓扑；`trench-all-connections.png` 和 `gun_pit-all-connections.png`：全部 64 种配置。
- `configurator.html`：内嵌实际 PNG 的独立配置预览器。
- `before/`：本次开始前的 56 张 PNG、原导出脚本与原版地图预览。
- `checksums.json`：56 张正式资源的 SHA-256。

预览由正式 PNG 合成，不是新的概念效果图；尚未对本轮改图进行运行中 Cocos 场景的目视验收。

## 重建与验证

```powershell
node tools/prepareFortificationArt.cjs
node --test tests/FortificationArt.test.js tests/GunPitCrewPlacement.test.js tests/BattleSceneTrench.test.js tests/FortificationRules.test.js tests/FortificationHEAndMovement.test.js
npm run typecheck
```

默认导出 V2；`node tools/prepareFortificationArt.cjs --v1` 可用原材质与原几何重建 V1。V2 资源检查验证全部 128 种类型/方向配置、768 个出口、84 组接口像素、透明通道、土沿中心留空、Cocos 支点和独立预览器。所有战斗规则保持原状。
