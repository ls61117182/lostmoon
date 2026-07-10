const fs = require('fs');
const assert = require('assert');

const read = (path) => fs.readFileSync(path, 'utf8');
const battleScene = read('assets/scripts/view/BattleScene.ts');
const enemyAI = read('assets/scripts/core/EnemyAI.ts');
const types = read('assets/scripts/core/types.ts');
const mainMenu = read('assets/scripts/view/MainMenuScene.ts');
const unitsCsv = read('data/units.csv');
const legacyDiceCsv = read('data/enemy_ai_dice.csv');
const legacyTableCsv = read('data/enemy_ai_table.csv');
const hardcoreTableCsv = read('data/enemy_hardcore_tank_action_table.csv');
const langCsv = read('data/lang.csv');

for (const index of [1, 2, 3]) {
  const png = `assets/resources/textures/units/AmericanInfantry0${index}.png`;
  assert(fs.existsSync(png), `${png} should exist`);
  assert(fs.existsSync(`${png}.meta`), `${png}.meta should exist`);
  assert(
    battleScene.includes(`textures/units/AmericanInfantry0${index}/spriteFrame`),
    `BattleScene should load AmericanInfantry0${index}`,
  );
}

assert.match(types, /\| 'american_infantry'/, 'UnitKind should include american_infantry');
assert.match(
  types,
  /isFootKind[\s\S]*kind === 'american_infantry'/,
  'American infantry should use shared foot-unit rules',
);
assert.match(
  unitsCsv,
  /^american_infantry,美军步兵,allied,2,0,0,0,0,3,2,1,2,1,,,infantry,destroyed,0,attack=american_infantry1\|move=american_infantry1\|misc=american_infantry1,,/m,
  'units.csv should own the allied American infantry stats and independent action table',
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
assert(selector[0].includes("u.kind === 'american_infantry'"));

const pvpSupport = battleScene.match(/private\s+pvpSupportKind\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(pvpSupport, 'pvpSupportKind() should be found');
assert(
  pvpSupport[0].includes("factionId === 'usa'")
    && pvpSupport[0].includes("return 'american_infantry'"),
  'USA PVP support should use the new American infantry unit',
);

const move = battleScene.match(/private\s+findInfantryAIMove\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(move, 'findInfantryAIMove() should handle both AI infantry kinds');
assert(move[0].includes("enemy.kind !== 'american_infantry'"));
assert(move[0].includes('if (d >= currentDist) continue'));
assert(move[0].includes('this.americanInfantryMovePriority'));

const priority = battleScene.match(/private\s+americanInfantryMovePriority\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(priority, 'American infantry should have a separate movement priority');
const priorityBody = priority[0];
assert(priorityBody.indexOf('isTankUnit') < priorityBody.indexOf('hasBuilding'));
assert(priorityBody.indexOf('hasBuilding') < priorityBody.indexOf("terrain === 'forest'"));
assert(priorityBody.indexOf("terrain === 'forest'") < priorityBody.indexOf("terrain === 'trees'"));

assert.match(mainMenu, /american_infantry:\s*'US Inf'/);
assert.match(mainMenu, /const allyKinds: UnitKind\[\] = \[[^\]]*'american_infantry'/);

console.log('American infantry configuration test passed');
