# 用户确认版：Pak 43/41，双轮开脚炮架

2026-10-28 用户确认采用候选 B，并明确要求：游戏中的两条长支腿处于展开射击状态，不使用移动收纳姿态。

## 几何参考

- `reference-pak43-41-comparison.jpg`：[用户确认的 B 型多视图](https://www.the-blueprints.com/blueprints/weapons/weapons/88372/view/88cm_pak_43/)。文件名保留早期比较用名，内容现为正式原型依据。
- `reference-pak4341-top-travel.png`：B 型顶部投影的放大裁切；其炮身、炮盾、车轮和支腿长度为几何依据，支腿按用户要求向后张开。
- `reference-pak4341-deployed.jpg`：[博物馆实物照片](https://weaponsystems.net/system/1751-88mm%20Pak-43/41)，辅助辨认双轮和炮架的物理结构。
- [McKay Lodge 实物修复记录](https://mckaylodge.com/restoration-1943-german-88mm-pak-4341-anti-tank-gun-page-2/)说明长支腿展开的铰链与运输锁结构。

`reference-cruciform-plan.jpg`、`reference-top.png` 和 `reference-field-manual.png` 属于已否定的 A 型十字炮架，仅保留查考，不用于这一版制作。

## 制作与接入

内置 imagegen 依据用户确认的 B 型重新生成 `pak4341-deployed-generated.png`：严格正俯视，炮口向左，两只车轮在横向车轴两端，两条长支腿向右张开成 V 形，两末端保留宽驻锄，中间留透明空间。采用 Pak 38 的简化灰绿色、粗线条画风。成功生成的完整提示词保存于 `prompts.json`。

击毁图的 imagegen 编辑请求被工具安全系统拒绝，依据用户此前明确同意的本地处理授权，由 `tools/preparePak43Art.cjs` 制作断炮、炮盾破口与局部焦黑。保留其余涂装亮度，不移动双轮或两条展开支腿，不独立紧裁残骸。

用户指出原击毁图损坏过轻后，断口移至靠近炮盾的位置，脱落炮管和制退器分为两段落在原画布内；上下炮盾出现大面积撕裂与翻折，炮尾机构崩缺，中央炮架局部烧黑并保留少量外露机械块。损伤采用大形状，使约 115×46 的战场显示尺寸仍能辨认；轮组及展开支腿沿用正常状态的位置与尺度。`wreck-damage-comparison.png` 展示正常、原轻损版与加重后的击毁图。

用户随后指出炮管和支腿相对轮组偏长。当前生产稿先由 `tools/normalizePak43Geometry.cjs` 按 B 型三视图的像素取点校正，再统一导出；不再直接把生成稿缩小作为成品。共同尺度取轮胎外径：炮口至轮轴由约 `4.00D` 校正为 `3.70D`，支腿铰点至驻锄中心由约 `2.94–2.98D` 校正为 `2.35D`。缩短炮管的平直段，保留制退器与阶梯套筒；缩短支腿梁段，末端驻锄和把手保持原比例，V 形角度保留。轮组外径、轮距与胎宽同时对齐参考。取点和变换数据保存于 `geometry-calibration.json`。

校正工作稿画布为 1500×600，均匀缩放到 200×80。正常、击毁图共用画布和尺度，炮口坐标为 `(2.8, 38.266667)`；图中轮轴 `(108.8, 38.266667)` 对应游戏内的整炮转向中心，导出时同步更新视觉偏移。单图完整参与 Pak 38 同类整炮转向显示，不拆成十字底座和可全周旋转炮身。

轮距校正后曾出现轮子内侧与炮架之间的假空隙：原处理仅补了细连接线，且 SVG 局部贴片默认保留宽高比造成透明留白。现以生成源图中的完整轮轴、轴承座及支承结构补齐，局部贴片明确使用校正后的目标尺寸；两侧连接在正常和击毁贴图中都保持连续。`wheel-connection-comparison.png` 为修复前后的小尺寸像素放大对照。

用户进一步指出轮组仍显得离炮身过远，因此将两侧轮组与外侧支座一起内收，并收回此前为补缝延长的部分。每侧内收 12 个工作稿像素（200 像素贴图约 1.6 像素）；原始线稿测量值保留在 `reference`，当前美术排布单列于 `wheelLayout`，避免将视觉调整混写为原图尺寸。炮管、支腿、轮胎外径和整炮尺度不变；正常与击毁图同步。`wheel-placement-comparison.png` 展示等轮径的参考、上一版与内收版。

- `pak4341-proportions-corrected.png`：1500×600，按三视图比例校正的正常图。
- `geometry-calibration.json`：原图与三视图的轮轴、炮口、轮胎、支腿取点及校正参数。
- `proportion-comparison.png`：统一轮胎外径后的参考图、旧稿、新稿对照；参考图收拢支腿，新稿保持展开。
- `pak4341-deployed-finished.png`：2000×800 正常状态工作稿。
- `pak4341-destroyed-finished.png`：同画布同尺度击毁工作稿。
- `preview.png`：正常与击毁的 3 倍最近邻放大、原贴图和标准 64 像素格半径下约 115 像素宽的显示对照。
- `rotation-preview.png`：整炮旋转时双轮、展开支腿和炮身的方向检查。
- `rejected-cruciform-v1/`：用户否定的十字炮架旧稿、旧脚本与旧分层资源，不再用于游戏。
- `rejected-proportions-v2/`：比例偏长的 B 型旧稿与处理脚本快照，不再用于游戏。

```powershell
node tools/preparePak43Art.cjs
pnpm run tank:build
node --test tests/Pak43.test.js
pnpm run tank:validate
```

游戏文件：`assets/resources/textures/units/pak43_top.png` 和 `pak43_top_destroyed.png`，包含匹配尺寸的 Cocos `.meta`。单位 ID 仍为 `pak43`，显示名为 Pak 43/41 反坦克炮。

已进行离线小尺寸及姿态检查；尚未进行 Cocos 实机目视验收。
