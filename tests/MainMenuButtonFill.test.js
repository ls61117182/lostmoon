const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'scripts', 'view', 'MainMenuScene.ts'),
  'utf8',
);

test('main-menu button faces do not show background or decorative black seams', () => {
  const makeButtonStart = source.indexOf('private makeRectButton(');
  const makeButtonEnd = source.indexOf('/** 圆形 icon 按钮', makeButtonStart);
  const makeButton = source.slice(makeButtonStart, makeButtonEnd);

  assert.ok(makeButtonStart >= 0 && makeButtonEnd > makeButtonStart);
  assert.match(makeButton, /const opaqueFill = new Color\(c\.r, c\.g, c\.b, 255\)/);
  assert.match(makeButton, /drawFieldPanel\([\s\S]*?opaqueFill,[\s\S]*?TEXT_TITLE,[\s\S]*?false,/);
});
