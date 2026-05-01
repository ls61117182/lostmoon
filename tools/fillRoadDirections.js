#!/usr/bin/env node
/* eslint-disable */
/**
 * 批量为所有 mission_*.json 的公路格（`t:"r"`）按相邻关系自动写入 `rd` 字段。
 *
 * 规则（与 BattleScene.drawRoadOverlay / docs/Missions.md 一致）：
 *  - `rd` 6 位 0/1，索引与 `h`/`ef` 同序：0=E, 1=SE, 2=SW, 3=W, 4=NW, 5=NE；
 *  - 第 i 位为 1 ⇔ 本格沿轴向 i 的邻居是「公路」或「叠桥水域 + 桥端含本边」；
 *  - 桥梁本身（`t:"w"` + `br`）不写 `rd`（其视觉由 `drawBridgeOverlay` 负责）；
 *  - 全 0（孤立公路格）不写 `rd`，视觉退化为整格平涂公路色；
 *  - 写完后用 mission_06 紧凑风格（叶子对象单行）重新格式化整个文件，与
 *    `tools/reformatMissionTiles.js` 同源；保留原 EOL（CRLF / LF）。
 *
 * 用法：
 *   node tools/fillRoadDirections.js                         # 处理 missions/ 下所有 mission_*.json
 *   node tools/fillRoadDirections.js mission_07.json         # 仅处理指定文件
 *   node tools/fillRoadDirections.js --dry                   # 仅打印统计，不写盘
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MISSIONS_DIR = path.resolve(__dirname, '..', 'assets', 'resources', 'missions');

// ---------- 邻接：与 assets/scripts/core/HexGrid.ts 中 HEX_DIRECTIONS 一致 ----------
/** 0=E, 1=SE, 2=SW, 3=W, 4=NW, 5=NE （pointy-top, axial 偏移） */
const HEX_DIRS = [
  [+1, 0], [0, +1], [-1, +1], [-1, 0], [0, -1], [+1, -1],
];

/** odd-r offset → axial（与 HexGrid.ts: offsetToAxial 等价） */
function offsetToAxial(col, row) {
  return { q: col - ((row - (row & 1)) >> 1), r: row };
}

function rotateDirection(d, steps) {
  return (((d + steps) % 6) + 6) % 6;
}

/** 公路或叠桥水域均算"路面" */
function isRoadLike(def) {
  if (!def) return false;
  if (def.t === 'r') return true;
  if (def.t === 'w' && Array.isArray(def.br) && def.br.length === 2) return true;
  return false;
}

/**
 * 邻居一侧是否允许从该边连过来：
 * - 公路：6 边都允许；
 * - 桥梁：仅当 `br` 包含「邻居看本格」的方向时（即桥端正落在那一侧）允许。
 */
function neighborAllowsEdge(def, dirFromNeighborToHere) {
  if (def.t === 'r') return true;
  if (def.t === 'w') {
    return Array.isArray(def.br) && def.br.includes(dirFromNeighborToHere);
  }
  return false;
}

/** 修改 data 上每个公路格的 def.rd；返回统计 */
function fillRdFor(data) {
  const tilesByAxial = new Map();
  for (let row = 0; row < data.tiles.length; row++) {
    const arr = data.tiles[row] || [];
    for (let col = 0; col < arr.length; col++) {
      const def = arr[col];
      if (!def) continue;
      const { q, r } = offsetToAxial(col, row);
      tilesByAxial.set(q + ',' + r, { col, row, def });
    }
  }
  let written = 0;
  let cleared = 0;
  let unchanged = 0;
  for (const info of tilesByAxial.values()) {
    if (info.def.t !== 'r') continue;
    const { q, r } = offsetToAxial(info.col, info.row);
    const flags = ['0', '0', '0', '0', '0', '0'];
    for (let d = 0; d < 6; d++) {
      const [dq, dr] = HEX_DIRS[d];
      const nb = tilesByAxial.get(q + dq + ',' + (r + dr));
      if (!nb || !isRoadLike(nb.def)) continue;
      if (!neighborAllowsEdge(nb.def, rotateDirection(d, 3))) continue;
      flags[d] = '1';
    }
    const rd = flags.join('');
    const def = info.def;
    if (rd === '000000') {
      if (def.rd !== undefined) {
        delete def.rd;
        cleared++;
      } else {
        unchanged++;
      }
    } else if (def.rd === rd) {
      unchanged++;
    } else {
      def.rd = rd;
      written++;
    }
  }
  return { written, cleared, unchanged };
}

// ---------- 紧凑格式化（与 tools/reformatMissionTiles.js 同源） ----------
function isPrimitive(v) { return v === null || typeof v !== 'object'; }
function isFlatArray(arr) { return arr.every(isPrimitive); }
function canCompactAtDepth(value, depth) {
  if (isPrimitive(value)) return true;
  if (Array.isArray(value)) return value.every((v) => canCompactAtDepth(v, depth + 1));
  if (depth <= 1) {
    return Object.keys(value).every((k) => {
      const v = value[k];
      if (isPrimitive(v)) return true;
      if (Array.isArray(v)) return isFlatArray(v);
      return false;
    });
  }
  return Object.keys(value).every((k) => canCompactAtDepth(value[k], depth + 1));
}
function stringifyCompact(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stringifyCompact).join(', ') + ']';
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  return '{ ' + keys.map((k) => JSON.stringify(k) + ': ' + stringifyCompact(value[k])).join(', ') + ' }';
}
function stringifyValue(value, indent) {
  if (isPrimitive(value)) return stringifyCompact(value);
  const ind = '  '.repeat(indent);
  const indNext = '  '.repeat(indent + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (isFlatArray(value)) return stringifyCompact(value);
    return '[\n' + value.map((v) => indNext + stringifyValue(v, indent + 1)).join(',\n') + '\n' + ind + ']';
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  if (indent >= 1 && canCompactAtDepth(value, indent)) {
    return stringifyCompact(value);
  }
  return '{\n' + keys.map((k) => indNext + JSON.stringify(k) + ': ' + stringifyValue(value[k], indent + 1)).join(',\n') + '\n' + ind + '}';
}

function detectEol(text) { return text.includes('\r\n') ? '\r\n' : '\n'; }

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const fileArgs = args.filter((a) => !a.startsWith('--'));
  let files;
  if (fileArgs.length > 0) {
    files = fileArgs.map((f) => (path.isAbsolute(f) ? f : path.join(MISSIONS_DIR, f)));
  } else {
    files = fs.readdirSync(MISSIONS_DIR)
      .filter((f) => /^mission_\d+\.json$/.test(f))
      .sort()
      .map((f) => path.join(MISSIONS_DIR, f));
  }

  for (const file of files) {
    const orig = fs.readFileSync(file, 'utf8');
    const eol = detectEol(orig);
    const data = JSON.parse(orig);
    const stat = fillRdFor(data);
    let out = stringifyValue(data, 0) + '\n';
    if (eol === '\r\n') out = out.replace(/\n/g, '\r\n');

    const tag = dry ? '[dry  ]' : (out === orig ? '[skip ]' : '[write]');
    const summary =
      'rd ' + ('+' + stat.written).padStart(3) +
      ' / -' + String(stat.cleared).padStart(2) +
      ' / =' + String(stat.unchanged).padStart(2);
    console.log(tag + ' ' + path.basename(file).padEnd(20) + summary);

    if (!dry && out !== orig) {
      fs.writeFileSync(file, out, 'utf8');
    }
  }
}

main();
