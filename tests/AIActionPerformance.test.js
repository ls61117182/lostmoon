const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const rules = Object.assign({}, ...['types', 'Dice', 'HexGrid', 'EnemyAI', 'FogOfWar', 'Combat', 'Suppression', 'GameMode', 'Weather', 'UnitDB']
  .map(name => require(`../assets/scripts/core/${name}.ts`)));
const sceneMethods = require('./helpers/BattleSceneMethods.cjs');

function targetingFixture() {
  const calls = { shared: 0, own: 0 };
  const GameSession = { gameMode: 'hardcore' };
  const Scene = sceneMethods(['selectAIShootTarget', 'selectAIMGTarget', 'tankMachineGunContext'], {
    ...rules, GameSession,
    computeRadioSharedVisibleHexes(...args) { calls.shared++; return rules.computeRadioSharedVisibleHexes(...args); },
    computeUnitVisibleHexes(...args) { calls.own++; return rules.computeUnitVisibleHexes(...args); },
  });
  const map = new rules.HexMap(9, 9);
  for (let q = -4; q <= 4; q++) for (let r = -4; r <= 4; r++) map.set({ pos: { q, r }, terrain: 'field' });
  const unit = (id, kind, q, sideId) => ({ id, kind, sideId, faction: sideId === 'enemy' ? 'german' : 'usa',
    pos: { q, r: 0 }, facing: 0, turretFacing: 0, hatchOpen: true, loaded: true, loadedShell: 'ap',
    visionRange: 4, gunnerVisionRange: 4, interiorVisionRange: 1,
    crew: { commander: true, gunner: true, loader: true, driver: true, coDriver: true },
    stats: { ...rules.getUnitStats(kind), hasRadio: true } });
  const actor = unit('actor', 'panzer4', 0, 'enemy');
  const sender = unit('sender', 'panzer4', 2, 'enemy');
  const near = unit('near', 'sherman', 1, 'player'), far = unit('far', 'sherman', 2, 'player');
  const scene = new Scene();
  Object.assign(scene, { mission: { map, data: { theater: 'europe', weather: 'clear' }, smokeHexes: new Set() },
    currentWeather() { return this.mission.data.weather; },
    aiTargetsFor: () => [far, near], aiMissionTargetsFor: () => [], aiFriendliesFor: () => [sender],
    allUnits: () => [actor, sender, near, far], isHardcoreInfantryActor: () => false,
    tankMachineGunSelection: () => ({ weapon: 'both', rotateTurret: false }), rng: new rules.RNG(1) });
  return { scene, actor, near, far, calls, GameSession };
}

for (const weapon of ['main', 'mg']) test(`${weapon} target selection computes shared sight once and refreshes it after state changes`, () => {
  const { scene, actor, near, far, calls } = targetingFixture();
  if (weapon === 'mg') for (const target of [near, far]) {
    target.kind = 'american_infantry'; target.stats = { ...rules.getUnitStats(target.kind) };
  }
  const select = () => weapon === 'main' ? scene.selectAIShootTarget(actor, false) : scene.selectAIMGTarget(actor, false);
  assert.equal(select(), near);
  assert.equal(calls.shared, 1, 'two candidates share one visibility calculation');
  scene.mission.data.weather = 'fog'; scene.mission.smokeHexes.add('0,0');
  assert.equal(select(), null, 'radio intelligence cannot bypass own smoky firing sight');
  assert.equal(calls.shared, 2, 'the next decision must recompute after smoke/weather changes');
  scene.mission.smokeHexes.clear(); actor.radioDamaged = true;
  assert.equal(select(), near);
  assert.equal(calls.shared, 3);
  actor.pos = { q: -4, r: 0 };
  assert.equal(select(), null, 'moving the observer cannot reuse an old firing solution');
  assert.equal(calls.shared, 4);
});

