const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(repo, rel), 'utf8');
}

const levelDb = read('assets/scripts/core/LevelDB.ts');
const menu = read('assets/scripts/view/MainMenuScene.ts');

assert(
  levelDb.includes('export function getImportableMissionLevels()'),
  'LevelDB should expose getImportableMissionLevels for the level editor import catalog',
);

assert(
  levelDb.includes("level.missionPath && (level.entryKind ?? 'mission') === 'mission'"),
  'import catalog should include only configured single-mission resource entries',
);

assert(
  levelDb.includes('campaign.segments.map'),
  'import catalog should include campaign segment resource entries',
);

assert(
  levelDb.includes("missionId: segment.id"),
  'campaign segment import entries should use the segment mission id',
);

assert(
  levelDb.includes("titleOverride: `${campaign.titleKey} · ${String(index + 1).padStart(2, '0')}`"),
  'campaign segment import entries should expose a readable segment title override',
);

assert(
  menu.includes('getImportableMissionLevels'),
  'MainMenuScene should use the shared import catalog instead of hand-writing mission buttons',
);

assert(
  menu.includes('meta.titleOverride ?? t(meta.titleKey)'),
  'MainMenuScene import picker should prefer titleOverride for campaign segments',
);

assert(
  menu.includes("resources.load(meta.missionPath, JsonAsset"),
  'level editor import should load the selected mission resource JSON',
);

console.log('mission import catalog test passed');
