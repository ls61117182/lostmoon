const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'scripts', 'view', 'BattleScene.ts'),
  'utf8',
);

function method(name, nextMarker) {
  const start = source.indexOf(name);
  const end = source.indexOf(nextMarker, start);
  assert.ok(start >= 0 && end > start, `${name} should be present`);
  return source.slice(start, end);
}

test('battle button faces omit decorative black inner strokes and do not show map seams', () => {
  const fieldPanel = method('function drawFieldPanel(', 'function drawDicePopupPanel');
  assert.match(fieldPanel, /drawInnerStroke: boolean = true/);
  assert.match(fieldPanel, /if \(drawInnerStroke\) \{[\s\S]*?new Color\(14, 16, 14, 185\)/);

  const endTurn = method('private drawEndTurnBg(', 'private updateHUD(');
  assert.match(endTurn, /opaqueButtonFill\(fill\)/);
  assert.match(endTurn, /STATUS_TITLE_COLOR, false\)/);

  const modalButton = method('private makeBattleRectButton(', 'private makeBattleCircleButton(');
  assert.match(modalButton, /opaqueButtonFill\(c\)/);
  assert.match(modalButton, /STATUS_TITLE_COLOR,[\s\S]*?false,/);

  const chooseBar = method('private buildChooseBar(', 'private onChooseHatchClick(');
  assert.match(chooseBar, /bg\.fillColor = opaqueButtonFill\(color\)/);

  const phaseState = method('private setPhaseBtnEnabled(', 'private estimateEnLabelWidth(');
  assert.match(phaseState, /g\.fillColor = opaqueButtonFill\(enabled \? baseColor : PHASE_BTN_DISABLED\)/);

  const popover = method('private showDiePopover(', '// ---------- 移动阶段动作 ----------');
  assert.match(popover, /bg\.fillColor = opaqueButtonFill\(it\.color\)/);
});
