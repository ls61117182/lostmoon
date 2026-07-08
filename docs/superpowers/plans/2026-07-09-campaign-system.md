# Campaign System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first version of the Sherman campaign system: four Pacific campaigns, each made of three stitched and sequentially activated copied mission segments.

**Architecture:** Add campaign metadata and pure helper code first, then wire menu selection through `GameSession`, and finally adapt `BattleScene` to load a stitched campaign map, draw future-segment shadow, advance segments, and mark final completion. Keep original single-mission Pacific behavior untouched by using copied campaign mission resources and a separate campaign chapter id.

**Tech Stack:** Cocos Creator 3.8 TypeScript, existing `resources` JSON loading, existing dynamic UI in `MainMenuScene.ts`, pure Node-based regression tests in `tests/*.js`.

## Global Constraints

- New tab order is Europe, Pacific, Campaign, then existing later tabs.
- Campaign tab initially contains exactly four visible campaign names: `塔拉瓦红滩1`, `塞班岛`, `塔拉瓦红滩2`, `贝里琉`.
- Original `assets/resources/missions/mission_pacific_01..12.json` resources must remain selectable from the Pacific tab.
- Campaign segment resources must be copied into an independent campaign-specific mission folder.
- Only the third segment completion is final victory.
- Any defeat restarts the campaign from segment 0 on the next attempt.
- Inter-segment Sherman carry-forward: crew, facing, turretFacing, loaded, hatchOpen.
- Inter-segment Sherman clear: fireLevel, paralyzed, turretDamaged, radioDamaged, smoke state.
- Inter-segment visionRange is recomputed from the next segment start configuration and unit defaults.
- Future segment terrain is visible under a shadow darker than normal fog; future segment units and turn-end events do not exist until activation.
- No PVP campaign mode, no mid-campaign save/resume, no branching campaigns, no reward/repair/supply system in this version.
- Prefer focused tests and probes; whole-project `tsc --noEmit` is low-signal in this checkout.

---

## File Structure

- Create `assets/scripts/core/CampaignDB.ts`: campaign metadata types, the four campaign definitions, and lookup helpers.
- Create `assets/scripts/core/CampaignRuntime.ts`: pure helpers for translating mission data, stitching segment maps, selecting active segment data, and applying inter-segment Sherman state rules.
- Modify `assets/scripts/core/types.ts`: no planned schema change; use existing `MissionData.eventTableId` for campaign segment event-table routing.
- Modify `assets/scripts/core/LevelDB.ts`: add campaign chapter and campaign `LevelMeta` entries.
- Modify `assets/scripts/core/GameSession.ts`: add campaign selection state and reset behavior.
- Modify `data/lang.csv` and generated `assets/scripts/core/LangDB.ts`: add campaign tab and campaign title keys.
- Modify `assets/scripts/view/MainMenuScene.ts`: route campaign entries to `GameSession.selectCampaign(...)`.
- Modify `assets/scripts/view/BattleScene.ts`: load campaigns, draw campaign shadow, wrap outcome handling, advance segments, and run map-pan transition.
- Create `assets/resources/campaigns/pacific_campaigns.json`: resource representation of the four campaigns if runtime loading uses resources; keep it aligned with `CampaignDB.ts`.
- Create `assets/resources/missions/campaign_pacific/*.json`: 12 copied campaign segment mission resources.
- Create `tests/campaignDB.test.js`: verifies campaign metadata, LevelDB chapter wiring, original Pacific paths, and localization keys.
- Create `tests/campaignRuntime.test.js`: verifies map stitching, active segment unit isolation, and inter-segment Sherman state rules.
- Create `tests/campaignResourceCopies.test.js`: verifies copied campaign mission resources exist, have independent ids, and are not the same paths as original Pacific missions.

---

### Task 1: Campaign Metadata, Chapter Wiring, And Menu Progress

**Files:**
- Create: `assets/scripts/core/CampaignDB.ts`
- Modify: `assets/scripts/core/LevelDB.ts`
- Modify: `assets/scripts/core/GameSession.ts`
- Test: `tests/campaignDB.test.js`

**Interfaces:**
- Produces:
  - `CAMPAIGN_CHAPTER_ID: 'campaign'`
  - `CampaignDefinition`
  - `CAMPAIGNS: CampaignDefinition[]`
  - `getCampaign(id: string): CampaignDefinition | undefined`
  - `GameSession.selectCampaign(levelId: number, campaignId: string): void`
  - `GameSession.selectedCampaignId: string | null`
  - `GameSession.isCampaign: boolean`
- Consumes: existing `ChapterMeta`, `LevelMeta`, `MenuProgress`, and `GameSession` state.

- [ ] **Step 1: Write the failing metadata and progress test**

Create `tests/campaignDB.test.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(repo, rel), 'utf8');
}

function assertContains(file, text) {
  const body = read(file);
  assert(
    body.includes(text),
    `${file} should contain ${text}`,
  );
}

function assertNotContainsInPacificBlock() {
  const body = read('assets/scripts/core/LevelDB.ts');
  const pacificStart = body.indexOf("id: 'pacific'");
  const testStart = body.indexOf("id: 'test'");
  assert(pacificStart >= 0, 'LevelDB should still contain pacific chapter');
  assert(testStart > pacificStart, 'LevelDB test chapter should follow pacific');
  const pacificBlock = body.slice(pacificStart, testStart);
  assert(!pacificBlock.includes('campaign_pacific'), 'Pacific chapter must not point to campaign resources');
  for (let i = 1; i <= 12; i++) {
    const nn = String(i).padStart(2, '0');
    assert(
      pacificBlock.includes(`missions/mission_pacific_${nn}`),
      `Pacific chapter should keep mission_pacific_${nn}`,
    );
  }
}

assertContains('assets/scripts/core/CampaignDB.ts', "export const CAMPAIGN_CHAPTER_ID = 'campaign'");
assertContains('assets/scripts/core/CampaignDB.ts', "id: 'tarawa_red_beach_1'");
assertContains('assets/scripts/core/CampaignDB.ts', "titleKey: 'campaign.tarawaRedBeach1.title'");
assertContains('assets/scripts/core/CampaignDB.ts', "id: 'saipan'");
assertContains('assets/scripts/core/CampaignDB.ts', "id: 'tarawa_red_beach_2'");
assertContains('assets/scripts/core/CampaignDB.ts', "id: 'peleliu'");
assertContains('assets/scripts/core/LevelDB.ts', "id: CAMPAIGN_CHAPTER_ID");
assertContains('assets/scripts/core/LevelDB.ts', "entryKind: 'campaign'");
assertContains('assets/scripts/core/GameSession.ts', 'selectCampaign(levelId: number, campaignId: string)');
assertContains('assets/scripts/core/GameSession.ts', 'get isCampaign()');
assertNotContainsInPacificBlock();

console.log('campaignDB tests passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node tests/campaignDB.test.js
```

