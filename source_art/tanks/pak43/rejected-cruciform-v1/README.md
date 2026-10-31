# Pak 43：十字炮架型

## 素材依据

- `reference-cruciform-plan.jpg`：[Pak 43 多视图](https://www.the-blueprints.com/blueprints/weapons/weapons/88373/view/88cm_pak43/)，底部为几何权威俯视图。
- `reference-top.png`：上述俯视部分裁切并旋转为炮口向左，用于比对比例和结构。
- `reference-field-manual.png`：[Merkblatt 47b/51 展开射击状态](https://commons.wikimedia.org/wiki/File:Merkblatt_47b-51,_8,8_cm_Pak_43_auf_Kreuzlafette_in_Feuerstellung.png)。
- `reference-pak43-41-comparison.jpg`：搜索结果中容易混淆的 [Pak 43/41 双轮开脚炮架图](https://www.the-blueprints.com/blueprints/weapons/weapons/88372/view/88cm_pak_43/)，仅用于型号辨别，没有用于成品几何。
- [1945 年美军情报资料](https://lonesentry.com/new88mm/index.html)核实十字炮架、全周回转、长 88 毫米炮与薄炮盾。资料中的历史尺寸/性能不直接等于游戏分档。

外部图片用于结构参考；运行时贴图使用重新绘制的游戏图，不直接缩小外部图片作为成品。

## 制作记录

2026-10-28 使用内置 imagegen 生成 `gun-draft-generated.png`，以 Pak 38 游戏贴图为颜色和线条参考。后续分层请求被图片工具的安全系统拒绝；用户明确同意改用本地绘图处理完成。`tools/preparePak43Art.cjs` 保留生成稿的炮管、炮盾与紧凑炮尾，剔除被误画进旋转层的纵向地面炮架，依据俯视图补绘固定十字炮架，并制作局部断炮、撕裂炮盾和少量焦黑的击毁状态。未整体变褐或整体压暗。

成功生成稿的提示词：

> Use case: stylized-concept. Asset type: transparent 2D strategy-game sprite layer. Draw ONLY the rotating upper gun assembly of a German 8.8 cm Pak 43 L/71 anti-tank gun, from a perfectly orthographic 90 degree TOP VIEW, barrel pointing horizontally LEFT. Image 1 is the authoritative top-view geometry: accurately trace its proportions and major asymmetric layout, but REMOVE the entire cruciform ground carriage and all four stabilizing arms, ground feet and jacks; these are a separate layer. Keep the long slim stepped barrel, small dual-baffle muzzle brake at the far left, rectangular recoil cradle, broad shallow angled gun shield (the shield seen from ABOVE is a narrow front-to-back plate footprint, NOT a tall vertical front-view facade), exposed breech and rear controls. Preserve the plan drawing's shield outline and asymmetry. No wheels in firing position. Image 2 supplies only the simplified gray-green painted-metal game-art style: thick dark clear outlines, a few flat high-contrast gray-green highlights, simplified structural seams, no fine rivet noise. No crew, text, symbols, ground, cast shadow, smoke, debris, perspective, or isometric rendering. Use a wide landscape canvas and maximize the full gun while keeping a small transparent margin on all sides. Genuine transparent background.

## 重建

```powershell
node tools/preparePak43Art.cjs
pnpm run tank:build
node --test tests/Pak43.test.js
pnpm run tank:validate
```

- `base-finished.png`、`gun-finished.png`：以同一 2000×1330 画布保存的分层源稿。
- `top-finished.png`、`destroyed-finished.png`：正常、击毁高分辨率源稿。
- 游戏资源：`assets/resources/textures/units/pak43_top*.png`，共用 200×133 透明画布、同一源像素尺度。
- 固定炮架和旋转炮身共用支点 `(133, 66.5)`；炮口 `(4, 66.5)`。两层图都保留全画布，不独立紧裁或拉伸。
- 游戏完整图由最终分辨率两层直接合成，保证与战场分层显示一致。
- `preview.png`：3 倍最近邻放大、原贴图以及标准 64 像素格半径下的显示尺寸对照。
- `rotation-preview.png`：12 个炮身方向、固定底座与转轴的目视检查。

自动检查不代替 Cocos 运行中的目视验收和长期平衡试玩。
