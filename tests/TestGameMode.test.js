const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { getGameModeConfig, isGameMode, normalizeSelectedGameMode } = require('../assets/scripts/core/GameMode.ts');
const { actionDicePool, rollActionDice, classifyMoveDie, classifyAttackDie, classifyMiscDie } = require('../assets/scripts/core/ActionDice.ts');
const { effectiveTankCrew, resolvedLoadedShell } = require('../assets/scripts/core/types.ts');
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { captureSave, applySave } = require('../assets/scripts/core/SaveLoad.ts');

// Execute the actual scene methods without loading the Cocos renderer.
const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const ast = ts.createSourceFile('BattleScene.ts', source, ts.ScriptTarget.Latest, true);
const sceneClass = ast.statements.find(s => ts.isClassDeclaration(s) && s.name.text === 'BattleScene');
const names = ['enterPhase', 'enterPhaseIfChoose', 'endCurrentSubPhase', 'dieStep', 'findDoublesPartner', 'beginPlayerDiceSortAnim',
  'selectGunDie', 'selectGunDieDoubles', 'selectPrecisionGunDie', 'selectMGDie', 'tryReload',
  'tryTurnSherman', 'tryDriveSherman', 'autoEnterPhaseWhenReady', 'beginPlayerPhaseForNewTurn',
  'usePhaseDice', 'completePhaseDiceAction', 'autoEndPhaseIfDone', 'dieActionHint', 'playerDieFillColor', 'refreshDiceTray', 'canToggleHatch'];
const methods = names.map(name => sceneClass.members.find(m => m.name?.getText(ast) === name).getText(ast));
const session = { gameMode: 'test', isPvp: false };
const context = vm.createContext({ ...require('../assets/scripts/core/TankRiding.ts'), GameSession: session, getGameModeConfig, actionDicePool, rollActionDice,
  effectiveTankCrew, resolvedLoadedShell, effectiveDiceTerrain: tile => tile.terrain, DICE_ROLL_DUR: 1, playDiceRoll() {},
  clearLockedFire() {}, beginAmbushTurn() {}, classifyMoveDie, classifyAttackDie, classifyMiscDie, t: key => key,
  AI_ATTACK_DIE_FILL: 'attack-red', AI_MOVE_DIE_FILL: 'move-green', AI_MISC_DIE_FILL: 'misc',
  DIE_HINT_GREEN: 'green', DIE_HINT_RED: 'red', DIE_HINT_GREY: 'grey',
  visibleSizeInRootSpace: () => ({ width: 1280 }), UI_ROOT_SCALE: 1.5, ADVANCE_BTN_W: 160,
});
const code = `class BattleScene { static PLAYER_DICE_SORT_DUR = 1; static DICE_TRAY_SLOT = 72;
  static DICE_TRAY_GAP = 12; ${methods.join('\n')} }; globalThis.Scene = BattleScene;`;
vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
const plain = value => JSON.parse(JSON.stringify(value));
function harness(mode = 'test') {
  session.gameMode = mode;
  const h = new context.Scene();
  const missionData = JSON.parse(fs.readFileSync('assets/resources/missions/mission_03.json', 'utf8'));
  h.mission = loadMission(missionData, undefined, { hardcore: mode !== 'classic' });
  h.allUnits = () => [h.mission.sherman, ...h.mission.allies, ...h.mission.enemies];
  Object.assign(h, { playerStep: 'choose', phase: 'player', outcome: 'ongoing', movementDone: false,
    attackDone: false, miscDone: false, phaseDice: [], rng: { d6: (() => { let n = 0; return () => ++n % 6 + 1; })() },
    campaignUpgradesEnabled: () => false, campaignUpgradeActive: () => false, isBusy: () => false,
    clearGunSelection() {}, closeDiePopover() {}, updateHUD() {}, redraw() {}, refreshPhaseUI() {}, battleLogI18n() {},
    playerDiceSlotX: i => i * 50, fadeTankTracksAtTurnEnd() {}, beginFireCheckPhase() {},
  });
  return h;
}

test('test mode is selectable and shares every hardcore rule', () => {
  assert.equal(isGameMode('test'), true);
  assert.equal(normalizeSelectedGameMode('test'), 'test');
  assert.deepEqual(getGameModeConfig('test'), getGameModeConfig('hardcore'));
});

