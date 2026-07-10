const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readCsv(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8').trim();
  const [headerLine, ...lines] = text.split(/\r?\n/);
  const headers = headerLine.replace(/^\uFEFF/, '').split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
  });
}

const unitRows = readCsv('data/units.csv');
const actionRows = readCsv('data/enemy_hardcore_tank_action_table.csv');
const diceRows = readCsv('data/enemy_hardcore_tank_dice.csv');
const generated = fs.readFileSync(path.join(root, 'assets/scripts/core/EnemyAIDB.ts'), 'utf8');
const unitGenerated = fs.readFileSync(path.join(root, 'assets/scripts/core/UnitDB.ts'), 'utf8');
const enemyAI = fs.readFileSync(path.join(root, 'assets/scripts/core/EnemyAI.ts'), 'utf8');
const battleScene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');

assert.strictEqual(
  unitRows.find((row) => row.unitKind === 'tiger').action_table,
  'attack=attack1|move=move1|misc=misc1',
  'units.csv should configure the hardcore tank action table ids per unit',
);

assert.strictEqual(
  unitRows.find((row) => row.unitKind === 'at_gun').action_table,
  'attack=at_gun1|move=at_gun1|misc=at_gun1',
  'AT gun should use the configurable action-table path',
);

assert.strictEqual(
  unitRows.find((row) => row.unitKind === 'japanese_infantry').action_table,
  'attack=japanese_infantry1|move=japanese_infantry1|misc=japanese_infantry1',
  'Japanese infantry should use the configurable action-table path',
);

assert.strictEqual(
  unitRows.find((row) => row.unitKind === 'american_infantry').action_table,
  'attack=american_infantry1|move=american_infantry1|misc=american_infantry1',
  'American infantry should use its independent configurable action-table path',
);

assert.strictEqual(
  unitRows.find((row) => row.unitKind === 'heavy_artillery').action_table,
  'attack=heavy_artillery1|move=heavy_artillery1|misc=heavy_artillery1',
  'Heavy artillery should use the configurable action-table path',
);

assert.deepStrictEqual(
  actionRows.filter((row) => row.die_type === 'misc1').map((row) => Number(row.die)),
  [1, 2, 3, 4, 5, 6],
  'hardcore enemy tank action table should define misc dice 1..6',
);

assert.deepStrictEqual(
  Object.fromEntries(actionRows.map((row) => [`${row.die_type}:${row.die}`, [
    row.primary,
    row.primary_crew,
    row.fallback,
    row.fallback_crew,
    row.fallback2,
    row.fallback2_crew,
  ]])),
  {
    'attack1:1': ['shoot', '', '', '', '', ''],
    'attack1:2': ['shoot', 'loader', '', '', '', ''],
    'attack1:3': ['shoot', 'loader', '', '', '', ''],
    'attack1:4': ['shoot', 'gunner', '', '', '', ''],
    'attack1:5': ['shoot', 'gunner', '', '', '', ''],
    'attack1:6': ['shoot', 'commander', '', '', '', ''],
    'move1:1': ['turn', '', '', '', '', ''],
    'move1:2': ['advance', '', 'reverse', '', '', ''],
    'move1:3': ['advance', '', 'turn', '', '', ''],
    'move1:4': ['advance', '', 'turn', '', '', ''],
    'move1:5': ['advance', '', 'reverse', '', '', ''],
    'move1:6': ['advance', '', 'smoke', '', '', ''],
    'misc1:1': ['repair', 'commander', 'shoot', 'gunner', '', ''],
    'misc1:2': ['turn', '', 'turn', 'coDriver', '', ''],
    'misc1:3': ['advance', 'coDriver', 'turn', 'coDriver', '', ''],
    'misc1:4': ['shoot', 'gunner', '', '', '', ''],
    'misc1:5': ['smoke', '', '', '', '', ''],
    'misc1:6': ['conceal', '', '', '', '', ''],
    'at_gun1:1': ['turn', '', '', '', '', ''],
    'at_gun1:2': ['advance_to_building', '', '', '', '', ''],
    'at_gun1:3': ['turn', '', '', '', '', ''],
    'at_gun1:4': ['none', '', '', '', '', ''],
    'at_gun1:5': ['shoot', '', '', '', '', ''],
    'at_gun1:6': ['shoot', '', '', '', '', ''],
    'japanese_infantry1:1': ['shoot_adjacent', '', '', '', '', ''],
    'japanese_infantry1:2': ['infantry_move', '', '', '', '', ''],
    'japanese_infantry1:3': ['shoot_adjacent', '', '', '', '', ''],
    'japanese_infantry1:4': ['infantry_move', '', '', '', '', ''],
    'japanese_infantry1:5': ['infantry_move', '', '', '', '', ''],
    'japanese_infantry1:6': ['shoot_adjacent', '', '', '', '', ''],
    'american_infantry1:1': ['shoot_adjacent', '', '', '', '', ''],
    'american_infantry1:2': ['infantry_move', '', '', '', '', ''],
    'american_infantry1:3': ['shoot_adjacent', '', '', '', '', ''],
    'american_infantry1:4': ['infantry_move', '', '', '', '', ''],
    'american_infantry1:5': ['infantry_move', '', '', '', '', ''],
    'american_infantry1:6': ['shoot_adjacent', '', '', '', '', ''],
    'heavy_artillery1:1': ['none', '', '', '', '', ''],
    'heavy_artillery1:2': ['none', '', '', '', '', ''],
    'heavy_artillery1:3': ['shoot', '', '', '', '', ''],
    'heavy_artillery1:4': ['shoot', '', '', '', '', ''],
    'heavy_artillery1:5': ['shoot', '', '', '', '', ''],
    'heavy_artillery1:6': ['shoot', '', '', '', '', ''],
  },
  'hardcore enemy tank action table should match the requested attack/move/misc rows',
);

