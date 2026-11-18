const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { test } = require('node:test');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { tileHeight, elevationEdges } = require('../assets/scripts/core/Elevation.ts');
const { generateRandomMissionPackage } = require('../assets/scripts/core/RandomMissionGenerator.ts');
const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
test('all live scripts and serialized scenes exclusively reference the new rocky artwork', () => {
  for (const file of files('assets/scripts').filter(file => file.endsWith('.ts'))) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /rocky_highland_|pacific_rocks|redesign_v3\/rocks|RockyHighlandVariants/, file);
  }
  const iconPath = 'textures/terrain/pacific_highland_elevation/spriteFrame';
  for (const scene of ['BattleScene', 'MainMenuScene']) {
    assert.ok(fs.readFileSync(`assets/scripts/view/${scene}.ts`, 'utf8').includes(`rocky: '${iconPath}'`));
  }
  const legacy = ['pacific_rocks', ...Array.from({ length: 6 }, (_, i) => `rocky_highland_0${i + 1}`)]
    .map(name => JSON.parse(fs.readFileSync(`assets/resources/textures/terrain/${name}.png.meta`)).uuid);
  legacy.push(JSON.parse(fs.readFileSync('assets/resources/textures/terrain/redesign_v3/rocks.png.meta')).uuid);
  for (const file of files('assets').filter(file => /\.(scene|prefab|mtl|anim)$/.test(file))) {
    const content = fs.readFileSync(file, 'utf8');
    for (const uuid of legacy) assert.ok(!content.includes(uuid), `${file} still references old artwork ${uuid}`);
  }
  const png = fs.readFileSync('assets/resources/textures/terrain/pacific_highland_elevation.png');
  assert.equal(png.readUInt32BE(16), 222); assert.equal(png.readUInt32BE(20), 256);
});
test('every existing authored mission with H hexes loads them with the new height and cliffs', () => {
  let missions = 0, rockyHexes = 0;
  for (const file of files('assets/resources/missions').filter(file => file.endsWith('.json'))) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!data.tiles?.some(row => row.some(tile => tile?.t === 'H'))) continue;
    const live = loadMission(data), rocks = live.map.all().filter(tile => tile.terrain === 'rocky');
    const authored = data.tiles.flat().filter(tile => tile?.t === 'H');
    assert.equal(rocks.length, authored.length, file);
    assert.deepEqual(rocks.map(tileHeight).sort(), authored.map(tileHeight).sort(), file);
    for (const edge of elevationEdges(live.map.all())) {
      if (edge.high.terrain === 'rocky' || edge.low.terrain === 'rocky') assert.equal(edge.blocked, true, file);
    }
    missions++; rockyHexes += rocks.length;
  }
  assert.ok(missions > 0 && rockyHexes > 0);
  console.log(`Replaced artwork applies to ${rockyHexes} rocky hexes in ${missions} authored missions.`);
});
test('random maps, exported maps and existing battle saves retain new highlands without a data migration', () => {
  let rockyHexes = 0;
  for (const seed of [1, 17, 42, 20261117]) {
    const original = generateRandomMissionPackage('pacific', seed);
    const data = JSON.parse(JSON.stringify(original)).mission;
    const live = loadMission(data), rocks = live.map.all().filter(tile => tile.terrain === 'rocky');
    rockyHexes += rocks.length;
    const save = JSON.parse(JSON.stringify(captureSave({ mission: live, missionId: data.id, turn: 2, phase: 'player',
      gameMode: 'hardcore', movesLeft: 2, attacksLeft: 1, miscDone: false, playerStep: 'movement', hatchChangedThisTurn: false, phaseDice: [] })));
    const restored = loadMission(data);
    assert.equal(applySave(restored, data.id, save).ok, true);
    for (const tile of restored.map.all().filter(tile => tile.terrain === 'rocky')) assert.equal(tileHeight(tile), 1);
  }
  assert.ok(rockyHexes > 0);
});
