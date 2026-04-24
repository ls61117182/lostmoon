#!/usr/bin/env node
/**
 * data/player_action_table.csv + data/player_dice_pool.csv
 *   → assets/scripts/core/PlayerActionDB.ts
 *
 * 对应 GDD §3.6：
 *   - 行动表：骰面 1..6 / doubles → A 移动 / B 攻击 / C 杂项 三列动作
 *   - 骰池：基础 + 地形修正 + 舱盖修正 + 上下限
 *
 * 数值策划工作流：
 *   1. Excel 打开 data/player_action_table.csv 或 data/player_dice_pool.csv 改数值
 *   2. 另存为 CSV UTF-8（逗号分隔）覆盖原文件
 *   3. 根目录执行：node tools/buildPlayerActionDB.js
 *   4. PlayerActionDB.ts 自动重写；Cocos 预览立即生效
 *
 * 零依赖，纯 Node.js 18+。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ACTION_CSV = path.join(ROOT, 'data', 'player_action_table.csv');
const POOL_CSV = path.join(ROOT, 'data', 'player_dice_pool.csv');
const OUT_PATH = path.join(ROOT, 'assets', 'scripts', 'core', 'PlayerActionDB.ts');

// 与 ActionDice.ts 的 MoveDieAction 枚举对齐（MVP 把 doubles 行里的 'driver_drive_and_turn'
// 作为拓展值保留，当前代码不消费它）
const MOVE_VALUES = ['none', 'start', 'turn', 'drive', 'reverse', 'driver_drive_codriver_turn'];
const ATTACK_VALUES = ['none', 'reload', 'mg', 'gun', 'gunner_gun_or_reload'];
// C 列 MVP 不消费，但预留枚举集合，后续补全杂项阶段时直接读
const MISC_VALUES = [
  'none',
  'gunner_gun_or_reload',
  'codriver_mg',
  'driver_turn_or_drive',
  'repair',
  'smoke_or_repair',
  'fire_suppress',
  'concealment',
];

const REQUIRED_ACTION_ROWS = ['1', '2', '3', '4', '5', '6', 'doubles'];

// 骰池配置里必须出现的全部键
const REQUIRED_POOL_KEYS = [
  'base',
  'hatch_open',
  'terrain_road',
  'terrain_field',
  'terrain_mud',
  'terrain_forest',
  'terrain_water',
  'cap_min',
  'cap_max',
];

// 与 TerrainType 对齐，用于生成代码里的映射
const TERRAIN_KINDS = ['road', 'field', 'mud', 'forest', 'water'];

/** 通用 smart 读取：优先 UTF-8，失败用 GBK；非 BOM 统一转为 UTF-8 + BOM 回写。 */
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
    console.warn(`[buildPlayerActionDB] 注意：${path.basename(filePath)} 原编码 ${label}，已转为 UTF-8 + BOM`);
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
  if (raw === '' || raw === undefined) {
    throw new Error(`${labelForError}：数值为空`);
  }
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new Error(`${labelForError}：value="${raw}" 不是整数`);
  }
  return n;
}

function enumOrThrow(raw, allowed, labelForError) {
  if (raw === '' || raw === undefined) return 'none';
  if (!allowed.includes(raw)) {
    throw new Error(`${labelForError}："${raw}" 不在允许集合 {${allowed.join(' / ')}}`);
  }
  return raw;
}

/** 解析行动表，返回 { '1': {move, attack, misc}, ..., 'doubles': {...} } */
function parseActionTable() {
  const recs = toRecords(parseCSV(readCsvSmart(ACTION_CSV)), ACTION_CSV);
  const map = {};
  const seen = new Set();
  for (const r of recs) {
    const die = r.die;
    if (!die) throw new Error(`player_action_table.csv 第 ${r.__row} 行：die 为空`);
    if (seen.has(die)) throw new Error(`player_action_table.csv 第 ${r.__row} 行：die="${die}" 重复`);
    if (!REQUIRED_ACTION_ROWS.includes(die)) {
      throw new Error(`player_action_table.csv 第 ${r.__row} 行：未知 die="${die}"，必须是 ${REQUIRED_ACTION_ROWS.join(' / ')}`);
    }
    seen.add(die);
    const labelPrefix = `player_action_table.csv 第 ${r.__row} 行 die=${die}`;
    map[die] = {
      move:   enumOrThrow(r.move,   MOVE_VALUES,   `${labelPrefix} move`),
      attack: enumOrThrow(r.attack, ATTACK_VALUES, `${labelPrefix} attack`),
      misc:   enumOrThrow(r.misc,   MISC_VALUES,   `${labelPrefix} misc`),
    };
  }
  for (const k of REQUIRED_ACTION_ROWS) {
    if (!seen.has(k)) throw new Error(`player_action_table.csv 缺少 die="${k}" 这一行`);
  }
  return map;
}

