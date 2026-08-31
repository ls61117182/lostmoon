#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chooseParsedRows, decodeTable, rowsToCsv } = require('./csvSmart');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

const CONFIG_TABLES = {
  'attack_direction_table.csv': 'tools/buildAttackDirectionDB.js',
  'campaign_upgrades.csv': 'tools/buildCampaignUpgradeDB.js',
  'damage_table.csv': 'tools/buildDamageTableDB.js',
  'enemy_ai_dice.csv': 'tools/buildEnemyAIDB.js',
  'enemy_ai_table.csv': 'tools/buildEnemyAIDB.js',
  'enemy_hardcore_tank_action_table.csv': 'tools/buildEnemyAIDB.js',
  'enemy_hardcore_tank_dice.csv': 'tools/buildEnemyAIDB.js',
  'fire_check_table.csv': 'tools/buildFireCheckDB.js',
  'infantry_visuals.csv': 'tools/buildInfantryVisualDB.js',
  'lang.csv': 'tools/buildLangDB.js',
  'player_action_table.csv': 'tools/buildPlayerActionDB.js',
  'player_dice_pool.csv': 'tools/buildPlayerActionDB.js',
  'player_hardcore_dice_pool.csv': 'tools/buildPlayerActionDB.js',
  'tank_visuals.csv': 'tools/buildTankVisualDB.js',
  'turn_end_events.csv': 'tools/buildTurnEndEventDB.js',
  'units.csv': 'tools/buildUnitDB.js',
};

function listDataTables() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((name) => name.endsWith('.csv'))
    .sort();
}

function validateRegistry() {
  const actual = listDataTables();
  const registered = Object.keys(CONFIG_TABLES).sort();
  const missing = actual.filter((name) => !CONFIG_TABLES[name]);
  const stale = registered.filter((name) => !actual.includes(name));

  if (!missing.length && !stale.length) return;

  const lines = ['[updateAllConfigTables] table registry is out of date.'];
  if (missing.length) {
    lines.push(`Missing from CONFIG_TABLES: ${missing.join(', ')}`);
  }
  if (stale.length) {
    lines.push(`Registered but not found in data/: ${stale.join(', ')}`);
  }
  lines.push('Update tools/updateAllConfigTables.js before running the all-table updater.');
  throw new Error(lines.join('\n'));
}

function getBuildScripts() {
  const seen = new Set();
  const scripts = [];
  for (const tableName of Object.keys(CONFIG_TABLES).sort()) {
    const script = CONFIG_TABLES[tableName];
    if (seen.has(script)) continue;
    seen.add(script);
    scripts.push(script);
  }
  return scripts;
}

function runBuildScript(scriptPath) {
  console.log(`[updateAllConfigTables] running ${scriptPath}`);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${scriptPath} failed with exit code ${result.status}`);
  }
}

function normalizedHeaders(row, tableName) {
  const headers = (row ?? []).map((header, index) => {
    const normalized = String(header).trim().replace(/^\uFEFF/, '');
    // Keep legacy unnamed columns addressable so their cells are not discarded
    // while named columns are rearranged.
    return normalized || `__unnamed_column_${index + 1}`;
  });
  if (!headers.length) throw new Error(`${tableName} has no column headers`);
  if (new Set(headers).size !== headers.length) {
    throw new Error(`${tableName} contains duplicate column headers`);
  }
  return headers;
}

function readTable(filePath) {
  const decoded = decodeTable(filePath);
  const parsed = chooseParsedRows(decoded.text, []);
  const tableName = path.basename(filePath);
  return {
    rows: parsed.rows,
    headers: normalizedHeaders(parsed.rows[0], tableName),
  };
}

function captureColumnOrders() {
  return new Map(listDataTables().map((tableName) => {
    const filePath = path.join(DATA_DIR, tableName);
    return [tableName, readTable(filePath).headers];
  }));
}

function restoreColumnOrder(filePath, desiredHeaders) {
  const tableName = path.basename(filePath);
  const { rows, headers } = readTable(filePath);
  if (headers.length !== desiredHeaders.length
    || headers.some((header) => !desiredHeaders.includes(header))) {
    throw new Error(
      `${tableName} header set changed while updating; refusing to guess how columns should map`,
    );
  }
  if (headers.every((header, index) => header === desiredHeaders[index])) return false;

  const currentIndexes = new Map(headers.map((header, index) => [header, index]));
  const reorderedRows = rows.map((row) => desiredHeaders.map((header) => (
    row[currentIndexes.get(header)] ?? ''
  )));
  const target = Buffer.concat([
    Buffer.from([0xEF, 0xBB, 0xBF]),
    Buffer.from(rowsToCsv(reorderedRows), 'utf8'),
  ]);
  fs.writeFileSync(filePath, target);
  console.log(`[updateAllConfigTables] restored column order for ${tableName}`);
  return true;
}

function restoreColumnOrders(columnOrders) {
  for (const [tableName, headers] of columnOrders) {
    restoreColumnOrder(path.join(DATA_DIR, tableName), headers);
  }
}

function main() {
  validateRegistry();
  const columnOrders = captureColumnOrders();
  try {
    for (const scriptPath of getBuildScripts()) {
      runBuildScript(scriptPath);
    }
  } finally {
    // A generator may prefer a canonical internal order, but the editable CSV
    // must retain the column layout selected by the user in Excel/WPS.
    restoreColumnOrders(columnOrders);
  }
  console.log('[updateAllConfigTables] OK all config tables updated; column order preserved');
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = {
  CONFIG_TABLES,
  captureColumnOrders,
  getBuildScripts,
  listDataTables,
  readTable,
  restoreColumnOrder,
  restoreColumnOrders,
  validateRegistry,
};
