# 新版地形安装前备份

包含旧版地形目录（PNG 与 Cocos `.meta`）、目录资源标识、`BattleScene.ts` 及其 `.meta`，共 308 个原文件。

代码副本使用 `.backup` 后缀，避免被 TypeScript 或 Cocos 当作项目脚本编译。每个备份的 SHA-256、原路径及新版新增文件列于 `manifest.json`。备份包括安装前工作区的现有修改，没有使用 Git 历史替代本地版本。

在项目根目录校验备份：

```powershell
node tools/restoreTerrainV3.cjs
```

需要恢复时运行（会覆盖当前地形美术与 BattleScene，保留备份）：

```powershell
node tools/restoreTerrainV3.cjs --apply
```

恢复工具只处理清单中的资源和两份新增渲染模块；不会回滚单位美术、关卡数据或其他游戏规则代码。
