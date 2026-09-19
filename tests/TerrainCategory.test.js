const assert = require('assert');
const fs = require('fs');
const path = require('path');

const catalog = fs.readFileSync('assets/scripts/core/TerrainCatalog.ts', 'utf8');
const editor = fs.readFileSync('assets/scripts/view/MainMenuScene.ts', 'utf8');

assert.match(
  catalog,
  /id: 'europe',[\s\S]*?terrainCodes: \['f', 'r', 'm', 'F', 'w'\]/,
  'European terrain category must contain the existing European battlefield tiles',
);
assert.match(
  catalog,
  /id: 'pacific',[\s\S]*?terrainCodes: \['c', 'a', 'T', 'B', 'H', 'dw'\]/,
  'Pacific terrain category must contain the existing Pacific battlefield tiles',
);
assert.match(
  catalog,
  /id: 'urban',[\s\S]*?terrainCodes: \['u', 'ur', 'ui', 'ud'\]/,
  'Urban terrain category must expose one brush for each city tile role',
);
assert.match(catalog, /id: 'north_africa',[\s\S]*?available: false/, 'North Africa must have an extension slot');
assert.match(catalog, /id: 'soviet',[\s\S]*?available: false/, 'Soviet battlefield must have an extension slot');
assert.match(
  editor,
  /terrainCategoryForCode\(tool\.code\) === draftTerrainCategory/,
  'level editor must filter terrain brushes by battlefield category',
);
assert.match(
  editor,
  /draftTerrainCategory = activeTerrainCategoryForMission\(mission\.theater, mission\.tiles\)/,
  'imported missions must restore their terrain category',
);
assert.match(
  editor,
  /theater: draftTerrainCategory === 'urban' \? 'europe' : draftTerrainCategory/,
  'saved urban missions must keep a valid theater while their tile codes preserve the city category',
);
assert.strictEqual(
  (editor.match(/const allowsRoadDirs = tile\.t === 'r' \|\| tile\.t === 'ur';/g) ?? []).length,
  2,
  'both tile-property layouts must expose the six road-direction buttons for urban roads',
);

const expectedCodes = {
  europe: new Set(['f', 'r', 'm', 'F', 'w']),
  pacific: new Set(['c', 'a', 'T', 'B', 'H', 'dw']),
  urban: new Set(['u', 'ur', 'ui', 'ud']),
};
const missionFiles = [];
const collectMissionFiles = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) collectMissionFiles(fullPath);
    else if (entry.name.endsWith('.json')) missionFiles.push(fullPath);
  }
};
collectMissionFiles('assets/resources/missions');
for (const missionFile of missionFiles) {
  const mission = JSON.parse(fs.readFileSync(missionFile, 'utf8').replace(/^\uFEFF/, ''));
  const theater = mission.theater ?? 'europe';
  if (!expectedCodes[theater]) continue;
  for (const row of mission.tiles ?? []) {
    for (const tile of row ?? []) {
      if (!tile) continue;
      assert(
        expectedCodes[theater].has(tile.t),
        `${mission.id}: terrain ${tile.t} does not belong to ${theater}`,
      );
    }
  }
}

console.log('terrain category tests passed');
