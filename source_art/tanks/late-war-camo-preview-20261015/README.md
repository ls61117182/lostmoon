# 德军后期涂装：待确认预览

本目录仅存放调研、参考拼图和效果图。未修改游戏贴图、CSV、Cocos 元数据或运行时代码。

## 调研结论

- 通用方向：暗黄 Dunkelgelb（RAL 7028）为底，配橄榄绿 Olivgrün（RAL 6003）与红褐 Rotbraun（RAL 8017）不规则条带、斑块。1943 年起采用，适合本项目统一增加后期外观。
- 备选方向：1944 年后期的 Hinterhalt 伏击迷彩，在三色斑块上加入反差色点。并非所有车型、工厂、批次统一使用，不应当作所有德军战车的唯一标准。
- 预览中的十六进制色值为服务游戏辨识度的美术近似，不是历史油漆的精确数字复原。
- 三号、短炮四号 F1 等旧车型可按后期服役重涂思路制作；鼠式属于原型车，统一后期外观应视为游戏美术扩展，不声称是量产实战涂装。

## 来源

1. The Tank Museum, Watching Paint Dry：实物迷彩色浆研究，明确记载 1943 年三色系统与三个 RAL 编号。https://tankmuseum.org/article/watching-paint-dry/
2. Panzernet, German Army Camouflage Colours and Patterns：三色迷彩的多种斑纹与 1944 年 8 月伏击迷彩概述。https://www.panzernet.net/domains/panzernet.net/panzernet/en/ruzne/maskovani.php

## 预览与后续范围

六个代表车型：四号 G、三号突击炮 G、虎 I、豹 G、虎王、猎豹（当前游戏命名为“追猎者”）。三列分别为当前灰色、A 三色迷彩、B 伏击迷彩。

用户确认方向后再为当前 16 个德军坦克/突击炮版本增加独立涂装资源：panzer3、panzer3_m、panzer3_m_no_schurzen、panzer3_n、panzer3_n_schurzen、panzer4_f、panzer4、stug3、tiger、panther、tigerking、maus、sturmtiger、jagdtiger、elefant、jagdpanther。

正式制作时保持当前几何、部件位置、车身炮塔同源比例和支点，制作对应击毁态，执行 docs/tank-art-pipeline.md 的接入和验收步骤。生成式效果图只用于确认美术方向；缩略图为辨识度参考，尚未进行游戏内目视验收。

生成工具：内置 image_gen；完整提示词见 imagegen-prompt.txt。
