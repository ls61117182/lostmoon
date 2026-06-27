#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { readCsvRowsSmart } = require('./csvSmart');

const ROOT = path.resolve(__dirname, '..');
const TABLE_CSV = path.join(ROOT, 'data', 'enemy_ai_table.csv');
const DICE_CSV = path.join(ROOT, 'data', 'enemy_ai_dice.csv');
const HARDCORE_TANK_ACTION_CSV = path.join(ROOT, 'data', 'enemy_hardcore_tank_action_table.csv');
const HARDCORE_TANK_DICE_CSV = path.join(ROOT, 'data', 'enemy_hardcore_tank_dice.csv');
const OUT_PATH = path.join(ROOT, 'assets', 'scripts', 'core', 'EnemyAIDB.ts');

const AI_COLUMNS = ['road', 'field', 'mud', 'damaged', 'type95', 'type97', 'at_gun', 'japanese_infantry', 'heavy_artillery'];
const HARDCORE_TANK_DIE_TYPES = ['attack', 'move'];
const HARDCORE_TANK_TERRAINS = ['road', 'field', 'mud', 'clear', 'trees', 'beach', 'airstrip'];
const AI_ACTIONS = [
  'shoot',
  'turn',
  'advance',
  'reverse',
  'smoke',
  'repair',
  'conceal',
  'shoot_adjacent',
  'infantry_move',
  'advance_to_building',
  'hull_down',
  'none',
];

function toRecords(rows, csvPath) {
  if (rows.length === 0) throw new Error(`${path.basename(csvPath)} is empty`);
  const headers = rows[0].map(h => h.trim().replace(/^\uFEFF/, ''));
  return rows.slice(1).map((r, idx) => {
    const obj = { __row: idx + 2 };
    headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
    return obj;
  });
}

function parseActionEntry(row, csvName, rowNo) {
  const primary = row.primary || 'none';
  if (!AI_ACTIONS.includes(primary)) {
    throw new Error(`${csvName} row ${rowNo}: primary="${primary}" is invalid`);
  }
  let fallback = row.fallback;
  if (fallback === '' || fallback === undefined) fallback = undefined;
  else if (!AI_ACTIONS.includes(fallback)) {
    throw new Error(`${csvName} row ${rowNo}: fallback="${fallback}" is invalid`);
  }
  let fallback2 = row.fallback2;
  if (fallback2 === '' || fallback2 === undefined) fallback2 = undefined;
  else if (!AI_ACTIONS.includes(fallback2)) {
    throw new Error(`${csvName} row ${rowNo}: fallback2="${fallback2}" is invalid`);
  }
  return { primary, fallback, fallback2 };
}

function parseAITable() {
  const recs = toRecords(readCsvRowsSmart(TABLE_CSV, {
    toolName: 'buildEnemyAIDB',
    requiredHeaders: ['column', 'die', 'primary'],
  }), TABLE_CSV);
  const table = {};
  for (const c of AI_COLUMNS) table[c] = {};
  const seen = new Set();
  for (const r of recs) {
    const col = r.column;
    const die = Number(r.die);
    if (!AI_COLUMNS.includes(col)) {
      throw new Error(`enemy_ai_table.csv row ${r.__row}: unknown column="${col}"`);
    }
    if (!Number.isInteger(die) || die < 1 || die > 6) {
      throw new Error(`enemy_ai_table.csv row ${r.__row}: die="${r.die}" is not 1..6`);
    }
    const key = `${col}:${die}`;
    if (seen.has(key)) throw new Error(`enemy_ai_table.csv row ${r.__row}: duplicate (${col}, ${die})`);
    seen.add(key);
    table[col][die] = parseActionEntry(r, 'enemy_ai_table.csv', r.__row);
  }
  for (const c of AI_COLUMNS) {
    for (let p = 1; p <= 6; p++) {
      if (!table[c][p]) throw new Error(`enemy_ai_table.csv missing column=${c}, die=${p}`);
    }
  }
  return table;
}

