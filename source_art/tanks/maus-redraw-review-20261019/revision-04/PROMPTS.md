# 座圈局部编辑提示词

使用内置 image_gen，仅生成座圈局部补绘；外轮廓与游戏坐标使用确定性合成校准。

## 正常座圈

Use case: precise-object-edit. This is a cropped 880x624 top-down armor deck patch from a Maus tank sprite. Front of tank is LEFT; REAR is RIGHT. Shift the ONE circular turret mounting ring 136 pixels RIGHT, towards the rear. It is currently centered near x=384,y=312. The ring must now be centered near x=520,y=312 (59.1% of patch width, 50% of height). Keep its diameter about 430 pixels and exact existing design/line thickness. Do NOT enlarge the ring. Erase the former circle's leftover left arc and fill that region with matching plain grey armor. There must be exactly ONE ring, no double ring or ghost ring.
Preserve the same overhead view, overall 880x624 patch framing, slate-gray armor hue and brightness, horizontal top/bottom deck panel boundaries and the right rectangular access covers. This is a local edit with no change to the tank's width, height or exterior. Keep the softly simplified dark-line painted game style of the target, without adding texture, labels, turret, cannon or new parts. Opaque armor background matching input.
Intact state: retain the round dark-gray turret mounting cavity with its simple intact metal rim and four small clamps, shifted right together.

## 击毁座圈

Use case: precise-object-edit. This is a cropped 880x624 top-down armor deck patch from a Maus tank sprite. Front of tank is LEFT; REAR is RIGHT. Shift the ONE circular turret mounting ring 136 pixels RIGHT, towards the rear. It is currently centered near x=384,y=312. The ring must now be centered near x=520,y=312 (59.1% of patch width, 50% of height). Keep its diameter about 430 pixels and exact existing design/line thickness. Do NOT enlarge the ring. Erase the former circle's leftover left arc and fill that region with matching plain grey armor. There must be exactly ONE ring, no double ring or ghost ring.
Preserve the same overhead view, overall 880x624 patch framing, slate-gray armor hue and brightness, horizontal top/bottom deck panel boundaries and the right rectangular access covers. This is a local edit with no change to the tank's width, height or exterior. Keep the softly simplified dark-line painted game style of the target, without adding texture, labels, turret, cannon or new parts. Opaque armor background matching input.
Destroyed state: retain the black scorched hollow cavity with the same three or four large torn/bent grey metal rim sections, shifted right together. Keep damage local, and preserve original grey deck brightness. Do not show any turret or gun.
