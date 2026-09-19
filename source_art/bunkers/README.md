# 重炮碉堡炮管拆分

德军与日军重炮均可沿固定堡体正前方及左右一个 30° 步进方向观察和攻击，观察距离仍为四格。堡体禁止移动或旋转；炮管转速为每秒 60°。当前炮管方向有合法目标时直接攻击，否则选择转角最小的合法目标。旋转独占一次有效攻击骰子（硬核模式为本回合的单次有效攻击行动），完成后不能同时射击；下一次攻击行动再重新选敌。同转角时沿用目标优先级、距离排序。射界、夹角射线的侧翼格、遮挡和转向步进均复用坦克炮塔规则，不使用独立的连续角度扇形判定；与坦克一致，绘制时炮管与炮口特效对准实际目标格心。

资源保留原有 100×70 画布、堡体外观和战场显示大小。使用内置 imagegen 补绘炮管遮挡的射击孔，再以 `tools/prepareBunkerArt.cjs` 从原图分离炮管、仅在修补区域应用生成结果、确定性合成完整图。未采用 CLI/API 生成。

正式资源位于 `assets/resources/textures/units/`：

- `german_coastal_bunker_top_hull.png` / `german_coastal_bunker_top_turret.png`
- `heavy_artillery_top_hull.png` / `heavy_artillery_top_turret.png`

同目录各自的 `*_top.png` 为分层合成图，原始完整图保存在本目录的 `*-original.png`。旋转支点分别为德军 (37,33)、日军 (44,35)。`traverse-preview.png` 按实际贴图尺寸展示 -30° / 0° / +30°；`traverse-preview-large.png` 为最近邻放大版本。未进行 Cocos 运行中的实机目视验收。

## 生成提示词

German:

> Edit target: provided top-down game bunker sprite. Produce ONLY the stationary bunker body layer with cannon removed. Preserve exact silhouette, proportions, orientation (firing opening facing LEFT), brown earth berm, grey concrete roof, small black roof vent, and original composition. Remove the long thin gun barrel and its small rounded gun base from the left opening. In that area restore the dark empty firing embrasure, with transparent space outside bunker. Do not redesign, add detail, rotate, or move the bunker. Same composition and aspect ratio as reference, 1000x670. Transparent RGBA background, no checkerboard. This is a small strategy game sprite, clear simple shapes. Only one body asset.

Japanese:

> Edit target: this 100x67 top-down Japanese bunker game sprite. Make ONLY its stationary body layer: erase the gun barrel sticking out toward LEFT and the small movable gun within the rectangular embrasure. Leave the rectangular stationary dark gun opening empty and dark. Preserve all other pixels/layout/proportions, round grey concrete bunker, brown berm, small vent to right, exact original orientation and canvas framing. Do not redesign or add details. True transparent RGBA background. Same 100:67 canvas aspect ratio. Output just single body sprite.

生成稿统一映射回原始 100×70 画布，仅取射击孔局部修补；提示词中的 67 高度不用于正式资源或支点配置。
