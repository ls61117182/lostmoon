# 第二版实际生成提示词（内置 image_gen）

## 主炮居中

undefined

## 增加车尾横置油桶

Use case: precise-object-edit. Image 1 is the edit target: the approved GREY TURRETLESS MAUS HULL game sprite. Image 2 is an external orthographic TOP view geometric reference showing the missing fuel drum. Image 3 is a rear-angle 3D reference ONLY to understand the rear drum and mounting.
Make ONLY this addition to image 1: add the Maus's large transverse external cylindrical fuel tank, centered horizontally on the REAR of the hull, which is the BOTTOM of image. Its long cylinder axis is horizontal LEFT-RIGHT, NOT front-back. Drum length across screen about 52% of hull width, drum front-back diameter about 25% of hull width, exactly like the second reference. It sits on two supports at the center of the rear plate and projects out behind the hull. In strict overhead view it appears as a wide horizontal rounded rectangle with curved end caps and 3-4 simple thick ribs / retaining bands running front-back. Two thick retaining straps, one small filler cap, painted in the same GREY as the tank. No huge visible elliptical sidewall; strict orthographic top-down geometry.
Preserve ALL original hull geometry, hull width and length, dark circular empty turret ring, paired forward engine grilles, panels, outlines, color, lighting and locations EXACTLY. Only extend the transparent canvas downward to fit the drum; do NOT shrink or reframe the original hull to make space. Keep front UP. This remains a hull-only sprite: NO turret, NO guns, NO cannon, NO gun mantle. Same bold clean simplified gray game art, real transparent background, no ground shadow, no labels, no emblems, no scenery.

## 油桶比例校正（一）

Use case: precise-object-edit. Keep this exact hull sprite unchanged except the added bottom fuel drum is TOO WIDE. Correct ONLY the width of the horizontal fuel drum at the bottom. It currently spans roughly x=162 to x=681 (~519 pixels), while the hull spans x=111 to x=731 (~620 pixels). The drum must span about x=260 to x=582 (~322 pixels), centered at x=421. Target drum length is 52% of hull width, like the Maus plan, NOT 84%. Keep drum vertical diameter about 155 pixels and its current y position, grey palette and overall shape. This makes the barrel length-to-diameter ratio about 2.1 instead of 3.1. Reposition the retaining straps/supports inward to attach correctly to the shorter centered drum. Keep a small filler cap and 3-4 simple bands. Leave every other pixel region of hull, empty turret ring, cooling grilles, panels, tracks and hull silhouette unchanged. Strict orthographic top view, front UP. Real transparent background, no turret, no guns, no cast shadow, no text. Do not scale or reframe the hull.

## 油桶比例校正（二）

Edit ONLY the added horizontal fuel drum at the very bottom of this turretless tank hull. Make this bottom drum 25% SHORTER LEFT-TO-RIGHT, keeping its height/diameter and central position unchanged. It should have EXACTLY THE SAME WIDTH AS THE DARK EMPTY CIRCULAR TURRET OPENING on the hull above it, not the outer ring rim, the dark circle. The shorter drum should be rather squat (length about twice diameter), not a long thin cylinder. Two retaining straps move inward to match. Keep all hull pixels, panel geometry, forward grilles, tracks, gray color, transparent canvas and framing unchanged. Only the bottom drum and its brackets may change. Strict overhead front UP, no turret or guns, real transparency, no text.

## 基于带油桶车身制作无炮塔击毁图

Use case: precise-object-edit. Edit THIS EXACT TURRETLESS MAUS HULL WITH ITS SMALL REAR FUEL DRUM into the destroyed HULL-ONLY state. This is the base image to edit, not a reference for inventing a new tank. Preserve geometry and framing.
The turret has been blown off completely. Show only the existing hull, existing dark empty round turret ring and the existing horizontal rear fuel drum. ABSOLUTELY NO TURRET, NO CANNON, NO GUN TUBE, NO MANTLE, NO TURRET ROOF, NO TURRET CREW HATCHES. Do not depict a detached turret anywhere.
Keep front UP, exact hull width and length, existing fuel drum size and rear position unchanged, same strict overhead view, canvas and margins. Damage only in a few large readable shapes: dark scorched hollow circular turret cavity with torn rim, three bent grey rim sections; smashed SCREEN LEFT forward engine grille with one local soot patch; short broken SCREEN RIGHT side skirt with exposed track; a rear rectangular access panel bent open. Add one small dent/soot patch on fuel drum, but keep its silhouette and grey paint recognizable. Nose plate and rear outer outline stay mostly intact to allow precise normal/destroyed alignment.
Retain original grey hue and brightness on at least 65% of hull surfaces; no overall brown tint or whole-sprite darkening. Same simplified painted RTS game art, bold black outline, major structural detail, minimal fine scratches. Final sprite only about 100x300 pixels, so large damage shapes. Real transparent background, NO smoke, flames, cast shadow, debris outside footprint, scenery, emblems or text.
