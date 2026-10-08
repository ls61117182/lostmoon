# GPU 连续地面与分块缓存

运行时已取消预制衔接层。2026-10-08 已删除旧源图与归档运行时图片（含预览图共 3225 张 PNG），释放约 132.27 MiB，并清理旧衔接匹配器、渲染器、烘焙/安装/预览工具及其专用测试。旧资源清单、导入元数据和历史说明也已删除；清理记录见 `source_art/terrain/transition-images-removed.json`。基础地形素材继续复用 `redesign_v3/materials.json`，当前 GPU 合成与 CPU 参考算法的测试继续保留。

## 渲染流程

1. `TerrainGroundGpuData` 根据格子数据建立分块计划。每块只上传附近格子的地形编号、道路连接、桥梁方向及建筑院落等标记；数据使用最近邻采样。
2. 当前风格的基础纹理只解码一次，上传到带独立边框的共享图集。切换风格才释放旧图集；局部修改地形继续复用它。图集上传后不会持有解码后的 RGB 副本。
3. `terrain-bake.effect` 根据统一地图坐标混合纹理，生成不规则地形边界、岸线、雪地、泥地、道路、跑道、桥梁和院落。GPU 的距离场混合替代旧 CPU 的逐像素模糊，画面不承诺与旧预制图逐像素一致。
4. `TerrainGroundGpuBaker` 使用独立 2D Canvas 和正交相机输出颜色 RenderTexture，以及有水时的水面遮罩。无需启用项目关闭的 3D 模块。
5. 每帧最多提交一块，收到 `Director.EVENT_AFTER_DRAW` 后关闭相机、释放临时数据纹理，只留下缓存。每块有一像素重叠边框，使用 Cocos 的 RenderTexture 材质 UV 翻转约定。
6. 移动单位、瞄准、平移及缩放只改变缓存精灵的变换。地形修改以带邻域的分块指纹决定更新范围；远处缓存保持原样。水面只更新动画参数。

换地图、切换风格、取消生成、退出战斗时会释放相应资源。Effect 加载或生成过程出错会进入 BattleScene 已有的地形精灵回退路径。

## 手机与内存

默认生成倍率为 1，每块输出 386×386，单张 RGBA8 颜色贴图约 0.57 MiB；有水的块另外保存同尺寸遮罩。RenderTexture 默认还有深度/模板附件，设备实际占用需另计。基础图集为 1544×1930 RGBA8，约 11.4 MiB。构造 `TerrainGroundRenderer` 时第三个参数可选 1 或 2；2 倍会增加分块贴图的内存和生成开销。

当前继续保留关卡全图缓存，并非按视口淘汰的 LRU。大地图手机版若需要严格内存上限，应再接入可见范围、缓存预算与淘汰调度。此版本的像素测试使用桌面软件 WebGL，不能代替手机真机的加载时间、显存、帧率和发热测试。

## 验证

```text
npm run typecheck
node tests/TerrainGroundGpu.test.js
node tests/TerrainGroundRaster.test.js
npm run terrain:validate:gpu
```

最后一项使用独立的无界面 Chrome 配置。默认读取 Windows Chrome 安装路径，也可用 `CHROME_PATH` 指定浏览器。输出位于 `tmp/terrain-gpu/`，包括像素报告和预览图。该测试直接读取生产 Shader、实际基础纹理，检查 WebGL 1 编译，以及 WebGL 2 的夏季/冬季/太平洋分块接缝、陆地遮罩和静止桥面。

本次另外使用 Cocos 3.8.8 的 Effect 编译器验证两个 Effect，并在现有 2D Cocos 预览引擎中加载当前源码验证真实 Canvas/Camera 输出：4 块在 4 个生成帧完成，有效颜色与水面遮罩存在，缩放/平移保持缓存对象不变。编辑器预览脚本缓存需要刷新后才会使用磁盘上的最新代码。
