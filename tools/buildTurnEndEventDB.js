#!/usr/bin/env node
/**
 * data/turn_end_events.csv -> assets/scripts/core/TurnEndEventDB.ts
 *
 * Workflow:
 *   1. Edit data/turn_end_events.csv.
 *   2. Run: node tools/buildTurnEndEventDB.js
 *
 * The source table is intentionally tolerant of common spreadsheet saves:
 *   - comma CSV or tab-separated TSV
 *   - UTF-8, UTF-8 with BOM, or GBK/ANSI Chinese text
 *
 * Each run normalizes the source file back to UTF-8 with BOM + comma CSV, then
 * regenerates the runtime TypeScript database.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { readCsvRowsSmart } = require('./csvSmart');

const ROOT = path.resolve(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'turn_end_events.csv');
const OUT_PATH = path.join(ROOT, 'assets', 'scripts', 'core', 'TurnEndEventDB.ts');

const HEADERS = ['mission_id', 'sum_min', 'sum_max', 'dice_count', 'effect_type', 'notes'];

const EFFECT_TYPES = [
  'none',
  'sniper',
  'commander_extra',
  'infantry_spawn',
  'adjacent_infantry_fire',
  'mechanical_failure',
  'stuka',
  'panzer3_spawn',
  'road_mine',
  'panzer4_spawn',
  'tiger_spawn',
  'sherman_spawn',
  'german_truck_move',
  'clear_mine',
  'type95_spawn',
  'type97_spawn',
  'heavy_mortar',
];

function decodeTable(filePath) {
  const buf = fs.readFileSync(filePath);
  const hasBom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { text, encoding: hasBom ? 'utf-8-bom' : 'utf-8', hasBom };
  } catch (_) {
    const text = new TextDecoder('gbk').decode(buf);
    return { text, encoding: 'gbk', hasBom: false };
  }
}

function parseDelimited(text, delimiter) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows = [];
  let row = [];
  let cur = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"' && cur === '') {
      inQuote = true;
    } else if (c === delimiter) {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      cur += c;
    }
  }

  if (cur !== '' || row.length) {
    row.push(cur);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }

  return rows;
}

function chooseParsedRows(text) {
  const candidates = [
    { delimiter: ',', name: 'csv', rows: parseDelimited(text, ',') },
    { delimiter: '\t', name: 'tsv', rows: parseDelimited(text, '\t') },
  ];

  let best = null;
  for (const c of candidates) {
    if (!c.rows.length) continue;
    const headers = c.rows[0].map(h => h.trim().replace(/^\uFEFF/, ''));
    const hits = HEADERS.filter(h => headers.includes(h)).length;
    const widthScore = Math.max(...c.rows.map(r => r.length));
    const score = hits * 100 + widthScore;
    if (!best || score > best.score) best = { ...c, headers, score };
  }

  if (!best || HEADERS.some(h => !best.headers.includes(h))) {
    throw new Error(
      `${path.basename(CSV_PATH)} header must contain: ${HEADERS.join(', ')}`,
    );
  }

  return best;
}

function rowsToRecords(rows) {
  const headers = rows[0].map(h => h.trim().replace(/^\uFEFF/, ''));
  return rows.slice(1).map((r, idx) => {
    const obj = { __row: idx + 2 };
    headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
    return obj;
  });
}

function csvCell(value) {
  const s = String(value ?? '');
  if (/[",\r\n\t]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normalizeCsv(records) {
  const lines = [HEADERS.join(',')];
  for (const r of records) {
    lines.push(HEADERS.map(h => csvCell(r[h] ?? '')).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

function normalizeSourceFile(records, sourceInfo) {
  const normalized = normalizeCsv(records);
  const target = Buffer.concat([
    Buffer.from([0xEF, 0xBB, 0xBF]),
    Buffer.from(normalized, 'utf8'),
  ]);
  const current = fs.existsSync(CSV_PATH) ? fs.readFileSync(CSV_PATH) : Buffer.alloc(0);

  if (!current.equals(target)) {
    fs.writeFileSync(CSV_PATH, target);
    console.warn(
      `[buildTurnEndEventDB] normalized ${path.basename(CSV_PATH)} `
      + `(${sourceInfo.encoding}, ${sourceInfo.delimiterName} -> UTF-8 BOM, comma CSV)`,
    );
  }
}

function readRecordsSmart(filePath) {
  return rowsToRecords(readCsvRowsSmart(filePath, {
    toolName: 'buildTurnEndEventDB',
    requiredHeaders: HEADERS,
  }));
}

function intOrThrow(raw, labelForError) {
  if (raw === '' || raw === undefined) throw new Error(`${labelForError}: empty number`);
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${labelForError}: not an integer "${raw}"`);
  return n;
}

function validateRecords(records) {
  const rows = [];

  for (const r of records) {
    const missionId = r.mission_id;
    if (!missionId) throw new Error(`turn_end_events.csv row ${r.__row}: mission_id is empty`);

    const sumMin = intOrThrow(r.sum_min, `row ${r.__row} sum_min`);
    const sumMax = intOrThrow(r.sum_max, `row ${r.__row} sum_max`);
    const diceCount = intOrThrow(r.dice_count, `row ${r.__row} dice_count`);
    const effectType = r.effect_type;

    if (!EFFECT_TYPES.includes(effectType)) {
      throw new Error(`turn_end_events.csv row ${r.__row}: unknown effect_type="${effectType}"`);
    }
    if (sumMin > sumMax) throw new Error(`row ${r.__row}: sum_min > sum_max`);
    if (diceCount < 1 || diceCount > 6) throw new Error(`row ${r.__row}: dice_count must be 1..6`);

    rows.push({ missionId, sumMin, sumMax, diceCount, effectType });
  }

  return rows;
}

function buildTs(rows) {
  const lines = [];
  lines.push('/**');
  lines.push(' * 回合结束事件表 - 自动生成，请勿手改。');
  lines.push(' * 数据源：data/turn_end_events.csv');
  lines.push(' * 生成：node tools/buildTurnEndEventDB.js');
  lines.push(' */');
  lines.push('');
  lines.push(`export type TurnEndEffectType = ${EFFECT_TYPES.map(e => `'${e}'`).join(' | ')};`);
  lines.push('');
  lines.push('export interface TurnEndEventRow {');
  lines.push('  missionId: string;');
  lines.push('  sumMin: number;');
  lines.push('  sumMax: number;');
  lines.push('  diceCount: number;');
  lines.push('  effectType: TurnEndEffectType;');
  lines.push('}');
  lines.push('');
  lines.push('export const TURN_END_EVENTS: TurnEndEventRow[] = [');
  for (const row of rows) {
    lines.push(
      `  { missionId: '${row.missionId}', sumMin: ${row.sumMin}, `
      + `sumMax: ${row.sumMax}, diceCount: ${row.diceCount}, effectType: '${row.effectType}' },`,
    );
  }
  lines.push('];');
  lines.push('');
  lines.push('/** 某关是否配置了回合结束事件（至少一行） */');
  lines.push('export function hasTurnEndEvents(missionId: string): boolean {');
  lines.push('  return TURN_END_EVENTS.some(r => r.missionId === missionId);');
  lines.push('}');
  lines.push('');
  lines.push('/** 按 2d6 之和（或 diceCount 颗骰之和）查本关命中哪一行；无匹配返回 null */');
  lines.push('export function turnEndRowForSum(missionId: string, sum: number): TurnEndEventRow | null {');
  lines.push('  const hit = TURN_END_EVENTS.filter(r => r.missionId === missionId && sum >= r.sumMin && sum <= r.sumMax);');
  lines.push('  if (hit.length === 0) return null;');
  lines.push('  if (hit.length > 1) return hit[0];');
  lines.push('  return hit[0];');
  lines.push('}');
  lines.push('');
  lines.push('/** 当前关卡全部回合结束事件行（按 sum 区间升序） */');
  lines.push('export function turnEndEventsForMission(missionId: string): TurnEndEventRow[] {');
  lines.push('  return TURN_END_EVENTS');
  lines.push('    .filter(r => r.missionId === missionId)');
  lines.push('    .sort((a, b) => a.sumMin - b.sumMin || a.sumMax - b.sumMax);');
  lines.push('}');
  lines.push('');

  fs.writeFileSync(OUT_PATH, lines.join('\n'), 'utf8');
}

function build() {
  const records = readRecordsSmart(CSV_PATH);
  const rows = validateRecords(records);
  buildTs(rows);
  console.log(`[buildTurnEndEventDB] OK ${rows.length} rows -> ${path.relative(ROOT, OUT_PATH)}`);
}

try {
  build();
} catch (e) {
  console.error('[buildTurnEndEventDB] failed:', e.message);
  process.exit(1);
}
