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
  tiles: [[{ t: 'c', eid: 1, rid: 1 }, { t: 'T', eid: 2, rid: 2 }, { t: 'c', eid: 3, rid: 3 }]],
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
assert.strictEqual(stitched.data.tiles[0][3].eid, undefined, 'future segment start markers are inactive');
assert.strictEqual(stitched.segmentMissionData[1].tiles[0][3].eid, 2, 'active segment keeps own markers');
assert.deepStrictEqual(stitched.segmentMissionData[1].enemies[0].at, { col: 4, row: 0 });
assert.strictEqual(stitched.segmentMissionData[0].enemies.length, 1);
assert.strictEqual(stitched.segmentMissionData[1].enemies.length, 1);
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
}, stitched.segmentMissionData[1].sherman);
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
