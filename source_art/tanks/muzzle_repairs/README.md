# Muzzle brake top-surface repairs

The overhead sprites for Panther G, Panzer IV G and StuG III G showed a dark or transparent opening on the *top* of the muzzle brake. Their openings should read on the lateral faces; the visible top surface is solid.

`apply.cjs` transfers only the corrected brake paint into the original images. The corrected donor images were made with image editing from tightly cropped originals: retain the existing metal finish and silhouette, close the top-facing openings, and keep the brake's side opening and collar details. The transfer masks prevent changes elsewhere. The `before-*.png` files preserve the exact inputs for comparison; `audit.cjs` reports pixel differences.

Panzer IV G uses the high-resolution `turret-selected.png` as its source. After applying its patch, run `pnpm run tank:prepare -- --kind panzer4` to regenerate the game turret and assembled top image. Panther G and StuG III G have small game sprites patched directly. StuG III G's high-resolution source is also corrected for future art preparation.

At the time of repair, the game sprite differences were confined to these rectangles:

| Vehicle | Sprite | Changed pixel bounds | Changed pixels |
| --- | --- | --- | ---: |
| Panzer IV G | `panzer4_top_turret.png` | (2,23)–(12,28) | 43 |
| Panzer IV G | `panzer4_top.png` | (2,33)–(12,38) | 43 |
| Panther G | `panther_top_turret.png` | (3,49)–(9,55) | 49 |
| Panther G | `panther_top.png` | (3,66)–(9,72) | 49 |
| StuG III G | `stug3_top.png` | (2,37)–(5,40) | 16 |

Sprite dimensions, hull images, destroyed images, configuration and pivots were preserved.
