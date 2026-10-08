# 四号坦克F型（F1）

当前版本直接使用用户提供的炮塔底图user-turret-base.png，保留其像素位置与轮廓。只清除外部白底并匹配灰色配色；新增短75毫米KwK 37 L/24炮盾/炮管来自内置ImageGen编辑结果，生成结果中的炮塔本体未使用。车身和击毁图逐像素复用现有G型素材。此前生成炮塔保留为历史过程文件。

## 参考

- 三视图原页面：https://www.pinterest.com/pin/678425131359437113/
- 保存的三视图图像：https://i.pinimg.com/564x/e7/2e/1c/e72e1cba824b35cdf7128d455b7d7ddc.jpg
- 型号结构与武器资料：https://tanks-encyclopedia.com/ww2/nazi_germany/panzer_iv_ausf_f1/
- F型说明（田宫）：https://cdn.simba-dickie-group.de/downloads/300035374/300035374_Panzerkampfwagen_IV_Ausf.F_Beiblatt.pdf

几何以保存的俯视图为依据，保留短炮、无制退器炮口、炮盾、车长舱盖、两侧舱门、顶面圆盖与后储物箱。按用户要求复用G型车身，因此车身附件并非独立复原的F型车身。

## 构建

```powershell
node tools/registerPanzer4F.cjs
node tools/preparePanzer4FUserBase.cjs
node tools/applyPanzer4FFrontDetail.cjs
node tools/trimPanzer4FFront.cjs
node tools/preparePanzer4FSource.cjs
node tools/prepareTankArt.cjs --kind panzer4_f
node tools/finalizePanzer4F.cjs
node tools/buildUnitDB.js
node tools/buildLangDB.js
node tools/previewPanzer4F.cjs
pnpm run tank:validate
```

finalize步骤恢复G型车身/击毁图的原始边缘像素，并按CSV支点重新合成完整图。当前成品采用统一0.146缩放，炮塔支点为(64,30)，车身支点为(79,38)，炮口为(1,30)，舱盖为(72,30)。用户底图按连通外部白色移除背景，内部白色按灰度映射为车身灰色，保留原轮廓和内部线条位置。

炮的位置与粗细最初按reference-gun-position.png的四段框确定：炮口段(37,217,43,25)、炮管段(80,212,78,35)、炮根段(158,184,57,94)、炮盾段(215,163,35,129)，均为(x,y,w,h)。炮塔底图等比放大至597×447并放在(165,2)，与用户示意图中的炮塔重合。

最新版本依照reference-gun-detail.png重新绘制弧形炮盾、炮根渐收连接和套筒。用户明确授权炮塔最前部重新绘制，可不严格遵守矩形框；只有源图x<285、y135..330的炮与前缘区域被替换，其余用户底图保留。最新提示词gun-front-detail-prompt.txt，炮口源坐标(38,235)。此前gun-position-prompt.txt和user-base-prompt.txt为历史提示词。

随后依据reference-front-trim.png红线裁切炮根与前肩多余轮廓。红线顶点转换到当前源图坐标，以透明蒙版精确裁掉外侧；内部颜色和细节像素不改动。trimPanzer4FFront.cjs保存该轮廓，不改变炮口与支点坐标。

历史轮廓修正依据用户红线图reference-contour-markup.png，提示词见contour-correction-prompt.txt。该版已被当前用户底图版替换。

炮管修正使用用户提供的Border Model F1图（reference-user-f1.png）作为最终依据。ImageGen重绘炮管后，将生成的炮管区装回原图；炮盾及后方像素完全保留。露出炮盾的炮管长度从433源像素缩到240，去除膨大炮口和细颈，改为前细后粗的短筒结构。生成提示词保存在barrel-correction-prompt.txt。

游戏数值：短炮穿甲1、高爆2、射程2参照已有三号N型；F型正面装甲采用项目等级9。其他乘员、音效和行动表沿用四号G型。数值是游戏配置而非真实毫米换算。

预览包含原尺寸与最近邻3倍放大；尚未进行Cocos运行场景目视验收。