Expected: FAIL with a missing file or missing text for `CampaignDB.ts`.

- [ ] **Step 3: Add campaign metadata**

Create `assets/scripts/core/CampaignDB.ts`:

```ts
import type { ChapterId } from './LevelDB';

export const CAMPAIGN_CHAPTER_ID = 'campaign' as const;

export interface CampaignSegmentDefinition {
  id: string;
  missionPath: string;
  sourcePacificMissionId: string;
}

export interface CampaignDefinition {
  id: string;
  order: number;
  levelId: number;
  titleKey: string;
  missionId: string;
  transitionSeconds: number;
  stitchDirection: 'horizontal';
  segments: CampaignSegmentDefinition[];
}

export const CAMPAIGNS: CampaignDefinition[] = [
  {
    id: 'tarawa_red_beach_1',
    order: 1,
    levelId: 1,
    titleKey: 'campaign.tarawaRedBeach1.title',
    missionId: 'campaign_tarawa_red_beach_1',
    transitionSeconds: 2,
    stitchDirection: 'horizontal',
    segments: [
      { id: 'campaign_tarawa_red_beach_1_01', missionPath: 'missions/campaign_pacific/campaign_tarawa_red_beach_1_01', sourcePacificMissionId: 'mission_pacific_01' },
      { id: 'campaign_tarawa_red_beach_1_02', missionPath: 'missions/campaign_pacific/campaign_tarawa_red_beach_1_02', sourcePacificMissionId: 'mission_pacific_02' },
      { id: 'campaign_tarawa_red_beach_1_03', missionPath: 'missions/campaign_pacific/campaign_tarawa_red_beach_1_03', sourcePacificMissionId: 'mission_pacific_03' },
    ],
  },
  {
    id: 'saipan',
    order: 2,
    levelId: 2,
    titleKey: 'campaign.saipan.title',
    missionId: 'campaign_saipan',
    transitionSeconds: 2,
    stitchDirection: 'horizontal',
    segments: [
      { id: 'campaign_saipan_01', missionPath: 'missions/campaign_pacific/campaign_saipan_01', sourcePacificMissionId: 'mission_pacific_04' },
      { id: 'campaign_saipan_02', missionPath: 'missions/campaign_pacific/campaign_saipan_02', sourcePacificMissionId: 'mission_pacific_05' },
      { id: 'campaign_saipan_03', missionPath: 'missions/campaign_pacific/campaign_saipan_03', sourcePacificMissionId: 'mission_pacific_06' },
    ],
  },
  {
    id: 'tarawa_red_beach_2',
    order: 3,
    levelId: 3,
    titleKey: 'campaign.tarawaRedBeach2.title',
    missionId: 'campaign_tarawa_red_beach_2',
    transitionSeconds: 2,
    stitchDirection: 'horizontal',
    segments: [
      { id: 'campaign_tarawa_red_beach_2_01', missionPath: 'missions/campaign_pacific/campaign_tarawa_red_beach_2_01', sourcePacificMissionId: 'mission_pacific_07' },
      { id: 'campaign_tarawa_red_beach_2_02', missionPath: 'missions/campaign_pacific/campaign_tarawa_red_beach_2_02', sourcePacificMissionId: 'mission_pacific_08' },
      { id: 'campaign_tarawa_red_beach_2_03', missionPath: 'missions/campaign_pacific/campaign_tarawa_red_beach_2_03', sourcePacificMissionId: 'mission_pacific_09' },
    ],
  },
  {
    id: 'peleliu',
    order: 4,
    levelId: 4,
    titleKey: 'campaign.peleliu.title',
    missionId: 'campaign_peleliu',
    transitionSeconds: 2,
    stitchDirection: 'horizontal',
    segments: [
      { id: 'campaign_peleliu_01', missionPath: 'missions/campaign_pacific/campaign_peleliu_01', sourcePacificMissionId: 'mission_pacific_10' },
      { id: 'campaign_peleliu_02', missionPath: 'missions/campaign_pacific/campaign_peleliu_02', sourcePacificMissionId: 'mission_pacific_11' },
      { id: 'campaign_peleliu_03', missionPath: 'missions/campaign_pacific/campaign_peleliu_03', sourcePacificMissionId: 'mission_pacific_12' },
    ],
  },
];

export function getCampaign(id: string): CampaignDefinition | undefined {
  return CAMPAIGNS.find(campaign => campaign.id === id);
}

export function isCampaignChapter(chapterId: ChapterId): boolean {
  return chapterId === CAMPAIGN_CHAPTER_ID;
}
```

- [ ] **Step 4: Wire `LevelDB.ts`**

Modify imports:

```ts
import { CAMPAIGNS, CAMPAIGN_CHAPTER_ID } from './CampaignDB';
```

Extend `LevelMeta.entryKind`:

```ts
entryKind?: 'mission' | 'campaign' | 'editor' | 'custom';
campaignId?: string;
```

Insert the campaign chapter after the Pacific chapter and before the Test chapter:

```ts
{
  id: CAMPAIGN_CHAPTER_ID,
  order: 3,
  titleKey: 'chapter.campaign.title',
  subtitleKey: 'chapter.campaign.subtitle',
  levels: CAMPAIGNS
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(campaign => ({
      chapterId: CAMPAIGN_CHAPTER_ID,
      id: campaign.levelId,
      missionPath: '',
      titleKey: campaign.titleKey,
      missionId: campaign.missionId,
      entryKind: 'campaign' as const,
      campaignId: campaign.id,
    })),
},
```

- [ ] **Step 5: Wire `GameSession.ts`**

Extend `GameSessionState`:

```ts
selectedCampaignId: string | null;
```

Extend `DEFAULT_STATE`:

```ts
selectedCampaignId: null,
```

Add getters:

```ts
get selectedCampaignId() { return state.selectedCampaignId; },
get isCampaign() { return !!state.selectedCampaignId; },
```

Clear campaign state in existing non-campaign entry points:

```ts
state.selectedCampaignId = null;
```

Add this method:

```ts
selectCampaign(levelId: number, campaignId: string) {
  state.pvpSession = null;
  state.selectedLevelId = levelId;
  state.selectedMissionPath = '';
  state.selectedMissionSource = { type: 'resource', missionPath: '' };
  state.selectedCampaignId = campaignId;
  state.resumeFromSave = false;
}
```

Reset must include:

