# Campaign System Design

Date: 2026-07-09

## Goal

Add a campaign mode where one campaign contains three continuous missions. The
player completes each segment and continues into the next segment with selected
Sherman state carried forward. The existing Europe and Pacific mission tabs keep
their current behavior; a new Campaign tab provides four campaign entries built
from copied, independent Pacific mission resources.

## User-Facing Behavior

- Add a new Campaign tab after Europe and Pacific.
- The Campaign tab initially contains four campaigns:
  - 塔拉瓦红滩1: copied Pacific missions 01-03
  - 塞班岛: copied Pacific missions 04-06
  - 塔拉瓦红滩2: copied Pacific missions 07-09
  - 贝里琉: copied Pacific missions 10-12
- The existing Pacific tab still lists the original 12 Pacific missions and can
  start any original mission directly.
- A campaign is won only after all three segments are completed.
- If the player is defeated at any point, retrying the campaign starts from the
  first segment. No mid-campaign retry checkpoint is created.

## Approach

Use approach A: one stitched campaign battlefield with segment activation.

The battle scene loads a campaign definition, loads the three copied segment
missions, stitches their maps into one larger map, and tracks the active segment.
Only the active segment has units, objective resolution, and turn-end events.
Inactive future segments contribute visible terrain, but their units and events
do not exist at runtime until the Sherman enters that segment.

This keeps the old single-mission flow intact and adds campaign behavior as a
runtime layer around mission loading, objective evaluation, drawing, and segment
transition.

## Data Model

Add a campaign-capable entry kind to `LevelDB`:

- `entryKind: 'mission'` remains the default single-mission path.
- `entryKind: 'campaign'` identifies a campaign entry.
- Campaign progress is stored under its own chapter id, for example `campaign`,
  so it does not collide with Europe or Pacific level ids.

Add campaign definitions under resources, for example:

```text
assets/resources/campaigns/pacific_campaigns.json
```

Each campaign definition contains:

- stable campaign id
- title localization key
- three copied segment mission paths
- stitch direction, initially horizontal
- optional camera transition duration, default 2 seconds

Copy the existing Pacific mission JSON resources into a campaign-specific
folder, for example:

```text
assets/resources/missions/campaign_pacific/campaign_tarawa_red_beach_1_01.json
assets/resources/missions/campaign_pacific/campaign_tarawa_red_beach_1_02.json
assets/resources/missions/campaign_pacific/campaign_tarawa_red_beach_1_03.json
```

The copied missions are the source of truth for campaign-specific configuration.
Original `mission_pacific_01..12` resources are not modified for campaign-only
differences. Internal resource names can use ASCII slugs; player-visible names
must use the requested Chinese campaign titles.

## Runtime State

`GameSession` gains a campaign selection path alongside `selectMission`:

- selected campaign id
- selected campaign resource path
- selected campaign entry level id
- resume flag remains false for a fresh campaign start

`BattleScene` stores campaign runtime state when a campaign is active:

- active segment index
- segment definitions and loaded `MissionData`
- stitched map offsets per segment
- active segment objective and event table id
- segment bounds for drawing, shadowing, and camera centering

When not in campaign mode, existing mission loading and battle behavior should
remain unchanged.

## Map Stitching

The three segment maps are stitched horizontally in segment order. Each segment's
offset coordinates are translated into one shared map coordinate space.

For the first implementation:

- preserve each copied mission's row layout and terrain definitions
- place segment 2 to the east of segment 1, and segment 3 to the east of segment 2
- keep enough boundary adjacency that driving off the current segment's evac edge
  places the Sherman onto the next segment's corresponding start hex
- use the current segment's objective `evacAt` and `evacExitDir` to determine
  the transition trigger

The Sherman begins at the first segment's configured start. When moving to the
next segment, the Sherman appears on the next segment's configured start hex,
with position continuity represented by the exit-to-entry transition rather than
by reusing the exact out-of-map coordinate.

## Segment Activation

At campaign load:

- segment 0 is active
- segment 1 and 2 terrain are present in the stitched map
- segment 1 and 2 units are not created
- only segment 0 objective and event table are active

