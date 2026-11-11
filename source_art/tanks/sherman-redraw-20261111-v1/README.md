# 谢尔曼全系列重绘首轮（2026-11-11）

状态：仅车身、炮塔候选稿，等待用户确认；未接入游戏，未替换既有资源。

范围来自 `data/units.csv`：sherman、sherman76、sherman_jumbo 三型。新稿没有读取或使用项目既有坦克图片。画风采用清晰简化、粗轮廓、少量明暗色块；几何依据独立搜索的外部三视图。

## 独立参考

- 谢尔曼75：M4A3(75)W VVSS 四视图，https://www.onwar.com/wwii/tanks/usa/us019m4a375wp.html ，图片 https://onwar.com/wwii/tanks/usa/us019m4a375w.jpg
- 谢尔曼76：M4A3(76)W HVSS 四视图，https://www.onwar.com/wwii/tanks/usa/us020m4a376wp.html ，图片 https://onwar.com/wwii/tanks/usa/us020m4a376w.jpg
- 巨无霸：M4A3E2 三视图，https://getoutlines.com/blueprints/18216/m4a3e2-sherman-blueprints ，图片 https://getoutlines.com/download/blueprint/18216
- 炮塔辅助：历史手册 TM 9-731AA 顶视部件图，https://www.theshermantank.com/about/sherman-tank-turrets/ ，此图为 M4A1(76)，只辅助核对炮塔部件，不能用作 M4A3 车身依据。
- 巨无霸配置核对：https://www.theshermantank.com/wp-content/uploads/M4A3e2-Jumbo-spec-sheet.pdf

首轮美术选择：普通75采用 M4A3(75)W；76采用 M4A3(76)W HVSS；巨无霸采用 M4A3E2 原装75毫米炮。它们是本次重绘候选的具体历史配置，并非宣称项目通用名称只对应这一种实车。

## 生成约束

使用内置 image_gen 生成。每型号分别生成车身与炮塔，正俯视、车头向上、真实透明背景。禁止把侧面轮组画进顶视图；舱口、格栅与工具布局依各自参考，保持不对称。禁止用现有游戏资源作参考。

此阶段不制作击毁图、车长舱口状态、残骸或其他衍生资源。不改 assets、CSV、meta 或资源注册。源图是审美审批候选；尺寸归一、合成预览和支点仅供评审，不是正式游戏配置，后续确认后仍须正式几何校准和游戏内验收。

## 查看与交付

- `review-board.png`：三型分层、合成与默认地图尺寸总览。
- `generated/`：内置 image_gen 原始生成结果；v2 是局部修正稿。巨无霸炮塔使用 v1，其余采用 v2。历史原稿保留便于对照。
- `candidates/`：每型的 `*_hull.png` 和 `*_turret.png`，均为真实透明背景；另有确定性合成的 `*_assembled.png`。两层使用同一个 800×1400 画布，直接按原点叠加即可复现此预览；没有分别拉伸。名义车身长度800px，炮塔相对尺度独立依参考校准，未采用游戏旧素材比例。
- `previews/`：约76/76/78px车身长的原尺寸图，以及最近邻4倍图。小图尺寸根据 BattleScene 默认 hexSize=60 和现有显示配置公式 `60 * 1.8 * hullFitScale` 估算；只是画布外预览，不代表已进入游戏验证。
- `references/`：外部参考原图；`prompts/`：完整生成与修正提示词；`review-audit.json`：透明像素、画布、缩放与预览支点记录。
- `build-review.cjs`：仅对新候选进行等比缩放、支点叠加及版式排图，不写游戏资源。移除重采样时 alpha≤4 的近透明边缘像素以免预览工具显示彩色杂点；保留其余透明度。最近邻放大检查图使用中性底色。

## 本轮检查

已检查三种车身和三种炮塔独立、闭合舱盖、朝向一致、透明背景、分层叠加、短75毫米炮/长76毫米炮/巨无霸厚炮盾的缩小辨识。已修正普通车身残留的炮塔零件、76型车身残留炮盾、普通炮塔多余第三舱口，以及车首机枪前后位置。此轮仍是待确认的美术候选，细小附件与正式支点将在确认方向后继续核对；未制作其他状态，未接入运行时，未执行正式资源构建。
