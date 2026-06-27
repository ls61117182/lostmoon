#!/usr/bin/env node
/**
 * data/units.csv -> assets/scripts/core/UnitDB.ts
 *
 * Source of truth for unit profiles. Keep gameplay-facing values in the CSV,
 * then run this generator to refresh the TypeScript DB.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { readCsvRowsSmart } = require('./csvSmart');

const ROOT = path.resolve(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'units.csv');
const OUT_PATH = path.join(ROOT, 'assets', 'scripts', 'core', 'UnitDB.ts');
const DAMAGE_CSV_PATH = path.join(ROOT, 'data', 'damage_table.csv');

const NUM_FIELDS = ['size', 'armorFront', 'armorFrontSide', 'armorRearSide', 'armorRear', 'penetration', 'effectiveRange', 'usCasualtyDice', 'visionRange'];
const BOOL_FIELDS = ['hasRadio'];
const STRING_FIELDS = ['moveSound', 'attackSound', 'visionType', 'damageTargetClass'];
const BONUS_FIELDS = ['infantryTankCoordination'];
const FACTIONS = ['allied', 'german', 'japanese'];
const VISION_TYPES = ['turreted', 'fixed', 'infantry'];
const REQUIRED_HEADERS = ['unitKind', 'displayName', 'faction', ...NUM_FIELDS, ...BOOL_FIELDS, ...STRING_FIELDS, ...BONUS_FIELDS, 'notes'];
const REQUIRED_KINDS = ['sherman', 'tiger', 'panzer4', 'panzer3', 'truck', 'infantry', 'officer', 'type95', 'type97', 'at_gun', 'japanese_infantry', 'heavy_artillery'];

function readCsvSmart(filePath) {
  const buf = fs.readFileSync(filePath);
  const hasBOM = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;

  let text;
  let sourceLabel;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    sourceLabel = hasBOM ? 'UTF-8 (with BOM)' : 'UTF-8 (no BOM)';
  } catch (_) {
    text = new TextDecoder('gbk').decode(buf);
    sourceLabel = 'GBK';
  }

  if (!hasBOM || sourceLabel === 'GBK') {
    const fixed = Buffer.concat([
      Buffer.from([0xEF, 0xBB, 0xBF]),
      Buffer.from(text, 'utf8'),
    ]);
    fs.writeFileSync(filePath, fixed);
    console.warn(`[buildUnitDB] normalized CSV encoding from ${sourceLabel} to UTF-8+BOM`);
  }
  return text;
}

function detectDelimiter(text) {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  return tabCount > commaCount ? '\t' : ',';
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsvUtf8Bom(filePath, rows) {
  const text = rows.map(row => row.map(csvEscape).join(',')).join('\r\n') + '\r\n';
  fs.writeFileSync(filePath, Buffer.concat([
    Buffer.from([0xEF, 0xBB, 0xBF]),
    Buffer.from(text, 'utf8'),
  ]));
}

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const delimiter = detectDelimiter(text);
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

function toRecords(rows) {
  if (rows.length === 0) throw new Error('CSV is empty');
  const headers = rows[0].map(h => h.trim());
  for (const h of REQUIRED_HEADERS) {
    if (!headers.includes(h)) throw new Error(`CSV missing required header "${h}"`);
  }
  return rows.slice(1).map((r, idx) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
    obj.__row = idx + 2;
    return obj;
  });
}

function intOrThrow(rec, field) {
  const raw = rec[field];
  if (raw === '' || raw === undefined) {
    throw new Error(`row ${rec.__row} ${rec.unitKind || '?'}: field ${field} is empty`);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`row ${rec.__row} ${rec.unitKind || '?'}: field ${field}="${raw}" is not a non-negative integer`);
  }
  return n;
}

function jsString(s) {
  return JSON.stringify(s ?? '');
}

function boolOrThrow(rec, field) {
  const raw = String(rec[field] ?? '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'y') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'n') return false;
  throw new Error(`row ${rec.__row} ${rec.unitKind || '?'}: field ${field}="${rec[field]}" is not a boolean`);
}

function readDamageTargetClasses() {
  const rows = readCsvRowsSmart(DAMAGE_CSV_PATH, {
    toolName: 'buildUnitDB',
    requiredHeaders: ['targetClass', 'damageCheckType', 'die', 'effects', 'notes'],
  });
  const headers = rows[0].map(h => h.trim().replace(/^\uFEFF/, ''));
  const targetClassIdx = headers.indexOf('targetClass');
  return new Set(rows.slice(1).map(row => (row[targetClassIdx] ?? '').trim()).filter(Boolean));
}

function build() {
  const rows = readCsvRowsSmart(CSV_PATH, {
    toolName: 'buildUnitDB',
    requiredHeaders: REQUIRED_HEADERS,
  });
  const records = toRecords(rows);
  const damageTargetClasses = readDamageTargetClasses();

  const seen = new Set();
  for (const rec of records) {
    if (!rec.unitKind) throw new Error(`row ${rec.__row}: unitKind is empty`);
    if (!REQUIRED_KINDS.includes(rec.unitKind)) {
      throw new Error(`row ${rec.__row}: unknown unitKind="${rec.unitKind}", expected one of ${REQUIRED_KINDS.join(' / ')}`);
    }
    if (seen.has(rec.unitKind)) {
      throw new Error(`row ${rec.__row}: duplicate unitKind="${rec.unitKind}"`);
    }
    seen.add(rec.unitKind);
    if (!FACTIONS.includes(rec.faction)) {
      throw new Error(`row ${rec.__row} ${rec.unitKind}: faction="${rec.faction}" must be ${FACTIONS.join(' / ')}`);
    }
    if (!VISION_TYPES.includes(rec.visionType)) {
      throw new Error(`row ${rec.__row} ${rec.unitKind}: visionType="${rec.visionType}" must be ${VISION_TYPES.join(' / ')}`);
    }
    if (!damageTargetClasses.has(rec.damageTargetClass)) {
      throw new Error(`row ${rec.__row} ${rec.unitKind}: damageTargetClass="${rec.damageTargetClass}" must be one of data/damage_table.csv targetClass values`);
    }
  }
  for (const k of REQUIRED_KINDS) {
    if (!seen.has(k)) throw new Error(`CSV missing unitKind="${k}"`);
  }

  for (const rec of records) {
    for (const f of NUM_FIELDS) intOrThrow(rec, f);
    for (const f of BONUS_FIELDS) intOrThrow(rec, f);
  }

  const lines = [];
  lines.push('/**');
  lines.push(' * Unit data DB - generated automatically. Do not edit this file by hand.');
  lines.push(' *');
  lines.push(' * Source: data/units.csv');
  lines.push(' * Regenerate: node tools/buildUnitDB.js');
  lines.push(' */');
  lines.push('');
  lines.push("import { Theater, UnitKind, UnitStats } from './types';");
  lines.push('');
  lines.push('const DB: Record<UnitKind, UnitStats> = {');
  for (const k of REQUIRED_KINDS) {
    const r = records.find(x => x.unitKind === k);
    const name = r.displayName || k;
    const note = r.notes ? ` - ${r.notes}` : '';
    lines.push(`  ${k}: { // ${name}${note}`);
    lines.push(`    faction: ${jsString(r.faction)},`);
    lines.push(
      `    size: ${r.size}, ` +
      `armorFront: ${r.armorFront}, ` +
      `armorFrontSide: ${r.armorFrontSide}, ` +
      `armorRearSide: ${r.armorRearSide}, ` +
      `armorRear: ${r.armorRear}, ` +
      `penetration: ${r.penetration}, ` +
      `effectiveRange: ${r.effectiveRange}, ` +
      `usCasualtyDice: ${r.usCasualtyDice}, ` +
      `visionRange: ${r.visionRange},`
    );
    for (const f of BOOL_FIELDS) {
      lines.push(`    ${f}: ${boolOrThrow(r, f)},`);
    }
    for (const f of STRING_FIELDS) {
      lines.push(`    ${f}: ${jsString(r[f])},`);
    }
    for (const f of BONUS_FIELDS) {
      lines.push(`    ${f}: ${intOrThrow(r, f)},`);
    }
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  lines.push('const PACIFIC_OVERRIDES: Partial<Record<UnitKind, Partial<UnitStats>>> = {');
  lines.push('  sherman: {');
  lines.push('    size: 4, armorFront: 11, armorFrontSide: 10, armorRearSide: 9, armorRear: 8, penetration: 2, usCasualtyDice: 0,');
  lines.push('  },');
  lines.push('};');
  lines.push('');
  lines.push("export function getUnitStats(kind: UnitKind, theater: Theater = 'europe'): UnitStats {");
  lines.push('  const base = DB[kind];');
  lines.push("  const override = theater === 'pacific' ? PACIFIC_OVERRIDES[kind] : undefined;");
  lines.push('  return { ...base, ...(override ?? {}) };');
  lines.push('}');
  lines.push('');

  fs.writeFileSync(OUT_PATH, lines.join('\n'), 'utf8');
  console.log(`[buildUnitDB] OK ${records.length} units -> ${path.relative(ROOT, OUT_PATH)}`);
}

try {
  build();
} catch (e) {
  console.error('[buildUnitDB] failed:', e.message);
  process.exit(1);
}