function parseAIDice() {
  const recs = toRecords(readCsvRowsSmart(DICE_CSV, {
    toolName: 'buildEnemyAIDB',
    requiredHeaders: ['column', 'dice'],
  }), DICE_CSV);
  const map = {};
  const seen = new Set();
  for (const r of recs) {
    const col = r.column;
    const dice = Number(r.dice);
    if (!AI_COLUMNS.includes(col)) {
      throw new Error(`enemy_ai_dice.csv row ${r.__row}: unknown column="${col}"`);
    }
    if (seen.has(col)) throw new Error(`enemy_ai_dice.csv row ${r.__row}: duplicate column="${col}"`);
    if (!Number.isInteger(dice) || dice <= 0) {
      throw new Error(`enemy_ai_dice.csv row ${r.__row}: dice="${r.dice}" must be a positive integer`);
    }
    seen.add(col);
    map[col] = dice;
  }
  for (const c of AI_COLUMNS) {
    if (!(c in map)) throw new Error(`enemy_ai_dice.csv missing column="${c}"`);
  }
  return map;
}

function parseHardcoreTankActionTable() {
  const recs = toRecords(readCsvRowsSmart(HARDCORE_TANK_ACTION_CSV, {
    toolName: 'buildEnemyAIDB',
    requiredHeaders: ['die_type', 'die', 'primary'],
  }), HARDCORE_TANK_ACTION_CSV);
  const table = {};
  for (const type of HARDCORE_TANK_DIE_TYPES) table[type] = {};
  const seen = new Set();
  for (const r of recs) {
    const type = r.die_type;
    const die = Number(r.die);
    if (!HARDCORE_TANK_DIE_TYPES.includes(type)) {
      throw new Error(`enemy_hardcore_tank_action_table.csv row ${r.__row}: unknown die_type="${type}"`);
    }
    if (!Number.isInteger(die) || die < 1 || die > 6) {
      throw new Error(`enemy_hardcore_tank_action_table.csv row ${r.__row}: die="${r.die}" is not 1..6`);
    }
    const key = `${type}:${die}`;
    if (seen.has(key)) throw new Error(`enemy_hardcore_tank_action_table.csv row ${r.__row}: duplicate (${type}, ${die})`);
    seen.add(key);
    table[type][die] = parseActionEntry(r, 'enemy_hardcore_tank_action_table.csv', r.__row);
  }
  for (const type of HARDCORE_TANK_DIE_TYPES) {
    for (let p = 1; p <= 6; p++) {
      if (!table[type][p]) throw new Error(`enemy_hardcore_tank_action_table.csv missing die_type=${type}, die=${p}`);
    }
  }
  return table;
}

function parseHardcoreTankDice() {
  const recs = toRecords(readCsvRowsSmart(HARDCORE_TANK_DICE_CSV, {
    toolName: 'buildEnemyAIDB',
    requiredHeaders: ['terrain', 'attack_dice', 'move_dice'],
  }), HARDCORE_TANK_DICE_CSV);
  const map = {};
  const seen = new Set();
  for (const r of recs) {
    const terrain = r.terrain;
    if (!HARDCORE_TANK_TERRAINS.includes(terrain)) {
      throw new Error(`enemy_hardcore_tank_dice.csv row ${r.__row}: unknown terrain="${terrain}"`);
    }
    if (seen.has(terrain)) throw new Error(`enemy_hardcore_tank_dice.csv row ${r.__row}: duplicate terrain="${terrain}"`);
    const attack = Number(r.attack_dice);
    const move = Number(r.move_dice);
    if (!Number.isInteger(attack)) {
      throw new Error(`enemy_hardcore_tank_dice.csv row ${r.__row}: attack_dice="${r.attack_dice}" must be an integer`);
    }
    if (!Number.isInteger(move)) {
      throw new Error(`enemy_hardcore_tank_dice.csv row ${r.__row}: move_dice="${r.move_dice}" must be an integer`);
    }
    seen.add(terrain);
    map[terrain] = { attack, move };
  }
  for (const terrain of HARDCORE_TANK_TERRAINS) {
    if (!map[terrain]) throw new Error(`enemy_hardcore_tank_dice.csv missing terrain="${terrain}"`);
  }
  return map;
}

