# Infantry Visual Facing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make infantry squads and officers face their latest movement or attack direction without changing gameplay-facing state.

**Architecture:** Add a small pure presentation helper that converts projected hex directions into calibrated Cocos sprite angles. `BattleScene` owns a per-unit visual-facing map, updates it at shared movement and attack presentation choke points, and applies it to battlefield and tile-inspect sprites.

**Tech Stack:** TypeScript, Cocos Creator 3.x, Node.js assertion tests.

## Global Constraints

- Apply to regular, Japanese, and American infantry plus officers.
- Keep the change presentation-only; never write visual direction into `Unit.facing`.
- Do not add or alter infantry movement animation in this change.
- All three sprites in an infantry squad use the same angle.

---

### Task 1: Pure infantry-facing geometry

**Files:**
- Create: `assets/scripts/view/InfantryVisualFacing.ts`
- Create: `tests/InfantryVisualFacing.test.js`

**Interfaces:**
- Consumes: `Axial`, `Direction`, `axialToPixel`, and `directionTo` from existing core modules.
- Produces: `infantryVisualDirection(from: Axial, to: Axial): Direction | null` and `infantrySpriteAngle(direction: Direction): number`.

- [ ] **Step 1: Write the failing test**

Create a Node assertion test which compiles the focused helper with `tsc`, imports it, and checks: identical points return `null`; each adjacent hex resolves to its direction index; the six returned sprite angles follow the projected direction and use the source artwork's downward-facing baseline.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/InfantryVisualFacing.test.js`

Expected: FAIL because `assets/scripts/view/InfantryVisualFacing.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Implement direction resolution with `directionTo(from, to)` and `approximateDirection(from, to)` fallback. Compute the screen heading from `axialToPixel({q: 0, r: 0}, 1)` to `axialToPixel(HEX_DIRECTIONS[direction], 1)`, convert radians to Cocos degrees, and subtract the calibrated downward-facing artwork baseline. Normalize the result to `[-180, 180]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/InfantryVisualFacing.test.js`

Expected: PASS with `Infantry visual facing tests passed`.

- [ ] **Step 5: Commit**

```powershell
git add assets/scripts/view/InfantryVisualFacing.ts tests/InfantryVisualFacing.test.js
git commit -m "test: define infantry visual facing geometry"
```

### Task 2: BattleScene visual-facing lifecycle and rendering

**Files:**
- Modify: `assets/scripts/view/BattleScene.ts`
- Create: `tests/BattleSceneInfantryFacing.test.js`
- Test: `tests/BattleSceneJapaneseInfantryVisuals.test.js`
- Test: `tests/AmericanInfantryConfig.test.js`

**Interfaces:**
- Consumes: `infantryVisualDirection(...)` and `infantrySpriteAngle(...)` from Task 1.
- Produces: `private infantryVisualFacing = new Map<string, Direction>()`, `private setInfantryVisualFacing(unit: Unit, target: Axial): void`, and `private infantryVisualAngle(unit: Unit): number`.

- [ ] **Step 1: Write the failing BattleScene integration test**

Add source-focused assertions that require a per-unit map, a helper gated by `isFootUnit`, movement-facing updates before a `move` animation starts, attack-facing updates at the shared fire-cue path, application to all infantry squad nodes and the officer node, tile-inspect application, and no assignment from visual-facing code to `unit.facing`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/BattleSceneInfantryFacing.test.js`

Expected: FAIL because the map and integration helpers are absent.

- [ ] **Step 3: Add state and rendering integration**

Import the Task 1 helper. Add the visual-facing map and clear it beside the existing scene/unit visual reset. Implement `setInfantryVisualFacing` to ignore non-foot units and same-position actions. Implement `infantryVisualAngle` with precedence: map value, `unit.facing`, then angle `0`. Pass the resulting angle into `drawInfantry`; assign it to the officer Sprite and each of the three squad Sprite nodes. Apply the same angle when adding foot-unit sprites to tile inspect.

- [ ] **Step 4: Connect movement and attack events**

At every shared `move` animation creation/queue point, call the facing helper before animation playback when the mover is a foot unit. At the shared attack presentation choke point that has both attacker and target, record the attacker-facing direction before muzzle/audio/dice presentation. Preserve existing animation, combat, save, and PVP payload behavior.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node tests/BattleSceneInfantryFacing.test.js
node tests/InfantryVisualFacing.test.js
node tests/BattleSceneJapaneseInfantryVisuals.test.js
node tests/AmericanInfantryConfig.test.js
```

Expected: all four commands exit 0 and print their pass messages.

- [ ] **Step 6: Run repository checks**

Run:

```powershell
git diff --check
node --check tests/BattleSceneInfantryFacing.test.js
node --check tests/InfantryVisualFacing.test.js
```

Expected: all commands exit 0 with no syntax or whitespace errors.

- [ ] **Step 7: Commit**

```powershell
git add assets/scripts/view/BattleScene.ts tests/BattleSceneInfantryFacing.test.js
git commit -m "feat: face infantry toward movement and attacks"
```
