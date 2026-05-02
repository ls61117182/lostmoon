将下列文件放入本目录并在 Cocos 中刷新资源数据库（文件名可自定，但须与 GameAudio.ts 内 AudioKeys 一致）：

- bgm_menu.(ogg|mp3)     — 主菜单 BGM，循环
- bgm_battle.(ogg|mp3)   — 战斗 BGM，循环
- ui_click.(ogg|mp3)     — 按钮等短音效
- dice_roll.(ogg|mp3)    — 掷骰动画
- tank_move.(ogg|mp3)    — 坦克前进 / 后退 / 转向共用；动画期间循环，动作结束由代码停止
- cannon_fire.(ogg|mp3)  — 主炮开火（命中/未命中均在掷骰揭示时播放；相对普通 SFX 显著放大）
- cannon_reload.(ogg|mp3) — 主炮装填完成（相对普通 SFX 约 2.5 倍）
- mg_fire.(ogg|mp3)      — 机枪（命中/未命中均在掷骰揭示时播放）

代码中路径为 resources 根下：`audio/bgm_menu`（无扩展名）。若文件不存在，控制台会 warn 一次，游戏照常运行。
