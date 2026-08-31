const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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
});