```ts
state.selectedCampaignId = DEFAULT_STATE.selectedCampaignId;
```

- [ ] **Step 6: Run the metadata test**

Run:

```powershell
node tests/campaignDB.test.js
```

Expected: PASS and prints `campaignDB tests passed`.

- [ ] **Step 7: Commit**

```powershell
git add assets/scripts/core/CampaignDB.ts assets/scripts/core/LevelDB.ts assets/scripts/core/GameSession.ts tests/campaignDB.test.js
git commit -m "feat: add campaign metadata and session state"
```

---

### Task 2: Copied Campaign Mission Resources And Localization

**Files:**
- Create: `assets/resources/campaigns/pacific_campaigns.json`
- Create: `assets/resources/missions/campaign_pacific/*.json`
- Modify: `data/lang.csv`
- Modify: `assets/scripts/core/LangDB.ts`
- Test: `tests/campaignResourceCopies.test.js`
- Test: `tests/campaignDB.test.js`

**Interfaces:**
- Consumes: `CAMPAIGNS` from Task 1.
- Produces: resource JSON files at every `CampaignSegmentDefinition.missionPath`, independent campaign mission ids, and localization keys used by `LevelDB`.

- [ ] **Step 1: Write the failing resource-copy test**

Create `tests/campaignResourceCopies.test.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');

const copies = [
  ['mission_pacific_01', 'campaign_tarawa_red_beach_1_01'],
  ['mission_pacific_02', 'campaign_tarawa_red_beach_1_02'],
  ['mission_pacific_03', 'campaign_tarawa_red_beach_1_03'],
  ['mission_pacific_04', 'campaign_saipan_01'],
  ['mission_pacific_05', 'campaign_saipan_02'],
  ['mission_pacific_06', 'campaign_saipan_03'],
  ['mission_pacific_07', 'campaign_tarawa_red_beach_2_01'],
  ['mission_pacific_08', 'campaign_tarawa_red_beach_2_02'],
  ['mission_pacific_09', 'campaign_tarawa_red_beach_2_03'],
  ['mission_pacific_10', 'campaign_peleliu_01'],
  ['mission_pacific_11', 'campaign_peleliu_02'],
  ['mission_pacific_12', 'campaign_peleliu_03'],
];

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8'));
}

function campaignPath(id) {
  const map = {
    campaign_tarawa_red_beach_1_01: 'campaign_tarawa_red_beach_1_01',
    campaign_tarawa_red_beach_1_02: 'campaign_tarawa_red_beach_1_02',
    campaign_tarawa_red_beach_1_03: 'campaign_tarawa_red_beach_1_03',
    campaign_saipan_01: 'campaign_saipan_01',
    campaign_saipan_02: 'campaign_saipan_02',
    campaign_saipan_03: 'campaign_saipan_03',
    campaign_tarawa_red_beach_2_01: 'campaign_tarawa_red_beach_2_01',
    campaign_tarawa_red_beach_2_02: 'campaign_tarawa_red_beach_2_02',
    campaign_tarawa_red_beach_2_03: 'campaign_tarawa_red_beach_2_03',
    campaign_peleliu_01: 'campaign_peleliu_01',
    campaign_peleliu_02: 'campaign_peleliu_02',
    campaign_peleliu_03: 'campaign_peleliu_03',
  };
  return `assets/resources/missions/campaign_pacific/${map[id]}.json`;
}

for (const [sourceId, campaignId] of copies) {
  const source = readJson(`assets/resources/missions/${sourceId}.json`);
  const copy = readJson(campaignPath(campaignId));
  assert.strictEqual(copy.id, campaignId, `${campaignId} should have independent id`);
  assert.strictEqual(copy.theater, 'pacific', `${campaignId} should stay pacific`);
  assert.deepStrictEqual(copy.tiles, source.tiles, `${campaignId} should start from copied terrain`);
  assert.deepStrictEqual(copy.objective, source.objective, `${campaignId} should start from copied objective`);
  assert.strictEqual(copy.eventTableId, source.eventTableId, `${campaignId} should initially reuse event table id`);
}

const campaigns = readJson('assets/resources/campaigns/pacific_campaigns.json');
assert.strictEqual(campaigns.campaigns.length, 4, 'campaign resource should define four campaigns');
assert.deepStrictEqual(
  campaigns.campaigns.map(c => c.title),
  ['塔拉瓦红滩1', '塞班岛', '塔拉瓦红滩2', '贝里琉'],
);

const lang = fs.readFileSync(path.join(repo, 'data/lang.csv'), 'utf8');
for (const key of [
  'chapter.campaign.title',
  'chapter.campaign.subtitle',
  'campaign.tarawaRedBeach1.title',
  'campaign.saipan.title',
  'campaign.tarawaRedBeach2.title',
  'campaign.peleliu.title',
]) {
  assert(lang.includes(key), `data/lang.csv should contain ${key}`);
}

console.log('campaign resource copy tests passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node tests/campaignResourceCopies.test.js
```

Expected: FAIL because campaign resource files do not exist yet.

- [ ] **Step 3: Copy the 12 mission JSON files**

Use PowerShell copy commands, then edit only each copied `id` field:

```powershell
New-Item -ItemType Directory -Force assets\resources\missions\campaign_pacific | Out-Null
Copy-Item assets\resources\missions\mission_pacific_01.json assets\resources\missions\campaign_pacific\campaign_tarawa_red_beach_1_01.json
Copy-Item assets\resources\missions\mission_pacific_02.json assets\resources\missions\campaign_pacific\campaign_tarawa_red_beach_1_02.json
Copy-Item assets\resources\missions\mission_pacific_03.json assets\resources\missions\campaign_pacific\campaign_tarawa_red_beach_1_03.json
Copy-Item assets\resources\missions\mission_pacific_04.json assets\resources\missions\campaign_pacific\campaign_saipan_01.json
Copy-Item assets\resources\missions\mission_pacific_05.json assets\resources\missions\campaign_pacific\campaign_saipan_02.json
Copy-Item assets\resources\missions\mission_pacific_06.json assets\resources\missions\campaign_pacific\campaign_saipan_03.json
Copy-Item assets\resources\missions\mission_pacific_07.json assets\resources\missions\campaign_pacific\campaign_tarawa_red_beach_2_01.json
Copy-Item assets\resources\missions\mission_pacific_08.json assets\resources\missions\campaign_pacific\campaign_tarawa_red_beach_2_02.json
Copy-Item assets\resources\missions\mission_pacific_09.json assets\resources\missions\campaign_pacific\campaign_tarawa_red_beach_2_03.json
Copy-Item assets\resources\missions\mission_pacific_10.json assets\resources\missions\campaign_pacific\campaign_peleliu_01.json
Copy-Item assets\resources\missions\mission_pacific_11.json assets\resources\missions\campaign_pacific\campaign_peleliu_02.json
Copy-Item assets\resources\missions\mission_pacific_12.json assets\resources\missions\campaign_pacific\campaign_peleliu_03.json
```

