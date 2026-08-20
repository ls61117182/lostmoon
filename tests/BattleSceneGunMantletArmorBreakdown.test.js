const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');
const lang = fs.readFileSync(path.join(root, 'data/lang.csv'), 'utf8');

assert(scene.includes('const baseArmor = armor - gunMantletArmor;'),
  'penetration help must subtract the mantlet bonus from the armor-face row');
assert(scene.includes("addRow(t('dice.rule.gunMantletArmor'), gunMantletArmor);"),
  'an applied gun-mantlet bonus must be displayed without a plus sign');
assert(!scene.includes('`+${gunMantletArmor}`'),
  'positive values in the penetration breakdown must not be prefixed with a plus sign');
assert(lang.includes('dice.rule.gunMantletArmor,炮盾装甲值,Gun Mantlet Armor'),
  'the separate gun-mantlet armor row must be localized');
assert(lang.includes('dice.rule.faceFront,前,Front'),
  'front-facing armor must be labeled 前装甲 rather than 前侧装甲');

console.log('BattleScene gun mantlet armor breakdown test passed');