/** 解析骰池表，返回 { base, hatch_open, terrain_road, ..., cap_min, cap_max } */
function parsePoolTable() {
  const recs = toRecords(parseCSV(readCsvSmart(POOL_CSV)), POOL_CSV);
  const map = {};
  const seen = new Set();
  for (const r of recs) {
    const mod = r.modifier;
    if (!mod) throw new Error(`player_dice_pool.csv 第 ${r.__row} 行：modifier 为空`);
    if (seen.has(mod)) throw new Error(`player_dice_pool.csv 第 ${r.__row} 行：modifier="${mod}" 重复`);
    if (!REQUIRED_POOL_KEYS.includes(mod)) {
      throw new Error(`player_dice_pool.csv 第 ${r.__row} 行：未知 modifier="${mod}"`);
    }
    seen.add(mod);
    map[mod] = intOrThrow(r.value, `player_dice_pool.csv 第 ${r.__row} 行 ${mod}`);
  }
  for (const k of REQUIRED_POOL_KEYS) {
    if (!seen.has(k)) throw new Error(`player_dice_pool.csv 缺少 modifier="${k}" 这一行`);
  }
  if (map.cap_min > map.cap_max) {
    throw new Error(`player_dice_pool.csv: cap_min (${map.cap_min}) 不能大于 cap_max (${map.cap_max})`);
  }
  return map;
}

function build() {
  const action = parseActionTable();
  const pool = parsePoolTable();

  const lines = [];
  lines.push('/**');
  lines.push(' * 玩家行动表与骰池 —— 自动生成，请勿手改本文件。');
  lines.push(' *');
  lines.push(' * 数据源：data/player_action_table.csv + data/player_dice_pool.csv');
  lines.push(' * 重新生成：node tools/buildPlayerActionDB.js');
  lines.push(' * 对应 GDD §3.6 行动表 + 掷骰公式。');
  lines.push(' */');
  lines.push('');
  lines.push("import { TerrainType } from './types';");
  lines.push('');
  lines.push(
    '/** A 列：移动骰可映射到的动作枚举。MVP 实际消费 none / turn / drive / reverse，'
    + 'start 预留给未来的启动检定，driver_drive_codriver_turn 预留给对子合并玩法'
    + '（驾驶员前进 / 副驾驶转向，二选一）。 */'
  );
  lines.push("export type MoveDieAction = " + MOVE_VALUES.map(v => `'${v}'`).join(' | ') + ';');
  lines.push('');
  lines.push(
    '/** B 列：攻击骰可映射到的动作枚举。MVP 实际消费 none / reload / mg / gun。 */'
  );
  lines.push("export type AttackDieAction = " + ATTACK_VALUES.map(v => `'${v}'`).join(' | ') + ';');
  lines.push('');
  lines.push(
    '/** C 列：杂项骰可映射到的动作枚举。MVP 尚未开放该阶段，仅作数据存根，运行时暂不读取。 */'
  );
  lines.push("export type MiscDieAction = " + MISC_VALUES.map(v => `'${v}'`).join(' | ') + ';');
  lines.push('');
  lines.push('/** 行动表的一行：三列动作 */');
  lines.push('export interface ActionTableRow {');
  lines.push('  move: MoveDieAction;');
  lines.push('  attack: AttackDieAction;');
  lines.push('  misc: MiscDieAction;');
  lines.push('}');
  lines.push('');
  lines.push('/** 1..6 骰面 → 行动表行。0 下标不用；访问请用 pip 值直接索引。 */');
  lines.push('export const PLAYER_ACTION_BY_PIP: Record<1 | 2 | 3 | 4 | 5 | 6, ActionTableRow> = {');
  for (let p = 1; p <= 6; p++) {
    const r = action[String(p)];
    lines.push(`  ${p}: { move: '${r.move}', attack: '${r.attack}', misc: '${r.misc}' },`);
  }
  lines.push('};');
  lines.push('');
  lines.push('/** 对子（两颗同点）特殊行：MVP 不消费，仅保留给未来的对子合并玩法。 */');
  lines.push('export const PLAYER_ACTION_DOUBLES: ActionTableRow = {');
  lines.push(`  move: '${action.doubles.move}',`);
  lines.push(`  attack: '${action.doubles.attack}',`);
  lines.push(`  misc: '${action.doubles.misc}',`);
  lines.push('};');
  lines.push('');
  lines.push('/** 骰池基础配置 + 地形修正 + 上下限。由 actionDicePool() 消费。 */');
  lines.push('export interface DicePoolConfig {');
  lines.push('  /** 基础骰数（常量） */');
  lines.push('  base: number;');
  lines.push('  /** 车长打开舱盖的 +N */');
  lines.push('  hatchOpen: number;');
  lines.push('  /** 地形 → 修正 (+/-) */');
  lines.push('  terrainBonus: Record<TerrainType, number>;');
  lines.push('  /** 骰数下限（不低于此值） */');
  lines.push('  capMin: number;');
  lines.push('  /** 骰数上限（不高于此值） */');
  lines.push('  capMax: number;');
  lines.push('}');
  lines.push('');
  lines.push('export const PLAYER_DICE_POOL: DicePoolConfig = {');
  lines.push(`  base: ${pool.base},`);
  lines.push(`  hatchOpen: ${pool.hatch_open},`);
  lines.push('  terrainBonus: {');
  for (const terr of TERRAIN_KINDS) {
    lines.push(`    ${terr}: ${pool['terrain_' + terr]},`);
  }
  lines.push('  },');
  lines.push(`  capMin: ${pool.cap_min},`);
  lines.push(`  capMax: ${pool.cap_max},`);
  lines.push('};');
  lines.push('');

  fs.writeFileSync(OUT_PATH, lines.join('\n'), 'utf8');
  console.log(
    `[buildPlayerActionDB] OK  ${REQUIRED_ACTION_ROWS.length} action rows + `
    + `${REQUIRED_POOL_KEYS.length} pool keys → ${path.relative(ROOT, OUT_PATH)}`
  );
}

try {
  build();
} catch (e) {
  console.error('[buildPlayerActionDB] 失败：', e.message);
  process.exit(1);
}
