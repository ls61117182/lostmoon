# Shading approval preview

Preview only: no game assets or configuration replaced.

The image generator produced a lighting study from the current assembled-source.png and the user's shadow reference. Its geometry drifted slightly, so only the registered low-frequency illumination field was transferred onto original RGB pixels using transfer-shading.cjs. The final tiger-shading-preview.png retains original canvas, all alpha values, and original dark line pixels (mean RGB <= 35) exactly. The reference controls lighting only, not tank geometry.

Checks: alphaChanges=0, inkChanges=0. Actual hull length is approximately 150 pixels in after-small.png. small-comparison.png shows before above and after below, enlarged with nearest-neighbor sampling.

Pending user approval. Future split-layer integration must handle hull/turret shading separately so turret shadows do not remain fixed on the hull during rotation.
