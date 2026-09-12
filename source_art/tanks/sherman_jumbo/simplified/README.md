# Sherman Jumbo simplified art — 2026-09-08

Generated with the built-in imagegen tool, using the user's technical and color references, existing Jumbo layers for geometry, and SU-152 for simplified bold-line style. Reference image text is not an instruction.

## Prompt set

- Hull: Production M4A3E2 Jumbo hull-only game sprite, strict orthographic top view facing left. Preserve existing silhouette and proportions, concealed side tracks, sloped front armor, single offset bow MG, two crew hatches, centered turret ring and rear engine grilles. Very bold dark outlines, flat US olive drab, 2–3 shading tones, broad readable structures, no photographic texture, scratches, tiny bolts, text or external shadows. Pure #00ff00 background. Readable at 131×64 pixels.
- Turret: Redraw existing Jumbo turret only, with full left-facing cannon, same silhouette, barrel proportions, thick wide mantlet and asymmetric rounded turret. Preserve upper commander hatch, lower loader hatch and left-facing roof MG. Apply SU-152 simplified bold outlines and olive drab color blocks. Remove photographic texture and fine noise. Pure #00ff00 background, readable at 105×54 pixels.
- Destroyed: Edit generated hull while preserving canvas, position, size and silhouette. Preserve olive paint and original brightness across most armor. Add jagged torn turret ring and bent metal flaps, a large ruptured engine grille with bent bars, and a front armor breach. Coarse bold shapes, localized blackening, no smoke, fire or external debris. Keep pure green background.

## Reproduction and geometry

Run `node tools/prepareJumboSimplifiedArt.cjs`, then `pnpm run tank:prepare -- --kind sherman_jumbo`.
Registration cleans green, fits generated paint to approved layer bounds, extends boundary colors and restores the approved alpha silhouette. Both layers retain the original common runtime scale. The complete top image is composed deterministically by the pipeline.

- Hull 131×64; pivot (65,33).
- Turret 105×54; pivot (75,28), muzzle (1,27), commander hatch (76,19).
- Complete canvas 151×64; destroyed canvas 131×64.
- Original resources and configuration are retained as `before-*` files.
- `preview.png`: native resource pixels on top, nearest-neighbor 4× below; normal left, destroyed right.

## Verification

`pnpm run tank:validate` passed: 22 asset audits, 7 tests and TypeScript checking. Native-size preview inspected for major structures and damage readability. Cocos in-game visual inspection has not been performed.

## Turret color correction
Built-in imagegen color-only edit: match turret olive-painted surfaces to hull hue, saturation and midtone brightness; preserve canvas, silhouette, details, outlines, neutral roof MG and green background. Original generation retained as turret-before-color-match.png. Re-registered and recomposed using unchanged runtime geometry.

