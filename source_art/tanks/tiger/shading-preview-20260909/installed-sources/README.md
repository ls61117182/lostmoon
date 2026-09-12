# Installed approved shading

User approved the shading preview. Turret RGB comes from that exact preview; hull and wreck receive its RGB lighting ratios with the turret body area excluded and feathered to a neutral hull value, avoiding a fixed turret-shaped shadow on a rotating tank. Original source alpha is preserved for all layers. No new geometry or generated replacement artwork was introduced.

Manifest processing, source pivot, muzzle and hatch coordinates are unchanged. All four installed PNGs were compared with before/: dimensions and every alpha byte match. Actual-size normal, hull and wreck images inspected. `pnpm run tank:validate` passed: 23 asset audits, 7 tests and TypeScript check. Cocos running-game visual inspection was not performed.

Automatic backup: asset_backups/latest/tiger/20260909_044638_before_tank_prepare. Local pre-shading PNG/meta/manifest copies are in before/.
