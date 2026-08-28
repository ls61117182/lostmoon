const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const scene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');
const lang = fs.readFileSync(path.join(root, 'data/lang.csv'), 'utf8');

test('HVAP penetration bonus is folded into the penetration row', () => {
  assert.match(scene, /breakdown\.basePenetration \+ penetrationBonus/);
  assert.match(scene, /penetrationBonus !== 0 \? 'dice\.rule\.hvapPen' : 'dice\.rule\.basePen'/);
  assert.doesNotMatch(scene, /addRow\(t\('dice\.rule\.hvapPenBonus'/);
});

test('normal and HVAP penetration labels are localized', () => {
  assert.match(lang, /^dice\.rule\.basePen,穿深,Penetration$/m);
  assert.match(lang, /^dice\.rule\.hvapPen,HVAP穿深,HVAP Penetration$/m);
});
