const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = function transpileTypeScript(module, filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  module._compile(output, filename);
};

const storage = new Map();
global.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};

const { CustomMissionStore } = require('../assets/scripts/core/CustomMissionStore.ts');
const pkg = {
  schemaVersion: 1,
  editorVersion: 'random-1',
  savedAt: 1,
  source: 'developer',
  mission: {
    id: 'random_test', name: 'Random Test', description: '', cols: 1, rows: 1,
    tiles: [[{ t: 'f' }]], sherman: { kind: 'sherman', at: { col: 0, row: 0 } },
    enemies: [], objective: { type: 'destroy_all_enemies' },
  },
  turnEndEvents: [],
};

const id = CustomMissionStore.saveTransient('generated_random_test', pkg);
assert.strictEqual(id, 'generated_random_test');
assert.strictEqual(CustomMissionStore.load(id).mission.id, 'random_test');
assert.strictEqual(CustomMissionStore.list().some(entry => entry.id === id), false,
  'transient random missions must not consume player custom mission slots');
CustomMissionStore.remove(id);
assert.strictEqual(CustomMissionStore.load(id), null);

delete global.localStorage;
console.log('custom mission transient store tests passed');

