# 谢尔曼三型：仅车身击毁图 · 第十六轮

用户纠正击毁机制：炮塔会被击飞，所以击毁图片仅在正常车身图上增加破损，不包含炮塔、炮管或飞离的炮塔残骸。第十五轮带炮塔整车击毁图不作为交付候选。

## 交付与预览

三张均为800×1400真实透明PNG，圈内黑色不透明。仍为待确认候选，未替换游戏资源，未修改正常车身或炮塔。

| 车型 | 车身击毁PNG | 原车身外廓位置与尺寸 |
| --- | --- | --- |
| M4A1 | [m4a1_hull_destroyed.png](candidates/m4a1_hull_destroyed.png) | (217,340)，367×800 |
| M4A1(76)W HVSS | [m4a1_76_hvss_hull_destroyed.png](candidates/m4a1_76_hvss_hull_destroyed.png) | (217,341)，367×799 |
| M4A3E2 Jumbo | [m4a3e2_hull_destroyed.png](candidates/m4a3e2_hull_destroyed.png) | (192,340)，416×800 |

- [三型击毁车身预览](destroyed-hulls-review.png)
- [正常车身 / 击毁车身对照](normal-destroyed-hulls-review.png)
- [地图尺寸及最近邻3倍对照](map-size-review.png)
- [像素审计结果](review-audit.json)

## 来源和方法

普通及76型使用第十轮正常车身，巨无霸使用第十四轮弧形肩部正常车身。完整冻结参考与车身紧裁编辑目标存于`references/`，来源和边界见`reference-layout.json`。不使用上一轮带炮塔击毁图作为输入。

使用内置 **image_gen 编辑模式**，逐型生成真实透明的车身破损图。原始结果完整保存在`generated/*_destroyed-hull-v1.png`。完整提示词分别保存在：

- [M4A1提示词](prompts/m4a1_destroyed-hull.txt)
- [M4A1(76)提示词](prompts/m4a1_76_hvss_destroyed-hull.txt)
- [M4A3E2提示词](prompts/m4a3e2_destroyed-hull.txt)

生成后按正常车身长度整体等比配准，仅将车首、发动机盖/格栅、后部履带的局部生成损伤合入正常车身。没有另行绘制程序损伤。合入区域外围平滑过渡，座圈半径125像素内全部保留原图，不整体染褐或压暗，不重画外廓或变更比例。原始生成结果与技术配准结果都保留以便复核；最终候选以`candidates/`为准。

## 检查结果

- 三张最终画布均800×1400，透明像素及完整Alpha存在。
- 三型原始车身来源与冻结参考SHA256一致，正常稿未改。
- 最终车身Alpha逐像素沿用正常图，边界、位置及尺寸不变；没有飞散残片。
- 统一座圈仍使用正常稿的中心(400,720)、236×236配件。三型座圈及其周围半径125内与各自正常图的像素差异为0；半径98内30149个采样像素全部为不透明纯黑。
- 已目视检查高清图、正常/击毁对照、76/78像素名义车身长及最近邻3倍图：无炮塔或炮管，破损仍可辨认，巨无霸弧形肩部保持。
- 未执行游戏接入、数据库构建或Cocos实机验收；本轮仅制作美术候选。

可用`node source_art/tanks/sherman-destroyed-hulls-20261114-v16/build-review.cjs`重建候选、预览及审计。
