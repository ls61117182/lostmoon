# 鼠式第三版候选：按用户图片修正油桶

> 最新游戏反馈修复已接入，见 [../revision-04/REVIEW.md](../revision-04/REVIEW.md)：击毁轮廓与正常车身逐像素一致，座圈后移并同步两边转轴。

> 用户已于 2026-10-19 授权“替换到游戏里我看看”，本版现已接入正式资源，等待游戏内观感反馈。

本版只针对用户补充指出的油桶位置和形状继续修正。原第二版主炮居中的炮塔 PNG 原样复用；击毁图仍仅保留车身，不包含炮塔及火炮。

## 最终 PNG 对齐复核

用户指出生成过程里展示的正常及击毁中间稿位置不一致。该反馈属实：两张生成稿未经共同画布校准，不应混入最终验收预览。

现重新从本目录最终 `_candidate.png` 直接生成 [verified-final-alignment.png](verified-final-alignment.png)，两侧使用完全相同的裁切坐标和放大倍数。也提供 [verified-final-toggle.gif](verified-final-toggle.gif) 在同一位置切换两种状态。

`verify_alignment_preview.py` 对最终 PNG 进行复核：车尾左右六个采样列在正常与击毁图中都止于 y=268（零基坐标）；共同油桶层轮廓为 `(31,256)-(81,283)`；车身之外的油桶区域最大通道差仅 1/255，属于合成及缩放边缘差异，无位置变化。结果记录于 `alignment-verification.json`。

本次重新生成验收预览并补充校验，最终候选 PNG 延用已分层统一的第三版，未替换正式资源。

## 几何依据

- `user-reference.png` 为用户提供的四视图。
- `user-reference-top-front-up.png` 为其中俯视部分的裁切及旋转，车头朝上。
- `user-reference-rear-detail.png` 为车尾放大参考。
- 油桶采用短粗的横向圆筒、浅圆弧端部、连续环形加强筋和小注油口。独立生成层实际长宽比约 1.85，装配宽度约为车身的 52%。
- 独立油桶层的横向中轴放在车尾边界上，约 **50.29%** 的前后投影位于车身内侧，其余位于外侧。
- 正常及击毁车身使用同一油桶层、同一缩放和同一坐标，不再分别凭生成结果确定位置。

## 文件

- `maus_top_candidate.png`：正常合成图。
- `maus_top_hull_candidate.png`：带内移油桶的正常车身。
- `maus_top_turret_candidate.png`：原样复用第二版主炮居中的炮塔。
- `maus_top_destroyed_candidate.png`：带内移油桶的无炮塔击毁车身。
- `maus_rear_fuel_drum_candidate.png`：共同画布上的独立油桶层，供后续修改使用。
- `review-preview-1x.png` / `review-preview-2x.png`：原尺寸／两倍完整对照。
- `rear-detail-check.png`：车尾局部验收，金线仅表示车尾边界，正式 PNG 不含线。

以上五张候选资源均为 **112 × 300 像素 RGBA 透明 PNG**。原始生成稿另外保留高分辨率。

## 检查与接入状态

- 尺寸、RGBA、真实透明通道检查通过。
- 炮塔与第二版文件逐字节一致，保持已修正的主炮中线。
- 油桶在两种状态中的位置和大小相同，车内外比例由统一坐标确定。
- 沿用第二版共同画布、输出缩放和偏移；油桶内移后没有紧裁放大车身。
- 击毁源按完好车身前后沿做单一等比缩放和位移校准。
- 已检查原尺寸完整预览及车尾局部，尚未进行游戏内目视验收。

`build_preview.py` 可重复构建，`candidate-manifest.json` 保存缩放、偏移和油桶投影比例。

图像源及分层由内置 **image_gen** 生成，确定性合成与尺寸检查使用 Pillow。实际提示词见 [PROMPTS.md](PROMPTS.md)。

## 正式接入

- `assets/resources/textures/units/maus_top*.png` 已替换，并同步鼠式后期迷彩版本。
- 运行时车头向左，因此对确认稿做精确 90 度旋转。车身和残骸共用并集裁切，保留损伤侧裙；没有分别拉伸。
- 正式尺寸：完整图 298 × 99，车身／残骸 258 × 99，炮塔 240 × 83，均在 300 像素以内。
- 更新 `data/tank_visuals.csv`、生成的 `TankVisualDB.ts` 和原 UUID 的 Cocos 元数据；转轴、炮口、车长舱口均已同步。
- `pnpm run tank:validate` 已完整通过，包括资源审计、17 项回归测试和 TypeScript 检查。
- 正式车身和残骸逐像素等于确认稿的同一旋转／裁切，完整图与正式两层合成逐像素一致；原资源 UUID 保留。
- `installed-runtime-size-preview.png` 按游戏显示比例合成，仅供离线检查，不是游戏截图。尚未在运行中的 Cocos 游戏画面目视验收。
- 游戏查看入口：重新运行 Cocos 预览 → 测试功能 → 坦克图片调试 → 鼠式，可切换击毁状态和灰色／后期迷彩。
- 接入记录 `game-integration.json`，安装脚本 `install_game_assets.py`。原文件备份于 `asset_backups/latest/maus/20261019_054218_before_confirmed_redraw/`，备份 TypeScript 使用 `.ts.bak` 防止参与编译。
