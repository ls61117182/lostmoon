const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const battleScene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');
const langDb = fs.readFileSync(path.join(root, 'assets/scripts/core/LangDB.ts'), 'utf8');

assert.match(
  battleScene,
  /iconNode\.on\(Node\.EventType\.MOUSE_ENTER[\s\S]*?showCrewTooltip\(i \+ 1, event\)/,
  'crew status icons should open their tooltip on mouse enter',
);
assert.match(
  battleScene,
  /iconNode\.on\(Node\.EventType\.MOUSE_LEAVE[\s\S]*?closeCrewTooltip\(\)/,
  'crew status icons should close their tooltip as soon as the mouse leaves',
);
assert.match(
  battleScene,
  /rootTransform\.setAnchorPoint\(0\.5, 0\.5\)[\s\S]*?event\.getUILocation\(\)[\s\S]*?root\.setPosition\(local\.x - W \/ 2, local\.y - H \/ 2, 0\)/,
  'the mouse position should be used as the tooltip top-right corner',
);
assert.match(
  battleScene,
  /icon\.spriteFrame = this\.statusCrewIcons\[slot - 1\]\?\.spriteFrame/,
  'the tooltip should reuse the hovered crew member icon',
);

for (let slot = 1; slot <= 5; slot++) {
  assert.match(langDb, new RegExp(`'crew\\.tooltip\\.${slot}'`), `crew slot ${slot} needs localized tooltip text`);
}
assert.match(
  langDb,
  /'crew\.tooltip\.2': \{ zh: "攻击阶段骰子\+1；杂项阶段可使用主炮射击，攻击阶段可消耗两颗同点骰使用主炮射击"/,
  'the gunner tooltip should explain both concrete main-gun action paths',
);
for (const text of [
  '攻击阶段骰子+1；打开舱盖时获得额外视野，并使杂项阶段骰子+1',
  '攻击阶段骰子+1；杂项阶段可装填主炮，攻击阶段可消耗两颗同点骰装填主炮',
  '移动阶段骰子+1；杂项阶段可转向或前进，移动阶段可消耗两颗同点骰前进',
  '移动阶段骰子+1；移动阶段可消耗两颗同点骰转向；硬核模式下可操作航向机枪',
]) {
  assert.ok(langDb.includes(`zh: "${text}"`), `crew tooltip should describe concrete phase rules: ${text}`);
}

console.log('Crew status tooltip tests passed');
