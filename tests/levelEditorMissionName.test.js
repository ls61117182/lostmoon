const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const menu = fs.readFileSync(path.join(root, 'assets/scripts/view/MainMenuScene.ts'), 'utf8');
const lang = fs.readFileSync(path.join(root, 'assets/scripts/core/LangDB.ts'), 'utf8');

assert.match(
  menu,
  /makeInputField\([\s\S]*?levelEditor\.mission\.namePlaceholder[\s\S]*?draftName/,
  'level editor should expose an input initialized with the current custom mission name',
);
assert.match(
  menu,
  /titleInput\.node\.on\('text-changed',[\s\S]*?draftName = name[\s\S]*?refreshCurrentLabel\(\)/,
  'editing the mission name should update the draft and its visible current-name label',
);
assert.match(
  menu,
  /name: draftName \|\| fallbackName/,
  'saving a custom mission should persist the entered name to mission.name',
);
assert.match(
  menu,
  /let draftName = existingPackage\?\.mission\.name/,
  'opening a saved custom mission should restore its name into the editor draft',
);
assert.match(lang, /'levelEditor\.mission\.name': \{ zh: "关卡名称", en: "Mission Name" \}/);
assert.match(lang, /'levelEditor\.mission\.namePlaceholder': \{ zh: "输入自定义关卡名称", en: "Enter a custom mission name" \}/);

console.log('level editor mission-name tests passed');