test('classic selection uses one own-vision calculation; no candidates do not calculate sight', () => {
  const { scene, actor, near, calls, GameSession } = targetingFixture();
  GameSession.gameMode = 'classic';
  assert.equal(scene.selectAIShootTarget(actor, false), near);
  assert.equal(calls.own, 1); assert.equal(calls.shared, 0);
  scene.aiTargetsFor = () => [];
  assert.equal(scene.selectAIShootTarget(actor, false), null);
  assert.equal(scene.selectAIMGTarget(actor, false), null);
  assert.equal(calls.own, 1); assert.equal(calls.shared, 0);
});

class Color { constructor(...values) { this.values = values; } }
const trayGlobals = { ...rules, Color, t: key => key, DICE_DIE_BORDER: {}, unitDisplayName: value => value,
  describeEntry: entry => entry.primary };
function trayFixture() {
  const Scene = sceneMethods(['refreshEnemyDiceTray', 'enemyDieActionSubtitle', 'runNextEnemyStep'], trayGlobals);
  const scene = new Scene(), enemy = { id: 'actor', kind: 'panzer4' };
  const decisions = [], executions = [];
  Object.assign(scene, { mission: {}, outcome: 'ongoing', enemyOrder: [enemy], enemyIndex: 0,
    enemyDiceTrayRoot: {}, enemyTrayMetrics: { dieSize: 36 }, enemyDiceTraySubject: enemy,
    enemyDiceTrayLabels: Array.from({ length: 3 }, () => ({ node: {} })),
    enemyDiceTraySubtitleLabels: Array.from({ length: 3 }, () => ({})),
    enemyDiceTrayTileGraphics: Array.from({ length: 3 }, () => ({ clear() {} })),
    enemyDice: [1, 2, 3], enemyDiceTypes: ['move', 'move', 'move'], enemyDiceFirepower: [],
    enemyDiceUsed: [], enemyDiceResolvedActions: [], enemyDiceExecOrder: [0, 1, 2],
    enemyDiceHighlightIdx: -1, enemyDiceSortAnim: null,
    enemyDieActionEntry: i => ({ primary: ['advance', 'turn', 'reverse'][i] }),
    chooseActionForEntry(_, entry, opts) { decisions.push({ action: entry.primary, commit: !!opts?.commitMoveState }); return entry.primary; },
    executeEnemyAction(_, action) { executions.push(action); return 'animating'; },
    enemyDieFillColor: () => ({}), drawDieBody() {}, drawDiePips() {}, drawRollingDie() {},
    pauseAIFlowForCombatLogReplay: () => false, isHardcoreInfantryActor: () => false,
    battleLog() {}, clearAIMoveState() {}, clearActiveActingUnit() {}, isOutsidePlayerRegion: () => false,
  });
  return { scene, enemy, decisions, executions };
}

test('highlight/used changes show resolved results and gray subtitles without previewing remaining dice', () => {
  const { scene, decisions, executions } = trayFixture();
  scene.refreshEnemyDiceTray(); assert.equal(decisions.length, 3);
  scene.runNextEnemyStep();
  assert.deepEqual(executions, ['advance']);
  assert.equal(decisions.length, 4, 'only the actual action is decided at move start');
  scene.enemyDiceResolvedActions[0] = 'shoot'; // e.g. an attack consuming a matching die
  scene.refreshEnemyDiceTray(false);
  assert.equal(scene.enemyDiceTraySubtitleLabels[0].string, 'dice.aiEnemy.shoot');
  assert.deepEqual(scene.enemyDiceTraySubtitleLabels[0].color.values, [130, 130, 120, 160]);
  assert.equal(scene.enemyDiceTraySubtitleLabels[1].string, 'dice.aiEnemy.turn');
  assert.equal(decisions.length, 4);
  scene.refreshEnemyDiceTray();
  assert.equal(decisions.length, 6, 'the two undecided dice refresh after an action finishes');
});

