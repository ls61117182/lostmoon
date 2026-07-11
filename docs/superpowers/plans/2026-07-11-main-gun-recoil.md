# Main Gun Recoil Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add presentation-only light recoil for eligible main-gun fire, moving split turrets alone and fixed-gun top sprites as a whole.

**Architecture:** A pure `MainGunRecoil.ts` module owns eligibility, target mode, timing, and offset math. `BattleScene` owns active recoil state keyed by unit ID, starts it from the existing non-MG fire cue, advances it in `update(dt)`, and composes offsets into existing sprite placement without changing combat state.

**Tech Stack:** TypeScript, Cocos Creator 3.x nodes, Node `assert`, TypeScript `transpileModule` test harness.

## Global Constraints

- Recoil is visual-only and must not alter combat, multiplayer, mission, or saved state.
- Maximum displacement is 4% of hex radius; recoil lasts 0.05 seconds and recovery lasts 0.12 seconds.
- Split-turret units move only the turret; eligible fixed-gun units move the whole top sprite.
- Heavy artillery, foot units, machine-gun fire, and units without eligible visuals do not recoil.
- Preserve all unrelated dirty-worktree changes.

---

### Task 1: Pure recoil model

**Files:**
- Create: `assets/scripts/view/MainGunRecoil.ts`
- Create: `tests/MainGunRecoil.test.js`

**Interfaces:**
- Produces: `MainGunRecoilMode = 'turret' | 'whole'`
- Produces: `mainGunRecoilMode(kind, isFoot, hasSplitTurret, hasTopSprite): MainGunRecoilMode | null`
- Produces: `mainGunRecoilProgress(elapsed): number`
- Produces: `mainGunRecoilOffset(elapsed, hexSize, ux, uy): { x: number; y: number }`
- Produces constants `MAIN_GUN_RECOIL_BACK_TIME`, `MAIN_GUN_RECOIL_RETURN_TIME`, `MAIN_GUN_RECOIL_DISTANCE_RATIO`

- [ ] **Step 1: Write the failing pure-module test**

Create a Node test that transpiles the TypeScript module and asserts: split turret returns `turret`; StuG/AT-style top sprite returns `whole`; `heavy_artillery`, foot units, and missing sprites return `null`; progress is 0 at start, 1 at 0.05 seconds, between 0 and 1 during recovery, and 0 at 0.17 seconds; offset at peak equals `-ux/-uy * hexSize * 0.04`.

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/MainGunRecoil.test.js`

Expected: FAIL because `assets/scripts/view/MainGunRecoil.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure model**

Implement exact constants `0.05`, `0.12`, and `0.04`; use a fast outward easing during recoil and smooth recovery; explicitly exclude `heavy_artillery`; return finite screen offsets opposite `(ux, uy)`.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node tests/MainGunRecoil.test.js`

Expected: `Main-gun recoil tests passed`.

### Task 2: BattleScene trigger, state, and rendering composition

**Files:**
- Modify: `assets/scripts/view/BattleScene.ts`
- Create: `tests/BattleSceneMainGunRecoil.test.js`

**Interfaces:**
- Consumes all exports from Task 1.
- Produces: presentation-only `mainGunRecoils` map keyed by unit ID.
- Produces: `startMainGunRecoil(attacker, target)` and `mainGunRecoilOffsetFor(unit, mode)` helpers.

- [ ] **Step 1: Write the failing BattleScene integration test**

Assert the source imports the recoil helper, owns a recoil map, calls `startMainGunRecoil(attacker, target)` only inside the `!mg` branch of `playAttackFireCue`, advances/removes recoil entries from `update(dt)`, adds turret recoil only in split-turret placement, adds whole recoil in top-sprite placement, and clears state during mission reload/scene cleanup.

- [ ] **Step 2: Run the integration test and verify RED**

Run: `node tests/BattleSceneMainGunRecoil.test.js`

Expected: FAIL because the import/state/trigger are absent.

- [ ] **Step 3: Implement minimal BattleScene wiring**

Compute firing direction through the existing muzzle-position geometry, classify from `isFootUnit`, `isSplitTankKind`, and visual config availability, restart the firing unit's entry on each shot, advance elapsed time in `update(dt)`, and call `redraw()` while recoil is active. Compose the calculated offset into Sherman turret, pooled split turret, and eligible top-sprite positions; never mutate `Unit.pos`, facing, turret facing, or combat reports.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
node tests/MainGunRecoil.test.js
node tests/BattleSceneMainGunRecoil.test.js
node tests/BattleSceneInfantryFacing.test.js
node tests/MachineGunBurstOrder.test.js
```

Expected: all tests print their pass messages.

### Task 3: Final verification

**Files:**
- Verify only the files changed by Tasks 1 and 2 plus the plan.

- [ ] **Step 1: Run syntax and diff hygiene checks**

Run:

```powershell
node --check tests/MainGunRecoil.test.js
node --check tests/BattleSceneMainGunRecoil.test.js
git diff --check
```

Expected: all commands exit 0 with no new whitespace errors.

- [ ] **Step 2: Review scope**

Inspect `git diff -- assets/scripts/view/MainGunRecoil.ts assets/scripts/view/BattleScene.ts tests/MainGunRecoil.test.js tests/BattleSceneMainGunRecoil.test.js` and confirm the implementation only changes presentation state and rendering.

- [ ] **Step 3: Report completion without committing unrelated work**

Leave implementation changes unstaged unless the user separately asks for a commit. Report tests run, affected files, and any visual tuning value that may be adjusted later.
