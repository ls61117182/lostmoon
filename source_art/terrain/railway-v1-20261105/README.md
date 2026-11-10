# 铁路美术 V1

日期：2026-11-05。

已按 `../railway-design-v1-20261104/railway-terrain-concept-v1.png` 的美术方向制作实际资源，并接入战场、格子详情及地图编辑器。

## 文件

- `sources/railway-material-strip.png`：内置 image_gen 生成的透明材质母图，保留原始输出。
- `prompt.txt`：母图生成的完整提示词。
- `railway-map-preview.png`：使用项目地面合成器和正式 PNG 合成的示意地图。
- `railway-assets-preview.png`：26 张正式 PNG 的资源表。
- `railway-small-scale-preview.png`：田野/道路/泥地覆盖的正常尺寸与缩小 50% 对比。
- `railway-building-clearance-preview.png`：树篱与建筑避让修正前后对比，示例从 4 栋调整为 3 栋。
- `configurator.html`：可离线打开的六向连接检查器，内嵌全部正式贴图，切换基底和尺寸即可预览。
- `railway-demo-mission.json`：可导入地图编辑器的示例关卡包。
- `preview-layout.json`：预览地图的运行时布局数据。

正式 PNG 和导入元数据位于 `assets/resources/textures/terrain/railway/`，共 13 类连接形状 × 普通/平交两个版本，旋转后覆盖 63 种非空方向组合。贴图为 256×256 RGBA、中心锚点、不裁边，轨距 22px。

制作方式：使用内置 image_gen 制作材质母图；构建脚本将其中的碎石与木质材质应用到固定的六边形几何，并单独绘制连续钢轨、枕木扣件及端头。构建和旋转沿用项目道路方向约定，连接口位置固定。平交道口的木板在钢轨下方。

规则：铁路是覆盖层，田野、泥地、道路的规则不变；与道路重叠时使用道路规则。火车单位及其具体规则待补充。复杂道岔图案不预先承诺火车转向规则。当前未制作积雪或损毁铁路。

重建：项目根目录运行 `npm run railway:prepare`。完整说明和验证命令见 `docs/Railway.md`。

## 验证记录

类型检查通过；铁路、地形缓存、道路层级、格子详情、关卡保存等相关检查共 23 项通过。检查覆盖六向连接口、钢轨在道口的连续可见性、基底规则不变、自定义关卡及存档恢复、示例关卡连接和缓存精灵池。

扩展运行 `tests/FortificationHEAndMovement.test.js` 时，有一项现有预览测试因测试场景缺少 `isHexVisible` 桩失败。该用例调用的 `drawAttackableHighlights` 与 HEAD 相同，不涉及铁路改动。

完成了正式 PNG 和合成地图的目视检查；尚未打开 Cocos 编辑器执行现场预览。

后续修正：配置铁路时清除两侧冲突树篱，阻止在铁路通过的格边新增树篱，保存/导出时清理全图冲突。建筑和附属物同时避让铁路与道路，最低保留 3 栋建筑；945 组铁路/道路/坐标组合通过最小数量、净空和建筑间距检查。相关代码测试为 `tests/RailwayObstacles.test.js`，对照图可运行 `node tools/previewRailwayBuildings.cjs` 重建。
