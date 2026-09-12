# T-34/85 geometry authority

User revision: use second supplied drawing. Plan crop original x=170 y=174 w=325 h=123; uniformly enlarged 4x. Hull crop x=350 y=14 w=942 h=460. Turret pivot plan (748,245), hull-local (398,231). Muzzle (20,246). Commander cupola (769,289), vehicle-left (screen bottom). Three external cylindrical fuel tanks: two screen top rear fender, one screen bottom rear fender. Bow MG screen top on front glacis. No added front brackets. Turret silhouette traced from plan; only occluded hull area filled.

Selected colorized layers were uniformly registered by blueprint length (hull 942 px, turret with gun 934 px). Selected hull is 942x449; turret 934x319. Final common scale 0.15, 1px padding. Actual selected ring centers: hull (410,226), turret (728,163); muzzle (1,163); commander cupola (755,212). Source preview places hull at (318,0), turret at (0,63). Final hull/destroyed canvases 143x69 with identical alpha; turret 142x50. The generated colorization has slight local deviations from the blueprint, so source pixel coordinates were measured again on selected layers.

Validation: tank:validate passed (21 asset sets, 7 tests, TypeScript). Cocos interactive play inspection not performed. New unit uses provisional T-34/76 combat values with five crew, recorded explicitly in units.csv.

Soviet green revision: transfer palette only from built-in imagegen reference. Original detail and alpha preserved. All four formal PNG dimensions, alpha channels and Cocos metadata verified identical to previous version. prepare-sources.cjs applies the color transform after source normalization, so regeneration retains Soviet green.