Then replace the top-level `id` in each copied JSON with its file stem. Example for the first copied file:

```json
{
  "id": "campaign_tarawa_red_beach_1_01",
  "name": "Tarawa, Red Beach 1 - Landing at the Bird's Beak",
  "description": "Pacific Scenario A1. Destroy the Heavy Artillery, then move off the map along the red arrow. Place 1 Heavy Artillery and 2 AT Guns randomly on the six numbered red hexes, facing the numbered edge. The Sherman starts on the black outlined landing hex.",
  "theater": "pacific"
}
```

Only the `id` line changes in this task; keep terrain, units, objectives, and table ids initially identical to the copied source.

- [ ] **Step 4: Add `pacific_campaigns.json`**

Create `assets/resources/campaigns/pacific_campaigns.json`:

```json
{
  "campaigns": [
    {
      "id": "tarawa_red_beach_1",
      "title": "塔拉瓦红滩1",
      "segments": [
        "missions/campaign_pacific/campaign_tarawa_red_beach_1_01",
        "missions/campaign_pacific/campaign_tarawa_red_beach_1_02",
        "missions/campaign_pacific/campaign_tarawa_red_beach_1_03"
      ],
      "transitionSeconds": 2
    },
    {
      "id": "saipan",
      "title": "塞班岛",
      "segments": [
        "missions/campaign_pacific/campaign_saipan_01",
        "missions/campaign_pacific/campaign_saipan_02",
        "missions/campaign_pacific/campaign_saipan_03"
      ],
      "transitionSeconds": 2
    },
    {
      "id": "tarawa_red_beach_2",
      "title": "塔拉瓦红滩2",
      "segments": [
        "missions/campaign_pacific/campaign_tarawa_red_beach_2_01",
        "missions/campaign_pacific/campaign_tarawa_red_beach_2_02",
        "missions/campaign_pacific/campaign_tarawa_red_beach_2_03"
      ],
      "transitionSeconds": 2
    },
    {
      "id": "peleliu",
      "title": "贝里琉",
      "segments": [
        "missions/campaign_pacific/campaign_peleliu_01",
        "missions/campaign_pacific/campaign_peleliu_02",
        "missions/campaign_pacific/campaign_peleliu_03"
      ],
      "transitionSeconds": 2
    }
  ]
}
```

- [ ] **Step 5: Add localization rows and regenerate LangDB**

Append to `data/lang.csv` using the existing CSV column order:

```csv
chapter.campaign.title,战役,Campaign
chapter.campaign.subtitle,连续作战：以当前车组状态推进三段战斗,Campaign operations: fight three linked segments
campaign.tarawaRedBeach1.title,塔拉瓦红滩1,Tarawa Red Beach 1
campaign.saipan.title,塞班岛,Saipan
campaign.tarawaRedBeach2.title,塔拉瓦红滩2,Tarawa Red Beach 2
campaign.peleliu.title,贝里琉,Peleliu
battleLog.campaign.advance,推进至下一阶段：{name},Advancing to next operation: {name}
```

Run:

```powershell
node tools/buildLangDB.js
```

Expected: `assets/scripts/core/LangDB.ts` updates and contains the new keys.

- [ ] **Step 6: Run resource and metadata tests**

Run:

```powershell
node tests/campaignResourceCopies.test.js
node tests/campaignDB.test.js
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```powershell
git add assets/resources/campaigns/pacific_campaigns.json assets/resources/missions/campaign_pacific data/lang.csv assets/scripts/core/LangDB.ts tests/campaignResourceCopies.test.js tests/campaignDB.test.js
git commit -m "feat: add campaign resources and localization"
```

---

### Task 3: Pure Campaign Runtime Helpers

**Files:**
- Create: `assets/scripts/core/CampaignRuntime.ts`
- Test: `tests/campaignRuntime.test.js`

**Interfaces:**
- Consumes: `CampaignDefinition`, `MissionData`, `Unit`, `UnitPlacement`, `Offset`, and existing `loadMission`.
- Produces:
  - `CampaignSegmentRuntime`
  - `StitchedCampaignData`
  - `stitchCampaignMissions(campaign, missions): StitchedCampaignData`
  - `translateMissionData(data, segmentIndex, colOffset): MissionData`
  - `carryShermanToNextSegment(currentSherman, nextTemplate): UnitPlacement`
  - `campaignSegmentForAxial(stitched, pos): number | null`

- [ ] **Step 1: Write the failing runtime helper test**

Create `tests/campaignRuntime.test.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const repo = path.resolve(__dirname, '..');

