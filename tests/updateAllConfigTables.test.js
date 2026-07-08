const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tool = require('../tools/updateAllConfigTables');

const dataTables = fs
  .readdirSync(path.join(root, 'data'))
  .filter((name) => name.endsWith('.csv'))
  .sort();

const registeredTables = Object.keys(tool.CONFIG_TABLES).sort();

assert.deepStrictEqual(
  registeredTables,
  dataTables,
  'updateAllConfigTables should register every data/*.csv file',
);

assert.strictEqual(
  tool.CONFIG_TABLES['enemy_hardcore_tank_action_table.csv'],
  'tools/buildEnemyAIDB.js',
  'hardcore tank action table should be covered by the one-click updater',
);

for (const scriptPath of tool.getBuildScripts()) {
  assert(
    fs.existsSync(path.join(root, scriptPath)),
    `${scriptPath} should exist`,
  );
}

console.log('updateAllConfigTables registry test passed');