assert.deepStrictEqual(
  Object.fromEntries(diceRows.map((row) => [row.terrain, {
    attack: Number(row.attack_dice),
    move: Number(row.move_dice),
    misc: Number(row.misc_dice),
  }])),
  {
    road: { attack: 1, move: 3, misc: -1 },
    field: { attack: 1, move: 2, misc: 0 },
    mud: { attack: 1, move: 1, misc: -1 },
    clear: { attack: 1, move: 2, misc: 0 },
    trees: { attack: 1, move: 2, misc: 0 },
    beach: { attack: 1, move: 1, misc: -1 },
    airstrip: { attack: 1, move: 3, misc: -1 },
  },
  'hardcore enemy tank terrain dice counts should match the requested table',
);

assert.match(generated, /export type EnemyTankDieType = 'attack' \| 'move' \| 'misc';/);
assert.match(generated, /export type HardcoreTankActionTableId = 'american_infantry1' \| 'at_gun1' \| 'attack1' \| 'heavy_artillery1' \| 'japanese_infantry1' \| 'misc1' \| 'move1';/);
assert.match(generated, /export const DEFAULT_HARDCORE_TANK_ACTION_TABLE: Record<EnemyTankDieType, HardcoreTankActionTableId> = \{/);
assert.match(generated, /road: \{ attack: 1, move: 3, misc: -1 \}/);
assert.match(generated, /2: \{ primary: 'shoot', primaryCrew: 'loader' \}/);
assert.match(generated, /6: \{ primary: 'shoot', primaryCrew: 'commander' \}/);
assert.match(generated, /misc1: \{\n\s+1: \{ primary: 'repair', primaryCrew: 'commander', fallback: 'shoot', fallbackCrew: 'gunner' \}/);
assert.match(generated, /at_gun1: \{\n\s+1: \{ primary: 'turn' \}/);
assert.match(generated, /japanese_infantry1: \{\n\s+1: \{ primary: 'shoot_adjacent' \}/);
assert.match(generated, /american_infantry1: \{\n\s+1: \{ primary: 'shoot_adjacent' \}/);
assert.match(generated, /heavy_artillery1: \{\n\s+1: \{ primary: 'none' \}/);
assert.match(generated, /3: \{ primary: 'advance', primaryCrew: 'coDriver', fallback: 'turn', fallbackCrew: 'coDriver' \}/);
assert.match(unitGenerated, /actionTable: \{ attack: "attack1", move: "move1", misc: "misc1" \}/);
assert.match(unitGenerated, /actionTable: \{ attack: "at_gun1", move: "at_gun1", misc: "at_gun1" \}/);
assert.match(unitGenerated, /actionTable: \{ attack: "japanese_infantry1", move: "japanese_infantry1", misc: "japanese_infantry1" \}/);
assert.match(unitGenerated, /actionTable: \{ attack: "american_infantry1", move: "american_infantry1", misc: "american_infantry1" \}/);
assert.match(unitGenerated, /actionTable: \{ attack: "heavy_artillery1", move: "heavy_artillery1", misc: "heavy_artillery1" \}/);
assert.match(enemyAI, /attack: Math\.max\(0, base\.attack\)/);
assert.match(enemyAI, /move: Math\.max\(0, base\.move \+ \(crewAlive\(unit, 'driver'\) \? 1 : 0\)\)/);
assert.match(enemyAI, /misc: Math\.max\(0, base\.misc \+ \(crewAlive\(unit, 'commander'\) \? 1 : 0\)\)/);
assert.match(enemyAI, /out\.push\(\{ type: 'misc', pip: rng\.d6\(\) \}\)/);
assert.match(enemyAI, /case 'at_gun': return \{ attack: 2, move: 0, misc: 0 \};/);
assert.match(enemyAI, /case 'japanese_infantry': return \{ attack: 0, move: 3, misc: 0 \};/);
assert.match(enemyAI, /case 'american_infantry': return \{ attack: 0, move: 3, misc: 0 \};/);
assert.match(enemyAI, /case 'heavy_artillery': return \{ attack: 1, move: 0, misc: 0 \};/);
assert.match(enemyAI, /export function actionForHardcoreTankDie\(unit: Unit, type: EnemyTankDieType, pip: number\): AIActionEntry/);
assert.match(battleScene, /unit\.stats\.actionTable/);
assert.match(battleScene, /actionForHardcoreTankDie\(enemy, type, pip\)/);
assert.match(battleScene, /const AI_MISC_DIE_FILL\s+= new Color\(255, 240, 170, 255\)/);
assert.match(battleScene, /if \(this\.playerStep === 'misc'\) return AI_MISC_DIE_FILL/);
assert.match(battleScene, /this\.enemyCrewRequirementMet\(enemy, crew\)/);
