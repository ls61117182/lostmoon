const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8').replace(/\r\n/g, '\n');
const refresh = source.match(/private refreshStatusPanel\(\) \{[\s\S]*?\n  \}\n\n  \/\*\* 绘制结束回合按钮/);

assert(refresh, 'refreshStatusPanel should remain discoverable');
assert.match(refresh[0], /new Set<number>\(s\.stats\.crewMembers\)/,
  'the status row should use the current tank crewMembers configuration');
assert.match(refresh[0], /iconNode\.active = slotExists/,
  'crew positions absent from the vehicle configuration should be hidden');
assert.match(
  refresh[0],
  /STATUS_CREW_START_X \+ \(visibleCrewIndex % STATUS_CREW_COLUMNS\) \* \(STATUS_CREW_ICON_SIZE \+ STATUS_CREW_ICON_GAP\)/,
  'visible crew icons should be compacted from the left edge without gaps',
);
assert.match(refresh[0], /if \(!slotExists\) \{[\s\S]*?continue;[\s\S]*?visibleCrewIndex\+\+/,
  'missing crew slots must not consume a visible layout position');
assert.match(refresh[0], /crewFirstY - Math\.floor\(visibleCrewIndex \/ STATUS_CREW_COLUMNS\)/,
  'the sixth visible crew member should start a second row');
assert.match(source, /const STATUS_CREW_COLUMNS = 5;/);

// Execute the production resize method with lightweight scene nodes: expanding and
// shrinking must preserve the top edge, move upgrades, and never accumulate drift.
const ts = require('typescript');
const vm = require('vm');
const resize = source.match(/  private resizeStatusCrewPanel\(crewCount: number\) \{[\s\S]*?\n  \}/);
assert(resize);
const UITransform = Symbol('UITransform');
const Graphics = Symbol('Graphics');
const Scene = vm.runInNewContext(ts.transpile(`class Scene { ${resize[0]} } Scene;`), {
  UITransform, Graphics, Color: class {}, drawFieldPanel() {},
  STATUS_CREW_COLUMNS: 5, STATUS_CREW_ICON_SIZE: 38, STATUS_CREW_ICON_GAP: 6,
  STATUS_PANEL_BG: {}, STATUS_PANEL_BORDER: {}, STATUS_TITLE_COLOR: {},
});
const node = (y) => ({ position: { x: 0, y, z: 0 }, setPosition(x, y, z) { this.position = { x, y, z }; } });
for (const baseHeight of [214, 236, 360]) {
  const scene = new Scene();
  const title = node(baseHeight / 2 - 22);
  const crewTitle = node(baseHeight / 2 - (baseHeight === 214 ? 150 : 172));
  const upgrade = baseHeight === 360 ? node(-110) : null;
  const upgradeTitle = upgrade ? node(-86) : null;
  const size = { contentSize: { width: 240, height: baseHeight }, setContentSize(width, height) { this.contentSize = { width, height }; } };
  const graphics = { clear() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const panel = node(300 - baseHeight / 2);
  panel.children = [title, crewTitle, upgrade, upgradeTitle].filter(Boolean);
  panel.getComponent = (type) => type === UITransform ? size : graphics;
  Object.assign(scene, { statusPanel: panel, statusCrewRowCount: 1,
    statusCrewTitleLabel: { node: crewTitle }, campaignUpgradeStatusRoot: upgrade,
    campaignUpgradeStatusTitleLabel: upgradeTitle ? { node: upgradeTitle } : null,
    layoutBattleHud() { panel.setPosition(0, 300 - size.contentSize.height / 2, 0); },
  });
  const titleWorldY = panel.position.y + title.position.y;
  const upgradeWorldY = upgrade && panel.position.y + upgrade.position.y;
  for (const count of [5, 6, 6, 4, 6, 5]) {
    scene.resizeStatusCrewPanel(count);
    const extra = count > 5 ? 44 : 0;
    assert.equal(size.contentSize.height, baseHeight + extra);
    assert.equal(panel.position.y + size.contentSize.height / 2, 300, 'panel top must stay fixed');
    assert.equal(panel.position.y + title.position.y, titleWorldY, 'status heading must stay fixed');
    if (upgrade) assert.equal(panel.position.y + upgrade.position.y, upgradeWorldY - extra);
  }
}

console.log('BattleScene status crew layout test passed');
