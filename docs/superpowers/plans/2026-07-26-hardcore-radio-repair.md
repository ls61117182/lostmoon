# Hardcore Radio Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configuration-driven repair system that lets hardcore players view and repair a damaged radio while enemies reuse the same priority.

**Architecture:** A core module owns repair component ids, status access, mode availability, and text metadata. BattleScene uses it for menus, player status, remote actions, and AI selection. `radioDamaged` remains the persisted state.

**Tech Stack:** TypeScript, Cocos Creator 3.8, Node assert tests.

## Global Constraints

- Preserve `Unit.radioDamaged` and save compatibility.
- Radio status and player radio repair are hardcore-only.
- Component priority: turret, mobility, radio.
- Existing terrain restrictions, PvP replay, floaters, and battle logs apply to every component.

---

### Task 1: Define repairable tank components

**Files:**
- Create: `assets/scripts/core/RepairableComponents.ts`
- Modify: `assets/scripts/core/LangDB.ts`
- Test: `tests/RepairableComponents.test.js`

**Interfaces:**
- Produces `RepairableComponentId = 'turret' | 'mobility' | 'radio'`.
- Produces `repairableComponentsFor(mode, unit)` and `firstDamagedRepairableComponent(mode, unit)`.
- Each component includes `isDamaged`, `repair`, `playerAvailable`, and localization keys.

- [ ] **Step 1:** Write `tests/RepairableComponents.test.js` with assertions that canonical ids are `['turret', 'mobility', 'radio']`, classic excludes radio, hardcore includes radio, and the first damaged item follows configured ordering.
- [ ] **Step 2:** Run `node tests/RepairableComponents.test.js`; expect failure because the module is absent.
- [ ] **Step 3:** Create the module with this public surface:

```ts
export type RepairableComponentId = 'turret' | 'mobility' | 'radio';
export const REPAIRABLE_COMPONENT_IDS: RepairableComponentId[] = ['turret', 'mobility', 'radio'];
export function repairableComponentsFor(mode: GameMode, unit: Unit): RepairableComponent[];
export function firstDamagedRepairableComponent(mode: GameMode, unit: Unit): RepairableComponent | null;
```

Add action, floater, log, intact, and damaged radio translations in `LangDB.ts`.
- [ ] **Step 4:** Run `node tests/RepairableComponents.test.js`; expect success.
- [ ] **Step 5:** Commit only these files with `feat: add repairable component configuration`.

### Task 2: Drive player repair and status through configuration

**Files:**
- Modify: `assets/scripts/view/BattleScene.ts`
- Test: `tests/BattleSceneRadioRepair.test.js`

**Interfaces:**
- Consumes `RepairableComponentId` and `repairableComponentsFor`.
- Extends PvP `repairTarget` to `RepairableComponentId`.
- Changes `tryRepair(dieIdx: number, target: RepairableComponentId)` to use the configuration.

- [ ] **Step 1:** Write source-level assertions in `tests/BattleSceneRadioRepair.test.js` requiring the repair popover to iterate `repairableComponentsFor(GameSession.gameMode, sherman)`, `tryRepair` to use `RepairableComponentId`, and hardcore status to render intact radio text.
- [ ] **Step 2:** Run `node tests/BattleSceneRadioRepair.test.js`; expect failure because the menu and status collector use direct branches.
- [ ] **Step 3:** Replace fixed turret/mobility menu entries with:

```ts
for (const component of repairableComponentsFor(GameSession.gameMode, sherman)) {
  if (component.isDamaged(sherman)) {
    addItem(t(component.actionKey), PHASE_BTN_MISC, () => this.tryRepair(idx, component.id), repairBlocked);
  }
}
```

Apply repair, remote PvP replay, floater, and battle-log text through the selected component metadata. In the player status collector, show the radio component as intact or damaged only in hardcore.
- [ ] **Step 4:** Run `node tests/BattleSceneRadioRepair.test.js`; expect success.
- [ ] **Step 5:** Commit only BattleScene and its test with `feat: support configured player tank repairs`.

### Task 3: Reuse component ordering for enemy AI

**Files:**
- Modify: `assets/scripts/view/BattleScene.ts`
- Modify: `tests/enemyHardcoreTankDice.test.js`
- Test: `tests/RepairableComponents.test.js`
- Test: `tests/BattleSceneRadioRepair.test.js`

**Interfaces:**
- Consumes `firstDamagedRepairableComponent(GameSession.gameMode, enemy)`.
- AI repairs its returned component before the existing fire-reduction fallback.

- [ ] **Step 1:** Add assertions that the AI uses `firstDamagedRepairableComponent(GameSession.gameMode, enemy)` and no longer assigns `enemy.radioDamaged = false` directly.
- [ ] **Step 2:** Run `node tests/enemyHardcoreTankDice.test.js`; expect failure due to the direct radio branch.
- [ ] **Step 3:** Replace AI component branches with:

```ts
const component = firstDamagedRepairableComponent(GameSession.gameMode, enemy);
if (component) {
  component.repair(enemy);
  repaired = true;
} else if ((enemy.fireLevel ?? 0) > 0) {
  enemy.fireLevel = Math.max(0, (enemy.fireLevel ?? 0) - 1);
  repaired = true;
}
```

- [ ] **Step 4:** Run `node tests/RepairableComponents.test.js; node tests/BattleSceneRadioRepair.test.js; node tests/enemyHardcoreTankDice.test.js; npx tsc --noEmit`; expect all commands to exit 0.
- [ ] **Step 5:** Commit only related code and tests with `refactor: share tank repair priorities with AI`.
