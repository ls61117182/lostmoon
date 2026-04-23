# 主菜单接入说明

本文件记录 `MainMenuScene` 如何接入到 Cocos 项目。脚本/资源都已经写好，剩下的只是在 Cocos Creator 编辑器里做两步"拖鼠标"操作。

---

## 1. 在 `main.scene` 给 Canvas 下挂脚本

`assets/main.scene` 已有一个空的 `Canvas`。需要：

1. 在 Cocos Creator 里打开 `assets/main.scene`。
2. 选中 `Canvas` 节点，右键 → 创建 → 创建空节点，起名 `menu`。
   - 坐标保持默认 `(0, 0, 0)`（`MainMenuScene` 内部所有 UI 都以 `menu` 节点为原点，按 1280×720 画布布局）。
3. 选中新建的 `menu` 节点，在 *属性检查器* 右下 "添加组件" → 选择
   `assets/scripts/view/MainMenuScene.ts` （或在搜索框输入 "MainMenuScene"）。
4. 组件面板里会出现一个属性：
   - **Battle Scene Name** —— 点击关卡按钮后要加载的战斗场景名。默认值
     `changjing2`（当前仓库中挂着 `BattleScene` 的那张场景）。
     如果你之后把战斗场景改名或新建了一张场景，就把这里改成对应的场景名。
5. 保存场景 (Ctrl + S)。

> 如果不想每个关卡都跑同一张战斗场景，也可以把 `battleSceneName` 做成
> 按 `LevelMeta` 分场景 —— 但当前 12 关共用一张战斗场景已经足够（关卡差
> 异由 JSON 数据表达）。

---

## 2. 把 `main.scene` 设为项目启动场景

1. 菜单栏 → 项目 → 项目设置 → *通用设置*（或 `Project Settings`）。
2. 找到 "启动场景 / Start Scene" 字段，下拉选中 `main`。
3. 确保 `main`、`changjing2`（或你填的那张战斗场景）都在 *构建发布* 的
   "场景列表" 中（Build Settings → Scene List）。主菜单 → 战斗场景的切换
   通过 `director.loadScene(name)`，未登记的场景会加载失败。

---

## 3. 战斗场景的"返回主菜单"按钮

`BattleScene` 已同步改造：

- 任务胜利 / 失败时弹出的覆盖层新增 **返回主菜单** 按钮。
- `BattleScene` 上新增属性 **Main Menu Scene Name**，默认 `main`。
  如果你把主菜单场景改名，把这里同步改掉即可。

---

## 4. 数据流回顾（方便你日后排查）

```
MainMenuScene                GameSession (纯静态)          BattleScene
────────────────────────     ─────────────────────────     ───────────────────────────
点击关卡 →
  selectMission(id, path) ─▶ selectedMissionPath
                              selectedLevelId
  director.loadScene('changjing2')                      ─▶ onLoad()
                                                             ◀── selectedMissionPath
                                                            resources.load(missionPath)
                                                            loadAndDraw(data)

点击继续游戏 →
  resumeMission(id, path)  ─▶ selectedMissionPath
                              selectedLevelId
                              resumeFromSave = true
  director.loadScene(...)                               ─▶ onLoad()
                                                            loadAndDraw(data)
                                                            resumeFromSave ? onLoad_Save()
                                                            GameSession.clearResumeFlag()
```

通关时战斗场景会调用 `MenuProgress.markCompleted(GameSession.selectedLevelId)`，
下次回主菜单该关会显示 ★ 并解锁下一关。

---

## 5. 本地持久化键名（调试 / 清档用）

| 用途                | localStorage key              | 读写位置                      |
| ------------------- | ----------------------------- | ----------------------------- |
| 战斗场景单局存档    | `lone_sherman_save_v1`        | `SaveLoad.ts`                 |
| 主菜单进度+设置     | `lone_sherman_menu_v1`        | `LevelDB.MenuProgress.*`      |

DevTools Console 手动清档：

```js
localStorage.removeItem('lone_sherman_save_v1');   // 清战斗存档
localStorage.removeItem('lone_sherman_menu_v1');   // 清菜单进度（重回只开第 1 关）
```

或在代码里：

```ts
import { MenuProgress } from './core/LevelDB';
MenuProgress.reset();
```

---

## 6. 文件改动清单

新增：

- `assets/scripts/core/GameSession.ts` —— 跨场景会话状态（选关 / 是否读档）
- `assets/scripts/core/LevelDB.ts` —— 12 关卡元数据 + localStorage 进度
- `assets/scripts/view/MainMenuScene.ts` —— 主菜单场景脚本

修改：

- `assets/scripts/view/BattleScene.ts` —— 启动时读 `GameSession`、通关回写进度、
  胜负覆盖层新增"返回主菜单"按钮、新增 `mainMenuSceneName` 属性
- `data/lang.csv` —— 新增 `menu.*` / `level.XX.title` / `btn.backToMenu` 等文案
- `assets/scripts/core/LangDB.ts` —— 由 `tools/buildLangDB.js` 自动重生成
