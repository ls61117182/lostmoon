const assert = require('node:assert/strict');
const test = require('node:test');
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');

function fixture(outcome = 'defeat', pvp = false) {
  const panels = [], sent = [], completed = [];
  const Scene = sceneMethods(['cancelOutcomeOverlayDelay', 'waitForOutcomeOverlay', 'updateOutcomeOverlay', 'setOutcomeHudHidden',
    'lateUpdate', 'isOutcomeBattlefieldReview', 'onOutcomeBattlefieldViewChanged'], {
    GameSession: { isPvp: pvp }, PvpService: { sendBattleEvent: event => sent.push(event) },
    findLevelByMissionId: () => undefined,
    clearCompletedMissionSave: (...args) => completed.push(args),
    cloneBattleStatistics: stats => stats, battleCrewStatus: () => [],
    visibleSizeInRootSpace: () => ({ width: 1280, height: 720 }), UI_ROOT_SCALE: 1.5,
    BattleOutcomePanel: class {
      constructor() { this.root = { active: false, setSiblingIndex() {} }; this.isViewingBattlefield = false; this.refreshes = 0; panels.push(this); }
      refresh() { this.root.active = true; this.refreshes++; }
      hide() { this.root.active = false; }
    },
  });
  const scene = new Scene(), timers = new Map();
  let now = 0, schedules = 0;
  Object.assign(scene, {
    outcome, mission: { battleStatistics: {} }, missionId: 'test', missionSource: { type: 'custom' },
    outcomeOverlayDelayCallback: null, outcomeOverlayReady: false,
    outcomeHudVisibility: new Map(),
    closeDiePopover() {}, closeCrewTooltip() {}, closeBattleModal() {}, closeTileInspectModal() {},
    drawUnitEffects() {}, drawWeatherEffects() {},
    closeOutcomeReviewDetails() {}, refreshPhaseUI() {}, updateHUD() {}, refreshStatusPanel() {},
    node: { children: [] }, turn: 1, canAdvanceCampaignSegment: () => false,
    scheduleOnce: (fn, seconds) => { schedules++; timers.set(fn, now + seconds); },
    unschedule: fn => timers.delete(fn),
  });
  const advance = seconds => {
    now += seconds;
    for (const [fn, deadline] of timers) {
      if (deadline <= now + 1e-9) { timers.delete(fn); fn(); }
    }
  };
  return { scene, panels, timers, sent, completed, advance, schedules: () => schedules };
}

test('victory and defeat reports appear only after 1.5 seconds, without restarting on refresh', () => {
  for (const outcome of ['victory', 'defeat']) {
    const f = fixture(outcome);
    f.scene.updateOutcomeOverlay();
    assert.equal(f.panels.length, 0, 'no report or backdrop while waiting');
    f.advance(1);
    f.scene.updateOutcomeOverlay();
    f.advance(0.499);
    assert.equal(f.panels.length, 0);
    assert.equal(f.schedules(), 1);
    f.advance(0.001);
    assert.equal(f.panels.length, 1);
    assert.equal(f.panels[0].root.active, true);
    f.scene.updateOutcomeOverlay();
    assert.equal(f.schedules(), 1, 'visible report refreshes immediately');
    assert.equal(f.panels[0].refreshes, 2);
  }
});

test('HUD and battle log hide only when the report appears and restore their prior visibility on retry', () => {
  const f = fixture();
  const hud = { isValid: true, active: true }, log = { isValid: true, active: true };
  const eventPanel = { isValid: true, active: false };
  Object.assign(f.scene, { hudRoot: hud, combatLogRoot: log, fireCheckEventUI: { root: eventPanel } });
  f.scene.updateOutcomeOverlay();
  f.advance(1);
  assert.equal(hud.active, true);
  assert.equal(log.active, true);
  f.advance(0.5);
  assert.equal(hud.active, false);
  assert.equal(log.active, false);
  f.scene.updateOutcomeOverlay();
  assert.equal(hud.active, false, 'refresh does not reveal the HUD');
  hud.active = true; // A late animation callback attempts to restore an old control.
  f.scene.lateUpdate();
  assert.equal(hud.active, false, 'late callbacks cannot expose controls over the report');
  f.scene.outcome = 'ongoing';
  f.scene.updateOutcomeOverlay();
  assert.equal(hud.active, true);
  assert.equal(log.active, true);
  assert.equal(eventPanel.active, false, 'previously hidden controls stay hidden');
  assert.equal(f.panels[0].root.active, false);
  assert.equal(f.scene.outcomeHudVisibility.size, 0);
});

