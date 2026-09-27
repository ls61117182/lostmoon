# Pak 38 俯视图重绘

几何依据：[Hubert Cance 的 5 cm Pak 38 多视图线稿](https://www.hubertcance.com/large-multi-view/Plan-Drawings-Artillery/3475189-37-270472/Drawing/5-cm-pak-38.html)中的俯视投影。仅以该图作结构参考，未将其图片复制进项目。

使用内置 imagegen 将俯视线稿重绘为透明底游戏素材。生成提示词的关键约束：保持炮管向左、双室制退器、横向的两只车轮、浅弧形双层炮盾、右侧炮尾和两条细长的分叉炮架；使用平滑抗锯齿边缘、深色轮廓及少量灰绿色高光，不增加大型装甲块。击毁图以正常图为基准，保留同一画布和部件位置，炮管局部断裂并带少量炮盾焦痕。

- `top-blueprint-generated.png`：正常状态的高分辨率生成源图。
- `destroyed-blueprint-generated.png`：对应的击毁状态生成源图。
- 游戏资源由两张源图使用 Sharp 的 `lanczos3` 缩小到 150×110，保存至 `assets/resources/textures/units/pak38_top*.png`。
- 资源仍以 `linear` 过滤显示；高分辨率源稿缩小时保留抗锯齿边缘，并以游戏实际尺寸检查可读性。
