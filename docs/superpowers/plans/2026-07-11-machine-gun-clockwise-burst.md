# Machine-Gun Clockwise Burst Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play existing machine-gun scatter endpoints from the greatest counterclockwise angle downward so the tracers sweep clockwise around the selected target.

**Architecture:** Add a Cocos-independent pure helper for angular ordering, covered by a direct Node test. Keep endpoint generation in `BattleScene.ts`, but generate the complete old endpoint set before drawing and consume it in the helper's stable clockwise order.

**Tech Stack:** TypeScript, Cocos Creator 3.8, Node.js `assert`, TypeScript `transpileModule`

## Global Constraints

- Do not change combat rules, hit or damage outcomes, audio, PVP synchronization, shot count, seeded randomness, spread angle, or impact-offset formulas.
- The endpoint with the greatest counterclockwise angle around the selected target center fires first.
- Equal-angle endpoints retain their original shot order.

---

### Task 1: Clockwise machine-gun endpoint ordering

**Files:**
- Create: `assets/scripts/view/MachineGunBurstOrder.ts`
- Create: `assets/scripts/view/MachineGunBurstOrder.ts.meta`
- Create: `tests/MachineGunBurstOrder.test.js`
- Modify: `assets/scripts/view/BattleScene.ts:5147`

**Interfaces:**
- Consumes: endpoint objects containing `x`, `y`, and `shotIndex`, plus target-center coordinates.
- Produces: `orderMachineGunBurstEndpointsClockwise<T extends MachineGunBurstEndpoint>(endpoints: readonly T[], centerX: number, centerY: number): T[]`.

- [ ] **Step 1: Write the failing pure-helper test**

Create a Node test that transpiles `MachineGunBurstOrder.ts`, loads `orderMachineGunBurstEndpointsClockwise`, and asserts this order:

```js
const endpoints = [
  { x: 0, y: -1, shotIndex: 0 },
  { x: 1, y: 0, shotIndex: 1 },
  { x: 0, y: 1, shotIndex: 2 },
  { x: -1, y: 0, shotIndex: 3 },
];
assert.deepStrictEqual(
  orderMachineGunBurstEndpointsClockwise(endpoints, 0, 0).map(point => point.shotIndex),
  [3, 2, 1, 0],
);
```

Also assert equal-angle ordering by `shotIndex` and object-identity preservation.

- [ ] **Step 2: Run the test to verify RED**

Run: `node tests/MachineGunBurstOrder.test.js`

Expected: FAIL because `assets/scripts/view/MachineGunBurstOrder.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure helper**

Create the module with this contract:

```ts
export interface MachineGunBurstEndpoint {
  x: number;
  y: number;
  shotIndex: number;
}

export function orderMachineGunBurstEndpointsClockwise<T extends MachineGunBurstEndpoint>(
  endpoints: readonly T[],
  centerX: number,
  centerY: number,
): T[] {
  return [...endpoints].sort((a, b) => {
    const angleDelta = Math.atan2(b.y - centerY, b.x - centerX)
      - Math.atan2(a.y - centerY, a.x - centerX);
    return Math.abs(angleDelta) > 1e-12 ? angleDelta : a.shotIndex - b.shotIndex;
  });
}
```

Add the normal Cocos `.ts.meta` companion.

- [ ] **Step 4: Run the helper test to verify GREEN**

Run: `node tests/MachineGunBurstOrder.test.js`

Expected: PASS with `Machine-gun burst ordering tests passed`.

- [ ] **Step 5: Integrate the helper without changing endpoint generation**

Import the helper in `BattleScene.ts`. In `drawMachineGunBurst`, build the existing 15 endpoints with the same `seededUnit`, `maxScatterAngle`, `maxPerp`, `endPerp`, and `endForward` formulas. Sort the generated array around `{ x: b.targetX, y: b.targetY }`. Draw in sorted sequence order, while using each endpoint's original `shotIndex` for seeded tail/fade values and the sequence index for `shotStart` timing.

- [ ] **Step 6: Run focused and integration verification**

Run:

```powershell
node tests/MachineGunBurstOrder.test.js
node tests/BattleSceneInfantryFacing.test.js
git diff --check
```

Expected: both tests PASS and `git diff --check` exits 0 with no output.

- [ ] **Step 7: Commit the implementation**

```powershell
git add assets/scripts/view/MachineGunBurstOrder.ts assets/scripts/view/MachineGunBurstOrder.ts.meta assets/scripts/view/BattleScene.ts tests/MachineGunBurstOrder.test.js
git commit -m "feat: sweep machine gun tracers clockwise"
```
