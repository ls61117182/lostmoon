const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const presentation = {};
new Function('exports', compile(fs.readFileSync('assets/scripts/core/TurnEndPresentation.ts', 'utf8')))(presentation);
const db = {};
new Function('exports', compile(fs.readFileSync('assets/scripts/core/LangDB.ts', 'utf8')))(db);
const t = (key, params = {}) => {
  assert.ok(db.LANG_DB[key], `missing translation: ${key}`);
  return db.LANG_DB[key].zh.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
};
const row = (key, dice, params = {}) => presentation.turnEndRowPresentation(
  { captionKey: `turnEnd.extra.${key}`, dice }, '', params, '', t);

test('mechanical immunity replaces the primary verdict, with no extra check', () => {
  const normal = presentation.turnEndRowPresentation(null, 'turnEnd.mechanical.ok', {}, 'battle.turnEndList.effect.mechanical_failure', t);
  const immune = presentation.turnEndRowPresentation(null, 'turnEnd.mechanical.protected', {}, 'battle.turnEndList.effect.mechanical_failure', t);
  assert.equal(normal.result, '机械故障');
  assert.equal(immune.result, '免疫');
  assert.equal(immune.tone, 'safe');
});

test('AA, bombing, mines and mortar respect threshold boundaries and player-relative colors', () => {
  for (const [key, threshold, success, safe] of [
    ['stukaAa', 6, '击落', true], ['stukaBomb', 8, '命中', false],
    ['stukaPen', 3, '击穿', false], ['minePen', 4, '击穿', false], ['mortarPen', 8, '击穿', false],
  ]) {
    const dice = sum => sum > 6 ? [4, sum - 4] : [sum];
    const passed = row(key, dice(threshold));
    const failed = row(key, dice(threshold - 1));
    assert.equal(passed.result, success);
    assert.equal(passed.tone, safe ? 'safe' : 'danger');
    assert.equal(failed.tone, safe ? 'danger' : 'safe');
  }
});

test('damage and crew outcomes use the resolved report, including the localized role', () => {
  assert.equal(row('mineDmg', [6], { resultKey: 'dmg.outcome.paralyzed' }).result, '瘫痪');
  const params = { resultKey: 'crew.death.kia', roleKey: 'crew.role.1' };
  assert.equal(row('stukaDamage', [3], params).result, '阵亡检定');
  assert.match(row('stukaCrew', [1], params).result, /车长.*阵亡/);
  assert.equal(row('stukaCrew', [6], { resultKey: 'crew.death.falseAlarm' }).tone, 'safe');
});

test('early termination explains why downstream dice are unnecessary', () => {
  for (const key of ['turnEnd.stuka.shotDown', 'turnEnd.stuka.bombMiss', 'turnEnd.stuka.ric', 'turnEnd.mine.ric', 'turnEnd.heavyMortar.ric']) {
    assert.match(t(presentation.turnEndSummaryKey(key)), /无需/);
  }
});

