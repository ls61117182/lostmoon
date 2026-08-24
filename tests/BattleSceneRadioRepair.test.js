const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'),
  'utf8',
);

assert.match(source, /repairableComponentsFor\(GameSession\.gameMode\)/);
assert.match(source, /private tryRepair\(dieIdx: number, target: RepairableComponentId\)/);
assert.match(source, /component\.playerAvailable\(GameSession\.gameMode\)/);
assert.match(source, /GameSession\.gameMode === 'hardcore'[\s\S]*?radio\.isDamaged\(u\)/);
assert.match(source, /status\.row\.radio/);
assert.match(source, /private statusRadio: Label \| null/);
assert.match(source, /s\.radioDamaged/);
assert.match(source, /firstDamagedRepairableComponent\(enemy\)/);
assert.doesNotMatch(source, /else if \(enemy\.radioDamaged\)/);

const repairHandler = source.match(
  /private tryRepair\(dieIdx: number, target: RepairableComponentId\) \{([\s\S]*?)\n  \}\n\n  \/\*\* 灭火/,
)?.[1] ?? '';
assert.ok(repairHandler, 'tryRepair handler should be present');
assert.doesNotMatch(
  repairHandler,
  /tileForbidsSmokeOrConcealment|beachNoRepair/,
  'beach terrain must not block repair execution',
);
assert.doesNotMatch(
  source,
  /tryRepair\(idx, component\.id\)[\s\S]{0,160}beachNoRepair/,
  'beach terrain must not disable repair actions in the die popover',
);

console.log('BattleScene radio repair tests passed');
