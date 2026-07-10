# Machine-Gun Clockwise Burst Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play existing machine-gun scatter endpoints from the greatest lateral offset downward so the tracers sweep from the counterclockwise side toward the clockwise side.

**Architecture:** Add a Cocos-independent pure helper for lateral-offset ordering, covered by a direct Node test. Keep endpoint generation in `BattleScene.ts`, but generate the complete old endpoint set before drawing and consume it from the counterclockwise side toward the clockwise side.

**Tech Stack:** TypeScript, Cocos Creator 3.8, Node.js `assert`, TypeScript `transpileModule`

## Global Constraints

- Do not change combat rules, hit or damage outcomes, audio, PVP synchronization, shot count, seeded randomness, spread angle, or impact-offset formulas.
- The endpoint with the greatest lateral offset on the counterclockwise side of the firing direction fires first.
- Equal-offset endpoints retain their original shot order.

---

### Task 1: Clockwise machine-gun endpoint ordering

**Files:**
- Create: `assets/scripts/view/MachineGunBurstOrder.ts`
- Create: `assets/scripts/view/MachineGunBurstOrder.ts.meta`
- Create: `tests/MachineGunBurstOrder.test.js`
- Modify: `assets/scripts/view/BattleScene.ts:5147`

**Interfaces:**
- Consumes: endpoint objects containing `lateralOffset` and `shotIndex`.
- Produces: `orderMachineGunBurstEndpointsByLateralOffset<T extends MachineGunBurstEndpoint>(endpoints: readonly T[]): T[]`.

- [ ] **Step 1: Write the failing pure-helper test**

Create a Node test that transpiles `MachineGunBurstOrder.ts`, loads `orderMachineGunBurstEndpointsByLateralOffset`, and asserts this order:

```js
const endpoints = [
  { lateralOffset: -4, shotIndex: 0 },
  { lateralOffset: 3, shotIndex: 1 },
  { lateralOffset: 7, shotIndex: 2 },
  { lateralOffset: 0, shotIndex: 3 },
];
assert.deepStrictEqual(
  orderMachineGunBurstEndpointsByLateralOffset(endpoints).map(point => point.shotIndex),
  [2, 1, 3, 0],
);
```

Also assert equal-offset ordering by `shotIndex` and object-identity preservation.

- [ ] **Step 2: Run the test to verify RED**

Run: `node tests/MachineGunBurstOrder.test.js`

Expected: FAIL because `assets/scripts/view/MachineGunBurstOrder.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure helper**

Create the module with this contract:

```ts
export interface MachineGunBurstEndpoint {
  lateralOffset: number;
  shotIndex: number;
}

export function orderMachineGunBurstEndpointsByLateralOffset<T extends MachineGunBurstEndpoint>(
  endpoints: readonly T[],
): T[] {
  return [...endpoints].sort((a, b) =>
    b.lateralOffset - a.lateralOffset || a.shotIndex - b.shotIndex,
  );
}
```

Add the normal Cocos `.ts.meta` companion.

- [ ] **Step 4: Run the helper test to verify GREEN**

Run: `node tests/MachineGunBurstOrder.test.js`

Expected: PASS with `Machine-gun burst ordering tests passed`.

- [ ] **Step 5: Integrate the helper without changing endpoint generation**

Import the helper in `BattleScene.ts`. In `drawMachineGunBurst`, build the existing 15 endpoints with the same `seededUnit`, `maxScatterAngle`, `maxPerp`, `endPerp`, and `endForward` formulas. Store `endPerp` as `lateralOffset`, sort the generated array descending by that value, and draw in sorted sequence order. Use each endpoint's original `shotIndex` for seeded styling and the sequence index for `shotStart` timing.

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