test('combined roll uses both hardcore pools from the same starting terrain and crew', () => {
  const h = harness();
  h.enterPhase('attack');
  const s = h.mission.sherman;
  const options = { terrain: h.mission.map.get(s.pos).terrain, crew: effectiveTankCrew(s),
    hatchOpen: !!s.hatchOpen, hardcore: true, commanderBonusWithoutOpenHatch: true,
    mobility: s.stats.mobility, firepower: s.stats.firepower };
  const attack = actionDicePool({ ...options, subPhase: 'attack' });
  const movement = actionDicePool({ ...options, subPhase: 'movement' });
  assert.equal(h.phaseDice.length, attack + movement);
  assert(h.phaseDice.slice(0, attack).every(d => d.type === 'attack'));
  assert(h.phaseDice.slice(attack).every(d => d.type === 'movement'));
  assert.equal(h.playerDiceRollAnim.finalPips.length, attack + movement);
  assert.equal(h.playerDiceRollAnim.logEntry.params.phaseKey, 'battleLog.phase.attackMovement');
});

test('sorting groups attack before movement and sorts pips inside each group', () => {
  const h = harness();
  h.phaseDice = [{ pip: 6, type: 'attack' }, { pip: 3, type: 'attack' },
    { pip: 5, type: 'movement' }, { pip: 1, type: 'movement' }];
  assert.equal(h.beginPlayerDiceSortAnim(), true);
  assert.deepEqual(plain(h.phaseDice), [{ pip: 3, type: 'attack' }, { pip: 6, type: 'attack' },
    { pip: 1, type: 'movement' }, { pip: 5, type: 'movement' }]);
  assert.deepEqual(plain(h.playerDiceSortAnim.fromX), [50, 0, 150, 100]);
});

test('matching dice cannot form a pair across action columns', () => {
  const h = harness(); h.playerStep = 'attack';
  h.phaseDice = [{ pip: 6, type: 'attack' }, { pip: 6, type: 'movement' }, { pip: 6, type: 'movement' }];
  assert.equal(h.findDoublesPartner(0), -1);
  assert.equal(h.findDoublesPartner(1), 2);
  h.phaseDice[2].used = true;
  assert.equal(h.findDoublesPartner(1), -1);
  assert.equal(h.dieStep(0), 'attack');
  assert.equal(h.dieStep(1), 'movement');
});

test('same-pip dice show their own column action and color', () => {
  const h = harness(); h.playerStep = 'attack'; h.campaignReadyRackCanReloadShootingDice = () => false;
  assert.equal(h.dieActionHint(1, 'attack').text, 'die.hint.reload');
  assert.equal(h.dieActionHint(1, 'movement').text, 'die.hint.reverse');
  assert.equal(h.dieActionHint(6, 'attack').text, 'die.hint.gun');
  assert.equal(h.dieActionHint(6, 'movement').text, 'die.hint.drive');
  assert.equal(h.playerDieFillColor('attack'), 'attack-red');
  assert.equal(h.playerDieFillColor('movement'), 'move-green');
});

test('large combined trays shrink inside the space reserved beside Next Phase', () => {
  const h = harness(); let scale;
  h.phaseDice = Array.from({ length: 20 }, () => ({ pip: 1 }));
  h.diceTrayRoot = { setScale: x => { scale = x; } };
  h.ensureDiceVisualCount = () => {}; h.diceVisuals = [];
  h.refreshDiceTray();
  assert(scale < 1 && scale > 0);
  assert(20 * 72 * scale + 19 * 12 * scale <= 1280 - 2 * (160 + 40));
  session.gameMode = 'hardcore'; h.refreshDiceTray(); assert.equal(scale, 1);
});

test('movement dice cannot be selected for gun, precision, MG, or loading actions', () => {
  const h = harness(); h.playerStep = 'attack';
  h.phaseDice = [1, 3, 5, 6].map(pip => ({ pip, used: false, type: 'movement' }));
  h.selectedGunDieIdx = -1; h.selectedMGDieIdx = -1;
  const before = plain(h.mission.sherman);
  for (let i = 0; i < h.phaseDice.length; i++) {
    h.selectGunDie(i); h.selectGunDieDoubles(i); h.selectPrecisionGunDie(i); h.selectMGDie(i); h.tryReload(i);
  }
  assert.equal(h.selectedGunDieIdx, -1);
  assert.equal(h.selectedMGDieIdx, -1);
  assert.deepEqual(plain(h.mission.sherman), before);
});