function loadTsModule(rel) {
  const abs = path.join(repo, rel);
  const source = fs.readFileSync(abs, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  const req = (id) => {
    if (id === './HexGrid') return loadTsModule('assets/scripts/core/HexGrid.ts');
    if (id === './UnitDB') return loadTsModule('assets/scripts/core/UnitDB.ts');
    if (id === './types') return loadTsModule('assets/scripts/core/types.ts');
    if (id === './CampaignDB') return loadTsModule('assets/scripts/core/CampaignDB.ts');
    return require(id);
  };
  new Function('require', 'module', 'exports', js)(req, mod, mod.exports);
  return mod.exports;
}

const runtime = loadTsModule('assets/scripts/core/CampaignRuntime.ts');

const segA = {
  id: 'seg_a',
  name: 'A',
  description: '',
  theater: 'pacific',
  cols: 2,
  rows: 1,
  tiles: [[{ t: 'c' }, { t: 'c' }]],
  sherman: { kind: 'sherman', faction: 'allied', at: { col: 0, row: 0 }, facing: 0, loaded: true, hatchOpen: true },
  enemies: [{ kind: 'at_gun', faction: 'japanese', at: { col: 1, row: 0 }, facing: 3 }],
  objective: { type: 'destroy_kind_evac', kind: 'at_gun', evacAt: { col: 1, row: 0 }, evacExitDir: 0 },
  eventTableId: 'seg_a_events',
};

const segB = {
  id: 'seg_b',
  name: 'B',
  description: '',
  theater: 'pacific',
  cols: 3,
  rows: 1,
  tiles: [[{ t: 'c' }, { t: 'T' }, { t: 'c' }]],
  sherman: { kind: 'sherman', faction: 'allied', at: { col: 0, row: 0 }, facing: 0 },
  enemies: [{ kind: 'type95', faction: 'japanese', at: { col: 2, row: 0 }, facing: 3 }],
  objective: { type: 'destroy_all_enemies' },
  eventTableId: 'seg_b_events',
};

const campaign = {
  id: 'test_campaign',
  order: 1,
  levelId: 1,
  titleKey: 'campaign.test.title',
  missionId: 'campaign_test',
  transitionSeconds: 2,
  stitchDirection: 'horizontal',
  segments: [
    { id: 'seg_a', missionPath: 'seg_a', sourcePacificMissionId: 'source_a' },
    { id: 'seg_b', missionPath: 'seg_b', sourcePacificMissionId: 'source_b' },
  ],
};

const stitched = runtime.stitchCampaignMissions(campaign, [segA, segB]);
assert.strictEqual(stitched.data.id, 'campaign_test');
assert.strictEqual(stitched.data.cols, 5);
assert.strictEqual(stitched.segments[0].colOffset, 0);
assert.strictEqual(stitched.segments[1].colOffset, 2);
assert.strictEqual(stitched.data.tiles[0][3].t, 'T');
assert.deepStrictEqual(stitched.segmentMissionData[1].enemies[0].at, { col: 4, row: 0 });
assert.strictEqual(runtime.campaignSegmentForOffset(stitched, { col: 3, row: 0 }), 1);
assert.strictEqual(runtime.campaignSegmentForOffset(stitched, { col: 1, row: 0 }), 0);

const carried = runtime.carryShermanToNextSegment({
  kind: 'sherman',
  faction: 'allied',
  at: { col: 9, row: 9 },
  facing: 5,
  turretFacing: 7,
  crew: { commander: false, loader: true, gunner: true, driver: true, coDriver: false },
  fireLevel: 3,
  paralyzed: true,
  turretDamaged: true,
  radioDamaged: true,
  loaded: true,
  hatchOpen: true,
  visionRange: 1,
}, segB.sherman);
assert.deepStrictEqual(carried.at, { col: 2, row: 0 });
assert.strictEqual(carried.loaded, true);
assert.strictEqual(carried.hatchOpen, true);
assert.deepStrictEqual(carried.crew, { commander: false, loader: true, gunner: true, driver: true, coDriver: false });
assert.strictEqual(carried.fireLevel, undefined);
assert.strictEqual(carried.paralyzed, undefined);
assert.strictEqual(carried.turretDamaged, undefined);
assert.strictEqual(carried.radioDamaged, undefined);
assert.strictEqual(carried.visionRange, undefined);

console.log('campaign runtime tests passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node tests/campaignRuntime.test.js
```

Expected: FAIL because `CampaignRuntime.ts` does not exist.

- [ ] **Step 3: Implement `CampaignRuntime.ts`**

Create `assets/scripts/core/CampaignRuntime.ts`:

```ts
import type { CampaignDefinition } from './CampaignDB';
import type { MissionData, Offset, TileDef, UnitPlacement } from './types';

export interface CampaignSegmentRuntime {
  index: number;
  id: string;
  missionPath: string;
  sourcePacificMissionId: string;
  colOffset: number;
  rowOffset: number;
  cols: number;
  rows: number;
  missionId: string;
}

export interface StitchedCampaignData {
  campaign: CampaignDefinition;
  data: MissionData;
  segmentMissionData: MissionData[];
  segments: CampaignSegmentRuntime[];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function translateOffset(pos: Offset | undefined, colOffset: number, rowOffset: number): Offset | undefined {
  if (!pos) return undefined;
  return { col: pos.col + colOffset, row: pos.row + rowOffset };
}

function translatePlacement(p: UnitPlacement, colOffset: number, rowOffset: number): UnitPlacement {
  const out: UnitPlacement = { ...p };
  if (p.at) out.at = translateOffset(p.at, colOffset, rowOffset);
  if (p.crew) out.crew = { ...p.crew };
  if (p.startEids) out.startEids = p.startEids.slice();
  if (p.startRids) out.startRids = p.startRids.slice();
  return out;
}

function translateObjective(obj: MissionData['objective'], colOffset: number, rowOffset: number): MissionData['objective'] {
  const out = cloneJson(obj);
  if (out.evacAt) out.evacAt = translateOffset(out.evacAt, colOffset, rowOffset);
  return out;
}

function translateTiles(data: MissionData, colOffset: number, totalCols: number): Array<Array<TileDef | null>> {
  return Array.from({ length: data.rows }, (_, row) => {
    const line: Array<TileDef | null> = Array.from({ length: totalCols }, () => null);
    for (let col = 0; col < data.cols; col++) {
      const tile = data.tiles[row]?.[col] ?? null;
      line[col + colOffset] = tile ? { ...tile } : null;
    }
    return line;
  });
}

export function translateMissionData(data: MissionData, segmentIndex: number, colOffset: number, rowOffset = 0): MissionData {
  const totalCols = data.cols + colOffset;
  return {
    ...cloneJson(data),
    id: data.id,
    cols: totalCols,
    rows: data.rows + rowOffset,
    tiles: translateTiles(data, colOffset, totalCols),
    sherman: translatePlacement(data.sherman, colOffset, rowOffset),
    allies: (data.allies ?? []).map(p => translatePlacement(p, colOffset, rowOffset)),
    enemies: data.enemies.map(p => translatePlacement(p, colOffset, rowOffset)),
    objective: translateObjective(data.objective, colOffset, rowOffset),
    truckPath: data.truckPath?.map(p => ({ ...p, col: p.col + colOffset, row: p.row + rowOffset })),
  };
}

export function stitchCampaignMissions(campaign: CampaignDefinition, missions: MissionData[]): StitchedCampaignData {
  if (missions.length !== campaign.segments.length) {
    throw new Error(`Campaign ${campaign.id} expected ${campaign.segments.length} segments, got ${missions.length}`);
  }

  const totalCols = missions.reduce((sum, mission) => sum + mission.cols, 0);
  const totalRows = Math.max(...missions.map(mission => mission.rows));
  const stitchedRows: Array<Array<TileDef | null>> = Array.from(
    { length: totalRows },
    () => Array.from({ length: totalCols }, () => null),
  );
  const segmentMissionData: MissionData[] = [];
  const segments: CampaignSegmentRuntime[] = [];
  let colOffset = 0;

  for (let i = 0; i < missions.length; i++) {
    const mission = missions[i]!;
    const definition = campaign.segments[i]!;
    const translated = translateMissionData(mission, i, colOffset);
    translated.cols = totalCols;
    translated.rows = totalRows;
    translated.tiles = Array.from({ length: totalRows }, (_, row) =>
      Array.from({ length: totalCols }, (_, col) => translated.tiles[row]?.[col] ?? null),
    );
    for (let row = 0; row < mission.rows; row++) {
      for (let col = 0; col < mission.cols; col++) {
        const tile = mission.tiles[row]?.[col] ?? null;
        stitchedRows[row]![col + colOffset] = tile ? { ...tile } : null;
      }
    }
    segmentMissionData.push({
      ...translated,
      tiles: stitchedRows.map(row => row.map(tile => tile ? { ...tile } : null)),
    });
    segments.push({
      index: i,
      id: definition.id,
      missionPath: definition.missionPath,
      sourcePacificMissionId: definition.sourcePacificMissionId,
      colOffset,
      rowOffset: 0,
      cols: mission.cols,
      rows: mission.rows,
      missionId: mission.id,
    });
    colOffset += mission.cols;
  }

  const first = missions[0]!;
  const data: MissionData = {
    ...cloneJson(first),
    id: campaign.missionId,
    name: campaign.id,
    description: campaign.id,
    cols: totalCols,
    rows: totalRows,
    tiles: stitchedRows,
    sherman: segmentMissionData[0]!.sherman,
    allies: segmentMissionData[0]!.allies ?? [],
    enemies: segmentMissionData[0]!.enemies,
    objective: segmentMissionData[0]!.objective,
    eventTableId: segmentMissionData[0]!.eventTableId,
  };

  return { campaign, data, segmentMissionData, segments };
}

export function campaignSegmentForOffset(stitched: StitchedCampaignData, pos: Offset): number | null {
  for (const segment of stitched.segments) {
    const inCol = pos.col >= segment.colOffset && pos.col < segment.colOffset + segment.cols;
    const inRow = pos.row >= segment.rowOffset && pos.row < segment.rowOffset + segment.rows;
    if (inCol && inRow) return segment.index;
  }
  return null;
}

export function carryShermanToNextSegment(current: UnitPlacement, nextTemplate: UnitPlacement): UnitPlacement {
  return {
    kind: 'sherman',
    faction: current.faction ?? nextTemplate.faction,
    at: nextTemplate.at ? { ...nextTemplate.at } : undefined,
    facing: current.facing ?? nextTemplate.facing,
    turretFacing: current.turretFacing ?? nextTemplate.turretFacing,
    crew: current.crew ? { ...current.crew } : nextTemplate.crew ? { ...nextTemplate.crew } : undefined,
    loaded: current.loaded === true,
    hatchOpen: current.hatchOpen === true,
  };
}
```

- [ ] **Step 4: Run runtime test**

Run:

```powershell
node tests/campaignRuntime.test.js
```

Expected: PASS and prints `campaign runtime tests passed`.

- [ ] **Step 5: Commit**

```powershell
git add assets/scripts/core/CampaignRuntime.ts tests/campaignRuntime.test.js
git commit -m "feat: add campaign runtime helpers"
```

---

### Task 4: Menu Campaign Entry Routing

**Files:**
- Modify: `assets/scripts/view/MainMenuScene.ts`
- Test: `tests/campaignDB.test.js`

**Interfaces:**
- Consumes: `LevelMeta.entryKind === 'campaign'`, `LevelMeta.campaignId`, and `GameSession.selectCampaign(...)`.
- Produces: clicking a campaign entry launches the battle scene with `GameSession.isCampaign === true`.

- [ ] **Step 1: Extend the existing metadata test**

Add these assertions to `tests/campaignDB.test.js`:

```js
assertContains('assets/scripts/view/MainMenuScene.ts', "meta.entryKind === 'campaign'");
assertContains('assets/scripts/view/MainMenuScene.ts', 'GameSession.selectCampaign(meta.id, meta.campaignId)');
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node tests/campaignDB.test.js
```

Expected: FAIL because `MainMenuScene.ts` does not route campaign entries yet.

- [ ] **Step 3: Add routing to `onClickLevel`**

In `assets/scripts/view/MainMenuScene.ts`, inside `private onClickLevel(meta: LevelMeta)`, insert this branch after the `custom` branch and before the normal mission branch:

```ts
if (meta.entryKind === 'campaign') {
  if (!meta.campaignId) {
    console.warn('[Menu] campaign entry missing campaignId:', meta.id);
    return;
  }
  GameSession.selectCampaign(meta.id, meta.campaignId);
  this.loadBattleScene();
  return;
}
```

- [ ] **Step 4: Run menu routing test**

Run:

```powershell
node tests/campaignDB.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add assets/scripts/view/MainMenuScene.ts tests/campaignDB.test.js
git commit -m "feat: route campaign menu entries"
```

---

### Task 5: BattleScene Campaign Loading And Shadow Rendering

**Files:**
- Modify: `assets/scripts/view/BattleScene.ts`
- Test: `tests/campaignDB.test.js`
- Test: `tests/campaignRuntime.test.js`

**Interfaces:**
- Consumes:
  - `GameSession.isCampaign`
  - `GameSession.selectedCampaignId`
  - `getCampaign(...)`
  - `stitchCampaignMissions(...)`
- Produces:
  - `private campaignRuntime: StitchedCampaignData | null`
  - `private activeCampaignSegmentIndex: number`
  - `private loadSelectedCampaignFromSession(): void`
  - `private redrawCampaignShadow(): void`

- [ ] **Step 1: Add static assertions for BattleScene wiring**

Append to `tests/campaignDB.test.js`:

```js
assertContains('assets/scripts/view/BattleScene.ts', 'private campaignRuntime');
assertContains('assets/scripts/view/BattleScene.ts', 'loadSelectedCampaignFromSession');
assertContains('assets/scripts/view/BattleScene.ts', 'redrawCampaignShadow');
assertContains('assets/scripts/view/BattleScene.ts', 'stitchCampaignMissions');
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node tests/campaignDB.test.js
```

Expected: FAIL because BattleScene does not contain campaign runtime wiring yet.

- [ ] **Step 3: Add imports and fields to `BattleScene.ts`**

Add imports:

```ts
import { getCampaign } from '../core/CampaignDB';
import {
  StitchedCampaignData,
  campaignSegmentForOffset,
  stitchCampaignMissions,
} from '../core/CampaignRuntime';
```

Add fields near existing mission/runtime fields:

```ts
private campaignRuntime: StitchedCampaignData | null = null;
private activeCampaignSegmentIndex = 0;
private campaignTransitionActive = false;
```

- [ ] **Step 4: Route campaign loading**

At the start of `private loadSelectedMissionFromSession()`, insert:

```ts
if (GameSession.isCampaign) {
  this.loadSelectedCampaignFromSession();
  return;
}
this.campaignRuntime = null;
this.activeCampaignSegmentIndex = 0;
```

Add a new method:

```ts
private loadSelectedCampaignFromSession() {
  const campaignId = GameSession.selectedCampaignId;
  const campaign = campaignId ? getCampaign(campaignId) : undefined;
  if (!campaign) {
    console.error('[BattleScene] Missing campaign:', campaignId);
    return;
  }

  const loaded: MissionData[] = [];
  const loadNext = (index: number) => {
    const segment = campaign.segments[index];
    if (!segment) {
      this.campaignRuntime = stitchCampaignMissions(campaign, loaded);
      this.activeCampaignSegmentIndex = 0;
      this.turnEndEventProvider = OfficialTurnEndEventProvider;
      this.loadAndDraw(this.campaignRuntime.data);
      return;
    }
    resources.load(segment.missionPath, JsonAsset, (err, asset) => {
      if (err || !asset) {
        console.error('[BattleScene] Failed to load campaign segment:', segment.missionPath, err);
        return;
      }
      loaded.push(asset.json as MissionData);
      loadNext(index + 1);
    });
  };
  loadNext(0);
}
```

- [ ] **Step 5: Draw future-segment shadow**

Add a color constant near `FOG_OVERLAY_COLOR`:

```ts
const CAMPAIGN_SHADOW_COLOR = new Color(8, 10, 14, 190);
```

Add this method:

```ts
private redrawCampaignShadow() {
  if (!this.g || !this.mission || !this.campaignRuntime) return;
  const g = this.g;
  g.fillColor = CAMPAIGN_SHADOW_COLOR;
  for (const tile of this.mission.map.all()) {
    const off = axialToOffset(tile.pos, this.mission.data.rowParityOffset === 1 ? 1 : 0);
    const segmentIndex = campaignSegmentForOffset(this.campaignRuntime, off);
    if (segmentIndex === null || segmentIndex <= this.activeCampaignSegmentIndex) continue;
    const c = this.project(tile.pos.q, tile.pos.r);
    this.traceHexPath(c.x, c.y, this.hexSize);
    g.fill();
  }
}
```

Add `campaignSegmentForOffset` to the CampaignRuntime import.

Call it in `redraw()` after terrain/details and before unit drawing:

```ts
this.redrawCampaignShadow();
```

- [ ] **Step 6: Run tests and syntax checks**

Run:

```powershell
node tests/campaignDB.test.js
node tests/campaignRuntime.test.js
npx tsc assets/scripts/core/CampaignRuntime.ts --ignoreConfig --module Node16 --moduleResolution node16 --esModuleInterop --skipLibCheck
```

Expected: tests PASS; focused compile has no errors for `CampaignRuntime.ts`.

- [ ] **Step 7: Commit**

```powershell
git add assets/scripts/view/BattleScene.ts tests/campaignDB.test.js
git commit -m "feat: load stitched campaign battles"
```

---

### Task 6: Segment Advancement, Outcome Wrapping, And Final Completion

**Files:**
- Modify: `assets/scripts/view/BattleScene.ts`
- Modify: `assets/scripts/core/CampaignRuntime.ts`
- Test: `tests/campaignRuntime.test.js`
- Test: `tests/campaignDB.test.js`

**Interfaces:**
- Consumes:
  - `carryShermanToNextSegment(...)`
  - `campaignRuntime.segmentMissionData`
  - existing `computeOutcome()`, `updateOutcomeOverlay()`, `beginPlayerPhaseForNewTurn()`, and map pan helpers.
- Produces:
  - `private canAdvanceCampaignSegment(): boolean`
  - `private advanceCampaignSegment(): void`
  - `private applyCampaignSegmentMission(index: number, carriedSherman?: UnitPlacement): void`
  - `private panToCampaignSegment(index: number, seconds: number, done: () => void): void`
  - `private currentTurnEndMissionId(): string`

- [ ] **Step 1: Add static assertions**

Append to `tests/campaignDB.test.js`:

```js
assertContains('assets/scripts/view/BattleScene.ts', 'canAdvanceCampaignSegment');
assertContains('assets/scripts/view/BattleScene.ts', 'advanceCampaignSegment');
assertContains('assets/scripts/view/BattleScene.ts', 'applyCampaignSegmentMission');
assertContains('assets/scripts/view/BattleScene.ts', 'panToCampaignSegment');
assertContains('assets/scripts/view/BattleScene.ts', 'currentTurnEndMissionId');
assertContains('assets/scripts/view/BattleScene.ts', "MenuProgress.markCompleted(GameSession.selectedLevelId, CAMPAIGN_CHAPTER_ID)");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node tests/campaignDB.test.js
```

Expected: FAIL because segment advancement is not wired yet.

- [ ] **Step 3: Import campaign chapter id and carry helper**

In `BattleScene.ts` imports:

```ts
import { CAMPAIGN_CHAPTER_ID, getCampaign } from '../core/CampaignDB';
import {
  StitchedCampaignData,
  campaignSegmentForOffset,
  carryShermanToNextSegment,
  stitchCampaignMissions,
} from '../core/CampaignRuntime';
import type { UnitPlacement } from '../core/types';
```

- [ ] **Step 4: Wrap outcome overlay**

At the beginning of `private updateOutcomeOverlay()`, after the existing ongoing branch check, insert:

```ts
if (this.outcome === 'victory' && this.canAdvanceCampaignSegment()) {
  this.advanceCampaignSegment();
  return;
}
```

In the final victory branch where single missions call `MenuProgress.markCompleted(...)`, add campaign-specific completion:

```ts
if (GameSession.isCampaign) {
  MenuProgress.markCompleted(GameSession.selectedLevelId, CAMPAIGN_CHAPTER_ID);
} else {
  const levelMeta = this.mission ? findLevelByMissionId(this.mission.data.id) : undefined;
  if (levelMeta) MenuProgress.markCompleted(levelMeta.id, levelMeta.chapterId);
}
```

Preserve any existing PVP branch exactly as-is.

- [ ] **Step 5: Add advancement helpers**

Add methods near other mission lifecycle helpers:

```ts
private canAdvanceCampaignSegment(): boolean {
  return !!this.campaignRuntime
    && this.outcome === 'victory'
    && this.activeCampaignSegmentIndex < this.campaignRuntime.segmentMissionData.length - 1
    && !this.campaignTransitionActive;
}

private advanceCampaignSegment(): void {
  if (!this.mission || !this.campaignRuntime || !this.canAdvanceCampaignSegment()) return;
  const nextIndex = this.activeCampaignSegmentIndex + 1;
  const currentSherman: UnitPlacement = {
    kind: 'sherman',
    faction: this.mission.sherman.faction,
    at: axialToOffset(this.mission.sherman.pos, this.mission.data.rowParityOffset === 1 ? 1 : 0),
    facing: this.mission.sherman.facing ?? undefined,
    turretFacing: this.mission.sherman.turretFacing,
    crew: this.mission.sherman.crew ? { ...this.mission.sherman.crew } : undefined,
    loaded: this.mission.sherman.loaded,
    hatchOpen: this.mission.sherman.hatchOpen,
  };
  const nextTemplate = this.campaignRuntime.segmentMissionData[nextIndex].sherman;
  const carried = carryShermanToNextSegment(currentSherman, nextTemplate);
  this.campaignTransitionActive = true;
  this.applyCampaignSegmentMission(nextIndex, carried);
  const nextName = this.campaignRuntime.segmentMissionData[nextIndex].name;
  this.battleLogI18n('battleLog.campaign.advance', { name: nextName });
  this.panToCampaignSegment(nextIndex, this.campaignRuntime.campaign.transitionSeconds, () => {
    this.campaignTransitionActive = false;
    this.outcome = 'ongoing';
    this.beginPlayerPhaseForNewTurn();
    this.refreshPhaseUI();
    this.updateHUD();
    this.redraw();
  });
}

private applyCampaignSegmentMission(index: number, carriedSherman?: UnitPlacement): void {
  if (!this.campaignRuntime) return;
  const segmentData = this.campaignRuntime.segmentMissionData[index];
  const data: MissionData = {
    ...segmentData,
    sherman: carriedSherman ?? segmentData.sherman,
  };
  this.activeCampaignSegmentIndex = index;
  this.turnEndEventProvider = OfficialTurnEndEventProvider;
  this.mission = loadMission(data, this.rng);
  this.shermanSpawnQr = this.mission.sherman.pos;
  this.shermanSpawnFacing = this.mission.sherman.facing;
  this.outcome = 'ongoing';
  this.visibleHexKeys.clear();
  this.transientFogRevealKeys.clear();
  this.destroyTurnEndEventUI();
  this.turnEndUnitSeq = 0;
  this.refreshPlayerVisibility();
}
```

- [ ] **Step 6: Route turn-end event lookup through the active segment id**

Add this helper:

```ts
private currentTurnEndMissionId(): string {
  if (!this.mission) return '';
  if (!this.campaignRuntime) return this.mission.data.id;
  const segment = this.campaignRuntime.segmentMissionData[this.activeCampaignSegmentIndex];
  const definition = this.campaignRuntime.campaign.segments[this.activeCampaignSegmentIndex];
  return segment?.eventTableId ?? definition?.sourcePacificMissionId ?? segment?.id ?? this.mission.data.id;
}
```

Replace the turn-end list display assignment:

```ts
const mid = this.mission.data.id;
```

with:

```ts
const mid = this.currentTurnEndMissionId();
```

Replace the turn-end roll assignment:

```ts
const missionId = this.mission.data.id;
```

with:

```ts
const missionId = this.currentTurnEndMissionId();
```

The two target locations are the existing turn-end list display path and turn-end roll path where `this.turnEndEventProvider.has(...)`, `rows(...)`, `diceCount(...)`, and `rowForSum(...)` are called.

- [ ] **Step 7: Add map pan transition helper**

Add:

```ts
private panToCampaignSegment(index: number, seconds: number, done: () => void): void {
  if (!this.campaignRuntime || !this.mapNode) {
    done();
    return;
  }
  const segment = this.campaignRuntime.segments[index];
  const row = Math.floor(segment.rows / 2);
  const col = segment.colOffset + Math.floor(segment.cols / 2);
  const axial = offsetToAxial({ col, row }, this.mission?.data.rowParityOffset === 1 ? 1 : 0);
  const center = this.project(axial.q, axial.r);
  const startX = this.mapNode.position.x;
  const startY = this.mapNode.position.y;
  const targetX = -center.x;
  const targetY = -center.y;
  let elapsed = 0;
  const duration = Math.max(0.05, seconds);
  const step = (dt: number) => {
    elapsed += dt;
    const k = Math.min(1, elapsed / duration);
    const eased = k * k * (3 - 2 * k);
    this.applyMapViewPosition(
      startX + (targetX - startX) * eased,
      startY + (targetY - startY) * eased,
    );
    if (k >= 1) {
      this.unschedule(step);
      done();
    }
  };
  this.schedule(step);
}
```

Ensure input gates use `this.campaignTransitionActive` by adding it to `isBusy()` or the top-level player input checks:

```ts
if (this.campaignTransitionActive) return true;
```

- [ ] **Step 8: Run focused tests and diff hygiene**

Run:

```powershell
node tests/campaignDB.test.js
node tests/campaignRuntime.test.js
git diff --check
```

Expected: tests PASS and `git diff --check` prints no output.

- [ ] **Step 9: Commit**

```powershell
git add assets/scripts/view/BattleScene.ts assets/scripts/core/CampaignRuntime.ts tests/campaignDB.test.js tests/campaignRuntime.test.js
git commit -m "feat: advance campaign segments"
```

---

### Task 7: End-To-End Verification And Documentation Touch-Up

**Files:**
- Test: all campaign tests

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a clean final campaign implementation branch with focused verification evidence.

- [ ] **Step 1: Run all focused campaign tests**

Run:

```powershell
node tests/campaignDB.test.js
node tests/campaignResourceCopies.test.js
node tests/campaignRuntime.test.js
git diff --check
```

Expected: all tests PASS; `git diff --check` prints no output.

- [ ] **Step 2: Run existing nearby tests**

Run:

```powershell
node tests/HexGrid.test.ts
node tests/updateAllConfigTables.test.js
```

Expected: PASS. If `node tests/HexGrid.test.ts` fails due to TypeScript execution limitations, run the known focused compile shape instead:

```powershell
npx tsc tests/HexGrid.test.ts assets/scripts/core/HexGrid.ts --ignoreConfig --module Node16 --moduleResolution node16 --esModuleInterop --skipLibCheck
```

Expected: no new campaign-related compile errors.

- [ ] **Step 3: Inspect final changed-file scope**

Run:

```powershell
git status -sb
git diff --stat
```

Expected: only campaign-related files are changed.

- [ ] **Step 4: Confirm no design-doc drift**

Run:

```powershell
git diff -- docs/superpowers/specs/2026-07-09-campaign-system-design.md
```

Expected: no output. If there is output, stop and ask for approval before changing the approved design document.
