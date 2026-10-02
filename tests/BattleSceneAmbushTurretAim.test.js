const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.createSourceFile('BattleScene.ts', fs.readFileSync(require('node:path').join(__dirname,
  '../assets/scripts/view/BattleScene.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const sceneClass = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'BattleScene');
const method = sceneClass.members.find(n => n.name?.getText(source) === 'tryResolveAmbushAfterMove');
const code = ts.transpile(`class Scene { ${method.getText(source)} }`, { target: ts.ScriptTarget.ES2020 });
for (const playerWatcher of [true, false]) for (const shell of ['ap', 'he']) {
  const watcher = { id: 'watcher', kind: 'tank', pos: { q: 0, r: 0 }, facing: 0, ambushReadyThisTurn: true, stats: {} };
  const mover = { id: 'mover', kind: 'tank', pos: { q: 1, r: 1 } };
  const context = {
    GameSession: { gameMode: 'hardcore' }, isFootUnit: () => false,
    orderedAmbushers: () => [watcher], isHostile: () => true, canEnterAmbush: () => true,
    isInAmbushSight: () => true, HexMap: { keyOf: () => '' }, resolvedLoadedShell: () => shell,
    canAttack: () => ({ ok: true }), getGameModeConfig: () => ({}), markAmbushAction: () => {},
    unitDisplayName: () => 'tank', t: () => '', Color: class {},
    rollAttack: () => ({}), rollHighExplosiveAttack: () => ({}),
  };
  const Scene = new Function(...Object.keys(context), `${code}; return Scene;`)(...Object.values(context));
  let aimDone;
  let fired = false;
  const scene = Object.assign(new Scene(), {
    mission: { sherman: playerWatcher ? watcher : mover, map: {}, data: {} },
    allUnits: () => [watcher, mover], ambushGunnerSightKeys: () => new Set(), currentTurretFacingFor: () => 0,
    battleLog: () => {}, spawnFloater: () => {}, protagonistForAttackTarget: () => mover,
    currentWeather: () => 'clear', rollHighExplosiveCollateralResults: () => [], highExplosivePanelReport: r => r,
    startShermanTurretAim: (target, done) => {
      assert.equal(playerWatcher, true); assert.equal(target, mover); aimDone = done;
    },
    startEnemyTurretAim: (actor, target, done) => {
      assert.equal(playerWatcher, false); assert.equal(actor, watcher); assert.equal(target, mover); aimDone = done;
    },
    startDiceShow: () => { fired = true; },
  });
  assert.equal(scene.tryResolveAmbushAfterMove(mover, () => {}), true);
  assert.equal(fired, false, 'ambush must wait for target aiming before firing');
  assert.equal(typeof aimDone, 'function');
  aimDone();
  assert.equal(fired, true, 'aim completion must start the ambush shot');
}
console.log('Player/enemy AP/HE ambush aiming order tests passed');