const scene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
function method(name, next) {
  const start = scene.indexOf(`  private ${name}(`);
  const end = scene.indexOf(`  private ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  return scene.slice(start, end);
}
const harnessCode = compile(`class Harness {
  ${method('startTurnEndEventPresentation', 'buildTurnEndEventPanel')}
  ${method('applyTurnEndEventEffects', 'enqueueTankReinforceMoveAnim')}
  ${method('setupTurnEndExtraRoll', 'advanceTurnEndEventUI')}
  ${method('advanceTurnEndEventUI', 'onTurnEndConfirmClick')}
}`);
let mineSoundCount = 0;
const Harness = new Function('t', 'DICE_ROLL_DUR', 'playDiceRoll', 'playHighExplosiveHit', `${harnessCode}; return Harness;`)(t, 0.6, () => {}, () => mineSoundCount++);
const label = () => ({ string: '', node: {} });
function harness(phases) {
  const h = new Harness();
  h.setDieLabelFace = (lab, value) => { lab.string = String(value); };
  h.turnEndBodyText = () => '最终结果';
  h.turnEndEventUI = {
    stage: 'roll_primary', t: 0, primaryDice: [4, 6], dieLabels: [label(), label()],
    eventVerdictLabel: label(), eventResult: '斯图卡空袭', bodyLabel: label(),
    confirmButton: { active: false }, extraPhases: phases, extraIdx: 0,
    extraRows: phases.map((phase, i) => ({ root: { active: false }, dice: phase.dice.map(label), verdict: label(), result: `结果${i}`, highlight: { active: false } })),
  };
  return h;
}

test('real event animation preserves earlier dice and reveals confirmation only after all rows', () => {
  const h = harness([{ dice: [2, 3] }, { dice: [5, 4] }, { dice: [2] }]);
  const ui = h.turnEndEventUI;
  h.advanceTurnEndEventUI(1);
  assert.equal(ui.eventVerdictLabel.string, '斯图卡空袭');
  h.advanceTurnEndEventUI(1);
  for (let i = 0; i < ui.extraPhases.length; i++) {
    assert.equal(ui.stage, 'roll_extra');
    assert.equal(ui.confirmButton.active, false);
    assert.equal(ui.extraRows[i].highlight.active, true);
    h.advanceTurnEndEventUI(1);
    assert.equal(ui.extraRows[i].verdict.string, `结果${i}`);
    h.advanceTurnEndEventUI(1);
  }
  assert.equal(ui.stage, 'hold');
  assert.equal(ui.confirmButton.active, true);
  assert.deepEqual(ui.extraRows.map(r => r.dice.map(d => Number(d.string))), [[2, 3], [5, 4], [2]]);
  assert.deepEqual(ui.dieLabels.map(d => Number(d.string)), [4, 6]);
});

test('mine explosions start before dice and confirmation, excluding skipped and replayed events', () => {
  for (const bodyKey of ['turnEnd.mine.hit', 'turnEnd.mine.ric', 'turnEnd.clearMine.hit', 'turnEnd.mine.skip', 'turnEnd.mine.protected', 'turnEnd.clearMine.skip', 'turnEnd.clearMine.protected']) {
    for (const historyReplay of [false, true]) {
      const h = harness([]);
      Object.assign(h.turnEndEventUI, { bodyKey, historyReplay });
      h.mission = { sherman: { id: 'tank', pos: { q: 2, r: 3 } } };
      h.project = (q, r) => ({ x: q * 10, y: r * 10 });
      h.hashStringToSeed = () => 42;
      const blasts = [];
      h.spawnHighExplosiveBlast = (...args) => blasts.push(args);
      h.snapshotDestroyedUnitIds = () => new Set();
      h.registerNewlyDestroyedSince = () => {};
      h.refreshStatusPanel = h.redraw = () => {};
      let applied = 0;
      h.turnEndEventUI.apply = () => applied++;
      mineSoundCount = 0;
      h.startTurnEndEventPresentation(h.turnEndEventUI);
      h.startTurnEndEventPresentation(h.turnEndEventUI);
      assert.equal(applied, historyReplay ? 0 : 1);
      h.advanceTurnEndEventUI(1);
      h.advanceTurnEndEventUI(1);
      const explodes = !historyReplay && ['turnEnd.mine.hit', 'turnEnd.mine.ric', 'turnEnd.clearMine.hit'].includes(bodyKey);
      assert.equal(mineSoundCount, explodes ? 1 : 0, bodyKey);
      assert.deepEqual(blasts, explodes ? [[20, 30, 42]] : [], bodyKey);
      if (!historyReplay) {
        h.applyTurnEndEventEffects(h.turnEndEventUI, () => {});
        assert.equal(applied, 1, 'confirmation must not apply the event again');
      }
    }
  }
});

test('reinforcement movement begins immediately and finishes without confirmation', () => {
  const h = harness([]);
  const unit = { id: 'reinforcement' };
  h.mission = { allies: [], enemies: [] };
  h.canMoveToBattleTile = () => true;
  h.snapshotDestroyedUnitIds = () => new Set();
  h.registerNewlyDestroyedSince = h.refreshStatusPanel = h.redraw = () => {};
  let applications = 0;
  h.turnEndEventUI.apply = () => { applications++; h.mission.enemies.push(unit); };
  const move = { unitId: unit.id, to: { q: 1, r: 2 } };
  h.turnEndEventUI.tankReinforceMove = move;
  let moves = 0;
  h.enqueueTankReinforceMoveAnim = (actor, path) => {
    assert.equal(actor, unit); assert.equal(path, move); moves++;
  };
  h.startTurnEndEventPresentation(h.turnEndEventUI);
  assert.equal(moves, 1);
  assert.equal(applications, 1);
  assert.equal(h.turnEndEventUI.presentationPending, true);
  h.startTurnEndEventPresentation(h.turnEndEventUI);
  assert.equal(moves, 1);
  h.pendingAfterAnimChain();
  assert.equal(h.turnEndEventUI.presentationPending, false);
  h.applyTurnEndEventEffects(h.turnEndEventUI, () => {});
  assert.equal(applications, 1);
  assert.equal(moves, 1);
});

test('adjacent infantry retains its individual resolution flow', () => {
  const h = harness([]);
  h.mission = {};
  h.turnEndEventUI.adjacentInfantryVolleys = [{}];
  h.turnEndEventUI.apply = () => assert.fail('must not apply adjacent volleys at startup');
  h.startTurnEndEventPresentation(h.turnEndEventUI);
  assert.equal(h.turnEndEventUI.effectApplied, undefined);
});

test('a mechanical event finishes immediately after its only dice row', () => {
  const h = harness([]);
  h.advanceTurnEndEventUI(1);
  assert.equal(h.turnEndEventUI.stage, 'hold');
  assert.equal(h.turnEndEventUI.confirmButton.active, true);
  assert.equal(h.turnEndEventUI.extraRows.length, 0);
});

// Run the actual panel builder with small engine doubles to verify row counts,
// initial visibility and geometry without starting the Cocos editor.
class Node {
  children = [];
  active = true;
  constructor(name) { this.name = name; }
  addChild(child) { this.children.push(child); }
  addComponent() { return { setContentSize() {}, roundRect() {}, fill() {} }; }
  setSiblingIndex() {}
  setPosition(x, y) { this.x = x; this.y = y; }
  setScale(x, y) { this.scale = [x, y]; }
}
const globals = {
  Node, UITransform: {}, Graphics: {}, BlockInputEvents: {},
  Label: { Overflow: { SHRINK: 1, CLAMP: 2 } },
  Color: class {}, CANVAS_W: 1280, CANVAS_H: 720, UI_ROOT_SCALE: 1,
  DICE_BACKDROP: {}, DICE_PANEL_BG: {}, DICE_PANEL_BORDER: {}, HUD_TEXT_COLOR: {},
  DICE_INFO_TEXT: {}, DICE_OK_TEXT: {}, BATTLE_BTN_ACCENT: {},
  createAdaptiveFullscreenMask: () => ({ node: new Node('Mask') }),
  drawDicePopupPanel: () => {}, t, turnEndRowPresentation: presentation.turnEndRowPresentation,
};
const PanelHarness = new Function(...Object.keys(globals), compile(`class PanelHarness {
  ${method('buildTurnEndEventPanel', 'beginAdjacentInfantryDiceChain')}
}`) + ';return PanelHarness;')(...Object.values(globals));
function buildPanel(phases, bodyKey = 'turnEnd.mechanical.ok') {
  const h = new PanelHarness();
  h.node = new Node('Scene');
  h.labels = [];
  h.buttons = [];
  h.turnEndBodyText = () => '最终结果';
  h.measureBattleModalText = () => ({ height: 48 });
  h.makeCenteredLabel = (_, string, x, y, w, height) => {
    const result = { string, x, y, w, height };
    h.labels.push(result);
    return result;
  };
  h.makeDieSquare = () => label();
  h.setDieLabelFace = (lab, value) => { lab.string = String(value); };
  h.makeBattleRectButton = (_, x, y, w, height) => {
    const result = { node: new Node('Button'), x, y, w, height };
    h.buttons.push(result);
    return result;
  };
  h.makeBattleModalLabel = () => label();
  h.mirrorBattleModalButtonLabel = () => {};
  const refs = h.buildTurnEndEventPanel([4, 5], phases, bodyKey, { resultKey: 'dmg.outcome.paralyzed' }, 'battle.turnEndList.effect.mechanical_failure');
  return { h, refs };
}

test('mechanical panel has one dice row and one initially hidden confirmation button', () => {
  const { h, refs } = buildPanel([], 'turnEnd.mechanical.protected');
  assert.equal(refs.eventResult, '免疫');
  assert.equal(refs.extraRows.length, 0);
  assert.equal(h.buttons.length, 1);
  assert.equal(refs.confirmButton.active, false);
  assert.ok(!h.labels.some(l => l.string === '故障结算'));
});

test('long Stuka panel reserves separate rows and clearance above confirmation', () => {
  const phases = ['stukaAa', 'stukaBomb', 'stukaPen', 'stukaDamage', 'stukaCrew'].map(key => ({ captionKey: `turnEnd.extra.${key}`, dice: key === 'stukaAa' || key === 'stukaBomb' ? [2, 3] : [6] }));
  const { h, refs } = buildPanel(phases);
  assert.equal(refs.extraRows.length, 5);
  assert.ok(refs.extraRows.every(r => !r.root.active));
  const rowYs = refs.extraRows.map(r => r.verdict.y);
  assert.equal(new Set(rowYs).size, 5);
  assert.ok(refs.bodyLabel.y + refs.bodyLabel.height / 2 < Math.min(...rowYs) - 24);
  assert.ok(refs.bodyLabel.y - refs.bodyLabel.height / 2 >= h.buttons[0].y + 22 + 24);
});