function emitEntry(e) {
  const fb = e.fallback ? `, fallback: '${e.fallback}'` : '';
  const fb2 = e.fallback2 ? `, fallback2: '${e.fallback2}'` : '';
  return `{ primary: '${e.primary}'${fb}${fb2} }`;
}

function build() {
  const table = parseAITable();
  const dice = parseAIDice();
  const hardcoreTankTable = parseHardcoreTankActionTable();
  const hardcoreTankDice = parseHardcoreTankDice();

  const lines = [];
  lines.push('/**');
  lines.push(' * Enemy AI action tables and dice counts. Auto-generated; do not edit by hand.');
  lines.push(' *');
  lines.push(' * Sources: data/enemy_ai_table.csv, data/enemy_ai_dice.csv,');
  lines.push(' * data/enemy_hardcore_tank_action_table.csv, data/enemy_hardcore_tank_dice.csv');
  lines.push(' * Regenerate: node tools/buildEnemyAIDB.js');
  lines.push(' */');
  lines.push('');
  lines.push('export type EnemyAction =');
  for (let i = 0; i < AI_ACTIONS.length; i++) {
    const pipe = i === AI_ACTIONS.length - 1 ? ';' : '';
    lines.push(`  | '${AI_ACTIONS[i]}'${pipe}`);
  }
  lines.push('');
  lines.push('export interface AIActionEntry {');
  lines.push('  primary: EnemyAction;');
  lines.push('  fallback?: EnemyAction;');
  lines.push('  fallback2?: EnemyAction;');
  lines.push('}');
  lines.push('');
  lines.push(`export type AIColumn = ${AI_COLUMNS.map(c => `'${c}'`).join(' | ')};`);
  lines.push(`export type EnemyTankDieType = ${HARDCORE_TANK_DIE_TYPES.map(c => `'${c}'`).join(' | ')};`);
  lines.push(`export type HardcoreTankDiceTerrain = ${HARDCORE_TANK_TERRAINS.map(c => `'${c}'`).join(' | ')};`);
  lines.push('');
  lines.push('export interface HardcoreTankDiceCount {');
  lines.push('  attack: number;');
  lines.push('  move: number;');
  lines.push('}');
  lines.push('');
  lines.push('export type AIActionTable = Record<AIColumn, Record<number, AIActionEntry>>;');
  lines.push('export type HardcoreTankActionTable = Record<EnemyTankDieType, Record<number, AIActionEntry>>;');
  lines.push('');
  lines.push('export const AI_DICE_COUNT: Record<AIColumn, number> = {');
  for (const c of AI_COLUMNS) lines.push(`  ${c}: ${dice[c]},`);
  lines.push('};');
  lines.push('');
  lines.push('export const DEFAULT_AI_TABLE: AIActionTable = {');
  for (const c of AI_COLUMNS) {
    lines.push(`  ${c}: {`);
    for (let p = 1; p <= 6; p++) lines.push(`    ${p}: ${emitEntry(table[c][p])},`);
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  lines.push('export const HARDCORE_TANK_AI_DICE_COUNT: Record<HardcoreTankDiceTerrain, HardcoreTankDiceCount> = {');
  for (const terrain of HARDCORE_TANK_TERRAINS) {
    const row = hardcoreTankDice[terrain];
    lines.push(`  ${terrain}: { attack: ${row.attack}, move: ${row.move} },`);
  }
  lines.push('};');
  lines.push('');
  lines.push('export const HARDCORE_TANK_AI_TABLE: HardcoreTankActionTable = {');
  for (const type of HARDCORE_TANK_DIE_TYPES) {
    lines.push(`  ${type}: {`);
    for (let p = 1; p <= 6; p++) lines.push(`    ${p}: ${emitEntry(hardcoreTankTable[type][p])},`);
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');

  fs.writeFileSync(OUT_PATH, lines.join('\n'), 'utf8');
  console.log(
    `[buildEnemyAIDB] OK ${AI_COLUMNS.length}x6 legacy rows, `
    + `${HARDCORE_TANK_DIE_TYPES.length}x6 hardcore tank rows -> ${path.relative(ROOT, OUT_PATH)}`,
  );
}

try {
  build();
} catch (e) {
  console.error('[buildEnemyAIDB] failed:', e.message);
  process.exit(1);
}