test('failed dice do not repeatedly preview the remaining row or stall its result hold', () => {
  const { scene } = trayFixture();
  let decisions = 0;
  scene.chooseActionForEntry = () => { decisions++; return null; };
  scene.refreshEnemyDiceTray(); decisions = 0;
  scene.runNextEnemyStep();
  assert.equal(decisions, 3, 'one actual attempt per die, no row previews');
  assert(scene.enemyDiceUsed.every(Boolean));
  assert(scene.enemyDiceTraySubtitleLabels.every(label => label.string === 'dice.aiEnemy.waste'));
  assert.equal(scene.enemyDiceResultHold.dur, 1);
});

test('a synchronous rules change refreshes unresolved subtitles once before the next action', () => {
  const { scene, decisions } = trayFixture();
  let smoke = false;
  scene.chooseActionForEntry = (_, entry, opts) => {
    decisions.push({ commit: !!opts?.commitMoveState });
    return entry.primary === 'advance' ? 'smoke' : smoke ? 'reverse' : 'turn';
  };
  scene.executeEnemyAction = (_, action) => {
    if (action === 'smoke') { smoke = true; return 'done'; }
    return 'animating';
  };
  scene.refreshEnemyDiceTray(); decisions.length = 0;
  scene.runNextEnemyStep();
  assert.equal(decisions.filter(d => d.commit).length, 2);
  assert.equal(decisions.filter(d => !d.commit).length, 2, 'one refresh of the two remaining dice after smoke');
  assert.equal(scene.enemyDiceTraySubtitleLabels[2].string, 'dice.aiEnemy.reverse');
});

test('building a rolling tray previews each die once after binding its slots', () => {
  class Node {
    constructor() { this.children = []; this.layer = 0; this.isValid = true; }
    addChild(child) { this.children.push(child); child.parent = this; }
    addComponent(Type) { const component = new Type(); component.node = this; return component; }
    setPosition() {} setSiblingIndex() {} setScale() {}
  }
  class UITransform { setContentSize() {} }
  class Graphics { clear() {} }
  const Scene = sceneMethods(['buildEnemyDiceTray', 'refreshEnemyDiceTray', 'enemyDieActionSubtitle'], {
    ...trayGlobals, Node, UITransform, Graphics, Label: class {},
    HorizontalTextAlignment: { CENTER: 0 }, VerticalTextAlignment: { CENTER: 0, TOP: 1 },
    BattleScene: { DICE_TRAY_SLOT: 36, DICE_TRAY_GAP: 4, PLAYER_DICE_SORT_DUR: .3 },
    DIE_FACE_TEXT: {}, DICE_ROLL_DUR: .5, playDiceRoll() {},
  });
  const scene = new Scene(), root = new Node(); let decisions = 0;
  Object.assign(scene, { node: root, mission: { data: {} }, enemyDice: [1, 2, 3],
    enemyDiceTypes: ['move', 'move', 'move'], enemyDiceFirepower: [], enemyDiceUsed: [],
    enemyDiceResolvedActions: [], enemyDiceExecOrder: [0, 1, 2], enemyDiceHighlightIdx: -1,
    hudParent: () => root, placeEnemyDiceTrayRoot() {}, destroyEnemyDiceTray() {},
    playerDiceSlotX: i => i * 40, enemyDieFillColor: () => ({}), applyEnemyDiceSortLayout() {},
    drawDieBody() {}, drawDiePips() {}, drawRollingDie() {},
    enemyDieActionEntry: () => ({ primary: 'advance' }),
    chooseActionForEntry() { decisions++; return 'advance'; },
  });
  scene.buildEnemyDiceTray({ kind: 'panzer4' });
  assert.equal(decisions, 3, 'initial node creation must not duplicate the final rules refresh');
  assert(scene.enemyDiceTraySubtitleLabels.every(label => label.string === 'dice.aiEnemy.advance'));
  scene.enemyDiceSortAnim = null;
  scene.refreshEnemyDiceTray(false);
  assert.equal(decisions, 3, 'finishing the sort only changes dice appearance');
});