test('ended battle does not accept map interactions unless battlefield review is open', () => {
  const Scene = sceneMethods(['onTouchMap', 'isOutcomeBattlefieldReview']);
  for (const outcome of ['victory', 'defeat']) {
    const scene = new Scene();
    Object.assign(scene, { outcome, mission: {}, isBusy: () => false,
      mapNode: { getComponent: () => assert.fail('ended battlefield must not reach map interaction') } });
    scene.onTouchMap({ getStartLocation: () => ({ x: 0, y: 0 }), getLocation: () => ({ x: 0, y: 0 }) });
  }
});

test('battlefield review restores HUD/log and report refreshes keep them visible until returning', () => {
  const f = fixture();
  const hud = { isValid: true, active: true }, log = { isValid: true, active: true };
  Object.assign(f.scene, { hudRoot: hud, combatLogRoot: log });
  f.scene.updateOutcomeOverlay(); f.advance(1.5);
  f.panels[0].isViewingBattlefield = true;
  f.scene.onOutcomeBattlefieldViewChanged(true);
  assert.equal(hud.active, true); assert.equal(log.active, true);
  f.scene.lateUpdate(); f.scene.updateOutcomeOverlay();
  assert.equal(hud.active, true); assert.equal(log.active, true);
  f.panels[0].isViewingBattlefield = false;
  f.scene.onOutcomeBattlefieldViewChanged(false);
  assert.equal(hud.active, false); assert.equal(log.active, false);
});

test('review clicks open tile information while victory/defeat and game state remain unchanged', () => {
  const Scene = sceneMethods(['onTouchMap']);
  for (const outcome of ['victory', 'defeat']) {
    const scene = new Scene(), tile = { pos: { q: 1, r: 2 } }, opened = [];
    const mission = { turn: 9 };
    Object.assign(scene, { outcome, mission, mapNode: {}, isOutcomeBattlefieldReview: () => true,
      isBusy: () => true, pickTileAtScreenUi: () => tile, openTileInspectModal: t => opened.push(t),
      tryAttack: () => assert.fail('review cannot fire'),
      tryAimShermanTurretAtFogTile: () => assert.fail('review cannot aim') });
    const event = { getStartLocation: () => ({ x: 1, y: 1 }), getLocation: () => ({ x: 1, y: 1 }) };
    scene.onTouchMap(event);
    assert.deepEqual(opened, [tile]);
    assert.equal(scene.outcome, outcome); assert.deepEqual(mission, { turn: 9 });
    scene.pickTileAtScreenUi = () => null;
    scene.onTouchMap(event);
    assert.equal(opened.length, 1);
  }
});

test('review can open read-only combat history despite an obsolete final-action busy state', () => {
  const Scene = sceneMethods(['openPendingCombatLogReplayIfReady'], { unitDisplayName: kind => kind });
  const scene = new Scene(), options = [], replay = { kind: 'attack', report: { hit: true },
    attackerKind: 'sherman', targetKind: 'tiger', mg: false };
  Object.assign(scene, { pendingCombatLogReplay: replay, isBusy: () => true,
    isOutcomeBattlefieldReview: () => true, closeOutcomeReviewDetails: () => { scene.pendingCombatLogReplay = null; },
    startDiceShow: (_report, _a, _b, _done, opts) => options.push(opts) });
  assert.equal(scene.openPendingCombatLogReplayIfReady(), true);
  assert.equal(options[0].showSettled, true);
  assert.equal(options[0].fireEffectPlayed, true);
  assert.equal(scene.combatLogReplayOpen, true);
  scene.pendingCombatLogReplay = replay;
  scene.isOutcomeBattlefieldReview = () => false;
  assert.equal(scene.openPendingCombatLogReplayIfReady(), false, 'ordinary battles keep their busy-state protection');
});

