# 加载地图界面：谢尔曼侧视图

- 几何参考：用户提供的 M4A3(75)W Late Model 三视图，以侧视图为准，朝右以配合进度条移动。
- 生成方式：内置 image_gen，真实透明背景。完整提示词见 prompt.txt。
- generated.png：原始生成稿，保留完整 alpha。
- 游戏资源：assets/resources/textures/ui/loading_sherman_side.png，448 × 211，线性过滤。
- 显示尺寸：112 × 52.75 UI 单位；preview-actual-size.png 为深色底预览，preview-4x.png 为最近邻放大检查。
- BattleScene 在 onLoad 提前加载 SpriteFrame；资源加载后替换旧 Graphics 剪影，沿用进度条移动逻辑。加载未完成或失败时保留剪影。
- 验证：透明通道覆盖 0–255、PNG/Meta 尺寸匹配、TypeScript 检查通过。未进行 Cocos 游戏内目视验收。
- 本资源仅用于 UI，不加入战场 TankVisualDB，也不更改俯视图及其配置。
