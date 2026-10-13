const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { chooseParsedRows, decodeTable, withoutLocalizedDescriptionRow } = require('../tools/csvSmart');
const { rowsToEntries } = require('../tools/buildLangDB');
const { validateLangReferences } = require('../tools/validateLangKeys');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(ROOT, 'assets', 'scripts');
const LANG_DB_PATH = path.join(SCRIPTS_DIR, 'core', 'LangDB.ts');

function definedLangKeys() {
  const langDb = fs.readFileSync(LANG_DB_PATH, 'utf8');
  return new Set(
    [...langDb.matchAll(/^\s*'([^']+)':\s*\{/gm)].map((match) => match[1]),
  );
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return /\.(?:ts|js)$/.test(entry.name) ? [fullPath] : [];
  });
}

test('literal localization keys used by scripts exist in LangDB', () => {
  const definedKeys = definedLangKeys();
  const missing = new Set();
  const literalCall = /\bt\(\s*(['"])([^'"]+)\1/g;

  for (const file of sourceFiles(SCRIPTS_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(literalCall)) {
      const key = match[2];
      // These are deliberate prefixes/examples used to construct keys dynamically.
      if (key.endsWith('.') || key.includes('*') || key.includes('XX')) continue;
      if (!definedKeys.has(key)) missing.add(key);
    }
  }

  assert.deepEqual([...missing].sort(), []);
});

test('reported dynamic localization keys exist', () => {
  const definedKeys = definedLangKeys();
  assert.equal(definedKeys.has('unit.name.stug3'), true);
  assert.equal(definedKeys.has('unit.name.tigerking'), true);
  assert.equal(definedKeys.has('tileInspect.status.radioIntact'), true);
  assert.equal(definedKeys.has('turnEnd.commanderExtra.loadProgress'), true);
});

test('unit names and indirect localization references exist in the source table', () => {
  function tableRows(name, headers) {
    return withoutLocalizedDescriptionRow(
      chooseParsedRows(decodeTable(path.join(ROOT, 'data', name)).text, headers).rows,
    );
  }
  const entries = rowsToEntries(tableRows('lang.csv', ['key', 'zh', 'en']));
  validateLangReferences(entries, ROOT);
  const definedKeys = new Set(entries.map(entry => entry.key));
  const missing = new Set();
  const unitRows = tableRows('units.csv', ['unitKind']);
  const kindIndex = unitRows[0].indexOf('unitKind');
  for (const row of unitRows.slice(1)) {
    const key = `unit.name.${row[kindIndex]}`;
    if (!definedKeys.has(key)) missing.add(key);
  }
  // These values reach t() through component descriptors and combat results.
  const indirectKey = /\b(?:\w*Key|reason)\s*:\s*(['"])([^'"]+)\1/g;
  for (const file of sourceFiles(SCRIPTS_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(indirectKey)) {
      const key = match[2];
      if (!key.includes('.') || key.includes('XX')) continue;
      if (!definedKeys.has(key)) missing.add(key);
    }
  }
  assert.deepEqual([...missing].sort(), []);
});

test('generation rejects translations absent from CSV even when LangDB contains them', () => {
  const rows = withoutLocalizedDescriptionRow(chooseParsedRows(
    decodeTable(path.join(ROOT, 'data', 'lang.csv')).text, ['key', 'zh', 'en'],
  ).rows);
  const entries = rowsToEntries(rows);
  const generatedKeys = definedLangKeys();
  for (const key of ['action.repairRadio', 'unit.name.german_heavy_artillery', 'turnEnd.commanderExtra.loadProgress']) {
    assert.equal(generatedKeys.has(key), true);
    assert.throws(
      () => validateLangReferences(entries.filter(entry => entry.key !== key), ROOT),
      error => error.message.includes(key) && error.message.includes('data/lang.csv'),
    );
  }
});
