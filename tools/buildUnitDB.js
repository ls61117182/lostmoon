#!/usr/bin/env node
/**
 * data/units.csv  →  assets/scripts/core/UnitDB.ts
 *
 * 数值策划工作流：
 *   1. 用 Excel 打开 data/units.csv，改数值（行 = 单位；列 = 各装甲面 / 穿甲）
 *   2. 在 Excel 里"另存为 CSV UTF-8（逗号分隔）"，覆盖原文件
 *   3. 在项目根目录执行：node tools/buildUnitDB.js
 *   4. UnitDB.ts 会被自动重写；Cocos Creator 预览即可看到新数值
 *
 * 设计约定：
 *   - CSV 第 1 列 unitKind 必须与 types.ts 里 UnitKind 字面量一致
 *   - displayName / notes 仅作为生成代码的注释，对运行无影响
 *   - 任何数字列必须是整数；非法值会让脚本报错并拒绝写文件，避免污染游戏代码
 *   - 此脚本零依赖，纯 Node.js 18+ 即可运行
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'units.csv');
const OUT_PATH = path.join(ROOT, 'assets', 'scripts', 'core', 'UnitDB.ts');

// 与 UnitStats 对齐的数字字段；顺序决定生成 TS 时的属性顺序
const NUM_FIELDS = ['size', 'armorFront', 'armorFrontSide', 'armorRearSide', 'armorRear', 'penetration'];

// 与 UnitKind 对齐的合法 kind 名单；缺一行或多一行都会报错
const REQUIRED_KINDS = ['sherman', 'tiger', 'panzer4', 'panzer3', 'truck', 'infantry'];

/**
 * 兼容编码读 CSV：优先按 UTF-8 严格解码，失败就 fallback 到 GBK（Windows 中文 Excel 默认编码）。
 * 解码完成后，如果原文件不是 "UTF-8 + BOM"，自动把它重写为 UTF-8 + BOM，
 * 让下次 Excel 打开不再乱码（仓库里的 CSV 永远统一编码，git diff 也稳定）。
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

  // 仓库里的 CSV 永远统一为 UTF-8 + BOM（Excel 双击打开不乱码、git diff 稳定）
  if (!hasBOM || sourceLabel.startsWith('GBK')) {
    const fixed = Buffer.concat([
      Buffer.from([0xEF, 0xBB, 0xBF]),
      Buffer.from(text, 'utf8'),
    ]);
    fs.writeFileSync(filePath, fixed);
    console.warn(`[buildUnitDB] 注意：CSV 原编码为 ${sourceLabel}，已自动转为 UTF-8 + BOM 并保存`);
  }
  return text;
}

/** 极简 CSV 解析：支持双引号包裹字段、字段内逗号、双引号转义（""）。 */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip UTF-8 BOM
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
      // 行结束：合并 \r\n，跳过紧跟的 \n
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

/** 把 [headers, ...rows] 转成 [{header: value, ...}, ...]，自动 trim。 */
function toRecords(rows) {
  if (rows.length === 0) throw new Error('CSV 是空的');
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map((r, idx) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
    obj.__row = idx + 2; // CSV 行号（含表头）便于报错定位
    return obj;
  });
}

function intOrThrow(rec, field) {
  const raw = rec[field];
  if (raw === '' || raw === undefined) {
    throw new Error(`第 ${rec.__row} 行 ${rec.unitKind || '?'}: 字段 ${field} 为空`);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`第 ${rec.__row} 行 ${rec.unitKind || '?'}: 字段 ${field}="${raw}" 不是非负整数`);
  }
  return n;
}

function build() {
  const csv = readCsvSmart(CSV_PATH);
  const rows = parseCSV(csv);
  const records = toRecords(rows);

  // 校验 1：unitKind 必须落在 UnitKind 集合内，且不能重复 / 缺漏
  const seen = new Set();
  for (const rec of records) {
    if (!rec.unitKind) throw new Error(`第 ${rec.__row} 行: unitKind 为空`);
    if (!REQUIRED_KINDS.includes(rec.unitKind)) {
      throw new Error(`第 ${rec.__row} 行: 未知 unitKind="${rec.unitKind}"，必须是 ${REQUIRED_KINDS.join(' / ')} 之一`);
    }
    if (seen.has(rec.unitKind)) {
      throw new Error(`第 ${rec.__row} 行: unitKind="${rec.unitKind}" 重复`);
    }
    seen.add(rec.unitKind);
  }
  for (const k of REQUIRED_KINDS) {
    if (!seen.has(k)) throw new Error(`CSV 缺少 unitKind="${k}" 这一行`);
  }

  // 校验 2：每个字段都得是非负整数
  for (const rec of records) {
    for (const f of NUM_FIELDS) intOrThrow(rec, f);
  }

  // 生成 TS（缩进 / 格式与人手写的 UnitDB.ts 尽量一致，便于 git diff 阅读）
  const lines = [];
  lines.push('/**');
  lines.push(' * 单位数据库 —— 自动生成，请勿手改本文件。');
  lines.push(' *');
  lines.push(' * 数据源：data/units.csv （数值策划用 Excel 维护）');
  lines.push(' * 重新生成：node tools/buildUnitDB.js');
  lines.push(' */');
  lines.push('');
  lines.push("import { UnitKind, UnitStats } from './types';");
  lines.push('');
  lines.push('const DB: Record<UnitKind, UnitStats> = {');
  // 按 REQUIRED_KINDS 顺序输出，让 diff 稳定
  for (const k of REQUIRED_KINDS) {
    const r = records.find(x => x.unitKind === k);
    const name = r.displayName || k;
    const note = r.notes ? ` - ${r.notes}` : '';
    lines.push(`  ${k}: { // ${name}${note}`);
    lines.push(
      `    size: ${r.size}, ` +
      `armorFront: ${r.armorFront}, ` +
      `armorFrontSide: ${r.armorFrontSide}, ` +
      `armorRearSide: ${r.armorRearSide}, ` +
      `armorRear: ${r.armorRear}, ` +
      `penetration: ${r.penetration},`
    );
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  lines.push('export function getUnitStats(kind: UnitKind): UnitStats {');
  lines.push('  return { ...DB[kind] };');
  lines.push('}');
  lines.push('');

  fs.writeFileSync(OUT_PATH, lines.join('\n'), 'utf8');
  console.log(`[buildUnitDB] OK  ${records.length} units → ${path.relative(ROOT, OUT_PATH)}`);
}

try {
  build();
} catch (e) {
  console.error('[buildUnitDB] 失败：', e.message);
  process.exit(1);
}
