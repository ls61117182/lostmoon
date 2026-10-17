# 欧洲夏季地形 V6 · 细节重绘版

2026-10-15，使用内置 image_gen 重新绘制 8 种地面材质和 4 种透明树冠。草地保留浅黄绿色，增加细草簇；泥地、林地、道路、水面和木桥增加细结构；树冠增加小叶团、枝干和局部明暗层次。

生成原图在 `sources/`，完整提示词在 `prompts-materials-a.json`、`prompts-materials-b.json`、`prompts-trees.json`。项目材质仍为 384×384，树冠仍为 256×256；未提高运行时渲染分辨率。

`classic/` 保存本次工作开始时的 50 张贴图及其 50 个 .meta 文件、原始夏季材质、完整 materials.json 快照和 SHA-256 清单。`detailed/` 保存新版同名文件及校验清单。两套导入配置、UUID 完全一致。旧版备份初始化后不会被构建或切换命令覆盖。

从项目根目录切换：

```powershell
node tools/switchEuropeanTerrainArt.cjs classic
node tools/switchEuropeanTerrainArt.cjs detailed
node tools/switchEuropeanTerrainArt.cjs detailed-bridge
node tools/switchEuropeanTerrainArt.cjs detailed-steel-bridge
```

也可双击本目录中的“切回旧版.cmd”或“使用新版.cmd”。“使用新版”现启用 V6 地形搭配重型钢桥；“使用V6原桥.cmd”恢复 V6 原桥。“detailed-steel-bridge”保存钢桥版，“detailed-bridge”保存中间木桥版，classic、detailed 备份原样保留。命令成功后刷新 Cocos 预览或重新进入游戏，以重新加载资源缓存。

切换器先校验整套资源，再只更新所列夏季图片、导入配置和 `materials.json` 中的 `europeanSummer` 分支；保留其他材质分支。遇到这两套版本之外的本地美术修改时会停止，避免覆盖。若其他材质没有后续编辑，切回 classic 会恢复 materials.json 原始字节。

保留冬季、太平洋、城市、房屋和诺曼底附加物；本版重点重绘普通欧洲夏季地表、树林和树篱。道路 39 种方向/变体、木桥和 6 种地形预览贴图均由新材质重新导出。

预览：`comparison.png` 为同一布局、同一缩放的旧/新版对照；`detailed-map.png` 为新版单图；`asset-sheet.png` 为实际导出尺寸材质表，含 40px 树冠预览。地图预览使用项目 CPU 地面合成器与现用树冠尺寸，示意布局，不是运行中的 Cocos 截图；未显示战争迷雾、动态水面和战斗 UI。

重新构建和生成预览：

```powershell
node tools/buildEuropeanTerrainV6.cjs build
node tools/previewEuropeanTerrainV6.cjs
```

校验入口：`tests/EuropeanTerrainVersions.test.js`。`baseline.json` 记录本次开始时所有地形文件的校验值，用于验证未涉及资源保持原样。

已完成实际切换 detailed → classic → detailed。classic 恢复后全部 371 个原有地形文件（含 .meta）及 materials.json 原始字节均匹配工作开始时的校验值。新包两套方向的 CPU 接缝最大误差为 0；实际 WebGL 1 编译及 WebGL 2 像素验证通过，summer、winter、pacific、normandy 四组 GPU 接缝最大误差均为 0。

回归测试中的三项旧断言在 classic 和 detailed 两套资源下均失败：`bridge roadway pixels exactly reuse the ordinary road surface`、`opposite road mouths use the same seam-free surface color`、`all diagonal road mouths bleed past the hex border to cover rotated seams`。这些为原版已有问题，本次未修改对应测试、道路几何或运行时渲染算法。道路实际连续地面的接缝已由上述 GPU 检查独立验证。