test('attack dice cannot drive or turn the tank', () => {
  const h = harness(); h.playerStep = 'attack';
  h.phaseDice = [1, 3, 5, 6].map(pip => ({ pip, used: false, type: 'attack' }));
  const before = plain(h.mission.sherman);
  for (let i = 0; i < h.phaseDice.length; i++) { h.tryDriveSherman(i, 1); h.tryTurnSherman(i, 1); }
  assert.deepEqual(plain(h.mission.sherman), before);
});

test('ending the combined phase marks both columns done and allows misc directly', () => {
  const h = harness(); h.playerStep = 'attack';
  h.endCurrentSubPhase();
  assert.equal(h.movementDone, true); assert.equal(h.attackDone, true);
  assert.equal(h.playerStep, 'choose');
  h.enterPhase('misc'); assert.equal(h.playerStep, 'misc');
  assert(h.phaseDice.every(d => d.type === undefined));
});

test('consuming the last movement die completes the combined phase only after its action', () => {
  const h = harness(); h.playerStep = 'attack';
  h.phaseDice = [{ pip: 6, used: true, type: 'attack' }, { pip: 5, used: false, type: 'movement' }];
  h.usePhaseDice([1]);
  assert.equal(h.playerStep, 'attack'); assert.equal(h.pendingAutoEndStep, 'attack');
  h.completePhaseDiceAction();
  assert.equal(h.movementDone, true); assert.equal(h.attackDone, true);
});

test('test mode waits for the phase button and allows hatch switching before rolling', () => {
  const h = harness();
  h.ambushSightHighlightUntil = new Map();
  Object.assign(h, { clearAIMoveState() {}, clearActiveActingUnit() {}, destroyEnemyDiceTray() {},
    consumeLegacyUnitSmoke() {}, clearSmokeByOwner: () => [], computeOutcome: () => 'ongoing',
    updateOutcomeOverlay() {}, ensurePvpLocalTurnTimer() {}, battleLogI18n() {} });
  const scheduled = []; h.scheduleOnce = fn => scheduled.push(fn);
  h.beginPlayerPhaseForNewTurn();
  assert.equal(h.playerStep, 'choose'); assert.equal(h.phaseDice.length, 0);
  assert.equal(scheduled.length, 0);
  assert.equal(h.canToggleHatch(), null);
  h.enterPhaseIfChoose('attack');
  assert.equal(h.playerStep, 'attack'); assert(h.phaseDice.some(d => d.type === 'movement'));
  assert.equal(h.canToggleHatch(), 'floater.hatchLocked');
});

test('save and restore preserve mixed die types, order, pips and consumed flags', () => {
  const h = harness();
  const dice = [{ pip: 6, used: true, type: 'attack' }, { pip: 1, used: false, type: 'movement' }];
  const save = captureSave({ gameMode: 'test', missionId: h.mission.data.id, mission: h.mission,
    turn: 2, phase: 'player', movesLeft: 2, attacksLeft: 1, miscDone: false,
    playerStep: 'attack', hatchChangedThisTurn: false, phaseDice: dice });
  const restored = applySave(h.mission, h.mission.data.id, JSON.parse(JSON.stringify(save)));
  assert.equal(restored.ok, true); assert.equal(save.gameMode, 'test');
  assert.deepEqual(restored.phaseDice, dice); assert.equal(restored.playerStep, 'attack');
});

test('classic and hardcore keep single-column rolling and sequential phase completion', () => {
  for (const mode of ['classic', 'hardcore']) {
    const h = harness(mode); h.enterPhase('attack');
    assert(h.phaseDice.every(d => d.type === undefined));
    h.enterPhase = phase => { h.nextPhase = phase; };
    h.endCurrentSubPhase();
    assert.equal(h.attackDone, true); assert.equal(h.movementDone, false); assert.equal(h.nextPhase, 'movement');
  }
});
