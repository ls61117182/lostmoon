const assert = require('assert');
const fs = require('fs');
const os = require('os');
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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-column-order-'));
try {
  const tempTable = path.join(tempDir, 'reordered.csv');
  fs.writeFileSync(tempTable, '\uFEFFnotes\tid\tvalue\n说明\t编号\t数值\nhello\trow1\t7\n', 'utf8');
  const desiredOrder = tool.readTable(tempTable).headers;

  fs.writeFileSync(tempTable, '\uFEFFid,value,notes\n编号,数值,说明\nrow1,7,hello\n', 'utf8');
  assert.strictEqual(tool.restoreColumnOrder(tempTable, desiredOrder), true);

  const restored = tool.readTable(tempTable);
  assert.deepStrictEqual(restored.headers, ['notes', 'id', 'value']);
  assert.deepStrictEqual(restored.rows[2], ['hello', 'row1', '7']);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('updateAllConfigTables registry test passed');
