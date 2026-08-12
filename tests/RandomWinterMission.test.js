const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = function transpileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  module._compile(output, filename);
};

const { CHAPTERS } = require('../assets/scripts/core/LevelDB.ts');
const { generateRandomMissionPackage } = require('../assets/scripts/core/RandomMissionGenerator.ts');

const testChapter = CHAPTERS.find(chapter => chapter.id === 'test');
assert(testChapter, 'test chapter should exist');
const winterEntry = testChapter.levels.find(level => level.missionId === 'random_europe_winter');
assert(winterEntry, 'European winter random mission entry should exist');
assert.strictEqual(winterEntry.entryKind, 'random');
assert.strictEqual(winterEntry.randomTheater, 'europe');
assert.strictEqual(winterEntry.randomSeason, 'winter');

const seed = 20260812;
const normal = generateRandomMissionPackage('europe', seed);
const winter = generateRandomMissionPackage('europe', seed, { season: 'winter' });
assert.strictEqual(winter.mission.season, 'winter');
assert.strictEqual(normal.mission.season, undefined);
assert.deepStrictEqual(winter.mission.tiles, normal.mission.tiles, 'winter must reuse the European terrain rules and layout');
assert.deepStrictEqual(winter.mission.enemies, normal.mission.enemies, 'winter must reuse the European enemy rules');
assert.deepStrictEqual(winter.mission.objective, normal.mission.objective, 'winter must reuse the European objective rules');
assert.deepStrictEqual(winter.turnEndEvents, normal.turnEndEvents, 'winter must reuse the European event rules');

const menu = fs.readFileSync('assets/scripts/view/MainMenuScene.ts', 'utf8');
assert.match(menu, /season: meta\.randomSeason/);
assert.match(menu, /meta\.randomSeason === 'winter'/);

console.log('European winter random mission tests passed');
