# KV-1 art source

`three-view-reference.png` is the user's geometry reference. The labels and
watermark in that image were treated as image content, not as instructions.

The bitmap source was made with the built-in image generation tool using these
prompts, with the supplied three-view as the visual reference:

1. Draw only the lower overhead KV-1 view as an olive-green game sprite,
   pointing left, preserving the rectangular hull, two tracks, angular turret,
   short 76 mm gun, bow machine gun, and two rear circular engine grilles;
   use bold outlines, simplified small details, and true transparency.
2. Remove the turret and main gun from that overhead sprite; continue the hull
   deck beneath with a circular turret ring; preserve all other hull details.
3. Isolate the rotating turret, mantlet, and main gun from the overhead sprite
   on a transparent canvas.
4. Edit the current selected hull source into a destroyed state with one large
   central breach, localized soot, and one damaged grille while preserving its
   olive paint, tracks, footprint, and transparent background.
5. Add the small rear-facing machine gun from the reference overhead view to
   the turret's back wall, centered on the main-gun axis and pointing right.

`prepare-sources.cjs` normalizes the generated layers, shortens the isolated
gun to the three-view proportion, and adds the rear machine gun. It composites
only the generated breach and grille damage onto exact pixels from the current
selected hull; alpha, tracks, outline, and unaffected deck remain identical.
The reference hull outline measures approximately
577×284 pixels (2.03:1); the selected hull's alpha bounds are 1578×778
(2.03:1). The turret is resized uniformly to preserve the proportions of its
generated source. An earlier nonuniform turret transform (91% horizontal,
82% vertical) made the game sprite visibly too narrow across the hull.
`hull-selected.png`, `turret-selected.png`, and `destroyed-selected.png` are the
inputs to `data/tank_art/kv1.json`. `register.cjs` adds the source rows and
Cocos metadata; `tank:prepare` builds the four runtime PNGs from the manifest.

The playable unit profile was based on the existing Soviet tank configuration,
with slower movement, stronger armor, a five-person crew, and the 76 mm gun.
The exact game balance values can be tuned in `data/units.csv`.

`game-size-preview.png` shows the 142×71 normal and wreck sprites enlarged 3×
with nearest-neighbor sampling. The hull and wreck have identical 140×69
visible bounds inside their 142×71 canvases. Resource audit, sprite metadata,
pivots, and the tank facing tests passed. Cocos in-game visual placement
remains to be checked in the editor.
