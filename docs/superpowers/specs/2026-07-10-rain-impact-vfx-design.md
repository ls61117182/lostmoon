# Rain Impact VFX Design

## Goal

Replace the current evenly spaced, endlessly scrolling rain lines with a lightweight top-down rain effect. Each drop must appear independently, fall a short distance almost vertically, hit the ground, create a small splash, and disappear.

This is a presentation-only change. Existing mission weather rules, combat modifiers, vision modifiers, and HUD text remain unchanged.

## Scope

- The first version covers the full battle viewport.
- Rain and splashes render below the HUD.
- Restricting impacts to hex-map terrain is deferred until the full-screen effect is visually approved.
- No particle textures, particle-system components, or per-drop scene nodes are introduced.

## Rendering Model

Use the existing `WeatherEffectLayer` and one `Graphics` component. Maintain 56 procedural rain slots. A slot does not represent a permanently visible line; it independently cycles through idle, falling, and splash phases.

All variation is generated from deterministic hashes of the slot index and cycle number. This gives random-looking distribution without per-frame allocation or unstable calls to `Math.random()`.

Rain lines and splash marks are accumulated into batched paths. The implementation should use a small, fixed number of `fill()` and `stroke()` calls per frame rather than one call per drop.

## Drop Lifecycle

Each slot receives independently varied timing and geometry:

- Idle delay: randomized so slots do not start in rows or waves.
- Fall distance: approximately 50 to 90 pixels.
- Fall speed: approximately 700 to 1000 pixels per second.
- Fall duration: derived from distance divided by speed, typically approximately 0.05 to 0.13 seconds.
- Streak length: approximately 12 to 22 pixels.
- Splash duration: approximately 0.12 to 0.18 seconds.

At the end of the fall phase, the streak disappears immediately and the splash begins at the impact point. After the splash fades, the slot enters a newly randomized cycle with a new position and timing.

## Direction And Randomness

The camera is a 90-degree top-down view, so streaks should be nearly vertical. Horizontal travel should be only 2% to 6% of vertical travel, producing an angle close to 90 degrees. A shared wind direction keeps the rain coherent while small per-drop variation prevents exact parallel duplication.

Impact positions, phase offsets, fall distances, streak lengths, opacity, and splash sizes vary independently. The distribution must not form visible rows, columns, or synchronized groups.

## Splash Appearance

The splash is a small top-down mark rather than a side-view crown:

- A thin circular ripple expands from roughly 1.5 to 6 pixels.
- Two or three short radial droplets briefly expand outward.
- Alpha fades to zero over the splash phase.
- Splash geometry disappears completely before the slot is reused.

The effect remains subtle enough not to hide units, terrain, objectives, or combat feedback.

## Performance

- Fixed pool of 56 logical slots.
- No node creation or destruction during gameplay.
- No per-frame arrays or temporary particle objects.
- Deterministic arithmetic only for slot state and geometry.
- Batched rain and splash drawing through the existing `Graphics` layer.

## Verification

Focused tests should protect these behaviors:

- Slots use independent deterministic cycle timing and positions.
- Fall distance is finite; rain does not traverse the viewport endlessly.
- Horizontal displacement stays within 2% to 6% of vertical displacement.
- Every falling phase transitions into a splash phase.
- Splash radius expands while opacity decreases.
- Drawing remains batched rather than issuing one stroke per drop.
- Existing weather gameplay and map-input tests continue to pass.

## Acceptance Criteria

- No visible rows of evenly spaced rain lines.
- Rain streaks are nearly vertical in the top-down view.
- Each streak falls quickly over a short distance and disappears at impact.
- Small water splashes appear at impact points and fade naturally.
- The full-screen effect remains readable but does not obscure the HUD or board state.
- Frame cost remains comparable to the current fixed-count `Graphics` effect.
