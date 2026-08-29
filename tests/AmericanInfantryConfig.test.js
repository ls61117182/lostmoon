const fs = require('fs');
const assert = require('assert');
const path = require('path');
const { readCsvRowsSmart } = require('../tools/csvSmart');

const read = (path) => fs.readFileSync(path, 'utf8');
const battleScene = read('assets/scripts/view/BattleScene.ts');
const enemyAI = read('assets/scripts/core/EnemyAI.ts');
const types = read('assets/scripts/core/types.ts');
const mainMenu = read('assets/scripts/view/MainMenuScene.ts');
const legacyDiceCsv = read('data/enemy_ai_dice.csv');
const legacyTableCsv = read('data/enemy_ai_table.csv');
const hardcoreTableCsv = read('data/enemy_hardcore_tank_action_table.csv');
const langCsv = read('data/lang.csv');
const infantryVisuals = read('data/infantry_visuals.csv');

function readCsvRecords(file, requiredHeaders) {
  const rows = readCsvRowsSmart(path.resolve(file), { requiredHeaders, toolName: 'AmericanInfantryConfig.test' });
  const headers = rows[0].map((cell) => cell.trim().replace(/^\uFEFF/, ''));
  return rows.slice(1).map((row) => Object.fromEntries(
    headers.map((header, index) => [header, (row[index] ?? '').trim()]),
  ));
}

for (const index of [1, 2, 3]) {
  const png = `assets/resources/textures/units/AmericanInfantry0${index}.png`;
  assert(fs.existsSync(png), `${png} should exist`);
  assert(fs.existsSync(`${png}.meta`), `${png}.meta should exist`);
  assert(
    infantryVisuals.includes(`textures/units/AmericanInfantry0${index}/spriteFrame`),
    `infantry_visuals.csv should configure AmericanInfantry0${index}`,
  );
}

assert.match(types, /\| 'american_infantry'/, 'UnitKind should include american_infantry');
assert.match(
  types,
  /isFootKind[\s\S]*kind === 'american_infantry'/,
  'American infantry should use shared foot-unit rules',
);
const americanInfantry = readCsvRecords('data/units.csv', [
  'unitKind', 'faction', 'size', 'penetration', 'effectiveRange', 'usCasualtyDice',
  'visionRange', 'gunnerVisionRange', 'interiorVisionRange', 'hasRadio',
  'visionType', 'damageTargetClass', 'infantryTankCoordination', 'action_table',
]).find((row) => row.unitKind === 'american_infantry');
assert(americanInfantry, 'units.csv should define american_infantry');
assert.deepStrictEqual(
  {
    faction: americanInfantry.faction,
    size: americanInfantry.size,
    penetration: americanInfantry.penetration,
    effectiveRange: americanInfantry.effectiveRange,
    usCasualtyDice: americanInfantry.usCasualtyDice,
    visionRange: americanInfantry.visionRange,
    gunnerVisionRange: americanInfantry.gunnerVisionRange,
    interiorVisionRange: americanInfantry.interiorVisionRange,
    hasRadio: americanInfantry.hasRadio,
    visionType: americanInfantry.visionType,
    damageTargetClass: americanInfantry.damageTargetClass,
    infantryTankCoordination: americanInfantry.infantryTankCoordination,
    action_table: americanInfantry.action_table,
  },
  {
    faction: 'usa',
    size: '2',
    penetration: '3',
    effectiveRange: '1',
    usCasualtyDice: '1',
    visionRange: '3',
    gunnerVisionRange: '4',
    interiorVisionRange: '1',
    hasRadio: '1',
    visionType: 'infantry',
    damageTargetClass: 'destroyed',
    infantryTankCoordination: '0',
    action_table: 'attack=american_infantry1|move=american_infantry1|misc=american_infantry1',
  },
  'units.csv should own the latest American infantry stats and independent action table',
);
assert.match(legacyDiceCsv, /^american_infantry,3,/m, 'American infantry should roll three legacy AI dice');
assert.match(langCsv, /^unit\.name\.american_infantry,美军步兵,American Infantry$/m);
assert.match(langCsv, /^dice\.aiCol\.american_infantry,美军步兵,American Infantry$/m);
for (const die of [1, 3, 6]) {
  assert.match(legacyTableCsv, new RegExp(`^american_infantry,${die},shoot_adjacent,`, 'm'));
  assert.match(hardcoreTableCsv, new RegExp(`^american_infantry1,${die},shoot_adjacent,`, 'm'));
}
for (const die of [2, 4, 5]) {
  assert.match(legacyTableCsv, new RegExp(`^american_infantry,${die},infantry_move,`, 'm'));
  assert.match(hardcoreTableCsv, new RegExp(`^american_infantry1,${die},infantry_move,`, 'm'));
}

assert.match(enemyAI, /case 'american_infantry': return \{ attack: 0, move: 3, misc: 0 \};/);
assert.match(enemyAI, /u\.kind === 'american_infantry'/, 'American infantry should be eligible for allied AI turns');

const selector = battleScene.match(/private\s+infantryVisualsFor\s*\(u:\s*Unit\)[\s\S]*?\n  }\n\n/);
assert(selector, 'infantryVisualsFor() should be found');
assert(selector[0].includes('infantryVisualKindOf(u.kind)'));

const pvpSupport = battleScene.match(/private\s+pvpSupportKind\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(pvpSupport, 'pvpSupportKind() should be found');
assert(
  pvpSupport[0].includes("factionId === 'usa'")
    && pvpSupport[0].includes("return 'american_infantry'"),
  'USA PVP support should use the new American infantry unit',
);

const move = battleScene.match(/private\s+findInfantryAIMove\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(move, 'findInfantryAIMove() should handle both AI infantry kinds');
assert(move[0].includes("enemy.kind === 'officer'"));
assert(move[0].includes('!isFootUnit(enemy)'));
assert(move[0].includes('if (d >= currentDist) continue'));
assert(move[0].includes('this.infantryAIMovePriority'));

const priority = battleScene.match(/private\s+infantryMoveHexPriority\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(priority, 'Hardcore infantry should use the shared movement priority');
const priorityBody = priority[0];
assert(priorityBody.indexOf("kind === 'at_gun'") < priorityBody.indexOf('isTankUnit'));
assert(priorityBody.indexOf('isTankUnit') < priorityBody.indexOf("terrain === 'rocky'"));
assert.match(priorityBody, /terrain === 'rocky' \|\| tile\.hasBuilding \|\| tile\.terrain === 'forest'\) return 2/);
assert(priorityBody.indexOf("terrain === 'forest'") < priorityBody.indexOf("terrain === 'trees'"));
assert.match(battleScene, /private\s+infantryAIMovePriority[\s\S]*?adjacentToUnsuppressedHostileInfantry/);

assert.match(mainMenu, /american_infantry:\s*'US Inf'/);
assert.match(mainMenu, /const allUnitKinds = getAllUnitKinds\(\);/);
assert.match(
  mainMenu,
  /const objectiveTargetKinds = allUnitKinds;/,
  'mission editor objective targets should follow authored battle sides rather than national factions',
);
assert.match(mainMenu, /unitKindPickerTarget\.group === 'player'\s*\? allUnitKinds\.filter\(isTankKind\)/,
  'mission editor should allow any configured tank kind as the player vehicle');

console.log('American infantry configuration test passed');
