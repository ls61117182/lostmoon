#!/usr/bin/env node
/**
 * data/lang.csv  →  assets/scripts/core/LangDB.ts
 *
 * 本地化工作流：
 *   1. 用 Excel 打开 data/lang.csv，编辑 zh / en 两列（key 列不能改）
 *   2. "另存为 CSV UTF-8（逗号分隔）" 覆盖原文件
 *   3. 在项目根目录执行：node tools/buildLangDB.js
 *   4. LangDB.ts 会被自动重写；Cocos Creator 预览即可看到新文案
 *
 * 设计约定：
 *   - CSV 必须恰好三列：key, zh, en；三列都不允许为空
 *   - key 在整张表内必须唯一；重复或空 key 都会报错
 *   - zh / en 中允许 {name} 形式的占位符，由运行时 t(key, params) 替换
 *   - zh / en 中允许 \n（两个字符：反斜杠 + n），运行时会转成真正的换行
 *   - 此脚本零依赖，纯 Node.js 18+ 即可运行
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { readCsvRowsSmart } = require('./csvSmart');

const ROOT = path.resolve(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'lang.csv');
const OUT_PATH = path.join(ROOT, 'assets', 'scripts', 'core', 'LangDB.ts');

/**
 * 兼容编码读 CSV：优先 UTF-8 严格解码，失败就 fallback 到 GBK。
 * 如果文件不是 "UTF-8 + BOM"，自动重写为 UTF-8 + BOM，保持仓库编码一致。
 */
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
    sourceLabel = 'GBK (Windows 中文 Excel 默认)';
  }

  if (!hasBOM || sourceLabel.startsWith('GBK')) {
    const fixed = Buffer.concat([
      Buffer.from([0xEF, 0xBB, 0xBF]),
      Buffer.from(text, 'utf8'),
    ]);
    fs.writeFileSync(filePath, fixed);
    console.warn(`[buildLangDB] 注意：CSV 原编码为 ${sourceLabel}，已自动转为 UTF-8 + BOM 并保存`);
  }
  return text;
}

/**
 * 极简 CSV 解析：支持双引号包裹、字段内逗号、双引号转义（""）。
 * 不做任何 trim，保持值里的前后空格（文案可能故意以空格开头/结尾做分隔）。
 */
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
      } else {
        cur += c;
      }
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

/** 把字符串里的字面量 `\` + `n` / `"` 等转义成可直接嵌入 TS 源码的双引号字符串字面量。 */
function escapeForTs(s) {
  return s
    .replace(/\\/g, '\\\\')   // 先转义反斜杠自身
    .replace(/"/g, '\\"')     // 再转义引号
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function build() {
  const rows = readCsvRowsSmart(CSV_PATH, {
    toolName: 'buildLangDB',
    requiredHeaders: ['key', 'zh', 'en'],
  });
  if (rows.length < 2) throw new Error('lang.csv 除表头外没有任何行');

  const headers = rows[0];
  if (headers.length < 3 || headers[0] !== 'key' || headers[1] !== 'zh' || headers[2] !== 'en') {
    throw new Error(`lang.csv 表头必须是 "key,zh,en"，当前为 "${headers.join(',')}"`);
  }

  const entries = [];
  const seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const key = (r[0] ?? '').trim();
    const zh = r[1] ?? '';
    const en = r[2] ?? '';
    const rowNo = i + 1;
    if (!key) throw new Error(`第 ${rowNo} 行 key 为空`);
    if (seen.has(key)) throw new Error(`第 ${rowNo} 行 key="${key}" 重复`);
    if (zh === '') throw new Error(`第 ${rowNo} 行 key="${key}": zh 为空`);
    if (en === '') throw new Error(`第 ${rowNo} 行 key="${key}": en 为空`);
    seen.add(key);
    entries.push({ key, zh, en });
  }

  // 生成 TS
  const lines = [];
  lines.push('/**');
  lines.push(' * 本地化文案 —— 自动生成，请勿手改本文件。');
  lines.push(' *');
  lines.push(' * 数据源：data/lang.csv');
  lines.push(' * 重新生成：node tools/buildLangDB.js');
  lines.push(' */');
  lines.push('');
  lines.push('export interface LangEntry {');
  lines.push('  zh: string;');
  lines.push('  en: string;');
  lines.push('}');
  lines.push('');
  lines.push('export const LANG_DB: Record<string, LangEntry> = {');
  for (const e of entries) {
    lines.push(`  '${e.key}': { zh: "${escapeForTs(e.zh)}", en: "${escapeForTs(e.en)}" },`);
  }
  lines.push('};');
  lines.push('');

  fs.writeFileSync(OUT_PATH, lines.join('\n'), 'utf8');
  console.log(`[buildLangDB] OK  ${entries.length} keys → ${path.relative(ROOT, OUT_PATH)}`);
}

try {
  build();
} catch (e) {
  console.error('[buildLangDB] 失败：', e.message);
  process.exit(1);
}
