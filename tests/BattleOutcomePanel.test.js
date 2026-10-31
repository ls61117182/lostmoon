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

test('battlefield review and report return preserve statistics, crew status, and list scroll position', () => {
  h.setLang('zh');
  const { panel, viewChanges } = h.create();
  const stats = { ...h.cloneBattleStatistics(), killsByKind: { tiger: 3 } };
  const crew = [{ slot: 1, alive: true }, { slot: 2, alive: false }];
  panel.refresh(stats, false, false, false, 7, crew);
  const report = h.find(panel.root, 'Report');
  const content = h.find(panel.root, 'KillsContent');
  const row = h.find(panel.root, 'KillRow0');
  content.setPosition(0, 164);
  assert.equal(text(h.find(panel.root, 'ViewBattlefieldBtn'), 'Label'), '查看战场');
  h.find(panel.root, 'ViewBattlefieldBtn').events.touchend();
  assert.equal(report.active, false);
  assert.equal(panel.root.active, true);
  assert.equal(panel.isViewingBattlefield, true);
  assert.equal(h.find(panel.root, 'OutcomeBackdrop').active, false, 'review lets map/HUD clicks through');
  assert.equal(h.find(panel.root, 'OutcomeBackdrop').getComponent(h.Graphics).shapes.length, 0, 'review shows the undimmed battlefield');
  assert.equal(h.find(panel.root, 'ReturnReportBtn').active, true);
  assert.equal(text(h.find(panel.root, 'ReturnReportBtn'), 'Label'), '返回战斗报告');
  panel.refresh(stats, false, false, false, 7, crew);
  assert.equal(report.active, false, 'data refresh does not interrupt battlefield review');
  panel.layout({ width: 1600, height: 900 });
  assert.deepEqual(h.find(panel.root, 'ReturnReportBtn').position, { x: 0, y: -406 });
  h.find(panel.root, 'ReturnReportBtn').events.touchend();
  assert.equal(report.active, true);
  assert.equal(h.find(panel.root, 'ReturnReportBtn').active, false);
  assert.equal(h.find(panel.root, 'OutcomeBackdrop').getComponent(h.Graphics).shapes.length, 1);
  assert.equal(h.find(panel.root, 'OutcomeBackdrop').active, true);
  assert.equal(h.find(panel.root, 'KillRow0'), row);
  assert.equal(content.position.y, 164);
  assert.equal(text(panel.root, 'KillsTitle'), '击毁清单 · 3');
  assert.equal(text(panel.root, 'CrewRow1'), '炮手 — 阵亡');
  h.find(panel.root, 'ViewBattlefieldBtn').events.touchend();
  panel.hide();
  assert.equal(panel.root.active, false);
  panel.refresh(stats, true, false, false, 8, crew);
  assert.equal(report.active, true, 'a new result starts with its report visible');
  assert.deepEqual(viewChanges, [true, false, true, false]);
});

test('report fits the battle canvas and scales down on smaller surfaces', () => {
  for (const [width, height] of [[1280, 720], [960, 540], [640, 360]]) {
    const { panel } = h.create(width, height);
    assert.ok(h.find(panel.root, 'OutcomeBackdrop').getComponent(h.BlockInputEvents), 'report backdrop blocks battlefield touches');
    const report = h.find(panel.root, 'Report');
    assert.ok(1100 * report.scale <= width - 20);
    assert.ok(640 * report.scale <= height - 20);
    for (const child of report.children.filter(c => c.getComponent(h.UITransform))) {
      const size = child.getComponent(h.UITransform).contentSize;
      assert.ok(Math.abs(child.position.y) + size.height / 2 <= 320, child.name + ' fits vertically');
      assert.ok(Math.abs(child.position.x) + size.width / 2 <= 550, child.name + ' fits horizontally');
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
  assert.equal(h.find(panel.root, 'Report').scale, 360 / 680);
  assert.deepEqual(panel.root.getComponent(h.UITransform).contentSize, { width: 640, height: 360 });
  const mask = h.find(panel.root, 'OutcomeBackdrop').getComponent(h.Graphics).shapes;
  assert.equal(mask.length, 1);
  assert.deepEqual([mask[0].x, mask[0].y, mask[0].w, mask[0].h], [-320, -180, 640, 360]);
  panel.layout({ width: 1720, height: 720 });
  assert.equal(h.find(panel.root, 'Report').scale, 1);
  assert.equal(h.find(panel.root, 'OutcomeBackdrop').getComponent(h.Graphics).shapes[0].w, 1720);
});

test('kill and crew lists replace explanatory text, localize, and scroll without clipping entries', () => {
  h.setLang('zh');
  const { panel } = h.create();
  const stats = { ...h.cloneBattleStatistics(), killsByKind: { tiger: 3, infantry: 2 } };
  panel.refresh(stats, true, false, false, 7, [{ slot: 1, alive: true }, { slot: 2, alive: false }]);
  assert.equal(h.find(panel.root, 'CountingRules'), undefined);
  assert.equal(text(panel.root, 'KillsTitle'), '击毁清单 · 5');
  assert.match(text(panel.root, 'KillRow0'), /× 2/);
  assert.equal(text(panel.root, 'CrewRow0'), '车长 — 存活');
  assert.equal(text(panel.root, 'CrewRow1'), '炮手 — 阵亡');
  assert.equal(h.find(panel.root, 'CrewRow2').active, false);
  assert.equal(h.find(panel.root, 'CrewRow1').getComponent(h.Label).color.r, 224);
  const oldRow = h.find(panel.root, 'KillRow0');
  panel.refresh(stats, true, false, false, 7);
  assert.equal(h.find(panel.root, 'KillRow0'), oldRow, 'unchanged list preserves scroll and nodes');
  h.setLang('en');
  panel.refresh(stats, false, false, false, 7, [{ slot: 2, alive: false }]);
  assert.equal(text(panel.root, 'CrewRow0'), 'Gunner — KIA');
  assert.equal(h.find(panel.root, 'KillsContent').children.length, 2);
  // Use real translated kinds to exercise a list longer than its viewport.
  stats.killsByKind = Object.fromEntries(['sherman','tiger','panzer3','panzer4','panther','infantry','japanese_infantry','type95','type97'].map(kind => [kind, 1]));
  panel.refresh(stats, true, false, false, 7);
  assert.equal(h.find(panel.root, 'KillsContent').getComponent(h.UITransform).contentSize.height, 9 * 32);
  assert.ok(h.find(panel.root, 'KillsViewport').getComponent(h.Mask));
  assert.equal(h.find(panel.root, 'KillsViewport').getComponent(h.ScrollView).vertical, true);
});
