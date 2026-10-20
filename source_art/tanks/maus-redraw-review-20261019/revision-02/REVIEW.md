# 鼠式第二版候选（等待确认）

> 最新油桶形状及位置修正版见 [../revision-03/REVIEW.md](../revision-03/REVIEW.md)。

本版处理三项反馈：主炮轴线移至炮塔左右正中；击毁图直接从车身层制作，炮塔及双炮完全消失；车尾增加横置外挂大油桶。

## 输出

- `maus_top_candidate.png`：正常合成图。
- `maus_top_hull_candidate.png`：带车尾油桶的车身层。
- `maus_top_turret_candidate.png`：主炮居中的炮塔及双炮层。
- `maus_top_destroyed_candidate.png`：仅车身残骸，保留油桶。
- `review-preview-1x.png`：正常、独立车身、击毁车身原尺寸对照。
- `review-preview-2x.png`：最近邻两倍预览，背景色不是正式透明贴图的一部分。

四张最终候选均为 **112 × 300 像素 RGBA PNG**。原始生成稿保持高分辨率，便于后续修改。

## 本次补充参考

- 含油桶俯视、侧视、后视的四视图：https://maquettes-missiles.blogspot.com/2018/04/le-char-super-lourd-maus.html
  - 本地 `reference-drum-four-view.jpg`，俯视裁切旋转 `reference-drum-top-front-up.png`。
- 车尾外挂油桶后方结构参考（3D 渲染，非实车照片）：https://3dmodels.org/360-view/?id=165472
  - 本地 `reference-rear-drum-render.jpg`。

仅用参考图校准结构和比例，没有使用项目旧鼠式美术。

## 检查

- 四张贴图尺寸、RGBA 和真实透明通道检查通过。
- 主炮与炮塔中线在最终尺寸中的测量误差约 0.30 像素；已目视核对。
- 正常图与最终车身／炮塔层的 alpha 合成逐像素完全一致。
- 击毁图由 `hull-with-drum-generated.png` 直接编辑。保持同一源画布及同一摆放坐标，无单独紧裁放大；未包含炮塔或火炮。
- 正常及击毁的完整车身前后沿偏差至多 1 个源像素，缩小后低于 0.2 像素。
- 已检查原尺寸和两倍预览，尚未接入或进行游戏内目视验收。

`build_preview.py` 可重复构建候选及预览，`candidate-manifest.json` 保存比例和偏移。

由内置 **image_gen** 生成和编辑。完整提示词见 [PROMPTS.md](PROMPTS.md)。

本版独立保存在 `revision-02`，第一版保留用于对照；尚未替换 `assets` 正式资源或修改运行时配置，等待用户确认后接入。
