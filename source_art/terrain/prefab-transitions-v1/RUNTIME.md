# Runtime integration

Run node tools/installCommonTerrainTransitions.cjs after rebuilding the source prefabs. Installation checks the materials SHA and preserves existing asset UUIDs.

TerrainGroundRenderer uses TerrainTransitionRenderer to load only matching images from assets/resources/textures/terrain/transitions. Matching uses the style, six directional bits and the exact second ring, and excludes buildings, roads, bridges, airstrips, cities and incomplete map neighborhoods.

The installed color assets feather their alpha over the inward 10-unit boundary strip. This lets the continuous ground remain the authority on shared edges and avoids seams between prefab and fallback tiles. This hybrid implementation retains ground generation; it does not yet reduce its CPU cost. Water images use paired unatlased masks and the existing world-coordinate water shader. Frames are cached across ordinary redraws and released on renderer destruction.

## Resource deduplication

The runtime manifest is version 2. Its entries keep all 1152 topology combinations; color and waterMask are references into the resources table, keyed by shared resource path. The table records kind, dimensions and SHA-256 of decoded RGBA pixels. Matching remains unchanged.

Installation feathers color alpha first, deduplicates exact RGBA buffers separately for colors and masks, omits masks whose red channel is entirely zero, preserves surviving UUIDs and unchanged PNG files, and removes only obsolete generated PNGs and matching metadata under the runtime target. Source artwork remains unchanged. Run node tests/TerrainTransitionRuntime.test.js to verify every installed combination against its source artwork.

Initial compaction: 1792 PNGs to 1420 (1101 colors and 319 active masks), 76691403 to 73424857 PNG bytes. There are 256 omitted inactive mask references. The renderer independently shares frame and mask loads by resource path, pairs them by both paths, and releases each owned asset once. Static entries do not wait for the water effect. This reduces asset count and storage, not underlying ground raster generation.
