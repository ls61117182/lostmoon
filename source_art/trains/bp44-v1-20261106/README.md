# BP 44 风格装甲列车 · 美术 V1

2026-11-06，按用户确认的六种模块制作，一节占 1 个六角格。

## 交付

- 装甲蒸汽机车、装甲煤水车、指挥/步兵车、榴弹炮车、火炮/防空组合车、反坦克炮车。
- 6 张正常车体 + 6 张整节击毁残骸 + 3 张独立武器，共 15 张正式 PNG。
- 正式资源：`assets/resources/textures/units/trains/bp44/`。
- 美术注册表：正式目录中的 `bp44_art_manifest.json`，包含多武器安装点、车钩、烟囱、轮组、转轴和炮口。
- 每张 PNG 为 512×512 真透明图，使用中心锚点、不裁边的 Cocos `.meta`。

## 本目录

- `guides/`：本项目单格模块的几何定位图与 SVG 源文件。
- `sources/`：15 张内置 imagegen 原始输出，保留生成时的原画布。
- `prompts/`：每张原始输出的完整提示词，含风格、部件数量、位置和残骸约束。
- `registration.json`：三种武器和六种残骸的统一比例/位置注册参数。
- `assembled/`：由正式车体及武器确定性合成的六张正常预览，也作为对应残骸生成的参考。
- `validation.json`：正式资源的校验报告与 SHA-256 清单。
- `previews/bp44-modules-preview.png`：六种模块的正常/击毁总表。
- `previews/bp44-small-scale-preview.png`：R=48 的游戏显示尺寸、缩小 50% 和残骸检查。
- `previews/bp44-railway-preview.png`：直轨一节一格拼接及弯轨静态组合示意。
- `previews/bp44-independent-rotation.png`：独立车厢、武器转向和车厢转向对照。
- `previews/bp44-independent-rotation.html`：可离线打开的独立旋转预览，组合车两套武器分别控制。

## 制作与重建

使用 tank-art 与内置 imagegen 工作流。风格参考项目现有 SU-152 的简化细节原则与四号坦克的灰蓝装甲表现；以本项目确认的模块结构和几何定位图控制长宽、安装点和车钩。正常车体与独立武器分别生成，按同一比例及支点合成。残骸基于该模块完整正常图生成，保持车体轴线和两端长度，以大破口与局部焦黑表达破坏。

```powershell
node tools/prepareArmoredTrainArt.cjs guides
node tools/prepareArmoredTrainArt.cjs register
npm run train:prepare
```

普通重建只使用已保存的源图，不重新调用 imagegen。几何与导出脚本：`tools/prepareArmoredTrainArt.cjs`；资源审计：`tools/auditArmoredTrainArt.cjs`；预览：`tools/previewArmoredTrainArt.cjs`。

坐标规格和后续接入说明见 `docs/ArmoredTrainArt.md`。本轮制作的是美术资源，火车移动、转弯、战斗与编组规则仍待后续定义。预览由项目地面与正式单位素材合成，不是运行中的 Cocos 列车截图。

## 验证

15 张正式资源的透明度、512 画布、唯一 UUID、Cocos 元数据、车钩对齐、正常分层合成、实际炮口、四联装炮管数量、残骸比例/位置与可见损伤检查通过。完成正常/击毁总表、实际显示尺寸和铁路组合示意的目视检查；Cocos 中的列车实际呈现待后续规则与渲染接入后一并验收。

独立旋转补充：武器使用 schemaVersion 2 清单中的独立 `slotId`，全部标记 `rotationMode: "independent"`。Cocos 绘制单元位于 `assets/scripts/view/ArmoredTrainVisual.ts`，车厢和各武器分别使用节点与角度；组合车的主炮和防空炮互不带动。`npm run train:validate` 检查分层、旋转节点、炮口、交互预览与 TypeScript 类型。此单元尚待后续火车规则接入战斗场景。
