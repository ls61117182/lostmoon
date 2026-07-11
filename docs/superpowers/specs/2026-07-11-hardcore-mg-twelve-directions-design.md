# Hardcore Machine-Gun Twelve-Direction Design

## Goal

In hardcore mode, allow machine-gun attacks along the same twelve hex-grid firing rays already supported by turreted main-gun attacks. Classic mode remains limited to the original six axial rays.

## Scope

- Change only machine-gun target legality and line-of-sight handling.
- Reuse the existing `expandedTurretDirections` mode flag and the existing twelve-direction geometry.
- Preserve machine-gun target type, range, hit calculation, crew gating, and independence from tank or turret facing.
- Preserve all current classic-mode behavior.

## Design

`canMGAttack` will select its firing ray using the same mode-aware geometry used by main-gun legality:

- When `expandedTurretDirections` is disabled, use `directionTo` and normal `hasLineOfSight`.
- When `expandedTurretDirections` is enabled, use `fireDirectionTo`. For one of the six diagonal firing rays, use `hasDiagonalLineOfSight`; otherwise use normal `hasLineOfSight`.
- Targets outside all twelve exact firing rays remain illegal with `attack.reason.notStraight`.

Unlike fixed main guns, machine guns will not gain a hull- or turret-facing restriction. The requested change expands legal attack rays only.

## Testing

Add focused combat tests proving:

1. A halfway-ray infantry target remains illegal in classic mode.
2. The same target is legal when hardcore's `expandedTurretDirections` flag is enabled.
3. Hardcore diagonal machine-gun fire uses the existing two-flank line-of-sight rule: one blocking flank remains legal, while both blocking flanks produce `attack.reason.blocked`.
4. Existing main-gun twelve-direction tests continue to pass.
