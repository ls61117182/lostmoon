# PVP Faction Infantry Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make newly created PVP battles use American infantry for the USA faction and Japanese infantry for the Japan faction while preserving German infantry behavior.

**Architecture:** Keep the server's initial PVP battle snapshot as the authority. Extend its existing `pvpSupportKind(factionId)` mapping and protect the three supported faction branches with a source-level regression test that exercises the real server helper in an isolated VM context.

**Tech Stack:** Node.js, CommonJS server code, built-in `assert`, built-in `vm`, repository JavaScript tests.

## Global Constraints

- Only new PVP battle initial state generation changes.
- USA maps to `american_infantry`.
- Japan maps to `japanese_infantry`.
- Germany continues to map to `infantry`.
- Do not modify single-player missions, unit data, client display logic, saved or active PVP snapshots, or the network protocol.

---

### Task 1: Correct the authoritative server support-unit mapping

**Files:**
- Create: `tests/PvpFactionInfantryMapping.test.js`
- Modify: `server/server.js:293-296`

**Interfaces:**
- Consumes: `pvpSupportKind(factionId: string): string` in `server/server.js`.
- Produces: USA, Japan, and Germany mappings used by `createInitialPvpBattleState(match)` for both support-unit slots.

- [ ] **Step 1: Write the failing mapping test**

Create `tests/PvpFactionInfantryMapping.test.js`. Read `server/server.js`, extract the `pvpSupportKind` function declaration, evaluate that declaration in a new `vm` context, and assert the three faction results:

```js
const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

const serverSource = fs.readFileSync('server/server.js', 'utf8');
const match = serverSource.match(/function pvpSupportKind\(factionId\) \{[\s\S]*?\n\}/);
assert(match, 'server pvpSupportKind() should exist');

const context = {};
vm.runInNewContext(`${match[0]}; this.pvpSupportKind = pvpSupportKind;`, context);

assert.strictEqual(context.pvpSupportKind('usa'), 'american_infantry');
assert.strictEqual(context.pvpSupportKind('japan'), 'japanese_infantry');
assert.strictEqual(context.pvpSupportKind('germany'), 'infantry');

console.log('PVP faction infantry mapping test passed');
```

- [ ] **Step 2: Run the test and verify the USA assertion fails**

Run: `node tests/PvpFactionInfantryMapping.test.js`

Expected: FAIL because the current server mapping returns `infantry` for `usa` instead of `american_infantry`.

- [ ] **Step 3: Add the minimal USA mapping**

Change the server helper to:

```js
function pvpSupportKind(factionId) {
  if (factionId === "japan") return "japanese_infantry";
  if (factionId === "usa") return "american_infantry";
  return "infantry";
}
```

- [ ] **Step 4: Run focused and related tests**

Run:

```powershell
node tests/PvpFactionInfantryMapping.test.js
node tests/AmericanInfantryConfig.test.js
node --check server/server.js
git diff --check
```

Expected: every command exits with code 0; both tests print their pass messages; syntax and whitespace checks produce no errors.

- [ ] **Step 5: Review the scoped diff and commit**

Run:

```powershell
git diff -- server/server.js tests/PvpFactionInfantryMapping.test.js docs/superpowers/plans/2026-07-11-pvp-faction-infantry.md
git add -- server/server.js tests/PvpFactionInfantryMapping.test.js docs/superpowers/plans/2026-07-11-pvp-faction-infantry.md
git diff --cached --check
git commit -m "fix: map PVP infantry by faction"
```

Expected: the commit contains only the server mapping, its regression test, and this implementation plan.
