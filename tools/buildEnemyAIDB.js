#!/usr/bin/env node
/**
 * data/enemy_ai_table.csv + data/enemy_ai_dice.csv
 *   → assets/scripts/core/EnemyAIDB.ts
 *
 * 对应 GDD §3.7：
 *   - 骰数表：起始格地形 / 受损 → 掷骰数（road 4 / field 4 / mud 3 / damaged 2）
 *   - 行动表：列 × 骰面 1..6 → 主行动 primary + 可选降级 fallback
 *
 * 零依赖 Node 18+。策划改完 CSV 后跑一下 `node tools/buildEnemyAIDB.js` 即可。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TABLE_CSV = path.join(ROOT, 'data', 'enemy_ai_table.csv');
const DICE_CSV = path.join(ROOT, 'data', 'enemy_ai_dice.csv');
const OUT_PATH = path.join(ROOT, 'assets', 'scripts', 'core', 'EnemyAIDB.ts');

const AI_COLUMNS = ['road', 'field', 'mud', 'damaged'];
const AI_ACTIONS = ['shoot', 'turn', 'advance', 'reverse', 'smoke', 'repair', 'none'];

function readCsvSmart(filePath) {
  const buf = fs.readFileSync(filePath);
  const hasBOM = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;

  let text;
  let label;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    label = hasBOM ? 'UTF-8 (with BOM)' : 'UTF-8 (no BOM)';
  } catch (_) {
    text = new TextDecoder('gbk').decode(buf);
    label = 'GBK (Windows 中文 Excel 默认)';
  }
  if (!hasBOM || label.startsWith('GBK')) {
    const fixed = Buffer.concat([
      Buffer.from([0xEF, 0xBB, 0xBF]),
      Buffer.from(text, 'utf8'),
    ]);
    fs.writeFileSync(filePath, fixed);
    console.warn(`[buildEnemyAIDB] 注意：${path.basename(filePath)} 原编码 ${label}，已转为 UTF-8 + BOM`);
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

function parseAITable() {
  const recs = toRecords(parseCSV(readCsvSmart(TABLE_CSV)), TABLE_CSV);
  // table[col][pip] = { primary, fallback? }
  const table = {};
  for (const c of AI_COLUMNS) table[c] = {};
  const seen = new Set();
  for (const r of recs) {
    const col = r.column;
    const die = Number(r.die);
    if (!AI_COLUMNS.includes(col)) {
      throw new Error(`enemy_ai_table.csv 第 ${r.__row} 行：未知 column="${col}"，必须是 ${AI_COLUMNS.join(' / ')}`);
    }
    if (!Number.isInteger(die) || die < 1 || die > 6) {
      throw new Error(`enemy_ai_table.csv 第 ${r.__row} 行：die="${r.die}" 不是 1..6 的整数`);
    }
    const key = `${col}:${die}`;
    if (seen.has(key)) throw new Error(`enemy_ai_table.csv 第 ${r.__row} 行：(${col}, ${die}) 重复`);
    seen.add(key);

    const primary = r.primary || 'none';
    if (!AI_ACTIONS.includes(primary)) {
      throw new Error(`enemy_ai_table.csv 第 ${r.__row} 行：primary="${primary}" 不在 {${AI_ACTIONS.join(' / ')}}`);
    }
    let fallback = r.fallback;
    if (fallback === '' || fallback === undefined) fallback = undefined;
    else if (!AI_ACTIONS.includes(fallback)) {
      throw new Error(`enemy_ai_table.csv 第 ${r.__row} 行：fallback="${fallback}" 不在 {${AI_ACTIONS.join(' / ')}}`);
    }
    table[col][die] = { primary, fallback };
  }
  // 必须每列都有 1..6 全覆盖
  for (const c of AI_COLUMNS) {
    for (let p = 1; p <= 6; p++) {
      if (!table[c][p]) throw new Error(`enemy_ai_table.csv 缺少 (column=${c}, die=${p}) 这一行`);
    }
  }
  return table;
}

function parseAIDice() {
  const recs = toRecords(parseCSV(readCsvSmart(DICE_CSV)), DICE_CSV);
  const map = {};
  const seen = new Set();
  for (const r of recs) {
    const col = r.column;
    const dice = Number(r.dice);
    if (!AI_COLUMNS.includes(col)) {
      throw new Error(`enemy_ai_dice.csv 第 ${r.__row} 行：未知 column="${col}"`);
    }
    if (seen.has(col)) {
      throw new Error(`enemy_ai_dice.csv 第 ${r.__row} 行：column="${col}" 重复`);
    }
    if (!Number.isInteger(dice) || dice <= 0) {
      throw new Error(`enemy_ai_dice.csv 第 ${r.__row} 行：dice="${r.dice}" 必须是正整数`);
    }
    seen.add(col);
    map[col] = dice;
  }
  for (const c of AI_COLUMNS) {
    if (!(c in map)) throw new Error(`enemy_ai_dice.csv 缺少 column="${c}" 这一行`);
  }
  return map;
}

function build() {
  const table = parseAITable();
  const dice = parseAIDice();

  const lines = [];
  lines.push('/**');
  lines.push(' * 德军坦克 AI 行动表与骰数 —— 自动生成，请勿手改本文件。');
  lines.push(' *');
  lines.push(' * 数据源：data/enemy_ai_table.csv + data/enemy_ai_dice.csv');
  lines.push(' * 重新生成：node tools/buildEnemyAIDB.js');
  lines.push(' * 对应 GDD §3.7 行动表 + 掷骰数。');
  lines.push(' */');
  lines.push('');
  lines.push('/** 敌方 AI 单颗骰能产出的具体行动 */');
  lines.push('export type EnemyAction =');
  for (let i = 0; i < AI_ACTIONS.length; i++) {
    const a = AI_ACTIONS[i];
    const pipe = i === AI_ACTIONS.length - 1 ? ';' : '';
    lines.push(`  | '${a}'${pipe}`);
  }
  lines.push('');
  lines.push('/** 一颗骰的 A>B 条目；无 fallback 则只执行 primary */');
  lines.push('export interface AIActionEntry {');
  lines.push('  primary: EnemyAction;');
  lines.push('  fallback?: EnemyAction;');
  lines.push('}');
  lines.push('');
  lines.push('/** AI 表的列键：地形或"受损"（受损优先于地形） */');
  lines.push(`export type AIColumn = ${AI_COLUMNS.map(c => `'${c}'`).join(' | ')};`);
  lines.push('');
  lines.push('/** 列 → (1..6) → 行动条目 */');
  lines.push('export type AIActionTable = Record<AIColumn, Record<number, AIActionEntry>>;');
  lines.push('');
  lines.push('/** 每列掷多少颗骰（GDD §3.7 骰数表） */');
  lines.push('export const AI_DICE_COUNT: Record<AIColumn, number> = {');
  for (const c of AI_COLUMNS) lines.push(`  ${c}: ${dice[c]},`);
  lines.push('};');
  lines.push('');
  lines.push('/** 默认 AI 行动表（数据源 enemy_ai_table.csv；各关可按需覆盖） */');
  lines.push('export const DEFAULT_AI_TABLE: AIActionTable = {');
  for (const c of AI_COLUMNS) {
    lines.push(`  ${c}: {`);
    for (let p = 1; p <= 6; p++) {
      const e = table[c][p];
      const fb = e.fallback ? `, fallback: '${e.fallback}'` : '';
      lines.push(`    ${p}: { primary: '${e.primary}'${fb} },`);
    }
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');

  fs.writeFileSync(OUT_PATH, lines.join('\n'), 'utf8');
  console.log(
    `[buildEnemyAIDB] OK  ${AI_COLUMNS.length}×6 rows + ${AI_COLUMNS.length} dice rows `
    + `→ ${path.relative(ROOT, OUT_PATH)}`
  );
}

try {
  build();
} catch (e) {
  console.error('[buildEnemyAIDB] 失败：', e.message);
  process.exit(1);
}
