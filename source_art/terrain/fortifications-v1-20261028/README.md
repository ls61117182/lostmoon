# 战壕与反坦克炮位正式资源 V1

2026-10-28。材质由内置 image_gen 生成，再按固定六角格几何导出透明工事贴图。使用与道路一致的方向编码、旋转归并、222×256 画布与中心支点；底图、单位、炮火特效不烘焙进资源。

## 交付内容

- `assets/resources/textures/terrain/fortifications/`：28 张工事主体 PNG、28 张可选前景土沿 PNG，以及 Cocos `.meta` 和 JSON 配置表。
- `assets/scripts/core/FortificationArt.ts`：配置校验、道路旋转复用和 Cocos 资源路径解析。
- 本目录 `asset-sheet.png`：常见配置总览。
- `connected-map-preview.png`：正式 PNG 旋转、叠加后的地图拼接图；含既有 Pak 38 和步兵精灵作为尺寸参照。
- `map-game-scale-2x.png`：按每格约 84×96 缩小后，最近邻放大两倍的检查图。
- `trench-all-connections.png`、`gun_pit-all-connections.png`：各自全部 64 种配置，使用实际基础 PNG 旋转生成。
- `configurator.html`：无需服务器的独立配置预览器，内嵌正式贴图，可切换类型与六方向并查看配置 JSON。
- `sources/`、`prompts.json`：生成源图、完整生成提示词和来源记录。
- `checksums.json`：56 张正式贴图的 SHA-256。

## 方向与配置

方向与道路的 `rd` 完全同序：**E、SE、SW、W、NW、NE**。字符串每位为 `0` / `1`。例：

```json
{"kind":"trench","connections":"100100"}
```

为东西贯通战壕；`110000` 为东与东南连接，`101010` 为三向连接。

```json
{"kind":"gun_pit","connections":"100000"}
```

为东侧有交通壕连接的炮位。**连接口不是射击口，配置不产生射界限制。** 炮位是无固定朝向的圆形浅炮坑，四周低土沿，炮组平台保持宽敞。

`000000` 表示独立工事，仍有可见战壕或炮坑。没有工事配置才表示无工事。这与道路的空配置行为有意不同。

每类 64 种配置通过旋转复用 14 张主体贴图（13 种道路基础拓扑＋独立工事），对应同样数量的前景贴图。类型切换不改变出口几何，因此战壕和炮位可互相连接。

## 渲染接入约定

调用 `fortificationArtTransform(config)` 取得 `surface`、`foreground` 和 `rotationDegrees`。路径已包含 `/spriteFrame`，可用于 `resources.load`。Cocos Z 旋转为负角度顺时针；浏览器 canvas / 图片旋转则使用相反符号。

PNG 为真实透明，不含草地、雪地或六角格描边；支点固定 `(0.5,0.5)`，关闭自动裁切与动态图集打包。按与道路相同的格子尺寸缩放 222×256 画布，不按透明内容边界独立缩放。

建议绘制顺序：地面 → 主体 `surface` → 单位 → 可选前景 `foreground`。前景仅含土沿、局部土壁和沙袋，中央沟底/炮坑保持透明。具体步兵半身遮挡仍需结合既有步兵精灵的大小、落点与姿态调整，当前资源本身不更改单位显示逻辑。

各出口距格边约 30px 范围内逐渐归一材质与宽度，紧邻边界取消轮廓扰动；斜边出口保留 2px 外溢。木板与沙袋避开格边，减少旋转接缝。出口连接需双方相对位同时开启，例如本格 E 与东邻格 W；预览器不会把未配置的邻边自动连通。

工事现已接入关卡编辑器、MissionLoader、战斗场景和步枪/机枪防护。关卡格子使用 `fort` 包裹该配置，例如 `{"t":"f","fort":{"kind":"trench","connections":"100100"}}`。运行时字段为 `Tile.fortification`。编辑器：选择格子 → 格子属性 →“战壕 / 反坦克炮位”，按道路方向开启连接口。完整规则见项目 `docs/Fortifications.md`。

## 重建与验证

```powershell
node tools/prepareFortificationArt.cjs
node --test tests/FortificationArt.test.js
```

脚本直接复用 `FortificationArt.ts`，其旋转映射复用 `UrbanTerrain.ts` 的道路实现，不另造方向索引。固定源图重建会保留一致的 UUID。PNG 检查覆盖 128 种工事配置的 768 个出口、84 组基础贴图接口像素、透明通道、前景留空、尺寸与导入支点，并检查独立预览器的脚本语法与资源完整性。

本次验证：7 项资源测试通过，项目 `npm run typecheck` 通过；84 组同向接口采样逐像素一致。已目视检查资源总览、正式 PNG 拼接图和缩到每格约 84×96 的预览。尚未进行运行中 Cocos 场景的目视验收。
