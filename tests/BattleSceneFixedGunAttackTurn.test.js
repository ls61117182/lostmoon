const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');

const start = scene.indexOf('private chooseActionForEntry');
const end = scene.indexOf('private enemyCrewRequirementMet', start);
assert(start >= 0 && end > start, 'chooseActionForEntry must exist');
const chooseAction = scene.slice(start, end);

assert.match(
  chooseAction,
  /if \(this\.canAIExecuteShoot\(enemy\)\) return 'shoot';[\s\S]*?isTankUnit\(enemy\)[\s\S]*?enemy\.stats\.visionType === 'fixed'[\s\S]*?canPerform\('turn'\)[\s\S]*?return 'turn';/,
  'a fixed-gun tank attack without a target in its current direction must become one hull turn',
);
assert.match(
  chooseAction,
  /const chosen = tryOne\(entry\.primary, entry\.primaryCrew\);[\s\S]*?if \(chosen\) return chosen;/,
  'the chooser must return the converted turn action instead of the original shoot action',
);

console.log('BattleScene fixed-gun attack turn tests passed.');
