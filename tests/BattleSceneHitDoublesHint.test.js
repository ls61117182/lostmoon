const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const battleScene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');
const langDB = fs.readFileSync(path.join(root, 'assets/scripts/core/LangDB.ts'), 'utf8');

const hitRuleSpec = battleScene.match(/if \(kind === 'hit'\) \{[\s\S]*?\n    if \(kind === 'pen'\)/);
assert.ok(hitRuleSpec, 'hit rule modal spec should exist');
assert.match(
  hitRuleSpec[0],
  /const showOpenHatchCommanderHint = show\.targetCommanderExposed;[\s\S]*?note: showOpenHatchCommanderHint \? t\('dice\.rule\.hitDoublesCommanderKiaHint'\) : undefined/,
  'the hint should be attached whenever the attacked commander was exposed',
);
assert.match(
  battleScene,
  /targetCommanderExposed: opts\.target\?\.hatchOpen === true && opts\.target\.crew\?\.commander !== false/,
  'the exposed commander state should be captured before attack resolution regardless of hit result',
);
assert.match(
  battleScene,
  /if \(spec\.note\) \{[\s\S]*?makeBattleModalLabel\(panel, spec\.note/,
  'the rule modal should render its optional note below the calculation',
);
assert.match(langDB, /同点数命中时会造成开舱状态的车长阵亡/);

console.log('BattleScene hit-doubles hint tests passed');
