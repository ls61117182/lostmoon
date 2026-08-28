const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const battleScene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');

assert.match(
  battleScene,
  /const concealReason = !sherman[\s\S]*?: sherman\.paralyzed \? t\('floater\.paralyzedNoConceal'\)/,
  'the concealment menu should disable the action while the Sherman is immobilized',
);
assert.match(
  battleScene,
  /private tryConcealment\([\s\S]*?if \(s\.paralyzed\) \{[\s\S]*?floater\.paralyzedNoConceal[\s\S]*?return;/,
  'concealment execution should reject an immobilized Sherman without spending dice',
);
assert.match(
  battleScene,
  /case 'conceal': \{[\s\S]*?if \(enemy\.paralyzed \|\| tileForbidsSmokeOrConcealment/,
  'enemy concealment execution should defensively reject immobilized tanks',
);

const previousTsLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

try {
  const { canExecuteAction } = require('../assets/scripts/core/EnemyAI.ts');
  const { HexMap } = require('../assets/scripts/core/HexGrid.ts');
  const map = new HexMap(1, 1);
  map.set({ pos: { q: 0, r: 0 }, terrain: 'field' });
  const enemy = {
    id: 'enemy', kind: 'panzer4', faction: 'german',
    pos: { q: 0, r: 0 }, facing: 0, stats: { faction: 'german' },
  };
  const sherman = {
    id: 'sherman', kind: 'sherman', faction: 'usa',
    pos: { q: 1, r: 0 }, facing: 3, stats: { faction: 'usa' },
  };

  assert.strictEqual(canExecuteAction(enemy, 'conceal', sherman, map, new Set()), true);
  enemy.paralyzed = true;
  assert.strictEqual(
    canExecuteAction(enemy, 'conceal', sherman, map, new Set()),
    false,
    'an immobilized enemy tank cannot conceal',
  );
} finally {
  if (previousTsLoader) require.extensions['.ts'] = previousTsLoader;
  else delete require.extensions['.ts'];
}

console.log('Tank immobilized concealment tests passed.');
