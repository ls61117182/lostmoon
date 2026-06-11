/* Shared CSV reader/normalizer for data table generators. */
'use strict';

const fs = require('fs');
const path = require('path');

function decodeTable(filePath) {
  const buf = fs.readFileSync(filePath);
  const hasBom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(buf),
      encoding: hasBom ? 'utf-8-bom' : 'utf-8',
    };
  } catch (_) {
    return {
      text: new TextDecoder('gbk').decode(buf),
      encoding: 'gbk',
    };
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

function headerHits(rows, requiredHeaders) {
  if (!rows.length || !requiredHeaders?.length) return 0;
  const headers = rows[0].map(h => h.trim().replace(/^\uFEFF/, ''));
  return requiredHeaders.filter(h => headers.includes(h)).length;
}

function chooseParsedRows(text, requiredHeaders) {
  const candidates = [
    { delimiter: ',', name: 'csv', rows: parseDelimited(text, ',') },
    { delimiter: '\t', name: 'tsv', rows: parseDelimited(text, '\t') },
  ];

  let best = null;
  for (const c of candidates) {
    if (!c.rows.length) continue;
    const widthScore = Math.max(...c.rows.map(r => r.length));
    const score = headerHits(c.rows, requiredHeaders) * 100 + widthScore;
    if (!best || score > best.score) best = { ...c, score };
  }
  return best ?? candidates[0];
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\r\n\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(rows) {
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function normalizeFile(filePath, rows, sourceInfo, toolName) {
  const target = Buffer.concat([
    Buffer.from([0xEF, 0xBB, 0xBF]),
    Buffer.from(rowsToCsv(rows), 'utf8'),
  ]);
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0);
  if (current.equals(target)) return;
  fs.writeFileSync(filePath, target);
  console.warn(
    `[${toolName}] normalized ${path.basename(filePath)} `
    + `(${sourceInfo.encoding}, ${sourceInfo.delimiterName} -> UTF-8 BOM, comma CSV)`,
  );
}

function readCsvRowsSmart(filePath, opts = {}) {
  const toolName = opts.toolName ?? path.basename(process.argv[1] ?? 'csvSmart');
  const decoded = decodeTable(filePath);
  const parsed = chooseParsedRows(decoded.text, opts.requiredHeaders ?? []);
  const rows = parsed.rows;
  if (opts.requiredHeaders?.length) {
    const headers = rows[0]?.map(h => h.trim().replace(/^\uFEFF/, '')) ?? [];
    const missing = opts.requiredHeaders.filter(h => !headers.includes(h));
    if (missing.length) {
      throw new Error(`${path.basename(filePath)} missing required header(s): ${missing.join(', ')}`);
    }
  }
  normalizeFile(filePath, rows, {
    encoding: decoded.encoding,
    delimiterName: parsed.name,
  }, toolName);
  return rows;
}

module.exports = {
  readCsvRowsSmart,
};
