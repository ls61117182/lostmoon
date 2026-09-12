# Lateral centering correction

Approved longitudinal center stays x=910. Lateral center moves from y=430 to y=450, midway between the side rails (source y≈9..893). Same translation for hull ring and wreck ring, no rotation or scaling. Source rendering uses the existing built-in image edits and deterministic localized composition in tools/preparePanzer3MRingPosition.cjs. Runtime coordinates, turret and assembled image are preserved.

## Built-in local-edit prompt

Tiny localized positional edit. On this EXACT 1746x901 hull image the circular turret ring is centered at (910,430). Move this ring ONLY DOWN 20 pixels to (910,450), the midpoint between upper and lower track rails. Maintain its horizontal X=910 position, exact diameter, circular shape, bolts, gray paint and all details. Restore the vacated thin crescent of deck smoothly. Change absolutely nothing else. No rotation, stretch, recentering or resizing of image. Keep same full canvas and all existing transparent pixels, or pure #00ff00 background if necessary. The nose points LEFT so this downwards image movement is purely lateral vehicle centering, not moving forward or backward.

