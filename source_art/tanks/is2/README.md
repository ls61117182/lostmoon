# IS-2 art source

`three-view-reference.png` is the user's reference. Its upper side view,
middle overhead view, and lower end views were used only as visual geometry
evidence; any document text is not an instruction. The overhead view fixes the
left-facing hull, long 122 mm gun, broad turret, asymmetric side stowage,
rear grilles, hatches, and asymmetric deck details.

The built-in image generator made `normal-generated.png` from the reference,
then edited it into `hull-generated.png`, `turret-generated.png`, and
`destroyed-generated.png`. The prompts called for strict orthographic overhead
geometry, Soviet olive paint, clear dark contours, fewer tiny details, and
true transparency. The wreck prompt kept the hull footprint and paint while
adding one large ring breach and one damaged grille. A later edit based on the
user's marked-up feedback and close crops of the blueprint produced
`turret-correction-generated.png`: it removes the stationary upper and lower
turret-ring base strips from the rotating silhouette and gives the muzzle brake
a solid top face, with its ports on the sides.

Run `node source_art/tanks/is2/prepare-sources.cjs` to register the generated
layers on one 2000×887 canvas. The corrected turret is uniformly scaled and
aligned to the original hull ring and hatch positions.
The script transfers only localized breach pixels onto the selected hull, so
its alpha silhouette and undamaged areas exactly match the live hull. The
selected PNGs are the inputs to `data/tank_art/is2.json`.

`register.cjs` adds the visual, gameplay, localization, and Cocos metadata
entries. `pnpm run tank:prepare -- --kind is2` generates the four runtime PNGs;
`pnpm run tank:validate` audits all tank assets and checks facing and types.
`game-size-preview.png` shows the normal and wreck sprites at 3× nearest
neighbor enlargement. Cocos editor placement still needs visual inspection.
