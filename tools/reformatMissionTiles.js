#!/usr/bin/env node
/* eslint-disable */
/**
 * 把 mission_*.json 重新缩进为「mission_06 风格」：
 *   - 顶层对象多行展开；
 *   - tiles/enemies 等含对象的数组多行展开；
 *   - 「叶子对象」（值全为 primitive / 短数组 of primitive）压缩为单行；
 *   - 字段顺序原样保留。
 *
 * 仅做格式变换；用 JSON.parse 后 deep-equal 校验，绝不修改字段值。
 *
 * 用法:
 *   node tools/reformatMissionTiles.js [--dry] [files...]
 *   node tools/reformatMissionTiles.js                            # 处理 mission_01..05
 *   node tools/reformatMissionTiles.js --dry mission_06.json      # 仅打印 diff stat
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MISSIONS_DIR = path.resolve(__dirname, '..', 'assets', 'resources', 'missions');

function isPrimitive(v) {
  return v === null || typeof v !== 'object';
}

function isFlatArray(arr) {
  return arr.every(isPrimitive);
}

/**
 * 判断 value 在「当前 depth」下能否压成单行 compact 表示。
 * - depth == 0  : root，永远展开（不调用本函数）。
 * - depth == 1  : 顶层对象的 value（sherman / objective 这一层）；
 *                 若是对象，必须严格 flat（不含任何嵌套对象），否则展开。
 *                 这样 sherman/objective 始终多行展开，与 mission_06 风格一致。
 * - depth >= 2  : 允许递归 compact（嵌套 flat 对象/数组也可整体压缩）。
 *                 例如 mission_08 里 enemies[3] = { kind, faction, at:{col,row} }
 *                 整体仍可单行。
 */
function canCompactAtDepth(value, depth) {
  if (isPrimitive(value)) return true;
  if (Array.isArray(value)) {
    return value.every((v) => canCompactAtDepth(v, depth + 1));
  }
  // object
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
  if (Array.isArray(value)) {
    return '[' + value.map(stringifyCompact).join(', ') + ']';
  }
  // object
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
    // 数组：仅当所有元素都是 primitive 时才整体压一行
    // （这样 br: [4, 1] 紧凑；而 tiles / enemies 等含对象的数组永远多行）
    if (isFlatArray(value)) return stringifyCompact(value);
    const items = value.map((v) => indNext + stringifyValue(v, indent + 1));
    return '[\n' + items.join(',\n') + '\n' + ind + ']';
  }

  // object
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  // 对象：用 canCompactAtDepth 判断
  //  - depth==0 root：恒展开
  //  - depth==1 顶层（sherman/objective）：含嵌套对象就展开
  //  - depth>=2 深层（enemy / tile / at / evacAt）：递归全 compactable 就压一行
  if (indent >= 1 && canCompactAtDepth(value, indent)) {
    return stringifyCompact(value);
  }
  const items = keys.map((k) => indNext + JSON.stringify(k) + ': ' + stringifyValue(value[k], indent + 1));
  return '{\n' + items.join(',\n') + '\n' + ind + '}';
}

function reformat(text) {
  const data = JSON.parse(text);
  const out = stringifyValue(data, 0) + '\n';
  // round-trip 校验
  const parsedBack = JSON.parse(out);
  if (JSON.stringify(parsedBack) !== JSON.stringify(data)) {
    throw new Error('round-trip JSON mismatch');
  }
  return out;
}

function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const fileArgs = args.filter((a) => !a.startsWith('--'));
  let files;
  if (fileArgs.length > 0) {
    files = fileArgs.map((f) => (path.isAbsolute(f) ? f : path.join(MISSIONS_DIR, f)));
  } else {
    files = ['mission_01', 'mission_02', 'mission_03', 'mission_04', 'mission_05'].map(
      (b) => path.join(MISSIONS_DIR, b + '.json')
    );
  }

  for (const file of files) {
    const orig = fs.readFileSync(file, 'utf8');
    const eol = detectEol(orig);
    let out = reformat(orig);
    if (eol === '\r\n') out = out.replace(/\n/g, '\r\n');

    if (out === orig) {
      console.log('[skip ] ' + path.basename(file) + '  (already formatted)');
      continue;
    }

    if (dry) {
      console.log('[dry  ] ' + path.basename(file) + '  ' + orig.length + ' -> ' + out.length + ' bytes');
    } else {
      fs.writeFileSync(file, out, 'utf8');
      console.log('[write] ' + path.basename(file) + '  ' + orig.length + ' -> ' + out.length + ' bytes');
    }
  }
}

main();
