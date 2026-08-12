const assert = require('assert');
const fs = require('fs');

const levelDb = fs.readFileSync('assets/scripts/core/LevelDB.ts', 'utf8');
const menu = fs.readFileSync('assets/scripts/view/MainMenuScene.ts', 'utf8');
const store = fs.readFileSync('assets/scripts/core/CustomMissionStore.ts', 'utf8');

assert.match(levelDb, /titleKey: 'level\.test\.random\.europe\.title'[\s\S]*?randomTheater: 'europe'/);
assert.match(levelDb, /titleKey: 'level\.test\.random\.pacific\.title'[\s\S]*?randomTheater: 'pacific'/);
assert.match(levelDb, /titleKey: 'level\.test\.random\.europe_winter\.title'[\s\S]*?randomTheater: 'europe'[\s\S]*?randomSeason: 'winter'/);
assert.match(menu, /meta\.entryKind === 'random'/);
assert.match(menu, /const unlocked = meta\.alwaysUnlocked === true[\s\S]*?meta\.entryKind === 'random'[\s\S]*?MenuProgress\.isUnlocked/);
assert.match(menu, /meta\.entryKind !== 'random' && !MenuProgress\.isUnlocked/);
assert.match(menu, /generateRandomMissionPackage\(meta\.randomTheater, Date\.now\(\), \{[\s\S]*?season: meta\.randomSeason/);
assert.match(menu, /CustomMissionStore\.saveTransient/);
assert.match(menu, /GameSession\.selectCustomMission\(packageId\)/);
assert.match(store, /saveTransient\(id: string, pkg: CustomMissionPackage\)/);

console.log('random mission menu tests passed');
