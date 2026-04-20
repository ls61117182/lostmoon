# 数值表 → 代码 工作流

本目录里的小脚本把 `data/` 下的 Excel 表转成游戏运行时用的 TypeScript 数据文件。
策划改数值不需要碰 `assets/` 里的代码，改 CSV 跑一条命令即可。

---

## 1. 在哪里改单位（坦克 / 步兵）数值？

文件：`data/units.csv`

| 列名             | 含义                       | 允许值                                         |
| ---------------- | -------------------------- | ---------------------------------------------- |
| `unitKind`       | 单位代号（代码层会用）     | `sherman` / `tiger` / `panzer4` / `panzer3` / `truck` / `infantry` |
| `displayName`    | 显示名（仅作注释）         | 任意中文                                       |
| `size`           | 体型（影响敌方命中所需）   | 0 ～ 6 整数                                    |
| `armorFront`     | 正面装甲                   | 非负整数                                       |
| `armorFrontSide` | 前侧装甲                   | 非负整数                                       |
| `armorRearSide`  | 后侧装甲                   | 非负整数                                       |
| `armorRear`      | 后方装甲                   | 非负整数                                       |
| `penetration`    | 穿甲值                     | 非负整数                                       |
| `notes`          | 备注（仅作注释）           | 任意中文                                       |

**装甲规则速查**：开火时先掷 2d6 命中（`≥ 体型 + 距离 + …` 即命中），命中后再掷 1d6 击穿
（`d6 ≥ 装甲 - 穿甲` 才造成伤害）。所以：

- 想让某辆坦克"更难被打穿" → 加 `armorFront` / `armorFrontSide` 等
- 想让某门炮"对所有目标都打穿" → 加 `penetration`
- 想让某辆坦克"更难命中" → 减 `size`（或敌方加距离）

---

## 2. 修改流程

1. **打开 CSV**：双击 `data/units.csv`，Excel 会以中文 UTF-8 正常显示
2. **改数值**：直接在表格里修改对应单元格
3. **保存**：Excel 会弹"是否保留 CSV 格式" → 点 **是 / 保留** （**不要**另存为 `.xlsx`）
4. **重新生成代码**：在项目根目录打开 PowerShell，运行：

   ```powershell
   node tools/buildUnitDB.js
   ```

   看到 `[buildUnitDB] OK  6 units → assets\scripts\core\UnitDB.ts` 即成功。
5. **回到 Cocos Creator** 点预览，新数值立即生效。

> **关于 Excel 中文乱码**
>
> 中文版 Excel 默认会把 CSV 保存为 GBK 编码并去掉 BOM 标记，下次再打开就会乱码。
> 本脚本对此做了双重保护：
>
> - 读 CSV 时同时支持 **UTF-8** 和 **GBK**，编辑保存为哪种都能解析
> - 解析后会**自动把 CSV 重写为 "UTF-8 + BOM"**，保证下次 Excel 打开不乱码
>
> 所以即便忘了选格式，下一次跑 `node tools/buildUnitDB.js` 之后，再打开 CSV 就恢复正常了。
> 如果想一步到位避免脚本提示，Excel 保存时选 **"CSV UTF-8 (逗号分隔) (*.csv)"** 这个格式即可
> （Office 2016 及以上版本支持；WPS 表格直接保存为 CSV 默认就是 UTF-8）。

---

## 3. 出错怎么办？

脚本会在写文件**之前**检查所有数据，发现错误时不会污染游戏代码。常见报错：

| 报错                                    | 解决                                                   |
| --------------------------------------- | ------------------------------------------------------ |
| `第 N 行: 未知 unitKind="xxx"`          | `unitKind` 列拼写错了，必须是文档第 1 节列出的 6 个之一 |
| `第 N 行 xxx: 字段 armorFront 为空`     | 该单元格漏填，补一个非负整数                           |
| `第 N 行 xxx: 字段 size="2.5" 不是整数` | 数值必须是整数                                         |
| `CSV 缺少 unitKind="xxx" 这一行`        | 6 种单位都必须各占一行，不能删除                       |

如果看到乱码（比如打开 CSV 全是问号），说明 Excel 没识别 BOM —— 用记事本另存为
"UTF-8（带 BOM）"再保存即可。

---

## 4. 后续可拓展

下面这些"还在代码里"的数值，将来都可以照同一套路转移到 CSV：

- 命中修正常量（树篱、建筑加成）
- 地形移动开销（`assets/scripts/core/MoveCost.ts`）
- 任务关卡放置（已经在 `assets/resources/missions/*.json` 里，已是策划友好的 JSON）
- 行动表 / AI 表（手册 P11 / P14，目前 MVP 简化处理）

需要再加表的时候告诉我，按一样的方式（CSV → build 脚本 → TS）扩。
