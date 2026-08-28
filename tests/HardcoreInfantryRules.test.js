const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { readCsvRowsSmart } = require('../tools/csvSmart');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const combat = fs.readFileSync('assets/scripts/core/Combat.ts', 'utf8');
const rows = readCsvRowsSmart(path.resolve('data/units.csv'), {
  requiredHeaders: ['unitKind', 'effectiveRange'],
  toolName: 'HardcoreInfantryRules.test',
});
const headers = rows[0].map(cell => cell.trim().replace(/^\uFEFF/, ''));
const units = rows.slice(1).map(row => Object.fromEntries(
  headers.map((header, index) => [header, (row[index] ?? '').trim()]),
));

const turn = battleScene.match(/private\s+runHardcoreInfantryTurn\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(turn, 'hardcore infantry should have a deterministic turn path');
assert(turn[0].includes('selectAIShootTarget'));
assert(turn[0].indexOf("executeEnemyAction(infantry, 'shoot')")
  < turn[0].indexOf('findInfantryAIMove'));
assert(turn[0].includes("executeEnemyAction(infantry, 'infantry_move')"));

const beginTurn = battleScene.match(/private\s+beginCurrentEnemyTurn\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(beginTurn, 'beginCurrentEnemyTurn should be found');
assert(beginTurn[0].indexOf('this.isHardcoreInfantryActor(enemy)')
  < beginTurn[0].indexOf('rollHardcoreTankAIDice'));
assert(beginTurn[0].includes('this.enemyDice = []'));
assert.match(battleScene, /isAIActorUnit\(unit, GameSession\.gameMode === 'hardcore'\)/);
assert.match(battleScene, /isFootUnit\(unit\)\s*&& unit\.kind !== 'officer'/,
  'all infantry nationalities, but not officers, should use the hardcore rule');

assert.match(combat, /const infantryAttack = isFootUnit\(attacker\)/);
assert.match(combat, /export function infantryAttackRange\(_target: Unit\): number[\s\S]*?return 1/);
assert.match(combat, /const range = infantryAttackRange\(target\)/);
assert.match(combat, /if \(distance > range\) return \{ ok: false, reason: 'attack\.reason\.outOfRange' \}/);
assert.match(combat, /if \(isFootUnit\(target\) && !infantryAttack\)/,
  'infantry attacks should allow both tank and non-tank targets');
assert.match(combat,
  /if \(isFootUnit\(attacker\) && isFootUnit\(target\)\)[\s\S]*?penetrated: hit[\s\S]*?statusChange: hit \? 'destroyed' : 'none'/,
  'infantry versus infantry should resolve a hit as an immediate kill without an armour check');
assert.match(battleScene,
  /const infantryVsInfantry = isFootUnit\(enemy\) && isFootUnit\(target\)[\s\S]*?mg: infantryVsInfantry/,
  'AI infantry versus infantry should use the one-stage hit presentation');
assert.match(battleScene, /mg: selected\.infantryAttack/,
  'AT-gun crews firing small arms at infantry should also hide penetration dice');
assert.match(battleScene,
  /if \(isFootUnit\(_attacker\) && isFootUnit\(target\)\)[\s\S]*?battleLog\.combatMgAI/,
  'infantry combat logs should report only the hit result, not armour penetration');

for (const kind of ['infantry', 'german_infantry', 'soviet_infantry', 'japanese_infantry', 'american_infantry']) {
  assert.strictEqual(units.find(unit => unit.unitKind === kind)?.effectiveRange, '1',
    `${kind} base range should remain one so rifle fire is not expanded`);
}

const priority = battleScene.match(/private\s+infantryMoveHexPriority\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(priority, 'infantry movement priority should be found');
const body = priority[0];
const orderedRules = [
  "kind === 'at_gun'",
  'isTankUnit',
  "terrain === 'rocky'",
  "terrain === 'trees'",
];
for (let i = 1; i < orderedRules.length; i++) {
  assert(body.indexOf(orderedRules[i - 1]) < body.indexOf(orderedRules[i]),
    `${orderedRules[i - 1]} should precede ${orderedRules[i]}`);
}
assert.match(body, /terrain === 'rocky' \|\| tile\.hasBuilding \|\| tile\.terrain === 'forest'\) return 2/,
  'rocky, building, and forest hexes should share one priority tier');
assert.match(battleScene, /if \(priority < 4\) return priority[\s\S]*?!unit\.suppressed[\s\S]*?return adjacentToUnsuppressedHostileInfantry \? null : priority/,
  'only ordinary terrain should be rejected beside hostile infantry');
assert.match(battleScene, /const currentPriority = this\.infantryMoveHexPriority\(enemy, enemy\.pos, currentTile\)/);
assert.match(battleScene, /const preserveCurrentPriority = currentDist <= 2/,
  'infantry should only preserve its current terrain priority when an enemy is within two hexes');
assert.match(battleScene, /if \(preserveCurrentPriority && priority > currentPriority\) continue/,
  'nearby infantry must only move to an equal-or-higher-priority hex');
assert.match(battleScene, /return adjacentToUnsuppressedHostileInfantry \? null : priority/);

console.log('Hardcore infantry rules test passed');
