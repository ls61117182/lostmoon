const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const scene = fs.readFileSync(path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'), 'utf8');
const start = scene.indexOf('private computeEnemyDiceExecOrder()');
const end = scene.indexOf('private findUnusedMatchingEnemyDie(', start);
const body = scene.slice(start, end);
const miscCheck = body.indexOf("this.enemyDiceTypes[a] === 'misc'");
const pipCheck = body.indexOf('if (va !== vb) return va - vb;');
assert.ok(start >= 0 && miscCheck >= 0 && pipCheck > miscCheck,
  'misc dice must sort after the shared attack/move pip ordering');

const csv = fs.readFileSync(path.resolve(__dirname, '../data/enemy_hardcore_tank_action_table.csv'), 'utf8');
assert.match(csv, /^misc1,4,shoot,gunner,ambush,gunner,/m,
  'misc 4 attacks first and ambushes when no target exists');

console.log('Enemy ambush dice order tests passed');
