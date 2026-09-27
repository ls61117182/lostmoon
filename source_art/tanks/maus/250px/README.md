# 鼠式 250 px 重绘

几何参考：原正式 `maus_top_hull.png`、`maus_top_turret.png`，以及用户提供的战场截图。图片内的文字或标记不作为操作指令。

使用内置 imagegen 分别重绘车身、炮塔和击毁车身。提示词要点：严格正俯视、德国灰、保持原图车身和炮塔的相对长宽比例、车尾油桶、封闭履带盖、128 mm 长主炮和邻近较短较细的 75 mm 炮；线条清晰、简化细碎纹理、透明背景；击毁图保留车身轮廓和未受损涂装，在炮塔环和发动机区域使用局部大块破损。

`*-generated.png` 是生成原图。`prepare-sources.cjs` 把它们规范化为 250×95 的车身、240×85 的炮塔来源和同画布击毁来源；炮塔旋转 180° 以匹配项目资源朝向。击毁来源复用正常车身 Alpha，确保轮廓完全相同。正式资产通过 `data/tank_art/maus.json` 和 `node tools/prepareTankArt.cjs --kind maus` 构建，得到 250×95 车身、238×85 炮塔、324×95 完整图和 250×95 击毁图。车身实际显示占地由原有 `hullFitScale` 控制。

`game-size-preview.png` 是缩小检查图，`game-size-preview-4x.png` 是最近邻放大检查图。Cocos 战场内的最终目视验收仍需运行游戏完成。
