# T-34/76 blueprint redraw

The supplied three-view is the geometry authority. Its plan crop is original x=0, y=165, width=390, height=179, uniformly enlarged 4x. Hull lineart crop: x=160, y=20, width=1388, height=684 in that enlarged plan. Turret and gun were masked from the same plan before colorization; only the turret-occluded hull was filled.

Key features: bow MG, two longitudinal external drums aligned on opposite shoulders, three-pane rear radiator grille, angular turret, projecting gun shield, short thin 76mm barrel, two hatch positions, single rear ventilation dome. Soviet green follows the user's approved T-34/85 palette family.

The generated turret body was uniformly registered to blueprint scale; its shortened straight barrel section was extended by 99 source pixels without changing muzzle, mantlet, body or barrel thickness. Selected hull is 1388x648; turret 984x441. Minor local colorization deviations from the lineart remain. Actual selected pivot coordinates: hull (591,324), turret (740,221); muzzle (1,221); commander hatch (755,295). Common final scale 0.1 with 1px padding. High-resolution source preview positions hull at (149,0) and turret at (0,103).

Formal hull and destroyed canvases are both 141x67; turret 100x46; composed top 171x67. Hull and destroyed alpha channels verified identical. Existing Cocos resource UUIDs are retained. Previous formal art was backed up automatically by tank:prepare, with the pre-edit CSV additionally saved under asset_backups/t34_before_blueprint_redraw.

Run node source_art/tanks/t34/prepare-sources.cjs, then node tools/prepareTankArt.cjs --kind t34 to reproduce selected sources and formal art. Combat parameters are unchanged.
