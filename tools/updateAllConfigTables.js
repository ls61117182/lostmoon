#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

const CONFIG_TABLES = {
  'attack_direction_table.csv': 'tools/buildAttackDirectionDB.js',
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

function main() {
  validateRegistry();
  for (const scriptPath of getBuildScripts()) {
    runBuildScript(scriptPath);
  }
  console.log('[updateAllConfigTables] OK all config tables updated and normalized');
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
  getBuildScripts,
  listDataTables,
  validateRegistry,
};
