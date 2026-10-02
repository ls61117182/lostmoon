# Panzer III M without added armor

This variant starts with the approved gray Panzer III M source art. The
`turret-edit.png` was made with the built-in image editing tool to identify
the solid turret silhouette without the outer armor ring.
`tools/preparePanzer3MNoArmorArt.cjs` erases only the thin external rails
and braces in the user's red annotation. It checks byte-for-byte retention
of every hull pixel outside those narrow masks and the central turret roof.
It also removes the two detached arc fragments identified in the in-game
screenshot, including their faint alpha edges, while retaining the solid
turret body.

The edit prompt asked for the original left-facing, exact overhead geometry,
gray paint and transparent canvas, removal of the turret's outer spaced-armor
ring, and retention of the tank's own armor, gun, cupola and hatches. The hull
and wreck edits use only the original M artwork. Their broad gray side plates,
front and rear deck, wheels and damage remain in place.

To rebuild the final Cocos PNGs and coordinates:

```powershell
node tools/preparePanzer3MNoArmorArt.cjs
node tools/prepareTankArt.cjs --kind panzer3_m_no_schurzen
```

`preview-compare-2x.png` shows both variants at small size: original on the
left, new variant on the right; normal images above, wrecks below.