When the active segment is completed by evac:

1. Suppress the normal victory overlay if there is another segment.
2. Apply the inter-segment Sherman state rules.
3. Increment the active segment index.
4. Instantiate the new segment's allies and enemies from its copied mission data.
5. Switch objective, event table, and mission metadata to the new segment.
6. Recompute visibility for the new active segment.
7. Pan the camera to the new segment center over about 2 seconds.
8. Start the next player turn or phase using the normal battle flow.

Only the third segment completion marks the campaign complete and shows final
victory.

## Inter-Segment Sherman State

Carry forward:

- crew survival state
- current facing and turret facing when still valid
- loaded state
- hatch open or closed state

Clear before entering the next segment:

- fire level
- paralyzed state
- turret damaged state
- radio damaged state
- smoke state

Recompute on the new segment:

- vision range, using the new segment's start configuration and unit defaults

This gives the campaign continuity through the Sherman crew and immediate tank
operation, while treating temporary or repairable vehicle damage as cleared
between linked missions.

## Fog And Campaign Shadow

Campaign shadow is separate from fog of war.

- Normal fog still uses `FogOfWar.ts` and the selected game mode.
- Future segment terrain is visible even when not active.
- Future segment terrain receives an extra dark overlay that is darker than
  normal fog.
- Future segment units are not drawn because they do not exist yet.
- Past completed segment terrain remains visible as terrain; it does not need
  active objectives or events.

The draw order should keep campaign shadow above terrain and below active unit
presentation. Normal fog still applies to the active segment.

## Camera Transition

Campaign segment transition uses the existing map pan layer rather than a new
camera system.

The transition target is the center of the next segment's stitched bounds. The
map view interpolates from the current pan position to that target over roughly
2 seconds. During transition, player input is blocked. After transition,
standard controls resume and the next segment starts.

## Objectives And Outcome

`Objective.checkOutcome` can remain the single-segment evaluator. BattleScene
wraps victory handling when campaign mode is active:

- `defeat` remains immediate campaign defeat
- `victory` on segments 0 and 1 becomes `advance campaign segment`
- `victory` on segment 2 becomes final campaign victory

Campaign completion marks the campaign entry complete in `MenuProgress`. Single
Pacific mission completion continues to mark only the original Pacific mission.

## Turn-End Events

Only the active segment's event table is bound to the runtime event provider.
Future segment event tables are ignored until their segment activates.

On segment transition:

- destroy current turn-end event UI
- clear pending turn-end event runtime state
- create or select the provider for the new segment's `eventTableId`
- reset per-segment turn-end sequence state

## Save And Continue

The first version does not add campaign mid-run resume support. If a campaign is
started from the menu, it starts at segment 0. The existing single battle save
path should not be reused for partial campaign checkpoints unless a later design
adds an explicit campaign save schema.

The existing Continue button can keep its current single-mission behavior.

## Localization

Add language keys for:

- campaign chapter title and subtitle
- four campaign button titles
- optional transition log text, such as "Advancing to next operation"

Keep campaign titles free of boardgame scenario labels.

## Tests And Verification

Focused checks:

- campaign definitions map to 4 entries and 12 copied segment resources
- original Pacific `LevelDB` entries still point to original `mission_pacific_*`
  paths
- campaign progress uses the campaign chapter id and does not mark Pacific
  mission completion
- Sherman inter-segment state carries and clears the confirmed fields
- only active segment units are instantiated
- first two segment victories advance instead of ending the battle
- third segment victory marks final campaign victory

Practical validation:

- run targeted TypeScript or `node --check` style checks for edited scripts
- add focused runtime probes for pure helper code where possible
- use `git diff --check`

Whole-project `tsc --noEmit` is not required as the primary signal because this
checkout has known Cocos TypeScript noise.

## Out Of Scope

- Multiplayer/PVP campaign mode
- Campaign mid-run save and resume
- Branching campaigns
- Campaign-specific rewards, repairs, or supply rules beyond the confirmed
  inter-segment Sherman state rules
- Reworking original Pacific missions
