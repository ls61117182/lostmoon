# Machine-Gun Clockwise Burst Design

## Goal

Change the machine-gun tracer presentation from randomly ordered scatter shots to a clockwise sweep around the selected target point while preserving the existing bullet impact-point generation rules.

## Scope

- Keep machine-gun legality, hit rolls, damage, audio, PVP synchronization, shot count, seeded randomness, spread angle, and impact offsets unchanged.
- Apply the presentation change to every caller of `BattleScene.spawnMachineGunBurst`.
- Change only the order in which the already-generated tracer endpoints are played.

## Design

Extract a pure helper that accepts generated endpoints and their original indices. It computes each endpoint's counterclockwise angle around the selected target center with `Math.atan2`. Endpoints are sorted by descending counterclockwise angle, so the endpoint with the greatest angle fires first and the sequence then moves clockwise. Equal angles retain their original shot order.

`BattleScene.drawMachineGunBurst` will generate all 15 endpoints with the current seeded formulas before drawing them, pass them through the helper, and use each sorted endpoint's original index for shot timing and per-shot seeded tracer styling. This preserves the exact endpoint set and visual random values while changing only playback order.

## Verification

- A pure Node test verifies descending counterclockwise-angle order.
- The test verifies equal-angle stability.
- The test verifies that sorting preserves the original endpoint objects and indices.
- Focused tests, syntax/transpile checks, and `git diff --check` verify integration.
