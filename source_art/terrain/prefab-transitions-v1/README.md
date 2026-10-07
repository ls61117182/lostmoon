# Common terrain transition prefabs

Generated offline from the current native terrain compositor. Run `node tools/bakeCommonTerrainTransitions.cjs` to rebuild.

1152 RGBA full-hex tiles across 9 terrain pairs; water pairs also include 640 RGBA animation masks. Images are 170×194 at 2 pixels per canonical world unit, including overlap padding. Six directional mask bits follow the manifest directions; no runtime rotation is required. Border colour and detail are standardized in an inward 10-unit strip, with a shared average at corners. Water interfaces retain land at the grid boundary.

Match only two-material neighborhoods without roads, bridges, runways, village yards, cities or map edges. A second ring must agree with the extended topology used by the baker; arbitrary three-material vertices need the existing fallback. Run `node tools/installCommonTerrainTransitions.cjs` to install feathered runtime assets and paired animation masks. The game overlays matching prefabs on continuous ground; see RUNTIME.md for matching and fallback behavior. The source material SHA identifies stale bakes.
