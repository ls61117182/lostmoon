# 坦克俯视外观图（PNG）制作规范

本文档约定**六角格地图上俯视车体精灵**的美术资源格式、存放位置及与仓库内 **`tools/normalizeTankSprites.cjs`** 流水线对齐的要点。实现逻辑以脚本与 `BattleScene` 为准；若脚本参数变更，请同步更新本页。

---

## 1. 目的与适用范围

- **目的**：在 Cocos Creator 中以 `Sprite` 显示各车型俯视贴图；贴图须**透明底**、**无外圈灰/白边**，且多车**统一画布尺寸**，避免缩放不一致或白底矩形盖住地形。
- **适用**：`assets/resources/textures/units/` 下参与统一尺寸的车型俯视图（当前见下节「命名表」）。

---

## 2. 资源路径与命名

| 约定 | 说明 |
|------|------|
| 目录 | `assets/resources/textures/units/` |
| 文件名 | `{车型标识}_top.png`，全小写，与 `UnitKind` / 资源加载路径一致。 |
| 格式 | PNG，**带 Alpha 通道**；导出时背景应为透明，而非白色不透明底。 |

**当前脚本参与统一尺寸的文件名（基名，无扩展名）**与代码中动态加载路径对应关系：

| 基名 | 说明 | 运行时加载（子资源） |
|------|------|----------------------|
| `sherman_top` | 玩家谢尔曼 | `textures/units/sherman_top/spriteFrame` |
| `panzer4_top` | 四号坦克 | `textures/units/panzer4_top/spriteFrame` |
| `panzer3_top` | 三号坦克 | `textures/units/panzer3_top/spriteFrame` |
| `tiger_top` | 虎式坦克 | `textures/units/tiger_top/spriteFrame` |
| `truck_top` | 卡车 | `textures/units/truck_top/spriteFrame` |

新增车型时：除放入上述目录并按 `{kind}_top.png` 命名外，还须把基名加入 **`tools/normalizeTankSprites.cjs`** 中的 `SPRITE_BASES`，并在 **`BattleScene`** 中为对应 `UnitKind` 增加 `resources.load('textures/units/.../spriteFrame')` 与绘制分支（参见现有德军俯视池逻辑）。

---

## 3. 原画与导出建议（给美术）

1. **透视**：俯视（plan view），车体完整落在画幅内；炮管默认方向需与程序一致——资源中炮管**大致指向画面左侧（-X）**时，与当前 `applyTopDownTankSprite` 中 `+180°` 朝向对齐逻辑一致（若原画朝右，程序仍会按六角朝向旋转整图）。
2. **画布**：导出分辨率不限；流水线会裁边并统一画布。但**留白不宜过大**，以免裁切后有效车体过小。
3. **背景**：**必须透明**。若使用近白/浅灰底导出，须能接受脚本将边缘浅灰泛洪为透明（见第 4 节），但仍应避免车体上出现大面积与背景同亮度、低饱和的浅色块贴边，以免被误判为背景。
4. **车体边缘**：避免一圈**不透明近白描边**（易在引擎里形成「白框」）；轮廓用自然明暗即可。
5. **步兵**：当前无俯视 PNG 规范；步兵为矢量绘制，不在本文档范围。

---

## 4. 规范化流水线（`normalizeTankSprites.cjs`）

在仓库根目录执行：

```bash
npm install
npm run normalize-tanks
```

脚本会**原地覆盖** `SPRITE_BASES` 所列 PNG。流程概要：

1. **读入**：`sharp` 读 PNG，`ensureAlpha`。
2. **边界浅底泛洪清除**（`removeEdgeConnectedLightBackground`）  
   - 从图像**四边**向内泛洪；像素进入候选需满足：  
     `alpha > 40`，亮度 `L > 218`（ITU 加权），饱和度 `< 55`。  
   - 若泛洪区域超过全图 **92%** 或连通区平均亮度 **< 232**，则**放弃**本次清除（防止误删大块浅地色）。  
   - 否则将标记像素**完全透明**。
3. **近白漂白**（`bleachNearWhite`）  
   - `alpha ≥ 32` 且 `R,G,B ≥ 228` 且 `alpha > 180` 的像素 → 透明。
4. **内容包围盒**（`bboxContent`）  
   - 非背景像素：`alpha < 24` **或** `R,G,B ≥ 252` 且 `alpha > 230`（纯白近透明底）。  
   - 取最小外接矩形裁切；失败时退回 `trim({ threshold: 12 })`。
5. **统一画布**  
   - 对所有已处理图取 `max(宽)`、`max(高)` 作为统一 `W×H`；若长边 **&lt; 400**，则按 **`MIN_LONG_EDGE = 400`** 等比放大整组 `W、H`。  
   - 每张图 **`resize(W, H, { fit: 'contain', position: 'centre', background: 透明 })`**，车体居中，不足区域透明。

**注意**：统一尺寸会随「当前参与列表里最大那一辆车」变化；新图若明显更高或更宽，全组输出分辨率会一起变高，属预期行为。

---

## 5. 入库与 Cocos 操作

1. 将**原始**或已手修 PNG 放到 `units/` 下正确文件名（或先备份再跑脚本）。  
2. 执行 `npm run normalize-tanks`。  
3. 在 **Cocos Creator** 资源管理器中，对改动过的 PNG **右键 → 重新导入资源**，以刷新 `.meta` 与纹理缓存。  
4. 预览战斗场景，确认无白边、比例与邻车一致。

---

## 6. 白边审计（可选）

```bash
npm run audit-tanks
```

会统计各 PNG 中「偏白且仍不透明」像素占比并写入日志（详见 `tools/auditTankPngWhite.cjs`）。用于回归检查，**不能**替代规范化脚本。

---

## 7. 游戏内显示（供策划对照）

- 车体在格内缩放约与 **`hexSize * 1.8`** 相关（`applyTopDownTankSprite` 中按精灵长边适配）。  
- **起火、瘫痪等状态**不替换车体贴图，由格子下方**状态图标条**与右侧状态栏表现（见 `BattleScene` 与策划文档相关章节）。

---

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-04-23 | 初版：与 `normalizeTankSprites.cjs` / `auditTankPngWhite.cjs` 及当前 `SPRITE_BASES` 对齐。 |
