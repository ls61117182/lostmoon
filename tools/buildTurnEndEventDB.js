#!/usr/bin/env node
/**
 * data/turn_end_events.csv → assets/scripts/core/TurnEndEventDB.ts
 *
 * 工作流：改 CSV → node tools/buildTurnEndEventDB.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'turn_end_events.csv');
const OUT_PATH = path.join(ROOT, 'assets', 'scripts', 'core', 'TurnEndEventDB.ts');

const EFFECT_TYPES = [
  'sniper',
  'commander_extra',
  'infantry_spawn',
  'adjacent_infantry_fire',
  'mechanical_failure',
  'stuka',
  'panzer3_spawn',
  'road_mine',
  'panzer4_spawn',
];

function readCsvSmart(filePath) {
  const buf = fs.readFileSync(filePath);
  const hasBOM = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (_) {
    text = new TextDecoder('gbk').decode(buf);
  }
  if (!hasBOM) {
    fs.writeFileSync(filePath, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]));
    console.warn(`[buildTurnEndEventDB] ${path.basename(filePath)} 已转为 UTF-8 + BOM`);
  }
  return text;
}

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      } else cur += c;
    } else if (c === '"' && cur === '') {
      inQuote = true;
    } else if (c === ',') {
      row.push(cur); cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
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

function toRecords(rows, csvPath) {
  if (rows.length === 0) throw new Error(`${path.basename(csvPath)} 是空的`);
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map((r, idx) => {
    const obj = { __row: idx + 2 };
    headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
    return obj;
  });
}

function intOrThrow(raw, labelForError) {
  if (raw === '' || raw === undefined) throw new Error(`${labelForError}：数值为空`);
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${labelForError}：不是整数 "${raw}"`);
  return n;
}

function build() {
  const recs = toRecords(parseCSV(readCsvSmart(CSV_PATH)), CSV_PATH);
  const rows = [];
  for (const r of recs) {
    const missionId = r.mission_id;
    if (!missionId) throw new Error(`turn_end_events.csv 第 ${r.__row} 行：mission_id 为空`);
    const sumMin = intOrThrow(r.sum_min, `第 ${r.__row} 行 sum_min`);
    const sumMax = intOrThrow(r.sum_max, `第 ${r.__row} 行 sum_max`);
    const diceCount = intOrThrow(r.dice_count, `第 ${r.__row} 行 dice_count`);
    const effectType = r.effect_type;
    if (!EFFECT_TYPES.includes(effectType)) {
      throw new Error(`turn_end_events.csv 第 ${r.__row} 行：未知 effect_type="${effectType}"`);
    }
    if (sumMin > sumMax) throw new Error(`第 ${r.__row} 行：sum_min > sum_max`);
    if (diceCount < 1 || diceCount > 6) throw new Error(`第 ${r.__row} 行：dice_count 须在 1..6`);
    rows.push({ missionId, sumMin, sumMax, diceCount, effectType });
  }

  const lines = [];
  lines.push('/**');
  lines.push(' * 回合结束事件表 —— 自动生成，请勿手改。');
  lines.push(' * 数据源：data/turn_end_events.csv');
  lines.push(' * 生成：node tools/buildTurnEndEventDB.js');
  lines.push(' */');
  lines.push('');
  lines.push("export type TurnEndEffectType = " + EFFECT_TYPES.map(e => `'${e}'`).join(' | ') + ';');
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
    lines.push(`  { missionId: '${row.missionId}', sumMin: ${row.sumMin}, sumMax: ${row.sumMax}, diceCount: ${row.diceCount}, effectType: '${row.effectType}' },`);
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
  console.log(`[buildTurnEndEventDB] OK ${rows.length} rows → ${path.relative(ROOT, OUT_PATH)}`);
}

try {
  build();
} catch (e) {
  console.error('[buildTurnEndEventDB] 失败：', e.message);
  process.exit(1);
}
