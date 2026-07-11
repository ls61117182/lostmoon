# Main Gun Recoil Visual Design

## Goal

Add a light, realistic recoil animation whenever a unit fires its main gun. This is presentation-only and must not change hit resolution, damage, turn flow, multiplayer state, or any other combat logic.

## Scope

- Tanks with an independent turret sprite move only the turret backward and then return it to its normal position.
- Direct-fire units without an independent turret sprite, including the AT gun and StuG III, move the whole rendered unit backward and then return it.
- Heavy artillery and all foot units do not show recoil.
- Machine-gun fire does not show this recoil effect.
- The effect applies consistently to player, allied, and enemy main-gun fire routed through the shared battle presentation path.

## Trigger and Ownership

`BattleScene.playAttackFireCue(attacker, target, mg)` remains the shared presentation entry point. Its non-MG branch starts recoil at the same time as the cannon audio and muzzle flash.

The recoil implementation remains inside the view layer. Combat reports, attack legality, damage resolution, PVP actions, saved mission state, and unit data are not modified.

## Animation Model

Each active recoil stores the firing unit ID, the screen-space firing direction, elapsed time, and whether the rendered turret or whole unit should move.

The animation lasts approximately 0.23 seconds:

- Recoil phase: 0.07 seconds, moving rapidly from rest to the maximum rearward displacement.
- Recovery phase: 0.16 seconds, easing smoothly back to rest.
- Maximum displacement: about 6% of the current hex radius.

The displacement is opposite the screen-space direction from attacker to target. Repeated fire by the same unit restarts the effect from the new shot without stacking displacement.

The recoil offset is composed into the normal sprite placement code on every redraw. This avoids Cocos tweens fighting the battle scene's repeated node positioning and prevents pooled enemy sprite nodes from retaining another unit's animation.

## Unit Classification

Classification follows existing runtime and visual metadata instead of display names:

- A firing unit with a supported split hull/turret visual moves its turret sprite only.
- A non-foot firing unit with a main-gun visual but no independent turret moves its complete top sprite.
- `heavy_artillery` is explicitly excluded even though it has a cannon attack sound.
- Foot units are excluded through the existing foot-unit helper.
- Units without an eligible rendered sprite quietly skip the effect.

## Rendering Integration

The battle update loop advances recoil elapsed time and removes completed entries. Sprite placement reads the current recoil offset:

- Sherman and other split-turret renderers add it to the turret node position only.
- Top-sprite fixed-gun renderers add it to the complete sprite node position.
- Hull nodes of split-turret tanks remain stationary.

Map reload, battle teardown, and visual cleanup clear all active recoil state so no offset survives a scene transition. Destroyed or unavailable units also stop rendering recoil.

## Testing

Implementation will follow test-driven development:

1. A pure helper test covers the recoil curve at rest, maximum displacement, recovery, and completion.
2. Pure classification tests cover split-turret, fixed-gun, heavy-artillery, foot-unit, and ineligible unit cases.
3. Direction tests confirm displacement is opposite the firing vector and scales from hex size.
4. A focused BattleScene integration test confirms recoil starts only in the non-MG fire-cue branch and is applied to the appropriate render placement path.
5. Existing focused battle presentation tests and diff hygiene checks are rerun to detect regressions without relying on the noisy repository-wide TypeScript check.

## Acceptance Criteria

- Main-gun fire produces a short, light rearward recoil followed by a full visual return to rest.
- Independent-turret tanks move only their turret.
- AT guns, StuG III, and other eligible fixed-gun top sprites move as a whole.
- Heavy artillery, infantry, officers, and machine-gun fire show no recoil.
- Recoil direction matches the shot direction and works for player and AI fire.
- Repeated redraws, pooled enemy nodes, repeated shots, and scene cleanup leave no permanent displacement.
- No combat, synchronization, mission, or saved-state behavior changes.
