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
    if (id === './types') return loadTsModule('assets/scripts/core/types.ts');
    if (id === './CampaignDB') return loadTsModule('assets/scripts/core/CampaignDB.ts');
    if (id === './HexGrid') return loadTsModule('assets/scripts/core/HexGrid.ts');
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
  tiles: [[{ t: 'c', eid: 1, rid: 1 }, { t: 'c', eid: 2, rid: 2 }]],
  sherman: { kind: 'sherman', faction: 'usa', at: { col: 0, row: 0 }, facing: 0, loaded: true, hatchOpen: true },
  enemies: [{ kind: 'at_gun', faction: 'japanese', at: { col: 1, row: 0 }, facing: 3 }],
  objective: { type: 'destroy_kind_evac', kind: 'at_gun', evacAt: { col: 1, row: 0 }, evacExitDir: 1 },
  eventTableId: 'seg_a_events',
};

const segB = {
  id: 'seg_b',
  name: 'B',
  description: '',
  theater: 'pacific',
  cols: 3,
  rows: 2,
  tiles: [
    [{ t: 'c', eid: 1, rid: 1 }, { t: 'T', eid: 2, rid: 2 }, { t: 'c', eid: 3, rid: 3 }],
    [{ t: 'f' }, null, null],
  ],
  sherman: { kind: 'sherman', faction: 'usa', at: { col: 0, row: 0 }, facing: 0 },
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
assert.strictEqual(stitched.data.cols, 4);
assert.strictEqual(stitched.data.rows, 3);
assert.strictEqual(stitched.segments[0].colOffset, 0);
assert.strictEqual(stitched.segments[1].colOffset, 1);
assert.strictEqual(stitched.segments[1].rowOffset, 1);
assert.strictEqual(stitched.data.tiles[1][2].t, 'T');
assert.strictEqual(stitched.data.tiles[2][2].t, 'f', 'odd-row segment translation preserves local hex shape');
assert.strictEqual(stitched.data.tiles[1][2].eid, undefined, 'future segment start markers are inactive');
assert.strictEqual(stitched.segmentMissionData[1].tiles[1][2].eid, 2, 'active segment keeps own markers');
assert.strictEqual(stitched.segmentMissionData[1].tiles[0][0].eid, undefined, 'previous segment start markers are inactive');
assert.deepStrictEqual(stitched.segmentMissionData[1].enemies[0].at, { col: 3, row: 1 });
assert.strictEqual(stitched.segmentMissionData[0].enemies.length, 1);
assert.strictEqual(stitched.segmentMissionData[1].enemies.length, 1);
assert.strictEqual(runtime.campaignSegmentForOffset(stitched, { col: 2, row: 1 }), 1);
assert.strictEqual(runtime.campaignSegmentForOffset(stitched, { col: 1, row: 0 }), 0);
assert.strictEqual(runtime.campaignSegmentForOffset(stitched, { col: 1, row: 2 }), null, 'segment lookup ignores bounding-box holes');

const carried = runtime.carryShermanToNextSegment({
  kind: 'sherman',
  faction: 'usa',
  at: { col: 9, row: 9 },
  facing: 5,
  turretFacing: 7,
  crew: { commander: false, loader: true, gunner: false, driver: true, coDriver: false },
  fireLevel: 3,
  paralyzed: true,
  turretDamaged: true,
  radioDamaged: true,
  loaded: true,
  hatchOpen: true,
  visionRange: 1,
}, stitched.segmentMissionData[1].sherman);
assert.deepStrictEqual(carried.at, { col: 1, row: 1 });
assert.strictEqual(carried.loaded, true);
assert.strictEqual(carried.hatchOpen, true);
assert.deepStrictEqual(carried.crew, { commander: false, loader: true, gunner: false, driver: true, coDriver: false });
assert.strictEqual(carried.fireLevel, undefined);
assert.strictEqual(carried.paralyzed, undefined);
assert.strictEqual(carried.turretDamaged, undefined);
assert.strictEqual(carried.radioDamaged, undefined);
assert.strictEqual(carried.visionRange, undefined);

function overlapMission(id, tile, shermanAt) {
  return {
    id,
    name: id,
    description: '',
    theater: 'pacific',
    cols: 2,
    rows: 1,
    tiles: [[tile, null]],
    sherman: { kind: 'sherman', faction: 'usa', at: shermanAt, facing: 0 },
    enemies: [],
    objective: { type: 'destroy_all_enemies', evacAt: { col: 0, row: 0 }, evacExitDir: 0 },
  };
}

function overlapCampaign(id) {
  return {
    id,
    order: 1,
    levelId: 1,
    titleKey: `campaign.${id}.title`,
    missionId: id,
    transitionSeconds: 2,
    stitchDirection: 'horizontal',
    segments: [
      { id: `${id}_a`, missionPath: `${id}_a`, sourcePacificMissionId: `${id}_source_a` },
      { id: `${id}_b`, missionPath: `${id}_b`, sourcePacificMissionId: `${id}_source_b` },
    ],
  };
}

const effectiveBeatsDisplay = runtime.stitchCampaignMissions(overlapCampaign('effective_beats_display'), [
  overlapMission('effective_a', { t: 'c' }, { col: 0, row: 0 }),
  overlapMission('effective_b', { t: 'f', disp: 1 }, { col: 1, row: 0 }),
]);
assert.strictEqual(effectiveBeatsDisplay.segmentMissionData[1].tiles[0][0].t, 'c');
assert.strictEqual(effectiveBeatsDisplay.segmentMissionData[1].tiles[0][0].disp, undefined);
assert.strictEqual(runtime.campaignSegmentForOffset(effectiveBeatsDisplay, { col: 0, row: 0 }), 0);

const laterEffectiveBeatsEarlierDisplay = runtime.stitchCampaignMissions(overlapCampaign('later_effective_beats_display'), [
  overlapMission('later_effective_a', { t: 'f', disp: 1 }, { col: 0, row: 0 }),
  overlapMission('later_effective_b', { t: 'm' }, { col: 1, row: 0 }),
]);
assert.strictEqual(laterEffectiveBeatsEarlierDisplay.segmentMissionData[0].tiles[0][0].t, 'm');
assert.strictEqual(laterEffectiveBeatsEarlierDisplay.segmentMissionData[0].tiles[0][0].disp, undefined);
assert.strictEqual(runtime.campaignSegmentForOffset(laterEffectiveBeatsEarlierDisplay, { col: 0, row: 0 }), 1);

const earlierDisplayBeatsLaterDisplay = runtime.stitchCampaignMissions(overlapCampaign('display_overlap'), [
  overlapMission('display_a', { t: 'f', disp: 1 }, { col: 0, row: 0 }),
  overlapMission('display_b', { t: 'm', disp: 1 }, { col: 1, row: 0 }),
]);
assert.strictEqual(earlierDisplayBeatsLaterDisplay.segmentMissionData[1].tiles[0][0].t, 'f');
assert.strictEqual(earlierDisplayBeatsLaterDisplay.segmentMissionData[1].tiles[0][0].disp, 1);
assert.strictEqual(runtime.campaignSegmentForOffset(earlierDisplayBeatsLaterDisplay, { col: 0, row: 0 }), 0);

assert.throws(
  () => runtime.stitchCampaignMissions(overlapCampaign('invalid_effective_overlap'), [
    overlapMission('invalid_a', { t: 'c' }, { col: 0, row: 0 }),
    overlapMission('invalid_b', { t: 'm' }, { col: 1, row: 0 }),
  ]),
  /overlapping effective tiles.*configuration is invalid/,
);

function defaultExitTestTiles(terrain) {
  const tiles = Array.from({ length: 6 }, () => Array.from({ length: 8 }, () => null));
  tiles[3][0] = { t: terrain };
  tiles[2][7] = { t: terrain };
  return tiles;
}

const defaultExitFirst = {
  id: 'default_exit_first',
  name: 'Default exit first',
  description: '',
  theater: 'pacific',
  cols: 8,
  rows: 6,
  tiles: defaultExitTestTiles('c'),
  sherman: { kind: 'sherman', faction: 'usa', at: { col: 0, row: 3 }, facing: 0 },
  enemies: [],
  objective: { type: 'destroy_all_enemies' },
};
const defaultExitSecond = {
  ...defaultExitFirst,
  id: 'default_exit_second',
  name: 'Default exit second',
  tiles: defaultExitTestTiles('a'),
};
const defaultExitCampaign = overlapCampaign('default_exit');
const defaultExitStitched = runtime.stitchCampaignMissions(defaultExitCampaign, [defaultExitFirst, defaultExitSecond]);
const firstRuntime = defaultExitStitched.segments[0];
const defaultExitAxial = loadTsModule('assets/scripts/core/HexGrid.ts').axialAdd(
  loadTsModule('assets/scripts/core/HexGrid.ts').offsetToAxial({ col: 7, row: 2 }, 0),
  { q: firstRuntime.axialQOffset, r: firstRuntime.axialROffset },
);
const expectedEntryAxial = loadTsModule('assets/scripts/core/HexGrid.ts').neighbor(defaultExitAxial, 0);
const actualEntryAxial = loadTsModule('assets/scripts/core/HexGrid.ts').offsetToAxial(
  defaultExitStitched.segmentMissionData[1].sherman.at,
  0,
);
assert.deepStrictEqual(actualEntryAxial, expectedEntryAxial,
  'a non-evacuation mission should stitch its successor from (7,2) direction 0');

console.log('campaign runtime tests passed');
