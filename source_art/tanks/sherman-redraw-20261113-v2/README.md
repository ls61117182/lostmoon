# 谢尔曼系列重绘第二轮：实车型号校正（2026-11-13）

状态：仅车身、炮塔候选稿；不替换游戏资源，待用户确认后再制作其他状态。上一轮未获确认，不作为本轮生成参考。

## 用户确定的型号

- 谢尔曼：M4A1。
- 谢尔曼76：M4A1(76)。
- 巨无霸：M4A3E2。

为避免混合不同时期部件，本轮具体选择：M4A1(75)后期小舱口铸造车体、VVSS、M34A1炮盾、单个对开式车长舱口；M4A1(76)W大舱口铸造车体、VVSS、无制退器M1A1炮与早期T23炮塔；M4A3E2原装75毫米炮、T110厚炮盾与专用炮塔、VVSS鸭嘴连接件。以上次级配置是本轮明确采用的参考方案，不代表所有同名实车都相同。

## 参考来源

1. M4A1 75小舱口后期四视图：https://www.theshermantank.com/the-sherman-tank-variant-page-pages-for-each-type-of-sherman-tank/the-sherman-m4a1-medium-tank-first-and-last-produced/ ，原图 https://www.theshermantank.com/wp-content/uploads/M4A1-small-hatch-75-late-color-line-1-1151x1600.jpg
2. M4A1(76)W VVSS四视图：https://onwar.com/wwii/tanks/usa/us017m4a176wp.html ，原图 https://onwar.com/wwii/tanks/usa/us017m4a176w.jpg
3. M4A1(76)历史手册俯视照片与部件名称：https://www.theshermantank.com/the-sherman-tank-variant-page-pages-for-each-type-of-sherman-tank/the-sherman-m4a1-medium-tank-first-and-last-produced/the-sherman-m4a1-76w-this-first-76-sherman-into-combat-in-us-hands/ ，原图 https://www.theshermantank.com/wp-content/uploads/M4A1-76-top-view-top-view-9731-flat.jpg
4. M4A1(76)W参数核对：https://www.theshermantank.com/wp-content/uploads/M4A1-76w-specsheet.pdf
5. M4A3E2三视图：https://getoutlines.com/blueprints/18216/m4a3e2-sherman-blueprints ，原图 https://getoutlines.com/download/blueprint/18216
6. Cobra King实车修复方拍摄的炮塔与车体照片：https://www.brhoward.com/cobra-king-sherman-tank ，原图 https://images.squarespace-cdn.com/content/v1/5b338c6bf93fd40cc613354d/1579107702400-3FDW6TN7S11U0O0XX1CI/IMG_3776.jpg

参考图存放在 references。*-top-plan.png 只从原三视图裁出顶视图并旋转车头朝上，避免生成时混入侧面轮组；未使用旧游戏图或上一轮生成图。实车修复照片只辅助核对零件，不复制其透视或损耗。

## 本轮约束

几何和主要结构优先。保留真实轮廓、不对称布局和各型号舱口数量；不能为对称或装饰增加舱口、格栅或铆钉。M4A1后部为R975发动机对应的甲板盖，不套用M4A3的双格栅。普通75型本轮参考无装填手舱口；76型与巨无霸各自按参考保持两个舱口。

采用内置 image_gen，每个车身和炮塔独立调用，完整提示词在 prompts。输出透明PNG，车头朝上。车身中隐藏在炮塔下的区域仅绘连续闭合甲板，不凭空增绘大圆盘或炮塔零件。候选分层合成只作本轮审阅，不改CSV、meta和运行时配置，不制作击毁/车长等其他资源。

## 交付与检查结果

- `reference-comparison.png`：历史参考与新稿，按相同车身长度并排，方便逐项核对。参考白底区域是原图裁切；新稿是重新绘制。
- `review-board.png`：六个分层、三型支点合成及小尺寸检查。
- `candidates/`：每型 `*_hull.png`、`*_turret.png`，同一800×1400透明画布。原点直接叠加即可复现 `*_assembled.png`，没有分别拉伸画布。所有比率调整都保持图像宽高比。
- `generated/`：生成服务原始输出与局部修正版本。采用 M4A1 车身/炮塔v2；M4A1(76)车身v1、炮塔v2；M4A3E2车身v1、炮塔v2。
- `previews/`：76/76/78px车身长度的小尺寸及最近邻3倍图。尺寸来自默认hexSize=60、hullFitScale=0.70/0.70/0.72估算，未在游戏运行时验收。缩小后大型轮廓、短/长炮与舱口组合仍可辨，细小附件会损失。
- `review-audit.json`：参考量取、临时支点、等比缩放、透明像素检查和已知局限。参考坐标为人工量取，并非逐像素描摹。

本轮已校正 M4A1 的铸造车体与R975甲板、普通75单对开舱口、76型双舱口与VVSS、M4A3E2专用炮塔/炮盾；并修正了普通型分层串入的后部铰链/附件，以及76型相对过短的炮管。

**尚未完成的精度项：M4A3E2炮管相对炮塔宽度仍比参考短约15–20%。** 已在对照图标注。最后几次针对该处的内置图像微调被服务的输入内容检查拦截，未采用手绘或拉伸冒充已修复。当前巨无霸仍是待修正候选，全部三型都尚未由用户批准，不应作为生产资源接入。其余细部也应以对照图供用户确认，不能把本轮描述成所有零件已经与真车完全一致。

复现排图：`node source_art/tanks/sherman-redraw-20261113-v2/build-review.cjs`。脚本只进行等比缩放、支点合成和预览排版，清除alpha≤4的近透明边缘杂点，不绘制或补造车辆零件。
