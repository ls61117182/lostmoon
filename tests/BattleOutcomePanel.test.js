const assert = require('node:assert/strict');
const test = require('node:test');
const h = require('./helpers/BattleOutcomeHarness.cjs');
const text = (root, name) => h.find(root, name).getComponent(h.Label).string;

test('victory/defeat render counts, rates, empty states and localized retry actions', () => {
  const { panel, calls } = h.create();
  const stats = { ...h.cloneBattleStatistics(), attacksReceived: 12, hitsReceived: 7, penetrationsReceived: 2,
    mainGunHits: 8, mainGunHitChecks: 10, mainGunPenetrations: 3, mainGunPenetrationChecks: 5 };
  h.setLang('zh');
  panel.refresh(stats, true, false, false, 6);
  assert.equal(text(panel.root, 'Result'), '胜利！');
  assert.equal(text(h.find(panel.root, 'Received0'), 'Count'), '12');
  assert.equal(text(panel.root, 'Rate0'), '80%');
  assert.equal(text(panel.root, 'Rate1'), '60%');
  assert.equal(text(panel.root, 'Rate2'), '—');
  assert.equal(text(panel.root, 'Fraction0'), '8 命中 / 10 次判定');
  const nodeCount = panel.root.children.length;
  h.setLang('en');
  panel.refresh(stats, false, true, true, 6);
  assert.equal(text(panel.root, 'Result'), h.t('outcome.lose'));
  assert.equal(text(h.find(panel.root, 'RestartBtn'), 'Label'), h.t('btn.retryCampaignSegment'));
  assert.match(text(panel.root, 'Scope'), /Your tank destroyed/);
  assert.equal(panel.root.children.length, nodeCount, 'refresh reuses the panel');
  h.find(panel.root, 'RestartBtn').events.touchend();
  h.find(panel.root, 'BackToMenuBtn').events.touchend();
  assert.deepEqual(calls, ['retry', 'menu']);
});

test('report fits the battle canvas and scales down on smaller surfaces', () => {
  for (const [width, height] of [[1280, 720], [960, 540], [640, 360]]) {
    const { panel } = h.create(width, height);
    assert.ok(panel.root.getComponent(h.BlockInputEvents), 'modal blocks battlefield touches');
    const report = h.find(panel.root, 'Report');
    assert.ok(880 * report.scale <= width - 20);
    assert.ok(600 * report.scale <= height - 20);
    for (const child of report.children.filter(c => c.getComponent(h.UITransform))) {
      const size = child.getComponent(h.UITransform).contentSize;
      assert.ok(Math.abs(child.position.y) + size.height / 2 <= 300, child.name + ' fits vertically');
      assert.ok(Math.abs(child.position.x) + size.width / 2 <= 440, child.name + ' fits horizontally');
    }
  }
});

test('default 100x100 battle host does not shrink the report to a thumbnail', () => {
  const { panel, parent } = h.create();
  assert.deepEqual(parent.getComponent(h.UITransform).contentSize, { width: 100, height: 100 });
  assert.equal(h.find(panel.root, 'Report').scale, 1);
  assert.deepEqual(panel.root.getComponent(h.UITransform).contentSize, { width: 1280, height: 720 });
});

test('window resizing relayouts the report and its full-screen input mask together', () => {
  const { panel } = h.create();
  panel.layout({ width: 640, height: 360 });
  assert.equal(h.find(panel.root, 'Report').scale, 360 / 640);
  assert.deepEqual(panel.root.getComponent(h.UITransform).contentSize, { width: 640, height: 360 });
  const mask = panel.root.getComponent(h.Graphics).shapes;
  assert.equal(mask.length, 1);
  assert.deepEqual([mask[0].x, mask[0].y, mask[0].w, mask[0].h], [-320, -180, 640, 360]);
  panel.layout({ width: 1720, height: 720 });
  assert.equal(h.find(panel.root, 'Report').scale, 1);
  assert.equal(panel.root.getComponent(h.Graphics).shapes[0].w, 1720);
});
