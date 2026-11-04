# 北非连续高程美术资源 V2

本版替代 V1 设计图中的独立沙丘、单格岩台和单格干河床。资源已生成并整理，预览复用项目现有 ElevationContourRaster；尚未接入 Cocos 战场、编辑器与地表 GPU 图集。没有修改任何战斗规则或已有运行时资源。

## 三种地貌的构成

| 地貌 | 地表 | 高度和格边 | 美术表现 |
| --- | --- | --- | --- |
| 沙丘 | 细沙材质；规则等效 mud | 多格连续 0/1/2；缓坡 | 宽而低对比的连续沙坡，沙纹留在地表；不把单个弯月丘或阴影烘焙到一格图片里 |
| 岩石台地 | 石灰岩顶面；规则等效 field | 连片正高度；缓坡入口和陡坡边界 | 同高顶面连续，内部不重复画岩圈；陡坡由石灰岩底层和独立碎石组成 |
| 干河床 | 淡褐冲积土地表；规则等效 field | 河床相对低一层；两岸可配置缓坡和陡坡 | 低处地表连续延伸，岸坡根据两侧实际高差生成；不把河床画成平地上的一条凹槽贴纸 |

高度、道路、掩护、命中、行动骰仍以游戏现有规则为准。缓坡不增加行动消耗，陡坡限制跨越。地表碎石是视觉细节，不自动提供 rocky 地形的掩护和禁行。软沙完整复用泥地时，移动、攻击、杂项骰池都受影响。

## 文件

- north-africa-elevation-v2.png / .svg：三种连续地形与资源分解总览。
- sand-albedo-source.png：imagegen 生成的细沙源材质。
- limestone-albedo-source.png：imagegen 生成的石灰岩源材质，用于顶面和岩坡底层。
- wadi-silt-albedo-source.png：imagegen 生成的干河床冲积土源材质。
- limestone-chips-source.png：imagegen 生成的 4×4 石灰岩碎石源图；生成源图有边缘杂点，正式处理使用 prepared 中的切片。
- prepared/*-albedo-384.png：3 张 384×384 地表工作纹理。
- prepared/limestone-chip-01.png 至 16.png：16 张 48×48 透明碎石切片。
- prepared/limestone-chips.png：整理后碎石总览。
- prepared/continuous-material-north-africa.json：与当前 ElevationMaterialData V5 格式兼容的北非岩坡材质包，包含 256×256 岩石 RGB、16 张碎石 RGBA 和程序推导的法线。此包已在现有高程光栅器中读取并渲染。
- preview-dune.png / preview-plateau.png / preview-wadi.png：单独的离线地貌预览，网格和轮廓与当前高程系统一致。
- preview-plateau-camera90.png：现有高程渲染器在 camera=90 参数下的光照预览；地面布局本身未旋转。
- preview-40px-hex.png：将每格水平宽度缩为约 40px 的三组预览。
- height-layouts.json：预览使用的高度、陡坡格边、规则地面及离线外观字段；不是可直接导入的任务包。
- qa-report.json：高程几何与分块采样检查结果。
- prompts.json：内置 imagegen 的完整提示词。透明图精修候选没有作为最终源图采用，最终整理使用初次生成的碎石源图。
- build.cjs：可重现的资源整理、离线合成和检查脚本。

复现：在项目根目录执行 `node source_art/terrain/north-africa-elevation-v2-20261102/build.cjs`。脚本只写入本目录。

## 生产方式

细沙、石灰岩和冲积土源图只承担材料细节；坡面宽度、坡顶与坡脚、转角、连续光照由现有高程轮廓计算。碎石处理沿用现有 prepareElevationMaterial.cjs 的制作思路，清除生成杂点、保留主要连通轮廓、缩放至 48px、减弱烘焙明暗并推导法线，透明边缘低 alpha 色彩一并清除。

同高相邻格不生成边坡。地表和坡面分别采样，不按每格重新开始纹理。预览地表由 SVG 全局纹理图案铺设，坡面由实际 ElevationContourRaster 生成后合成；地表外观字段 surface 只在本离线示例里使用，不是游戏已经支持的新字段。

## 接入现状与后续所需改动

当前 ElevationRenderer 固定加载 textures/terrain/elevation/continuous-material，只有一份全局缓存。要接入本包，应让材质加载、轮廓缓存按战场或材质包区分，保持欧洲原材质不被覆盖。几何、视线、移动与命中规则不需要因此改写。

当前地表外观主要由 terrain 类型选材质，不能直接为同一个 field 同时选择普通硬沙、石灰岩顶面和冲积土。正式接入还需增加独立地表外观选择，并同步 CPU/GPU 材质、指纹与编辑器预览；外观选择不可改变等效骰池地形。此次没有把 field 改成 rocky 来显示石灰岩，也没有用 water 表示干河床。

当前缓坡用透明明暗保留原地表，因此细沙材质可直接利用该机制；岩坡可使用本次生成的 V5 包。若未来希望“可通行的岩质缓坡”或“不可通行但完全无碎石的沙壁”，需要把坡面材质和 cliff 通行标记解耦，这是额外的视觉实现需求，本版没有声称已支持。

## 已检查与限制

- 三组示例各 48 格，覆盖六个边界方向。
- 沙丘使用 0/1/2，高地使用 0/1，干河床使用 0/-1；岩台与河床均包含缓坡/陡坡混接。
- 以 camera=0 和 camera=90 检查两块独立输出与整块输出的相同世界像素，三组最大 RGBA 差值均为 0。这是高程覆盖纹理的分块采样检查，不代表整个游戏 GPU 图集已完成验证。
- 已查看总览、碎石预览和约 40px 格宽的小尺寸图。
- 地表材质直接平铺周期、GPU 混合、Cocos 实际战场观感与手机显示仍需在正式接入后检查；本图不是游戏截图。
