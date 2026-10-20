# 鼠式坦克重绘候选（待用户确认）

> 本文件记录第一版。最新游戏反馈修复见 [revision-05/REVIEW.md](revision-05/REVIEW.md)：直接从正常车身派生局部毁坏、破损区外细节逐像素一致，并统一炮塔灰色；保留已确认的主炮、座圈和油桶位置。

本目录独立存放候选稿。未经用户确认，不复制到 assets，不修改资源配置或 Cocos 元数据。

## 外部几何参考

- https://drawingdatabase.com/panzer-viii-maus/
  - 原始图片：https://drawingdatabase.com/wp-content/uploads/2015/01/e-100-maus.gif
  - 本地：reference-orthographic.gif
- https://www.nevingtonwarmuseum.com/maus-prototype-v2.html
  - 原始图片：https://www.nevingtonwarmuseum.com/uploads/9/1/7/5/9175276/nevington-maus-v2-10.jpg
  - 本地：reference-maus-v2.jpg

参考图仅用于几何研究，不能作为原创游戏资源分发。reference-top-front-up.png 为第一份三视图的俯视裁切及旋转。

## 绘制约束

- 未查看或参考项目旧鼠式图片。
- 车头向上，严格正俯视，灰色涂装、简化细节、粗深色结构线。
- 依第一份三视图采用不带外挂油桶的配置；炮塔后置，发动机格栅在其前方。
- 正常图由同一比例的车身和炮塔确定性合成。
- 最终候选 PNG 最长边不超过 300 像素，透明背景。
- 内置 image_gen 生成，原始生成稿单独保留。

## 确认后再做

替换正式资源，更新支点、炮口和舱口坐标、CSV、meta，执行项目资源验收并在游戏中目视检查。

## 本次候选输出与检查

- `maus_top_hull_candidate.png`：车身层。
- `maus_top_turret_candidate.png`：炮塔及双炮层，与车身共享对齐画布。
- `maus_top_candidate.png`：上述两层逐像素 alpha 合成的正常图。
- `maus_top_destroyed_candidate.png`：击毁图，按完好车身前后沿做等比缩放及偏移校准。
- 四张候选均为 112 × 300 像素 RGBA PNG，透明通道包含 0 和 255。
- `review-preview-1x.png`：原尺寸正常／击毁对照；`review-preview-2x.png`：最近邻两倍预览。预览底色不属于透明贴图。
- 已目视检查原尺寸及两倍预览：双炮、炮塔、格栅和大面积破口均可辨认。
- `candidate-manifest.json` 记录合成比例和偏移；`build_preview.py` 可重复构建并检查尺寸、透明及正常图合成一致性。
- 未执行正式接入、资源配置重建或游戏内目视验收，等待用户确认。

## 生成提示词记录

使用内置 image_gen；核心要求为“严格正俯视、灰色涂装、简化细节、加粗轮廓、根据外部三视图保留后置炮塔和前部格栅、主炮位于画面左侧且副炮短而细、真实透明背景”。

实际提示词保存在 `prompt-hull.txt`、`prompt-turret.txt` 和三个 `prompt-turret-*-correction.txt` 文件中；击毁编辑提示词在 `prompt-destroyed.txt`。原始生成图用于追溯，最终候选另以 `_candidate.png` 标识。
