# 九二式70毫米步兵炮：已接入

用户已确认替换并完成接入：日军 `at_gun` 使用正常稿及第三版击毁稿，中文名称为“九二式步兵炮”，英文名称为“Type 92 Infantry Gun”。单位配置、视觉配置、本地化、编辑器、调试界面和关卡说明中的名称已同步。内部ID和战斗数值保持兼容。

正式贴图为 `assets/resources/textures/units/at_gun_top.png` 与 `at_gun_top_destroyed.png`，各150×113，沿用原UUID；炮口坐标更新为(1,55)。`before-install/` 保留替换前贴图、元数据及单位参数。安装脚本为 `install-approved.cjs`。

已通过 `pnpm run tank:validate`（34类资源审计、17项测试、TypeScript检查）及炮组加载、战役运行测试。尚未在Cocos实机进行画面验收。下方保留各版制作记录及历史确认图。

## 击毁稿第二版

### 第三版：掉落车轮完全平躺

最新确认图为 `review-sheet-v3.png`，最新候选透明贴图为 `type92_top_destroyed-v3.png`。车轮改为正俯视圆形、同心轮毂和圆形孔洞，取消斜立椭圆轮面与突出的轮毂侧壁。使用内置imagegen编辑，完整提示词见 `destroyed-v3.prompt.txt`。

`destroyed-wheel-flat-v3-generated.png` 保留工具原始输出；`finalize-wheel-v3.cjs` 仅提取车轮区域，保持等比缩放后覆盖第二版同一局部，得到 `destroyed-generated-v3.png`，避免其他炮体像素被生成工具改动。`wheel-edit-audit-v3.json` 已验证车轮区域外改变像素数为0。`review-audit-v3.json` 已验证透明通道、同一裁切与正式文件哈希。

第三版重建：先执行 `node source_art/artillery/type92-review-20261015/finalize-wheel-v3.cjs`，再执行 `node source_art/artillery/type92-review-20261015/build-review.cjs --v3`。预览脚本末尾的哈希检查针对接入前状态；接入后会按设计提示正式文件已变化，不应再次当作接入检查。

按用户反馈增强轮廓破损：下侧车轮脱落并平躺在炮体旁，下侧尾架中段断裂并留出明显间隔，保留断炮与炮盾焦黑。正常源稿和正常候选贴图的哈希均未变化，正式资源与配置的哈希也未变化。

- 最新确认图：`review-sheet-v2.png`，包含约65像素的预览和击毁图3倍最近邻放大。
- 最新源稿：`destroyed-generated-v2.png`，1347×1167透明PNG。
- 最新候选：`type92_top_destroyed-v2.png`，150×113透明PNG。
- 内置imagegen完整编辑提示词：`destroyed-v2.prompt.txt`。
- 检查结果：`review-audit-v2.json`；复用原裁切和缩放，源图底部约1像素半透明抗锯齿边缘被裁去，不改变主体尺度。
- 执行 `node source_art/artillery/type92-review-20261015/build-review.cjs --v2` 重建第二版。第一版文件保留用于对照。

## 参考资料

- [Photo Interpreter's Guide to Japanese Military Installations, Part II](https://www.allworldwars.com/Photo-Interpreters-Guide-to-Japanese-Military-Installations-Part-II.html)，TYPE 92 (1932) 70-MM HOWITZER 条目的[上下视图照片](https://www.allworldwars.com/image/098/PhotoInterpretersGuide127.jpg)：以下方俯视图为几何基准，炮口向左、短炮管、窄轮缘、展开双尾架。
- [澳大利亚战争纪念馆：70 mm Type 92 Howitzer](https://www.awm.gov.au/collection/C153289)：核对型号、短炮管、分叉尾架、薄钢炮盾和涂装背景。
- [Wikimedia Commons：Battery Randolf 馆藏结构特写](https://commons.wikimedia.org/wiki/File:Type_92_battalion_gun-_detail-_randolf_museum.jpg)：理解炮尾、手轮和尾架结构。
- [Wikimedia Commons：Fort Sill 馆藏](https://commons.wikimedia.org/wiki/File:Type92Sill.jpg)：辅助核对短身管和紧凑炮架。没有按此馆藏的红褐漆色绘制。

参考照片仅用于研究，未抠图当作成品。画风参考项目已确认 SU-152 简化粗线版。采用卡其橄榄色、粗轮廓、少量明暗色块。

## 文件

- `normal-generated.png` / `destroyed-generated.png`：内置 imagegen 生成的透明源稿，各 1347×1167。
- `type92_top.png` / `type92_top_destroyed.png`：候选透明 PNG，各 150×113。两张应用同一裁切区域与缩放，击毁断炮不会使炮身放大或移动。
- `review-sheet.png`：大图、现有资源、约65像素预览和最近邻放大对照。
- `normal.prompt.txt` / `destroyed.prompt.txt`：完整生成与编辑提示词；本次使用内置工具，没有使用 CLI。
- `runtime-baseline.json`：制作前正式资源、元数据和视觉配置的哈希。
- `review-audit.json`：透明通道、源图尺寸、共享裁切、候选输出尺寸和正式文件哈希核对结果。
- `build-review.cjs`：在项目根目录执行 `node source_art/artillery/type92-review-20261015/build-review.cjs` 重建候选与预览。

## 验收与接入注意

制作阶段已目视检查俯视轮廓、正常/击毁两态、小尺寸预览及透明区域，并在确认前核对正式文件哈希未变。当前已完成资源接入，尚未进行游戏内目视验收。

65像素依据默认 `hexSize=60`、`fitScale=0.6`，最长边约为 `60×1.8×0.6=64.8`；地图缩放会影响实际显示尺寸。

接入保持150×113自然比例，没有拉伸到旧资源的100×50；已同步PNG元数据、炮口坐标并执行资源审计。沿用既有 `at_gun` 平衡数值，本次仅更新美术和名称。
