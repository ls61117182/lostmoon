# 岩石高地重设计 · 2026-10-16

当前游戏使用后续六款俯视资源，正式构建入口为 `source_art/terrain/rocky-highland-variants-20261016/build.cjs`。本目录保留单图迭代历史；运行此处旧的 `export.cjs` 会恢复历史备用图，当前资源应使用后续构建入口导出。

根据用户提供的岩石高地格子参考，制作浅灰色平坦台面、浅色破碎岩缘、深灰分层崖壁和右下投影。适配项目现有尖顶六边形，保留少量裂隙，突出小尺寸下的高低层次。

第二版按用户反馈对上下两个尖角做轻微自然圆滑处理，使用内置 imagegen 编辑。第二版原稿为 `rocky-highland-rounded-v2-master.png`，编辑提示词见 `rounding-v2.prompt.txt`。`before-rounding-222x256.png` 保留修改前版本，第二版对比预览保留为 `review-v2.png`，初版对比预览保留为 `review-v1.png`。

第三版按用户反馈改成宽厚的自然圆角方形岩体，消除上下尖端。原稿为 `rocky-highland-squircle-v3-master.png`，使用内置 imagegen 编辑，提示词见 `squircle-v3.prompt.txt`。第三版导出保留岩体比例，使用 210×204 的透明容器并扩展到 222×256。`before-squircle-v3-222x256.png` 保留第三版修改前贴图，`review-v3.png` 保留第三版预览。

第四版按用户反馈恢复尽量铺满格子的六边形岩体，保留较平直的边，仅磨钝转角。正上方俯视，去掉前侧多层厚崖壁，仅用环绕台面的窄岩缘体现起伏。第四版原稿为 `rocky-highland-topdown-v4-master.png`，由内置 imagegen 编辑，完整提示词见 `topdown-v4.prompt.txt`，格子与视角参考见 `topdown-v4-grid-reference.png`。原稿按格子轮廓绘制，导出到 218×252 后加四周 2 像素透明余量，最终仍为 222×256。`before-topdown-v4-222x256.png` 保存第四版修改前贴图，`review-v4.png` 保留第四版前后对比及 64/128 像素与相邻格子的效果。游戏投影继续使用现有场景阴影系统。

第五版按用户反馈强化高度感：保留第四版铺满格子的钝角轮廓，围绕平坦台面增加两至三层较厚的破碎岩缘，用亮色上沿和较深的层间裂隙表现高差。第二次编辑扩大上方岩缘，平衡上下两侧的层次分布，维持顶部俯视。第五版原稿为 `rocky-highland-height-v5-master.png`，两次内置 imagegen 编辑提示词保存在 `height-v5.prompts.txt`。`before-height-v5-222x256.png` 和 `review-v4.png` 保存修改前贴图及预览，`review-v5.png` 保留第五版高度调整对比。导出尺寸和场景投影系统沿用上一版。

第六版按用户反馈简化边缘：将密集的小块岩石和多层碎边合并为较大的连续岩壁面，减少分割裂缝，保留高地厚度和钝角六边形轮廓。当前导出源为 `rocky-highland-simple-v6-master.png`，内置 imagegen 编辑提示词见 `simple-v6.prompt.txt`。`before-simple-v6-222x256.png` 和 `review-v5.png` 保留修改前贴图及预览，`review.png` 为当前简化前后、小尺寸与相邻格子预览。尺寸与场景阴影沿用上一版。

- `reference.png`：用户参考图。
- `rocky-highland-master.png`：内置 imagegen 生成的透明底原稿。
- `prompt.txt`：完整生成提示词。
- `rocky-highland-222x256.png`：正式导出的 RGBA 贴图副本。
- `previous-pacific_rocks.png`、同名 `.meta`：替换前资源及导入设置备份。
- `review.png`：新旧对比、64/128 像素和相邻六边形预览。
- `export.cjs`：裁除透明留白并缩放导出，保留原稿内的透明通道，生成上述预览。

游戏资源为 `assets/resources/textures/terrain/pacific_rocks.png`。战场与地形选择界面沿用原有引用，无需修改代码。原有 `.meta`、UUID 和 222×256 尺寸保持一致。

在项目根目录运行 `node source_art/terrain/rocky-highland-20261016/export.cjs` 可复现导出与预览；脚本验证尺寸、透明四角、alpha 通道及导入配置与备份一致。已目视检查预览，尚未在 Cocos 运行中的战场验证。
