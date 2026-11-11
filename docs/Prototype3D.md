# Cocos 3D 样板关卡

在 Cocos Creator 3.8.8 打开项目，从主菜单进入 **测试工具 → 3D 样板战场**；也可以直接打开 `assets/prototype3d.scene`，将编辑器的预览场景设为当前场景后运行。

这是独立的低多边形表现样板，使用真实 3D 网格、透视镜头、方向光与实时阴影。包含 37 个六角格、通向高地的连续坡面、树林、村屋，以及可独立转动炮塔的谢尔曼与四号坦克。模型由代码生成；不是最终美术资产。

## 操作

| 操作 | 方法 |
| --- | --- |
| 移动 | 点击绿色边框的可达格，每回合累计最多 3 格 |
| 射击 | 点击四号坦克所在格或“主炮射击”；快捷键 F |
| 敌方行动 / 装填 | 点击“结束回合”；快捷键空格 |
| 旋转镜头 | 在战场拖动；也可用 Q / E 或右侧旋转按钮 |
| 缩放 | 鼠标滚轮、双指捏合或右侧 ＋ / － |
| 调整俯角 | 上下拖动战场，或点击右侧斜视按钮 |
| 恢复镜头 | 右侧 ⌂ 按钮 |
| 重开 / 退出 | “重新演练” / “返回菜单” |

样板采用确定性的简化战斗：谢尔曼 3 点耐久，四号坦克 2 点耐久；每回合主炮最多射击一次，射程 5 格，每发命中扣 1 点耐久。树林和建筑不可进入，并遮挡中间格射线。四号坦克保持位置，在有射界且射程足够时于回合结束还击。

两次命中即可完成演练；结束后仍可观察场景。样板不读写任务、战役、账号或战斗存档，也不接入原版骰子、装甲面、乘员、战争迷雾和完整 AI。高差在本版用于展示地形与运动，不增加原版高地命中修正。

## 实现入口

- `assets/scripts/core/Prototype3DScenario.ts`：复用现有六角格坐标的样板状态、可达路径和简化射击规则。
- `assets/scripts/view/Prototype3DScene.ts`：场景、坦克、镜头、输入、动画与 UI。
- `assets/scripts/view/Prototype3DGeometry.ts`：按材质合并静态网格，减少逐零件绘制。
- `assets/prototype3d-standard.mtl`：显式引用内置标准着色器，保证预览和构建依赖完整。
- `settings/v2/packages/engine.json`：启用 3D 和基础几何体模块；无需 3D 物理模块。

构建设置已登记 `prototype3d.scene`。如果使用以前保存的独立构建配置，也需确认其场景列表包含这张场景。

## 验证

```powershell
npm run typecheck
node --test tests/Prototype3DScenario.test.js tests/LangKeys.test.js tests/buildLangColumnOrder.test.js
```

可选的本地预览诊断工具：保持 Cocos 编辑器运行，执行 `node tools/prototype3dQaServer.cjs`，在浏览器打开终端打印的地址。它只监听本机回环地址，代理 Cocos 的 7456 预览服务，向 `outputs/prototype3d/` 写入运行状态和实际游戏画布 PNG。默认只采集诊断；在地址后追加 `&smoke=1` 可运行引擎内自检，验证投影选格、移动动画、开火限制、敌方还击、获胜和重开，并输出 `smoke.json`。这些工具不包含在游戏构建中，不改存档；关闭终端进程即可停止。

本次关联检查中，已有 `BuildProfile.test.js` 的 `debugSkipCampaignSegment` 防护断言，以及 `MenuCampaignFlow.test.js` 的随机任务数量断言（期望 6、实际 7）失败。这两项涉及的 `BattleScene`、`BuildProfile`、`LevelDB` 和 `CampaignDB` 本次均未修改。

最终画质与移动端帧率仍需在目标手机上验收。
