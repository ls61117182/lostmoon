const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { readCsvRowsSmart } = require('../tools/csvSmart');

const scene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const loader = fs.readFileSync('assets/scripts/core/MissionLoader.ts', 'utf8');
const fog = fs.readFileSync('assets/scripts/core/FogOfWar.ts', 'utf8');

const beginTurn = scene.match(/private\s+beginCurrentEnemyTurn\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(beginTurn, 'beginCurrentEnemyTurn should be found');
assert(beginTurn[0].indexOf("GameSession.gameMode === 'hardcore' && isControlledATGun(enemy)")
  < beginTurn[0].indexOf('rollHardcoreTankAIDice'),
'controlled hardcore AT guns must bypass action dice');
assert.match(beginTurn[0], /this\.enemyDice = \[\][\s\S]*?this\.runHardcoreATGunTurn\(enemy\)/);

const turn = scene.match(/private\s+runHardcoreATGunTurn\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(turn, 'hardcore AT gun should have a dedicated one-action turn');
assert.match(turn[0], /current !== selected\.direction[\s\S]*?limitTurretTraverse/,
  'an unaligned gun should use the shared 12-direction traverse limiter');
assert.match(turn[0], /traverse\.reached && selected\.attackable[\s\S]*?resolveHardcoreATGunAttack/,
  'a gun may fire after completing its turn in the same action');
assert.match(turn[0], /traverse\.reached && selected\.attackable \? selected\.target\.pos : undefined/,
  'a completed rotate-and-attack should visually face the exact target hex');
assert.match(turn[0], /startHardcoreATGunAim\(gun, current, selected\.target\.pos/,
  'an already aligned gun should also visually face the exact attack target');
assert.match(turn[0], /selected\.terrainBlocked && this\.tryHardcoreATGunForwardMove/,
  'only an already aligned terrain-blocked target should enable movement');

const select = scene.match(/private\s+selectHardcoreATGunTarget\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(select, 'hardcore AT gun target selection should be found');
assert.match(select[0], /isUnitInVision\([\s\S]*?this\.aiFriendliesFor\(gun\)[\s\S]*?radioVisionSharing/,
  'target acquisition should support teammate-provided vision');
assert.match(select[0], /const crew = this\.atGunCrewActor\(gun\)[\s\S]*?if \(infantryAttack\)[\s\S]*?attacker = crew[\s\S]*?canAttack/,
  'infantry targets should be attacked with the controlling infantry profile');
assert.match(select[0], /stats: \{ \.\.\.gun\.stats, visionType: 'turreted' \}/,
  'non-infantry fire should adopt the turreted 12-ray geometry');
assert.match(select[0], /diagonalFlankFireDirectionTo\(gun\.pos, target\.pos\)/,
  'halfway-ray flank targets must remain candidates for whole-gun rotation');
assert.match(select[0], /turretFacing: direction,[\s\S]*?canAttack/,
  'attack legality should be checked using the facing reached after whole-gun rotation');
assert.match(select[0], /Number\(a\.infantryAttack\) - Number\(b\.infantryAttack\)[\s\S]*?a\.turnDistance - b\.turnDistance[\s\S]*?a\.distance - b\.distance/,
  'targets should prefer non-infantry, then least traverse, then nearest distance');
assert.match(select[0], /withoutSmoke\.reason === 'attack\.reason\.blocked'[\s\S]*?smokeBlocked[\s\S]*?withoutSmoke\.ok[\s\S]*?\|\| smokeBlocked\) continue/,
  'physical terrain and smoke obstruction must be distinguished before movement');

const move = scene.match(/private\s+tryHardcoreATGunForwardMove\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(move, 'hardcore AT gun forward movement should be found');
assert.match(move[0], /tile\.terrain !== 'rocky'/,
  'rocky highland must be forbidden');
assert.doesNotMatch(move[0], /terrain !== 'forest'|!tile\.hasBuilding/,
  'forest and building hexes must remain legal destinations');
assert.match(move[0], /findMoveBlocker\(gun, pos\) === null/,
  'the forward destination must still obey occupancy');

const aim = scene.match(/private\s+startHardcoreATGunAim\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(aim, 'hardcore AT gun rotation helper should be found');
assert.match(aim[0], /gun\.turretFacing = to;[\s\S]*?this\.enemyTurretFacing\.set\(gun\.id, to\)/,
  'whole-gun rotation must persist its 12-direction rules and visual state');
assert.match(aim[0], /suppressTurretSound: true/,
  'whole-gun rotation must not use the tank turret traverse sound');
assert.match(aim[0], /gun\.turretVisualTarget = visualTarget \? \{ \.\.\.visualTarget \} : undefined/,
  'an aligned AT gun should persist exact target-facing visual state');
assert.match(aim[0], /fromVisualTarget: gun\.turretVisualTarget[\s\S]*?toVisualTarget: visualTarget/,
  'AT-gun rotation should interpolate toward the target hex like a tank turret');

const muzzle = scene.match(/private\s+muzzleFlashPosition\s*\([^)]*\)[\s\S]*?\n  }\n\n/);
assert(muzzle, 'shared main-gun muzzle geometry helper should be found');
assert.match(muzzle[0], /attacker\.kind === 'at_gun'[\s\S]*?targetScreenAngle\(attacker\.pos, target\.pos\)/,
  'AT-gun muzzle effects and projectile vector must point exactly at the target hex');

assert.match(loader, /u\.visionRange = crewStats\.visionRange/,
  'scenario guns should inherit controlling infantry vision range');
assert.match(fog, /isControlledATGun\(unit\) \? 'infantry'/,
  'controlled guns should inherit infantry vision geometry');

const rows = readCsvRowsSmart(path.resolve('data/units.csv'), {
  requiredHeaders: ['unitKind', 'turretTraverseSpeed'],
  toolName: 'HardcoreATGunActionRules.test',
});
const headers = rows[0].map(cell => cell.trim().replace(/^\uFEFF/, ''));
const atGun = rows.slice(1)
  .map(row => Object.fromEntries(headers.map((header, index) => [header, (row[index] ?? '').trim()])))
  .find(unit => unit.unitKind === 'at_gun');
assert.strictEqual(atGun?.turretTraverseSpeed, '2',
  'whole-gun traverse should preserve the former 60-degree turn rate as two 30-degree steps');

console.log('Hardcore AT-gun action rules tests passed');