test('returning to the report closes detail/replay panels without running battle continuation', () => {
  const Scene = sceneMethods(['closeOutcomeReviewDetails']);
  const scene = new Scene(), closed = [];
  Object.assign(scene, { pendingCombatLogReplay: {}, combatLogReplayOpen: true, combatLogAIResume: () => assert.fail('AI must not resume'),
    closeDiePopover() {}, closeCrewTooltip() {}, closeBattleModal: () => closed.push('settings'),
    closeTileInspectModal: () => closed.push('tile'), finalizeDiceShow: skip => assert.equal(skip, true),
    destroyTurnEndEventUI() {}, destroyFireCheckEventUI() {}, destroyUsCasualtyEventUI() {} });
  scene.closeOutcomeReviewDetails();
  assert.deepEqual(closed, ['settings', 'tile']);
  assert.equal(scene.pendingCombatLogReplay, null); assert.equal(scene.combatLogReplayOpen, false);
  assert.equal(scene.combatLogAIResume, null);
});

test('reviewing ended battles cannot advance a phase or skip to another campaign segment', () => {
  const Scene = sceneMethods(['onAdvanceClicked', 'debugSkipCampaignSegment', 'computeAdvanceButton'], { playUiClick() {} });
  for (const outcome of ['victory', 'defeat']) {
    const scene = new Scene();
    Object.assign(scene, { outcome, phase: 'player', playerStep: 'attack', isBusy: () => false,
      isPvpWaitingForRemoteAction: () => false,
      endCurrentSubPhase: () => assert.fail('review must not advance'),
      advanceCampaignSegment: () => assert.fail('review must not skip segments') });
    scene.onAdvanceClicked(); scene.debugSkipCampaignSegment();
    assert.equal(scene.computeAdvanceButton().visible, false);
  }
});

test('retry cancels the old timer and gives the next result its own full delay', () => {
  const f = fixture();
  f.scene.updateOutcomeOverlay();
  const stale = f.scene.outcomeOverlayDelayCallback;
  f.advance(0.5);
  f.scene.outcome = 'ongoing';
  f.scene.updateOutcomeOverlay();
  assert.equal(f.timers.size, 0);
  f.scene.outcome = 'victory';
  f.scene.updateOutcomeOverlay();
  stale();
  assert.equal(f.panels.length, 0);
  f.advance(1.499);
  assert.equal(f.panels.length, 0);
  f.advance(0.001);
  assert.equal(f.panels.length, 1);
});

test('departing or replacing the mission prevents a stale report from appearing', () => {
  for (const action of [f => { f.scene.leavingBattle = true; }, f => { f.scene.mission = {}; },
    f => f.scene.cancelOutcomeOverlayDelay()]) {
    const f = fixture();
    f.scene.updateOutcomeOverlay();
    action(f);
    f.advance(2);
    assert.equal(f.panels.length, 0);
  }
});

test('PvP notification and victory save cleanup happen immediately while the report waits', () => {
  const f = fixture('defeat', true);
  f.scene.updateOutcomeOverlay();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].kind, 'outcome');
  assert.equal(f.panels.length, 0);
  const victory = fixture('victory');
  victory.scene.updateOutcomeOverlay();
  assert.equal(victory.completed.length, 1);
  assert.equal(victory.panels.length, 0);
});

test('intermediate campaign victory advances without opening or scheduling the final report', () => {
  const f = fixture('victory');
  let advanced = false;
  f.scene.canAdvanceCampaignSegment = () => true;
  f.scene.advanceCampaignSegment = () => { advanced = true; };
  f.scene.updateOutcomeOverlay();
  assert.equal(advanced, true);
  assert.equal(f.schedules(), 0);
});
