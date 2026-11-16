# 谢尔曼三型：正式尺寸分层与加强击毁图 · 第十七轮

> 2026-11-15后续调整：巨无霸宽度已由416改为380并接入游戏，见[第十九轮](../sherman-jumbo-width380-20261115-v19/README.md)。本目录巨无霸保留为调整前记录，重装巨无霸请使用第十九轮脚本。普通和76型仍沿用本目录。

按用户要求，先输出不超过200像素的正式车身、炮塔，再将这批正式尺寸车身直接作为图像编辑目标制作击毁状态。上一轮细小毁伤被用户否定，不再作为本轮损伤输入。

用户于2026-11-14明确要求“替换到游戏里”，本批资源现已接入。游戏内路径保持原名，共替换12张PNG；同步CSV、生成数据库及Cocos元数据，保留全部原UUID。下面的`normal/`和`destroyed/`仍保留车头朝上的审阅源稿，运行资源无损旋转为游戏统一的车头朝左方向。

## 游戏接入记录

- 正式路径：`assets/resources/textures/units/sherman*_top*.png`，三型均含车身、炮塔、合成与击毁图。
- 游戏车身/击毁158×84，炮塔160×66，合成199×84；仍全部≤200像素。
- 三型车身支点统一(74.8,42)，炮塔支点(116.8,33)，炮塔缩放1、无附加偏移，车身缩放统一0.7，保持公共座圈在游戏中的尺寸一致。
- 按可见炮口重新校准主炮、同轴机枪、航向机枪和车长舱口坐标，数据见[integration-report.json](integration-report.json)。旧配置和资源完整备份在该报告指定的`integration-backups/`目录，TypeScript备份用`.bak`扩展名避免参与编译。
- `pnpm run tank:validate`通过：35型资源审计、24项流程回归及TypeScript检查。
- 额外的谢尔曼资源、炮塔旋转、机枪炮口、炮塔击飞等53项回归全部通过，见[integration-regression.log](integration-regression.log)和[integration-validation.log](integration-validation.log)。新测试为`tests/ShermanTankVisual.test.js`。
- 替换前发现旧`CommanderHatchVisual.test.js`固定比例快照已在`sherman_jumbo`断言失败。本轮未修改该旧测试；新测试已单独检查三型车长舱口位于可见炮塔内。
- 当前环境未运行Cocos预览，因此尚未做实机画面验收。重装同批资源使用本目录`install-game.cjs`后运行`tank:build`；旧`data/tank_art/sherman_jumbo.json`属于先前美术流程，不用于本批固定画布资源。

## 文件

所有PNG均为车头向上的正俯视、真实透明RGBA。

| 车型 | 车身84×158 | 炮塔66×160 | 合成84×199 | 击毁84×158 |
| --- | --- | --- | --- | --- |
| M4A1 | [车身](normal/sherman_top_hull.png) | [炮塔](normal/sherman_top_turret.png) | [合成](normal/sherman_top.png) | [击毁](destroyed/sherman_top_destroyed.png) |
| M4A1(76)W HVSS | [车身](normal/sherman76_top_hull.png) | [炮塔](normal/sherman76_top_turret.png) | [合成](normal/sherman76_top.png) | [击毁](destroyed/sherman76_top_destroyed.png) |
| M4A3E2 Jumbo | [车身](normal/sherman_jumbo_top_hull.png) | [炮塔](normal/sherman_jumbo_top_turret.png) | [合成](normal/sherman_jumbo_top.png) | [击毁](destroyed/sherman_jumbo_top_destroyed.png) |

- [正式尺寸分层、合成与击毁对照](production-size-review.png)：上排按PNG原始尺寸，下排车身正常/击毁最近邻2倍。
- [上一版与本版击毁对照](damage-before-after.png)：158px原图、最近邻3倍和约76px车长检查。
- [坐标与来源清单](layout.json)、[审计](review-audit.json)。

## 正常资源先行

正常车身与炮塔沿用最新轮廓，普通/76型来源第十轮，巨无霸来源第十四轮。不重新设计车型或变更巨无霸的弧形肩部。以统一0.19比例将800×1400源画布缩为152×266，再按固定坐标裁出正式PNG。所有图层比例相同，没有分别紧裁后各自放大到200像素。

三型名义车身长152像素；普通/76型宽约70像素，巨无霸宽约79像素。PNG的84×158包含少量透明边距。统一座圈直径约44.84像素，黑色内孔保留。

支点坐标均以左上为原点、像素为单位：

| 图层 | 共同缩放画布内裁切框 x,y,w,h | 炮塔轴心 |
| --- | --- | --- |
| 车身/击毁 | 34,62,84,158 | 42,74.8 |
| 炮塔 | 43,20,66,160 | 33,116.8 |
| 合成 | 34,21,84,199 | 42,115.8 |

炮塔与车身支点相合，炮塔相对车身左上角偏移(9,-42)。合成图从共同画布确定性合成，负偏移区域保留在合成框中。后续接入须用新尺寸和坐标更新配置，不能套用当前游戏旧图片的支点、裁切和缩放参数。

## 基于正式车身的击毁图

生成使用内置 **image_gen编辑模式**。输入仅为`references/*_final-hull-edit-target.png`，它们与正式车身文件逐字节一致；未使用第十五/十六轮击毁图或带炮塔整车作为输入。

完整提示词：

- [M4A1](prompts/m4a1_destroyed.txt)
- [M4A1(76)](prompts/m4a1_76_hvss_destroyed.txt)
- [M4A3E2](prompts/m4a3e2_destroyed.txt)

本轮目标是小图可读的大毁伤：车首驾驶员舱区明显撕裂、发动机甲板大面积揭开、黑色机舱和粗大弯曲构件、翻折钢板及一侧后履带破损。没有炮塔、炮管或散落炮塔，没有烟火、地面与碎屑。未损部位保持橄榄绿，不靠整车压黑表现击毁。

图像工具原始输出在`generated/*_destroyed.png`。工具会返回较大的编辑结果，随后按正常车身长度整体等比配准并缩回84×158，局部合入大毁伤。并非直接交付大图，也不是把旧版小破损再压缩。技术合入保留正常车身Alpha，以及圈心半径24像素内全部正常像素；没有用代码另画破损。

## 检查

- 12张正式PNG最长边均≤200，最大为合成图199px；均有真实Alpha。
- 正常车身和编辑目标SHA256一致，源正常图未修改。
- 击毁与正常车身同尺寸、同Alpha、同支点；座圈保护区像素差异0。
- 已目视检查158px原始图、最近邻2/3倍、约76px车长缩略图及正常整车合成。前后大破口明显，仍能辨认三型差异。
- 按排除座圈后的深色像素数量粗略比较，同尺寸新版为上一版约2.07倍、2.24倍、1.77倍。该指标仅辅助比较深色区域，不等同真实毁伤面积或代替目视验收。
- 以上为制作阶段检查；后续接入状态及检查结果见本文开头“游戏接入记录”，Cocos实机目视验收尚未进行。

复现顺序：先运行`build-normal.cjs`，生成后保留图像工具结果，再运行`build-destroyed.cjs`。
