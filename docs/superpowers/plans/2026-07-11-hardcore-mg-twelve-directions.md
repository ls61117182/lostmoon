# Hardcore Machine-Gun Twelve-Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow hardcore-mode machine-gun attacks along the same twelve exact firing rays and diagonal line-of-sight paths as main-gun attacks.

**Architecture:** Keep `canMGAttack` as the single legality owner. Select six- or twelve-direction geometry from the existing `AttackContext.expandedTurretDirections` flag, reusing `fireDirectionTo`, `isDiagonalFireDirection`, and `HexMap.hasDiagonalLineOfSight` without adding configuration or changing hit rules.

**Tech Stack:** TypeScript, Jest-style combat tests, Cocos Creator project sources.

## Global Constraints

- Classic mode remains limited to the original six axial rays.
- Machine-gun target type, range, hit calculation, crew gating, and independence from tank or turret facing remain unchanged.
- Do not modify unrelated dirty-worktree files.

---

### Task 1: Add twelve-direction machine-gun legality

**Files:**
- Modify: `tests/HexGrid.test.ts`
- Modify: `assets/scripts/core/Combat.ts:844`

**Interfaces:**
- Consumes: `canMGAttack(ctx: AttackContext)`, `AttackContext.expandedTurretDirections`, `fireDirectionTo`, `isDiagonalFireDirection`, `HexMap.hasDiagonalLineOfSight`.
- Produces: Mode-aware machine-gun legality through the existing `canMGAttack` return type.

- [x] **Step 1: Write the failing tests**

Import `canMGAttack`, create an infantry target on `{ q: 1, r: 1 }`, and assert that classic mode rejects it while `expandedTurretDirections: true` accepts it. Add two line-of-sight cases asserting one flanking forest does not block the diagonal ray but both flanking forests do.

- [x] **Step 2: Run the focused tests to verify RED**

Run: `npx jest tests/HexGrid.test.ts --runInBand -t "machine-gun"`

Expected: the hardcore halfway-ray legality assertion fails because `canMGAttack` returns `attack.reason.notStraight`.

- [x] **Step 3: Implement the minimal mode-aware geometry**

In `canMGAttack`, use `fireDirectionTo` only when `ctx.expandedTurretDirections` is enabled. Use `hasDiagonalLineOfSight` only for a recognized diagonal ray; retain `directionTo` and `hasLineOfSight` otherwise.

- [x] **Step 4: Run focused and related tests to verify GREEN**

Run: `npx jest tests/HexGrid.test.ts --runInBand`

Expected: all `HexGrid.test.ts` tests pass.

- [x] **Step 5: Run static diff checks**

Run: `git diff --check`

Expected: exit code 0 with no whitespace errors.
