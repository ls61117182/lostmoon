# 猎虎（Jagdtiger）

已接入独立德军固定炮单位 jagdtiger。默认使用德军灰版；原迷彩版与德军灰高清版均保留。

- top-grey-destroyed-raw.png：内置 imagegen 击毁原稿。提示词要求保留灰色、未损区域亮度与长炮管，以战斗室大破口、舱盖翻开、损坏风扇和局部焦黑表示击毁。
- top-grey-destroyed-generated.png：对原稿横向车体范围及高度校准后的同画布版本，避免生成结果车体变宽。
- assets/resources/textures/units/jagdtiger_top.png 和 jagdtiger_top_destroyed.png：220×80 透明贴图，正常与击毁使用相同显示尺度和偏移。
- game-size-preview.png / game-size-preview-3x.png：正常/击毁小尺寸对照。
- tools/registerJagdtiger.cjs：资源与配置接入脚本。

主炮口 (3,41)，车长舱口 (131,35)。不拆分炮塔；固定主炮跟随车体。单位参数采用虎王装甲基础，固定128毫米炮暂定穿深9、HE5、火力2、机动1；六人车组，双装填手；数值待单独平衡。可在选车入口选择猎虎，未添加到随机敌军生成权重。

验证：31车型资源审计、贴图元数据、固定炮射界、任务加载、选车、朝向回归及 TypeScript 检查通过。尚未进行 Cocos 实机目视验收。
