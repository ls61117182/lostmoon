# 体验版构建

统一配置位于 `assets/scripts/core/BuildProfile.ts`。日常开发使用 `BUILD_PROFILE = 'development'`，打体验包前切换为 `'demo'`。

- `demo`：隐藏坦克图片调试、切换坦克、整个测试章节、经典/硬核切换和战役跳关；单人任务固定谢尔曼，模式固定硬核。
- `development`：恢复上述入口和原有选择行为。

配置同时作用于编辑器预览和构建产物，与 Cocos 构建面板的 Debug 选项独立。切换后重新预览；发包前重新构建并编译，已有 exe 不会自动更新。Windows 构建继续关闭 Debug 和 Source Maps，建议使用独立输出目录 `windows-demo`。

体验版菜单进度、战斗存档使用带 `:demo` 的独立键，不读取或覆盖开发版进度和对局。首次进入体验版没有开发版的“继续游戏”，体验版自己的保存和继续游戏仍可使用。旧设置即使进入体验版菜单数据，也会归一为谢尔曼、硬核和有效章节。

本次保持其他章节、关卡解锁、关卡编辑器及 PVP 规则不变。PVP 仍按阵营规则使用车辆；固定谢尔曼适用于原主菜单切换坦克所控制的单人任务。测试资源仍保留在项目中，入口屏蔽不等于从安装包移除资源。

验证命令：

```text
npm run typecheck
node --test tests/BuildProfile.test.js tests/RandomMissionMenu.test.js tests/BattleSceneCampaignDebugSkip.test.js
```

打包后检查：主菜单五处指定内容已屏蔽（其中跳关在战役内）；普通关卡和战役以谢尔曼、硬核启动；保存、退出、继续游戏正常；切回 development 后原开发存档和入口恢复。
