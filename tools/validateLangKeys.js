'use strict';

const fs = require('fs');
const path = require('path');
const { chooseParsedRows, decodeTable, withoutLocalizedDescriptionRow } = require('./csvSmart');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(ts|js)$/.test(entry.name) ? [file] : [];
  });
}

// Check the editable source before replacing LangDB; checking the generated
// file alone lets hand-added translations pass until the next regeneration.
function validateLangReferences(entries, root = path.resolve(__dirname, '..')) {
  const keys = new Set(entries.map(entry => entry.key));
  const prefixes = new Set(entries.map(entry => entry.key.split('.')[0]));
  const missing = new Map();
  function check(key, location) {
    if (!key.includes('.') || key.endsWith('.') || key.includes('*') || key.includes('XX')) return;
    if (!keys.has(key)) {
      if (!missing.has(key)) missing.set(key, new Set());
      missing.get(key).add(location);
    }
  }
  for (const file of sourceFiles(path.join(root, 'assets', 'scripts'))) {
    if (path.basename(file) === 'LangDB.ts') continue;
    const source = fs.readFileSync(file, 'utf8');
    const location = match => `${path.relative(root, file)}:${source.slice(0, match.index).split('\n').length}`;
    // Calls, descriptor fields and assigned keys can all reach t() indirectly.
    for (const match of source.matchAll(/\bt\(\s*(['"])([^'"]+)\1|\b(?:\w*Key|reason)\s*[:=]\s*(['"])([^'"]+)\3/g)) {
      check(match[2] ?? match[4], location(match));
    }
    for (const match of source.matchAll(/(['"])([a-zA-Z]\w*(?:\.\w+)+)\1/g)) {
      if (prefixes.has(match[2].split('.')[0])) check(match[2], location(match));
    }
  }
  // Unit labels use t(`unit.name.${kind}`), so literal-call scans cannot find them.
  const unitPath = path.join(root, 'data', 'units.csv');
  const rows = withoutLocalizedDescriptionRow(
    chooseParsedRows(decodeTable(unitPath).text, ['unitKind']).rows,
  );
  const kindIndex = rows[0].indexOf('unitKind');
  if (kindIndex < 0) throw new Error('units.csv missing unitKind header');
  for (const row of rows.slice(1)) check(`unit.name.${row[kindIndex]}`, 'data/units.csv');
  // Enemy die subtitles use t(`dice.aiEnemy.${action}`), including fallback actions.
  for (const name of ['enemy_ai_table.csv', 'enemy_hardcore_tank_action_table.csv']) {
    const actionRows = withoutLocalizedDescriptionRow(
      chooseParsedRows(decodeTable(path.join(root, 'data', name)).text,
        ['primary', 'fallback', 'fallback2']).rows,
    );
    for (const field of ['primary', 'fallback', 'fallback2']) {
      const index = actionRows[0].indexOf(field);
      if (index < 0) throw new Error(`${name} missing ${field} header`);
      for (const row of actionRows.slice(1)) {
        const action = (row[index] ?? '').trim();
        if (action) check(`dice.aiEnemy.${action}`, `data/${name}`);
      }
    }
  }
  if (missing.size) {
    throw new Error('data/lang.csv 缺少代码引用的翻译，请补齐主表后重新生成：\n'
      + [...missing].sort(([a], [b]) => a.localeCompare(b))
        .map(([key, locations]) => `  ${key} (${[...locations].join(', ')})`).join('\n'));
  }
}

module.exports = { validateLangReferences };
