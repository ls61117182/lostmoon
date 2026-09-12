const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/view/BattleScene.ts'), 'utf8');
const methods = ['layoutCombatLogEntryNodes', 'syncCombatLogScrollAfterLayout',
  'refreshCombatLogEntryVisibility'].map(name => {
  const start = source.indexOf(`  private ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}).join('\n');
const compiled = ts.transpileModule(`class BattleScene {
  static COMBAT_LOG_BODY_LINE0 = 20;
  static COMBAT_LOG_BOTTOM_PAD = 4;
  ${methods}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2017 } }).outputText;
const Scene = new Function('UITransform', `${compiled}; return BattleScene;`)(class {});

function node(height) {
  const transform = { contentSize: { width: 100, height },
    setContentSize(width, h) { this.contentSize = { width, height: h }; } };
  return { isValid: true, active: true, position: { x: 0, y: 0 },
    getComponent: () => transform,
    setPosition(x, y) { this.position = { x, y }; } };
}

test('appended combat rows are bottom-aligned and clipped before layout returns', () => {
  const scene = new Scene();
  const scheduled = [];
  scene.scheduleOnce = callback => scheduled.push(callback);
  scene.getCombatLogBodyWidth = () => 100;
  scene.combatLogContent = node(60);
  scene.combatLogViewN = node(60);
  scene.combatLogEntryNodes = [];
  let stopped = 0;
  scene.combatLogScroll = { isValid: true,
    stopAutoScroll() { stopped++; },
    scrollToBottom() {
      scene.combatLogContent.position.y = scene.combatLogContent.getComponent().contentSize.height;
    },
    scrollToTop() { scene.combatLogContent.position.y = 60; },
  };
  for (let i = 0; i < 8; i++) {
    const row = node(20);
    scene.combatLogEntryNodes.push(row);
    scene.layoutCombatLogEntryNodes();
    assert.equal(row.active, true, 'the newest row must already be visible');
    assert.equal(scene.combatLogContent.position.y + row.position.y - 20, 4,
      'the newest row must already be at the final bottom inset');
    assert.equal(scheduled.length, 0, 'no next-frame jump may remain queued');
    for (const entry of scene.combatLogEntryNodes) {
      const top = scene.combatLogContent.position.y + entry.position.y;
      assert.equal(entry.active, top <= 60.5 && top - 20 >= -0.5);
    }
  }
  assert.equal(stopped, 8, 'old scroll inertia must not move the newly aligned content');
});
