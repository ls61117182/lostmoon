# 六种岩石高地 · 2026-10-16

当前为用户确认的太平洋礁岩风化质感六款：第一款直接使用 `source_art/terrain/reef-surface-preview-20261016/reef-highland-preview-master.png`，其余五款用内置 imagegen 以它为基准改变台面裂缝、矿物脉纹和浅层风化区域，保持哑光颗粒与浅层剥蚀质感。保留撑满格子的钝角六边形、顶部俯视、宽厚岩缘和简洁的大岩面，不加密集孔洞或边缘碎石。地面投影沿用独立 rocky 参数：格子半径的 20%，透明度 88/255，不压扁轮廓。

| 编号 | 样式 | 游戏资源 |
| --- | --- | --- |
| 01 | 已确认的礁岩预览、斜裂缝与浅剥蚀 | `assets/resources/textures/terrain/rocky_highland_01.png` |
| 02 | 三向裂缝、西北及南侧风化区域 | `assets/resources/textures/terrain/rocky_highland_02.png` |
| 03 | 两道分离横裂缝、北侧和东侧风化 | `assets/resources/textures/terrain/rocky_highland_03.png` |
| 04 | 东北浅色剥蚀区、西南较暗岩面 | `assets/resources/textures/terrain/rocky_highland_04.png` |
| 05 | 两道斜矿物脉纹、东侧短裂缝 | `assets/resources/textures/terrain/rocky_highland_05.png` |
| 06 | 西北灰色风化区、东南浅色磨蚀 | `assets/resources/textures/terrain/rocky_highland_06.png` |

`master-reef-01.png` 至 `master-reef-06.png` 为当前原稿，`prompt-reef-01.txt` 至 `prompt-reef-06.txt` 为完整生成提示词。`six-variants.png` 为当前六款总览，`map-distribution.png` 为实际分配算法生成的连片预览，`reef-and-scale-check.png` 比较旧平滑岩面、新礁岩及 64/128 像素效果。预览读取 `ObjectShadowRenderer.ts` 的 rocky 投影参数，合成对应透明轮廓、偏移和透明度的投影；不等同于完整 Cocos 实机截图。`manifest.json` 记录资源、材质、尺寸、投影约定、阴影参数、摘要和占格覆盖，包含与第一款轮廓的重叠率检查。第一张也更新到 `assets/resources/textures/terrain/pacific_rocks.png` 作为备用图。

旧的平滑岩面版本保留在 `master-high-relief-01.png` 至 `master-high-relief-06.png`，提示词为 `prompt-high-relief-01.txt` 至 `prompt-high-relief-06.txt`；`before-reef-assets/` 保存上一版正式六图与导入元数据，`fallback-before-reef.png` 保存上一版备用图，`six-variants-before-reef.png`、`map-distribution-before-reef.png` 和 `height-and-scale-check.png` 保存此前预览。

之前较薄的俯视资源保存在 `master-topdown-01.png` 至 `master-topdown-06.png` 及 `before-high-relief-assets/`，提示词为 `prompt-topdown-01.txt` 至 `prompt-topdown-06.txt`，旧预览为 `six-variants-thin-overhead.png` 和 `map-distribution-thin-overhead.png`。

之前有倾角的版本保留在 `master-01.png` 至 `master-06.png`，对应旧提示词为 `prompt-01.txt` 至 `prompt-06.txt`；`before-topdown-assets/` 保存修正前六张正式贴图及元数据，`six-variants-before-topdown.png`、`map-distribution-before-topdown.png` 保存旧预览，`legacy-fallback-before-topdown.png` 保存旧备用图。

在项目根目录运行 `node source_art/terrain/rocky-highland-variants-20261016/build.cjs` 可复现导出与预览。导出为 222×256 RGBA，沿用既有 Cocos 导入格式，并为每张新图生成独立稳定的 UUID。

`assets/scripts/view/RockyHighlandVariants.ts` 用任务 ID 和格子坐标进行稳定的视觉随机分配，不使用战斗骰子的随机数。随机地图的 ID 已包含地图种子，因此不同随机地图会得到不同排列。先排除邻格已使用的款式，再优先选全图使用次数少的款式，种子化打散同分候选。六种图片配合逐行分配可保证相邻高地不同款；远处可以重复，避免有限图片数量造成不必要的限制。

BattleScene 缓存选图结果，在高地坐标集合或任务 ID 改变时更新。普通地形贴图回退路径、连续地形路径以及格子详情都使用同一选图结果。六张资源纳入首屏地形加载批次，加载失败时回退到原有高地资源。现有岩石阴影系统直接使用所选图片的透明轮廓。菜单与编辑器图例使用第一款作为代表。

验证包含六图不同、尺寸、透明四角、占格覆盖、Cocos 元数据以及原尺寸和小尺寸预览。`tests/RockyHighlandVariants.test.js` 覆盖分配稳定性和相邻不重复，`tests/ObjectShadowRenderer.test.js` 覆盖新高地投影的距离、透明度和旋转后的方向，`tests/BattleSceneRockyShadow.test.js` 覆盖高地专用投影类型及显示层级。相关四项测试和 TypeScript 检查通过；尚未在运行中的 Cocos 战场验证。
