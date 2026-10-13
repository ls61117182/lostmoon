const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const types = require('../assets/scripts/core/types.ts');
const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const { HARDCORE_TANK_AI_TABLE, DEFAULT_AI_TABLE } = require('../assets/scripts/core/EnemyAIDB.ts');
const { canExecuteAction } = require('../assets/scripts/core/EnemyAI.ts');
const { enterAmbush } = require('../assets/scripts/core/Ambush.ts');
const scene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const source = ts.createSourceFile('BattleScene.ts', scene, ts.ScriptTarget.Latest, true);
const cls = source.statements.find(s => ts.isClassDeclaration(s) && s.name?.text === 'BattleScene');
const methodNames = ['chooseActionForEntry', 'executeEnemyAction', 'canAIExecuteShoot', 'tryEnemyAttack'];
const methods = cls.members.filter(m => methodNames.includes(m.name?.getText(source))).map(m => m.getText(source)).join('\n');
const GameSession = { gameMode: 'hardcore' };
const Harness = vm.runInNewContext(ts.transpileModule('class Harness { ' + methods + ' }', {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText + '\nHarness;', {
  ...types, GameSession, canExecuteAction, enterAmbush,
  playCannonReload: () => {}, unitDisplayName: x => x,
  getGameModeConfig: () => ({ aiMainGunFallbackToMG: false }),
  nonPlayerTankWeaponForTarget: () => 'ap', hexDistance: () => 2,
});
function tank(difficulty = 1) {
  return { kind: 'sherman', id: 'ai', pos: { q: 0, r: 0 }, facing: 0,
    stats: { ...getUnitStats('sherman'), reloadDifficulty: difficulty }, loaded: false, loadedShell: null, reloadProgress: 0 };
}
function harness() {
  const h = new Harness();
  Object.assign(h, {
    mission: { map: { get: () => undefined } }, outcome: 'ongoing',
    currentAITarget: () => null, buildOccupiedSet: () => new Set(),
    enemyCrewRequirementMet: () => true, aiMoveDestinationForAction: () => null,
    isAIReverseMoveFilterEnabled: () => false,
    selectAIMGTarget: () => null, selectAIShootTarget: () => null,
    canAIMainGunResolveSelectedTarget: () => true,
    battleLog: () => {}, redraw: () => {}, mainGunLoadingLabel: () => '',
  });
  return h;
}

test('every hardcore attack face loads before shooting; misc 4 adds ambush as third choice', () => {
  for (let pip = 1; pip <= 6; pip++) {
    assert.equal(HARDCORE_TANK_AI_TABLE.attack1[pip].primary, 'reload');
    assert.equal(HARDCORE_TANK_AI_TABLE.attack1[pip].fallback, 'shoot');
  }
  const misc = HARDCORE_TANK_AI_TABLE.misc1[4];
  assert.deepEqual([misc.primary, misc.fallback, misc.fallback2], ['reload', 'shoot', 'ambush']);
  assert.equal(DEFAULT_AI_TABLE.road[1].primary, 'shoot');
});

test('loading spends a whole action, works without a target, and only the next die can shoot', () => {
  for (const difficulty of [1, 2]) {
    const h = harness(), u = tank(difficulty), entry = HARDCORE_TANK_AI_TABLE.attack1[1];
    let shots = 0;
    h.tryEnemyAttack = unit => {
      assert.equal(types.isMainGunLoaded(unit, true), true);
      shots++; unit.loaded = false; unit.reloadProgress = 0; return false;
    };
    for (let progress = 1; progress <= difficulty; progress++) {
      const action = h.chooseActionForEntry(u, entry);
      assert.equal(action, 'reload');
      assert.equal(h.executeEnemyAction(u, action), 'done');
      assert.equal(u.reloadProgress, progress); assert.equal(shots, 0);
    }
    h.selectAIShootTarget = () => tank();
    assert.equal(h.chooseActionForEntry(u, entry), 'shoot');
    h.executeEnemyAction(u, 'shoot'); assert.equal(shots, 1);
    assert.equal(h.chooseActionForEntry(u, entry), 'reload');
  }
});

test('full misc 4 skips loading and chooses ambush if no shot exists, including fixed guns', () => {
  const h = harness(), u = tank();
  h.currentAITarget = () => tank();
  u.stats.visionType = 'fixed';
  u.loaded = true; u.reloadProgress = 1;
  assert.equal(h.chooseActionForEntry(u, HARDCORE_TANK_AI_TABLE.misc1[4]), 'ambush');
  u.reloadProgress = 0; u.loaded = false;
  assert.equal(h.chooseActionForEntry(u, HARDCORE_TANK_AI_TABLE.misc1[4]), 'reload');
});

test('direct main-gun attack cannot implicitly load an empty tank', () => {
  const h = harness(), u = tank(2), target = tank();
  u.stats.visionType = 'fixed';
  Object.assign(h, { tryHeavyArtilleryTraverse: () => false, isHardcoreInfantryActor: () => false, enemySupportsSplitTurret: () => false });
  assert.equal(h.tryEnemyAttack(u, { selectedTarget: target }), false);
  assert.equal(u.reloadProgress, 0);
});

test('classic mode skips the new loading action and keeps shooting behavior', () => {
  GameSession.gameMode = 'classic';
  try {
    const h = harness(), u = tank(2);
    h.selectAIShootTarget = () => tank();
    assert.equal(h.chooseActionForEntry(u, HARDCORE_TANK_AI_TABLE.attack1[1]), 'shoot');
    assert.equal(u.reloadProgress, 0);
  } finally { GameSession.gameMode = 'hardcore'; }
});
